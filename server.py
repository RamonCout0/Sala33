import asyncio
import json
import websockets
import os
import re
import socket
import time
import threading
import importlib
import pkgutil
import mimetypes
import http
from http.server import SimpleHTTPRequestHandler
from socketserver import ThreadingTCPServer
from websockets.http11 import Response
from websockets.datastructures import Headers as WsHeaders

# Modo produção = qualquer cloud que define PORT (Railway, Render, Fly.io...)
# Modo local = duas portas separadas (HTTP 8000 + WS 8080)
MODO_PRODUCAO = "PORT" in os.environ and "PORT_HTTP" not in os.environ

PORT_WS   = int(os.environ.get("PORT", 8080))
PORT_HTTP = int(os.environ.get("PORT_HTTP", 8000))


# =====================================================
#   CONFIGURAÇÃO — Lê o manifest para saber quais salas existem
# =====================================================
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(ROOT_DIR, "public")
MANIFEST_PATH = os.path.join(PUBLIC_DIR, "mods", "manifest.json")
PERSONAGENS_PATH = os.path.join(PUBLIC_DIR, "mods", "personagens.json")

try:
    with open(MANIFEST_PATH, encoding="utf-8") as _f:
        MANIFEST = json.load(_f)
except Exception as e:
    print(f"[ERRO] Não consegui ler {MANIFEST_PATH}: {e}")
    MANIFEST = {"salas": [], "salaInicial": "the_hub"}

# Whitelist de spriteIds válidos (lê do personagens.json)
SPRITES_VALIDOS = {"cinzaguy"}
try:
    with open(PERSONAGENS_PATH, encoding="utf-8") as _f:
        for p in json.load(_f):
            SPRITES_VALIDOS.add(p["id"])
except Exception as e:
    print(f"[AVISO] Não consegui ler personagens.json: {e}")

SALA_INICIAL = MANIFEST.get("salaInicial", "the_hub")
JOGADORES = {}
SALAS = {sala_id: set() for sala_id in MANIFEST.get("salas", [])}


# =====================================================
#   SEGURANÇA — Constantes e validadores
# =====================================================
MAX_MSG_BYTES     = 2048       # tamanho máximo de uma mensagem WS
MAX_CHAT_LEN      = 200        # caracteres no texto do chat
MAX_USERNAME_LEN  = 16         # caracteres no username
RATE_LIMIT_MSGS   = 30         # mensagens máximas por segundo por conexão
RATE_LIMIT_WINDOW = 1.0        # janela em segundos
USERNAME_REGEX    = re.compile(r"^[A-Za-z0-9_\- ]+$")
LADOS_VALIDOS     = {"esquerda", "direita"}


def validar_lado(valor):
    """Retorna o lado se válido, senão 'direita'."""
    return valor if valor in LADOS_VALIDOS else "direita"


def validar_sprite(valor):
    """Retorna o spriteId se válido, senão 'cinzaguy'."""
    return valor if valor in SPRITES_VALIDOS else "cinzaguy"


def sanitizar_username(valor):
    """Remove caracteres inválidos e trunca."""
    valor = valor.strip()[:MAX_USERNAME_LEN].upper()
    if not valor or not USERNAME_REGEX.match(valor):
        return None
    return valor


# =====================================================
#   CARREGADOR DE MÓDULOS — server_mods/*.py
# =====================================================
HANDLERS_POR_TIPO = {}      # "interagir_pong" -> módulo
MODS_COM_TICK = []          # módulos que implementam tick()
MODS_COM_LEAVE = []         # módulos que implementam on_leave()
MOD_SALA = {}               # "interagir_pong" -> "sala_jogos" (qual sala o mod espera)


