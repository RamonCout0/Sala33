# =====================================================
#   api.py — API REST embutida no mesmo processo
#
#   Endpoints:
#     POST /api/auth/register
#     POST /api/auth/login
#     GET  /api/users/me           (requer JWT)
#     PATCH /api/users/me          (requer JWT)
#     GET  /api/users/:id
#     GET  /api/friends            (requer JWT)
#     POST /api/friends/:username  (requer JWT)
#     DELETE /api/friends/:id      (requer JWT)
#     GET  /api/favorites          (requer JWT)
#     POST /api/favorites          (requer JWT)
#     DELETE /api/favorites/:room_id (requer JWT)
#
#   Servido via process_request do websockets (mesmo processo,
#   sem abrir porta extra). Roteamento manual por path.
# =====================================================
import json
import re
from urllib.parse import urlparse, parse_qs

import db
import auth as authmod

# Regex de username válido
_USERNAME_RE = re.compile(r"^[A-Za-z0-9_\-]{3,20}$")


# ============================================================
#   Helpers de resposta HTTP
# ============================================================
def _resp(status: int, body: dict, extra_headers: list | None = None):
    data = json.dumps(body, default=str).encode()
    headers = [
        ("Content-Type", "application/json; charset=utf-8"),
        ("Content-Length", str(len(data))),
        ("Access-Control-Allow-Origin", "*"),
        ("Access-Control-Allow-Headers", "Authorization, Content-Type"),
    ]
    if extra_headers:
        headers.extend(extra_headers)
    return status, headers, data


def _ok(body: dict):
    return _resp(200, body)


def _created(body: dict):
    return _resp(201, body)


def _err(status: int, msg: str):
    return _resp(status, {"error": msg})


def _parse_body(request) -> dict:
    """Extrai JSON do corpo da requisição."""
    try:
        body = bytes(request.body) if hasattr(request, "body") else b""
        return json.loads(body) if body else {}
    except Exception:
        return {}


def _bearer_token(request) -> str | None:
    """Extrai token do header Authorization: Bearer <token>"""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return None


def _require_auth(request) -> dict | None:
    """Retorna o payload do JWT ou None."""
    token = _bearer_token(request)
    if not token:
        return None
    return authmod.validar_token(token)


