"""Sharing whole dashboards between users.

The author shares a dashboard with another user by e-mail. The invitation
stores a snapshot of the dashboard definition in the application metadata
database; the recipient accepts or declines it after signing in.

* **Own copy** - accepting creates an ordinary, editable dashboard of the
  recipient that reads data through the connector the recipient chose. When
  the author saves a new version, the recipient is offered the update (taking
  it replaces the copy's definition) and may decline it.
* **Views** - a dashboard reads one view or table. Before sending, the author
  sees whether the recipient already has a view of that name; when the view is
  the author's own saved view it can be shared together with the dashboard.
  The view share is then created for the connector the recipient picks and
  accepted in the same step (it is an ordinary view share afterwards, listed
  and revocable in View modeling).
* **Connector** - on acceptance the recipient picks one of their connectors;
  only connectors where the view is available (or will be, via the shared
  view) and has all columns the dashboard uses can be picked.
* **Revoking** - the author can revoke an invitation or an accepted share at
  any time. A revoked copy is hidden from the recipient (not deleted, so
  sharing it again brings it back). A recipient who deletes the copy ends the
  share from their side.

Only existing, active users can receive a dashboard; an unknown e-mail is
refused with a message that does not reveal anything beyond that.
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
from src.web.models.dashboard import Dashboard
from src.web.models.user import Connector, User
from src.web.services import view_sharing
from src.web.services.user_storage import UserStorage
from src.web.services.view_modeling import ViewModelingService

logger = logging.getLogger(__name__)

STATUS_PENDING = "pending"
STATUS_ACCEPTED = "accepted"
STATUS_DECLINED = "declined"
STATUS_REVOKED = "revoked"
STATUS_REMOVED = "removed"

# Connector evaluation for the recipient
CONN_READY = "ready"            # the view exists and has every column the dashboard uses
CONN_WILL_SHARE = "will_share"  # the view is missing; the author's view will be shared
CONN_MISSING = "missing"        # the view or table is missing and cannot be shared
CONN_MISSING_COLUMNS = "missing_columns"
CONN_CONFLICT = "conflict"      # another view of that name exists without the needed columns


class DashboardSharingError(Exception):
    """A sharing action cannot be performed; the message is shown to the user."""


class DashboardShareNotFound(DashboardSharingError):
    """The share or dashboard does not exist or is not visible to the user."""


_SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS dashboard_shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_user_id INTEGER NOT NULL,
    source_dashboard_id INTEGER NOT NULL,
    source_connector_id INTEGER,
    dashboard_name TEXT NOT NULL,
    view_name TEXT NOT NULL,
    target_user_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    snapshot TEXT NOT NULL,
    share_view_id INTEGER,
    update_available INTEGER NOT NULL DEFAULT 0,
    target_connector_id INTEGER,
    target_dashboard_id INTEGER,
    view_share_id INTEGER,
    message TEXT,
    created_at TEXT,
    updated_at TEXT,
    UNIQUE (source_dashboard_id, target_user_id)
)
"""

_MSSQL_SCHEMA = """
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'dashboard_shares')
CREATE TABLE dashboard_shares (
    id INT IDENTITY(1,1) PRIMARY KEY,
    source_user_id INT NOT NULL,
    source_dashboard_id INT NOT NULL,
    source_connector_id INT NULL,
    dashboard_name NVARCHAR(255) NOT NULL,
    view_name NVARCHAR(255) NOT NULL,
    target_user_id INT NOT NULL,
    status NVARCHAR(20) NOT NULL,
    snapshot NVARCHAR(MAX) NOT NULL,
    share_view_id INT NULL,
    update_available BIT NOT NULL DEFAULT 0,
    target_connector_id INT NULL,
    target_dashboard_id INT NULL,
    view_share_id INT NULL,
    message NVARCHAR(2000) NULL,
    created_at DATETIME2 NULL,
    updated_at DATETIME2 NULL,
    CONSTRAINT ux_dashboard_shares UNIQUE (source_dashboard_id, target_user_id)
)
"""

