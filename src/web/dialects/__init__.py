"""Database dialect registry for source (analytical) databases.

Each supported database provides a :class:`SourceDialect` describing how to
connect to it and how to express SQL syntax details (identifier quoting,
row-limiting, metadata queries, type display, index discovery, ...).  Existing
MSSQL-oriented services keep their shared logic; the dialect supplies the
per-database parts so features such as index discovery show up only when the
database supports them.
"""

from __future__ import annotations

from src.web.dialects.base import SourceDialect
from src.web.dialects.mssql import MSSQLDialect
from src.web.dialects.mysql import MySQLDialect
from src.web.dialects.postgresql import PostgreSQLDialect
from src.web.dialects.sqlite import SQLiteDialect

_DIALECTS: dict[str, SourceDialect] = {
    d.name: d for d in (MSSQLDialect(), MySQLDialect(), PostgreSQLDialect(), SQLiteDialect())
}


def dialect_names() -> list[str]:
    """Return supported database types."""
    return list(_DIALECTS)


def get_dialect(name: str | None) -> SourceDialect:
    """Return the dialect for ``name``; MSSQL is the safe default."""
    if not name:
        return _DIALECTS[MSSQLDialect.name]
    d = _DIALECTS.get(name.strip().lower())
    if d is not None:
        return d
    return _DIALECTS[MSSQLDialect.name]


def dialect_for_connector(connector=None) -> SourceDialect:
    """Resolve the dialect for a connector (or the legacy default MSSQL)."""
    name = getattr(connector, "db_type", None) or "mssql"
    return get_dialect(name)
