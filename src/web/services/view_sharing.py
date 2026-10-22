"""Sharing saved views between users and connectors.

Only the author of a view (the owner of the connector the view was saved
through) can share it. The author enters the recipient connector's share code;
an invitation with a snapshot of the view definition is stored in the
application metadata database. Nothing is written into the recipient's
database until the recipient accepts; an accepted copy is then saved like any
other view (on a Helios database also into its TabObecnyPrehled).

View definitions live in the application metadata database (see
view_catalog). On acceptance there are two cases:

* **Same database** - the recipient connector points to the same database as
  the author's (same engine, server, port and database name). No copy is made;
  the share record alone makes the author's view visible to the recipient,
  always in its current version.
* **Another database** - the view is rebuilt and probed against the
  recipient's database and saved as a read-only copy owned by the recipient
  connector whose note keeps a ``shared_from`` reference to the share.

Recipients never edit shared views. When the author saves a new version,
accepted copies get ``update_available`` and the recipient decides whether to
take it. Revoking (author) or removing (recipient) only hides the view; copies
are not deleted.

The share record is the single source of truth for visibility: a copy whose
share is no longer accepted is hidden, and same-database access exists only
while an accepted share exists.
"""

from __future__ import annotations

import copy
import datetime as dt
import json
import logging
import os
import sqlite3
from typing import Any

from src.web.config import get_settings
from src.web.db import DatabaseError
from src.web.models.user import Connector, User
from src.web.services.user_storage import UserStorage
from src.web.services.view_modeling import (
    ViewModelingError,
    ViewModelingService,
    _conn_with_cursor,
)

logger = logging.getLogger(__name__)

STATUS_PENDING = "pending"
STATUS_ACCEPTED = "accepted"
STATUS_DECLINED = "declined"
STATUS_REVOKED = "revoked"
STATUS_REMOVED = "removed"

MODE_COPY = "copy"
MODE_SAME_DB = "same_db"

ACCESS_OWNER = "owner"
ACCESS_SHARED = "shared"

# Keys of the modeling payload taken from the author's parsed view.
_PAYLOAD_KEYS = (
    "name",
    "description",
    "primary_table",
    "selected_columns",
    "joins",
    "where_clauses",
    "custom_columns",
    "subviews",
    "table_aliases",
    "group_by",
    "order_by",
    "aggregations",
    "api_enabled",
    "api_type",
)


class SharingError(Exception):
    """A sharing action cannot be performed; the message is shown to the user."""


class SharingNotFound(SharingError):
    """The share or view does not exist or is not visible to the user."""


