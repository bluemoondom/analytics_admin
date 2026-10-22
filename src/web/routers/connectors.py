"""API routes for managing per-user database connectors."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException

from src.web.auth import require_user
from src.web.db import _conn_with_cursor
from src.web.models.user import Connector, User
from src.web.services.user_storage import UserStorage

router = APIRouter(prefix="/api/connectors", tags=["connectors"])


def _mask_secret(value: str | None) -> str:
    """Show the first 4 and last 4 characters, masking the middle with asterisks."""
    if not value:
        return ""
    if len(value) <= 8:
        return value[:2] + "*" * max(0, len(value) - 2)
    return value[:4] + "*" * max(0, len(value) - 8) + value[-4:]


def _connector_response(connector: Connector) -> dict[str, Any]:
    """Return a connector dict safe for the UI (no full secrets)."""

    def _iso(value: Any) -> str | None:
        if value is None:
            return None
        if isinstance(value, str):
            return value
        return value.isoformat()

    return {
        "id": connector.id,
        "name": connector.name,
        "db_type": connector.db_type or "mssql",
        "db_host": connector.db_host,
        "db_port": connector.db_port,
        "db_name": connector.db_name,
        "db_user": connector.db_user,
        "db_driver": connector.db_driver,
        "view_discovery_mode": connector.view_discovery_mode,
        "analytics_admin_views_only": connector.analytics_admin_views_only,
        "api_tenant": connector.api_tenant,
        "api_key": _mask_secret(connector.api_key),
        "api_key_header": connector.api_key_header,
        "api_allowed_ips": connector.api_allowed_ips,
        "api_max_requests_per_minute": connector.api_max_requests_per_minute,
        "has_db_password": bool(connector.db_password),
        "share_uuid": connector.share_uuid,
        "created_at": _iso(connector.created_at),
        "updated_at": _iso(connector.updated_at),
    }


def _connector_from_payload(payload: dict[str, Any]) -> Connector:
    """Build a Connector model from the UI payload."""
    from src.web.dialects import dialect_names

    allowed_ips = payload.get("api_allowed_ips") or []
    if isinstance(allowed_ips, str):
        allowed_ips = [ip.strip() for ip in allowed_ips.split(",") if ip.strip()]
    db_type = (payload.get("db_type") or "mssql").strip().lower()
    if db_type not in dialect_names():
        db_type = "mssql"
    return Connector(
        name=(payload.get("name") or "").strip(),
        db_type=db_type,
        db_host=(payload.get("db_host") or "").strip(),
        db_port=int(payload.get("db_port", 1433)),
        db_name=(payload.get("db_name") or "").strip(),
        db_user=(payload.get("db_user") or "").strip(),
        db_password=(payload.get("db_password") or "").strip(),
        db_driver=(payload.get("db_driver") or "ODBC Driver 17 for SQL Server").strip(),
        view_discovery_mode=(payload.get("view_discovery_mode") or "tabobecny_prehled").strip(),
        analytics_admin_views_only=payload.get("analytics_admin_views_only"),
        api_tenant=(payload.get("api_tenant") or "").strip(),
        api_key=(payload.get("api_key") or "").strip(),
        api_key_header=(payload.get("api_key_header") or "X-API-Key").strip(),
        api_allowed_ips=allowed_ips,
        api_max_requests_per_minute=int(payload.get("api_max_requests_per_minute", 0)),
    )


def _check_connector(connector: Connector) -> None:
    """Refuse settings that would reach beyond the user's own database.

    SQLite: no network paths, nothing of the application itself (its metadata
    database), only existing files. SQL Server: only SQL Server ODBC drivers.
    """
    if connector.db_type == "sqlite":
        from src.web.dialects.sqlite import SQLitePathError, validate_sqlite_path

        try:
            validate_sqlite_path(connector.db_name)
        except SQLitePathError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    elif connector.db_type == "mssql":
        import pyodbc

        from src.web.dialects.mssql import validate_driver

        try:
            validate_driver(connector.db_driver)
        except pyodbc.Error as exc:
            raise HTTPException(status_code=400, detail=str(exc.args[-1] if exc.args else exc)) from exc


@router.get("/", response_model=list[dict[str, Any]])
def list_connectors(user: Annotated[User, Depends(require_user)]):
    """Return connectors belonging to the current user."""
    storage = UserStorage()
    connectors = storage.list_connectors_for_user(user.id)
    return [_connector_response(c) for c in connectors]



@router.get("/me", response_model=dict[str, Any])
def get_my_connector(user: Annotated[User, Depends(require_user)]):

    """Return the current user's active connector."""
    storage = UserStorage()
    connector = storage.get_connector_by_id(user.connector_id) if user.connector_id else None
    if not connector:
        raise HTTPException(status_code=404, detail="Connector not found")
    return _connector_response(connector)


def _ensure_connector_owner(connector_id: int, user: User) -> Connector:
    """Return connector only if it belongs to the current user."""
    storage = UserStorage()
    connector = storage.get_connector_by_id(connector_id)
    if not connector:
        raise HTTPException(status_code=404, detail="Connector not found")
    if connector.user_id != user.id:
        raise HTTPException(status_code=404, detail="Connector not found")
    return connector


@router.post("/", response_model=dict[str, Any])
def create_connector(
    payload: dict[str, Any],
    user: Annotated[User, Depends(require_user)],
):
    """Create a new connector for the current user."""
    connector = _connector_from_payload(payload)
    if not connector.name:
        raise HTTPException(status_code=400, detail="Connector name is required")
    _check_connector(connector)
    connector.user_id = user.id
    created = UserStorage().create_connector(connector)
    return _connector_response(created)


