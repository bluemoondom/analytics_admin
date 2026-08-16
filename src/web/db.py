"""Low-level source database access; dialect-aware via `src.web.dialects`."""

from __future__ import annotations

import contextlib
import datetime
import decimal
from typing import Any

import pyodbc

from src.web.config import get_settings
from src.web.dialects import dialect_for_connector


class DatabaseError(Exception):
    """Raised when a database operation fails."""


@contextlib.contextmanager
def connector_connection(connector=None):
    """Yield a connection to a source database.

    The database driver is resolved from ``connector.db_type`` (MSSQL by
    default).  When ``connector`` is ``None`` the global .env source database
    settings are used for backward compatibility.
    """
    dialect = dialect_for_connector(connector)
    with dialect.connect(connector=connector, settings=get_settings()) as conn:
        yield conn


@contextlib.contextmanager
def _conn_with_cursor(connector=None):
    """Yield ``(conn, cursor)`` handling driver-specific cursor cleanup.

    Goes through ``connector_connection`` so tests patching that function keep
    working regardless of which dialect resolves the connection.
    """
    dialect = dialect_for_connector(connector)
    with connector_connection(connector) as conn, dialect.cursor(conn) as cur:
        yield conn, cur


@contextlib.contextmanager
def source_connection():
    """Yield a connection to the legacy global source database."""
    with connector_connection() as conn:
        yield conn


def _tab_obecny_prehled_exists(conn: Any, dialect=None) -> bool:
    """Check whether TabObecnyPrehled exists without raising."""
    if dialect and not dialect.list_tables_via_tabobecny_prehled():
        return False
    sql = "SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID('dbo.TabObecnyPrehled') AND type IN ('U')"
    try:
        cur = conn.cursor()
        cur.execute(sql)
        return cur.fetchone() is not None
    except pyodbc.Error:
        return False


def index_columns_for(table_name: str, connector=None) -> set[str]:
    """Return indexed column names for a table/view, or empty when unsupported.

    Dialects that cannot read index metadata return an empty set, so the UI
    simply does not show any "indexed column" hints for such databases.
    """
    dialect = dialect_for_connector(connector)
    # Some dialects (e.g. SQLite) read indexes via a specialised helper.
    helper = getattr(dialect, "index_columns", None)
    if helper is not None:
        try:
            with connector_connection(connector) as conn:
                return helper(conn, table_name)
        except dialect.error_class:
            return set()
    sql = dialect.index_columns_sql()
    if not sql:
        return set()
    try:
        with _conn_with_cursor(connector) as (_conn, cur):
            cur.execute(sql, (table_name,))
            cols: set[str] = set()
            for row in cur.fetchall():
                value = row[0] if not isinstance(row, dict) else next(iter(row.values()))
                if value:
                    cols.add(str(value))
            return cols
    except dialect.error_class:
        return set()