class SharingForbidden(SharingError):
    """The user is not allowed to perform the action."""


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------
_SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS view_shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_user_id INTEGER NOT NULL,
    source_connector_id INTEGER NOT NULL,
    source_view_id INTEGER NOT NULL,
    view_name TEXT NOT NULL,
    target_user_id INTEGER NOT NULL,
    target_connector_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    mode TEXT,
    snapshot TEXT NOT NULL,
    update_available INTEGER NOT NULL DEFAULT 0,
    target_view_id INTEGER,
    message TEXT,
    created_at TEXT,
    updated_at TEXT,
    UNIQUE (source_connector_id, source_view_id, target_connector_id)
)
"""

_MSSQL_SCHEMA = """
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'view_shares')
CREATE TABLE view_shares (
    id INT IDENTITY(1,1) PRIMARY KEY,
    source_user_id INT NOT NULL,
    source_connector_id INT NOT NULL,
    source_view_id INT NOT NULL,
    view_name NVARCHAR(255) NOT NULL,
    target_user_id INT NOT NULL,
    target_connector_id INT NOT NULL,
    status NVARCHAR(20) NOT NULL,
    mode NVARCHAR(20) NULL,
    snapshot NVARCHAR(MAX) NOT NULL,
    update_available BIT NOT NULL DEFAULT 0,
    target_view_id INT NULL,
    message NVARCHAR(2000) NULL,
    created_at DATETIME2 NULL,
    updated_at DATETIME2 NULL,
    CONSTRAINT ux_view_shares UNIQUE (source_connector_id, source_view_id, target_connector_id)
)
"""

_COLUMNS = (
    "id", "source_user_id", "source_connector_id", "source_view_id", "view_name",
    "target_user_id", "target_connector_id", "status", "mode", "snapshot",
    "update_available", "target_view_id", "message", "created_at", "updated_at",
)


def _now() -> str:
    # Naive UTC text is accepted by both SQLite and SQL Server DATETIME2.
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


class ShareStorage:
    """Persistence of share records in the application metadata database."""

    _ready_backends: set[str] = set()

    def __init__(self) -> None:
        settings = get_settings()
        self.backend = settings.DASHBOARD_STORAGE_BACKEND
        self._sqlite_path = os.path.abspath(settings.DASHBOARD_DB_PATH)
        key = f"{self.backend}:{self._sqlite_path}"
        if key not in ShareStorage._ready_backends:
            self._ensure_table()
            ShareStorage._ready_backends.add(key)

    # -- low level ---------------------------------------------------------
    def _mssql(self):
        return UserStorage._mssql_connect()

    def _ensure_table(self) -> None:
        if self.backend == "mssql":
            with self._mssql() as conn, conn.cursor() as cur:
                cur.execute(_MSSQL_SCHEMA)
                conn.commit()
        else:
            os.makedirs(os.path.dirname(self._sqlite_path), exist_ok=True)
            with sqlite3.connect(self._sqlite_path) as conn:
                conn.execute(_SQLITE_SCHEMA)
                conn.commit()

    def _query(self, sql: str, params: tuple = ()) -> list[dict[str, Any]]:
        if self.backend == "mssql":
            with self._mssql() as conn, conn.cursor(as_dict=True) as cur:
                cur.execute(sql.replace("?", "%s"), params)
                rows = cur.fetchall()
        else:
            with sqlite3.connect(self._sqlite_path) as conn:
                conn.row_factory = sqlite3.Row
                rows = [dict(r) for r in conn.execute(sql, params).fetchall()]
        return [self._normalize(r) for r in rows]

    def _execute(self, sql: str, params: tuple = ()) -> None:
        if self.backend == "mssql":
            with self._mssql() as conn, conn.cursor() as cur:
                cur.execute(sql.replace("?", "%s"), params)
                conn.commit()
        else:
            with sqlite3.connect(self._sqlite_path) as conn:
                conn.execute(sql, params)
                conn.commit()

    @staticmethod
    def _normalize(row: dict[str, Any]) -> dict[str, Any]:
        out = {k: row.get(k) for k in _COLUMNS}
        out["update_available"] = bool(out.get("update_available"))
        for key in ("created_at", "updated_at"):
            value = out.get(key)
            if value is not None and not isinstance(value, str):
                out[key] = value.strftime("%Y-%m-%d %H:%M:%S")
        try:
            out["snapshot"] = json.loads(out.get("snapshot") or "{}")
        except (TypeError, json.JSONDecodeError):
            out["snapshot"] = {}
        return out

    # -- records -----------------------------------------------------------
    def get(self, share_id: int) -> dict[str, Any] | None:
        rows = self._query("SELECT * FROM view_shares WHERE id = ?", (share_id,))
        return rows[0] if rows else None

    def find(self, source_connector_id: int, source_view_id: int, target_connector_id: int) -> dict[str, Any] | None:
        rows = self._query(
            "SELECT * FROM view_shares WHERE source_connector_id = ? AND source_view_id = ? "
            "AND target_connector_id = ?",
            (source_connector_id, source_view_id, target_connector_id),
        )
        return rows[0] if rows else None

    def for_view(self, source_connector_id: int, source_view_id: int) -> list[dict[str, Any]]:
        return self._query(
            "SELECT * FROM view_shares WHERE source_connector_id = ? AND source_view_id = ? ORDER BY id",
            (source_connector_id, source_view_id),
        )

    def for_target_user(self, target_user_id: int) -> list[dict[str, Any]]:
        return self._query(
            "SELECT * FROM view_shares WHERE target_user_id = ? ORDER BY updated_at DESC, id DESC",
            (target_user_id,),
        )

    def active_for_target_connector(self, target_connector_id: int) -> list[dict[str, Any]]:
        return self._query(
            "SELECT * FROM view_shares WHERE target_connector_id = ? AND status = ?",
            (target_connector_id, STATUS_ACCEPTED),
        )

    def create(self, record: dict[str, Any]) -> int:
        now = _now()
        cols = [
            "source_user_id", "source_connector_id", "source_view_id", "view_name",
            "target_user_id", "target_connector_id", "status", "mode", "snapshot",
            "update_available", "target_view_id", "message", "created_at", "updated_at",
        ]
        values = (
            record["source_user_id"], record["source_connector_id"], record["source_view_id"],
            record["view_name"], record["target_user_id"], record["target_connector_id"],
            record.get("status", STATUS_PENDING), record.get("mode"),
            json.dumps(record.get("snapshot") or {}, ensure_ascii=False),
            1 if record.get("update_available") else 0, record.get("target_view_id"),
            record.get("message"), now, now,
        )
        placeholders = ", ".join("?" for _ in cols)
        if self.backend == "mssql":
            with self._mssql() as conn, conn.cursor() as cur:
                cur.execute(
                    f"INSERT INTO view_shares ({', '.join(cols)}) OUTPUT INSERTED.id "
                    f"VALUES ({placeholders.replace('?', '%s')})",
                    values,
                )
                new_id = cur.fetchone()[0]
                conn.commit()
            return int(new_id)
        with sqlite3.connect(self._sqlite_path) as conn:
            cur = conn.execute(
                f"INSERT INTO view_shares ({', '.join(cols)}) VALUES ({placeholders})", values
            )
            conn.commit()
            return int(cur.lastrowid)

    def remap_view_ids(self, connector_id: int, old_id: int, new_id: int, view_name: str | None = None) -> None:
        """Point shares at a view's new id after it was imported into the catalog."""
        name_clause = " AND view_name = ?" if view_name else ""
        extra = (view_name,) if view_name else ()
        self._execute(
            "UPDATE view_shares SET source_view_id = ? WHERE source_connector_id = ? AND source_view_id = ?" + name_clause,
            (new_id, connector_id, old_id, *extra),
        )
        self._execute(
            "UPDATE view_shares SET target_view_id = ? WHERE target_connector_id = ? AND target_view_id = ?" + name_clause,
            (new_id, connector_id, old_id, *extra),
        )
        # Live (same database) shares point their target at the author's view.
        self._execute(
            "UPDATE view_shares SET target_view_id = ? WHERE source_connector_id = ? AND mode = ? "
            "AND target_view_id = ?" + name_clause,
            (new_id, connector_id, MODE_SAME_DB, old_id, *extra),
        )

    def update(self, share_id: int, **fields: Any) -> None:
        if not fields:
            return
        fields["updated_at"] = _now()
        if "snapshot" in fields:
            fields["snapshot"] = json.dumps(fields["snapshot"] or {}, ensure_ascii=False)
        if "update_available" in fields:
            fields["update_available"] = 1 if fields["update_available"] else 0
        assignments = ", ".join(f"{k} = ?" for k in fields)
        self._execute(
            f"UPDATE view_shares SET {assignments} WHERE id = ?", (*fields.values(), share_id)
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _decode_note(service: ViewModelingService, row: dict[str, Any] | None) -> dict[str, Any]:
    return service._decode_view_note((row or {}).get("Poznamka") or "")


def _is_owner_note(service: ViewModelingService, row: dict[str, Any], connector: Connector) -> bool:
    """True when the connector is the author of the view row."""
    note = _decode_note(service, row)
    if note.get("shared_from"):
        return False
    owner = note.get("connector_id")
    if owner is None:
        # Rows without an owner in the note belong to the connector holding them.
        owner = row.get("ConnectorId")
    return owner == connector.id


def _user_label(storage: UserStorage, user_id: int | None) -> str:
    if user_id is None:
        return ""
    user = storage.get_user_by_id(int(user_id))
    return user.email if user else ""


def _connector_label(storage: UserStorage, connector_id: int | None) -> str:
    if connector_id is None:
        return ""
    connector = storage.get_connector_by_id(int(connector_id))
    return connector.name if connector else ""


def _probe_sql(service: ViewModelingService, sql: str) -> None:
    """Execute the view SQL in the target database without reading data."""
    from src.web.dialects import dialect_for_connector

    dialect = dialect_for_connector(service.connector)
    probe = dialect.limit_first_row_sql(f"({sql}) AS sq")
    with _conn_with_cursor(service.connector) as (_conn, cur):
        try:
            cur.execute(probe)
            cur.fetchone()
        except Exception as exc:
            raise DatabaseError(f"View ve vaší databázi nejde spustit: {exc}") from exc


def _snapshot(service: ViewModelingService, view_id: int) -> dict[str, Any]:
    """Capture the author's view as a modeling payload plus display data."""
    row = service.get_saved_view(view_id)
    parsed = service.parse_saved_view(view_id) if row else None
    if not row or not parsed:
        raise SharingNotFound("View nebylo nalezeno.")
    payload = {key: copy.deepcopy(parsed.get(key)) for key in _PAYLOAD_KEYS}
    if not payload.get("name"):
        raise SharingError("View nemá název.")
    subview_names: dict[str, str] = {}
    for sv in payload.get("subviews") or []:
        sv_id = sv.get("view_id")
        if not sv_id:
            continue
        try:
            sv_row = service.get_saved_view(int(sv_id))
        except (DatabaseError, ValueError, TypeError):
            sv_row = None
        if sv_row and sv_row.get("NazevSys"):
            subview_names[str(sv_id)] = sv_row["NazevSys"]
    return {
        "payload": payload,
        "subview_names": subview_names,
        "sql": row.get("DefView") or "",
        "name": row.get("NazevSys") or payload["name"],
        "description": payload.get("description") or "",
        "taken_at": _now(),
    }


# ---------------------------------------------------------------------------
# Access (used by routers, the view list and the public API)
# ---------------------------------------------------------------------------
def view_access(
    service: ViewModelingService, row: dict[str, Any] | None
) -> tuple[str | None, dict[str, Any] | None]:
    """Return (access, share) of the service's connector to a saved view row.

    ``access`` is ``"owner"``, ``"shared"`` (read-only) or ``None``.
    """
    connector = service.connector
    if not row or connector is None:
        return (ACCESS_OWNER if row and connector is None else None), None
    note = _decode_note(service, row)
    shared_from = note.get("shared_from") or {}
    storage = ShareStorage()
    if shared_from:
        # A copy in the recipient's database: visible while its share is accepted.
        share = storage.get(int(shared_from.get("share_id") or 0))
        if (
            share
            and share["status"] == STATUS_ACCEPTED
            and share["target_connector_id"] == connector.id
        ):
            return ACCESS_SHARED, share
        return None, None
    if _is_owner_note(service, row, connector):
        return ACCESS_OWNER, None
    owner = note.get("connector_id")
    if owner is not None:
        share = storage.find(int(owner), int(row.get("ID")), connector.id)
        if share and share["status"] == STATUS_ACCEPTED and share["mode"] == MODE_SAME_DB:
            return ACCESS_SHARED, share
    return None, None


def annotate_saved_views(service: ViewModelingService, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Filter and annotate the connector's view list with sharing information.

    Removes copies whose share is no longer accepted, adds views shared from the
    same database and sets ``access`` / ``shared_by`` / ``share_id`` on each row.
    """
    connector = service.connector
    if connector is None:
        for r in rows:
            r["access"] = ACCESS_OWNER
        return rows
    storage = ShareStorage()
    users = UserStorage()
    active = {s["id"]: s for s in storage.active_for_target_connector(connector.id)}
    result: list[dict[str, Any]] = []
    seen_ids: set[Any] = set()
    for r in rows:
        note = _decode_note(service, r)
        shared_from = note.get("shared_from") or {}
        if shared_from:
            share = active.get(int(shared_from.get("share_id") or 0))
            if not share:
                continue
            r.update(access=ACCESS_SHARED, share_id=share["id"],
                     shared_by=_user_label(users, share["source_user_id"]),
                     update_available=share["update_available"])
        else:
            r["access"] = ACCESS_OWNER
        result.append(r)
        seen_ids.add(r.get("ID"))
    # Views shared from the same database are rows of the author; fetch them by id.
    for share in active.values():
        if share["mode"] != MODE_SAME_DB or share["source_view_id"] in seen_ids:
            continue
        try:
            row = service.get_saved_view(int(share["source_view_id"]))
        except DatabaseError:
            row = None
        if not row or row.get("NazevSys") != share["view_name"]:
            continue
        row.update(access=ACCESS_SHARED, share_id=share["id"],
                   shared_by=_user_label(users, share["source_user_id"]),
                   update_available=False)
        result.append(row)
        seen_ids.add(row.get("ID"))
    return result


# ---------------------------------------------------------------------------
# Author actions
# ---------------------------------------------------------------------------
def resolve_target(code: str, source: Connector) -> tuple[Connector, User]:
    users = UserStorage()
    target = users.get_connector_by_share_uuid(code)
    if target is None or target.user_id is None:
        raise SharingNotFound("Konektor s tímto kódem neexistuje.")
    if target.id == source.id:
        raise SharingError("View nelze sdílet na konektor, ze kterého pochází.")
    owner = users.get_user_by_id(int(target.user_id))
    if owner is None or not owner.is_active:
        raise SharingNotFound("Konektor s tímto kódem neexistuje.")
    return target, owner


def describe_target(code: str, source: Connector) -> dict[str, Any]:
    target, owner = resolve_target(code, source)
    return {"connector_name": target.name, "user_email": owner.email}


def _require_author(service: ViewModelingService, view_id: int) -> dict[str, Any]:
    row = service.get_saved_view(view_id)
    if not row:
        raise SharingNotFound("View nebylo nalezeno.")
    note = _decode_note(service, row)
    if note.get("shared_from") or note.get("connector_id") != service.connector.id:
        raise SharingForbidden("Sdílet a spravovat sdílení může jen autor view.")
    return row


def share_view(user: User, source: Connector, view_id: int, code: str) -> dict[str, Any]:
    """Create (or renew) an invitation for the connector with the given code."""
    target, owner = resolve_target(code, source)
    share_id = share_view_to_connector(user, source, view_id, target, owner)
    return share_summary(ShareStorage().get(share_id), for_author=True)


def share_view_to_connector(
    user: User, source: Connector, view_id: int, target: Connector, owner: User
) -> int:
    """Create (or renew) an invitation of the view for a known target connector.

    Used by the share-code dialog and when a view is shared together with a
    dashboard. Returns the share id.
    """
    if target.id == source.id:
        raise SharingError("View nelze sdílet na konektor, ze kterého pochází.")
    service = ViewModelingService(connector=source)
    row = _require_author(service, view_id)
    snapshot = _snapshot(service, view_id)
    storage = ShareStorage()
    existing = storage.find(source.id, view_id, target.id)
    if existing is None:
        share_id = storage.create({
            "source_user_id": user.id,
            "source_connector_id": source.id,
            "source_view_id": view_id,
            "view_name": row.get("NazevSys") or snapshot["name"],
            "target_user_id": owner.id,
            "target_connector_id": target.id,
            "status": STATUS_PENDING,
            "snapshot": snapshot,
        })
    else:
        share_id = existing["id"]
        if existing["status"] == STATUS_ACCEPTED:
            # Already shared: offer the current version as an update to copies.
            storage.update(share_id, snapshot=snapshot,
                           update_available=existing["mode"] == MODE_COPY, message=None)
        else:
            storage.update(share_id, status=STATUS_PENDING, snapshot=snapshot,
                           update_available=False, message=None,
                           view_name=row.get("NazevSys") or snapshot["name"])
    return int(share_id)


def list_view_shares(source: Connector, view_id: int) -> list[dict[str, Any]]:
    service = ViewModelingService(connector=source)
    _require_author(service, view_id)
    return [share_summary(s, for_author=True) for s in ShareStorage().for_view(source.id, view_id)]


def revoke_share(user: User, share_id: int) -> dict[str, Any]:
    storage = ShareStorage()
    share = storage.get(share_id)
    if not share or share["source_user_id"] != user.id:
        raise SharingNotFound("Sdílení nebylo nalezeno.")
    storage.update(share_id, status=STATUS_REVOKED, update_available=False)
    return share_summary(storage.get(share_id), for_author=True)


def on_view_saved(source: Connector | None, view_id: int | None) -> None:
    """Refresh invitations after the author saved a new version of the view."""
    if source is None or not view_id:
        return
    storage = ShareStorage()
    shares = [s for s in storage.for_view(source.id, int(view_id))
              if s["status"] in (STATUS_PENDING, STATUS_ACCEPTED)]
    if not shares:
        return
    service = ViewModelingService(connector=source)
    try:
        snapshot = _snapshot(service, int(view_id))
    except SharingError:
        return
    for share in shares:
        if share["status"] == STATUS_PENDING:
            storage.update(share["id"], snapshot=snapshot, view_name=snapshot["name"])
        elif share["mode"] == MODE_COPY:
            storage.update(share["id"], snapshot=snapshot, update_available=True)
        # Same-database shares read the author's row directly; nothing to do.


def on_view_deleted(source: Connector | None, view_id: int) -> None:
    if source is None:
        return
    storage = ShareStorage()
    for share in storage.for_view(source.id, int(view_id)):
        if share["status"] in (STATUS_PENDING, STATUS_ACCEPTED):
            storage.update(share["id"], status=STATUS_REVOKED, update_available=False)


# ---------------------------------------------------------------------------
# Recipient actions
# ---------------------------------------------------------------------------
def _require_recipient(user: User, share_id: int) -> tuple[ShareStorage, dict[str, Any], Connector]:
    storage = ShareStorage()
    share = storage.get(share_id)
    if not share or share["target_user_id"] != user.id:
        raise SharingNotFound("Sdílení nebylo nalezeno.")
    target = UserStorage().get_connector_by_id(int(share["target_connector_id"]))
    if target is None or target.user_id != user.id:
        raise SharingNotFound("Sdílení nebylo nalezeno.")
    return storage, share, target


def incoming_shares(user: User) -> list[dict[str, Any]]:
    """Invitations and available updates waiting for the user's decision."""
    rows = ShareStorage().for_target_user(user.id)
    waiting = [s for s in rows if s["status"] == STATUS_PENDING
               or (s["status"] == STATUS_ACCEPTED and s["update_available"])]
    return [share_summary(s, for_author=False) for s in waiting]


def share_detail(user: User, share_id: int) -> dict[str, Any]:
    storage = ShareStorage()
    share = storage.get(share_id)
    if not share or user.id not in (share["target_user_id"], share["source_user_id"]):
        raise SharingNotFound("Sdílení nebylo nalezeno.")
    summary = share_summary(share, for_author=share["source_user_id"] == user.id)
    snap = share.get("snapshot") or {}
    payload = snap.get("payload") or {}
    summary.update(
        sql=snap.get("sql") or "",
        description=snap.get("description") or "",
        primary_table=payload.get("primary_table") or "",
        columns=[
            (c.get("alias") or c.get("name"))
            for c in (payload.get("selected_columns") or []) if c.get("name")
        ] + [c.get("alias") for c in (payload.get("custom_columns") or []) if c.get("alias")],
        tables=sorted({
            *(t for t in [payload.get("primary_table")] if t),
            *((payload.get("table_aliases") or {}).values()),
            *(j.get("right_table") for j in (payload.get("joins") or []) if j.get("right_table")),
        }),
    )
    return summary


_DEFAULT_PORTS = {"mssql": 1433, "mysql": 3306, "mariadb": 3306, "postgresql": 5432, "postgres": 5432}
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "(local)", "."}


def database_identity(connector: Connector) -> tuple[str, str, int, str]:
    """Normalized (engine, server, port, database) a connector points to."""
    engine = (connector.db_type or "mssql").strip().lower()
    if engine == "sqlite":
        return engine, "", 0, os.path.abspath(connector.db_name or "").lower()
    host = (connector.db_host or "").strip().lower()
    if host.startswith("tcp:"):
        host = host[4:]
    port = int(connector.db_port or 0)
    if "," in host:  # SQL Server "server,port"
        host, _, port_text = host.partition(",")
        if port_text.strip().isdigit():
            port = int(port_text.strip())
    host = host.rstrip(".")
    server, _, instance = host.partition("\\")
    if server in _LOCAL_HOSTS:
        server = "localhost"
    host = server + ("\\" + instance if instance else "")
    return engine, host, port or _DEFAULT_PORTS.get(engine, 0), (connector.db_name or "").strip().lower()


def _same_database_row(service: ViewModelingService, share: dict[str, Any]) -> dict[str, Any] | None:
    """Return the author's view if the recipient connector uses the same database."""
    from src.web.services.view_catalog import ViewCatalog, ensure_imported_by_id, to_view_row

    source = UserStorage().get_connector_by_id(int(share["source_connector_id"]))
    if source is None or service.connector is None:
        return None
    if database_identity(source) != database_identity(service.connector):
        return None
    ensure_imported_by_id(source.id)
    record = ViewCatalog().get(int(share["source_view_id"]))
    if not record or record.get("connector_id") != source.id or record.get("name") != share["view_name"]:
        return None
    if _decode_note(service, {"Poznamka": record.get("note")}).get("shared_from"):
        return None
    return to_view_row(record)


def _copy_payload(service: ViewModelingService, share: dict[str, Any], target: Connector) -> dict[str, Any]:
    snap = share.get("snapshot") or {}
    payload = copy.deepcopy(snap.get("payload") or {})
    if not payload.get("name"):
        raise SharingError("Sdílení neobsahuje definici view.")
    payload["connector_id"] = target.id
    payload["api_put_enabled"] = False  # recipients never write through a shared view
    payload["shared_from"] = {
        "share_id": share["id"],
        "connector_id": share["source_connector_id"],
        "view_id": share["source_view_id"],
    }
    subview_names = snap.get("subview_names") or {}
    for sv in payload.get("subviews") or []:
        name = subview_names.get(str(sv.get("view_id")))
        sv["view_id"] = service._existing_view_id(name) if name else None
    return payload


def accept_share(user: User, share_id: int) -> dict[str, Any]:
    storage, share, target = _require_recipient(user, share_id)
    is_update = share["status"] == STATUS_ACCEPTED and share["update_available"]
    if share["status"] != STATUS_PENDING and not is_update:
        raise SharingError("Sdílení už nečeká na přijetí.")

    service = ViewModelingService(connector=target)
    try:
        same_row = _same_database_row(service, share)
        if same_row is not None:
            own = service._existing_view_id(same_row.get("NazevSys") or "")
            if own is not None:
                raise SharingError(
                    f"Mezi vašimi views už je view s názvem {same_row.get('NazevSys')}. "
                    "Přejmenujte nebo smažte své view a sdílení přijměte znovu."
                )
            _probe_sql(service, same_row.get("DefView") or "")
            storage.update(share_id, status=STATUS_ACCEPTED, mode=MODE_SAME_DB,
                           target_view_id=same_row.get("ID"), update_available=False, message=None)
            return {**share_summary(storage.get(share_id), for_author=False),
                    "result": "same_db"}

        payload = _copy_payload(service, share, target)
        name = service._helios_view_name(payload["name"])
        existing_id = service._existing_view_id(name)
        if existing_id is not None:
            existing = service.get_saved_view(existing_id) or {}
            origin = _decode_note(service, existing).get("shared_from") or {}
            if int(origin.get("share_id") or 0) != share_id:
                raise SharingError(
                    f"Mezi vašimi views už je view s názvem {name}. "
                    "Přejmenujte nebo smažte své view a sdílení přijměte znovu."
                )
        sql = service.build_sql(payload)
        _probe_sql(service, sql)
        if existing_id is not None:
            saved = service.update_view(existing_id, payload)
            target_view_id = existing_id
        else:
            saved = service.save_view(payload)
            if not saved.get("saved"):
                raise SharingError(saved.get("reason") or "View se nepodařilo uložit.")
            target_view_id = service._existing_view_id(name)
    except (SharingError, ViewModelingError, DatabaseError) as exc:
        storage.update(share_id, message=str(exc)[:1900])
        raise SharingError(str(exc)) from exc
    except Exception as exc:  # connection or driver failure
        logger.exception("Accepting share %s failed", share_id)
        storage.update(share_id, message=f"Přijetí selhalo: {exc}"[:1900])
        raise SharingError(f"Přijetí selhalo: {exc}") from exc

    storage.update(share_id, status=STATUS_ACCEPTED, mode=MODE_COPY,
                   target_view_id=target_view_id, update_available=False, message=None)
    return {**share_summary(storage.get(share_id), for_author=False),
            "result": "updated" if is_update else "copied",
            "warnings": saved.get("warnings") or []}


def decline_share(user: User, share_id: int) -> dict[str, Any]:
    storage, share, _target = _require_recipient(user, share_id)
    if share["status"] == STATUS_PENDING:
        storage.update(share_id, status=STATUS_DECLINED, message=None)
    elif share["status"] == STATUS_ACCEPTED and share["update_available"]:
        # Keep the accepted version, skip this update.
        storage.update(share_id, update_available=False)
    else:
        raise SharingError("Sdílení už nečeká na rozhodnutí.")
    return share_summary(storage.get(share_id), for_author=False)


def remove_share(user: User, share_id: int) -> dict[str, Any]:
    """Recipient removes a shared view from their list (a copy is only hidden)."""
    storage, share, _target = _require_recipient(user, share_id)
    if share["status"] != STATUS_ACCEPTED:
        raise SharingError("View není sdílené.")
    storage.update(share_id, status=STATUS_REMOVED, update_available=False)
    return share_summary(storage.get(share_id), for_author=False)


# ---------------------------------------------------------------------------
# Presentation
# ---------------------------------------------------------------------------
def share_summary(share: dict[str, Any] | None, *, for_author: bool) -> dict[str, Any]:
    if not share:
        return {}
    users = UserStorage()
    summary = {
        "id": share["id"],
        "view_name": share["view_name"],
        "status": share["status"],
        "mode": share["mode"],
        "update_available": share["update_available"],
        "message": share.get("message") or "",
        "updated_at": share.get("updated_at"),
        "description": (share.get("snapshot") or {}).get("description") or "",
    }
    if for_author:
        summary.update(
            target_email=_user_label(users, share["target_user_id"]),
            target_connector_name=_connector_label(users, share["target_connector_id"]),
        )
    else:
        summary.update(
            source_email=_user_label(users, share["source_user_id"]),
            target_connector_id=share["target_connector_id"],
            target_connector_name=_connector_label(users, share["target_connector_id"]),
        )
    return summary
