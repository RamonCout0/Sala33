# =====================================================
#   auth.py — JWT e hashing de senha
# =====================================================
import os
from datetime import datetime, timedelta, timezone

import jwt
from passlib.context import CryptContext

JWT_SECRET  = os.environ.get("JWT_SECRET", "sala33-dev-secret-troque-em-producao")
JWT_ALG     = "HS256"
JWT_EXP_H   = 24 * 7   # 1 semana

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_senha(senha: str) -> str:
    return pwd_ctx.hash(senha)


def verificar_senha(senha: str, hashed: str) -> bool:
    return pwd_ctx.verify(senha, hashed)


def gerar_token(user_id: int, username: str) -> str:
    agora = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "username": username,
        "iat": agora,
        "exp": agora + timedelta(hours=JWT_EXP_H),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def validar_token(token: str) -> dict | None:
    """Retorna payload ou None se inválido/expirado."""
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.PyJWTError:
        return None
