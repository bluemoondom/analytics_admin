"""Saved view definitions in the application metadata database.

Every view modeled in Analytics Admin is stored here, next to users,
connectors and dashboards, for all database engines. This is the source of
truth: dashboards read the saved SQL, so a report keeps working (and can be
shared) after the source database moves to another server. On Helios
databases view_database also writes each view to TabObecnyPrehled.

Rows are owned by a connector (``connector_id``): the author's connector, or
the recipient's connector for a read-only copy of a shared view. Callers get
rows in the same shape the Helios ``TabObecnyPrehled`` rows had (``ID``,
``NazevSys``, ``Nazev``, ``DefView``, ``Autor``, ``DatPorizeni``,
``Poznamka``), so the modeling, sharing and API code works with either.

Views saved by earlier versions into ``dbo.TabObecnyPrehled`` are imported
automatically the first time a connector is used (see :func:`ensure_imported`);
``legacy_id`` links a view to its TabObecnyPrehled row.
"""

from __future__ import annotations

import contextlib
import datetime as dt
import json
import logging
import os
import sqlite3
import threading
from typing import Any

from src.web.config import get_settings

logger = logging.getLogger(__name__)

_SQLITE_SCHEMA = (
    """
    CREATE TABLE IF NOT EXISTS saved_views (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        connector_id INTEGER,
        name TEXT NOT NULL,
        def_view TEXT NOT NULL,
        note TEXT,
        author TEXT,
        legacy_id INTEGER,
        created_at TEXT,
        updated_at TEXT,
        UNIQUE (connector_id, name)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS saved_view_imports (
        connector_id INTEGER PRIMARY KEY,
        imported_at TEXT,
        imported_count INTEGER,
        message TEXT
    )
    """,
)

_MSSQL_SCHEMA = (
    """
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'saved_views')
    CREATE TABLE saved_views (
        id INT IDENTITY(1,1) PRIMARY KEY,
        connector_id INT NULL,
        name NVARCHAR(255) NOT NULL,
        def_view NVARCHAR(MAX) NOT NULL,
        note NVARCHAR(MAX) NULL,
        author NVARCHAR(255) NULL,
        legacy_id INT NULL,
        created_at DATETIME2 NULL,
        updated_at DATETIME2 NULL,
        CONSTRAINT ux_saved_views UNIQUE (connector_id, name)
    )
    """,
    """
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'saved_view_imports')
    CREATE TABLE saved_view_imports (
        connector_id INT NOT NULL PRIMARY KEY,
        imported_at DATETIME2 NULL,
        imported_count INT NULL,
        message NVARCHAR(2000) NULL
    )
    """,
)

