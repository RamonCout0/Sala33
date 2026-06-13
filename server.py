# =====================================================
#   Sala33 — Servidor Principal v2
#
#   Arquitectura:
#     • HTTP estático + API REST + WebSocket na MESMA porta
#     • State authoritative: servidor é a única fonte de verdade
#     • Isolamento de sala por asyncio.Lock — zero state bleeding
#     • JWT para autenticação opcional (mantém modo convidado)
#     • Session logging async (fire-and-forget, nunca bloqueia o loop)
#     • WASM Physics em public/wasm/physics.wasm (executado no cliente)
# =====================================================
import asyncio
import json
import logging
import mimetypes
import os
import pkgutil
import importlib
import re
import socket
import threading
import time
import uuid
from http.server import SimpleHTTPRequestHandler
from socketserver import ThreadingTCPServer

import websockets
from websockets.http11 import Response
from websockets.datastructures import Headers as WsHeaders

# Suprime health-check noise do Railway
logging.getLogger("websockets.server").setLevel(logging.CRITICAL)
logging.getLogger("websockets.asyncio.server").setLevel(logging.CRITICAL)

# ──────────────────────────────────────────────────────────────
#   AMBIENTE
# ──────────────────────────────────────────────────────────────
ROOT_DIR      = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR    = os.path.join(ROOT_DIR, "public")
MODO_PRODUCAO = "PORT" in os.environ and "PORT_HTTP" not in os.environ
PORT_WS       = int(os.environ.get("PORT", 8080))
PORT_HTTP     = int(os.environ.get("PORT_HTTP", 8000))

# DB / Auth (imports opcionais — se não houver Postgres, roda sem)
try:
    import db as _db
    import auth as _auth
    DB_DISPONIVEL = True
except ImportError:
    DB_DISPONIVEL = False
    print("[AVISO] asyncpg/passlib não encontrados — modo sem banco de dados.")

# API REST
try:
    from api import handle_api
    API_DISPONIVEL = True
except ImportError:
    API_DISPONIVEL = False
    async def handle_api(*_): return None

# ──────────────────────────────────────────────────────────────
#   MANIFEST & CONFIG
# ──────────────────────────────────────────────────────────────
def _ler_json(path, fallback):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"[AVISO] {path}: {e}")
        return fallback

MANIFEST     = _ler_json(os.path.join(PUBLIC_DIR, "mods", "manifest.json"), {"salas": [], "salaInicial": "the_hub"})
SALA_INICIAL = MANIFEST.get("salaInicial", "the_hub")

SPRITES_VALIDOS = {"cinzaguy"}
for _p in _ler_json(os.path.join(PUBLIC_DIR, "mods", "personagens.json"), []):
    SPRITES_VALIDOS.add(_p.get("id", ""))

# ──────────────────────────────────────────────────────────────
#   CONSTANTES DE SEGURANÇA
# ──────────────────────────────────────────────────────────────
MAX_MSG_BYTES    = 2048
MAX_CHAT_LEN     = 200
MAX_USERNAME_LEN = 20
RATE_LIMIT_MSGS  = 30
RATE_LIMIT_WIN   = 1.0
USERNAME_RE      = re.compile(r"^[A-Za-z0-9_\- ]+$")
LADOS_VALIDOS    = {"esquerda", "direita"}


def _lado(v):     return v if v in LADOS_VALIDOS else "direita"
def _sprite(v):   return v if v in SPRITES_VALIDOS else "cinzaguy"
def _sanitize_username(v):
    v = str(v).strip()[:MAX_USERNAME_LEN].upper()
    return v if v and USERNAME_RE.match(v) else None


