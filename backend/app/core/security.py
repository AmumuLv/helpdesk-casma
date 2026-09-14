import hashlib
import hmac
import re
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
import pyotp
from cryptography.fernet import Fernet, InvalidToken
from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher

from app.core.config import get_settings

_hasher = PasswordHash((Argon2Hasher(),))
_DUMMY_HASH = _hasher.hash("timing-equalizer-not-a-password")

_COMMON = {"casma2026", "municipalidad", "password", "contraseña", "123456789", "administrador", "qwerty123"}
_PAIR_ALPHABET = "ACDEFHJKMNPRTUVWXY34679"


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash:
        _hasher.verify(password, _DUMMY_HASH)
        return False
    try:
        return _hasher.verify(password, password_hash)
    except Exception:
        return False


def staff_password_errors(password: str, username: str = "") -> list[str]:
    errors = []
    if len(password) < 12:
        errors.append("Debe tener al menos 12 caracteres.")
    if not re.search(r"[a-z]", password):
        errors.append("Debe incluir una letra minúscula.")
    if not re.search(r"[A-Z]", password):
        errors.append("Debe incluir una letra mayúscula.")
    if not re.search(r"\d", password):
        errors.append("Debe incluir un número.")
    if not re.search(r"[^A-Za-z0-9]", password):
        errors.append("Debe incluir un símbolo.")
    low = password.lower()
    if username and username.lower() in low:
        errors.append("No debe contener el nombre de usuario.")
    if any(c in low for c in _COMMON):
        errors.append("Es demasiado común.")
    return errors


def office_password_errors(password: str) -> list[str]:
    errors = []
    if len(password) < 10:
        errors.append("Debe tener al menos 10 caracteres.")
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        errors.append("Debe combinar letras y números.")
    if password.lower() in _COMMON:
        errors.append("Es demasiado común.")
    return errors


def create_token(subject: str, kind: str, ttl: timedelta, extra: dict[str, Any] | None = None) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": subject, "typ": kind, "iat": now, "exp": now + ttl, "jti": uuid.uuid4().hex, **(extra or {})}
    return jwt.encode(payload, get_settings().jwt_secret, algorithm="HS256")


def decode_token(token: str | None, kind: str) -> dict[str, Any] | None:
    if not token:
        return None
    try:
        payload = jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"], options={"require": ["exp", "sub", "typ"]})
    except jwt.PyJWTError:
        return None
    return payload if payload.get("typ") == kind else None


def _fernet() -> Fernet:
    return Fernet(get_settings().field_encryption_key.encode())


def encrypt_field(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt_field(value: str) -> str | None:
    try:
        return _fernet().decrypt(value.encode()).decode()
    except InvalidToken:
        return None


def new_totp_secret() -> str:
    return pyotp.random_base32()


def totp_uri(secret: str, username: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=username, issuer_name="HelpDesk Casma")


def verify_totp(secret: str, code: str, last_step: int | None) -> int | None:
    code = re.sub(r"\s", "", code or "")
    if not re.fullmatch(r"\d{6}", code):
        return None
    totp = pyotp.TOTP(secret)
    current = int(time.time()) // 30
    for step in (current - 1, current, current + 1):
        if last_step is not None and step <= last_step:
            continue
        if hmac.compare_digest(totp.at(step * 30), code):
            return step
    return None


def new_device_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_pair_code() -> str:
    raw = "".join(secrets.choice(_PAIR_ALPHABET) for _ in range(6))
    return f"{raw[:3]}-{raw[3:]}"


def temp_password() -> str:
    while True:
        pw = secrets.token_urlsafe(12) + "!7aA"
        if not staff_password_errors(pw):
            return pw
