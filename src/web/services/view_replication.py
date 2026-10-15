"""Replicate saved views from one connector's database to other connectors.

A replica is an independent copy of the view stored in the target database's
``TabObecnyPrehled`` and owned by the target connector. Its note keeps a
``replicated_from`` reference (source connector id, view id and name), so
running the replication again updates the existing copy instead of creating a
duplicate.

The view is not copied as raw SQL: the modeling payload is rebuilt against the
target database, so missing tables or columns are reported before anything is
written, and the resulting SQL is probed in the target database as well.
"""

from __future__ import annotations

import copy
import datetime as dt
import logging
from typing import Any

from src.web.db import DatabaseError
from src.web.models.user import Connector, User, UserRole
from src.web.services.user_storage import UserStorage
from src.web.services.view_modeling import (
    ViewModelingError,
    ViewModelingService,
    _conn_with_cursor,
)

logger = logging.getLogger(__name__)

# Payload keys taken from the parsed source view. Everything else returned by
# ``parse_saved_view`` (id, raw SQL, connector id, ...) belongs to the source.
_PAYLOAD_KEYS = (
    "name",
    "description",
    "primary_table",
    "selected_columns",
    "joins",
    "where_clauses",
    "custom_columns",
    "subviews",
    "table_aliases",
    "group_by",
    "order_by",
    "aggregations",
    "api_enabled",
    "api_put_enabled",
    "api_type",
)


class ReplicationError(Exception):
    """Raised when the source view cannot be replicated at all."""


def _db_identity(connector: Connector) -> tuple[str, str, int, str]:
    """Return a key identifying the physical database a connector points to."""
    return (
        (connector.db_type or "mssql").strip().lower(),
        (connector.db_host or "").strip().lower(),
        int(connector.db_port or 0),
        (connector.db_name or "").strip().lower(),
    )


def replication_targets(user: User, source: Connector) -> list[Connector]:
    """Return connectors the user may replicate views to.

    Admins may replicate to any connector of any user; other users only to
    their own connectors. The source connector itself is never a target.
    """
    storage = UserStorage()
    if user.role == UserRole.ADMIN:
        connectors = storage.list_connectors()
    else:
        connectors = storage.list_connectors_for_user(user.id)
    return [c for c in connectors if c.id != source.id]


def _source_payload(
    service: ViewModelingService, view_id: int
) -> tuple[dict[str, Any], dict[str, str]]:
    """Load the source view as a modeling payload.

    Returns the payload and a map ``subview view_id -> view name`` used to
    point subviews at the matching view in the target database.
    """
    row = service.get_saved_view(view_id)
    if not row or not service._note_owned_by_connector(row.get("Poznamka")):
        raise ReplicationError("Zdrojové view nebylo nalezeno.")
    parsed = service.parse_saved_view(view_id)
    if not parsed:
        raise ReplicationError("Zdrojové view nebylo nalezeno.")
    payload = {key: copy.deepcopy(parsed.get(key)) for key in _PAYLOAD_KEYS}
    if not payload.get("name"):
        raise ReplicationError("Zdrojové view nemá název.")

    subview_names: dict[str, str] = {}
    for sv in payload.get("subviews") or []:
        sv_id = sv.get("view_id")
        if not sv_id:
            continue
        try:
            sv_row = service.get_saved_view(int(sv_id))
        except (DatabaseError, ValueError, TypeError):
            sv_row = None
        if sv_row and sv_row.get("NazevSys"):
            subview_names[str(sv_id)] = sv_row["NazevSys"]
    return payload, subview_names


def _probe_sql(service: ViewModelingService, sql: str) -> None:
    """Execute the view SQL in the target database without reading data."""
    from src.web.dialects import dialect_for_connector

    dialect = dialect_for_connector(service.connector)
    probe = dialect.limit_first_row_sql(f"({sql}) AS sq")
    with _conn_with_cursor(service.connector) as (_conn, cur):
        try:
            cur.execute(probe)
            cur.fetchone()
        except Exception as exc:
            raise DatabaseError(f"View v cílové databázi nejde spustit: {exc}") from exc