# ──────────────────────────────────────────────────────────────
#   STATE AUTHORITATIVE — único ponto de verdade
#
#   Resolve o bug de state bleeding:
#   sala_atual NUNCA é cacheada em variável local.
#   Toda leitura/escrita passa pelo dict de sessão, protegido por lock.
# ──────────────────────────────────────────────────────────────
class SessionState:
    """Estado completo de um jogador conectado."""
    __slots__ = (
        "sid", "ws", "queue",
        "user_id", "username", "sala",
        "x", "y", "sprite_id", "lado", "logado",
    )

    def __init__(self, ws):
        self.sid      = str(uuid.uuid4())
        self.ws       = ws
        self.queue    = asyncio.Queue(maxsize=256)
        self.user_id  = None
        self.username = "ANÔNIMO"
        self.sala     = None
        self.x        = 200.0
        self.y        = 150.0
        self.sprite_id = "cinzaguy"
        self.lado     = "direita"
        self.logado   = False

    def to_dict(self):
        return {
            "id":       self.sid,
            "username": self.username,
            "x":        self.x,
            "y":        self.y,
            "spriteId": self.sprite_id,
            "lado":     self.lado,
        }

    async def enviar(self, payload: dict):
        msg = json.dumps(payload)
        try:
            self.queue.put_nowait(msg)
        except asyncio.QueueFull:
            try:
                self.queue.get_nowait()
                self.queue.put_nowait(msg)
            except Exception:
                pass


class RoomHub:
    """
    Hub de conexões e roteamento por sala.
    Lock por operação de entrada/saída para garantir atomicidade.
    """

    def __init__(self, salas: list[str]):
        self._sessions: dict[str, SessionState] = {}
        self._salas: dict[str, set[str]]        = {s: set() for s in salas}
        self._lock = asyncio.Lock()

    # ── Sessões ──────────────────────────────────────────────
    async def registrar(self, session: SessionState):
        async with self._lock:
            self._sessions[session.sid] = session

    async def remover(self, sid: str) -> SessionState | None:
        async with self._lock:
            session = self._sessions.pop(sid, None)
            if session and session.sala and session.sala in self._salas:
                self._salas[session.sala].discard(sid)
            return session

    def get(self, sid: str) -> SessionState | None:
        return self._sessions.get(sid)

    def username_em_uso(self, username: str) -> bool:
        return any(
            s.logado and s.username == username
            for s in self._sessions.values()
        )

    def total_online(self) -> int:
        return sum(1 for s in self._sessions.values() if s.logado)

    # ── Salas ────────────────────────────────────────────────
    async def mover_para_sala(self, sid: str, nova_sala: str) -> bool:
        """Transição atômica entre salas. Retorna False se falhar."""
        async with self._lock:
            session = self._sessions.get(sid)
            if not session or nova_sala not in self._salas:
                return False
            sala_antiga = session.sala
            if sala_antiga and sala_antiga in self._salas:
                self._salas[sala_antiga].discard(sid)
            self._salas[nova_sala].add(sid)
            session.sala = nova_sala
            return True

    def sala_de(self, sid: str) -> str | None:
        """Lê a sala AGORA — nunca cacheia. Resolve state bleeding."""
        s = self._sessions.get(sid)
        return s.sala if s else None

    async def snapshot_sala(self, sala_id: str) -> list[SessionState]:
        """Snapshot atômico dos membros da sala."""
        async with self._lock:
            return [
                self._sessions[sid]
                for sid in self._salas.get(sala_id, set())
                if sid in self._sessions
            ]

    def salas_disponiveis(self) -> list[str]:
        return list(self._salas.keys())

    # ── Broadcast ────────────────────────────────────────────
    async def broadcast(self, sala_id: str, payload: dict, exceto: str | None = None):
        """
        Broadcast para todos na sala.
        Snapshot dentro do lock, envio fora — evita deadlock.
        """
        async with self._lock:
            destinos = [
                self._sessions[sid]
                for sid in self._salas.get(sala_id, set())
                if sid in self._sessions and sid != exceto
            ]
        for s in destinos:
            await s.enviar(payload)


# ──────────────────────────────────────────────────────────────
#   SERVER MODS (compatibilidade com server_mods/*.py)
# ──────────────────────────────────────────────────────────────
HANDLERS_POR_TIPO: dict = {}
MODS_COM_TICK:     list = []
MODS_COM_LEAVE:    list = []
MOD_SALA:          dict = {}

# Proxies que expõem a interface legada (dict de jogadores e set de salas)
# pra os mods antigos continuarem funcionando sem reescrita.
class _JogadoresProxy:
    def __init__(self, hub: "RoomHub"):
        self._hub = hub

    def _ws_to_session(self, ws) -> SessionState | None:
        for s in self._hub._sessions.values():
            if s.ws is ws:
                return s
        return None

    def __contains__(self, ws):
        return self._ws_to_session(ws) is not None

    def __getitem__(self, ws):
        s = self._ws_to_session(ws)
        if not s: raise KeyError(ws)
        return _SessionDictProxy(s)

    def get(self, ws, default=None):
        s = self._ws_to_session(ws)
        return _SessionDictProxy(s) if s else default

    def values(self):
        return [_SessionDictProxy(s) for s in self._hub._sessions.values()]


