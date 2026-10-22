"""Read-only API behind public dashboard links (no sign-in).

Every endpoint works with the stored dashboard definition only; the request
body can change nothing but the sorting of the table. See
services/public_links.py.
"""

from __future__ import annotations

from typing import Annotated, Any

import time

from fastapi import APIRouter, Body, HTTPException, Request

from src.web.client_ip import client_ip
from src.web.config import get_settings
from src.web.db import DatabaseError
from src.web.models.dashboard import ChartDataRequest, SortRule
from src.web.routers.dashboards import excel_response, kpi_values
from src.web.services import public_links
from src.web.services.dashboard_sharing import required_columns, snapshot_of
from src.web.services.query import (
    dashboard_to_query_payload,
    describe_view,
    run_chart_queries,
    run_data_query,
)

router = APIRouter(prefix="/api/public/dashboards", tags=["public dashboards"])

INVALID = "Odkaz neplatí. Mohl vypršet, být zrušen, nebo byl dashboard smazán."


# (token hash, client address, minute) -> requests
_hits: dict[tuple[str, str, int], int] = {}


def _rate_limit(token: str, request: Request) -> None:
    """At most PUBLIC_LINK_MAX_REQUESTS_PER_MINUTE requests per link and address."""
    limit = get_settings().PUBLIC_LINK_MAX_REQUESTS_PER_MINUTE
    if limit <= 0:
        return
    minute = int(time.time() // 60)
    key = (public_links.token_hash(token)[:32], client_ip(request), minute)
    _hits[key] = _hits.get(key, 0) + 1
    if len(_hits) > 10000:  # forget old windows
        for old in [k for k in _hits if k[2] < minute]:
            del _hits[old]
    if _hits[key] > limit:
        raise HTTPException(status_code=429, detail="Příliš mnoho požadavků. Zkuste to prosím za minutu.")


def _resolve(token: str, request: Request):
    _rate_limit(token, request)
    found = public_links.resolve(token)
    if found is None:
        raise HTTPException(status_code=404, detail=INVALID)
    return found


def _allowed_columns(dashboard) -> set[str]:
    return set(required_columns(snapshot_of(dashboard)))


@router.get("/{token}")
def public_dashboard(token: str, request: Request):
    link, dashboard, _connector = _resolve(token, request)
    public_links.record_access(link)
    return public_links.public_definition(link, dashboard)


@router.get("/{token}/columns")
def public_columns(token: str, request: Request):
    """Column metadata of the columns the dashboard uses (no other columns of the view)."""
    _link, dashboard, connector = _resolve(token, request)
    allowed = _allowed_columns(dashboard)
    try:
        info = describe_view(dashboard.view_name, connector=connector)
    except DatabaseError as exc:
        raise HTTPException(status_code=400, detail="Data dashboardu se nepodařilo načíst.") from exc
    info["columns"] = [c for c in info.get("columns") or [] if c.get("name") in allowed]
    return info


@router.post("/{token}/data")
def public_data(token: str, request: Request, body: Annotated[dict[str, Any] | None, Body()] = None):
    """Table data of the stored dashboard; only the sorting may come from the visitor."""
    _link, dashboard, connector = _resolve(token, request)
    payload = dashboard_to_query_payload(dashboard)
    body = body or {}
    allowed = _allowed_columns(dashboard)
    sort = []
    for rule in body.get("sort") or []:
        if isinstance(rule, dict) and rule.get("column") in allowed:
            sort.append(SortRule(column=rule["column"], desc=bool(rule.get("desc"))))
    if sort or "sort" in body:
        payload.sort = sort[:10]
    if "sort_by" in body:
        sort_by = body.get("sort_by") or ""
        payload.sort_by = sort_by if sort_by in allowed else ""
        payload.sort_desc = bool(body.get("sort_desc"))
    if "drill_down_sort_desc" in body:
        payload.drill_down_sort_desc = bool(body.get("drill_down_sort_desc"))
    return run_data_query(payload, connector=connector)


def _chart_key(chart: dict[str, Any]) -> tuple:
    series = chart.get("series") or []
    if not series and chart.get("y_column"):
        series = [{"y_column": chart.get("y_column"), "aggregation": chart.get("aggregation") or "sum"}]
    return (
        chart.get("chart_type") or "",
        chart.get("x_column") or "",
        chart.get("split_by_column") or "",
        tuple((s.get("y_column") or "", s.get("aggregation") or "sum") for s in series),
    )


@router.post("/{token}/chart-data")
def public_chart_data(token: str, request: Request, body: Annotated[dict[str, Any] | None, Body()] = None):
    """Data of the dashboard's charts; a requested chart must be one of them."""
    _link, dashboard, connector = _resolve(token, request)
    stored = {_chart_key(c.model_dump()): c for c in dashboard.charts}
    requested = (body or {}).get("charts") or []
    matched = [stored.get(_chart_key(c)) if isinstance(c, dict) else None for c in requested]
    charts = [c for c in matched if c is not None]
    results = run_chart_queries(
        ChartDataRequest(
            view_name=dashboard.view_name,
            filters=dashboard.filters,
            replace_null_with_empty=dashboard.replace_null_with_empty,
            charts=charts,
        ),
        connector=connector,
    ) if charts else []
    out, it = [], iter(results)
    for chart in matched:
        out.append(next(it) if chart is not None else {"rows": [], "truncated": False, "error": "Graf není součástí dashboardu."})
    return {"charts": out}


@router.post("/{token}/kpi")
def public_kpi(token: str, request: Request):
    _link, dashboard, connector = _resolve(token, request)
    return kpi_values(dashboard, connector)


@router.post("/{token}/export/excel")
def public_excel(token: str, request: Request):
    _link, dashboard, connector = _resolve(token, request)
    return excel_response(dashboard, connector)