def list_views(connector=None) -> list[dict[str, Any]]:
    """Return available user views with their display and system names.

    Uses TabObecnyPrehled when available (MSSQL + Helios mode); otherwise
    falls back to the dialect's metadata query for listing tables/views.
    """
    settings = get_settings()
    dialect = dialect_for_connector(connector)
    use_tab = (
        (connector.view_discovery_mode if connector else settings.VIEW_DISCOVERY_MODE) == "tabobecny_prehled"
        and dialect.list_tables_via_tabobecny_prehled()
    )

    with _conn_with_cursor(connector) as (conn, cur):
        if use_tab and _tab_obecny_prehled_exists(conn, dialect):
            sql = (
                "SELECT DISTINCT NazevSys AS display_name, "
                "COALESCE(NULLIF(NazevSys, ''), '') AS system_name "
                "FROM TabObecnyPrehled WHERE NazevSys IS NOT NULL ORDER BY NazevSys"
            )
        elif use_tab:
            # Helios mode was requested but TabObecnyPrehled is unavailable.
            sql = (
                "SELECT v.name AS system_name, "
                "COALESCE(i.TABLE_NAME, v.name) AS display_name "
                "FROM sys.views v "
                "LEFT JOIN information_schema.views i ON i.TABLE_NAME = v.name "
                "WHERE v.name NOT LIKE 'sys%' "
                "ORDER BY COALESCE(i.TABLE_NAME, v.name)"
            )
        else:
            sql = dialect.list_tables_sql()
            # Keep the same output shape as the legacy list (kind column).
            try:
                cur.execute(sql)
            except Exception as exc:
                raise_dialect_error(exc, dialect)
                raise
            rows = cur.fetchall()
            cols = [d[0] for d in (cur.description or [])]
            result: dict[str, dict[str, Any]] = {}
            for row in rows:
                r = dict(zip(cols, row))
                name = r.get("system_name") or r.get("display_name")
                if not name:
                    continue
                result[name] = {
                    "system_name": name,
                    "display_name": name,
                    "kind": r.get("kind", "table"),
                }
            return sorted(result.values(), key=lambda r: (r["kind"], (r["display_name"] or "").lower()))

        try:
            cur.execute(sql)
        except pyodbc.Error as exc:
            raise DatabaseError(
                f"Unable to read view list using mode '{settings.VIEW_DISCOVERY_MODE}'. "
                "Check DB permissions or switch VIEW_DISCOVERY_MODE."
            ) from exc
        rows = _fetchall_as_dicts(cur)

    # Deduplicate by system_name keeping the friendliest display_name.
    seen: dict[str, dict[str, Any]] = {}
    for row in rows:
        name = row.get("system_name") or row.get("display_name")
        if not name:
            continue
        existing = seen.get(name)
        if existing is None or (
            existing.get("display_name", "").startswith("hvw_")
            and not (row.get("display_name", "").startswith("hvw_"))
        ):
            seen[name] = {
                "system_name": name,
                "display_name": row.get("display_name") or name,
            }
    return sorted(seen.values(), key=lambda r: r["display_name"].lower())


def get_columns(view_name: str, connector=None) -> list[dict[str, Any]]:
    """Return columns for a given view, inferred from the first row.

    For user views stored in TabObecnyPrehled, reads the saved DefView SQL so
    the returned columns reflect the latest definition, not the previously
    materialised database view.  Falls back to executing the view directly or
    to sys.columns metadata when needed.
    """
    def_view = _def_view_for(view_name, connector)
    return _columns_for_view(view_name, connector, def_view)


def raise_dialect_error(exc, dialect) -> None:
    """Re-raise dialect driver-specific errors as :class:`DatabaseError`."""
    raise DatabaseError(str(exc)) from exc


def sql_type_name_dialect(raw_type_code: Any, sample: Any | None, connector=None) -> str:
    """Return the displayed type label for a column, per dialect."""
    return dialect_for_connector(connector).display_type_name(raw_type_code, sample)


def type_family_dialect(raw_type_code: Any, sample: Any, connector=None) -> tuple[str, bool, bool]:
    """Return (family, is_integer, is_text_storage) for a column, per dialect."""
    return dialect_for_connector(connector).type_family(raw_type_code, sample)


def quote_identifier_dialect(name: str, connector=None) -> str:
    """Quote ``name`` using the connector's dialect."""
    return dialect_for_connector(connector).quote_identifier(name)


def limit_first_row_sql(table_ref: str, connector=None) -> str:
    """Return the dialect's "SELECT ... LIMIT 1" style statement."""
    return dialect_for_connector(connector).limit_rows_sql(table_ref, 1)


