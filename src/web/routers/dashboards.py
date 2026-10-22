"""Dashboard API routes."""

from __future__ import annotations

import datetime as dt
from typing import Annotated, Any

import os

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request

from src.web.auth import require_user
from src.web.db import DatabaseError
from src.web.models.dashboard import (
    ChartDataRequest,
    ChartDescriptionUpdate,
    Dashboard,
    DashboardSummary,
    DataQueryRequest,
    ExpandedChartUpdate,
)
from src.web.models.user import User
from src.web.services import dashboard_sharing as sharing
from src.web.services import public_links
from src.web.services.export import export_pivot_to_excel, export_table_to_excel
from src.web.services.query import (
    dashboard_to_query_payload,
    describe_view,
    discover_views,
    run_chart_queries,
    run_data_query,
    run_kpi_query,
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
    """Return the connector stored for a dashboard, if it belongs to the dashboard's owner.

    A dashboard never reads through someone else's connector, even if such an
    id ended up in its definition.
    """
    if dashboard.connector_id is None:
        return None
    connector = UserStorage().get_connector_by_id(dashboard.connector_id)
    if connector is None or connector.user_id != dashboard.user_id:
        return None
    return connector


def _owned_connector_id(user: User, connector_id: Any) -> int | None:
    """The connector id if the user owns that connector, else the active connector."""
    if connector_id:
        try:
            connector = UserStorage().get_connector_by_id(int(connector_id))
        except (TypeError, ValueError):
            connector = None
        if connector is not None and connector.user_id == user.id:
            return connector.id
    return user.connector_id


def _query_connector(user: User, connector_id: int | None) -> Any:
    """Connector for an open dashboard: its own connector when it belongs to the user.

    Dashboards keep the connector they were created (or accepted) with; the
    active connector is used for new dashboards and as a fallback. Every user,
    admins included, reads only through their own connectors.
    """
    if connector_id:
        try:
            connector = UserStorage().get_connector_by_id(int(connector_id))
        except (TypeError, ValueError):
            connector = None
        if connector is not None and connector.user_id == user.id:
            return connector
    return _user_connector(user)


ConnectorParam = Annotated[int | None, Query(alias="connector_id")]


@router.get("/views", response_model=list[dict[str, Any]])
def get_views(user: Annotated[User, Depends(require_user)], connector_id: ConnectorParam = None):
    """Return the list of available source views for the dashboard's connector."""
    return discover_views(connector=_query_connector(user, connector_id))


@router.get("/views/{view_name}/columns")
def get_view_columns(
    view_name: str, user: Annotated[User, Depends(require_user)], connector_id: ConnectorParam = None
):
    """Return columns for the selected view using the dashboard's connector."""
    try:
        return describe_view(view_name, connector=_query_connector(user, connector_id))
    except DatabaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/chart-data", response_model=dict[str, Any])
def query_chart_data(
    payload: ChartDataRequest, user: Annotated[User, Depends(require_user)], connector_id: ConnectorParam = None
):
    """Aggregate chart data on the server for the given (unsaved) chart definitions."""
    return {"charts": run_chart_queries(payload, connector=_query_connector(user, connector_id))}


@router.post("/data", response_model=dict[str, Any])
def query_data(
    payload: DataQueryRequest, user: Annotated[User, Depends(require_user)], connector_id: ConnectorParam = None
):
    """Return filtered / sorted / grouped data for the table."""
    return run_data_query(payload, connector=_query_connector(user, connector_id))


# ---------------------------------------------------------------------------
# Sharing dashboards (see services/dashboard_sharing.py)
# ---------------------------------------------------------------------------
def _sharing_http_error(exc: sharing.DashboardSharingError) -> HTTPException:
    if isinstance(exc, sharing.DashboardShareNotFound):
        return HTTPException(status_code=404, detail=str(exc))
    return HTTPException(status_code=400, detail=str(exc))


@router.get("/shares/incoming")
def incoming_dashboard_shares(user: Annotated[User, Depends(require_user)]):
    """Invitations and updates waiting for the user's decision."""
    return sharing.incoming(user)


@router.get("/shares/{share_id}")
def dashboard_share_detail(share_id: int, user: Annotated[User, Depends(require_user)]):
    """Share detail; for the recipient including which connectors can run it."""
    try:
        return sharing.share_detail(user, share_id)
    except sharing.DashboardSharingError as exc:
        raise _sharing_http_error(exc) from exc


@router.post("/shares/{share_id}/accept")
def accept_dashboard_share(
    share_id: int,
    user: Annotated[User, Depends(require_user)],
    payload: Annotated[dict[str, Any] | None, Body()] = None,
):
    try:
        return sharing.accept(user, share_id, (payload or {}).get("connector_id"))
    except sharing.DashboardSharingError as exc:
        raise _sharing_http_error(exc) from exc


@router.post("/shares/{share_id}/decline")
def decline_dashboard_share(share_id: int, user: Annotated[User, Depends(require_user)]):
    try:
        return sharing.decline(user, share_id)
    except sharing.DashboardSharingError as exc:
        raise _sharing_http_error(exc) from exc


@router.post("/shares/{share_id}/revoke")
def revoke_dashboard_share(share_id: int, user: Annotated[User, Depends(require_user)]):
    try:
        return sharing.revoke(user, share_id)
    except sharing.DashboardSharingError as exc:
        raise _sharing_http_error(exc) from exc


# ---------------------------------------------------------------------------
# Public links (see services/public_links.py)
# ---------------------------------------------------------------------------
def _public_base(request: Request) -> str:
    """Address of the web application used in public links."""
    return (os.getenv("APP_BASE_URL") or str(request.base_url)).rstrip("/")


def _public_http_error(exc: public_links.PublicLinkError) -> HTTPException:
    if isinstance(exc, public_links.PublicLinkNotFound):
        return HTTPException(status_code=404, detail=str(exc))
    return HTTPException(status_code=400, detail=str(exc))


@router.get("/{dashboard_id}/public-links")
def list_public_links(dashboard_id: int, request: Request, user: Annotated[User, Depends(require_user)]):
    try:
        return public_links.list_links(user, dashboard_id, _public_base(request))
    except public_links.PublicLinkError as exc:
        raise _public_http_error(exc) from exc


@router.post("/{dashboard_id}/public-links")
def create_public_link(
    dashboard_id: int,
    request: Request,
    user: Annotated[User, Depends(require_user)],
    payload: Annotated[dict[str, Any], Body()],
):
    """New read-only link to the dashboard (label and expiry are optional)."""
    try:
        return public_links.create_link(
            user, dashboard_id, str(payload.get("label") or ""), payload.get("expires"), _public_base(request)
        )
    except public_links.PublicLinkError as exc:
        raise _public_http_error(exc) from exc


@router.post("/public-links/{link_id}/revoke")
def revoke_public_link(link_id: int, request: Request, user: Annotated[User, Depends(require_user)]):
    try:
        return public_links.revoke_link(user, link_id, _public_base(request))
    except public_links.PublicLinkError as exc:
        raise _public_http_error(exc) from exc


@router.delete("/public-links/{link_id}")
def delete_public_link(link_id: int, user: Annotated[User, Depends(require_user)]):
    try:
        public_links.delete_link(user, link_id)
    except public_links.PublicLinkError as exc:
        raise _public_http_error(exc) from exc
    return {"deleted": True}


@router.post("/{dashboard_id}/shares/check")
def check_dashboard_share(
    dashboard_id: int,
    user: Annotated[User, Depends(require_user)],
    payload: Annotated[dict[str, Any], Body()],
):
    """What sharing with this e-mail involves (recipient, missing views)."""
    try:
        return sharing.check_recipient(user, dashboard_id, str(payload.get("email") or ""))
    except sharing.DashboardSharingError as exc:
        raise _sharing_http_error(exc) from exc


@router.get("/{dashboard_id}/shares")
def list_dashboard_shares(dashboard_id: int, user: Annotated[User, Depends(require_user)]):
    try:
        return sharing.list_shares(user, dashboard_id)
    except sharing.DashboardSharingError as exc:
        raise _sharing_http_error(exc) from exc


@router.post("/{dashboard_id}/shares")
def share_dashboard(
    dashboard_id: int,
    user: Annotated[User, Depends(require_user)],
    payload: Annotated[dict[str, Any], Body()],
):
    """Send the dashboard to a user by e-mail (optionally with its view)."""
    try:
        return sharing.share_dashboard(
            user, dashboard_id, str(payload.get("email") or ""), bool(payload.get("share_view"))
        )
    except sharing.DashboardSharingError as exc:
        raise _sharing_http_error(exc) from exc


@router.get("/", response_model=list[DashboardSummary])
def list_dashboards(storage: StorageDep, user: Annotated[User, Depends(require_user)]):
    """Return dashboards belonging to the current user."""
    hidden = sharing.hidden_dashboard_ids(user.id)
    copies = sharing.copy_info(user.id)
    return [
        DashboardSummary(
            id=d.id,
            user_id=d.user_id,
            connector_id=d.connector_id,
            name=d.name,
            view_name=d.view_name,
            updated_at=d.updated_at,
            **(copies.get(d.id) or {}),
        )
        for d in storage.list_dashboards(user_id=user.id, include_all=False)
        if d.id not in hidden
    ]


@router.post("/", response_model=Dashboard)
def create_dashboard(
    dashboard: Dashboard,
    storage: StorageDep,
    user: Annotated[User, Depends(require_user)],
):
    """Create a dashboard of the current user on one of the user's connectors."""
    dashboard.id = None
    dashboard.user_id = user.id
    dashboard.connector_id = _owned_connector_id(user, dashboard.connector_id)
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
    # Owner and connector never change through an update (for admins neither).
    dashboard.user_id = existing.user_id
    dashboard.connector_id = existing.connector_id
    saved = storage.save_dashboard(dashboard)
    sharing.on_dashboard_saved(saved)
    return saved


@router.put("/{dashboard_id}/charts/{chart_id}/description")
def set_chart_description(
    dashboard_id: int,
    chart_id: int,
    payload: ChartDescriptionUpdate,
    storage: StorageDep,
    user: Annotated[User, Depends(require_user)],
):
    """Save the description of one chart without saving other dashboard changes."""
    existing = storage.get_dashboard_for_user(dashboard_id, user)
    if not existing:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    if not any(c.id == chart_id for c in existing.charts):
        raise HTTPException(status_code=404, detail="Chart not found")
    updated_at = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    updated_by = user.email or ""
    if not storage.set_chart_description(
        dashboard_id, chart_id, payload.description, payload.show_caption, updated_by, updated_at
    ):
        raise HTTPException(status_code=404, detail="Chart not found")
    refreshed = storage.get_dashboard(dashboard_id)
    if refreshed is not None:
        sharing.on_dashboard_saved(refreshed)
    return {
        "id": chart_id,
        "description": payload.description,
        "show_caption": payload.show_caption,
        "description_updated_by": updated_by,
        "description_updated_at": updated_at,
    }


@router.put("/{dashboard_id}/expanded-chart")
def set_expanded_chart(
    dashboard_id: int,
    payload: ExpandedChartUpdate,
    storage: StorageDep,
    user: Annotated[User, Depends(require_user)],
):
    """Remember which chart is shown enlarged, without saving other changes."""
    existing = storage.get_dashboard_for_user(dashboard_id, user)
    if not existing:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    value = payload.expanded_chart
    if value is not None and not 0 <= value < len(existing.charts):
        raise HTTPException(status_code=400, detail="Chart index out of range")
    storage.set_expanded_chart(dashboard_id, value)
    return {"expanded_chart": value}


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
    sharing.on_dashboard_deleted(existing)
    public_links.on_dashboard_deleted(dashboard_id)
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


@router.post("/{dashboard_id}/kpi", response_model=list[dict[str, Any]])
def get_dashboard_kpi(
    dashboard_id: int,
    storage: StorageDep,
    user: Annotated[User, Depends(require_user)],
):
    """Return computed KPI card values for a dashboard."""
    dashboard = storage.get_dashboard_for_user(dashboard_id, user)
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    return kpi_values(dashboard, _dashboard_connector(dashboard) or _user_connector(user))


def kpi_values(dashboard: Dashboard, connector: Any) -> list[dict[str, Any]]:
    """KPI card values of a stored dashboard (also used by public links)."""
    payload = dashboard_to_query_payload(dashboard)
    payload.visible_columns = list(
        dict.fromkeys(
            [k.column for k in dashboard.kpi_cards]
            + [k.previous_column for k in dashboard.kpi_cards if k.previous_column]
        )
    )
    payload.row_limit = 0
    return [
        {
            "id": k.id,
            "title": k.title,
            "column": k.column,
            **run_kpi_query(k, payload, connector=connector),
        }
        for k in dashboard.kpi_cards
    ]


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
    return excel_response(dashboard, _dashboard_connector(dashboard) or _user_connector(user))


def excel_response(dashboard: Dashboard, connector: Any):
    """Excel export of a stored dashboard (also used by public links)."""
    pivot_data = run_data_query(dashboard_to_query_payload(dashboard), connector=connector)
    filename = f"{dashboard.name or 'dashboard'}_data.xlsx".replace(" ", "_")

    dims = pivot_data.get("dimension_columns") or dashboard.dimension_columns or []
    in_pivot_mode = bool(dims) and any(agg.strip() for agg in dashboard.aggregations.values())

    if in_pivot_mode:
        detail_payload = dashboard_to_query_payload(dashboard)
        detail_payload.group_by = []
        detail_payload.aggregations = {}
        detail_payload.dimension_columns = []
        detail_payload.drill_down_columns = []
        detail_data = run_data_query(detail_payload, connector=connector)
        body = export_pivot_to_excel(
            detail_columns=detail_data["columns"],
            detail_rows=detail_data["rows"],
            pivot_columns=pivot_data["columns"],
            pivot_rows=pivot_data["rows"],
            dimension_columns=dims,
            aggregations=dashboard.aggregations,
            column_aliases=dashboard.column_aliases,
            data_sheet_name="Data",
            pivot_sheet_name="Kontingence",
        )
    else:
        body = export_table_to_excel(
            pivot_data["columns"],
            pivot_data["rows"],
            dashboard.column_aliases,
            sheet_name=dashboard.name or "Data",
        )
    from fastapi.responses import Response

    return Response(
        content=body,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": _attachment_header(filename)},
    )


def _attachment_header(filename: str) -> str:
    """Content-Disposition for any file name (HTTP headers are Latin-1 only).

    An ASCII fallback plus the RFC 5987 UTF-8 name, so names with diacritics
    (e.g. "Přehled") download correctly instead of failing.
    """
    import unicodedata
    from urllib.parse import quote

    ascii_name = unicodedata.normalize("NFKD", filename).encode("ascii", "ignore").decode("ascii")
    ascii_name = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in ascii_name) or "dashboard.xlsx"
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename, safe='')}"
