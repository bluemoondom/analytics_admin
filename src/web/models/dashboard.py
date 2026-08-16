"""Pydantic models for dashboard configuration and API responses."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class DashboardFilter(BaseModel):
    """A single filter entry stored in a dashboard."""

    column: str
    type: str  # text | number | date
    operator: str = "="  # = | != | contains | not_contains | starts | ends | like
    value: Any | None = None
    min_value: Any | None = None
    max_value: Any | None = None
    from_value: Any | None = None
    to_value: Any | None = None


class ChartSeries(BaseModel):
    """A single data series inside a chart."""

    id: int | None = None
    y_column: str
    aggregation: str = "sum"  # sum | count | avg | min | max
    label: str = ""
    render_as: str = "bar"  # bar | line


class DashboardChart(BaseModel):
    """Chart attached to a dashboard."""

    id: int | None = None
    chart_type: str  # bar | line | pie | scatter | gauge | funnel
    x_column: str
    series: list[ChartSeries] = Field(default_factory=list)
    split_by_column: str = ""  # categorical column -> one dataset per value
    title: str = ""
    x_label: str = ""  # Custom label for X axis.
    y_label: str = ""  # Custom label for Y axis.

    # Legacy single-series fields kept for compatibility.
    y_column: str = ""
    aggregation: str = "sum"


class SortRule(BaseModel):
    """A single sort criterion: column and direction."""

    column: str
    desc: bool = False


class Dashboard(BaseModel):
    """Full dashboard definition."""

    id: int | None = None
    user_id: int | None = None
    connector_id: int | None = None
    name: str
    view_name: str
    view_display_name: str = ""
    visible_columns: list[str] = Field(default_factory=list)
    filters: list[DashboardFilter] = Field(default_factory=list)
    sort_by: str = ""
    sort_desc: bool = False
    sort: list[SortRule] = Field(default_factory=list)
    group_by: list[str] = Field(default_factory=list)
    # Per-column aggregation function. Missing or empty value means "group by".
    aggregations: dict[str, str] = Field(default_factory=dict)
    # User-friendly aliases displayed in table headers and chart labels.
    column_aliases: dict[str, str] = Field(default_factory=dict)
    # Columns used as dimensions, ordered from left to right / outer to inner.
    dimension_columns: list[str] = Field(default_factory=list)
    # Drill-down dimensions shown as expandable rows (inner dimensions).
    drill_down_columns: list[str] = Field(default_factory=list)
    # Global sort direction for drill-down dimensions.
    drill_down_sort_desc: bool = False
    charts: list[DashboardChart] = Field(default_factory=list)
    # Display settings.
    number_format: str = "#,##0.00"
    date_time_format: str = "dd.MM.yyyy HH:mm"
    color_scheme: str = "default"
    charts_per_row: int = 3
    chart_card_height: int = 360
    show_grid: bool = True
    replace_null_with_empty: bool = True
    color_numeric_sign: bool = False
    row_limit: int = 1000
    created_at: datetime | None = None
    updated_at: datetime | None = None


class DashboardSummary(BaseModel):
    """Lightweight dashboard list item."""

    id: int
    user_id: int | None = None
    connector_id: int | None = None
    name: str
    view_name: str
    updated_at: datetime | None = None


class DataQueryRequest(BaseModel):
    """Request body for ad-hoc table data."""

    view_name: str
    visible_columns: list[str] = Field(default_factory=list)
    filters: list[DashboardFilter] = Field(default_factory=list)
    sort_by: str = ""
    sort_desc: bool = False
    sort: list[SortRule] = Field(default_factory=list)
    group_by: list[str] = Field(default_factory=list)
    aggregations: dict[str, str] = Field(default_factory=dict)
    number_format: str = "#,##0.00"
    date_time_format: str = "dd.MM.yyyy HH:mm"
    dimension_columns: list[str] = Field(default_factory=list)
    drill_down_columns: list[str] = Field(default_factory=list)
    drill_down_sort_desc: bool = False
    replace_null_with_empty: bool = True
    color_numeric_sign: bool = False
    row_limit: int = 0



class DataQueryResponse(BaseModel):
    """Response body for ad-hoc table data."""

    columns: list[str]
    column_types: dict[str, str]
    rows: list[dict[str, Any]]
    group_by: list[str] = Field(default_factory=list)
    aggregations: dict[str, str] = Field(default_factory=dict)
    error: str | None = None
    number_format: str = "#,##0.00"
    dimension_columns: list[str] = Field(default_factory=list)
    drill_down_columns: list[str] = Field(default_factory=list)
    drill_down_rows: list[dict[str, Any]] = Field(default_factory=list)
