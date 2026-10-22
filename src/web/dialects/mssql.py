"""MSSQL (SQL Server) dialect – zachovává stávající chování."""

from __future__ import annotations

import contextlib
import re

import pyodbc

from src.web.dialects.base import SourceDialect


class MSSQLDialect(SourceDialect):
    name = "mssql"
    error_class = pyodbc.Error
    param_placeholder = "?"

    @contextlib.contextmanager
    def connect(self, connector=None, settings=None):
        if settings is None:
            from src.web.config import get_settings

            settings = get_settings()
        if connector is not None:
            driver = connector.db_driver or "ODBC Driver 17 for SQL Server"
            host = connector.db_host
            port = connector.db_port
            database = connector.db_name
            user = connector.db_user
            password = connector.db_password
        else:
            driver = settings.DB_DRIVER or "ODBC Driver 17 for SQL Server"
            host = settings.DB_HOST
            port = settings.DB_PORT
            database = settings.DB_NAME
            user = settings.DB_USER
            password = settings.DB_PASSWORD
        driver = validate_driver(driver)
        # Every value is quoted, so nothing can add keywords to the connection
        # string; Windows authentication of the service account is never used.
        base = (
            f"DRIVER={_odbc_value(driver)};"
            f"SERVER={_odbc_value(f'{host},{port}' if port else host)};"
            f"DATABASE={_odbc_value(database)};"
            f"UID={_odbc_value(user)};"
            f"PWD={_odbc_value(password)};"
            "Trusted_Connection=no;"
            "Timeout=30;"
        )
        conn = _connect_preferring_encryption(base, (driver, str(host), str(port), str(database)))
        try:
            yield conn
        finally:
            conn.close()

    def quote_identifier(self, name: str) -> str:
        return "[" + name.replace("]", "]]") + "]"

    def list_tables_sql(self) -> str:
        return """
            SELECT name AS system_name,
                   CASE WHEN type = 'U' THEN 'table' ELSE 'view' END AS kind
            FROM sys.objects
            WHERE type IN ('U', 'V')
              AND is_ms_shipped = 0
              AND name NOT LIKE 'sys%'
            ORDER BY kind, name
        """

    def list_tables_via_tabobecny_prehled(self) -> bool:
        return True

    def table_exists_sql(self, name: str) -> str:
        return "SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(?) AND type IN ('U', 'V')"

    def index_columns_sql(self) -> str:
        return """
            SELECT c.name
            FROM sys.indexes i
            JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
            JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
            JOIN sys.objects o ON i.object_id = o.object_id
            WHERE o.name = ? AND i.is_hypothetical = 0 AND i.type > 0
        """

    def table_hint(self) -> str:
        return "WITH (NOLOCK)"

    def type_family(self, raw_type_code, sample):
        from src.web.db import _guess_type, _is_integer_sql_type, _is_text_sql_type

        return _guess_type(raw_type_code, sample), _is_integer_sql_type(raw_type_code), _is_text_sql_type(raw_type_code)

    def display_type_name(self, raw_type_code, sample=None):
        from src.web.db import _sql_type_name

        return _sql_type_name(raw_type_code, sample)


# ---------------------------------------------------------------------------
# Connection string safety and encryption
# ---------------------------------------------------------------------------
_DRIVER_RE = re.compile(r"^(ODBC Driver \d+ for SQL Server|SQL Server Native Client \d+(\.\d+)?|SQL Server)$", re.IGNORECASE)

# Tried in this order: encrypted with a verified certificate, encrypted with
# the server's own (e.g. self-signed) certificate, unencrypted.
ENCRYPTION_MODES = (
    ("verified", "Encrypt=yes;TrustServerCertificate=no;"),
    ("encrypted", "Encrypt=yes;TrustServerCertificate=yes;"),
    ("plain", "Encrypt=no;"),
)
_ENCRYPTION_HINTS = ("ssl", "tls", "certificate", "certifik", "encrypt", "šifr", "handshake")
# (driver, server, port, database) -> index into ENCRYPTION_MODES that worked
_mode_cache: dict[tuple[str, str, str, str], int] = {}


def validate_driver(driver: str | None) -> str:
    """Only SQL Server ODBC drivers (another driver could read local files)."""
    name = (driver or "").strip() or "ODBC Driver 17 for SQL Server"
    if not _DRIVER_RE.match(name):
        raise pyodbc.Error("HY000", f"Ovladač „{name}“ není povolený. Použijte ovladač SQL Serveru, např. ODBC Driver 17 for SQL Server.")
    return name


def _odbc_value(value) -> str:
    """Quote a value for an ODBC connection string ({...}, a } doubled)."""
    text = "" if value is None else str(value)
    if any(ch in text for ch in ("\x00", "\r", "\n")):
        raise pyodbc.Error("HY000", "Neplatný znak v nastavení konektoru.")
    return "{" + text.replace("}", "}}") + "}"


def _is_encryption_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(hint in text for hint in _ENCRYPTION_HINTS)


def _connect_preferring_encryption(base: str, key: tuple[str, str, str, str]):
    """Connect encrypted if the server allows it; fall back only on TLS errors."""
    start = _mode_cache.get(key, 0)
    last: Exception | None = None
    for index in range(start, len(ENCRYPTION_MODES)):
        try:
            conn = pyodbc.connect(base + ENCRYPTION_MODES[index][1])
        except pyodbc.Error as exc:
            if not _is_encryption_error(exc) or index == len(ENCRYPTION_MODES) - 1:
                raise
            last = exc
            continue
        _mode_cache[key] = index
        return conn
    raise last  # pragma: no cover - the loop returns or raises


def encryption_mode(connector) -> str | None:
    """Mode used by the last connection of this connector ("verified", "encrypted", "plain")."""
    key = (
        validate_driver(connector.db_driver), str(connector.db_host), str(connector.db_port), str(connector.db_name)
    )
    index = _mode_cache.get(key)
    return ENCRYPTION_MODES[index][0] if index is not None else None
