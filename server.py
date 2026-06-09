import asyncio
import json
import websockets
import os
import socket
import threading
import importlib
import pkgutil
from http.server import SimpleHTTPRequestHandler
from socketserver import ThreadingTCPServer

PORT_WS   = int(os.environ.get("PORT", 8080))
PORT_HTTP = int(os.environ.get("PORT_HTTP", 8000))


# =====================================================
#   CONFIGURAÇÃO — Lê o manifest para saber quais salas existem
# =====================================================
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(ROOT_DIR, "public")
MANIFEST_PATH = os.path.join(PUBLIC_DIR, "mods", "manifest.json")

try:
    with open(MANIFEST_PATH, encoding="utf-8") as _f:
        MANIFEST = json.load(_f)
except Exception as e:
    print(f"[ERRO] Não consegui ler {MANIFEST_PATH}: {e}")
    MANIFEST = {"salas": [], "salaInicial": "the_hub"}

SALA_INICIAL = MANIFEST.get("salaInicial", "the_hub")
JOGADORES = {}
SALAS = {sala_id: set() for sala_id in MANIFEST.get("salas", [])}


# =====================================================
#   CARREGADOR DE MÓDULOS — server_mods/*.py
# =====================================================
HANDLERS_POR_TIPO = {}      # "interagir_pong" -> módulo
MODS_COM_TICK = []          # módulos que implementam tick()
MODS_COM_LEAVE = []         # módulos que implementam on_leave()


def carregar_server_mods():
    """Descobre e importa todos os módulos em server_mods/ automaticamente."""
    import server_mods
    for _, mod_name, _ in pkgutil.iter_modules(server_mods.__path__):
        try:
            mod = importlib.import_module(f"server_mods.{mod_name}")
            if hasattr(mod, "HANDLES") and hasattr(mod, "handle"):
                for tipo in mod.HANDLES:
                    HANDLERS_POR_TIPO[tipo] = mod
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
    queue = asyncio.Queue()
    JOGADORES[websocket] = {
        "username": "Anônimo", "sala": None,
        "x": 200, "y": 150,
        "spriteId": "cinzaguy", "lado": "direita",
        "queue": queue,
    }
    tarefa_escrita = asyncio.create_task(escritor_cliente(websocket, queue))

    try:
        async for message in websocket:
            if websocket not in JOGADORES:
                break
            dados = json.loads(message)
            tipo = dados.get("tipo")
            sala_atual = JOGADORES[websocket]["sala"]

            # --- Login ---
            if tipo == "login":
                username_proposto = dados["username"].upper().strip()
                if any(j["username"] == username_proposto for j in JOGADORES.values() if j["sala"] is not None):
                    try:
                        queue.put_nowait(json.dumps({"tipo": "erro_login", "mensagem": f"O NOME '{username_proposto}' JÁ ESTÁ SENDO USADO!"}))
                    except Exception:
                        pass
                else:
                    JOGADORES[websocket]["username"] = username_proposto
                    JOGADORES[websocket]["spriteId"] = dados.get("spriteId", "cinzaguy")
                    await mover_jogador(websocket, SALA_INICIAL)

            # --- Movimentação ---
            elif tipo == "mover":
                JOGADORES[websocket]["x"] = max(0, min(368, dados["x"]))
                JOGADORES[websocket]["y"] = max(0, min(268, dados["y"]))
                JOGADORES[websocket]["lado"] = dados.get("lado", "direita")
                await enviar_para_sala(sala_atual, {
                    "tipo": "movimento", "id": id(websocket),
                    "x": JOGADORES[websocket]["x"], "y": JOGADORES[websocket]["y"],
                    "lado": JOGADORES[websocket]["lado"],
                })

            elif tipo == "mudar_sala":
                JOGADORES[websocket]["x"] = max(0, min(368, dados.get("x", 200)))
                JOGADORES[websocket]["y"] = max(0, min(268, dados.get("y", 150)))
                await mover_jogador(websocket, dados["nova_sala"])

            # --- Chat ---
            elif tipo == "chat":
                await enviar_para_sala(sala_atual, {
                    "tipo": "chat",
                    "username": JOGADORES[websocket]["username"],
                    "texto": dados["texto"],
                })
            elif tipo == "digitando":
                await enviar_para_sala(sala_atual, {
                    "tipo": "jogador_digitando",
                    "id": id(websocket),
                    "estado": dados["estado"],
                })

            # --- Tudo o mais é roteado para os server_mods ---
            elif tipo in HANDLERS_POR_TIPO:
                try:
                    await HANDLERS_POR_TIPO[tipo].handle(tipo, websocket, dados, JOGADORES, SALAS, enviar_para_sala)
                except Exception as e:
                    print(f"[handle:{tipo}] {e}")

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        tarefa_escrita.cancel()
        if websocket in JOGADORES:
            sala_atual = JOGADORES[websocket]["sala"]
            abandonar_minigames(websocket)
            if sala_atual and websocket in SALAS[sala_atual]:
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
    print("        SALA 33 — HUB DE EXECUÇÃO UNIFICADO (LAN ACTIVE)")
    print("=" * 65)

    print(f"» Salas registradas: {', '.join(SALAS.keys()) or '(nenhuma)'}")
    print(f"» Sala inicial: {SALA_INICIAL}")
    print("» Carregando mecânicas de servidor:")
    carregar_server_mods()

    ip_rede = pegar_ip_local()
    print("-" * 65)
    print(f"» Endereço IP Local: {ip_rede}")
    print(f"🌍 ACESSO AO SITE (HTTP)  : http://{ip_rede}:8000")
    print(f"⚡ REDE DO MULTIPLAYER (WS): ws://{ip_rede}:8080")
    print("=" * 65)

    asyncio.create_task(loop_minigames())
    threading.Thread(target=rodar_servidor_web_background, daemon=True).start()

    async with websockets.serve(handler, "0.0.0.0", PORT_WS):
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n» Servidor desligado.")
