"""Server-side at-rest encryption for sensitive database fields."""

from __future__ import annotations

import base64
import os

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

PREFIX = 'enc:v1:'
_fernet: Fernet | None = None


def _derive_key_from_secret(secret: str) -> bytes:
    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b'notespro-db-v1',
        info=b'db-field-encryption',
    )
    return base64.urlsafe_b64encode(hkdf.derive(secret.encode('utf-8')))


def get_fernet() -> Fernet:
    global _fernet
    if _fernet is not None:
        return _fernet

    raw = os.environ.get('DB_ENCRYPTION_KEY', '').strip()
    if raw:
        try:
            key = raw.encode('ascii')
            _fernet = Fernet(key)
            return _fernet
        except (ValueError, TypeError) as exc:
            raise ImproperlyConfigured(
                'DB_ENCRYPTION_KEY must be a valid Fernet key (44-char url-safe base64). '
                'Generate one with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
            ) from exc

    if not settings.DEBUG:
        raise ImproperlyConfigured(
            'Set DB_ENCRYPTION_KEY in production. '
            'Generate: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
        )

    _fernet = Fernet(_derive_key_from_secret(settings.SECRET_KEY))
    return _fernet


def generate_key() -> str:
    return Fernet.generate_key().decode('ascii')


def is_encrypted(value: str | None) -> bool:
    return bool(value) and value.startswith(PREFIX)


def encrypt(value: str | None) -> str | None:
    if value is None or value == '':
        return value
    if is_encrypted(value):
        return value
    token = get_fernet().encrypt(value.encode('utf-8'))
    return PREFIX + token.decode('ascii')


def decrypt(value: str | None) -> str | None:
    if value is None or value == '':
        return value
    if not is_encrypted(value):
        return value
    token = value[len(PREFIX):].encode('ascii')
    try:
        return get_fernet().decrypt(token).decode('utf-8')
    except InvalidToken as exc:
        raise ImproperlyConfigured(
            'Could not decrypt a database field. DB_ENCRYPTION_KEY may have changed.'
        ) from exc