@router.put("/{connector_id}", response_model=dict[str, Any])
def update_connector(
    connector_id: int,
    payload: dict[str, Any],
    user: Annotated[User, Depends(require_user)],
):
    """Update an existing connector owned by the current user."""
    storage = UserStorage()
    existing = _ensure_connector_owner(connector_id, user)
    updated = _connector_from_payload(payload)
    _check_connector(updated)
    updated.id = connector_id
    updated.user_id = user.id
    # Keep existing secrets when the UI sends an empty or masked value.
    if not updated.db_password or _mask_secret(existing.db_password) == updated.db_password:
        updated.db_password = existing.db_password
    if not updated.api_key or _mask_secret(existing.api_key) == updated.api_key:
        updated.api_key = existing.api_key
    saved = storage.update_connector(updated)
    if not saved:
        raise HTTPException(status_code=500, detail="Failed to update connector")
    return _connector_response(saved)


@router.delete("/{connector_id}")
def delete_connector(
    connector_id: int,
    user: Annotated[User, Depends(require_user)],
):
    """Delete a connector owned by the current user if it is not active."""
    _ensure_connector_owner(connector_id, user)
    if user.connector_id == connector_id:
        raise HTTPException(status_code=400, detail="Cannot delete the active connector")
    UserStorage().delete_connector(connector_id)
    return {"deleted": True}


@router.post("/{connector_id}/activate")
def activate_connector(
    connector_id: int,
    user: Annotated[User, Depends(require_user)],
):
    """Set the given connector as the current user's active connector."""
    _ensure_connector_owner(connector_id, user)
    UserStorage().update_user_connector(user.id, connector_id)
    return {"ok": True, "connector_id": connector_id}


@router.post("/{connector_id}/share-code", response_model=dict[str, Any])
def regenerate_share_code(
    connector_id: int,
    user: Annotated[User, Depends(require_user)],
):
    """Issue a new share code for the connector; the previous code stops working."""
    _ensure_connector_owner(connector_id, user)
    code = UserStorage().regenerate_share_uuid(connector_id)
    return {"connector_id": connector_id, "share_uuid": code}


@router.post("/test", response_model=dict[str, Any])
def test_connector_connection(
    payload: dict[str, Any],
    user: Annotated[User, Depends(require_user)],
):
    """Test a database connection without saving it.

    If ``connector_id`` is provided, the existing connector must belong to the
    current user and its saved password/api_key are used as fallbacks when the
    UI leaves the corresponding fields empty.
    """
    connector = _connector_from_payload(payload)
    connector_id = payload.get("connector_id")
    if connector_id:
        existing = _ensure_connector_owner(int(connector_id), user)
        if not connector.db_password or _mask_secret(existing.db_password) == connector.db_password:
            connector.db_password = existing.db_password
        if not connector.api_key or _mask_secret(existing.api_key) == connector.api_key:
            connector.api_key = existing.api_key
    elif not connector.db_password and connector.db_type != "sqlite":
        raise HTTPException(status_code=400, detail="Database password is required")
    _check_connector(connector)

    try:
        with _conn_with_cursor(connector) as (_conn, cur):
            cur.execute("SELECT 1")
            row = cur.fetchone()
            if row is None or row[0] != 1:
                raise HTTPException(status_code=500, detail="Unexpected test query result")
    except HTTPException:
        raise
    except Exception as exc:
        message = str(exc)
        if "Login timeout" in message or "timeout" in message.lower():
            detail = "Server není dostupný (timeout připojení)."
        elif "Login failed" in message or "28000" in message:
            detail = "Přihlášení selhalo – zkontrolujte uživatele a heslo."
        elif "Unknown server" in message or "08001" in message:
            detail = "Server nebyl nalezen – zkontrolujte adresu a port."
        else:
            detail = f"Chyba připojení k databázi: {message}"
        raise HTTPException(status_code=400, detail=detail) from exc

    encryption = _encryption_status(connector)
    message = "Připojení k databázi bylo úspěšné."
    if encryption in _ENCRYPTION_TEXT:
        message += " " + _ENCRYPTION_TEXT[encryption]
    return {"ok": True, "message": message, "encryption": encryption}


_ENCRYPTION_TEXT = {
    "verified": "Spojení je šifrované a certifikát serveru je ověřený.",
    "encrypted": "Spojení je šifrované, certifikát serveru ale nejde ověřit (např. vlastní certifikát serveru).",
    "plain": "Spojení NENÍ šifrované: server šifrování nepodporuje, data i heslo jdou po síti čitelně.",
    "local": "Databáze je soubor na serveru aplikace, po síti se nic neposílá.",
}


def _encryption_status(connector: Connector) -> str | None:
    """How the connection of the test was protected ("verified", "encrypted", "plain", "local")."""
    db_type = connector.db_type or "mssql"
    if db_type == "sqlite":
        return "local"
    try:
        if db_type == "mssql":
            from src.web.dialects.mssql import encryption_mode

            mode = encryption_mode(connector)
            if mode == "plain":
                # The server may still enforce encryption on its side.
                with _conn_with_cursor(connector) as (_conn, cur):
                    cur.execute("SELECT CONVERT(varchar(10), CONNECTIONPROPERTY('encrypt_option'))")
                    row = cur.fetchone()
                if row and str(row[0]).upper() == "TRUE":
                    return "encrypted"
            return mode
        with _conn_with_cursor(connector) as (_conn, cur):
            if db_type == "postgresql":
                cur.execute("SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()")
                row = cur.fetchone()
                return "encrypted" if row and row[0] else "plain"
            if db_type == "mysql":
                cur.execute("SHOW SESSION STATUS LIKE 'Ssl_cipher'")
                row = cur.fetchone()
                return "encrypted" if row and row[1] else "plain"
    except Exception:
        return None
    return None
