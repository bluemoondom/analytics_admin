"""Persistent storage for dashboard definitions."""

from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from typing import Any

import pymssql

from src.web.config import get_settings
from src.web.models.dashboard import (
    Dashboard,
    DashboardChart,
    DashboardFilter,
    SortRule,
)


def _chart_series(chart_row: Any) -> list[dict[str, Any]]:
    """Return parsed chart series from a storage row."""
    try:
        raw = chart_row["series"]
    except (KeyError, TypeError):
        return []
    if raw:
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return []
    return []


class StorageError(Exception):
    """Raised when a storage operation fails."""


def _now() -> str:
    """Return an ISO 8601 UTC timestamp string."""
    return datetime.now(timezone.utc).isoformat()


def _safe_json_loads(value: Any, default: Any) -> Any:
    """Parse a JSON string, returning default for empty/None/invalid values."""
    if value is None or value == "":
        return default
    try:
        parsed = json.loads(value)
        return parsed if parsed is not None else default
    except (json.JSONDecodeError, TypeError, ValueError):
        return default


def _get_row_value(row: Any, key: str, default: Any = None) -> Any:
    """Return a value from a row dict or sqlite3.Row, with a safe default."""
    try:
        return row[key]
    except (KeyError, TypeError, IndexError):
        return default