def _columns_from_descriptions(
    descriptions: list[Any], row: dict[str, Any] | None, dialect=None
) -> list[dict[str, Any]]:
    """Build column info from cursor descriptions and an optional sample row.

    MSSQL keeps its existing behaviour (cursor description holds the type
    code).  Other dialects rely more on the first row's values because the
    ``description[1]`` element varies between drivers.
    """
    columns: list[dict[str, Any]] = []
    for desc in descriptions:
        col_name = desc[0]
        sql_type_code = desc[1]
        sample = row.get(col_name) if row else None
        if dialect is not None:
            family, is_integer, is_text_storage = dialect.type_family(sql_type_code, sample)
            raw_type = dialect.display_type_name(sql_type_code, sample)
        else:
            family = _guess_type(sql_type_code, sample)
            raw_type = _sql_type_name(sql_type_code, sample)
            is_integer = _is_integer_sql_type(sql_type_code)
            is_text_storage = _is_text_sql_type(sql_type_code)
        columns.append(
            {
                "name": col_name,
                "type": family,
                "raw_type": raw_type,
                "is_integer": is_integer,
                "is_text_storage": is_text_storage,
            }
        )
    return columns


def _def_view_for(view_name: str, connector=None) -> str | None:
    """Return the saved DefView for a TabObecnyPrehled entry, if any."""
    dialect = dialect_for_connector(connector)
    with _conn_with_cursor(connector) as (conn, cur):
        if not _tab_obecny_prehled_exists(conn, dialect):
            return None
        try:
            cur.execute(
                "SELECT DefView FROM TabObecnyPrehled WHERE NazevSys = ?",
                (view_name,),
            )
            row = cur.fetchone()
            if row:
                def_view = (
                    row[0]
                    if isinstance(row, (tuple, list))
                    else getattr(row, "DefView", None)
                )
                if def_view and def_view.strip():
                    return def_view.strip()
        except pyodbc.Error:
            pass
    return None


def _columns_for_view(
    view_name: str, connector=None, def_view: str | None = None
) -> list[dict[str, Any]]:
    """Return column metadata for a view, using DefView when available.

    This path is only used for MSSQL-style Helios views; non-MSSQL dialects
    use their own ``SELECT ... LIMIT 1`` + fallback metadata query here.
    """
    dialect = dialect_for_connector(connector)
    clean_name = _sanitize_view_name(view_name)
    source_sql = f"({def_view}) AS sq" if def_view else quote_identifier_dialect(clean_name, connector)
    sql = dialect.limit_first_row_sql(source_sql)
    try:
        with _conn_with_cursor(connector) as (_conn, cur):
            cur.execute(sql)
            row_raw = cur.fetchone()
            descriptions = cur.description or []
            columns_names = [desc[0] for desc in descriptions]
            if row_raw is None:
                row = None
            elif isinstance(row_raw, dict):
                row = row_raw
            else:
                row = dict(zip(columns_names, row_raw))
        return _columns_from_descriptions(descriptions, row, dialect)
    except Exception as exc:
        if def_view:
            return _columns_for_view(view_name, connector, None)
        # Fallback via the dialect's catalog metadata (MSSQL sys.columns
        # path keeps its legacy behaviour).
        if isinstance(exc, pyodbc.Error) or getattr(dialect, "name", "") == "mssql":
            return _get_columns_from_sys_columns(clean_name, connector)
        raise_dialect_error(exc, dialect)
        raise


def _get_columns_from_sys_columns(view_name: str, connector=None) -> list[dict[str, Any]]:
    """Fallback metadata reader using sys.columns / sys.types."""
    sql = """
        SELECT c.name AS column_name, t.name AS type_name, c.max_length,
               c.precision, c.scale
        FROM sys.columns c
        JOIN sys.views v ON c.object_id = v.object_id
        JOIN sys.types t ON c.user_type_id = t.user_type_id
        WHERE v.name = ?
        ORDER BY c.column_id
    """
    with _conn_with_cursor(connector) as (_conn, cur):
        cur.execute(sql, (view_name,))
        rows = _fetchall_as_dicts(cur)

    columns: list[dict[str, Any]] = []
    for row in rows:
        type_name = (row.get("type_name") or "").lower()
        sql_type_code = _sql_type_code_from_name(type_name)
        col_type = _guess_type(sql_type_code, None)
        columns.append(
            {
                "name": row["column_name"],
                "type": col_type,
                "raw_type": (row.get("type_name") or "NVARCHAR").upper(),
                "is_integer": _is_integer_sql_type(sql_type_code),
                "is_text_storage": _is_text_sql_type(sql_type_code),
            }
        )
    return columns


