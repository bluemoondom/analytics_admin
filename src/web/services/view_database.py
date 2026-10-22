"""Mirror saved views into Helios ``dbo.TabObecnyPrehled``.

The application catalog (view_catalog) is the source of truth for saved views
on every database engine; dashboards read the saved SQL from there and nothing
is created in the connector's database.

The only exception is a Helios database (``dbo.TabObecnyPrehled`` exists and is
readable): there every saved view is also written as a row of
TabObecnyPrehled, so the view can be browsed in Helios as well:

* ``NazevSys`` - the system name ``hvw_<name>``;
* ``Nazev`` - the view description, or the system name when there is none;
* ``DefView`` - the definition without ORDER BY;
* ``DefAttrs`` - the column definition in the Helios format;
* ``Autor``, ``DatPorizeni``, ``Cislo`` (next free number below 10000) and the
  other Helios defaults, as earlier versions wrote them.

The row is updated in place when the view changes (also after a rename) and
deleted with the view. A row that does not belong to the view (another
connector's or Helios' own) is never changed; saving under its name is refused.
Failures (typically missing INSERT/UPDATE rights) do not lose the saved view:
it stays in the catalog and the caller gets a warning to show to the user.
"""

from __future__ import annotations

import datetime
import json
import logging
import uuid
from typing import Any

logger = logging.getLogger(__name__)

HELIOS_TABLE = "dbo.TabObecnyPrehled"


class ViewNameConflict(Exception):
    """The target name belongs to a TabObecnyPrehled row the view does not own."""


def _short(exc: Exception) -> str:
    text = str(exc).strip().replace("\r", " ").replace("\n", " ")
    return text[:400]