# ============================================================
#   Router — dispatch por (método, path pattern)
# ============================================================
async def handle_api(method: str, path: str, request) -> tuple:
    """
    Retorna (status, headers, body_bytes) ou None se a rota
    não for reconhecida como API.
    """
    # Remove /api prefix e query string
    parsed = urlparse(path)
    p = parsed.path
    if not p.startswith("/api/"):
        return None
    p = p[4:]  # remove /api

    # ---- OPTIONS (CORS preflight) ----
    if method == "OPTIONS":
        return _resp(204, {}, [
            ("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS"),
            ("Access-Control-Max-Age", "86400"),
        ])

    # ---- AUTH ----
    if p == "/auth/register" and method == "POST":
        body = _parse_body(request)
        username = str(body.get("username", "")).strip()
        senha    = str(body.get("password", "")).strip()
        if not _USERNAME_RE.match(username):
            return _err(400, "Username inválido (3-20 chars, A-Za-z0-9_-).")
        if len(senha) < 6:
            return _err(400, "Senha deve ter no mínimo 6 caracteres.")
        hashed = authmod.hash_senha(senha)
        user = await db.user_create(username.upper(), hashed)
        if not user:
            return _err(409, "Username já está em uso.")
        token = authmod.gerar_token(user["id"], user["username"])
        db.log_action(user["id"], user["username"], "register")
        return _created({"token": token, "user": _public_user(user)})

    if p == "/auth/login" and method == "POST":
        body = _parse_body(request)
        username = str(body.get("username", "")).upper().strip()
        senha    = str(body.get("password", "")).strip()
        user = await db.user_by_username(username)
        if not user or not authmod.verificar_senha(senha, user["password_hash"]):
            return _err(401, "Usuário ou senha inválidos.")
        token = authmod.gerar_token(user["id"], user["username"])
        db.log_action(user["id"], user["username"], "login")
        return _ok({"token": token, "user": _public_user(user)})

    # ---- USERS ----
    if p == "/users/me" and method == "GET":
        payload = _require_auth(request)
        if not payload:
            return _err(401, "Token necessário.")
        user = await db.user_by_id(int(payload["sub"]))
        if not user:
            return _err(404, "Usuário não encontrado.")
        return _ok(_public_user(user))

    if p == "/users/me" and method == "PATCH":
        payload = _require_auth(request)
        if not payload:
            return _err(401, "Token necessário.")
        body = _parse_body(request)
        sprite_id = body.get("sprite_id")
        bio       = body.get("bio")
        if bio and len(bio) > 280:
            return _err(400, "Bio muito longa (máx 280 chars).")
        user = await db.user_update_profile(int(payload["sub"]), sprite_id, bio)
        if not user:
            return _err(404, "Usuário não encontrado.")
        return _ok(_public_user(user))

    m = re.match(r"^/users/(\d+)$", p)
    if m and method == "GET":
        user = await db.user_by_id(int(m.group(1)))
        if not user:
            return _err(404, "Usuário não encontrado.")
        return _ok(_public_user(user))

    # ---- FRIENDS ----
    if p == "/friends" and method == "GET":
        payload = _require_auth(request)
        if not payload:
            return _err(401, "Token necessário.")
        friends = await db.friendship_list(int(payload["sub"]))
        return _ok({"friends": friends})

    m = re.match(r"^/friends/([A-Za-z0-9_\-]+)$", p)
    if m and method == "POST":
        payload = _require_auth(request)
        if not payload:
            return _err(401, "Token necessário.")
        target = await db.user_by_username(m.group(1).upper())
        if not target:
            return _err(404, "Usuário não encontrado.")
        ok = await db.friendship_add(int(payload["sub"]), target["id"])
        if not ok:
            return _err(409, "Já são amigos ou operação inválida.")
        return _created({"message": f"Agora você e {target['username']} são amigos."})

    m = re.match(r"^/friends/(\d+)$", p)
    if m and method == "DELETE":
        payload = _require_auth(request)
        if not payload:
            return _err(401, "Token necessário.")
        await db.friendship_remove(int(payload["sub"]), int(m.group(1)))
        return _ok({"message": "Amizade removida."})

    # ---- FAVORITES ----
    if p == "/favorites" and method == "GET":
        payload = _require_auth(request)
        if not payload:
            return _err(401, "Token necessário.")
        favs = await db.fav_list(int(payload["sub"]))
        return _ok({"favorites": favs})

    if p == "/favorites" and method == "POST":
        payload = _require_auth(request)
        if not payload:
            return _err(401, "Token necessário.")
        body = _parse_body(request)
        room_id = str(body.get("room_id", "")).strip()
        if not room_id or len(room_id) > 60:
            return _err(400, "room_id inválido.")
        await db.fav_add(int(payload["sub"]), room_id)
        return _created({"message": f"{room_id} adicionada aos favoritos."})

    m = re.match(r"^/favorites/([A-Za-z0-9_\-]+)$", p)
    if m and method == "DELETE":
        payload = _require_auth(request)
        if not payload:
            return _err(401, "Token necessário.")
        await db.fav_remove(int(payload["sub"]), m.group(1))
        return _ok({"message": "Favorito removido."})

    # ---- 404 da API ----
    return _err(404, f"Endpoint não encontrado: {method} {p}")


def _public_user(u: dict) -> dict:
    """Campos seguros pra expor publicamente."""
    return {
        "id":         u["id"],
        "username":   u["username"],
        "sprite_id":  u.get("sprite_id", "cinzaguy"),
        "bio":        u.get("bio", ""),
        "created_at": str(u.get("created_at", "")),
    }