def _sql_type_code_from_name(type_name: str) -> int:
    """Map common SQL Server type names to DB-API type codes."""
    mapping = {
        "int": 4,
        "bigint": -5,
        "smallint": 5,
        "tinyint": -6,
        "bit": -7,
        "float": 6,
        "real": 7,
        "decimal": 3,
        "numeric": 2,
        "money": 16,
        "smallmoney": 16,
        "char": 1,
        "varchar": 12,
        "text": -1,
        "nchar": -8,
        "nvarchar": -9,
        "ntext": -10,
        "date": 91,
        "time": 92,
        "datetime": 93,
        "datetime2": 93,
        "smalldatetime": 93,
        "datetimeoffset": -155,
        "binary": -2,
        "varbinary": -3,
        "image": -4,
        "uniqueidentifier": -11,
        "xml": -152,
    }
    return mapping.get(type_name, 12)


def _fetchall_as_dicts(cur: Any) -> list[dict[str, Any]]:
    """Return all rows from a pyodbc cursor as dictionaries."""
    columns = [desc[0] for desc in (cur.description or [])]
    result: list[dict[str, Any]] = []
    for row in cur.fetchall():
        if isinstance(row, dict):
            result.append(row)
        else:
            result.append(dict(zip(columns, row)))
    return result