def _replicate_to(
    source: Connector,
    view_id: int,
    payload: dict[str, Any],
    subview_names: dict[str, str],
    target: Connector,
    overwrite: bool,
) -> dict[str, Any]:
    """Create or update the replica in one target connector's database."""
    result: dict[str, Any] = {
        "connector_id": target.id,
        "connector_name": target.name,
        "status": "error",
        "message": "",
    }
    if _db_identity(target) == _db_identity(source):
        result["status"] = "skipped"
        result["message"] = (
            "Cílový konektor používá stejnou databázi jako zdroj, kopie by "
            "přepsala původní view."
        )
        return result

    service = ViewModelingService(connector=target)
    try:
        if not service._tab_obecny_prehled_exists():
            result["status"] = "skipped"
            result["message"] = "V cílové databázi neexistuje tabulka TabObecnyPrehled."
            return result

        name = service._helios_view_name(payload["name"])
        result["name"] = name
        existing_id = service._existing_view_id(name)
        if existing_id is not None:
            existing = service.get_saved_view(existing_id) or {}
            note = service._decode_view_note(existing.get("Poznamka") or "")
            origin = note.get("replicated_from") or {}
            same_origin = (
                origin.get("connector_id") == source.id
                and origin.get("view_id") == view_id
            )
            owner_id = note.get("connector_id")
            if owner_id is not None and owner_id != target.id:
                result["status"] = "conflict"
                result["message"] = (
                    "V cílové databázi už existuje view se stejným názvem, které "
                    "patří jinému konektoru."
                )
                return result
            if not same_origin and not overwrite:
                result["status"] = "conflict"
                result["message"] = (
                    "V cílové databázi už existuje view se stejným názvem, které "
                    "není kopií tohoto view. Zaškrtněte přepsání, pokud ho chcete nahradit."
                )
                return result

        target_payload = copy.deepcopy(payload)
        target_payload["connector_id"] = target.id
        target_payload["replicated_from"] = {
            "connector_id": source.id,
            "view_id": view_id,
            "name": service._helios_view_name(payload["name"]),
            "at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        }
        for sv in target_payload.get("subviews") or []:
            source_name = subview_names.get(str(sv.get("view_id")))
            sv["view_id"] = service._existing_view_id(source_name) if source_name else None

        # Building the SQL against the target validates tables and columns;
        # the probe catches anything else (subviews, custom expressions).
        sql = service.build_sql(target_payload)
        _probe_sql(service, sql)

        if existing_id is not None:
            service.update_view(existing_id, target_payload)
            result["status"] = "updated"
            result["message"] = "Kopie byla aktualizována."
        else:
            saved = service.save_view(target_payload)
            if not saved.get("saved"):
                result["message"] = saved.get("reason") or "View se nepodařilo uložit."
                return result
            result["status"] = "created"
            result["message"] = "Kopie byla vytvořena."
    except (ViewModelingError, DatabaseError) as exc:
        result["message"] = str(exc)
    except Exception as exc:  # connection failures, driver errors
        logger.exception("Replication of view %s to connector %s failed", view_id, target.id)
        result["message"] = f"Replikace selhala: {exc}"
    return result


def replicate_view(
    source: Connector,
    view_id: int,
    targets: list[Connector],
    *,
    overwrite: bool = False,
) -> list[dict[str, Any]]:
    """Replicate one saved view to each target connector.

    Every target is processed independently; a failure in one database does
    not stop the others. Returns one result per target with ``status`` set to
    ``created``, ``updated``, ``conflict``, ``skipped`` or ``error``.
    """
    source_service = ViewModelingService(connector=source)
    payload, subview_names = _source_payload(source_service, view_id)
    return [
        _replicate_to(source, view_id, payload, subview_names, target, overwrite)
        for target in targets
    ]