class DatabaseViewPublisher:
    """Insert, update and delete the TabObecnyPrehled row of a saved view."""

    def __init__(self, service):
        from src.web.dialects import dialect_for_connector

        self.service = service
        self.connector = service.connector
        self.dialect = dialect_for_connector(self.connector)
        self._columns: dict[str, int | None] | None = None

    # ------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------
    @property
    def engine(self) -> str:
        return getattr(self.dialect, "name", "") or ""

    def _connect(self):
        from src.web.services.view_modeling import _conn_with_cursor

        return _conn_with_cursor(self.connector)

    def _ph(self) -> str:
        return getattr(self.dialect, "param_placeholder", "?") or "?"

    @staticmethod
    def _rollback(conn) -> None:
        try:
            conn.rollback()
        except Exception:  # pragma: no cover - driver specific
            pass

    def _limit0(self, column: str) -> str:
        if self.engine == "mssql":
            return f"SELECT TOP 0 {column} FROM {HELIOS_TABLE}"
        return f"SELECT {column} FROM {HELIOS_TABLE} LIMIT 0"

    # ------------------------------------------------------------------
    # table metadata
    # ------------------------------------------------------------------
    def helios_columns(self) -> dict[str, int | None]:
        """Columns of dbo.TabObecnyPrehled with their maximum text length.

        Empty when the table is absent or unreadable (any non-Helios database).
        The length is None when unknown or unlimited.
        """
        if self._columns is not None:
            return self._columns
        self._columns = {}
        if not self.dialect.list_tables_via_tabobecny_prehled():
            return self._columns
        base = (
            "FROM sys.columns c JOIN sys.objects o ON c.object_id = o.object_id "
            "WHERE o.name = 'TabObecnyPrehled' ORDER BY c.column_id"
        )
        columns: dict[str, int | None] = {}
        try:
            with self._connect() as (conn, cur):
                try:
                    cur.execute(
                        "SELECT c.name, c.max_length, t.name "
                        "FROM sys.columns c JOIN sys.objects o ON c.object_id = o.object_id "
                        "JOIN sys.types t ON c.user_type_id = t.user_type_id "
                        "WHERE o.name = 'TabObecnyPrehled' ORDER BY c.column_id"
                    )
                    for name, max_length, type_name in cur.fetchall():
                        length = None
                        if max_length is not None and int(max_length) > 0:
                            length = int(max_length)
                            if str(type_name).lower() in {"nvarchar", "nchar"}:
                                length //= 2
                        columns[name] = length
                except Exception:
                    self._rollback(conn)
                    cur.execute(f"SELECT c.name {base}")
                    columns = {r[0]: None for r in cur.fetchall()}
                if columns:
                    # The table may exist without SELECT permission.
                    cur.execute(self._limit0("NazevSys"))
                    cur.fetchall()
                self._rollback(conn)
            self._columns = columns
        except Exception:
            logger.info("TabObecnyPrehled is not available", exc_info=True)
            self._columns = {}
        return self._columns

    # ------------------------------------------------------------------
    # rows
    # ------------------------------------------------------------------
    def _select(self, where: str, params: tuple[Any, ...]) -> dict[str, Any] | None:
        columns = self.helios_columns()
        wanted = [c for c in ("ID", "NazevSys", "Poznamka", "Autor") if c in columns]
        if "ID" not in wanted or "NazevSys" not in wanted:
            return None
        sql = f"SELECT {', '.join(wanted)} FROM {HELIOS_TABLE} WHERE {where}"
        try:
            with self._connect() as (conn, cur):
                cur.execute(sql, params)
                row = cur.fetchone()
                self._rollback(conn)
        except Exception:
            logger.info("Cannot read TabObecnyPrehled", exc_info=True)
            return None
        if row is None:
            return None
        return dict(row) if isinstance(row, dict) else dict(zip(wanted, row))

    def _row_by_name(self, name: str) -> dict[str, Any] | None:
        return self._select(f"NazevSys = {self._ph()}", (name,))

    def _row_by_id(self, row_id: int) -> dict[str, Any] | None:
        return self._select(f"ID = {self._ph()}", (int(row_id),))

    def _owned(self, row: dict[str, Any], record: dict[str, Any] | None) -> bool:
        if record and record.get("legacy_id") is not None and int(record["legacy_id"]) == int(row["ID"]):
            return True
        try:
            note = json.loads(row.get("Poznamka") or "{}")
        except (TypeError, ValueError):
            note = {}
        connector_id = getattr(self.connector, "id", None)
        return (
            isinstance(note, dict)
            and note.get("connector_id") is not None
            and note.get("connector_id") == connector_id
        )

    def find_row(self, record: dict[str, Any] | None, names: list[str]) -> dict[str, Any] | None:
        """The TabObecnyPrehled row of a catalog record, if any."""
        if record and record.get("legacy_id") is not None:
            row = self._row_by_id(int(record["legacy_id"]))
            if row is not None:
                return row
        for name in names:
            if not name:
                continue
            row = self._row_by_name(name)
            if row is not None and self._owned(row, record):
                return row
        return None

    def check_name(self, name: str, record: dict[str, Any] | None) -> None:
        """Refuse a name used by a TabObecnyPrehled row of someone else.

        ``record`` is the catalog record being updated (None for a new view).
        """
        if not self.helios_columns():
            return
        row = self._row_by_name(name)
        if row is not None and not self._owned(row, record):
            raise ViewNameConflict(
                f"V TabObecnyPrehled už existuje přehled {name}, který nepatří tomuto view. "
                "Zvolte jiný název."
            )

    def _fit(self, column: str, value: str) -> str:
        length = self.helios_columns().get(column)
        return value[:length] if length else value

    def _display_name(self, name: str, payload: dict[str, Any]) -> str:
        description = " ".join((payload.get("description") or "").split())
        return self._fit("Nazev", description or name)

    def _def_attrs_value(self, payload: dict[str, Any]) -> tuple[str, Any]:
        """SQL fragment and parameter (or None) for the DefAttrs column."""
        if self.engine == "mssql":
            # The proven Helios form: an inline T-SQL expression.
            return self.service._def_attrs_sql_expression(payload), None
        return self._ph(), self.service._build_def_attrs(payload)

    def _execute(self, statement: str, params: tuple[Any, ...]) -> None:
        with self._connect() as (conn, cur):
            try:
                cur.execute(statement, params)
                conn.commit()
            except Exception:
                self._rollback(conn)
                raise

    def write_row(
        self,
        name: str,
        note: str,
        payload: dict[str, Any],
        row: dict[str, Any] | None,
    ) -> int | None:
        """Insert or update the TabObecnyPrehled row; return its ID."""
        columns = self.helios_columns()
        if not columns:
            return None
        ph = self._ph()
        qi = self.dialect.quote_identifier
        # Helios views must not contain ORDER BY.
        definition = self.service.build_sql(payload, include_order_by=False)
        common: dict[str, Any] = {
            "NazevSys": name,
            "Nazev": self._display_name(name, payload),
            "DefView": definition,
            "Poznamka": note,
        }
        if row is not None:
            fields = {k: v for k, v in common.items() if k in columns}
            parts = [f"{qi(col)} = {ph}" for col in fields]
            params = list(fields.values())
            if "DefAttrs" in columns:
                fragment, value = self._def_attrs_value(payload)
                parts.append(f"{qi('DefAttrs')} = {fragment}")
                if value is not None:
                    params.append(value)
            params.append(int(row["ID"]))
            self._execute(f"UPDATE {HELIOS_TABLE} SET {', '.join(parts)} WHERE ID = {ph}", tuple(params))
            return int(row["ID"])

        author = (getattr(self.connector, "db_user", "") or "") if self.connector else ""
        values: dict[str, Any] = {
            **common,
            "JeToDBView": True,
            "Systemovy": False,
            "Skupina": "Uživatelské",
            "Cislo": self._next_cislo() if "Cislo" in columns else 0,
            "Autor": author,
            "DatPorizeni": datetime.datetime.now().replace(microsecond=0),
            "BlobTableName": "",
            "Maximalizovat": False,
            "KOdeslani": False,
        }
        fields = {k: v for k, v in values.items() if k in columns}
        if "GUID" in columns:
            fields["GUID"] = uuid.uuid4().bytes
        names_sql = [qi(c) for c in fields]
        values_sql = [ph for _ in fields]
        params = list(fields.values())
        if "DefAttrs" in columns:
            fragment, value = self._def_attrs_value(payload)
            names_sql.append(qi("DefAttrs"))
            values_sql.append(fragment)
            if value is not None:
                params.append(value)
        self._execute(
            f"INSERT INTO {HELIOS_TABLE} ({', '.join(names_sql)}) VALUES ({', '.join(values_sql)})",
            tuple(params),
        )
        created = self._row_by_name(name)
        return int(created["ID"]) if created else None

    def _next_cislo(self) -> int:
        """Next Cislo for user views, kept below the Helios reserved range (10000)."""
        try:
            with self._connect() as (conn, cur):
                cur.execute(f"SELECT MAX(Cislo) FROM {HELIOS_TABLE} WHERE Cislo < 10000")
                row = cur.fetchone()
                self._rollback(conn)
            value = (row[0] or 0) + 1 if row else 1
            return min(int(value), 9999)
        except Exception:
            return 1

    # ------------------------------------------------------------------
    # used by ViewModelingService
    # ------------------------------------------------------------------
    def publish(
        self,
        record_before: dict[str, Any] | None,
        name: str,
        note: str,
        payload: dict[str, Any],
    ) -> tuple[list[str], int | None]:
        """Write the TabObecnyPrehled row; return (warnings, row ID)."""
        if not self.helios_columns():
            return [], None
        old_name = (record_before or {}).get("name") or ""
        row = self.find_row(record_before, [old_name, name])
        try:
            return [], self.write_row(name, note, payload, row)
        except Exception as exc:
            logger.warning("TabObecnyPrehled write for %s failed: %s", name, exc)
            return [f"View {name} se nepodařilo uložit do TabObecnyPrehled: {_short(exc)}"], None

    def unpublish(self, record: dict[str, Any]) -> list[str]:
        """Delete the TabObecnyPrehled row of a deleted saved view."""
        if not self.helios_columns():
            return []
        name = record.get("name") or ""
        row = self.find_row(record, [name])
        if row is None:
            return []
        try:
            self._execute(f"DELETE FROM {HELIOS_TABLE} WHERE ID = {self._ph()}", (int(row["ID"]),))
        except Exception as exc:
            return [f"Řádek view {name} se nepodařilo smazat z TabObecnyPrehled: {_short(exc)}"]
        return []