def fetch_data(
    view_name: str,
    filters: dict[str, Any] | None = None,
    sort_by: str | None = None,
    sort_desc: bool = False,
    sort: list[dict[str, Any]] | None = None,
    visible_columns: list[str] | None = None,
    group_by: list[str] | None = None,
    aggregations: dict[str, str] | None = None,
    limit: int = 500,
    number_format: str | None = None,
    date_time_format: str | None = None,
    dimension_columns: list[str] | None = None,
    drill_down_columns: list[str] | None = None,
    drill_down_sort_desc: bool = False,
    replace_null_with_empty: bool = True,
    color_numeric_sign: bool = False,
    row_limit: int = 0,
    connector=None,
) -> dict[str, Any]:
    """Query the source view with dynamic filtering, sorting and grouping."""
    from src.web.dialects import dialect_for_connector

    dialect = dialect_for_connector(connector)
    qi = dialect.quote_identifier
    ph = dialect.param_placeholder
    filters = filters or {}
    sanitized_view = qi(_sanitize_view_name(view_name))
    def_view = _def_view_for(view_name, connector)
    columns_info = _columns_for_view(view_name, connector, def_view)
    all_columns = [c["name"] for c in columns_info]

    def _aggregation_for(col_name: str) -> str | None:
        """Return aggregation function for a column, or None if it is a dimension."""
        agg = (aggregations or {}).get(col_name, "").strip().lower()
        if agg in {"sum", "count", "avg", "min", "max"}:
            return agg.upper()
        return None

    # Pivot mode is active whenever at least one visible column has an aggregation.
    # In pivot mode explicit dimensions, drill-down dimensions and measures are
    # selected and grouped. Visible non-aggregated columns that are not dimensions
    # become "attribute" columns: they are not part of grouping but are selected
    # using MIN/MAX so they can be displayed at the leaf level of the breakdown.
    # When no measure is configured, the table is a detail grid / detail-group grid
    # with all visible columns selected and no GROUP BY.
    dims = [c for c in (dimension_columns or []) if c in all_columns]
    drill = [c for c in (drill_down_columns or []) if c in all_columns]
    visible_cols = [c for c in (visible_columns or []) if c in all_columns]
    visible_agg_cols = [c for c in visible_cols if _aggregation_for(c)]
    in_pivot_mode = bool(visible_agg_cols)

    if in_pivot_mode:
        # Attribute columns: visible, not a dimension, not an explicit measure.
        attr_cols = [c for c in visible_cols if c not in dims and c not in drill and not _aggregation_for(c)]
        selected = list(dict.fromkeys(dims + drill + visible_agg_cols + attr_cols))
        group_cols = list(dict.fromkeys([c for c in (group_by or []) if c in all_columns] + dims + drill))
    else:
        # Detail / detail-group mode: all visible columns, no GROUP BY.
        selected = visible_cols if visible_cols else all_columns
        selected = [c for c in selected if c in all_columns]
        group_cols = []
    if not selected:
        selected = all_columns

    def _aggregation_sql(col_name: str, agg: str, col_type: str = "number") -> str:
        """Build a SQL aggregate expression appropriate for the column type."""
        quoted = qi(col_name)
        if agg == "COUNT":
            return f"COUNT({quoted}) AS {quoted}"
        if col_type == "date":
            return f"{agg}({quoted}) AS {quoted}"
        # TRY_CAST lets numeric aggregates work even when the stored type is text.
        casted = dialect.try_cast_to_float(quoted)
        return f"{agg}({casted}) AS {quoted}"

    # Dimensions used for ordering in both modes.
    dimCols = list(dict.fromkeys(dims + drill))
    drill = [c for c in drill if c in selected]
    has_drill_down = bool(drill)

    agg_cols = []
    for col in selected:
        agg = _aggregation_for(col)
        if agg:
            col_info = next((c for c in columns_info if c["name"] == col), None)
            col_type = col_info["type"] if col_info else "number"
            agg_cols.append(_aggregation_sql(col, agg, col_type))
        elif in_pivot_mode and col not in dims and col not in drill:
            # Attribute column: use MIN so it is selected without adding it to GROUP BY.
            # For date/text columns this preserves a representative value.
            agg_cols.append(f"MIN({qi(col)}) AS {qi(col)}")
        else:
            agg_cols.append(qi(col))
    select_sql = ", ".join(agg_cols)

    source_sql = f"({def_view}) AS sq" if def_view else sanitized_view
    sql = f"SELECT {select_sql} FROM {source_sql}"
    params: list[Any] = []
    where_clauses: list[str] = []
    text_conditions: list[tuple[str, str, Any]] = []

    for col, raw in filters.items():
        if col not in all_columns or raw is None or raw == "":
            continue
        col_info = next((c for c in columns_info if c["name"] == col), None)
        col_type = col_info["type"] if col_info else "text"
        is_text_storage = col_info.get("is_text_storage") if col_info else False

        # Normalize to a list of condition dicts.
        conditions: list[dict[str, Any]]
        if isinstance(raw, list):
            conditions = raw
        else:
            conditions = [{"operator": "=", "value": raw}]

        for cond in conditions:
            operator = (cond.get("operator") or "").strip().lower() or "="
            value = cond.get("value")

            if col_type == "number":
                min_value = cond.get("min_value", cond.get("min"))
                max_value = cond.get("max_value", cond.get("max"))
                if min_value not in (None, ""):
                    where_clauses.append(f"{qi(col)} >= {ph}")
                    params.append(
                        str(min_value).strip()
                        if is_text_storage
                        else _coerce_number(min_value)
                    )
                if max_value not in (None, ""):
                    where_clauses.append(f"{qi(col)} <= {ph}")
                    params.append(
                        str(max_value).strip()
                        if is_text_storage
                        else _coerce_number(max_value)
                    )
            elif col_type == "date":
                from_value = cond.get("from_value", cond.get("from"))
                to_value = cond.get("to_value", cond.get("to"))
                if from_value not in (None, ""):
                    where_clauses.append(f"{qi(col)} >= {ph}")
                    params.append(from_value)
                if to_value not in (None, ""):
                    where_clauses.append(f"{qi(col)} <= {ph}")
                    params.append(to_value)
            else:
                if value is None or value == "":
                    continue
                str_value = str(value)
                like_wildcards = "%" in str_value or "_" in str_value
                if operator in {"contains", "not_contains"}:
                    op_sql = "LIKE" if operator == "contains" else "NOT LIKE"
                    text_conditions.append(("not" if operator == "not_contains" else "or", f"{qi(col)} {op_sql} {ph}", f"%{str_value}%"))
                elif like_wildcards:
                    text_conditions.append(("or", f"{qi(col)} LIKE {ph}", str_value))
                else:
                    text_conditions.append(("or", f"{qi(col)} = {ph}", str_value))

    # Build WHERE clause. Text filters are grouped by column into two brackets:
    # - positive conditions (=, contains, like_wildcards) are joined with OR
    # - negative conditions (not_contains) are joined with AND
    # each group is parenthesized and the groups for a column are ANDed together.
    text_groups: dict[str, dict[str, list[tuple[str, Any]]]] = {}
    for mode, clause, param in text_conditions:
        col_name = clause.split(" ", 1)[0].strip('[]"`')
        text_groups.setdefault(col_name, {}).setdefault(mode, []).append((clause, param))

    final_clauses: list[str] = []
    text_params: list[Any] = []
    for col_name, groups in text_groups.items():
        col_sql_parts: list[str] = []
        for mode in ("or", "not"):
            conds = groups.get(mode, [])
            if not conds:
                continue
            clause_sql = " OR ".join(c[0] for c in conds) if mode == "or" else " AND ".join(c[0] for c in conds)
            text_params.extend(c[1] for c in conds)
            col_sql_parts.append(f"({clause_sql})")
        if col_sql_parts:
            final_clauses.append(" AND ".join(col_sql_parts))

    final_clauses.extend(where_clauses)
    if final_clauses:
        sql += " WHERE " + " AND ".join(final_clauses)
    params = text_params + params

    if group_cols:
        sql += " GROUP BY " + ", ".join(qi(c) for c in group_cols)

    # ORDER BY: explicit multi-column sort first, then remaining dimensions.
    order_parts: list[str] = []
    sort_rules = list(sort or [])
    if sort_by and sort_by in all_columns:
        sort_rules.insert(0, {"column": sort_by, "desc": sort_desc})
    seen: set[str] = set()
    for rule in sort_rules:
        col = rule.get("column")
        if not col or col not in all_columns or col in seen:
            continue
        seen.add(col)
        direction = "DESC" if rule.get("desc") else "ASC"
        order_parts.append(f"{qi(col)} {direction}")
    if dimCols:
        dd_direction = "DESC" if drill_down_sort_desc else "ASC"
        order_parts.extend(
            f"{qi(c)} {dd_direction}"
            for c in dimCols
            if c not in seen
        )
    if order_parts:
        sql += " ORDER BY " + ", ".join(order_parts)
    elif selected:
        # SQL Server requires ORDER BY for OFFSET/FETCH; other dialects ignore it.
        sql += f" ORDER BY {qi(selected[0])} ASC"

    if row_limit and row_limit > 0:
        if dialect.name == "mssql":
            sql += f" OFFSET 0 ROWS FETCH NEXT {ph} ROWS ONLY"
        else:
            sql += f" LIMIT {ph}"
        params.append(row_limit)

    try:
        with _conn_with_cursor(connector) as (_conn, cur):
            cur.execute(sql, tuple(params))
            rows = _fetchall_as_dicts(cur)
        if replace_null_with_empty:
            for r in rows:
                for k, v in r.items():
                    if v is None:
                        r[k] = ""
    except pyodbc.Error as exc:
        err_msg = str(exc)
        if "EXECUTE permission was denied" in err_msg:
            return {
                "columns": selected,
                "column_types": {
                    c["name"]: c["type"] for c in columns_info if c["name"] in selected
                },
                "rows": [],
                "group_by": group_cols,
                "aggregations": aggregations or {},
                "error": "View vyžaduje dodatečná oprávnění v databázi. Kontaktujte administrátora.",
            }
        raise

    return {
        "columns": selected,
        "column_types": {
            c["name"]: c["type"] for c in columns_info if c["name"] in selected
        },
        "rows": rows,
        "group_by": group_cols,
        "aggregations": aggregations or {},
        "number_format": number_format,
        "date_time_format": date_time_format,
        "dimension_columns": dims,
        "drill_down_columns": drill,
        "drill_down_rows": rows if has_drill_down else [],
        "replace_null_with_empty": replace_null_with_empty,
        "color_numeric_sign": color_numeric_sign,
        "row_limit": row_limit,
    }


