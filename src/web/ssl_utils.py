"""SSL/TLS helpers: extract PEM cert/key from a PFX bundle for uvicorn."""

from __future__ import annotations

import atexit
import os
import tempfile
from pathlib import Path

from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
    pkcs12,
)


def extract_pfx_to_pem(pfx_path: str, pfx_password: str) -> tuple[str, str]:
    """Extract cert (with optional chain) and private key from a PFX/PKCS12 file.

    Writes temporary PEM files and returns ``(cert_path, key_path)``.  The
    temporary files are deleted when the process exits.
    """
    pwd = pfx_password.encode() if pfx_password else None
    pfx_data = Path(pfx_path).read_bytes()
    private_key, certificate, additional_certs = pkcs12.load_key_and_certificates(
        pfx_data, pwd
    )
    if private_key is None or certificate is None:
        raise ValueError(f"PFX '{pfx_path}' neobsahuje klíč nebo certifikát.")

    tmpdir = Path(tempfile.mkdtemp(prefix="helios_ssl_"))
    cert_path = tmpdir / "cert.pem"
    key_path = tmpdir / "key.pem"

    # cert + optional intermediate certs (chain)
    cert_pem = certificate.public_bytes(Encoding.PEM)
    for extra in (additional_certs or []):
        cert_pem += extra.public_bytes(Encoding.PEM)
    cert_path.write_bytes(cert_pem)

    # key without password -- file lives in the temp dir and is removed on exit
    key_pem = private_key.private_bytes(
        Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()
    )
    key_path.write_bytes(key_pem)

    try:
        os.chmod(cert_path, 0o600)
        os.chmod(key_path, 0o600)
    except OSError:
        # On Windows ACLs handle permissions differently; ignore.
        pass

    def _cleanup():
        for p in (cert_path, key_path):
            try:
                p.unlink()
            except OSError:
                pass
        try:
            tmpdir.rmdir()
        except OSError:
            pass

    atexit.register(_cleanup)

    return str(cert_path), str(key_path)
