"""Uvicorn entry point with optional SSL/TLS support.

Usage:
    python -m src.web.server          # plain HTTP on HTTP_HOST:HTTP_PORT
    # with SSL via PFX bundle:
    #   SSL_PFX_PATH=C:\\certs\\app.pfx  SSL_PFX_PASSWORD=secret
    #   python -m src.web.server
    # or pass PEM files directly via SSL_CERTFILE / SSL_KEYFILE.
"""

from __future__ import annotations

import os

import uvicorn

from src.web.config import get_settings
from src.web.ssl_utils import extract_pfx_to_pem


def _resolve_ssl_cert_key(settings) -> tuple[str, str] | None:
    """Return ``(certfile, keyfile)`` for HTTPS, or None for plain HTTP."""
    if settings.SSL_PFX_PATH:
        return extract_pfx_to_pem(settings.SSL_PFX_PATH, settings.SSL_PFX_PASSWORD)
    if settings.SSL_CERTFILE and settings.SSL_KEYFILE:
        return settings.SSL_CERTFILE, settings.SSL_KEYFILE
    return None


def main() -> None:
    settings = get_settings()
    cert_key = _resolve_ssl_cert_key(settings)

    kwargs: dict = {
        "reload": os.getenv("UVICORN_RELOAD", "").lower() in ("1", "true", "yes"),
    }
    if cert_key is not None:
        kwargs["ssl_certfile"], kwargs["ssl_keyfile"] = cert_key

    config = uvicorn.Config(
        "src.web.main:create_app",
        factory=True,
        host=settings.HTTP_HOST,
        port=settings.HTTP_PORT,
        **kwargs,
    )
    uvicorn.Server(config).run()


if __name__ == "__main__":
    main()
