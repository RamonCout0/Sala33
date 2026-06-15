# =====================================================
#   Sala33 — Servidor Único (v2.1)
#
#   TUDO num arquivo só:
#     • HTTP estático + WebSocket na mesma porta
#     • State authoritative (anti state-bleeding via lock)
#     • Banco Postgres OPCIONAL e 100% não-bloqueante
#       (se cair, o jogo continua normal em modo convidado)
#     • Auth (registro/login) via WebSocket, não REST
#     • Session logging fire-and-forget
#
#   Filosofia: o banco NUNCA fica no caminho crítico do jogo.
#   Movimento, chat e salas funcionam mesmo sem Postgres.
# =====================================================
import asyncio
import json
import logging
import os
import pkgutil
import importlib
import re
import socket
import threading
import time
import uuid
import hashlib
import hmac
import base64
from http.server import SimpleHTTPRequestHandler
from socketserver import ThreadingTCPServer

import websockets
from websockets.http11 import Response
from websockets.datastructures import Headers as WsHeaders

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
DATABASE_URL  = os.environ.get("DATABASE_URL", "")
JWT_SECRET    = os.environ.get("JWT_SECRET", "sala33-dev-secret-troque-em-prod")

# ──────────────────────────────────────────────────────────────
#   BANCO DE DADOS — opcional, isolado, não-bloqueante
# ──────────────────────────────────────────────────────────────
class Banco:
    def __init__(self):
        self.pool = None
        self.ativo = False
        self._log_queue = asyncio.Queue(maxsize=2000)

    async def conectar(self):
        if not DATABASE_URL:
            print("[db] DATABASE_URL não definida — modo sem banco (convidado apenas).")
            return
        try:
            import asyncpg
        except ImportError:
            print("[db] asyncpg não instalado — modo sem banco.")
            return
        try:
            url = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")
            self.pool = await asyncio.wait_for(
                asyncpg.create_pool(url, min_size=1, max_size=8, command_timeout=8),
                timeout=10,
            )
            await self._criar_tabelas()
            self.ativo = True
            asyncio.create_task(self._log_worker())
            print("[db] PostgreSQL conectado ✓")
        except Exception as e:
            print(f"[db] Indisponível ({type(e).__name__}) — modo sem banco.")
            self.pool = None
            self.ativo = False

    async def _criar_tabelas(self):
        async with self.pool.acquire() as c:
            await c.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    username VARCHAR(20) UNIQUE NOT NULL,
                    password_hash VARCHAR(200) NOT NULL,
                    sprite_id VARCHAR(40) DEFAULT 'cinzaguy',
                    bio TEXT DEFAULT '',
                    email VARCHAR(120) DEFAULT '',
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
                ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(120) DEFAULT '';
                CREATE TABLE IF NOT EXISTS password_resets (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    token VARCHAR(80) NOT NULL,
                    expires_at TIMESTAMPTZ NOT NULL,
                    usado BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS room_likes (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    room_id VARCHAR(60) NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    UNIQUE(user_id, room_id)
                );
                CREATE TABLE IF NOT EXISTS friendships (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    friend_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    UNIQUE(user_id, friend_id)
                );
                CREATE TABLE IF NOT EXISTS friend_requests (
                    id SERIAL PRIMARY KEY,
                    from_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    to_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    UNIQUE(from_id, to_id)
                );
                CREATE TABLE IF NOT EXISTS favorite_rooms (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    room_id VARCHAR(60) NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    UNIQUE(user_id, room_id)
                );
                CREATE TABLE IF NOT EXISTS session_logs (
                    id BIGSERIAL PRIMARY KEY,
                    user_id INTEGER,
                    username VARCHAR(20),
                    action VARCHAR(30) NOT NULL,
                    room_id VARCHAR(60),
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_friend_user ON friendships(user_id);
                CREATE INDEX IF NOT EXISTS idx_fav_user ON favorite_rooms(user_id);
                CREATE INDEX IF NOT EXISTS idx_req_to ON friend_requests(to_id);
                CREATE INDEX IF NOT EXISTS idx_req_from ON friend_requests(from_id);
                CREATE INDEX IF NOT EXISTS idx_like_room ON room_likes(room_id);
                CREATE INDEX IF NOT EXISTS idx_reset_token ON password_resets(token);
            """)

    # ---- Auth ----
    async def criar_usuario(self, username, password_hash, email=""):
        if not self.ativo: return None
        try:
            row = await self.pool.fetchrow(
                "INSERT INTO users(username,password_hash,email) VALUES($1,$2,$3) "
                "RETURNING id,username,sprite_id,bio,email",
                username, password_hash, email or "")
            return dict(row) if row else None
        except Exception:
            return None

    async def buscar_usuario(self, username):
        if not self.ativo: return None
        try:
            row = await self.pool.fetchrow(
                "SELECT id,username,password_hash,sprite_id,bio,email FROM users WHERE username=$1",
                username)
            return dict(row) if row else None
        except Exception:
            return None

    async def atualizar_perfil(self, user_id, sprite_id, bio):
        if not self.ativo: return None
        try:
            row = await self.pool.fetchrow(
                "UPDATE users SET sprite_id=COALESCE($2,sprite_id), bio=COALESCE($3,bio) "
                "WHERE id=$1 RETURNING id,username,sprite_id,bio",
                user_id, sprite_id, bio)
            return dict(row) if row else None
        except Exception:
            return None

    # ---- Amigos ----
    async def listar_amigos(self, user_id):
        if not self.ativo: return []
        try:
            rows = await self.pool.fetch(
                "SELECT u.id,u.username,u.sprite_id FROM friendships f "
                "JOIN users u ON u.id=f.friend_id WHERE f.user_id=$1 ORDER BY u.username",
                user_id)
            return [dict(r) for r in rows]
        except Exception:
            return []

    async def sao_amigos(self, user_id, other_id):
        if not self.ativo: return False
        try:
            r = await self.pool.fetchval(
                "SELECT 1 FROM friendships WHERE user_id=$1 AND friend_id=$2", user_id, other_id)
            return bool(r)
        except Exception:
            return False

    async def criar_pedido_amizade(self, from_id, to_username):
        if not self.ativo: return None
        try:
            alvo = await self.buscar_usuario(to_username)
            if not alvo: return "inexistente"
            if alvo["id"] == from_id: return "self"
            if await self.sao_amigos(from_id, alvo["id"]): return "ja_amigos"
            reverso = await self.pool.fetchval(
                "SELECT 1 FROM friend_requests WHERE from_id=$1 AND to_id=$2",
                alvo["id"], from_id)
            if reverso:
                await self.aceitar_pedido(from_id, alvo["id"])
                return "aceito_mutuo"
            await self.pool.execute(
                "INSERT INTO friend_requests(from_id,to_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
                from_id, alvo["id"])
            return {"id": alvo["id"], "username": alvo["username"], "sprite_id": alvo["sprite_id"]}
        except Exception:
            return None

    async def listar_pedidos_recebidos(self, user_id):
        if not self.ativo: return []
        try:
            rows = await self.pool.fetch(
                "SELECT u.id,u.username,u.sprite_id FROM friend_requests r "
                "JOIN users u ON u.id=r.from_id WHERE r.to_id=$1 ORDER BY r.created_at DESC",
                user_id)
            return [dict(r) for r in rows]
        except Exception:
            return []

    async def aceitar_pedido(self, user_id, from_id):
        if not self.ativo: return False
        try:
            existe = await self.pool.fetchval(
                "SELECT 1 FROM friend_requests WHERE from_id=$1 AND to_id=$2", from_id, user_id)
            if not existe: return False
            async with self.pool.acquire() as c:
                async with c.transaction():
                    await c.execute(
                        "INSERT INTO friendships(user_id,friend_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
                        user_id, from_id)
                    await c.execute(
                        "INSERT INTO friendships(user_id,friend_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
                        from_id, user_id)
                    await c.execute(
                        "DELETE FROM friend_requests WHERE (from_id=$1 AND to_id=$2) OR (from_id=$2 AND to_id=$1)",
                        from_id, user_id)
            return True
        except Exception:
            return False

    async def recusar_pedido(self, user_id, from_id):
        if not self.ativo: return False
        try:
            await self.pool.execute(
                "DELETE FROM friend_requests WHERE from_id=$1 AND to_id=$2", from_id, user_id)
            return True
        except Exception:
            return False

    async def remover_amigo(self, user_id, friend_id):
        if not self.ativo: return False
        try:
            await self.pool.execute(
                "DELETE FROM friendships WHERE (user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)",
                user_id, friend_id)
            return True
        except Exception:
            return False

    # ---- Favoritos ----
    async def listar_favoritos(self, user_id):
        if not self.ativo: return []
        try:
            rows = await self.pool.fetch(
                "SELECT room_id FROM favorite_rooms WHERE user_id=$1 ORDER BY created_at DESC", user_id)
            return [r["room_id"] for r in rows]
        except Exception:
            return []

    async def toggle_favorito(self, user_id, room_id):
        if not self.ativo: return None
        try:
            existe = await self.pool.fetchval(
                "SELECT 1 FROM favorite_rooms WHERE user_id=$1 AND room_id=$2", user_id, room_id)
            if existe:
                await self.pool.execute(
                    "DELETE FROM favorite_rooms WHERE user_id=$1 AND room_id=$2", user_id, room_id)
                return False
            else:
                await self.pool.execute(
                    "INSERT INTO favorite_rooms(user_id,room_id) VALUES($1,$2)", user_id, room_id)
                return True
        except Exception:
            return None

    # ---- Reset de senha ----
    async def criar_token_reset(self, username):
        if not self.ativo: return (None, None)
        try:
            user = await self.buscar_usuario(username)
            if not user:
                return (None, None)
            token = base64.urlsafe_b64encode(os.urandom(32)).rstrip(b"=").decode()
            await self.pool.execute(
                "INSERT INTO password_resets(user_id, token, expires_at) "
                "VALUES($1, $2, NOW() + INTERVAL '1 hour')",
                user["id"], token)
            return (user, token)
        except Exception:
            return (None, None)

    async def validar_token_reset(self, token):
        if not self.ativo: return None
        try:
            row = await self.pool.fetchrow(
                "SELECT user_id FROM password_resets "
                "WHERE token=$1 AND usado=FALSE AND expires_at > NOW()", token)
            return row["user_id"] if row else None
        except Exception:
            return None

    async def aplicar_reset(self, token, novo_hash):
        if not self.ativo: return False
        try:
            user_id = await self.validar_token_reset(token)
            if not user_id:
                return False
            async with self.pool.acquire() as c:
                async with c.transaction():
                    await c.execute(
                        "UPDATE users SET password_hash=$2 WHERE id=$1", user_id, novo_hash)
                    await c.execute(
                        "UPDATE password_resets SET usado=TRUE WHERE token=$1", token)
            return True
        except Exception:
            return False

    # ---- Likes de sala ----
    async def contar_likes(self, room_id):
        if not self.ativo: return 0
        try:
            n = await self.pool.fetchval(
                "SELECT COUNT(*) FROM room_likes WHERE room_id=$1", room_id)
            return int(n or 0)
        except Exception:
            return 0

    async def usuario_curtiu(self, user_id, room_id):
        if not self.ativo: return False
        try:
            r = await self.pool.fetchval(
                "SELECT 1 FROM room_likes WHERE user_id=$1 AND room_id=$2", user_id, room_id)
            return bool(r)
        except Exception:
            return False

    async def toggle_like(self, user_id, room_id):
        if not self.ativo: return (None, 0)
        try:
            existe = await self.pool.fetchval(
                "SELECT 1 FROM room_likes WHERE user_id=$1 AND room_id=$2", user_id, room_id)
            if existe:
                await self.pool.execute(
                    "DELETE FROM room_likes WHERE user_id=$1 AND room_id=$2", user_id, room_id)
                curtiu = False
            else:
                await self.pool.execute(
                    "INSERT INTO room_likes(user_id,room_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
                    user_id, room_id)
                curtiu = True
            total = await self.contar_likes(room_id)
            return (curtiu, total)
        except Exception:
            return (None, 0)

    # ---- Logs (fire-and-forget) ----
    def log(self, user_id, username, action, room_id=None):
        if not self.ativo: return
        try:
            self._log_queue.put_nowait((user_id, username, action, room_id))
        except asyncio.QueueFull:
            pass

    async def _log_worker(self):
        while True:
            try:
                batch = [await self._log_queue.get()]
                while not self._log_queue.empty() and len(batch) < 50:
                    batch.append(self._log_queue.get_nowait())
                await self.pool.executemany(
                    "INSERT INTO session_logs(user_id,username,action,room_id) VALUES($1,$2,$3,$4)",
                    batch)
            except Exception:
                await asyncio.sleep(2)


banco = Banco()


# ──────────────────────────────────────────────────────────────
#   JWT mínimo (sem dependência externa — usa hmac/sha256)
# ──────────────────────────────────────────────────────────────
def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

def _b64url_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)

def gerar_token(user_id: int, username: str) -> str:
    header = _b64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    exp = int(time.time()) + 60 * 60 * 24 * 7  # 1 semana
    payload = _b64url(json.dumps({"sub": user_id, "username": username, "exp": exp}).encode())
    msg = f"{header}.{payload}"
    sig = hmac.new(JWT_SECRET.encode(), msg.encode(), hashlib.sha256).digest()
    return f"{msg}.{_b64url(sig)}"

def validar_token(token: str):
    try:
        header, payload, sig = token.split(".")
        msg = f"{header}.{payload}"
        esperado = _b64url(hmac.new(JWT_SECRET.encode(), msg.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, esperado):
            return None
        dados = json.loads(_b64url_decode(payload))
        if dados.get("exp", 0) < time.time():
            return None
        return dados
    except Exception:
        return None


# ──────────────────────────────────────────────────────────────
#   Hash de senha (PBKDF2 — stdlib, sem bcrypt/passlib)
# ──────────────────────────────────────────────────────────────
def hash_senha(senha: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", senha.encode(), salt, 100_000)
    return f"{base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"

def verificar_senha(senha: str, stored: str) -> bool:
    try:
        salt_b64, dk_b64 = stored.split("$")
        salt = base64.b64decode(salt_b64)
        dk = base64.b64decode(dk_b64)
        novo = hashlib.pbkdf2_hmac("sha256", senha.encode(), salt, 100_000)
        return hmac.compare_digest(novo, dk)
    except Exception:
        return False


# ──────────────────────────────────────────────────────────────
#   ENVIO DE EMAIL DE RESET — Gmail SMTP em thread separada
# ──────────────────────────────────────────────────────────────
SMTP_ATIVO = bool(os.environ.get("SMTP_USER") and os.environ.get("SMTP_PASS"))

def _enviar_email_reset_thread(email: str, username: str, token: str):
    """Executa o envio SMTP em thread separada — não bloqueia o loop de jogo."""
    link = f"https://sala33.app.br/?reset={token}"
    try:
        import smtplib
        from email.message import EmailMessage
        msg = EmailMessage()
        msg["Subject"] = "Recuperação de senha — Sala 33"
        msg["From"] = os.environ.get("SMTP_FROM", os.environ["SMTP_USER"])
        msg["To"] = email
        msg.set_content(
            f"Olá, {username}!\n\nVocê pediu pra redefinir sua senha na Sala 33.\n"
            f"Use o link abaixo (válido por 1 hora):\n\n{link}\n\n"
            f"Se não foi você, ignore este email.")
        with smtplib.SMTP_SSL("smtp.gmail.com", 587) as srv:
            srv.starttls()
            srv.login(os.environ["SMTP_USER"], os.environ["SMTP_PASS"])
            srv.send_message(msg)
        print(f"[reset] email enviado para {username} <{email}>")
    except Exception as e:
        print(f"[reset] falha ao enviar email: {e}")

def enviar_email_reset(email: str, username: str, token: str) -> bool:
    """Dispara o envio em background (fire-and-forget). Retorna imediatamente."""
    link = f"https://sala33.app.br/?reset={token}"
    if not SMTP_ATIVO:
        print(f"[reset] (email desativado) {username} <{email or 'sem email'}> → {link}")
        return False
    if not email:
        print(f"[reset] usuário {username} não tem email cadastrado")
        return False
    threading.Thread(target=_enviar_email_reset_thread, args=(email, username, token), daemon=True).start()
    return True


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
    if _p.get("id"):
        SPRITES_VALIDOS.add(_p["id"])

# ──────────────────────────────────────────────────────────────
#   SEGURANÇA / CONSTANTES
# ──────────────────────────────────────────────────────────────
MAX_MSG_BYTES    = 2048
MAX_CHAT_LEN     = 200
MAX_USERNAME_LEN = 16
RATE_LIMIT_MSGS  = 30
RATE_LIMIT_WIN   = 1.0
MOVE_RATE_LIMIT  = 0.05
MOVE_EPSILON     = 0.50
USERNAME_RE      = re.compile(r"^[A-Za-z0-9_\- ]+$")
EMAIL_RE         = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
LADOS_VALIDOS    = {"esquerda", "direita"}

def _lado(v):   return v if v in LADOS_VALIDOS else "direita"
def _sprite(v): return v if v in SPRITES_VALIDOS else "cinzaguy"
def _sanitize_username(v):
    v = str(v).strip()[:MAX_USERNAME_LEN].upper()
    return v if v and USERNAME_RE.match(v) else None
def _sanitize_email(v):
    v = str(v or "").strip()[:120]
    return v if v and EMAIL_RE.match(v) else None


# ──────────────────────────────────────────────────────────────
#   STATE AUTHORITATIVE
# ──────────────────────────────────────────────────────────────
class Sessao:
    __slots__ = (
        "sid", "ws", "queue", "user_id", "username", "sala",
        "x", "y", "sprite_id", "lado", "logado",
        "last_move", "last_broadcast_x", "last_broadcast_y",
    )

    def __init__(self, ws):
        self.sid      = str(uuid.uuid4())
        self.ws       = ws
        self.queue    = asyncio.Queue(maxsize=64)
        self.last_move = 0.0
        self.x        = 200.0
        self.y        = 150.0
        self.last_broadcast_x = self.x
        self.last_broadcast_y = self.y
        self.user_id  = None
        self.username = "ANÔNIMO"
        self.sala     = None
        self.sprite_id = "cinzaguy"
        self.lado     = "direita"
        self.logado   = False

    def to_dict(self):
        return {"id": self.sid, "username": self.username,
                "x": self.x, "y": self.y, "spriteId": self.sprite_id, "lado": self.lado}

    async def enviar(self, payload):
        try:
            self.queue.put_nowait(json.dumps(payload))
        except asyncio.QueueFull:
            try:
                self.queue.get_nowait()
                self.queue.put_nowait(json.dumps(payload))
            except Exception:
                pass


class Hub:
    def __init__(self, salas):
        self._sessions = {}
        self._salas = {s: set() for s in salas}
        self._lock = asyncio.Lock()

    async def registrar(self, s):
        async with self._lock:
            self._sessions[s.sid] = s

    async def remover(self, sid):
        async with self._lock:
            s = self._sessions.pop(sid, None)
            if s and s.sala and s.sala in self._salas:
                self._salas[s.sala].discard(sid)
            return s

    def username_em_uso(self, username):
        return any(s.logado and s.username == username for s in self._sessions.values())

    def sessoes_do_usuario(self, user_id):
        if user_id is None:
            return []
        return [s for s in self._sessions.values() if s.user_id == user_id and s.logado]

    def usuarios_online_ids(self):
        return {s.user_id for s in self._sessions.values() if s.user_id and s.logado}

    async def mover_para_sala(self, sid, nova_sala):
        async with self._lock:
            s = self._sessions.get(sid)
            if not s or nova_sala not in self._salas:
                return False
            if s.sala and s.sala in self._salas:
                self._salas[s.sala].discard(sid)
            self._salas[nova_sala].add(sid)
            s.sala = nova_sala
            return True

    def sala_de(self, sid):
        s = self._sessions.get(sid)
        return s.sala if s else None

    async def snapshot_sala(self, sala_id):
        async with self._lock:
            return [self._sessions[sid] for sid in self._salas.get(sala_id, set())
                    if sid in self._sessions]

    def salas_disponiveis(self):
        return list(self._salas.keys())

    async def broadcast(self, sala_id, payload, exceto=None):
        async with self._lock:
            destinos = [self._sessions[sid] for sid in self._salas.get(sala_id, set())
                        if sid in self._sessions and sid != exceto]
        if destinos:
            await asyncio.gather(
                *(s.enviar(payload) for s in destinos),
                return_exceptions=True
            )


# ──────────────────────────────────────────────────────────────
#   SERVER MODS
# ──────────────────────────────────────────────────────────────
HANDLERS_POR_TIPO, MODS_COM_TICK, MODS_COM_LEAVE, MOD_SALA = {}, [], [], {}

class _JogProxy:
    def __init__(self, hub): self._hub = hub
    def _find(self, ws):
        for s in self._hub._sessions.values():
            if s.ws is ws: return s
        return None
    def __contains__(self, ws): return self._find(ws) is not None
    def __getitem__(self, ws):
        s = self._find(ws)
        if not s: raise KeyError(ws)
        return _SessProxy(s)
    def get(self, ws, d=None):
        s = self._find(ws); return _SessProxy(s) if s else d
    def values(self): return [_SessProxy(s) for s in self._hub._sessions.values()]

class _SessProxy:
    _MAP = {"username":"username","sala":"sala","x":"x","y":"y",
            "spriteId":"sprite_id","lado":"lado","logado":"logado"}
    def __init__(self, s): self._s = s
    def __getitem__(self, k):
        if k == "queue": return self._s.queue
        a = self._MAP.get(k)
        if a: return getattr(self._s, a)
        raise KeyError(k)
    def __setitem__(self, k, v):
        a = self._MAP.get(k)
        if a: setattr(self._s, a, v)
    def get(self, k, d=None):
        try: return self[k]
        except KeyError: return d

class _SalasProxy:
    def __init__(self, hub): self._hub = hub
    def __contains__(self, s): return s in self._hub._salas
    def __getitem__(self, sala):
        return {self._hub._sessions[sid].ws for sid in self._hub._salas.get(sala, set())
                if sid in self._hub._sessions}
    def get(self, s, d=None): return self[s] if s in self._hub._salas else d
    def keys(self): return self._hub._salas.keys()

def carregar_server_mods():
    try:
        import server_mods
    except ImportError:
        return
    for _, name, _ in pkgutil.iter_modules(server_mods.__path__):
        try:
            mod = importlib.import_module(f"server_mods.{name}")
            if hasattr(mod, "HANDLES") and hasattr(mod, "handle"):
                sala_esp = getattr(mod, "SALA", None)
                for t in mod.HANDLES:
                    HANDLERS_POR_TIPO[t] = mod
                    if sala_esp: MOD_SALA[t] = sala_esp
                print(f"  ✓ server_mods.{name}  →  {mod.HANDLES}")
            if hasattr(mod, "tick"): MODS_COM_TICK.append(mod)
            if hasattr(mod, "on_leave"): MODS_COM_LEAVE.append(mod)
        except Exception as e:
            print(f"  ✗ server_mods.{name}  →  {e}")


# ──────────────────────────────────────────────────────────────
#   RATE LIMITER
# ──────────────────────────────────────────────────────────────
class RateLimiter:
    __slots__ = ("_max","_win","_ts")
    def __init__(self, m=RATE_LIMIT_MSGS, w=RATE_LIMIT_WIN):
        self._max=m; self._win=w; self._ts=[]
    def permitir(self):
        agora = time.monotonic()
        self._ts = [t for t in self._ts if agora - t < self._win]
        if len(self._ts) >= self._max: return False
        self._ts.append(agora); return True


# ──────────────────────────────────────────────────────────────
#   LOOP DE MINIGAMES
# ──────────────────────────────────────────────────────────────
async def loop_minigames(hub):
    jp, sp = _JogProxy(hub), _SalasProxy(hub)
    async def _envia(sala, payload): await hub.broadcast(sala, payload)
    while True:
        await asyncio.sleep(1/60)
        for mod in MODS_COM_TICK:
            try:
                await mod.tick(jp, sp, _envia)
            except Exception as e:
                print(f"[tick] {e}")


# ──────────────────────────────────────────────────────────────
#   HANDLER WEBSOCKET
# ──────────────────────────────────────────────────────────────
async def _notificar_amigos_atualizados(hub, user_id):
    sessoes = hub.sessoes_do_usuario(user_id)
    if not sessoes:
        return
    lista = await banco.listar_amigos(user_id)
    pedidos = await banco.listar_pedidos_recebidos(user_id)
    online = list(hub.usuarios_online_ids())
    for sess in sessoes:
        await sess.enviar({"tipo":"amigos","lista":lista,"online":online,"pedidos":pedidos})


async def escritor(s):
    try:
        while True:
            msg = await s.queue.get()
            await s.ws.send(msg)
            s.queue.task_done()
    except (websockets.exceptions.ConnectionClosed, asyncio.CancelledError):
        pass

async def handler_ws(websocket, hub):
    try:
        s = Sessao(websocket)
    except Exception as e:
        print("[SESSAO]", repr(e))
        raise

    await hub.registrar(s)
    rate = RateLimiter()
    escrita = asyncio.create_task(escritor(s))
    jp, sp = _JogProxy(hub), _SalasProxy(hub)
    async def _broadcast_mod(sala, payload): await hub.broadcast(sala, payload)

    try:
        async for message in websocket:
            if len(message) > MAX_MSG_BYTES or not rate.permitir():
                continue
            try:
                d = json.loads(message)
            except Exception:
                continue
            if not isinstance(d, dict): continue
            tipo = d.get("tipo")
            if not isinstance(tipo, str): continue

            # ═══ AUTENTICAÇÃO ═══════════════════════════════════
            if tipo == "registrar":
                username = _sanitize_username(d.get("username"))
                senha = str(d.get("password", ""))
                email = _sanitize_email(d.get("email")) or ""
                if not username:
                    await s.enviar({"tipo":"auth_erro","mensagem":"Nome inválido."}); continue
                if len(senha) < 6:
                    await s.enviar({"tipo":"auth_erro","mensagem":"Senha precisa de 6+ caracteres."}); continue
                if not banco.ativo:
                    await s.enviar({"tipo":"auth_erro","mensagem":"Cadastro indisponível. Entre como convidado."}); continue
                user = await banco.criar_usuario(username, hash_senha(senha), email)
                if not user:
                    await s.enviar({"tipo":"auth_erro","mensagem":"Nome já cadastrado."}); continue
                token = gerar_token(user["id"], user["username"])
                await s.enviar({"tipo":"auth_ok","token":token,"user":{
                    "id":user["id"],"username":user["username"],
                    "sprite_id":user["sprite_id"],"bio":user.get("bio","")}})
                banco.log(user["id"], user["username"], "register")
                continue

            # ═══ RESET DE SENHA — solicitar ═════════════════════
            if tipo == "solicitar_reset":
                username = _sanitize_username(d.get("username"))
                resposta_neutra = {"tipo":"reset_solicitado",
                    "mensagem":"Se a conta existir, enviamos instruções de recuperação."}
                if not banco.ativo or not username:
                    await s.enviar(resposta_neutra); continue
                user, token = await banco.criar_token_reset(username)
                if user and token:
                    enviar_email_reset(user.get("email",""), user["username"], token)
                    banco.log(user["id"], user["username"], "reset_request")
                await s.enviar(resposta_neutra)
                continue

            # ═══ RESET DE SENHA — aplicar ═══════════════════════
            if tipo == "aplicar_reset":
                token_reset = str(d.get("token", ""))
                nova_senha = str(d.get("password", ""))
                if not banco.ativo:
                    await s.enviar({"tipo":"reset_erro","mensagem":"Indisponível."}); continue
                if len(nova_senha) < 6:
                    await s.enviar({"tipo":"reset_erro","mensagem":"Senha precisa de 6+ caracteres."}); continue
                ok = await banco.aplicar_reset(token_reset, hash_senha(nova_senha)) if token_reset else False
                if ok:
                    await s.enviar({"tipo":"reset_ok","mensagem":"Senha redefinida! Faça login."})
                else:
                    await s.enviar({"tipo":"reset_erro","mensagem":"Link inválido ou expirado."})
                continue

            if tipo == "autenticar":
                username = _sanitize_username(d.get("username"))
                senha = str(d.get("password", ""))
                if not banco.ativo:
                    await s.enviar({"tipo":"auth_erro","mensagem":"Login indisponível. Entre como convidado."}); continue
                user = await banco.buscar_usuario(username) if username else None
                if not user or not verificar_senha(senha, user["password_hash"]):
                    await s.enviar({"tipo":"auth_erro","mensagem":"Usuário ou senha inválidos."}); continue
                token = gerar_token(user["id"], user["username"])
                await s.enviar({"tipo":"auth_ok","token":token,"user":{
                    "id":user["id"],"username":user["username"],
                    "sprite_id":user["sprite_id"],"bio":user.get("bio","")}})
                banco.log(user["id"], user["username"], "login")
                continue

            # ═══ LOGIN no jogo ═══════════════════════════════════
            if tipo == "login":
                if s.logado: continue
                token = d.get("token")
                if token:
                    payload = validar_token(token)
                    if not payload:
                        await s.enviar({"tipo":"erro_login","mensagem":"Sessão expirada."}); continue
                    username = payload["username"]
                    s.user_id = payload["sub"]
                else:
                    username = _sanitize_username(d.get("username"))
                    if not username:
                        await s.enviar({"tipo":"erro_login","mensagem":"Nome inválido."}); continue
                    s.user_id = None
                if hub.username_em_uso(username):
                    await s.enviar({"tipo":"erro_login","mensagem":f"'{username}' já está online."}); continue

                s.username  = username
                s.sprite_id = _sprite(d.get("spriteId","cinzaguy"))
                s.lado      = _lado(d.get("lado","direita"))
                s.logado    = True

                ok = await hub.mover_para_sala(s.sid, SALA_INICIAL)
                if ok:
                    outros = [o.to_dict() for o in await hub.snapshot_sala(SALA_INICIAL) if o.sid != s.sid]
                    extras = {}
                    if s.user_id and banco.ativo:
                        extras["favoritos"] = await banco.listar_favoritos(s.user_id)
                        extras["amigos"] = await banco.listar_amigos(s.user_id)
                        extras["online"] = list(hub.usuarios_online_ids())
                        extras["pedidos"] = await banco.listar_pedidos_recebidos(s.user_id)
                    await s.enviar({"tipo":"lista_jogadores","meu_sid":s.sid,
                                    "jogadores":outros, "conta": bool(s.user_id), **extras})
                    await hub.broadcast(SALA_INICIAL, {"tipo":"novo_jogador", **s.to_dict()}, exceto=s.sid)
                    banco.log(s.user_id, username, "join", SALA_INICIAL)
                continue

            if not s.logado:
                continue

            # ═══ PERFIL / SOCIAL ════════════════════════════════
            if tipo == "atualizar_perfil":
                if not s.user_id:
                    await s.enviar({"tipo":"perfil_erro","mensagem":"Apenas contas podem editar perfil."}); continue
                sprite = d.get("sprite_id")
                bio = d.get("bio")
                if sprite is not None: sprite = _sprite(sprite)
                if bio is not None: bio = str(bio)[:280]
                user = await banco.atualizar_perfil(s.user_id, sprite, bio)
                if user:
                    if sprite: s.sprite_id = sprite
                    await s.enviar({"tipo":"perfil_ok","user":user})
                continue

            if tipo == "listar_amigos":
                if s.user_id:
                    await s.enviar({"tipo":"amigos",
                                    "lista": await banco.listar_amigos(s.user_id),
                                    "online": list(hub.usuarios_online_ids()),
                                    "pedidos": await banco.listar_pedidos_recebidos(s.user_id)})
                continue

            if tipo == "add_amigo":
                if s.user_id:
                    alvo = _sanitize_username(d.get("username"))
                    r = await banco.criar_pedido_amizade(s.user_id, alvo) if alvo else None
                    if r is None:
                        await s.enviar({"tipo":"amigo_erro","mensagem":"Erro ao enviar pedido."})
                    elif r == "inexistente":
                        await s.enviar({"tipo":"amigo_erro","mensagem":"Usuário não encontrado."})
                    elif r == "self":
                        await s.enviar({"tipo":"amigo_erro","mensagem":"Você não pode se adicionar."})
                    elif r == "ja_amigos":
                        await s.enviar({"tipo":"amigo_erro","mensagem":"Vocês já são amigos."})
                    elif r == "aceito_mutuo":
                        await s.enviar({"tipo":"pedido_enviado","mutuo":True,"mensagem":"Agora vocês são amigos!"})
                        await _notificar_amigos_atualizados(hub, s.user_id)
                    else:
                        await s.enviar({"tipo":"pedido_enviado","mutuo":False,
                                        "mensagem":f"Pedido enviado para {r['username']}."})
                        eu = {"id": s.user_id, "username": s.username, "sprite_id": s.sprite_id}
                        for sess in hub.sessoes_do_usuario(r["id"]):
                            await sess.enviar({"tipo":"pedido_recebido","de":eu})
                continue

            if tipo == "aceitar_pedido":
                if s.user_id:
                    from_id = d.get("from_id")
                    if isinstance(from_id, int):
                        ok = await banco.aceitar_pedido(s.user_id, from_id)
                        if ok:
                            await _notificar_amigos_atualizados(hub, s.user_id)
                            await _notificar_amigos_atualizados(hub, from_id)
                continue

            if tipo == "recusar_pedido":
                if s.user_id:
                    from_id = d.get("from_id")
                    if isinstance(from_id, int):
                        await banco.recusar_pedido(s.user_id, from_id)
                        await s.enviar({"tipo":"pedido_recusado","from_id":from_id})
                continue

            if tipo == "remover_amigo":
                if s.user_id:
                    fid = d.get("friend_id")
                    if isinstance(fid, int):
                        await banco.remover_amigo(s.user_id, fid)
                        await _notificar_amigos_atualizados(hub, s.user_id)
                        await _notificar_amigos_atualizados(hub, fid)
                continue

            # ═══ TP até o amigo ═════════════════════════════════
            if tipo == "tp_amigo":
                if s.user_id:
                    fid = d.get("friend_id")
                    if not isinstance(fid, int):
                        continue
                    if not await banco.sao_amigos(s.user_id, fid):
                        await s.enviar({"tipo":"tp_erro","mensagem":"Vocês não são amigos."}); continue
                    sessoes_amigo = hub.sessoes_do_usuario(fid)
                    if not sessoes_amigo:
                        await s.enviar({"tipo":"tp_erro","mensagem":"Amigo não está online."}); continue
                    alvo = sessoes_amigo[0]
                    sala_alvo = alvo.sala
                    if not sala_alvo or sala_alvo not in hub.salas_disponiveis():
                        await s.enviar({"tipo":"tp_erro","mensagem":"Não foi possível localizar o amigo."}); continue
                    sala_antiga = hub.sala_de(s.sid)
                    s.x = max(0.0, min(368.0, alvo.x))
                    s.y = max(0.0, min(268.0, alvo.y))
                    if sala_antiga:
                        for mod in MODS_COM_LEAVE:
                            try: mod.on_leave(websocket, jp)
                            except Exception: pass
                    if await hub.mover_para_sala(s.sid, sala_alvo):
                        if sala_antiga:
                            await hub.broadcast(sala_antiga, {"tipo":"jogador_saiu","id":s.sid})
                        outros = [o.to_dict() for o in await hub.snapshot_sala(sala_alvo) if o.sid != s.sid]
                        await s.enviar({"tipo":"tp_ok","sala":sala_alvo,
                                        "x":s.x,"y":s.y,"meu_sid":s.sid,"jogadores":outros})
                        await hub.broadcast(sala_alvo, {"tipo":"novo_jogador", "tp":True, **s.to_dict()}, exceto=s.sid)
                        banco.log(s.user_id, s.username, "tp_amigo", sala_alvo)
                continue

            # ═══ Chat privado (PV) ══════════════════════════════
            if tipo == "pv":
                if s.user_id:
                    fid = d.get("friend_id")
                    texto = d.get("texto","")
                    if not isinstance(fid, int) or not isinstance(texto, str):
                        continue
                    texto = texto.strip()[:MAX_CHAT_LEN]
                    if not texto:
                        continue
                    if not await banco.sao_amigos(s.user_id, fid):
                        await s.enviar({"tipo":"pv_erro","mensagem":"Vocês não são amigos."}); continue
                    sessoes_amigo = hub.sessoes_do_usuario(fid)
                    msg = {"tipo":"pv","de_id":s.user_id,"de_nome":s.username,
                           "para_id":fid,"texto":texto,"ts":int(time.time())}
                    entregue = False
                    for sess in sessoes_amigo:
                        await sess.enviar(msg)
                        entregue = True
                    await s.enviar({**msg, "eco":True, "entregue":entregue})
                continue

            if tipo == "toggle_favorito":
                if s.user_id:
                    room = str(d.get("room_id",""))[:60]
                    if room:
                        estado = await banco.toggle_favorito(s.user_id, room)
                        await s.enviar({"tipo":"favorito_estado","room_id":room,"favoritado":estado})
                continue

            # ═══ LIKE na sala ════════════════════════════════════
            if tipo == "toggle_like":
                if s.user_id:
                    room = str(d.get("room_id",""))[:60]
                    if room:
                        curtiu, total = await banco.toggle_like(s.user_id, room)
                        await s.enviar({"tipo":"like_estado","room_id":room,
                                        "curtiu":curtiu,"total":total})
                continue

            if tipo == "estado_sala":
                room = str(d.get("room_id",""))[:60]
                if room:
                    total = await banco.contar_likes(room)
                    curtiu = await banco.usuario_curtiu(s.user_id, room) if s.user_id else False
                    await s.enviar({"tipo":"like_estado","room_id":room,
                                    "curtiu":curtiu,"total":total})
                continue

            # ═══ MOVER ══════════════════════════════════════════
            if tipo == "mover":
                sala = hub.sala_de(s.sid)
                if not sala:
                    continue
                agora = time.monotonic()
                if agora - s.last_move < MOVE_RATE_LIMIT:
                    continue
                s.last_move = agora
                x = d.get("x")
                y = d.get("y")
                if not isinstance(x, (int, float)):
                    continue
                if not isinstance(y, (int, float)):
                    continue
                s.x = max(0.0, min(368.0, float(x)))
                s.y = max(0.0, min(268.0, float(y)))
                s.lado = _lado(d.get("lado", s.lado))
                dx = abs(s.x - s.last_broadcast_x)
                dy = abs(s.y - s.last_broadcast_y)
                if dx < MOVE_EPSILON and dy < MOVE_EPSILON:
                    continue
                s.last_broadcast_x = s.x
                s.last_broadcast_y = s.y
                await hub.broadcast(sala, {"tipo":"movimento","id":s.sid,
                                           "x":s.x,"y":s.y,"lado":s.lado}, exceto=s.sid)

            # ═══ MUDAR SALA ═════════════════════════════════════
            elif tipo == "mudar_sala":
                nova = d.get("nova_sala")
                if not isinstance(nova,str) or nova not in hub.salas_disponiveis(): continue
                sala_antiga = hub.sala_de(s.sid)
                x, y = d.get("x",200), d.get("y",150)
                if isinstance(x,(int,float)): s.x = max(0.0,min(368.0,float(x)))
                if isinstance(y,(int,float)): s.y = max(0.0,min(268.0,float(y)))
                if sala_antiga:
                    for mod in MODS_COM_LEAVE:
                        try: mod.on_leave(websocket, jp)
                        except Exception: pass
                if not await hub.mover_para_sala(s.sid, nova): continue
                if sala_antiga:
                    await hub.broadcast(sala_antiga, {"tipo":"jogador_saiu","id":s.sid})
                outros = [o.to_dict() for o in await hub.snapshot_sala(nova) if o.sid != s.sid]
                await s.enviar({"tipo":"lista_jogadores","meu_sid":s.sid,"jogadores":outros})
                await hub.broadcast(nova, {"tipo":"novo_jogador", **s.to_dict()}, exceto=s.sid)
                banco.log(s.user_id, s.username, "change_room", nova)

            # ═══ CHAT ═══════════════════════════════════════════
            elif tipo == "chat":
                sala = hub.sala_de(s.sid)
                if not sala: continue
                texto = d.get("texto","")
                if not isinstance(texto,str): continue
                texto = texto.strip()[:MAX_CHAT_LEN]
                if not texto: continue
                await hub.broadcast(sala, {"tipo":"chat","username":s.username,"texto":texto})

            # ═══ DIGITANDO ══════════════════════════════════════
            elif tipo == "digitando":
                sala = hub.sala_de(s.sid)
                if not sala: continue
                estado = d.get("estado")
                if not isinstance(estado,bool): continue
                await hub.broadcast(sala, {"tipo":"jogador_digitando","id":s.sid,"estado":estado}, exceto=s.sid)

            # ═══ SERVER MODS ════════════════════════════════════
            elif tipo in HANDLERS_POR_TIPO:
                sala = hub.sala_de(s.sid)
                esp = MOD_SALA.get(tipo)
                if esp and sala != esp: continue
                try:
                    await HANDLERS_POR_TIPO[tipo].handle(tipo, websocket, d, jp, sp, _broadcast_mod)
                except Exception as e:
                    print(f"[mod:{tipo}] {e}")

    except websockets.exceptions.ConnectionClosed:
        pass
    except Exception as e:
        print(f"[handler] {e}")
    finally:
        escrita.cancel()
        sala = hub.sala_de(s.sid)
        for mod in MODS_COM_LEAVE:
            try: mod.on_leave(websocket, jp)
            except Exception: pass
        await hub.remover(s.sid)
        if sala:
            await hub.broadcast(sala, {"tipo":"debug_event","categoria":"leave",
                                       "mensagem":f"{s.username} saiu."})
            await hub.broadcast(sala, {"tipo":"jogador_saiu","id":s.sid})
        if s.logado:
            banco.log(s.user_id, s.username, "disconnect", sala)


# ──────────────────────────────────────────────────────────────
#   HTTP ESTÁTICO
# ──────────────────────────────────────────────────────────────
CONTENT_TYPES = {
    ".html":"text/html; charset=utf-8", ".js":"application/javascript",
    ".json":"application/json", ".css":"text/css", ".png":"image/png",
    ".jpg":"image/jpeg", ".gif":"image/gif", ".mp4":"video/mp4",
    ".webm":"video/webm", ".mp3":"audio/mpeg", ".ogg":"audio/ogg",
    ".ico":"image/x-icon", ".wasm":"application/wasm", ".txt":"text/plain",
}
SEM_CACHE = {".js", ".json"}

def _process_request():
    async def process_request(connection, request):
        if request.headers.get("Upgrade","").lower() == "websocket":
            return None
        path = request.path.split("?")[0]
        if path == "/": path = "/index.html"
        file_path = os.path.realpath(os.path.join(PUBLIC_DIR, path.lstrip("/")))
        if not file_path.startswith(os.path.realpath(PUBLIC_DIR)):
            return Response(403, "Forbidden", WsHeaders([("Content-Length","9")]), b"Forbidden")
        if not os.path.isfile(file_path):
            return Response(404, "Not Found", WsHeaders([("Content-Length","9")]), b"Not Found")
        with open(file_path,"rb") as f:
            body = f.read()
        ext = os.path.splitext(file_path)[1].lower()
        ct = CONTENT_TYPES.get(ext, "application/octet-stream")
        headers = [("Content-Type",ct),("Content-Length",str(len(body))),
                   ("X-Content-Type-Options","nosniff")]
        if ext in SEM_CACHE:
            headers.append(("Cache-Control","no-cache, no-store, must-revalidate"))
        return Response(200, "OK", WsHeaders(headers), body)
    return process_request


def rodar_http_background():
    class H(SimpleHTTPRequestHandler):
        def __init__(self,*a,**k): super().__init__(*a, directory=PUBLIC_DIR, **k)
        def log_message(self,*a): pass
        def end_headers(self):
            p = self.path.split("?")[0]
            if p.endswith((".js",".json")):
                self.send_header("Cache-Control","no-cache, no-store, must-revalidate")
            self.send_header("X-Content-Type-Options","nosniff")
            super().end_headers()
    class S(ThreadingTCPServer):
        allow_reuse_address = True; daemon_threads = True
        def handle_error(self,*a): pass
    try:
        with S(("", PORT_HTTP), H) as srv:
            srv.serve_forever()
    except Exception: pass


def _ip_local():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try: s.connect(("8.8.8.8",80)); return s.getsockname()[0]
    except Exception: return "127.0.0.1"
    finally: s.close()


# ──────────────────────────────────────────────────────────────
#   MAIN
# ──────────────────────────────────────────────────────────────
async def main():
    await banco.conectar()

    hub = Hub(MANIFEST.get("salas", []))
    carregar_server_mods()

    print("="*65)
    print("        SALA 33 — SERVER v2.1")
    print("="*65)
    print(f"» Modo:    {'PRODUÇÃO (porta única)' if MODO_PRODUCAO else 'LOCAL (duas portas)'}")
    print(f"» Banco:   {'PostgreSQL ✓' if banco.ativo else 'sem banco (só convidado)'}")
    print(f"» SMTP:    {'Gmail ativo ✓' if SMTP_ATIVO else 'desativado (sem SMTP_USER/SMTP_PASS)'}")
    print(f"» Salas:   {', '.join(hub.salas_disponiveis())}")
    print(f"» Sprites: {', '.join(sorted(SPRITES_VALIDOS))}")
    if not MODO_PRODUCAO:
        ip = _ip_local()
        print(f"» HTTP:    http://{ip}:{PORT_HTTP}")
        print(f"» WS:      ws://{ip}:{PORT_WS}")
    else:
        print(f"» Porta:   {PORT_WS}")
    print("="*65)

    asyncio.create_task(loop_minigames(hub))
    ws_kwargs = dict(max_size=MAX_MSG_BYTES, max_queue=64, ping_interval=30, ping_timeout=10)

    def mk(h):
        async def _h(ws): await handler_ws(ws, h)
        return _h

    if MODO_PRODUCAO:
        async with websockets.serve(mk(hub), "0.0.0.0", PORT_WS,
                                    process_request=_process_request(), **ws_kwargs):
            await asyncio.Future()
    else:
        threading.Thread(target=rodar_http_background, daemon=True).start()
        async with websockets.serve(mk(hub), "0.0.0.0", PORT_WS, **ws_kwargs):
            await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n» Servidor desligado.")