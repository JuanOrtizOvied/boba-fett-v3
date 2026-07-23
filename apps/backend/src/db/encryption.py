"""Application-level Fernet encryption for sensitive portfolio data.

When ENCRYPTION_KEY is set, values are encrypted before writing to Postgres
and decrypted on read. When unset, all functions are no-ops — dev-friendly.

Decrypt functions are bidirectional: they transparently accept both
plaintext (old unencrypted data) and Fernet tokens (new encrypted data),
so a mixed dataset (e.g. mid-migration) reads correctly either way. A
Fernet token always starts with the literal prefix "gAAAAA".
"""
from __future__ import annotations

import json
import os
from typing import Any

_fernet = None


def _get_fernet():
    global _fernet
    if _fernet is None:
        key = os.environ.get("ENCRYPTION_KEY")
        if key:
            from cryptography.fernet import Fernet

            _fernet = Fernet(key.encode() if isinstance(key, str) else key)
        else:
            _fernet = False  # sentinel: no encryption configured
    return _fernet if _fernet is not False else None


def encrypt(value: str) -> str:
    f = _get_fernet()
    if f is None:
        return value
    return f.encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    if not value or not isinstance(value, str):
        return value
    f = _get_fernet()
    if f is None:
        return value
    # Bidirectional: handle both encrypted (Fernet token) and plaintext
    if value.startswith("gAAAAA"):
        return f.decrypt(value.encode()).decode()
    return value


def encrypt_amount(amount: float) -> str:
    """Encrypt a numeric amount into a string for storage."""
    return encrypt(str(amount))


def decrypt_amount(value: Any) -> float:
    """Decrypt an amount back to float. Handles float, Decimal, and encrypted strings."""
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        decrypted = decrypt(value)
        return float(decrypted)
    # Decimal or other numeric
    return float(value)


def encrypt_json(data: Any) -> str | None:
    """Encrypt a JSON-serializable value. Returns None if input is None."""
    if data is None:
        return None
    return encrypt(json.dumps(data) if not isinstance(data, str) else data)


def decrypt_json(value: Any) -> Any:
    """Decrypt a JSON blob.

    Handles JSONB (already parsed), encrypted strings, and plain JSON strings.
    """
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value  # Already parsed JSONB, not encrypted
    if isinstance(value, str):
        decrypted = decrypt(value)
        return json.loads(decrypted)
    return value


class EncryptedSerde:
    """Wraps LangGraph's JsonPlusSerializer, encrypting the serialized bytes."""

    def __init__(self):
        from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer

        self._inner = JsonPlusSerializer()

    def dumps(self, obj: Any) -> bytes:
        data = self._inner.dumps(obj)
        f = _get_fernet()
        if f is None:
            return data
        return f.encrypt(data)

    def loads(self, data: bytes) -> Any:
        f = _get_fernet()
        if f is not None and data and isinstance(data, bytes) and data.startswith(b"gAAAAA"):
            data = f.decrypt(data)
        return self._inner.loads(data)

    def dumps_typed(self, obj: Any) -> tuple[str, bytes]:
        type_str, data = self._inner.dumps_typed(obj)
        f = _get_fernet()
        if f is None:
            return type_str, data
        return type_str, f.encrypt(data)

    def loads_typed(self, data: tuple[str, bytes]) -> Any:
        type_str, payload = data
        f = _get_fernet()
        is_encrypted = (
            f is not None
            and payload
            and isinstance(payload, bytes)
            and payload.startswith(b"gAAAAA")
        )
        if is_encrypted:
            payload = f.decrypt(payload)
        return self._inner.loads_typed((type_str, payload))


def get_serde():
    """Return EncryptedSerde if ENCRYPTION_KEY is set, else None (use default)."""
    if os.environ.get("ENCRYPTION_KEY"):
        return EncryptedSerde()
    return None