def carregar_server_mods():
    """Descobre e importa todos os módulos em server_mods/ automaticamente."""
    import server_mods
    for _, mod_name, _ in pkgutil.iter_modules(server_mods.__path__):
        try:
            mod = importlib.import_module(f"server_mods.{mod_name}")
            if hasattr(mod, "HANDLES") and hasattr(mod, "handle"):
                sala_esperada = getattr(mod, "SALA", None)
                for tipo in mod.HANDLES:
                    HANDLERS_POR_TIPO[tipo] = mod
                    if sala_esperada:
                        MOD_SALA[tipo] = sala_esperada
                print(f"  ✓ server_mods.{mod_name}  →  {mod.HANDLES}")
            if hasattr(mod, "tick"):
                MODS_COM_TICK.append(mod)
            if hasattr(mod, "on_leave"):
                MODS_COM_LEAVE.append(mod)
        except Exception as e:
            print(f"  ✗ server_mods.{mod_name}  →  ERRO: {e}")


# =====================================================
#   BROADCAST — manda mensagem para todos os jogadores de uma sala
# =====================================================
async def enviar_para_sala(sala_nome, payload):
    if not sala_nome or sala_nome not in SALAS or not SALAS[sala_nome]:
        return
    mensagem = json.dumps(payload)
    for ws in list(SALAS[sala_nome]):
        if ws in JOGADORES:
            try:
                JOGADORES[ws]["queue"].put_nowait(mensagem)
            except asyncio.QueueFull:
                try:
                    JOGADORES[ws]["queue"].get_nowait()
                    JOGADORES[ws]["queue"].put_nowait(mensagem)
                except Exception:
                    pass


# =====================================================
#   LOOP DE FÍSICA — Chama tick() de todos os mods registrados
# =====================================================
async def loop_minigames():
    while True:
        await asyncio.sleep(1 / 60)
        for mod in MODS_COM_TICK:
            try:
                await mod.tick(JOGADORES, SALAS, enviar_para_sala)
            except Exception as e:
                print(f"[tick:{mod.__name__}] {e}")


def abandonar_minigames(websocket):
    """Notifica todos os mods que o jogador saiu / desconectou."""
    for mod in MODS_COM_LEAVE:
        try:
            mod.on_leave(websocket, JOGADORES)
        except Exception as e:
            print(f"[on_leave:{mod.__name__}] {e}")


# =====================================================
#   RATE LIMITER
# =====================================================
class RateLimiter:
    """Controle simples de taxa: max N mensagens por janela de tempo."""
    def __init__(self, max_msgs, janela):
        self.max_msgs = max_msgs
        self.janela = janela
        self.timestamps = []

    def permitir(self):
        agora = time.monotonic()
        # Remove timestamps fora da janela
        self.timestamps = [t for t in self.timestamps if agora - t < self.janela]
        if len(self.timestamps) >= self.max_msgs:
            return False
        self.timestamps.append(agora)
        return True


# =====================================================
#   MOVIMENTAÇÃO ENTRE SALAS
# =====================================================
async def mover_jogador(websocket, nova_sala):
    if websocket not in JOGADORES:
        return
    if nova_sala not in SALAS:
        print(f"[AVISO] Sala desconhecida: {nova_sala}")
        return

    sala_antiga = JOGADORES[websocket]["sala"]

    if sala_antiga and websocket in SALAS[sala_antiga]:
        SALAS[sala_antiga].remove(websocket)
        await enviar_para_sala(sala_antiga, {"tipo": "jogador_saiu", "id": id(websocket)})
        abandonar_minigames(websocket)

    usuarios_existentes = []
    for outro_ws in list(SALAS[nova_sala]):
        if outro_ws in JOGADORES:
            usuarios_existentes.append({
                "id": id(outro_ws),
                "username": JOGADORES[outro_ws]["username"],
                "x": JOGADORES[outro_ws]["x"],
                "y": JOGADORES[outro_ws]["y"],
                "spriteId": JOGADORES[outro_ws]["spriteId"],
                "lado": JOGADORES[outro_ws].get("lado", "direita"),
            })

    if usuarios_existentes and websocket in JOGADORES:
        try:
            JOGADORES[websocket]["queue"].put_nowait(json.dumps({
                "tipo": "lista_jogadores",
                "jogadores": usuarios_existentes,
            }))
        except Exception:
            pass

    if websocket in JOGADORES:
        JOGADORES[websocket]["sala"] = nova_sala
        SALAS[nova_sala].add(websocket)
        await enviar_para_sala(nova_sala, {
            "tipo": "novo_jogador",
            "id": id(websocket),
            "username": JOGADORES[websocket]["username"],
            "x": JOGADORES[websocket]["x"],
            "y": JOGADORES[websocket]["y"],
            "spriteId": JOGADORES[websocket]["spriteId"],
            "lado": JOGADORES[websocket].get("lado", "direita"),
        })