_COLUMNS = (
    "id", "source_user_id", "source_dashboard_id", "source_connector_id", "dashboard_name",
    "view_name", "target_user_id", "status", "snapshot", "share_view_id", "update_available",
    "target_connector_id", "target_dashboard_id", "view_share_id", "message",
    "created_at", "updated_at",
)

# Dashboard fields that belong to the owner, not to the shared definition.
_PRIVATE_FIELDS = ("id", "user_id", "connector_id", "created_at", "updated_at")


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


class DashboardShareStorage:
    """Persistence of dashboard share records in the application metadata database."""

    _ready_backends: set[str] = set()

    def __init__(self) -> None:
        settings = get_settings()
        self.backend = settings.DASHBOARD_STORAGE_BACKEND
        self._sqlite_path = os.path.abspath(settings.DASHBOARD_DB_PATH)
        key = f"{self.backend}:{self._sqlite_path}"
        if key not in DashboardShareStorage._ready_backends:
            self._ensure_table()
            DashboardShareStorage._ready_backends.add(key)

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

    def get(self, share_id: int) -> dict[str, Any] | None:
        rows = self._query("SELECT * FROM dashboard_shares WHERE id = ?", (int(share_id),))
        return rows[0] if rows else None

    def find(self, source_dashboard_id: int, target_user_id: int) -> dict[str, Any] | None:
        rows = self._query(
            "SELECT * FROM dashboard_shares WHERE source_dashboard_id = ? AND target_user_id = ?",
            (int(source_dashboard_id), int(target_user_id)),
        )
        return rows[0] if rows else None

    def for_dashboard(self, source_dashboard_id: int) -> list[dict[str, Any]]:
        return self._query(
            "SELECT * FROM dashboard_shares WHERE source_dashboard_id = ? ORDER BY id",
            (int(source_dashboard_id),),
        )

    def for_target_user(self, target_user_id: int) -> list[dict[str, Any]]:
        return self._query(
            "SELECT * FROM dashboard_shares WHERE target_user_id = ? ORDER BY updated_at DESC, id DESC",
            (int(target_user_id),),
        )

    def for_target_dashboard(self, dashboard_id: int) -> dict[str, Any] | None:
        rows = self._query(
            "SELECT * FROM dashboard_shares WHERE target_dashboard_id = ? ORDER BY id DESC",
            (int(dashboard_id),),
        )
        return rows[0] if rows else None

    def create(self, record: dict[str, Any]) -> int:
        now = _now()
        cols = [
            "source_user_id", "source_dashboard_id", "source_connector_id", "dashboard_name",
            "view_name", "target_user_id", "status", "snapshot", "share_view_id",
            "update_available", "created_at", "updated_at",
        ]
        values = (
            record["source_user_id"], record["source_dashboard_id"], record.get("source_connector_id"),
            record["dashboard_name"], record["view_name"], record["target_user_id"],
            record.get("status", STATUS_PENDING),
            json.dumps(record.get("snapshot") or {}, ensure_ascii=False, default=str),
            record.get("share_view_id"), 0, now, now,
        )
        placeholders = ", ".join("?" for _ in cols)
        if self.backend == "mssql":
            with self._mssql() as conn, conn.cursor() as cur:
                cur.execute(
                    f"INSERT INTO dashboard_shares ({', '.join(cols)}) OUTPUT INSERTED.id "
                    f"VALUES ({placeholders.replace('?', '%s')})",
                    values,
                )
                new_id = cur.fetchone()[0]
                conn.commit()
            return int(new_id)
        with sqlite3.connect(self._sqlite_path) as conn:
            cur = conn.execute(
                f"INSERT INTO dashboard_shares ({', '.join(cols)}) VALUES ({placeholders})", values
            )
            conn.commit()
            return int(cur.lastrowid)

    def update(self, share_id: int, **fields: Any) -> None:
        if not fields:
            return
        fields["updated_at"] = _now()
        if "snapshot" in fields:
            fields["snapshot"] = json.dumps(fields["snapshot"] or {}, ensure_ascii=False, default=str)
        if "update_available" in fields:
            fields["update_available"] = 1 if fields["update_available"] else 0
        assignments = ", ".join(f"{k} = ?" for k in fields)
        self._execute(
            f"UPDATE dashboard_shares SET {assignments} WHERE id = ?", (*fields.values(), int(share_id))
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _dashboard_storage():
    from src.web.services.storage import DashboardStorage

    return DashboardStorage()


def snapshot_of(dashboard: Dashboard) -> dict[str, Any]:
    """The shareable definition of a dashboard (without owner and ids)."""
    data = dashboard.model_dump(mode="json")
    for key in _PRIVATE_FIELDS:
        data.pop(key, None)
    for chart in data.get("charts") or []:
        chart["id"] = None
    for kpi in data.get("kpi_cards") or []:
        kpi["id"] = None
    return data


def required_columns(snapshot: dict[str, Any]) -> list[str]:
    """Columns of the view the dashboard definition refers to."""
    cols: list[str] = []

    def add(name: Any) -> None:
        if isinstance(name, str) and name.strip() and name not in cols:
            cols.append(name)

    for name in snapshot.get("visible_columns") or []:
        add(name)
    for f in snapshot.get("filters") or []:
        add(f.get("column"))
    add(snapshot.get("sort_by"))
    for s in snapshot.get("sort") or []:
        add(s.get("column"))
    for key in ("group_by", "dimension_columns", "drill_down_columns"):
        for name in snapshot.get(key) or []:
            add(name)
    for name in (snapshot.get("aggregations") or {}):
        add(name)
    for chart in snapshot.get("charts") or []:
        add(chart.get("x_column"))
        add(chart.get("split_by_column"))
        add(chart.get("y_column"))
        for series in chart.get("series") or []:
            add(series.get("y_column"))
    for kpi in snapshot.get("kpi_cards") or []:
        add(kpi.get("column"))
        add(kpi.get("previous_column"))
    return cols


def _user_label(users: UserStorage, user_id: int | None) -> str:
    if user_id is None:
        return ""
    user = users.get_user_by_id(int(user_id))
    return user.email if user else ""


def _connector(users: UserStorage, connector_id: int | None) -> Connector | None:
    return users.get_connector_by_id(int(connector_id)) if connector_id else None


def _own_dashboard(user: User, dashboard_id: int) -> Dashboard:
    dashboard = _dashboard_storage().get_dashboard_for_user(int(dashboard_id), user)
    if dashboard is None:
        raise DashboardShareNotFound("Dashboard nebyl nalezen.")
    return dashboard


def _source_view(dashboard: Dashboard, source: Connector | None) -> dict[str, Any]:
    """What the dashboard reads: the author's own saved view, a shared view or a table."""
    info: dict[str, Any] = {"kind": "table", "view_id": None, "owner": False, "shared_by": ""}
    if source is None or not dashboard.view_name:
        return info
    service = ViewModelingService(connector=source)
    try:
        row = service.get_saved_view_by_name(dashboard.view_name)
    except Exception:  # catalog not reachable: treat as a table
        logger.exception("Saved view lookup failed for %s", dashboard.view_name)
        row = None
    if not row:
        return info
    access, share = view_sharing.view_access(service, row)
    info["kind"] = "saved"
    info["view_id"] = int(row["ID"])
    info["owner"] = access == view_sharing.ACCESS_OWNER
    if share:
        info["shared_by"] = _user_label(UserStorage(), share.get("source_user_id"))
    return info


def _catalog_has_view(connector: Connector, view_name: str) -> bool:
    """Whether the connector already has a saved view of that name (catalog only).

    Used on the author's side, so no connection to the recipient's databases is
    opened; tables are checked when the recipient accepts.
    """
    from src.web.services.view_catalog import ViewCatalog

    if ViewCatalog().get_by_name(connector.id, view_name):
        return True
    shares = view_sharing.ShareStorage().active_for_target_connector(connector.id)
    return any(s["view_name"] == view_name and s["mode"] == view_sharing.MODE_SAME_DB for s in shares)


def resolve_recipient(email: str, author: User) -> User:
    address = (email or "").strip().lower()
    if not address or "@" not in address:
        raise DashboardSharingError("Zadejte e-mail příjemce.")
    recipient = UserStorage().get_user_by_email(address)
    if recipient is None or not recipient.is_active:
        raise DashboardShareNotFound(
            "Uživatel s tímto e-mailem v aplikaci není. Sdílet lze jen uživatelům, kteří už mají účet."
        )
    if recipient.id == author.id:
        raise DashboardSharingError("Dashboard nelze sdílet sám sobě.")
    return recipient


# ---------------------------------------------------------------------------
# Author actions
# ---------------------------------------------------------------------------
def check_recipient(author: User, dashboard_id: int, email: str) -> dict[str, Any]:
    """What sharing the dashboard with this e-mail involves, before sending it."""
    dashboard = _own_dashboard(author, dashboard_id)
    recipient = resolve_recipient(email, author)
    users = UserStorage()
    source = _connector(users, dashboard.connector_id)
    view = _source_view(dashboard, source)
    connectors = users.list_connectors_for_user(recipient.id)
    with_view = sum(1 for c in connectors if _catalog_has_view(c, dashboard.view_name)) if view["kind"] == "saved" else 0
    existing = DashboardShareStorage().find(dashboard.id, recipient.id)
    return {
        "email": recipient.email,
        "dashboard_name": dashboard.name,
        "view_name": dashboard.view_name,
        "view_kind": view["kind"],
        "view_owner": view["owner"],
        "view_shared_by": view["shared_by"],
        "connectors_total": len(connectors),
        "connectors_with_view": with_view,
        # The author can add the view to the invitation.
        "can_share_view": view["kind"] == "saved" and view["owner"],
        # Suggested default of the "share the view as well" option.
        "suggest_share_view": view["kind"] == "saved" and view["owner"] and with_view < len(connectors),
        "existing_status": existing["status"] if existing else None,
    }


def share_dashboard(author: User, dashboard_id: int, email: str, share_view: bool) -> dict[str, Any]:
    dashboard = _own_dashboard(author, dashboard_id)
    recipient = resolve_recipient(email, author)
    users = UserStorage()
    source = _connector(users, dashboard.connector_id)
    view = _source_view(dashboard, source)
    grant = view["view_id"] if (share_view and view["kind"] == "saved" and view["owner"]) else None
    snapshot = snapshot_of(dashboard)
    storage = DashboardShareStorage()
    existing = storage.find(dashboard.id, recipient.id)
    if existing is None:
        share_id = storage.create({
            "source_user_id": author.id,
            "source_dashboard_id": dashboard.id,
            "source_connector_id": dashboard.connector_id,
            "dashboard_name": dashboard.name,
            "view_name": dashboard.view_name,
            "target_user_id": recipient.id,
            "status": STATUS_PENDING,
            "snapshot": snapshot,
            "share_view_id": grant,
        })
    else:
        share_id = existing["id"]
        fields: dict[str, Any] = dict(
            snapshot=snapshot, dashboard_name=dashboard.name, view_name=dashboard.view_name,
            share_view_id=grant, source_connector_id=dashboard.connector_id, message=None,
        )
        if existing["status"] == STATUS_ACCEPTED:
            fields["update_available"] = True
        else:
            fields.update(status=STATUS_PENDING, update_available=False)
        storage.update(share_id, **fields)
    return share_summary(storage.get(share_id), for_author=True)


def list_shares(author: User, dashboard_id: int) -> list[dict[str, Any]]:
    dashboard = _own_dashboard(author, dashboard_id)
    return [share_summary(s, for_author=True)
            for s in DashboardShareStorage().for_dashboard(dashboard.id)]


def revoke(author: User, share_id: int) -> dict[str, Any]:
    storage = DashboardShareStorage()
    share = storage.get(share_id)
    if not share or share["source_user_id"] != author.id:
        raise DashboardShareNotFound("Sdílení nebylo nalezeno.")
    if share["status"] not in (STATUS_PENDING, STATUS_ACCEPTED):
        raise DashboardSharingError("Sdílení už neplatí.")
    storage.update(share_id, status=STATUS_REVOKED, update_available=False)
    return share_summary(storage.get(share_id), for_author=True)


def on_dashboard_saved(dashboard: Dashboard) -> None:
    """Offer the author's new version to recipients (and refresh invitations)."""
    if not dashboard.id:
        return
    storage = DashboardShareStorage()
    shares = [s for s in storage.for_dashboard(dashboard.id) if s["status"] in (STATUS_PENDING, STATUS_ACCEPTED)]
    if not shares:
        return
    snapshot = snapshot_of(dashboard)
    for share in shares:
        fields: dict[str, Any] = dict(snapshot=snapshot, dashboard_name=dashboard.name, view_name=dashboard.view_name)
        if share["status"] == STATUS_ACCEPTED:
            fields["update_available"] = True
        storage.update(share["id"], **fields)


def on_dashboard_deleted(dashboard: Dashboard) -> None:
    """The author deleted the original, or a recipient deleted their copy."""
    storage = DashboardShareStorage()
    for share in storage.for_dashboard(dashboard.id or 0):
        if share["status"] == STATUS_PENDING:
            storage.update(share["id"], status=STATUS_REVOKED, update_available=False)
        elif share["status"] == STATUS_ACCEPTED:
            # Copies stay with their recipients; there will be no more updates.
            storage.update(share["id"], update_available=False, message="Autor dashboard smazal.")
    copy_share = storage.for_target_dashboard(dashboard.id or 0)
    if copy_share and copy_share["target_user_id"] == dashboard.user_id:
        storage.update(copy_share["id"], status=STATUS_REMOVED, update_available=False,
                       target_dashboard_id=None)


# ---------------------------------------------------------------------------
# Recipient
# ---------------------------------------------------------------------------
def hidden_dashboard_ids(user_id: int | None) -> set[int]:
    """Copies of the user that are not shared with them right now.

    That is a copy whose share the author revoked, also while a renewed
    invitation waits for acceptance.
    """
    if user_id is None:
        return set()
    return {
        int(s["target_dashboard_id"])
        for s in DashboardShareStorage().for_target_user(int(user_id))
        if s["target_dashboard_id"] and s["status"] != STATUS_ACCEPTED
    }


def copy_info(user_id: int | None) -> dict[int, dict[str, Any]]:
    """Accepted copies of the user: dashboard id -> share information for the list."""
    if user_id is None:
        return {}
    users = UserStorage()
    out: dict[int, dict[str, Any]] = {}
    for s in DashboardShareStorage().for_target_user(int(user_id)):
        if s["target_dashboard_id"] and s["status"] == STATUS_ACCEPTED:
            out[int(s["target_dashboard_id"])] = {
                "share_id": s["id"],
                "shared_by": _user_label(users, s["source_user_id"]),
                "update_available": s["update_available"],
            }
    return out


def _require_recipient(user: User, share_id: int) -> tuple[DashboardShareStorage, dict[str, Any]]:
    storage = DashboardShareStorage()
    share = storage.get(share_id)
    if not share or share["target_user_id"] != user.id:
        raise DashboardShareNotFound("Sdílení nebylo nalezeno.")
    return storage, share


def incoming(user: User) -> list[dict[str, Any]]:
    rows = DashboardShareStorage().for_target_user(user.id)
    waiting = [s for s in rows if s["status"] == STATUS_PENDING
               or (s["status"] == STATUS_ACCEPTED and s["update_available"])]
    return [share_summary(s, for_author=False) for s in waiting]


def _author_view_still_shareable(share: dict[str, Any]) -> tuple[Connector, int] | None:
    """The author's connector and view id the invitation allows to share, if still valid."""
    if not share.get("share_view_id"):
        return None
    users = UserStorage()
    source = _connector(users, share.get("source_connector_id"))
    if source is None:
        return None
    try:
        row = ViewModelingService(connector=source).get_saved_view(int(share["share_view_id"]))
    except Exception:
        return None
    if not row or row.get("NazevSys") != share["view_name"]:
        return None
    return source, int(share["share_view_id"])


def evaluate_connector(share: dict[str, Any], connector: Connector) -> dict[str, Any]:
    """Can the dashboard run through this connector of the recipient?"""
    from src.web.services.query import describe_view

    view_name = share["view_name"]
    result: dict[str, Any] = {"connector_id": connector.id, "connector_name": connector.name}
    needed = required_columns(share.get("snapshot") or {})
    try:
        has_saved = ViewModelingService(connector=connector).get_saved_view_by_name(view_name) is not None
    except Exception:
        has_saved = False
    try:
        info = describe_view(view_name, connector=connector)
        names = {c.get("name") for c in info.get("columns") or []}
    except Exception as exc:  # the view or table is not there (or cannot run)
        names = None
        error = str(exc).strip().splitlines()[0][:300] if str(exc).strip() else ""
    if names is not None:
        missing = [c for c in needed if c not in names]
        if not missing:
            result["status"] = CONN_READY
        else:
            result.update(status=CONN_CONFLICT if has_saved else CONN_MISSING_COLUMNS, missing_columns=missing)
        return result
    if not has_saved and _author_view_still_shareable(share):
        result["status"] = CONN_WILL_SHARE
        return result
    result.update(status=CONN_MISSING, detail=error)
    return result


def share_detail(user: User, share_id: int) -> dict[str, Any]:
    storage = DashboardShareStorage()
    share = storage.get(share_id)
    if not share or user.id not in (share["target_user_id"], share["source_user_id"]):
        raise DashboardShareNotFound("Sdílení nebylo nalezeno.")
    is_author = share["source_user_id"] == user.id
    summary = share_summary(share, for_author=is_author)
    snap = share.get("snapshot") or {}
    summary.update(
        charts=[c.get("title") or c.get("chart_type") or "" for c in snap.get("charts") or []],
        kpi_cards=[k.get("title") or k.get("column") or "" for k in snap.get("kpi_cards") or []],
        columns=required_columns(snap),
        filters=len(snap.get("filters") or []),
    )
    if not is_author:
        users = UserStorage()
        is_update = share["status"] == STATUS_ACCEPTED and share["update_available"]
        if is_update and share.get("target_connector_id"):
            target = _connector(users, share["target_connector_id"])
            candidates = [target] if target else []
        else:
            candidates = users.list_connectors_for_user(user.id)
        summary["connectors"] = [evaluate_connector(share, c) for c in candidates]
        summary["active_connector_id"] = user.connector_id
        summary["is_update"] = is_update
    return summary


def _share_view_for(user: User, share: dict[str, Any], connector: Connector) -> int:
    """Share the author's view to the recipient's connector and accept it at once."""
    allowed = _author_view_still_shareable(share)
    if not allowed:
        raise DashboardSharingError(f"View {share['view_name']} už nelze sdílet. Požádejte autora, ať vám ho nasdílí.")
    source, view_id = allowed
    author = UserStorage().get_user_by_id(int(share["source_user_id"]))
    if author is None:
        raise DashboardSharingError("Autor dashboardu už v aplikaci není.")
    try:
        view_share_id = view_sharing.share_view_to_connector(author, source, view_id, connector, user)
        vshare = view_sharing.ShareStorage().get(view_share_id) or {}
        if vshare.get("status") != view_sharing.STATUS_ACCEPTED or vshare.get("update_available"):
            view_sharing.accept_share(user, view_share_id)
    except view_sharing.SharingError as exc:
        raise DashboardSharingError(f"View {share['view_name']} se nepodařilo nasdílet: {exc}") from exc
    return int(view_share_id)


def accept(user: User, share_id: int, connector_id: int | None) -> dict[str, Any]:
    storage, share = _require_recipient(user, share_id)
    is_update = share["status"] == STATUS_ACCEPTED and share["update_available"]
    if share["status"] != STATUS_PENDING and not is_update:
        raise DashboardSharingError("Sdílení už nečeká na přijetí.")
    users = UserStorage()
    if is_update and share.get("target_connector_id"):
        connector = _connector(users, share["target_connector_id"])
    else:
        connector = _connector(users, connector_id or user.connector_id)
    if connector is None or connector.user_id != user.id:
        raise DashboardSharingError("Vyberte svůj konektor, přes který bude dashboard číst data.")

    try:
        evaluation = evaluate_connector(share, connector)
        view_share_id = share.get("view_share_id")
        if evaluation["status"] == CONN_WILL_SHARE:
            view_share_id = _share_view_for(user, share, connector)
            evaluation = evaluate_connector(share, connector)
        if evaluation["status"] != CONN_READY:
            raise DashboardSharingError(_evaluation_message(share, evaluation))

        dashboards = _dashboard_storage()
        snap = copy.deepcopy(share.get("snapshot") or {})
        existing_copy = None
        if share.get("target_dashboard_id"):
            candidate = dashboards.get_dashboard(int(share["target_dashboard_id"]))
            if candidate and candidate.user_id == user.id:
                existing_copy = candidate
        snap.update(
            id=existing_copy.id if existing_copy else None,
            user_id=user.id,
            connector_id=connector.id,
        )
        copy_dashboard = Dashboard(**snap)
        saved = dashboards.save_dashboard(copy_dashboard)
    except DashboardSharingError as exc:
        storage.update(share_id, message=str(exc)[:1900])
        raise
    except Exception as exc:  # connection or driver failure
        logger.exception("Accepting dashboard share %s failed", share_id)
        storage.update(share_id, message=f"Přijetí selhalo: {exc}"[:1900])
        raise DashboardSharingError(f"Přijetí selhalo: {exc}") from exc

    storage.update(share_id, status=STATUS_ACCEPTED, update_available=False, message=None,
                   target_connector_id=connector.id, target_dashboard_id=saved.id,
                   view_share_id=view_share_id)
    return {
        **share_summary(storage.get(share_id), for_author=False),
        "result": "updated" if is_update else "copied",
        "dashboard_id": saved.id,
    }


def decline(user: User, share_id: int) -> dict[str, Any]:
    storage, share = _require_recipient(user, share_id)
    if share["status"] == STATUS_PENDING:
        storage.update(share_id, status=STATUS_DECLINED, message=None)
    elif share["status"] == STATUS_ACCEPTED and share["update_available"]:
        storage.update(share_id, update_available=False)  # keep the current copy
    else:
        raise DashboardSharingError("Sdílení už nečeká na rozhodnutí.")
    return share_summary(storage.get(share_id), for_author=False)


def _evaluation_message(share: dict[str, Any], evaluation: dict[str, Any]) -> str:
    view = share["view_name"]
    status = evaluation.get("status")
    if status in (CONN_MISSING_COLUMNS, CONN_CONFLICT):
        cols = ", ".join(evaluation.get("missing_columns") or [])
        return f"View {view} v konektoru {evaluation.get('connector_name')} nemá sloupce: {cols}."
    return (
        f"View ani tabulka {view} není v konektoru {evaluation.get('connector_name')} k dispozici. "
        "Požádejte autora, ať vám nejdřív nasdílí view."
    )


# ---------------------------------------------------------------------------
# Presentation
# ---------------------------------------------------------------------------
def share_summary(share: dict[str, Any] | None, *, for_author: bool) -> dict[str, Any]:
    if not share:
        return {}
    users = UserStorage()
    summary = {
        "id": share["id"],
        "dashboard_name": share["dashboard_name"],
        "view_name": share["view_name"],
        "status": share["status"],
        "update_available": share["update_available"],
        "share_view": bool(share.get("share_view_id")),
        "message": share.get("message") or "",
        "updated_at": share.get("updated_at"),
    }
    if for_author:
        summary["target_email"] = _user_label(users, share["target_user_id"])
        connector = _connector(users, share.get("target_connector_id"))
        summary["target_connector_name"] = connector.name if connector else ""
    else:
        summary["source_email"] = _user_label(users, share["source_user_id"])
        summary["target_dashboard_id"] = share.get("target_dashboard_id")
    return summary