class _SessionDictProxy:
    _MAP = {"username": "username", "sala": "sala", "x": "x", "y": "y",
            "spriteId": "sprite_id", "lado": "lado", "logado": "logado"}

    def __init__(self, session: SessionState):
        self._s = session

    def __getitem__(self, k):
        if k == "queue": return self._s.queue
        attr = self._MAP.get(k)
        if attr: return getattr(self._s, attr)
        raise KeyError(k)

    def __setitem__(self, k, v):
        attr = self._MAP.get(k)
        if attr: setattr(self._s, attr, v)

    def get(self, k, d=None):
        try: return self[k]
        except KeyError: return d


class _SalasProxy:
    def __init__(self, hub: "RoomHub"):
        self._hub = hub

    def __contains__(self, sala): return sala in self._hub._salas

    def __getitem__(self, sala):
        return {self._hub._sessions[sid].ws
                for sid in self._hub._salas.get(sala, set())
                if sid in self._hub._sessions}

    def get(self, sala, d=None):
        return self[sala] if sala in self._hub._salas else d

    def keys(self): return self._hub._salas.keys()


def carregar_server_mods():
    try:
        import server_mods
    except ImportError:
        return
    for _, mod_name, _ in pkgutil.iter_modules(server_mods.__path__):
        try:
            mod = importlib.import_module(f"server_mods.{mod_name}")
            if hasattr(mod, "HANDLES") and hasattr(mod, "handle"):
                sala_esp = getattr(mod, "SALA", None)
                for tipo in mod.HANDLES:
                    HANDLERS_POR_TIPO[tipo] = mod
                    if sala_esp: MOD_SALA[tipo] = sala_esp
                print(f"  ✓ server_mods.{mod_name}  →  {mod.HANDLES}")
            if hasattr(mod, "tick"):   MODS_COM_TICK.append(mod)
            if hasattr(mod, "on_leave"): MODS_COM_LEAVE.append(mod)
        except Exception as e:
            print(f"  ✗ server_mods.{mod_name}  →  {e}")


# ──────────────────────────────────────────────────────────────
#   RATE LIMITER
# ──────────────────────────────────────────────────────────────
class RateLimiter:
    __slots__ = ("_max", "_win", "_ts")
    def __init__(self, max_msgs=RATE_LIMIT_MSGS, win=RATE_LIMIT_WIN):
        self._max = max_msgs; self._win = win; self._ts = []

    def permitir(self) -> bool:
        agora = time.monotonic()
        self._ts = [t for t in self._ts if agora - t < self._win]
        if len(self._ts) >= self._max: return False
        self._ts.append(agora); return True


# ──────────────────────────────────────────────────────────────
#   LOOPS DE FUNDO
# ──────────────────────────────────────────────────────────────
async def loop_minigames(hub: "RoomHub"):
    jogadores_p = _JogadoresProxy(hub)
    salas_p     = _SalasProxy(hub)

    async def _enviar_para_sala(sala, payload):
        await hub.broadcast(sala, payload)

    while True:
        await asyncio.sleep(1 / 60)
        for mod in MODS_COM_TICK:
            try:
                await mod.tick(jogadores_p, salas_p, _enviar_para_sala)
            except Exception as e:
                print(f"[tick:{getattr(mod,'__name__','')}] {e}")


# ──────────────────────────────────────────────────────────────
#   HANDLER PRINCIPAL
# ──────────────────────────────────────────────────────────────
async def escritor(session: SessionState):
    """Drena a queue de mensagens pro socket."""
    try:
        while True:
            msg = await session.queue.get()
            await session.ws.send(msg)
            session.queue.task_done()
    except (websockets.exceptions.ConnectionClosed, asyncio.CancelledError):
        pass