# =====================================================
#   ESCRITOR — Drena a fila de mensagens para o cliente
# =====================================================
async def escritor_cliente(websocket, queue):
    try:
        while True:
            mensagem = await queue.get()
            await websocket.send(mensagem)
            queue.task_done()
    except (websockets.exceptions.ConnectionClosed, asyncio.CancelledError):
        pass
    except Exception:
        pass


# =====================================================
#   HANDLER PRINCIPAL — Roteia cada tipo de mensagem
# =====================================================
async def handler(websocket):
    queue = asyncio.Queue(maxsize=256)
    rate_limiter = RateLimiter(RATE_LIMIT_MSGS, RATE_LIMIT_WINDOW)

    JOGADORES[websocket] = {
        "username": "Anônimo", "sala": None,
        "x": 200, "y": 150,
        "spriteId": "cinzaguy", "lado": "direita",
        "queue": queue, "logado": False,
    }
    tarefa_escrita = asyncio.create_task(escritor_cliente(websocket, queue))

    try:
        async for message in websocket:
            if websocket not in JOGADORES:
                break

            # --- Limite de tamanho da mensagem ---
            if len(message) > MAX_MSG_BYTES:
                continue

            # --- Rate limiting ---
            if not rate_limiter.permitir():
                continue

            # --- Parse seguro ---
            try:
                dados = json.loads(message)
            except (json.JSONDecodeError, ValueError):
                continue

            if not isinstance(dados, dict):
                continue

            tipo = dados.get("tipo")
            if not isinstance(tipo, str):
                continue

            sala_atual = JOGADORES[websocket]["sala"]

            # --- Login ---
            if tipo == "login":
                # Só permite login uma vez por conexão
                if JOGADORES[websocket]["logado"]:
                    continue

                raw_username = dados.get("username", "")
                if not isinstance(raw_username, str):
                    continue

                username_proposto = sanitizar_username(raw_username)
                if not username_proposto:
                    try:
                        queue.put_nowait(json.dumps({"tipo": "erro_login", "mensagem": "NOME INVÁLIDO! Use apenas letras, números, _ e -."}))
                    except Exception:
                        pass
                    continue

                if any(j["username"] == username_proposto for j in JOGADORES.values() if j.get("logado")):
                    try:
                        queue.put_nowait(json.dumps({"tipo": "erro_login", "mensagem": f"O NOME '{username_proposto}' JÁ ESTÁ SENDO USADO!"}))
                    except Exception:
                        pass
                else:
                    JOGADORES[websocket]["username"] = username_proposto
                    JOGADORES[websocket]["spriteId"] = validar_sprite(dados.get("spriteId", "cinzaguy"))
                    JOGADORES[websocket]["logado"] = True
                    await mover_jogador(websocket, SALA_INICIAL)

            # --- Rejeita tudo se não logou ---
            elif not JOGADORES[websocket]["logado"]:
                continue

            # --- Movimentação ---
            elif tipo == "mover":
                raw_x = dados.get("x")
                raw_y = dados.get("y")
                if not isinstance(raw_x, (int, float)) or not isinstance(raw_y, (int, float)):
                    continue
                JOGADORES[websocket]["x"] = max(0, min(368, raw_x))
                JOGADORES[websocket]["y"] = max(0, min(268, raw_y))
                JOGADORES[websocket]["lado"] = validar_lado(dados.get("lado", "direita"))
                await enviar_para_sala(sala_atual, {
                    "tipo": "movimento", "id": id(websocket),
                    "x": JOGADORES[websocket]["x"], "y": JOGADORES[websocket]["y"],
                    "lado": JOGADORES[websocket]["lado"],
                })

            elif tipo == "mudar_sala":
                nova_sala = dados.get("nova_sala")
                if not isinstance(nova_sala, str) or nova_sala not in SALAS:
                    continue
                raw_x = dados.get("x", 200)
                raw_y = dados.get("y", 150)
                if not isinstance(raw_x, (int, float)) or not isinstance(raw_y, (int, float)):
                    continue
                JOGADORES[websocket]["x"] = max(0, min(368, raw_x))
                JOGADORES[websocket]["y"] = max(0, min(268, raw_y))
                await mover_jogador(websocket, nova_sala)

            # --- Chat ---
            elif tipo == "chat":
                texto = dados.get("texto", "")
                if not isinstance(texto, str):
                    continue
                texto = texto.strip()[:MAX_CHAT_LEN]
                if not texto:
                    continue
                await enviar_para_sala(sala_atual, {
                    "tipo": "chat",
                    "username": JOGADORES[websocket]["username"],
                    "texto": texto,
                })

            elif tipo == "digitando":
                estado = dados.get("estado")
                if not isinstance(estado, bool):
                    continue
                await enviar_para_sala(sala_atual, {
                    "tipo": "jogador_digitando",
                    "id": id(websocket),
                    "estado": estado,
                })

            # --- Tudo o mais é roteado para os server_mods ---
            elif tipo in HANDLERS_POR_TIPO:
                # Verifica se o jogador está na sala correta para esse handler
                sala_esperada = MOD_SALA.get(tipo)
                if sala_esperada and sala_atual != sala_esperada:
                    continue
                try:
                    await HANDLERS_POR_TIPO[tipo].handle(tipo, websocket, dados, JOGADORES, SALAS, enviar_para_sala)
                except Exception as e:
                    print(f"[handle:{tipo}] {e}")

            # Tipo desconhecido — ignora silenciosamente
            # (não loggar pra evitar spam no terminal)

    except websockets.exceptions.ConnectionClosed:
        pass
    except Exception as e:
        print(f"[handler] Erro inesperado: {e}")
    finally:
        tarefa_escrita.cancel()
        if websocket in JOGADORES:
            sala_atual = JOGADORES[websocket]["sala"]
            abandonar_minigames(websocket)
            if sala_atual and websocket in SALAS.get(sala_atual, set()):
                SALAS[sala_atual].discard(websocket)
                await enviar_para_sala(sala_atual, {"tipo": "jogador_saiu", "id": id(websocket)})
            JOGADORES.pop(websocket, None)


