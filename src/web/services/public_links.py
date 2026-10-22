"""Public links to dashboards (read-only, without signing in).

The author of a dashboard can create any number of links, each with an
optional label and an optional expiry. A link carries a long random token
(``secrets.token_urlsafe(32)``, 256 bits) in its URL:

* the token is looked up by its SHA-256 hash; it is also stored encrypted with
  ``STORAGE_ENCRYPTION_KEY`` so the author can copy the link again later;
* a link stops working when it expires, when the author revokes or deletes it,
  when the dashboard is deleted, or when the author's account is deactivated;
* only the author of a dashboard can create links: a copy received through
  dashboard sharing cannot be published.

Visitors only read: the server always uses the stored dashboard definition
(view, filters, charts, KPI cards); a visitor can only change the sorting of
the table. Nothing can be saved through a public link.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import os
import secrets
import sqlite3
from typing import Any

from src.web.config import get_settings
from src.web.models.dashboard import Dashboard
from src.web.models.user import Connector, User
from src.web.services.encryption import decrypt, encrypt
from src.web.services.user_storage import UserStorage

LABEL_MAX = 120


class PublicLinkError(Exception):
    """The action cannot be performed; the message is shown to the user."""


class PublicLinkNotFound(PublicLinkError):
    """The link or dashboard does not exist or does not belong to the user."""


_SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS dashboard_public_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dashboard_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    label TEXT,
    token_hash TEXT NOT NULL UNIQUE,
    token_enc TEXT NOT NULL,
    created_at TEXT,
    expires_at TEXT,
    revoked_at TEXT,
    last_access_at TEXT,
    access_count INTEGER NOT NULL DEFAULT 0
)
"""

_MSSQL_SCHEMA = """
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'dashboard_public_links')
CREATE TABLE dashboard_public_links (
    id INT IDENTITY(1,1) PRIMARY KEY,
    dashboard_id INT NOT NULL,
    user_id INT NOT NULL,
    label NVARCHAR(255) NULL,
    token_hash NVARCHAR(64) NOT NULL,
    token_enc NVARCHAR(400) NOT NULL,
    created_at DATETIME2 NULL,
    expires_at DATETIME2 NULL,
    revoked_at DATETIME2 NULL,
    last_access_at DATETIME2 NULL,
    access_count INT NOT NULL DEFAULT 0,
    CONSTRAINT ux_dashboard_public_links UNIQUE (token_hash)
)
"""

_COLUMNS = (
    "id", "dashboard_id", "user_id", "label", "token_hash", "token_enc", "created_at",
    "expires_at", "revoked_at", "last_access_at", "access_count",
)
_TIME_FMT = "%Y-%m-%d %H:%M:%S"


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc).replace(tzinfo=None, microsecond=0)


def _fmt(value: dt.datetime | None) -> str | None:
    return value.strftime(_TIME_FMT) if value else None