async def handler_ws(websocket, hub: "RoomHub"):
    session = SessionState(websocket)
    await hub.registrar(session)
    rate    = RateLimiter()
    escrita = asyncio.create_task(escritor(session))

    # Proxies pra compatibilidade com mods legados
    jogadores_p = _JogadoresProxy(hub)
    salas_p     = _SalasProxy(hub)

    async def _broadcast_mod(sala, payload):
        await hub.broadcast(sala, payload)

    try:
        async for message in websocket:
            if len(message) > MAX_MSG_BYTES or not rate.permitir():
                continue
            try:
                dados = json.loads(message)
            except Exception:
                continue
            if not isinstance(dados, dict):
                continue

            tipo = dados.get("tipo")
            if not isinstance(tipo, str):
                continue

            # ── LOGIN ──────────────────────────────────────────
            if tipo == "login":
                if session.logado:
                    continue

                # Modo autenticado via JWT
                token = dados.get("token")
                if token and DB_DISPONIVEL:
                    payload = _auth.validar_token(token)
                    if not payload:
                        await session.enviar({"tipo": "erro_login", "mensagem": "Token inválido."})
                        continue
                    username = payload["username"]
                    user_id  = int(payload["sub"])
                else:
                    # Modo convidado
                    raw = dados.get("username", "")
                    username = _sanitize_username(raw)
                    if not username:
                        await session.enviar({"tipo": "erro_login", "mensagem": "Nome inválido. Use letras, números, _ e -."})
                        continue
                    user_id = None

                if hub.username_em_uso(username):
                    await session.enviar({"tipo": "erro_login", "mensagem": f"'{username}' já está em uso."})
                    continue

                session.username  = username
                session.sprite_id = _sprite(dados.get("spriteId", "cinzaguy"))
                session.lado      = _lado(dados.get("lado", "direita"))
                session.user_id   = user_id
                session.logado    = True

                # Move pra sala inicial (atômico)
                ok = await hub.mover_para_sala(session.sid, SALA_INICIAL)
                if ok:
                    outros = [s.to_dict() for s in await hub.snapshot_sala(SALA_INICIAL)
                              if s.sid != session.sid]
                    await session.enviar({
                        "tipo": "lista_jogadores",
                        "meu_sid": session.sid,   # cliente usa pra se identificar
                        "jogadores": outros,
                    })
                    await hub.broadcast(SALA_INICIAL,
                        {"tipo": "novo_jogador", **session.to_dict()},
                        exceto=session.sid)

                    if DB_DISPONIVEL:
                        _db.log_action(user_id, username, "join", SALA_INICIAL)

                continue

            # ── Rejeita não-logados ────────────────────────────
            if not session.logado:
                continue

            # ── MOVER ─────────────────────────────────────────
            if tipo == "mover":
                # Lê sala AGORA — nunca de variável local (anti-bleeding)
                sala = hub.sala_de(session.sid)
                if not sala: continue
                x = dados.get("x"); y = dados.get("y")
                if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
                    continue
                session.x    = max(0.0, min(368.0, float(x)))
                session.y    = max(0.0, min(268.0, float(y)))
                session.lado = _lado(dados.get("lado", session.lado))
                await hub.broadcast(sala, {
                    "tipo": "movimento", "id": session.sid,
                    "x": session.x, "y": session.y, "lado": session.lado,
                }, exceto=session.sid)

            # ── MUDAR SALA ────────────────────────────────────
            elif tipo == "mudar_sala":
                nova_sala = dados.get("nova_sala")
                if not isinstance(nova_sala, str) or nova_sala not in hub.salas_disponiveis():
                    continue

                sala_antiga = hub.sala_de(session.sid)
                x = dados.get("x", 200); y = dados.get("y", 150)
                if isinstance(x, (int, float)): session.x = max(0.0, min(368.0, float(x)))
                if isinstance(y, (int, float)): session.y = max(0.0, min(268.0, float(y)))

                # Notifica abandono dos mods da sala antiga
                if sala_antiga:
                    for mod in MODS_COM_LEAVE:
                        try: mod.on_leave(websocket, jogadores_p)
                        except Exception: pass

                ok = await hub.mover_para_sala(session.sid, nova_sala)
                if not ok: continue

                if sala_antiga:
                    await hub.broadcast(sala_antiga, {"tipo": "jogador_saiu", "id": session.sid})

                outros = [s.to_dict() for s in await hub.snapshot_sala(nova_sala)
                          if s.sid != session.sid]
                await session.enviar({"tipo": "lista_jogadores", "jogadores": outros})
                await hub.broadcast(nova_sala,
                    {"tipo": "novo_jogador", **session.to_dict()},
                    exceto=session.sid)

                if DB_DISPONIVEL:
                    _db.log_action(session.user_id, session.username, "change_room", nova_sala)

            # ── CHAT ──────────────────────────────────────────
            elif tipo == "chat":
                sala = hub.sala_de(session.sid)
                if not sala: continue
                texto = dados.get("texto", "")
                if not isinstance(texto, str): continue
                texto = texto.strip()[:MAX_CHAT_LEN]
                if not texto: continue
                await hub.broadcast(sala, {
                    "tipo": "chat",
                    "username": session.username,
                    "texto": texto,
                })

            # ── DIGITANDO ─────────────────────────────────────
            elif tipo == "digitando":
                sala = hub.sala_de(session.sid)
                if not sala: continue
                estado = dados.get("estado")
                if not isinstance(estado, bool): continue
                await hub.broadcast(sala, {
                    "tipo": "jogador_digitando",
                    "id": session.sid,
                    "estado": estado,
                }, exceto=session.sid)

            # ── SERVER MODS (compatibilidade legada) ──────────
            elif tipo in HANDLERS_POR_TIPO:
                sala = hub.sala_de(session.sid)
                sala_esp = MOD_SALA.get(tipo)
                if sala_esp and sala != sala_esp: continue
                try:
                    await HANDLERS_POR_TIPO[tipo].handle(
                        tipo, websocket, dados,
                        jogadores_p, salas_p, _broadcast_mod,
                    )
                except Exception as e:
                    print(f"[mod:{tipo}] {e}")

    except websockets.exceptions.ConnectionClosed:
        pass
    except Exception as e:
        print(f"[handler] erro inesperado: {e}")
    finally:
        escrita.cancel()
        sala = hub.sala_de(session.sid)

        for mod in MODS_COM_LEAVE:
            try: mod.on_leave(websocket, jogadores_p)
            except Exception: pass

        await hub.remover(session.sid)

        if sala:
            await hub.broadcast(sala, {
                "tipo": "debug_event",
                "categoria": "leave",
                "mensagem": f"{session.username} saiu.",
            })
            await hub.broadcast(sala, {"tipo": "jogador_saiu", "id": session.sid})

        if DB_DISPONIVEL and session.logado:
            _db.log_action(session.user_id, session.username, "disconnect", sala)


