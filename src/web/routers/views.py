"""API routes for view modeling (joins, columns, TabObecnyPrehled storage)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException

from src.web.auth import require_user
from src.web.config import get_settings
from src.web.db import DatabaseError
from src.web.models.user import Connector, User
from src.web.services import view_sharing as sharing
from src.web.services.user_storage import UserStorage
from src.web.services.view_modeling import (
    ViewModelingError,
    ViewModelingService,
)

router = APIRouter(prefix="/api/views", tags=["views"])


def _owned_connector(user: User, connector_id: Any) -> Any:
    """Return the connector only if it belongs to the current user.

    Falls back to the user's active connector when no id is provided.
    Raises 403 if a requested connector_id is not owned by the user.
    """
    user_storage = UserStorage()
    if connector_id is None:
        connector_id = user.connector_id
    if connector_id is None:
        return None
    connector = user_storage.get_connector_by_id(int(connector_id))
    if connector is None:
        return None
    if connector.user_id != user.id:
        raise HTTPException(status_code=403, detail="Connector not owned by user")
    return connector


def _user_service(user: User, payload: dict[str, Any] | None = None) -> ViewModelingService:
    """Return a ViewModelingService for the user's selected connector.

    If the payload contains ``connector_id``, that connector is used (when owned
    by the user). Otherwise the user's active connector is used.
    """
    connector_id = payload.get("connector_id") if payload is not None else None
    connector = _owned_connector(user, connector_id)
    return ViewModelingService(connector=connector)


ServiceDep = Annotated[ViewModelingService, Depends(_user_service)]


def _view_access(service: ViewModelingService, view_id: int) -> tuple[dict[str, Any], str, dict[str, Any] | None]:
    """Return (row, access, share) or raise 404 when the view is not visible."""
    try:
        row = service.get_saved_view(view_id)
    except DatabaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    access, share = sharing.view_access(service, row)
    if not row or access is None:
        raise HTTPException(status_code=404, detail="View not found")
    return row, access, share


def _require_view_owner(service: ViewModelingService, view_id: int) -> dict[str, Any]:
    row, access, _share = _view_access(service, view_id)
    if access != sharing.ACCESS_OWNER:
        raise HTTPException(
            status_code=403,
            detail="Sdílené view může upravovat a mazat jen jeho autor.",
        )
    return row


def _sharing_http_error(exc: sharing.SharingError) -> HTTPException:
    if isinstance(exc, sharing.SharingNotFound):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, sharing.SharingForbidden):
        return HTTPException(status_code=403, detail=str(exc))
    return HTTPException(status_code=400, detail=str(exc))


@router.get("/tables", response_model=list[dict[str, Any]])
def list_tables(user: Annotated[User, Depends(require_user)]):
    """Return available user tables and views for modeling."""
    service = _user_service(user)
    return service.list_tables()


@router.get("/tables/{table_name}/columns")
def get_table_columns(
    table_name: str, user: Annotated[User, Depends(require_user)]
):
    """Return columns for the selected table or view."""
    service = _user_service(user)
    try:
        return {"table_name": table_name, "columns": service.get_columns(table_name)}
    except DatabaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/preview", response_model=dict[str, Any])
def preview_view(
    payload: dict[str, Any], user: Annotated[User, Depends(require_user)]
):
    """Return generated SQL and a small data preview for the modeled view."""
    service = _user_service(user, payload)
    try:
        return service.preview_view(payload)
    except (DatabaseError, ViewModelingError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/", response_model=dict[str, Any])
def save_view(
    payload: dict[str, Any], user: Annotated[User, Depends(require_user)]
):
    """Save a modeled view as a new row in TabObecnyPrehled."""
    service = _user_service(user, payload)
    try:
        name = service._helios_view_name((payload.get("name") or "").strip())
        existing_id = service._existing_view_id(name) if name and service._tab_obecny_prehled_exists() else None
        if existing_id is not None:
            # Saving under an existing name overwrites that row; only its author may.
            row = service.get_saved_view(existing_id)
            access, _share = sharing.view_access(service, row)
            if access != sharing.ACCESS_OWNER:
                raise HTTPException(
                    status_code=400,
                    detail=f"View s názvem {name} už existuje a patří jinému autorovi. Zvolte jiný název.",
                )
        result = service.save_view(payload)
        if result.get("saved"):
            sharing.on_view_saved(service.connector, result.get("id") or service._existing_view_id(result.get("name") or name))
        return result
    except (DatabaseError, ViewModelingError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/saved", response_model=list[dict[str, Any]])
def list_saved_views(user: Annotated[User, Depends(require_user)]):
    """Return views stored in TabObecnyPrehled for the user's connector."""
    service = _user_service(user)
    return service.list_saved_views()