def _sanitize_view_name(name: str) -> str:
    """Prevent SQL injection by only allowing identifier characters."""
    if not name or not all(ch.isalnum() or ch in "_." for ch in name):
        raise DatabaseError(f"Invalid view name: {name!r}")
    return name


def _quote_identifier(name: str) -> str:
    """Quote a SQL Server identifier."""
    return "[" + name.replace("]", "]]") + "]"


def _is_text_sql_type(sql_type_code: Any) -> bool:
    """Return True for SQL character types stored as text."""
    if sql_type_code is str:
        return True
    return sql_type_code in {1, -8, 12, -9, -1, -10}


def _is_integer_sql_type(sql_type_code: Any) -> bool:
    """Return True for integer SQL types."""
    if sql_type_code is int:
        return True
    return sql_type_code in {-6, -5, 4, 5}


def _guess_type(sql_type_code: Any, sample: Any) -> str:
    """Map pyodbc type info to simplified column families."""
    # Text-stored columns stay text even if the sample looks numeric.
    if _is_text_sql_type(sql_type_code):
        return "text"
    if sample is not None:
        if isinstance(sample, (int, float, decimal.Decimal)):
            return "number"
        if isinstance(sample, datetime.datetime):
            return "date"
        return "text"
    if sql_type_code in (int, float, decimal.Decimal):
        return "number"
    if sql_type_code in (datetime.datetime, datetime.date, datetime.time):
        return "date"
    number_codes = {
        -7,
        -6,
        -5,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        16,
    }
    date_codes = {91, 92, 93}
    if sql_type_code in number_codes:
        return "number"
    if sql_type_code in date_codes:
        return "date"
    return "text"


