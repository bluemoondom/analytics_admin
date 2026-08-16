"""High-level services used by API routers."""

from __future__ import annotations

from typing import Any

from src.web.db import fetch_data, get_columns, list_views
from src.web.models.dashboard import Dashboard, DataQueryRequest


def discover_views(connector=None) -> list[dict[str, Any]]:
    """Return the list of available source views."""
    return list_views(connector=connector)


def describe_view(view_name: str, connector=None) -> dict[str, Any]:
    """Return columns and metadata for a view."""
    columns = get_columns(view_name, connector=connector)
    return {
        "view_name": view_name,
        "columns": columns,
    }


def run_data_query(payload: DataQueryRequest, connector=None) -> dict[str, Any]:
    """Execute an ad-hoc data query from the UI."""
    filters: dict[str, list[dict[str, Any]]] = {}
    for f in payload.filters:
        entry: dict[str, Any] = {
            "operator": f.operator,
            "value": f.value,
            "min_value": f.min_value,
            "max_value": f.max_value,
            "from_value": f.from_value,
            "to_value": f.to_value,
        }
        filters.setdefault(f.column, []).append(entry)

    result = fetch_data(
        view_name=payload.view_name,
        filters=filters,
        sort_by=payload.sort_by or None,
        sort_desc=payload.sort_desc,
        sort=[{"column": s.column, "desc": s.desc} for s in payload.sort],
        visible_columns=payload.visible_columns or None,
        group_by=payload.group_by if payload.group_by else None,
        aggregations=payload.aggregations or None,
        number_format=payload.number_format,
        date_time_format=payload.date_time_format,
        dimension_columns=payload.dimension_columns or None,
        drill_down_columns=payload.drill_down_columns or None,
        drill_down_sort_desc=payload.drill_down_sort_desc,
        replace_null_with_empty=payload.replace_null_with_empty,
        color_numeric_sign=payload.color_numeric_sign,
        row_limit=payload.row_limit,
        connector=connector,
    )
    return result


def dashboard_to_query_payload(dashboard: Dashboard) -> DataQueryRequest:
    """Convert stored dashboard filters to a data query request."""
    return DataQueryRequest(
        view_name=dashboard.view_name,
        visible_columns=dashboard.visible_columns,
        filters=dashboard.filters,
        sort_by=dashboard.sort_by,
        sort_desc=dashboard.sort_desc,
        sort=dashboard.sort,
        group_by=dashboard.group_by,
        aggregations=dashboard.aggregations,
        number_format=dashboard.number_format,
        date_time_format=dashboard.date_time_format,
        dimension_columns=dashboard.dimension_columns,
        drill_down_columns=dashboard.drill_down_columns,
        drill_down_sort_desc=dashboard.drill_down_sort_desc,
        replace_null_with_empty=dashboard.replace_null_with_empty,
        color_numeric_sign=dashboard.color_numeric_sign,
        row_limit=dashboard.row_limit,
    )
