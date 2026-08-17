"""Transparent encryption for secrets stored in the dashboard database.

Uses Fernet (AES-128-CBC + HMAC) from the ``cryptography`` package.  The
encryption key is read from ``STORAGE_ENCRYPTION_KEY``.  If the variable is
missing the application generates a new key and appends it to ``.env`` so
deployments keep a stable key automatically.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)

_ENV_VAR = "STORAGE_ENCRYPTION_KEY"
_FERNET_PREFIX = "gAAAA"


def _env_path() -> Path:
    """Return the workspace ``.env`` file path."""
    return Path(__file__).resolve().parents[3] / ".env"


def _generate_key() -> str:
    """Generate a new URL-safe base64-encoded Fernet key."""
    return Fernet.generate_key().decode("utf-8")


def _write_key_to_env(key: str) -> None:
    """Persist the generated key in the workspace ``.env`` file."""
    env_path = _env_path()
    line = f"{_ENV_VAR}={key}\n"
    if env_path.exists():
        text = env_path.read_text(encoding="utf-8")
        if f"{_ENV_VAR}=" in text:
            return
        if text and not text.endswith("\n"):
            line = "\n" + line
        env_path.write_text(text + line, encoding="utf-8")
    else:
        env_path.write_text(line, encoding="utf-8")
    logger.warning(
        "Generated new %s and saved it to %s. Keep this file secret and back it up.",
        _ENV_VAR,
        env_path,
    )


def _load_key() -> bytes:
    """Return the Fernet key from the environment, generating one if needed."""
    raw = os.environ.get(_ENV_VAR, "").strip()
    if not raw:
        raw = _generate_key()
        _write_key_to_env(raw)
        os.environ[_ENV_VAR] = raw
    return raw.encode("utf-8")


def _fernet() -> Fernet:
    return Fernet(_load_key())


def _looks_encrypted(value: str) -> bool:
    """Heuristic check for a Fernet ciphertext string."""
    return value.startswith(_FERNET_PREFIX)


def encrypt(value: str) -> str:
    """Encrypt ``value`` unless it is empty or already encrypted.

    The result is a URL-safe base64 string suitable for storage in a TEXT or
    NVARCHAR column.
    """
    if not value or _looks_encrypted(value):
        return value
    return _fernet().encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt(value: str) -> str:
    """Decrypt ``value``.

    Returns the original string for empty values and for legacy plaintext
    entries that cannot be decrypted.  A warning is logged for each plaintext
    value that is returned so administrators know a migration is still
    pending.
    """
    if not value:
        return value
    if not _looks_encrypted(value):
        logger.warning(
            "Returning unencrypted secret from storage (migration pending)."
        )
        return value
    try:
        return _fernet().decrypt(value.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        logger.warning("Failed to decrypt secret, returning stored value as-is.")
        return value