# =====================================================
#   SERVIDOR HTTP (arquivos estáticos)
# =====================================================
def pegar_ip_local():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = "127.0.0.1"
    finally:
        s.close()
    return ip


# =====================================================
#   SERVIDOR HTTP EMBUTIDO (produção — porta única)
#   Em produção o WebSocket server também serve arquivos
#   estáticos via process_request, evitando duas portas.
# =====================================================
CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js":   "application/javascript",
    ".json": "application/json",
    ".css":  "text/css",
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
    ".mp3":  "audio/mpeg",
    ".ico":  "image/x-icon",
}
SEM_CACHE = {".js", ".json"}


async def process_request(connection, request):
    """Serve arquivos estáticos quando a requisição não é upgrade de WS."""
    if request.headers.get("Upgrade", "").lower() == "websocket":
        return None

    url_path = request.path.split("?")[0]
    if url_path == "/":
        url_path = "/index.html"
    file_path = os.path.realpath(os.path.join(PUBLIC_DIR, url_path.lstrip("/")))

    if not file_path.startswith(os.path.realpath(PUBLIC_DIR)):
        body = b"Forbidden"
        return Response(403, "Forbidden", WsHeaders([("Content-Length", str(len(body)))]), body)

    if not os.path.isfile(file_path):
        body = b"Not Found"
        return Response(404, "Not Found", WsHeaders([("Content-Length", str(len(body)))]), body)

    with open(file_path, "rb") as f:
        body = f.read()

    ext = os.path.splitext(file_path)[1].lower()
    ct = CONTENT_TYPES.get(ext, "application/octet-stream")
    header_list = [
        ("Content-Type", ct),
        ("Content-Length", str(len(body))),
        ("X-Content-Type-Options", "nosniff"),
        ("X-Frame-Options", "DENY"),
    ]
    if ext in SEM_CACHE:
        header_list.append(("Cache-Control", "no-cache, no-store, must-revalidate"))

    return Response(200, "OK", WsHeaders(header_list), body)