def _parse(value: Any) -> dt.datetime | None:
    if not value:
        return None
    if isinstance(value, dt.datetime):
        return value.replace(tzinfo=None)
    text = str(value).replace("T", " ").split(".")[0].rstrip("Z")
    try:
        return dt.datetime.strptime(text, _TIME_FMT)
    except ValueError:
        try:
            return dt.datetime.strptime(text, "%Y-%m-%d")
        except ValueError:
            return None


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class PublicLinkStorage:
    _ready_backends: set[str] = set()

    def __init__(self) -> None:
        settings = get_settings()
        self.backend = settings.DASHBOARD_STORAGE_BACKEND
        self._sqlite_path = os.path.abspath(settings.DASHBOARD_DB_PATH)
        key = f"{self.backend}:{self._sqlite_path}"
        if key not in PublicLinkStorage._ready_backends:
            self._ensure_table()
            PublicLinkStorage._ready_backends.add(key)

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
        return [{k: r.get(k) for k in _COLUMNS} for r in rows]

    def _execute(self, sql: str, params: tuple = ()) -> None:
        if self.backend == "mssql":
            with self._mssql() as conn, conn.cursor() as cur:
                cur.execute(sql.replace("?", "%s"), params)
                conn.commit()
        else:
            with sqlite3.connect(self._sqlite_path) as conn:
                conn.execute(sql, params)
                conn.commit()

    def get(self, link_id: int) -> dict[str, Any] | None:
        rows = self._query("SELECT * FROM dashboard_public_links WHERE id = ?", (int(link_id),))
        return rows[0] if rows else None

    def by_hash(self, digest: str) -> dict[str, Any] | None:
        rows = self._query("SELECT * FROM dashboard_public_links WHERE token_hash = ?", (digest,))
        return rows[0] if rows else None

    def for_dashboard(self, dashboard_id: int) -> list[dict[str, Any]]:
        return self._query(
            "SELECT * FROM dashboard_public_links WHERE dashboard_id = ? ORDER BY id", (int(dashboard_id),)
        )

    def create(self, dashboard_id: int, user_id: int, label: str, digest: str, token_enc: str,
               expires_at: dt.datetime | None) -> int:
        cols = "dashboard_id, user_id, label, token_hash, token_enc, created_at, expires_at, access_count"
        values = (int(dashboard_id), int(user_id), label, digest, token_enc, _fmt(_now()), _fmt(expires_at), 0)
        if self.backend == "mssql":
            with self._mssql() as conn, conn.cursor() as cur:
                cur.execute(
                    f"INSERT INTO dashboard_public_links ({cols}) OUTPUT INSERTED.id "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                    values,
                )
                new_id = cur.fetchone()[0]
                conn.commit()
            return int(new_id)
        with sqlite3.connect(self._sqlite_path) as conn:
            cur = conn.execute(
                f"INSERT INTO dashboard_public_links ({cols}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", values
            )
            conn.commit()
            return int(cur.lastrowid)

    def update(self, link_id: int, **fields: Any) -> None:
        if not fields:
            return
        assignments = ", ".join(f"{k} = ?" for k in fields)
        self._execute(
            f"UPDATE dashboard_public_links SET {assignments} WHERE id = ?", (*fields.values(), int(link_id))
        )

    def touch(self, link_id: int) -> None:
        self._execute(
            "UPDATE dashboard_public_links SET access_count = access_count + 1, last_access_at = ? WHERE id = ?",
            (_fmt(_now()), int(link_id)),
        )

    def delete(self, link_id: int) -> None:
        self._execute("DELETE FROM dashboard_public_links WHERE id = ?", (int(link_id),))

    def delete_for_dashboard(self, dashboard_id: int) -> None:
        self._execute("DELETE FROM dashboard_public_links WHERE dashboard_id = ?", (int(dashboard_id),))


# ---------------------------------------------------------------------------
# Author
# ---------------------------------------------------------------------------
def _dashboards():
    from src.web.services.storage import DashboardStorage

    return DashboardStorage()


def is_received_copy(dashboard: Dashboard) -> bool:
    """A dashboard the user got from someone else through dashboard sharing."""
    from src.web.services.dashboard_sharing import DashboardShareStorage

    share = DashboardShareStorage().for_target_dashboard(dashboard.id or 0)
    return bool(share and share["target_user_id"] == dashboard.user_id)


def _own_dashboard(user: User, dashboard_id: int) -> Dashboard:
    dashboard = _dashboards().get_dashboard_for_user(int(dashboard_id), user)
    if dashboard is None:
        raise PublicLinkNotFound("Dashboard nebyl nalezen.")
    if is_received_copy(dashboard):
        raise PublicLinkError(
            "Tento dashboard vám někdo nasdílel. Veřejný odkaz může vytvořit jen jeho autor."
        )
    return dashboard


def _status(link: dict[str, Any], now: dt.datetime | None = None) -> str:
    now = now or _now()
    if link.get("revoked_at"):
        return "revoked"
    expires = _parse(link.get("expires_at"))
    if expires and expires <= now:
        return "expired"
    return "active"


def link_url(token: str, base_url: str | None = None) -> str:
    base = (base_url if base_url is not None else get_settings().APP_BASE_URL or "").rstrip("/")
    return f"{base}/public/dashboard/{token}"


def summary(link: dict[str, Any], base_url: str | None = None) -> dict[str, Any]:
    try:
        token = decrypt(link.get("token_enc") or "")
    except Exception:
        token = ""
    status = _status(link)
    return {
        "id": link["id"],
        "label": link.get("label") or "",
        "url": link_url(token, base_url) if token and status == "active" else "",
        "status": status,
        "created_at": _fmt(_parse(link.get("created_at"))),
        "expires_at": _fmt(_parse(link.get("expires_at"))),
        "last_access_at": _fmt(_parse(link.get("last_access_at"))),
        "access_count": int(link.get("access_count") or 0),
    }