class DashboardStorage:
    """Backend-agnostic dashboard storage."""

    def __init__(self) -> None:
        self.backend = get_settings().DASHBOARD_STORAGE_BACKEND
        if self.backend == "mssql":
            self._ensure_mssql_tables()
        else:
            self._ensure_sqlite_tables()

    # ------------------------------------------------------------------
    # SQLite backend
    # ------------------------------------------------------------------
    def _ensure_sqlite_tables(self) -> None:
        path = os.path.abspath(get_settings().DASHBOARD_DB_PATH)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        conn = sqlite3.connect(path)
        try:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS dashboards (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    connector_id INTEGER,
                    name TEXT NOT NULL,
                    view_name TEXT NOT NULL,
                    view_display_name TEXT,
                    visible_columns TEXT NOT NULL DEFAULT '[]',
                    filters TEXT NOT NULL DEFAULT '[]',
                    sort_by TEXT,
                    sort_desc INTEGER NOT NULL DEFAULT 0,
                    group_by TEXT,
                    aggregations TEXT,
                    column_aliases TEXT,
                    dimension_columns TEXT,
                    drill_down_columns TEXT,
                    drill_down_sort_desc INTEGER DEFAULT 0,
                    number_format TEXT,
                    date_time_format TEXT DEFAULT 'dd.MM.yyyy HH:mm',
                    color_scheme TEXT,
                    charts_per_row INTEGER,
                    chart_card_height INTEGER,
                    show_grid INTEGER DEFAULT 1,
                    replace_null_with_empty INTEGER DEFAULT 1,
                    color_numeric_sign INTEGER DEFAULT 0,
                    row_limit INTEGER DEFAULT 1000,
                    created_at TEXT,
                    updated_at TEXT
                )
                """
            )
            self._add_user_id_columns_sqlite(conn)
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS dashboard_charts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    dashboard_id INTEGER NOT NULL,
                    chart_type TEXT NOT NULL,
                    x_column TEXT NOT NULL,
                    y_column TEXT NOT NULL DEFAULT '',
                    aggregation TEXT NOT NULL DEFAULT 'sum',
                    title TEXT,
                    series TEXT,
                    split_by_column TEXT,
                    FOREIGN KEY (dashboard_id) REFERENCES dashboards(id) ON DELETE CASCADE
                )
                """
            )
            # Migration: add series/split_by_column/x_label/y_label columns if missing.
            for col_name, col_type in [
                ("series", "TEXT"),
                ("split_by_column", "TEXT"),
                ("x_label", "TEXT"),
                ("y_label", "TEXT"),
            ]:
                try:
                    conn.execute(
                        f"ALTER TABLE dashboard_charts ADD COLUMN {col_name} {col_type}"
                    )
                except sqlite3.OperationalError:
                    # Migration: add aggregations/column_aliases/display columns if missing.
                    for col_name in [
                        "aggregations",
                        "column_aliases",
                        "dimension_columns",
                        "drill_down_columns",
                        "drill_down_sort_desc",
                        "sort",
                        "number_format",
                        "date_time_format",
                        "color_scheme",
                        "charts_per_row",
                        "chart_card_height",
                        "show_grid",
                        "replace_null_with_empty",
                        "color_numeric_sign",
                        "row_limit",
                    ]:
                        sql_type = "INTEGER" if col_name in {"drill_down_sort_desc", "replace_null_with_empty", "color_numeric_sign", "row_limit"} else "TEXT"
                        try:
                            conn.execute(
                                f"ALTER TABLE dashboards ADD COLUMN {col_name} {sql_type}"
                            )
                        except sqlite3.OperationalError:
                            pass


            conn.commit()

        finally:
            conn.close()

    def _add_user_id_columns_sqlite(self, conn: sqlite3.Connection) -> None:
        """Add user_id / connector_id columns to dashboards table if missing."""
        for col_name, sql_type in [
            ("user_id", "INTEGER"),
            ("connector_id", "INTEGER"),
        ]:
            try:
                conn.execute(
                    f"ALTER TABLE dashboards ADD COLUMN {col_name} {sql_type}"
                )
            except sqlite3.OperationalError:
                pass

    def _sqlite_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(get_settings().DASHBOARD_DB_PATH)
        conn.row_factory = sqlite3.Row
        return conn

    def _load_dashboards_sqlite(
        self, dashboard_id: int | None = None, user_id: int | None = None, include_all: bool = False
    ) -> list[Dashboard]:
        conn = self._sqlite_conn()
        try:
            clauses: list[str] = []
            params: tuple[Any, ...] = ()
            if dashboard_id is not None:
                clauses.append("id = ?")
                params += (dashboard_id,)
            if user_id is not None and not include_all:
                clauses.append("user_id = ?")
                params += (user_id,)
            where = "WHERE " + " AND ".join(clauses) if clauses else ""
            rows = conn.execute(
                f"SELECT * FROM dashboards {where} ORDER BY updated_at DESC", params
            ).fetchall()
            result: list[Dashboard] = []
            for row in rows:
                charts = conn.execute(
                    "SELECT * FROM dashboard_charts WHERE dashboard_id = ?",
                    (row["id"],),
                ).fetchall()
                result.append(self._row_to_dashboard(row, charts))
            return result
        finally:
            conn.close()

    def _save_dashboard_sqlite(self, dashboard: Dashboard) -> Dashboard:
        conn = self._sqlite_conn()
        try:
            now = _now()
            data = {
                "user_id": dashboard.user_id,
                "connector_id": dashboard.connector_id,
                "name": dashboard.name,
                "view_name": dashboard.view_name,
                "view_display_name": dashboard.view_display_name,
                "visible_columns": json.dumps(dashboard.visible_columns),
                "filters": json.dumps([f.model_dump() for f in dashboard.filters]),
                "sort_by": dashboard.sort_by,
                "sort_desc": int(dashboard.sort_desc),
                "sort": json.dumps([s.model_dump() for s in dashboard.sort]),
                "group_by": json.dumps(dashboard.group_by),
                "aggregations": json.dumps(dashboard.aggregations),
                "column_aliases": json.dumps(dashboard.column_aliases),
                "dimension_columns": json.dumps(dashboard.dimension_columns),
                "drill_down_columns": json.dumps(dashboard.drill_down_columns),
                "drill_down_sort_desc": int(dashboard.drill_down_sort_desc),
                "number_format": dashboard.number_format,
                "date_time_format": dashboard.date_time_format,
                "color_scheme": dashboard.color_scheme,
                "charts_per_row": dashboard.charts_per_row,
                "chart_card_height": dashboard.chart_card_height,
                "show_grid": int(dashboard.show_grid),
                "replace_null_with_empty": int(dashboard.replace_null_with_empty),
                "color_numeric_sign": int(dashboard.color_numeric_sign),
                "row_limit": dashboard.row_limit,
            }
            if dashboard.id:
                data["updated_at"] = now
                cols = ", ".join(f"{k} = ?" for k in data)
                conn.execute(
                    f"UPDATE dashboards SET {cols} WHERE id = ?",
                    tuple(data.values()) + (dashboard.id,),
                )
                db_id = dashboard.id
            else:
                data["created_at"] = now
                data["updated_at"] = now
                cols = ", ".join(data.keys())
                placeholders = ", ".join("?" for _ in data)
                cursor = conn.execute(
                    f"INSERT INTO dashboards ({cols}) VALUES ({placeholders})",
                    tuple(data.values()),
                )
                db_id = cursor.lastrowid

            # Replace charts.
            conn.execute(
                "DELETE FROM dashboard_charts WHERE dashboard_id = ?", (db_id,)
            )
            for chart in dashboard.charts:
                conn.execute(
                    """
                    INSERT INTO dashboard_charts
                    (dashboard_id, chart_type, x_column, y_column, aggregation, title, series, split_by_column, x_label, y_label)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        db_id,
                        chart.chart_type,
                        chart.x_column,
                        chart.y_column,
                        chart.aggregation,
                        chart.title,
                        json.dumps([s.model_dump() for s in chart.series]),
                        chart.split_by_column,
                        chart.x_label,
                        chart.y_label,
                    ),
                )
            conn.commit()
            return self._load_dashboards_sqlite(db_id)[0]
        finally:
            conn.close()

    def _delete_dashboard_sqlite(self, dashboard_id: int) -> None:
        conn = self._sqlite_conn()
        try:
            conn.execute("DELETE FROM dashboards WHERE id = ?", (dashboard_id,))
            conn.commit()
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # MSSQL backend (optional)
    # ------------------------------------------------------------------
    def _mssql_connection(self):
        settings = get_settings()
        host = settings.DASHBOARD_DB_HOST or settings.DB_HOST
        port = settings.DASHBOARD_DB_PORT or settings.DB_PORT
        database = settings.DASHBOARD_DB_NAME or settings.DB_NAME
        user = settings.DASHBOARD_DB_USER or settings.DB_USER
        password = settings.DASHBOARD_DB_PASSWORD or settings.DB_PASSWORD
        return pymssql.connect(
            server=host,
            port=port,
            database=database,
            user=user,
            password=password,
            timeout=30,
        )

    def _ensure_mssql_tables(self) -> None:
        try:
            with self._mssql_connection() as conn, conn.cursor() as cur:
                cur.execute(
                    """
                    IF OBJECT_ID('dbo.dashboards', 'U') IS NULL
                    CREATE TABLE dbo.dashboards (
                        id INT IDENTITY(1,1) PRIMARY KEY,
                        user_id INT NULL,
                        connector_id INT NULL,
                        name NVARCHAR(255) NOT NULL,
                        view_name NVARCHAR(255) NOT NULL,
                        view_display_name NVARCHAR(255),
                        visible_columns NVARCHAR(MAX) NOT NULL DEFAULT '[]',
                        filters NVARCHAR(MAX) NOT NULL DEFAULT '[]',
                        sort_by NVARCHAR(255),
                        sort_desc BIT NOT NULL DEFAULT 0,
                    group_by NVARCHAR(255),
                    aggregations NVARCHAR(MAX),
                    column_aliases NVARCHAR(MAX),
                    dimension_columns NVARCHAR(MAX),
                    drill_down_columns NVARCHAR(MAX),
                    number_format NVARCHAR(50),
                    date_time_format NVARCHAR(50),
                    color_scheme NVARCHAR(50),
                    charts_per_row INT,
                    chart_card_height INT,
                    show_grid BIT,
                    drill_down_sort_desc BIT,
                    replace_null_with_empty BIT,
                    color_numeric_sign BIT,
                    row_limit INT DEFAULT 1000,
                    created_at DATETIME2 DEFAULT GETUTCDATE(),
                    updated_at DATETIME2 DEFAULT GETUTCDATE()
                    )
                    """
                )
                # Migration: add user_id / connector_id columns if missing.
                for col_name in ["user_id", "connector_id"]:
                    cur.execute(
                        f"""
                        IF COL_LENGTH('dbo.dashboards', '{col_name}') IS NULL
                        ALTER TABLE dbo.dashboards ADD {col_name} INT
                        """
                    )
                cur.execute(
                    """
                    IF OBJECT_ID('dbo.dashboard_charts', 'U') IS NULL
                    CREATE TABLE dbo.dashboard_charts (
                        id INT IDENTITY(1,1) PRIMARY KEY,
                        dashboard_id INT NOT NULL,
                        chart_type NVARCHAR(50) NOT NULL,
                        x_column NVARCHAR(255) NOT NULL,
                        y_column NVARCHAR(255) NOT NULL DEFAULT '',
                        aggregation NVARCHAR(50) NOT NULL DEFAULT 'sum',
                        title NVARCHAR(500),
                        series NVARCHAR(MAX),
                        split_by_column NVARCHAR(255),
                        FOREIGN KEY (dashboard_id) REFERENCES dbo.dashboards(id) ON DELETE CASCADE
                    )
                    """
                )
                # Migration: add series/split_by_column/x_label/y_label columns if missing.
                for col_name in ["series", "split_by_column", "x_label", "y_label"]:
                    cur.execute(
                        f"""
                        IF COL_LENGTH('dbo.dashboard_charts', '{col_name}') IS NULL
                        ALTER TABLE dbo.dashboard_charts ADD {col_name} NVARCHAR(MAX)
                        """
                    )
                # Migration: add aggregations/column_aliases/display columns if missing.
                for col_name in [
                    "aggregations",
                    "column_aliases",
                    "dimension_columns",
                    "drill_down_columns",
                    "drill_down_sort_desc",
                    "sort",
                    "number_format",
                    "date_time_format",
                    "color_scheme",
                    "charts_per_row",
                    "chart_card_height",
                    "show_grid",
                    "replace_null_with_empty",
                    "color_numeric_sign",
                    "row_limit",
                ]:
                    sql_type = "NVARCHAR(MAX)" if col_name in ["dimension_columns", "drill_down_columns", "sort"] else (
                        "BIT" if col_name in ["show_grid", "drill_down_sort_desc", "replace_null_with_empty", "color_numeric_sign"] else (
                            "NVARCHAR(50)" if col_name in ["number_format", "date_time_format", "color_scheme"] else "INT"
                        )
                    )
                    cur.execute(
                        f"""
                        IF COL_LENGTH('dbo.dashboards', '{col_name}') IS NULL
                        ALTER TABLE dbo.dashboards ADD {col_name} {sql_type}
                        """
                    )

                conn.commit()
        except Exception as exc:
            raise StorageError(
                "Failed to ensure MSSQL dashboard tables. "
                "The 'www' account may lack CREATE TABLE permission. "
                "Switch DASHBOARD_STORAGE_BACKEND=sqlite in the environment or grant permissions."
            ) from exc

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def list_dashboards(self, user_id: int | None = None, include_all: bool = False) -> list[Dashboard]:
        if self.backend == "mssql":
            return self._load_dashboards_mssql(user_id=user_id, include_all=include_all)
        return self._load_dashboards_sqlite(user_id=user_id, include_all=include_all)

    def get_dashboard(self, dashboard_id: int) -> Dashboard | None:
        rows = (
            self._load_dashboards_mssql(dashboard_id)
            if self.backend == "mssql"
            else self._load_dashboards_sqlite(dashboard_id)
        )
        return rows[0] if rows else None

    def get_dashboard_for_user(self, dashboard_id: int, user) -> Dashboard | None:
        dashboard = self.get_dashboard(dashboard_id)
        if dashboard is None:
            return None
        if dashboard.user_id != user.id:
            return None
        return dashboard

    def save_dashboard(self, dashboard: Dashboard) -> Dashboard:
        if self.backend == "mssql":
            return self._save_dashboard_mssql(dashboard)
        return self._save_dashboard_sqlite(dashboard)

    def delete_dashboard(self, dashboard_id: int) -> None:
        if self.backend == "mssql":
            self._delete_dashboard_mssql(dashboard_id)
        else:
            self._delete_dashboard_sqlite(dashboard_id)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _row_to_dashboard(self, row: Any, chart_rows: list[Any]) -> Dashboard:
        visible = _safe_json_loads(_get_row_value(row, "visible_columns"), [])
        filters = [
            DashboardFilter(**f)
            for f in _safe_json_loads(_get_row_value(row, "filters"), [])
        ]
        group_by = _safe_json_loads(_get_row_value(row, "group_by"), [])
        if isinstance(group_by, str):
            group_by = [group_by] if group_by else []
        aggregations = _safe_json_loads(_get_row_value(row, "aggregations"), {})
        if not isinstance(aggregations, dict):
            aggregations = {}
        column_aliases = _safe_json_loads(_get_row_value(row, "column_aliases"), {})
        if not isinstance(column_aliases, dict):
            column_aliases = {}
        number_format = _get_row_value(row, "number_format") or "#,##0.00"
        date_time_format = _get_row_value(row, "date_time_format") or "dd.MM.yyyy HH:mm"
        color_scheme = _get_row_value(row, "color_scheme") or "default"
        charts_per_row = _get_row_value(row, "charts_per_row")
        chart_card_height = _get_row_value(row, "chart_card_height")
        show_grid = _get_row_value(row, "show_grid")
        color_numeric_sign = _get_row_value(row, "color_numeric_sign")
        row_limit = _get_row_value(row, "row_limit")
        dimension_columns = _safe_json_loads(
            _get_row_value(row, "dimension_columns"), []
        )
        drill_down_columns = _safe_json_loads(
            _get_row_value(row, "drill_down_columns"), []
        )
        # Backward compatibility: migrate old single drill_down_column.
        legacy_drill = _get_row_value(row, "drill_down_column") or ""
        if legacy_drill and legacy_drill not in drill_down_columns:
            drill_down_columns.append(legacy_drill)
        drill_down_sort_desc = _get_row_value(row, "drill_down_sort_desc")
        charts = []

        for c in chart_rows:
            series = _chart_series(c)
            y_col = c["y_column"]
            if not series and y_col:
                series = [
                    {
                        "id": None,
                        "y_column": y_col,
                        "aggregation": c["aggregation"],
                        "label": y_col,
                    }
                ]
            charts.append(
                DashboardChart(
                    id=c["id"],
                    chart_type=c["chart_type"],
                    x_column=c["x_column"],
                    y_column=y_col or "",
                    aggregation=c["aggregation"] or "sum",
                    title=c["title"] or "",
                    series=series,
                    split_by_column=c["split_by_column"] or "",
                    x_label=c["x_label"] or "",
                    y_label=c["y_label"] or "",
                )
            )
        sort_raw = _safe_json_loads(_get_row_value(row, "sort"), [])
        sort_rules = [SortRule(**s) for s in sort_raw if isinstance(s, dict)]
        return Dashboard(
            id=_get_row_value(row, "id"),
            user_id=_get_row_value(row, "user_id"),
            connector_id=_get_row_value(row, "connector_id"),
            name=_get_row_value(row, "name"),
            view_name=_get_row_value(row, "view_name"),
            view_display_name=_get_row_value(row, "view_display_name") or "",
            visible_columns=visible,
            filters=filters,
            sort_by=_get_row_value(row, "sort_by") or "",
            sort_desc=bool(_get_row_value(row, "sort_desc")),
            sort=sort_rules,
            group_by=group_by,
            aggregations=aggregations,
            column_aliases=column_aliases,
            charts=charts,
            number_format=number_format,
            date_time_format=date_time_format,
            color_scheme=color_scheme,
            charts_per_row=int(charts_per_row) if charts_per_row is not None else 3,
            chart_card_height=int(chart_card_height)
            if chart_card_height is not None
            else 360,
            show_grid=bool(int(show_grid)) if show_grid is not None else True,
            replace_null_with_empty=bool(
                int(_get_row_value(row, "replace_null_with_empty") or 1)
            ),
            color_numeric_sign=bool(int(color_numeric_sign)) if color_numeric_sign is not None else False,
            row_limit=int(row_limit) if row_limit is not None else 1000,
            dimension_columns=dimension_columns,

            drill_down_columns=drill_down_columns,
            drill_down_sort_desc=bool(int(drill_down_sort_desc))
            if drill_down_sort_desc is not None
            else False,
            created_at=_get_row_value(row, "created_at"),
            updated_at=_get_row_value(row, "updated_at"),
        )

    # ------------------------------------------------------------------
    # MSSQL implementations (mirror SQLite)
    # ------------------------------------------------------------------
    def _load_dashboards_mssql(
        self, dashboard_id: int | None = None, user_id: int | None = None, include_all: bool = False
    ) -> list[Dashboard]:
        with self._mssql_connection() as conn, conn.cursor(as_dict=True) as cur:
            clauses: list[str] = []
            params: tuple[Any, ...] = ()
            if dashboard_id is not None:
                clauses.append("id = %s")
                params += (dashboard_id,)
            if user_id is not None and not include_all:
                clauses.append("user_id = %s")
                params += (user_id,)
            where = "WHERE " + " AND ".join(clauses) if clauses else ""
            cur.execute(
                f"SELECT * FROM dbo.dashboards {where} ORDER BY updated_at DESC", params
            )
            rows = cur.fetchall()
            result: list[Dashboard] = []
            for row in rows:
                cur.execute(
                    "SELECT * FROM dbo.dashboard_charts WHERE dashboard_id = %s",
                    (row["id"],),
                )
                charts = cur.fetchall()
                result.append(self._row_to_dashboard(row, charts))
            return result

    def _save_dashboard_mssql(self, dashboard: Dashboard) -> Dashboard:
        with self._mssql_connection() as conn, conn.cursor() as cur:
            visible_json = json.dumps(dashboard.visible_columns)
            filters_json = json.dumps([f.model_dump() for f in dashboard.filters])
            if dashboard.id:
                cur.execute(
                    """
                    UPDATE dbo.dashboards
                    SET user_id = %s, connector_id = %s, name = %s, view_name = %s,
                        view_display_name = %s, visible_columns = %s, filters = %s,
                        sort_by = %s, sort_desc = %s, sort = %s, group_by = %s,
                        aggregations = %s, column_aliases = %s, dimension_columns = %s,
                        drill_down_columns = %s, drill_down_sort_desc = %s,
                        number_format = %s, date_time_format = %s, color_scheme = %s,
                        charts_per_row = %s, chart_card_height = %s, show_grid = %s,
                        replace_null_with_empty = %s, color_numeric_sign = %s,
                        row_limit = %s, updated_at = GETUTCDATE()
                    WHERE id = %s
                    """,
                    (
                        dashboard.user_id,
                        dashboard.connector_id,
                        dashboard.name,
                        dashboard.view_name,
                        dashboard.view_display_name,
                        visible_json,
                        filters_json,
                        dashboard.sort_by,
                        int(dashboard.sort_desc),
                        json.dumps([s.model_dump() for s in dashboard.sort]),
                        json.dumps(dashboard.group_by),
                        json.dumps(dashboard.aggregations),
                        json.dumps(dashboard.column_aliases),
                        json.dumps(dashboard.dimension_columns),
                        json.dumps(dashboard.drill_down_columns),
                        int(dashboard.drill_down_sort_desc),
                        dashboard.number_format,
                        dashboard.date_time_format,
                        dashboard.color_scheme,
                        dashboard.charts_per_row,
                        dashboard.chart_card_height,
                        int(dashboard.show_grid),
                        int(dashboard.replace_null_with_empty),
                        int(dashboard.color_numeric_sign),
                        dashboard.row_limit,
                        dashboard.id,
                    ),
                )
                db_id = dashboard.id
            else:
                cur.execute(
                    """
                    INSERT INTO dbo.dashboards
                    (user_id, connector_id, name, view_name, view_display_name, visible_columns, filters,
                     sort_by, sort_desc, sort, group_by, aggregations, column_aliases,
                     dimension_columns, drill_down_columns, drill_down_sort_desc,
                     number_format, date_time_format, color_scheme, charts_per_row, chart_card_height, show_grid,
                     replace_null_with_empty, color_numeric_sign, row_limit)
                    OUTPUT INSERTED.id
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        dashboard.user_id,
                        dashboard.connector_id,
                        dashboard.name,
                        dashboard.view_name,
                        dashboard.view_display_name,
                        visible_json,
                        filters_json,
                        dashboard.sort_by,
                        int(dashboard.sort_desc),
                        json.dumps([s.model_dump() for s in dashboard.sort]),
                        json.dumps(dashboard.group_by),
                        json.dumps(dashboard.aggregations),
                        json.dumps(dashboard.column_aliases),
                        json.dumps(dashboard.dimension_columns),
                        json.dumps(dashboard.drill_down_columns),
                        int(dashboard.drill_down_sort_desc),
                        dashboard.number_format,
                        dashboard.date_time_format,
                        dashboard.color_scheme,
                        dashboard.charts_per_row,
                        dashboard.chart_card_height,
                        int(dashboard.show_grid),
                        int(dashboard.replace_null_with_empty),
                        int(dashboard.color_numeric_sign),
                        dashboard.row_limit,
                    ),
                )
                db_id = cur.fetchone()["id"]

            cur.execute(
                "DELETE FROM dbo.dashboard_charts WHERE dashboard_id = %s", (db_id,)
            )
            for chart in dashboard.charts:
                cur.execute(
                    """
                    INSERT INTO dbo.dashboard_charts
                    (dashboard_id, chart_type, x_column, y_column, aggregation, title, series, split_by_column, x_label, y_label)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        db_id,
                        chart.chart_type,
                        chart.x_column,
                        chart.y_column,
                        chart.aggregation,
                        chart.title,
                        json.dumps([s.model_dump() for s in chart.series]),
                        chart.split_by_column,
                        chart.x_label,
                        chart.y_label,
                    ),
                )
            conn.commit()
            loaded = self._load_dashboards_mssql(dashboard_id=db_id)
            return loaded[0]

    def _delete_dashboard_mssql(self, dashboard_id: int) -> None:
        with self._mssql_connection() as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM dbo.dashboards WHERE id = %s", (dashboard_id,))
            conn.commit()