# ──────────────────────────────────────────────────────────────
#   SERVIDOR HTTP (porta única em produção)
# ──────────────────────────────────────────────────────────────
CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js":   "application/javascript",
    ".json": "application/json",
    ".css":  "text/css",
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
    ".gif":  "image/gif",
    ".mp4":  "video/mp4",
    ".webm": "video/webm",
    ".mp3":  "audio/mpeg",
    ".ogg":  "audio/ogg",
    ".ico":  "image/x-icon",
    ".wasm": "application/wasm",
    ".txt":  "text/plain",
}
SEM_CACHE = {".js", ".json"}


def _fazer_process_request():
    """Cria a função process_request com os contextos necessários."""

    async def process_request(connection, request):
        # WebSocket upgrade → deixa o websockets tratar
        if request.headers.get("Upgrade", "").lower() == "websocket":
            return None

        method   = getattr(request, "method", "GET")
        url_path = request.path

        # ── API REST ──────────────────────────────────────────
        if url_path.startswith("/api/") and API_DISPONIVEL:
            try:
                result = await handle_api(method, url_path, request)
                if result is not None:
                    status, headers, body = result
                    return Response(status, _http_reason(status), WsHeaders(headers), body)
            except Exception as e:
                body = json.dumps({"error": str(e)}).encode()
                return Response(500, "Internal Server Error",
                    WsHeaders([("Content-Type", "application/json"), ("Content-Length", str(len(body)))]), body)

        # ── Arquivos estáticos ────────────────────────────────
        path = url_path.split("?")[0]
        if path == "/": path = "/index.html"
        file_path = os.path.realpath(os.path.join(PUBLIC_DIR, path.lstrip("/")))

        # Path traversal protection
        if not file_path.startswith(os.path.realpath(PUBLIC_DIR)):
            body = b"Forbidden"
            return Response(403, "Forbidden", WsHeaders([("Content-Length", "9")]), body)

        if not os.path.isfile(file_path):
            body = b"Not Found"
            return Response(404, "Not Found", WsHeaders([("Content-Length", "9")]), body)

        with open(file_path, "rb") as f:
            body = f.read()

        ext     = os.path.splitext(file_path)[1].lower()
        ct      = CONTENT_TYPES.get(ext, "application/octet-stream")
        headers = [
            ("Content-Type", ct),
            ("Content-Length", str(len(body))),
            ("X-Content-Type-Options", "nosniff"),
            ("X-Frame-Options", "DENY"),
        ]
        if ext in SEM_CACHE:
            headers.append(("Cache-Control", "no-cache, no-store, must-revalidate"))
        if ext == ".wasm":
            headers.append(("Cross-Origin-Opener-Policy", "same-origin"))
            headers.append(("Cross-Origin-Embedder-Policy", "require-corp"))

        return Response(200, "OK", WsHeaders(headers), body)

    return process_request