def rodar_servidor_web_background():
    dir_alvo = PUBLIC_DIR if os.path.isdir(PUBLIC_DIR) else "."

    class HandlerCustomizado(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=dir_alvo, **kwargs)

        def log_message(self, format, *args):
            pass  # cala a boca

        def end_headers(self):
            # Sempre busca JS/JSON fresco — evita problemas com mods atualizados
            caminho = self.path.split("?")[0]
            if caminho.endswith(".js") or caminho.endswith(".json"):
                self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            # Headers de segurança básicos
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")
            super().end_headers()

    class ServidorSilenciosoMultithread(ThreadingTCPServer):
        allow_reuse_address = True
        daemon_threads = True

        def handle_error(self, request, client_address):
            pass  # ignora broken pipe

    try:
        with ServidorSilenciosoMultithread(("", PORT_HTTP), HandlerCustomizado) as httpd:
            httpd.serve_forever()
    except Exception:
        pass


# =====================================================
#   MAIN
# =====================================================
async def main():
    print("=" * 65)
    print("        SALA 33 — HUB DE EXECUÇÃO UNIFICADO")
    print("=" * 65)

    print(f"» Modo: {'PRODUÇÃO (porta única)' if MODO_PRODUCAO else 'LOCAL (duas portas)'}")
    print(f"» Salas registradas: {', '.join(SALAS.keys()) or '(nenhuma)'}")
    print(f"» Sala inicial: {SALA_INICIAL}")
    print(f"» Sprites válidos: {', '.join(sorted(SPRITES_VALIDOS))}")
    print(f"» Rate limit: {RATE_LIMIT_MSGS} msgs/{RATE_LIMIT_WINDOW}s por conexão")
    print(f"» Max tamanho msg: {MAX_MSG_BYTES} bytes")
    print("» Carregando mecânicas de servidor:")
    carregar_server_mods()

    ip_rede = pegar_ip_local()
    print("-" * 65)

    if MODO_PRODUCAO:
        print(f"» Porta única (HTTP + WS): {PORT_WS}")
        print(f"🌍 URL pública será definida pelo Railway/cloud")
    else:
        print(f"» Endereço IP Local: {ip_rede}")
        print(f"🌍 ACESSO AO SITE (HTTP)  : http://{ip_rede}:{PORT_HTTP}")
        print(f"⚡ REDE DO MULTIPLAYER (WS): ws://{ip_rede}:{PORT_WS}")
    print("=" * 65)

    asyncio.create_task(loop_minigames())

    ws_kwargs = dict(
        max_size=MAX_MSG_BYTES,
        max_queue=64,
        ping_interval=30,
        ping_timeout=10,
    )

    if MODO_PRODUCAO:
        # Porta única: WS + HTTP estático no mesmo servidor
        async with websockets.serve(
            handler, "0.0.0.0", PORT_WS,
            process_request=process_request,
            **ws_kwargs
        ):
            await asyncio.Future()
    else:
        # Local: HTTP separado em thread + WS na porta 8080
        threading.Thread(target=rodar_servidor_web_background, daemon=True).start()
        async with websockets.serve(
            handler, "0.0.0.0", PORT_WS,
            **ws_kwargs
        ):
            await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n» Servidor desligado.")
