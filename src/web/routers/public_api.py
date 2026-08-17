"""Public API for exported views."""

from __future__ import annotations

import contextlib
import datetime as dt
import decimal
import hmac
import json
import logging
import os
from typing import Any

import pyodbc
from fastapi import APIRouter, HTTPException, Request, Response

from src.web.config import get_settings
from src.web.db import DatabaseError, _sanitize_view_name, connector_connection
from src.web.dialects import dialect_for_connector
from src.web.services.user_storage import UserStorage
from src.web.services.view_modeling import ViewModelingService


@contextlib.contextmanager
def _conn_with_cursor(connector=None):
    """Yield ``(conn, cursor)`` handling driver-specific cursor cleanup.

    Resolves ``connector_connection`` at call time so tests patching this
    module's attribute keep working regardless of the connector's dialect.
    """
    from src.web.dialects import dialect_for_connector

    dialect = dialect_for_connector(connector)
    with connector_connection(connector) as conn, dialect.cursor(conn) as cur:
        yield conn, cur

router = APIRouter(tags=["public-api"])


def _setup_logger() -> logging.Logger:
    """Return configured access logger for API requests."""
    settings = get_settings()
    os.makedirs(os.path.dirname(settings.API_LOG_PATH), exist_ok=True)
    logger = logging.getLogger("public_api")
    if not logger.handlers:
        handler = logging.FileHandler(settings.API_LOG_PATH, encoding="utf-8")
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s %(message)s")
        )
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
    return logger


api_logger = _setup_logger()


def _json_default(value: Any) -> Any:
    """Serialize non-JSON types."""
    if isinstance(value, (dt.datetime, dt.date)):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return float(value)
    if isinstance(value, (bytes, bytearray)):
        return value.decode("utf-8", errors="replace")
    return str(value)


