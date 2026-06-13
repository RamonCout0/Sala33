# =====================================================
#   db.py — Camada de acesso ao PostgreSQL (asyncpg)
#
#   Tabelas:
#     users           → contas de jogador
#     friendships     → relações entre usuários
#     favorite_rooms  → salas favoritas por usuário
#     session_logs    → auditoria de sessões/ações
# =====================================================
import asyncio
import os
import time
import asyncpg

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://sala33:sala33@localhost:5432/sala33",
)

_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        # Normaliza URL pra asyncpg (sem +asyncpg no scheme)
        url = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")
        _pool = await asyncpg.create_pool(
            url,
            min_size=2,
            max_size=10,
            command_timeout=10,
        )
    return _pool


async def init_db():
    """Cria tabelas se não existirem. Safe pra rodar no startup."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id            SERIAL PRIMARY KEY,
            username      VARCHAR(20) UNIQUE NOT NULL,
            password_hash VARCHAR(200) NOT NULL,
            sprite_id     VARCHAR(40) DEFAULT 'cinzaguy',
            bio           TEXT DEFAULT '',
            created_at    TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS friendships (
            id         SERIAL PRIMARY KEY,
            user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
            friend_id  INTEGER REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(user_id, friend_id)
        );

        CREATE TABLE IF NOT EXISTS favorite_rooms (
            id         SERIAL PRIMARY KEY,
            user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
            room_id    VARCHAR(60) NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(user_id, room_id)
        );

        CREATE TABLE IF NOT EXISTS session_logs (
            id         BIGSERIAL PRIMARY KEY,
            user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
            username   VARCHAR(20),
            action     VARCHAR(30) NOT NULL,
            room_id    VARCHAR(60),
            meta       JSONB DEFAULT '{}',
            created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_session_logs_user ON session_logs(user_id);
        CREATE INDEX IF NOT EXISTS idx_session_logs_created ON session_logs(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_friendships_user ON friendships(user_id);
        CREATE INDEX IF NOT EXISTS idx_fav_rooms_user ON favorite_rooms(user_id);
        """)
    print("[db] Tabelas prontas.")


# ============================================================
#   Users
# ============================================================
async def user_create(username: str, password_hash: str) -> dict | None:
    pool = await get_pool()
    try:
        row = await pool.fetchrow(
            "INSERT INTO users(username, password_hash) VALUES($1,$2) RETURNING id,username,sprite_id,bio,created_at",
            username, password_hash,
        )
        return dict(row) if row else None
    except asyncpg.UniqueViolationError:
        return None


async def user_by_username(username: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT id,username,password_hash,sprite_id,bio,created_at FROM users WHERE username=$1",
        username,
    )
    return dict(row) if row else None


async def user_by_id(user_id: int) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT id,username,sprite_id,bio,created_at FROM users WHERE id=$1",
        user_id,
    )
    return dict(row) if row else None


async def user_update_profile(user_id: int, sprite_id: str | None, bio: str | None) -> dict | None:
    pool = await get_pool()
    # Só atualiza campos fornecidos
    parts, vals, idx = [], [], 1
    if sprite_id is not None:
        parts.append(f"sprite_id=${idx}"); vals.append(sprite_id); idx += 1
    if bio is not None:
        parts.append(f"bio=${idx}"); vals.append(bio); idx += 1
    if not parts:
        return await user_by_id(user_id)
    vals.append(user_id)
    row = await pool.fetchrow(
        f"UPDATE users SET {','.join(parts)} WHERE id=${idx} RETURNING id,username,sprite_id,bio,created_at",
        *vals,
    )
    return dict(row) if row else None


# ============================================================
#   Friendships
# ============================================================
async def friendship_add(user_id: int, friend_id: int) -> bool:
    if user_id == friend_id:
        return False
    pool = await get_pool()
    try:
        await pool.execute(
            "INSERT INTO friendships(user_id, friend_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
            user_id, friend_id,
        )
        return True
    except Exception:
        return False


async def friendship_remove(user_id: int, friend_id: int) -> bool:
    pool = await get_pool()
    res = await pool.execute(
        "DELETE FROM friendships WHERE user_id=$1 AND friend_id=$2",
        user_id, friend_id,
    )
    return res.endswith("1")


async def friendship_list(user_id: int) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT u.id, u.username, u.sprite_id, f.created_at
        FROM friendships f
        JOIN users u ON u.id = f.friend_id
        WHERE f.user_id = $1
        ORDER BY u.username
        """,
        user_id,
    )
    return [dict(r) for r in rows]


# ============================================================
#   Favorite Rooms
# ============================================================
async def fav_add(user_id: int, room_id: str) -> bool:
    pool = await get_pool()
    try:
        await pool.execute(
            "INSERT INTO favorite_rooms(user_id, room_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
            user_id, room_id,
        )
        return True
    except Exception:
        return False


async def fav_remove(user_id: int, room_id: str) -> bool:
    pool = await get_pool()
    res = await pool.execute(
        "DELETE FROM favorite_rooms WHERE user_id=$1 AND room_id=$2",
        user_id, room_id,
    )
    return res.endswith("1")


async def fav_list(user_id: int) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT room_id, created_at FROM favorite_rooms WHERE user_id=$1 ORDER BY created_at DESC",
        user_id,
    )
    return [dict(r) for r in rows]


# ============================================================
#   Session Logs (fire and forget — não bloqueia o loop)
# ============================================================
_log_queue: asyncio.Queue = asyncio.Queue(maxsize=1000)


async def _log_writer():
    """Worker assíncrono que drena a fila de logs pra o banco."""
    try:
        pool = await get_pool()
    except Exception as e:
        print(f"[log_writer] sem pool: {e}")
        return   # encerra a task silenciosamente

    batch = []
    while True:
        try:
            entry = await asyncio.wait_for(_log_queue.get(), timeout=5.0)
            batch.append(entry)
            # Drena até 50 de uma vez
            while not _log_queue.empty() and len(batch) < 50:
                batch.append(_log_queue.get_nowait())
        except asyncio.TimeoutError:
            pass

        if batch:
            try:
                await pool.executemany(
                    "INSERT INTO session_logs(user_id,username,action,room_id,meta) VALUES($1,$2,$3,$4,$5)",
                    [(e["user_id"], e["username"], e["action"], e.get("room_id"), e.get("meta", "{}")) for e in batch],
                )
            except Exception as e:
                print(f"[log_writer] erro: {e}")
            batch.clear()


def log_action(user_id: int | None, username: str, action: str, room_id: str | None = None, meta: dict | None = None):
    """Enfileira um log sem bloquear. Fire and forget."""
    import json
    try:
        _log_queue.put_nowait({
            "user_id": user_id,
            "username": username,
            "action": action,
            "room_id": room_id,
            "meta": json.dumps(meta or {}),
        })
    except asyncio.QueueFull:
        pass