def _sql_type_name(sql_type_code: Any, sample: Any | None = None) -> str:
    """Return the raw SQL Server type name for display purposes.

    The name is kept in English (INT, NUMERIC, NVARCHAR, DATETIME, ...) so
    column metadata in the UI always matches the database schema.
    """
    if _is_text_sql_type(sql_type_code):
        # NVARCHAR takes precedence when the sample is a str; otherwise use VARCHAR.
        if sample is not None and isinstance(sample, str) and any(ord(ch) > 127 for ch in sample):
            return "NVARCHAR"
        return "NVARCHAR" if sql_type_code in {-8, -9, -10} else "VARCHAR"
    if sql_type_code in (int, float, decimal.Decimal):
        return "NUMERIC" if sql_type_code is decimal.Decimal else "FLOAT"
    if sql_type_code in (datetime.datetime, datetime.date, datetime.time):
        return "DATETIME"
    integer_codes = {
        -7: "BIT",
        -6: "TINYINT",
        -5: "BIGINT",
        4: "INT",
        5: "SMALLINT",
    }
    if sql_type_code in integer_codes:
        return integer_codes[sql_type_code]
    number_codes = {
        2: "NUMERIC",
        3: "DECIMAL",
        6: "FLOAT",
        7: "REAL",
        8: "FLOAT",
        16: "MONEY",
    }
    if sql_type_code in number_codes:
        return number_codes[sql_type_code]
    date_codes = {
        91: "DATE",
        92: "TIME",
        93: "DATETIME",
    }
    if sql_type_code in date_codes:
        return date_codes[sql_type_code]
    if sample is not None:
        if isinstance(sample, (int, float, decimal.Decimal)):
            return "NUMERIC"
        if isinstance(sample, datetime.datetime):
            return "DATETIME"
        return "NVARCHAR"
    return "NVARCHAR"


def _coerce_number(value: Any) -> int | float:
    """Convert a user value to a numeric type."""
    str_value = str(value).strip()
    try:
        as_float = float(str_value)
        return int(as_float) if as_float.is_integer() else as_float
    except (ValueError, TypeError) as exc:
        raise DatabaseError(f"Invalid numeric filter value: {value!r}") from exc
