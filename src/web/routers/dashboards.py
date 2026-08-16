"""Dashboard API routes."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException

from src.web.auth import require_user
from src.web.models.dashboard import Dashboard, DashboardSummary, DataQueryRequest
from src.web.models.user import User, UserRole
from src.web.services.export import export_table_to_excel
from src.web.services.query import (
    dashboard_to_query_payload,
    describe_view,
    discover_views,
    run_data_query,
)
from src.web.services.storage import DashboardStorage
from src.web.services.user_storage import UserStorage

router = APIRouter(prefix="/api/dashboards", tags=["dashboards"])

StorageDep = Annotated[DashboardStorage, Depends(DashboardStorage)]


def _user_connector(user: User) -> Any:
    """Return the connector the user should use for data queries.

    Falls back to the global source settings if the user has no stored
    connector. This keeps existing users/tests working during the transition.
    """
    user_storage = UserStorage()
    if user.connector_id:
        connector = user_storage.get_connector_by_id(user.connector_id)
        if connector is not None:
            return connector
    return None


def _dashboard_connector(dashboard: Dashboard) -> Any:
    """Return the connector stored for a specific dashboard, if any."""
    if dashboard.connector_id is None:
        return None
    return UserStorage().get_connector_by_id(dashboard.connector_id)


@router.get("/views", response_model=list[dict[str, Any]])
def get_views(user: Annotated[User, Depends(require_user)]):
    """Return the list of available source views for the user's connector."""
    return discover_views(connector=_user_connector(user))


@router.get("/views/{view_name}/columns")
def get_view_columns(view_name: str, user: Annotated[User, Depends(require_user)]):
    """Return columns for the selected view using the user's connector."""
    return describe_view(view_name, connector=_user_connector(user))


@router.post("/data", response_model=dict[str, Any])
def query_data(payload: DataQueryRequest, user: Annotated[User, Depends(require_user)]):
    """Return filtered / sorted / grouped data for the table."""
    return run_data_query(payload, connector=_user_connector(user))


@router.get("/", response_model=list[DashboardSummary])
def list_dashboards(storage: StorageDep, user: Annotated[User, Depends(require_user)]):
    """Return dashboards belonging to the current user."""
    return [
        DashboardSummary(
            id=d.id,
            user_id=d.user_id,
            connector_id=d.connector_id,
            name=d.name,
            view_name=d.view_name,
            updated_at=d.updated_at,
        )
        for d in storage.list_dashboards(user_id=user.id, include_all=False)
    ]


@router.post("/", response_model=Dashboard)
def create_dashboard(
    dashboard: Dashboard,
    storage: StorageDep,
    user: Annotated[User, Depends(require_user)],
):
    """Create or update a dashboard."""
    dashboard.user_id = user.id
    if dashboard.connector_id is None:
        dashboard.connector_id = user.connector_id
    return storage.save_dashboard(dashboard)


@router.post("/{dashboard_id}/copy", response_model=Dashboard)
def copy_dashboard(
    dashboard_id: int,
    storage: StorageDep,
    user: Annotated[User, Depends(require_user)],
):
    """Create a copy of an existing dashboard."""
    dashboard = storage.get_dashboard_for_user(dashboard_id, user)
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    dashboard.id = None
    dashboard.user_id = user.id
    dashboard.connector_id = user.connector_id
    dashboard.name = f"{dashboard.name} (kopie)"
    return storage.save_dashboard(dashboard)


@router.get("/{dashboard_id}", response_model=Dashboard)
def get_dashboard(
    dashboard_id: int,
    storage: StorageDep,
    user: Annotated[User, Depends(require_user)],
):
    """Return a single dashboard definition."""
    dashboard = storage.get_dashboard_for_user(dashboard_id, user)
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    return dashboard


@router.put("/{dashboard_id}", response_model=Dashboard)
def update_dashboard(
    dashboard_id: int,
    dashboard: Dashboard,
    storage: StorageDep,
    user: Annotated[User, Depends(require_user)],
):
    """Update an existing dashboard."""
    existing = storage.get_dashboard_for_user(dashboard_id, user)
    if not existing:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    dashboard.id = dashboard_id
    if user.role != UserRole.ADMIN:
        dashboard.user_id = existing.user_id
        dashboard.connector_id = existing.connector_id
    return storage.save_dashboard(dashboard)


@router.delete("/{dashboard_id}")
def delete_dashboard(
    dashboard_id: int,
    storage: StorageDep,
    user: Annotated[User, Depends(require_user)],
):
    """Delete a dashboard."""
    existing = storage.get_dashboard_for_user(dashboard_id, user)
    if not existing:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    storage.delete_dashboard(dashboard_id)
    return {"ok": True}


@router.get("/{dashboard_id}/data")
def get_dashboard_data(
    dashboard_id: int,
    storage: StorageDep,
    user: Annotated[User, Depends(require_user)],
):
    """Run the saved query of a dashboard and return data using its own connector."""
    dashboard = storage.get_dashboard_for_user(dashboard_id, user)
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    connector = _dashboard_connector(dashboard) or _user_connector(user)
    return run_data_query(dashboard_to_query_payload(dashboard), connector=connector)


@router.post("/{dashboard_id}/export/excel")
def export_dashboard_excel(
    dashboard_id: int,
    storage: StorageDep,
    user: Annotated[User, Depends(require_user)],
):
    """Export dashboard table data to Excel using the dashboard's own connector."""
    dashboard = storage.get_dashboard_for_user(dashboard_id, user)
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    connector = _dashboard_connector(dashboard) or _user_connector(user)
    data = run_data_query(dashboard_to_query_payload(dashboard), connector=connector)
    filename = f"{dashboard.name or 'dashboard'}_data.xlsx".replace(" ", "_")
    body = export_table_to_excel(
        data["columns"],
        data["rows"],
        dashboard.column_aliases,
        sheet_name=dashboard.name or "Data",
    )
    from fastapi.responses import Response

    return Response(
        content=body,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