_COLUMNS = ("id", "connector_id", "name", "def_view", "note", "author", "legacy_id", "created_at", "updated_at")


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _text_time(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return value.strftime("%Y-%m-%d %H:%M:%S")


def to_view_row(record: dict[str, Any] | None) -> dict[str, Any] | None:
    """Return a catalog record in the TabObecnyPrehled row shape used by callers."""
    if not record:
        return None
    return {
        "ID": record["id"],
        "NazevSys": record["name"],
        "Nazev": record["name"],
        "DefView": record["def_view"],
        "Autor": record.get("author") or "",
        "DatPorizeni": _text_time(record.get("created_at")),
        "Poznamka": record.get("note") or "",
        "ConnectorId": record.get("connector_id"),
    }


class ViewCatalog:
    """Persistence of saved views in the application metadata database."""

    _ready_backends: set[str] = set()

    def __init__(self) -> None:
        settings = get_settings()
        self.backend = settings.DASHBOARD_STORAGE_BACKEND
        self._sqlite_path = os.path.abspath(settings.DASHBOARD_DB_PATH)
        key = f"{self.backend}:{self._sqlite_path}"
        if key not in ViewCatalog._ready_backends:
            self._ensure_tables()
            ViewCatalog._ready_backends.add(key)

    # -- low level ---------------------------------------------------------
    def _mssql(self):
        from src.web.services.user_storage import UserStorage

        return UserStorage._mssql_connect()

    def _ensure_tables(self) -> None:
        if self.backend == "mssql":
            with self._mssql() as conn, conn.cursor() as cur:
                for statement in _MSSQL_SCHEMA:
                    cur.execute(statement)
                conn.commit()
        else:
            os.makedirs(os.path.dirname(self._sqlite_path), exist_ok=True)
            with sqlite3.connect(self._sqlite_path) as conn:
                for statement in _SQLITE_SCHEMA:
                    conn.execute(statement)
                conn.commit()

    def _query(self, sql: str, params: tuple = ()) -> list[dict[str, Any]]:
        if self.backend == "mssql":
            with self._mssql() as conn, conn.cursor(as_dict=True) as cur:
                cur.execute(sql.replace("?", "%s"), params)
                return list(cur.fetchall())
        with sqlite3.connect(self._sqlite_path) as conn:
            conn.row_factory = sqlite3.Row
            return [dict(r) for r in conn.execute(sql, params).fetchall()]

    def _execute(self, sql: str, params: tuple = ()) -> int:
        """Run a statement; returns the number of affected rows."""
        if self.backend == "mssql":
            with self._mssql() as conn, conn.cursor() as cur:
                cur.execute(sql.replace("?", "%s"), params)
                count = cur.rowcount
                conn.commit()
                return count
        with sqlite3.connect(self._sqlite_path) as conn:
            cur = conn.execute(sql, params)
            conn.commit()
            return cur.rowcount

    # -- records -----------------------------------------------------------
    def get(self, view_id: int) -> dict[str, Any] | None:
        rows = self._query(f"SELECT {', '.join(_COLUMNS)} FROM saved_views WHERE id = ?", (int(view_id),))
        return rows[0] if rows else None

    def get_by_name(self, connector_id: int | None, name: str) -> dict[str, Any] | None:
        if connector_id is None:
            rows = self._query(
                f"SELECT {', '.join(_COLUMNS)} FROM saved_views WHERE connector_id IS NULL AND name = ?", (name,)
            )
        else:
            rows = self._query(
                f"SELECT {', '.join(_COLUMNS)} FROM saved_views WHERE connector_id = ? AND name = ?",
                (int(connector_id), name),
            )
        return rows[0] if rows else None

    def list_for_connector(self, connector_id: int | None) -> list[dict[str, Any]]:
        if connector_id is None:
            return self._query(
                f"SELECT {', '.join(_COLUMNS)} FROM saved_views WHERE connector_id IS NULL ORDER BY id DESC"
            )
        return self._query(
            f"SELECT {', '.join(_COLUMNS)} FROM saved_views WHERE connector_id = ? ORDER BY id DESC",
            (int(connector_id),),
        )

    def insert(
        self,
        connector_id: int | None,
        name: str,
        def_view: str,
        note: str,
        author: str,
        legacy_id: int | None = None,
        created_at: str | None = None,
    ) -> int:
        now = _now()
        values = (connector_id, name, def_view, note, author, legacy_id, created_at or now, now)
        cols = "connector_id, name, def_view, note, author, legacy_id, created_at, updated_at"
        if self.backend == "mssql":
            with self._mssql() as conn, conn.cursor() as cur:
                cur.execute(
                    f"INSERT INTO saved_views ({cols}) OUTPUT INSERTED.id VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                    values,
                )
                new_id = cur.fetchone()[0]
                conn.commit()
            return int(new_id)
        with sqlite3.connect(self._sqlite_path) as conn:
            cur = conn.execute(f"INSERT INTO saved_views ({cols}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", values)
            conn.commit()
            return int(cur.lastrowid)

    def update(self, view_id: int, *, name: str, def_view: str, note: str) -> None:
        self._execute(
            "UPDATE saved_views SET name = ?, def_view = ?, note = ?, updated_at = ? WHERE id = ?",
            (name, def_view, note, _now(), int(view_id)),
        )

    def set_legacy_id(self, view_id: int, legacy_id: int | None) -> None:
        """Link the view to its row in the connector's TabObecnyPrehled."""
        self._execute(
            "UPDATE saved_views SET legacy_id = ? WHERE id = ?",
            (None if legacy_id is None else int(legacy_id), int(view_id)),
        )

    def delete(self, view_id: int) -> None:
        self._execute("DELETE FROM saved_views WHERE id = ?", (int(view_id),))

    # -- legacy import bookkeeping ------------------------------------------
    def import_done(self, connector_id: int) -> bool:
        return bool(self._query("SELECT connector_id FROM saved_view_imports WHERE connector_id = ?", (int(connector_id),)))

    def mark_imported(self, connector_id: int, count: int, message: str = "") -> None:
        self._execute("DELETE FROM saved_view_imports WHERE connector_id = ?", (int(connector_id),))
        self._execute(
            "INSERT INTO saved_view_imports (connector_id, imported_at, imported_count, message) VALUES (?, ?, ?, ?)",
            (int(connector_id), _now(), int(count), message[:1900]),
        )


# ---------------------------------------------------------------------------
# Import of views saved by earlier versions into dbo.TabObecnyPrehled
# ---------------------------------------------------------------------------
_import_lock = threading.Lock()
_import_attempted: set[int] = set()


def _decode_note(value: Any) -> dict[str, Any]:
    text = (value or "").strip() if isinstance(value, str) else ""
    if text.startswith("{"):
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass
    return {"description": text} if text else {}


def _read_tab_obecny_prehled(connector) -> list[dict[str, Any]] | None:
    """Read rows of dbo.TabObecnyPrehled through the connector.

    Returns None when the table is missing or the database user cannot read it.
    """
    from src.web.db import _fetchall_as_dicts, _tab_obecny_prehled_exists
    from src.web.dialects import dialect_for_connector
    from src.web.services.view_modeling import _conn_with_cursor

    dialect = dialect_for_connector(connector)
    with _conn_with_cursor(connector) as (conn, cur):
        if not _tab_obecny_prehled_exists(conn, dialect):
            return None
        attempts = (
            # User rows only (Helios keeps thousands of system overviews there).
            "SELECT ID, NazevSys, Nazev, DefView, Autor, DatPorizeni, Poznamka, Systemovy "
            "FROM dbo.TabObecnyPrehled WHERE Systemovy = 0 ORDER BY ID",
            # Minimal column set for tables without some of the Helios columns.
            "SELECT ID, NazevSys, DefView, Poznamka FROM dbo.TabObecnyPrehled ORDER BY ID",
        )
        last_error: Exception | None = None
        for sql in attempts:
            try:
                cur.execute(sql)
                return _fetchall_as_dicts(cur)
            except Exception as exc:  # column missing or not readable
                last_error = exc
                with contextlib.suppress(Exception):
                    conn.rollback()
        raise last_error  # type: ignore[misc]


def _belongs_to(connector, note: dict[str, Any], row: dict[str, Any]) -> bool:
    """Whether a legacy row was visible to this connector as its own view."""
    owner = note.get("connector_id")
    if owner is not None:
        return owner == connector.id
    # Rows without an owner were shown to every connector of the same DB user
    # unless the connector lists only views created by Analytics Admin.
    from src.web.services.view_modeling import is_analytics_admin_only

    if is_analytics_admin_only(connector):
        return False
    return (row.get("Autor") or "") == (connector.db_user or "") and not row.get("Systemovy")


def ensure_imported(connector) -> None:
    """Copy the connector's views from TabObecnyPrehled into the catalog once.

    Runs at most once per connector (recorded in ``saved_view_imports``). When
    the table is missing or not readable (e.g. a database user without rights
    to it) the attempt is not recorded and is repeated after a restart; within
    one run of the application it is tried once.
    """
    if connector is None or getattr(connector, "id", None) is None:
        return
    connector_id = int(connector.id)
    if connector_id in _import_attempted:
        return
    with _import_lock:
        if connector_id in _import_attempted:
            return
        _import_attempted.add(connector_id)
        catalog = ViewCatalog()
        if catalog.import_done(connector_id):
            return
        from src.web.dialects import dialect_for_connector

        if not dialect_for_connector(connector).list_tables_via_tabobecny_prehled():
            catalog.mark_imported(connector_id, 0, "not a Helios database engine")
            return
        try:
            rows = _read_tab_obecny_prehled(connector)
        except Exception as exc:  # unreachable server, missing rights, ...
            logger.warning("Import of saved views for connector %s skipped: %s", connector_id, exc)
            return
        if rows is None:
            # No readable TabObecnyPrehled (another database, or a user without
            # rights to it): nothing recorded, so it is tried again after a
            # restart, e.g. once the rights have been granted.
            return
        try:
            count = _import_rows(catalog, connector, rows)
        except Exception:
            logger.exception("Import of saved views for connector %s failed", connector_id)
            return
        catalog.mark_imported(connector_id, count, "imported from TabObecnyPrehled")
        if count:
            logger.info("Imported %s saved views of connector %s from TabObecnyPrehled", count, connector_id)


def _import_rows(catalog: ViewCatalog, connector, rows: list[dict[str, Any]]) -> int:
    id_map: dict[int, int] = {}
    names: dict[int, str] = {}
    imported: list[tuple[int, dict[str, Any]]] = []
    for row in rows:
        note = _decode_note(row.get("Poznamka"))
        name = (row.get("NazevSys") or row.get("Nazev") or "").strip()
        definition = (row.get("DefView") or "").strip()
        if not name or not definition or not _belongs_to(connector, note, row):
            continue
        if note.get("connector_id") is None:
            note["connector_id"] = connector.id
        existing = catalog.get_by_name(connector.id, name)
        if existing:
            id_map[int(row["ID"])] = int(existing["id"])
            names[int(row["ID"])] = name
            continue
        new_id = catalog.insert(
            connector.id,
            name,
            definition,
            json.dumps(note, ensure_ascii=False),
            row.get("Autor") or connector.db_user or "",
            legacy_id=int(row["ID"]),
            created_at=_text_time(row.get("DatPorizeni")) or None,
        )
        id_map[int(row["ID"])] = new_id
        names[int(row["ID"])] = name
        imported.append((new_id, note))

    # Subviews referenced other rows of TabObecnyPrehled by ID.
    for new_id, note in imported:
        changed = False
        for sv in note.get("subviews") or []:
            old = sv.get("view_id")
            if old is not None and int(old) in id_map:
                sv["view_id"] = id_map[int(old)]
                changed = True
        if changed:
            record = catalog.get(new_id)
            catalog.update(new_id, name=record["name"], def_view=record["def_view"],
                           note=json.dumps(note, ensure_ascii=False))

    # Shares pointed at TabObecnyPrehled IDs of this connector's views.
    if id_map:
        from src.web.services.view_sharing import ShareStorage

        shares = ShareStorage()
        for old, new in id_map.items():
            # The name check keeps shares created after the import untouched.
            shares.remap_view_ids(connector.id, old, new, names.get(old))
    return len(imported)


def ensure_imported_by_id(connector_id: int | None) -> None:
    """Import for a connector known only by id (e.g. the author of a share)."""
    if connector_id is None or int(connector_id) in _import_attempted:
        return
    from src.web.services.user_storage import UserStorage

    connector = UserStorage().get_connector_by_id(int(connector_id))
    if connector is not None:
        ensure_imported(connector)