def _get_client_ip(request: Request) -> str:
    """Return the most reliable client IP from request headers."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = request.headers.get("X-Real-Ip")
    if real_ip:
        return real_ip.strip()
    if request.client:
        return request.client.host
    return "unknown"


def _resolve_view_connector(
    tenant: str, view_name: str, request: Request
) -> tuple[Any, dict[str, Any], dict[str, Any]]:
    """Authenticate by key+tenant, then use that connector's owned API view.

    The public URL is ``/{tenant}/{view_name}``. We first find a connector whose
    ``api_tenant`` (exact, case-insensitive) equals the URL tenant **and** whose
    API key matches the request header. IP allowlisting and rate limiting are
    then evaluated for that connector. Only after passing those checks do we
    look up the view by name in the connector's source database and verify that
    the view is API-enabled. No values from ``.env``/config are used for
    authentication or tenant resolution.

    Raises:
        HTTPException: 401 for a bad/missing key, 403 for a disallowed IP,
            404 when the view is missing or not API-enabled, 429 when rate
            limited.
    """
    client_ip = _get_client_ip(request)
    tenant = tenant.strip()

    all_connectors = UserStorage().list_connectors()
    candidates = [
        c
        for c in all_connectors
        if (c.api_tenant or "").strip().lower() == tenant.lower()
        and c.api_key
    ]

    matched_key = False
    ip_allowed = False
    rate_limited = False

    for connector in candidates:
        if not _check_api_key(request, connector):
            continue
        matched_key = True

        if not _ip_allowed(client_ip, connector):
            continue
        ip_allowed = True

        if not _rate_limit_ok(client_ip, connector):
            rate_limited = True
            continue

        try:
            service = ViewModelingService(connector=connector)
            view = service.get_saved_view_by_name(view_name)
        except DatabaseError:
            api_logger.exception(
                "Database error loading view=%s for connector_id=%s",
                view_name,
                connector.id,
            )
            continue

        if not view:
            continue

        note = service._decode_view_note(view.get("Poznamka") or "")
        if not note.get("api_enabled"):
            api_logger.warning(
                "View %s exists but API is not enabled (connector_id=%s)",
                view_name,
                connector.id,
            )
            continue

        note_connector_id = note.get("connector_id")
        if note_connector_id is not None and note_connector_id != connector.id:
            api_logger.warning(
                "View %s belongs to connector_id=%s, skipping connector_id=%s",
                view_name,
                note_connector_id,
                connector.id,
            )
            continue

        provided_key = _get_provided_key(request, connector)
        key_prefix = provided_key[:4] if len(provided_key) >= 4 else ""
        api_logger.info(
            "selected connector_id=%s tenant=%s for view=%s key_prefix=%s",
            connector.id,
            tenant or "(none)",
            view_name,
            key_prefix,
        )
        return connector, view, note

    if not matched_key:
        api_logger.warning(
            "Invalid or unknown API key from %s for tenant=%s", client_ip, tenant
        )
        raise HTTPException(status_code=401, detail="Unauthorized")
    if not ip_allowed:
        api_logger.warning("IP not allowed: %s", client_ip)
        raise HTTPException(status_code=403, detail="IP not allowed")
    if rate_limited:
        api_logger.warning("Rate limit exceeded for %s", client_ip)
        raise HTTPException(status_code=429, detail="Rate limit exceeded")

    api_logger.warning(
        "No API-enabled view %s found for tenant=%s", view_name, tenant
    )
    raise HTTPException(status_code=404, detail="View not found")


def _get_provided_key(request: Request, connector) -> str:
    """Read the API key from the header configured for the connector."""
    settings = get_settings()
    header = connector.api_key_header or settings.API_KEY_HEADER or "X-API-Key"
    return request.headers.get(header, "")


def _check_api_key(request: Request, connector) -> bool:
    """Constant-time API key comparison against the connector key."""
    provided = _get_provided_key(request, connector)
    if not provided or not connector.api_key:
        return False
    return hmac.compare_digest(provided, connector.api_key)


def _ip_allowed(request_ip: str, connector=None) -> bool:
    """Return True if the client IP is in the allowlist.

    An empty allowlist blocks all access by design.
    """
    allowed_ips = (
        connector.api_allowed_ips
        if connector is not None and connector.api_allowed_ips
        else get_settings().API_ALLOWED_IPS
    )
    if not allowed_ips:
        return False
    return request_ip in allowed_ips


def _rate_limit_ok(client_ip: str, connector=None) -> bool:
    """Basic in-memory rate limiter."""
    limit = (
        connector.api_max_requests_per_minute
        if connector is not None
        else get_settings().API_MAX_REQUESTS_PER_MINUTE
    )
    if limit <= 0:
        return True
    now = dt.datetime.now(dt.timezone.utc)
    window = now.replace(second=0, microsecond=0)
    key = (client_ip, window)
    _request_counts[key] = _request_counts.get(key, 0) + 1
    # Clean old windows lazily.
    cutoff = window - dt.timedelta(minutes=1)
    for old_key in list(_request_counts):
        if old_key[1] < cutoff:
            del _request_counts[old_key]
    return _request_counts[key] <= limit


_request_counts: dict[tuple[str, dt.datetime], int] = {}


@router.get("/health", response_model=dict[str, str])
def health():
    """Health check endpoint without authentication."""
    return {"status": "ok"}


@router.get("/{tenant}/{view_name}")
@router.post("/{tenant}/{view_name}")
async def public_view(tenant: str, view_name: str, request: Request):
    """Return JSON data for an exported view under its owning tenant.

    Accepts both GET and POST. If the request body contains a JSON object with
    column names as keys and filter values, the response is filtered by those
    columns. Without a body the full view result is returned.
    """
    client_ip = _get_client_ip(request)
    api_logger.info(
        "request tenant=%s view=%s method=%s ip=%s user_agent=%s",
        tenant,
        view_name,
        request.method,
        client_ip,
        request.headers.get("user-agent", ""),
    )

    connector, view, note = _resolve_view_connector(tenant, view_name, request)

    definition = view.get("DefView") or ""
    if not definition.strip():
        raise HTTPException(status_code=500, detail="View has no SQL definition")

    filters = await _read_request_filters(request)

    try:
        with _conn_with_cursor(connector) as (_conn, cur):
            if filters:
                filtered_sql, params = _build_filtered_sql(
                    definition, filters, connector
                )
                cur.execute(filtered_sql, tuple(params))
            else:
                cur.execute(definition)
            columns = [desc[0] for desc in (cur.description or [])]
            rows_raw = cur.fetchall()
            rows = []
            for row_raw in rows_raw:
                if isinstance(row_raw, dict):
                    rows.append(row_raw)
                else:
                    rows.append(dict(zip(columns, row_raw)))
    except DatabaseError as exc:
        api_logger.error("Database error executing view %s: %s", view_name, exc)
        raise HTTPException(status_code=500, detail="Database error") from exc
    except Exception as exc:
        api_logger.exception("Unexpected error executing view %s", view_name)
        raise HTTPException(status_code=500, detail="Internal server error") from exc

    api_type = note.get("api_type") or "flat"
    if api_type == "tree":
        data = _build_tree_response(rows, columns, note, definition)
    else:
        data = rows

    response = {"count": len(data), "data": data}
    return Response(
        content=json.dumps(response, ensure_ascii=False, default=_json_default),
        media_type="application/json; charset=utf-8",
    )


async def _read_request_filters(request: Request) -> dict[str, Any] | None:
    """Read a JSON filter object from the request body when present.

    Only ``Content-Type: application/json`` payloads are parsed.  An empty body,
    missing header or invalid JSON returns ``None`` so the caller returns the
    full result set.
    """
    content_type = request.headers.get("content-type", "")
    if "application/json" not in content_type:
        return None
    try:
        body = await request.body()
        if hasattr(body, "decode"):
            body = body.decode("utf-8", errors="replace")
        else:
            body = str(body)
    except (json.JSONDecodeError, ValueError, UnicodeDecodeError, RuntimeError):
        return None
    if not body or not body.strip():
        return None
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, dict):
        return None
    return {str(k).strip(): v for k, v in parsed.items() if str(k).strip()}


def _build_filtered_sql(
    definition: str, filters: dict[str, Any], connector
) -> tuple[str, list[Any]]:
    """Wrap the view definition and add safe WHERE conditions for the filters.

    Each filter key must be a plain identifier.  Values are passed as query
    parameters to avoid SQL injection.  Multiple filters are combined with AND.
    """
    dialect = dialect_for_connector(connector)
    qi = dialect.quote_identifier
    ph = dialect.param_placeholder

    where_parts: list[str] = []
    params: list[Any] = []
    for raw_column, value in filters.items():
        clean_column = _sanitize_view_name(raw_column)
        where_parts.append(f"{qi(clean_column)} = {ph}")
        params.append(value)

    wrapped = f"SELECT * FROM ({definition}) AS sq"
    if where_parts:
        wrapped += " WHERE " + " AND ".join(where_parts)
    return wrapped, params


@router.put("/{tenant}/{view_name}")
def public_insert_view(
    tenant: str, view_name: str, request: Request, body: dict[str, Any] | None = None
):
    """Insert rows into the primary table of a simple, API-enabled view.

    Only views without joins, subviews, aggregations, group by or custom columns
    are accepted. The table used in the FROM clause is treated as the insert
    target.
    """
    client_ip = _get_client_ip(request)
    api_logger.info(
        "insert request tenant=%s view=%s ip=%s user_agent=%s",
        tenant,
        view_name,
        client_ip,
        request.headers.get("user-agent", ""),
    )

    connector, view, note = _resolve_view_connector(tenant, view_name, request)

    if not note.get("api_put_enabled"):
        api_logger.warning(
            "PUT not enabled for view %s (connector_id=%s)", view_name, connector.id
        )
        raise HTTPException(status_code=404, detail="View not found")

    definition = view.get("DefView") or ""
    if not definition.strip():
        raise HTTPException(status_code=500, detail="View has no SQL definition")

    simple, primary_table = _check_simple_insert_view(note, definition)
    if not simple:
        api_logger.warning("View %s is not eligible for insert: %s", view_name, primary_table)
        raise HTTPException(status_code=400, detail=primary_table)

    rows = (body or {}).get("rows")
    if not isinstance(rows, list) or not rows:
        raise HTTPException(status_code=400, detail="Payload must contain a non-empty 'rows' list")

    inserted = 0
    try:
        from src.web.db import quote_identifier_dialect

        with _conn_with_cursor(connector) as (conn, cur):
            for row in rows:
                if not isinstance(row, dict):
                    continue
                if not row:
                    continue
                columns = list(row.keys())
                values = list(row.values())
                col_sql = ", ".join(quote_identifier_dialect(c, connector) for c in columns)
                placeholders = ", ".join("?" for _ in columns)
                sql = f"INSERT INTO {quote_identifier_dialect(primary_table, connector)} ({col_sql}) VALUES ({placeholders})"
                cur.execute(sql, tuple(values))
                inserted += max(cur.rowcount, 1)
            conn.commit()
    except pyodbc.IntegrityError as exc:
        api_logger.warning("Integrity error inserting into %s: %s", primary_table, exc)
        raise HTTPException(status_code=400, detail=f"Integrity error: {exc}") from exc
    except pyodbc.Error as exc:
        api_logger.error("Database error inserting into %s: %s", primary_table, exc)
        raise HTTPException(status_code=400, detail=f"Insert failed: {exc}") from exc

    return {"inserted": inserted}


def _check_simple_insert_view(note: dict[str, Any], definition: str) -> tuple[bool, str]:
    """Return (True, primary_table) if the view is a single-table SELECT."""
    if note.get("joins") or note.get("subviews") or note.get("group_by") or note.get("custom_columns"):
        return False, "View contains joins, subviews, group by or custom columns"
    if note.get("aggregations"):
        return False, "View contains aggregations"

    parsed = ViewModelingService()._parse_select_sql(definition)
    if parsed.get("joins"):
        return False, "View contains joins"

    primary_table = (note.get("primary_table") or parsed.get("primary_table") or "").strip()
    if not primary_table:
        return False, "No primary table found"
    return True, primary_table


def _build_tree_response(
    rows: list[dict[str, Any]],
    columns: list[str],
    metadata: dict[str, Any],
    definition: str,
) -> list[dict[str, Any]]:
    """Group flat SQL rows into a tree keyed by the primary table columns.

    Stored metadata is authoritative for joins/subviews; the SQL parser is used
    only as a fallback when the JSON note does not contain the structure.
    """
    parsed = ViewModelingService()._parse_select_sql(definition)
    primary_table = (metadata.get("primary_table") or parsed.get("primary_table") or "").strip()
    selected_columns = metadata.get("selected_columns") or parsed.get("selected_columns") or []
    joins = metadata.get("joins") or parsed.get("joins") or []
    join_tables = [j.get("right_table") for j in joins if j.get("right_table")]

    subviews = metadata.get("subviews") or []
    subview_aliases = {
        (sv.get("alias") or sv.get("name") or "").strip()
        for sv in subviews
        if sv.get("alias") or sv.get("name")
    }

    # Map output column name -> source table (using alias when present).
    column_source: dict[str, str] = {}
    for sel in selected_columns:
        table = (sel.get("table") or primary_table).strip()
        name = (sel.get("name") or "").strip()
        alias = (sel.get("alias") or "").strip() or name
        if alias:
            column_source[alias] = table

    # Identify primary columns from the actual SELECT aliases if possible,
    # falling back to columns whose source table matches the primary table.
    primary_aliases = {
        (sel.get("alias") or sel.get("name"))
        for sel in selected_columns
        if sel.get("table") == primary_table and (sel.get("alias") or sel.get("name"))
    }
    primary_cols = [c for c in columns if c in primary_aliases] or [
        c for c in columns if column_source.get(c) == primary_table
    ]
    join_cols = {jt: [c for c in columns if column_source.get(c) == jt] for jt in join_tables}
    custom_cols = [c for c in columns if column_source.get(c) not in {primary_table, *join_tables}]

    grouped: dict[tuple[Any, ...], dict[str, Any]] = {}
    for row in rows:
        key = tuple(row.get(c) for c in primary_cols)
        group = grouped.get(key)
        if group is None:
            group = {
                "_primary": {c: row.get(c) for c in primary_cols},
                "_custom": {c: row.get(c) for c in custom_cols},
                "_joins": {jt: [] for jt in join_tables},
            }
            grouped[key] = group
        for jt in join_tables:
            join_obj = {c: row.get(c) for c in join_cols[jt]}
            if any(v is not None for v in join_obj.values()):
                group["_joins"][jt].append(join_obj)

    result = []
    for group in grouped.values():
        item = dict(group["_primary"])
        item.update(group["_custom"])
        for jt in join_tables:
            join_data = group["_joins"][jt]
            # Subviews that return a single row per primary record are more
            # useful as a nested object rather than a one-element list.
            if jt in subview_aliases and len(join_data) == 1:
                item[jt] = join_data[0]
            else:
                item[jt] = join_data
        result.append(item)
    return result
