"""API routes for view modeling (joins, columns, TabObecnyPrehled storage)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException

from src.web.auth import require_user
from src.web.config import get_settings
from src.web.db import DatabaseError
from src.web.models.user import Connector, User
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
        return service.save_view(payload)
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
    """Return a single saved view, parsed for editing if possible."""
    service = _user_service(user)
    parsed = service.parse_saved_view(view_id)
    if not parsed:
        raise HTTPException(status_code=404, detail="View not found")
    return parsed


@router.get("/saved/{view_id}/columns", response_model=dict[str, Any])
def get_saved_view_columns(
    view_id: int, user: Annotated[User, Depends(require_user)]
):
    """Return columns of a saved view by probing its definition."""
    service = _user_service(user)
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
    try:
        return service.update_view(view_id, payload)
    except (DatabaseError, ViewModelingError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/saved/{view_id}")
def delete_saved_view(
    view_id: int, user: Annotated[User, Depends(require_user)]
):
    """Delete a saved view from TabObecnyPrehled."""
    service = _user_service(user)
    try:
        service.delete_view(view_id)
    except DatabaseError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"deleted": True}


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