def _http_reason(status: int) -> str:
    return {200: "OK", 201: "Created", 204: "No Content",
            400: "Bad Request", 401: "Unauthorized", 403: "Forbidden",
            404: "Not Found", 409: "Conflict", 500: "Internal Server Error"}.get(status, "Unknown")


# ──────────────────────────────────────────────────────────────
#   HTTP THREAD (dev local apenas)
# ──────────────────────────────────────────────────────────────
def rodar_http_background():
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=PUBLIC_DIR, **kw)
        def log_message(self, *a): pass
        def end_headers(self):
            p = self.path.split("?")[0]
            if p.endswith((".js", ".json")):
                self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("X-Content-Type-Options", "nosniff")
            if p.endswith(".wasm"):
                self.send_header("Cross-Origin-Opener-Policy", "same-origin")
                self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
            super().end_headers()

    class Server(ThreadingTCPServer):
        allow_reuse_address = True
        daemon_threads = True
        def handle_error(self, *a): pass

    try:
        with Server(("", PORT_HTTP), Handler) as s:
            s.serve_forever()
    except Exception: pass


def _ip_local():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80)); return s.getsockname()[0]
    except Exception: return "127.0.0.1"
    finally: s.close()


# ──────────────────────────────────────────────────────────────
#   MAIN
# ──────────────────────────────────────────────────────────────
async def main():
    global DB_DISPONIVEL

    # Banco de dados — testa conexão antes de confirmar
    if DB_DISPONIVEL:
        try:
            await _db.init_db()
            asyncio.create_task(_db._log_writer())
        except Exception as e:
            print(f"[db] PostgreSQL indisponível: {e}")
            DB_DISPONIVEL = False  # desativa pra não tentar mais

    hub = RoomHub(MANIFEST.get("salas", []))
    carregar_server_mods()

    print("=" * 65)
    print("        SALA 33 — SERVER v2")
    print("=" * 65)
    print(f"» Modo:    {'PRODUÇÃO (porta única)' if MODO_PRODUCAO else 'LOCAL (duas portas)'}")
    print(f"» Banco:   {'PostgreSQL ativo' if DB_DISPONIVEL else 'desabilitado (sem asyncpg)'}")
    print(f"» API:     {'ativa em /api/*' if API_DISPONIVEL else 'desabilitada'}")
    print(f"» Salas:   {', '.join(hub.salas_disponiveis())}")
    print(f"» Sprites: {', '.join(sorted(SPRITES_VALIDOS))}")
    if not MODO_PRODUCAO:
        ip = _ip_local()
        print(f"» HTTP:    http://{ip}:{PORT_HTTP}")
        print(f"» WS:      ws://{ip}:{PORT_WS}")
    else:
        print(f"» Porta:   {PORT_WS}")
    print("=" * 65)

    asyncio.create_task(loop_minigames(hub))

    ws_kwargs = dict(
        max_size=MAX_MSG_BYTES,
        max_queue=64,
        ping_interval=30,
        ping_timeout=10,
    )

    def _make_handler(h):
        async def _h(ws): await handler_ws(ws, h)
        return _h

    if MODO_PRODUCAO:
        async with websockets.serve(
            _make_handler(hub), "0.0.0.0", PORT_WS,
            process_request=_fazer_process_request(),
            **ws_kwargs,
        ):
            await asyncio.Future()
    else:
        threading.Thread(target=rodar_http_background, daemon=True).start()
        async with websockets.serve(
            _make_handler(hub), "0.0.0.0", PORT_WS,
            **ws_kwargs,
        ):
            await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n» Servidor desligado.")