def parse_expiry(value: Any) -> dt.datetime | None:
    """Expiry from the dialog: none, a number of days or a date (end of that day, UTC)."""
    if value in (None, "", "never"):
        return None
    if isinstance(value, (int, float)) or (isinstance(value, str) and value.isdigit()):
        days = int(value)
        if days <= 0 or days > 3650:
            raise PublicLinkError("Neplatná doba platnosti.")
        return _now() + dt.timedelta(days=days)
    parsed = _parse(value)
    if parsed is None:
        raise PublicLinkError("Neplatné datum konce platnosti.")
    if len(str(value).strip()) <= 10:  # a date: valid through the whole day
        parsed = parsed.replace(hour=23, minute=59, second=59)
    if parsed <= _now():
        raise PublicLinkError("Konec platnosti musí být v budoucnosti.")
    return parsed


def create_link(user: User, dashboard_id: int, label: str, expires: Any, base_url: str | None = None) -> dict[str, Any]:
    dashboard = _own_dashboard(user, dashboard_id)
    expires_at = parse_expiry(expires)
    token = secrets.token_urlsafe(32)
    storage = PublicLinkStorage()
    link_id = storage.create(
        dashboard.id, user.id, (label or "").strip()[:LABEL_MAX], token_hash(token), encrypt(token), expires_at
    )
    return summary(storage.get(link_id), base_url)


def list_links(user: User, dashboard_id: int, base_url: str | None = None) -> list[dict[str, Any]]:
    dashboard = _own_dashboard(user, dashboard_id)
    return [summary(link, base_url) for link in PublicLinkStorage().for_dashboard(dashboard.id)]


def _own_link(user: User, link_id: int) -> tuple[PublicLinkStorage, dict[str, Any]]:
    storage = PublicLinkStorage()
    link = storage.get(link_id)
    if not link or int(link["user_id"]) != user.id:
        raise PublicLinkNotFound("Odkaz nebyl nalezen.")
    return storage, link


def revoke_link(user: User, link_id: int, base_url: str | None = None) -> dict[str, Any]:
    storage, link = _own_link(user, link_id)
    if not link.get("revoked_at"):
        storage.update(link_id, revoked_at=_fmt(_now()))
    return summary(storage.get(link_id), base_url)


def delete_link(user: User, link_id: int) -> None:
    storage, _link = _own_link(user, link_id)
    storage.delete(link_id)


def on_dashboard_deleted(dashboard_id: int) -> None:
    PublicLinkStorage().delete_for_dashboard(dashboard_id)


# ---------------------------------------------------------------------------
# Visitor
# ---------------------------------------------------------------------------
def resolve(token: str) -> tuple[dict[str, Any], Dashboard, Connector | None] | None:
    """The active link, its dashboard and connector, or None (any reason)."""
    if not token or len(token) < 32 or len(token) > 128:
        return None
    link = PublicLinkStorage().by_hash(token_hash(token))
    if not link or _status(link) != "active":
        return None
    dashboard = _dashboards().get_dashboard(int(link["dashboard_id"]))
    if dashboard is None or dashboard.user_id != int(link["user_id"]):
        return None
    users = UserStorage()
    owner = users.get_user_by_id(int(link["user_id"]))
    if owner is None or not owner.is_active or is_received_copy(dashboard):
        return None
    connector = users.get_connector_by_id(dashboard.connector_id) if dashboard.connector_id else None
    if connector is None and owner.connector_id:
        connector = users.get_connector_by_id(owner.connector_id)
    if connector is None or connector.user_id != owner.id:
        return None  # never read through someone else's connector
    return link, dashboard, connector


def record_access(link: dict[str, Any]) -> None:
    PublicLinkStorage().touch(int(link["id"]))


def public_definition(link: dict[str, Any], dashboard: Dashboard) -> dict[str, Any]:
    """The dashboard as the read-only page needs it (no owner or editor data)."""
    data = dashboard.model_dump(mode="json")
    data.pop("user_id", None)
    data.pop("connector_id", None)
    for chart in data.get("charts") or []:
        chart["description_updated_by"] = ""
    data["public"] = {
        "label": link.get("label") or "",
        "expires_at": _fmt(_parse(link.get("expires_at"))),
    }
    return data