@router.get("/saved/{view_id}", response_model=dict[str, Any])
def get_saved_view(
    view_id: int, user: Annotated[User, Depends(require_user)]
):
    """Return a single saved view, parsed for editing if possible.

    Includes ``access``: ``owner`` (editable) or ``shared`` (read-only).
    """
    service = _user_service(user)
    _row, access, share = _view_access(service, view_id)
    parsed = service.parse_saved_view(view_id)
    if not parsed:
        raise HTTPException(status_code=404, detail="View not found")
    parsed["access"] = access
    if share:
        parsed["share_id"] = share["id"]
        parsed["shared_by"] = sharing.share_summary(share, for_author=False).get("source_email", "")
    return parsed


@router.get("/saved/{view_id}/columns", response_model=dict[str, Any])
def get_saved_view_columns(
    view_id: int, user: Annotated[User, Depends(require_user)]
):
    """Return columns of a saved view by probing its definition."""
    service = _user_service(user)
    _view_access(service, view_id)
    try:
        columns = service.get_saved_view_columns(view_id)
    except (DatabaseError, ViewModelingError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"view_id": view_id, "columns": columns}


@router.put("/saved/{view_id}", response_model=dict[str, Any])
def update_saved_view(
    view_id: int,
    payload: dict[str, Any],
    user: Annotated[User, Depends(require_user)],
):
    """Update an existing saved view definition using its original connector."""
    service = _user_service(user, payload)
    _require_view_owner(service, view_id)
    try:
        result = service.update_view(view_id, payload)
    except (DatabaseError, ViewModelingError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if result.get("saved"):
        sharing.on_view_saved(service.connector, view_id)
    return result


@router.delete("/saved/{view_id}")
def delete_saved_view(
    view_id: int, user: Annotated[User, Depends(require_user)]
):
    """Delete a saved view from TabObecnyPrehled (author only)."""
    service = _user_service(user)
    _require_view_owner(service, view_id)
    try:
        service.delete_view(view_id)
    except DatabaseError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    sharing.on_view_deleted(service.connector, view_id)
    return {"deleted": True}


# ---------------------------------------------------------------------------
# Sharing
# ---------------------------------------------------------------------------
def _active_connector(user: User, connector_id: Any = None) -> Connector:
    connector = _owned_connector(user, connector_id)
    if connector is None:
        raise HTTPException(status_code=400, detail="Nemáte vybraný konektor.")
    return connector


@router.get("/share-target", response_model=dict[str, Any])
def describe_share_target(
    code: str,
    user: Annotated[User, Depends(require_user)],
    connector_id: int | None = None,
):
    """Return who owns the connector with the given share code (for confirmation)."""
    source = _active_connector(user, connector_id)
    try:
        return sharing.describe_target(code, source)
    except sharing.SharingError as exc:
        raise _sharing_http_error(exc) from exc


@router.get("/saved/{view_id}/shares", response_model=list[dict[str, Any]])
def list_view_shares(
    view_id: int,
    user: Annotated[User, Depends(require_user)],
    connector_id: int | None = None,
):
    """Return the shares of a view (author only)."""
    source = _active_connector(user, connector_id)
    try:
        return sharing.list_view_shares(source, view_id)
    except sharing.SharingError as exc:
        raise _sharing_http_error(exc) from exc


@router.post("/saved/{view_id}/shares", response_model=dict[str, Any])
def share_saved_view(
    view_id: int,
    payload: dict[str, Any],
    user: Annotated[User, Depends(require_user)],
):
    """Share a view with the connector identified by ``code`` (author only)."""
    source = _active_connector(user, payload.get("connector_id"))
    code = (payload.get("code") or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="Zadejte kód konektoru.")
    try:
        return sharing.share_view(user, source, view_id, code)
    except sharing.SharingError as exc:
        raise _sharing_http_error(exc) from exc
    except (DatabaseError, ViewModelingError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/shares/{share_id}", response_model=dict[str, Any])
def revoke_share(share_id: int, user: Annotated[User, Depends(require_user)]):
    """Revoke a share (author). The recipient no longer sees the view."""
    try:
        return sharing.revoke_share(user, share_id)
    except sharing.SharingError as exc:
        raise _sharing_http_error(exc) from exc


@router.get("/shares/incoming", response_model=list[dict[str, Any]])
def incoming_shares(user: Annotated[User, Depends(require_user)]):
    """Invitations and new versions waiting for the current user's decision."""
    return sharing.incoming_shares(user)


@router.get("/shares/{share_id}", response_model=dict[str, Any])
def share_detail(share_id: int, user: Annotated[User, Depends(require_user)]):
    """Snapshot of a shared view for preview before accepting."""
    try:
        return sharing.share_detail(user, share_id)
    except sharing.SharingError as exc:
        raise _sharing_http_error(exc) from exc


@router.post("/shares/{share_id}/accept", response_model=dict[str, Any])
def accept_share(share_id: int, user: Annotated[User, Depends(require_user)]):
    """Accept an invitation or a new version; creates the view for the recipient."""
    try:
        return sharing.accept_share(user, share_id)
    except sharing.SharingError as exc:
        raise _sharing_http_error(exc) from exc


@router.post("/shares/{share_id}/decline", response_model=dict[str, Any])
def decline_share(share_id: int, user: Annotated[User, Depends(require_user)]):
    """Decline an invitation, or skip an offered new version."""
    try:
        return sharing.decline_share(user, share_id)
    except sharing.SharingError as exc:
        raise _sharing_http_error(exc) from exc


@router.post("/shares/{share_id}/remove", response_model=dict[str, Any])
def remove_share(share_id: int, user: Annotated[User, Depends(require_user)]):
    """Recipient removes a shared view from their list."""
    try:
        return sharing.remove_share(user, share_id)
    except sharing.SharingError as exc:
        raise _sharing_http_error(exc) from exc


@router.get("/api-config", response_model=dict[str, str])
def get_api_config(
    user: Annotated[User, Depends(require_user)],
    connector_id: int | None = None,
):
    """Return public API connection details for bat template generation.

    The full API key is intentionally not exposed; only a short prefix is
    returned as a hint so the user can verify they are using the right key.

    The tenant is taken from the requested connector (or the user's active
    connector) so the generated .bat file points at the correct public API path.
    """
    settings = get_settings()
    user_storage = UserStorage()
    connector: Connector | None = None
    if connector_id:
        connector = user_storage.get_connector_by_id(connector_id)
        if connector is not None and connector.user_id != user.id:
            connector = None
    if connector is None:
        connector = user_storage.get_connector_by_id(user.connector_id)
    tenant = (connector.api_tenant if connector else settings.API_TENANT) or ""
    key = settings.API_KEY or ""
    return {
        "api_base_url": settings.api_base_url(),
        "api_tenant": tenant,
        "api_key_header": settings.API_KEY_HEADER,
        "api_key_prefix": key[:4] if len(key) >= 4 else "",
        "ssl_certfile": settings.SSL_CERTFILE or "",
        "ssl_pfx_path": settings.SSL_PFX_PATH or "",
    }


def ensure_tab_obecny_prehled_exists() -> None:
    """Public helper used by application startup if needed."""
    service = ViewModelingService()
    service.ensure_tab_obecny_prehled_table()
