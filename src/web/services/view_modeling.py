"""Service layer for view modeling (joins, columns, TabObecnyPrehled storage)."""

from __future__ import annotations

import contextlib
import re
from typing import Any

import pyodbc

from src.web.config import get_settings
from src.web.db import (
    DatabaseError,
    _fetchall_as_dicts,
    _sanitize_view_name,
    connector_connection,
)


@contextlib.contextmanager
def _conn_with_cursor(connector=None):
    """Yield ``(conn, cursor)`` handling driver-specific cursor cleanup.

    Resolves ``connector_connection`` at call time so tests patching this
    module's attribute keep working across dialects.
    """
    from src.web.dialects import dialect_for_connector

    dialect = dialect_for_connector(connector)
    with connector_connection(connector) as conn, dialect.cursor(conn) as cur:
        yield conn, cur


class ViewModelingError(Exception):
    """Raised when view modeling input is invalid."""


class ViewModelingService:
    """Backend logic for modeling custom views."""

    def __init__(self, connector=None):
        self._tab_columns: list[str] | None = None
        self.connector = connector

    def _qi(self, name: str) -> str:
        """Quote a SQL identifier using this connector's dialect."""
        from src.web.db import quote_identifier_dialect

        return quote_identifier_dialect(name, self.connector)

    def _strip_brackets(self, name: str) -> str:
        """Remove SQL Server identifier brackets from a dotted name."""
        name = name.strip()
        parts = name.split(".")
        return ".".join(p.strip().strip("[]") for p in parts)

    def _parse_source_alias(self, source: str) -> tuple[str, str]:
        """Parse a FROM/JOIN source into (name_used_in_query, base_object).

        Accepts forms:
            [TabZakazka]           -> ("TabZakazka", "TabZakazka")
            [TabZakazka] AS [NZak] -> ("NZak", "TabZakazka")
            TabZakazka NZak        -> ("NZak", "TabZakazka")
        The alias (when present) is what the SELECT/WHERE/JOIN clauses reference;
        the base is the real table/view name.
        """
        text = source.strip()
        # Try "[base] AS [alias]" first.
        m = re.match(
            r"^(?:\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_]*))\s+AS\s+(?:\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_]*))\s*$",
            text,
            re.IGNORECASE,
        )
        if m:
            base = m.group(1) or m.group(2) or ""
            alias = m.group(3) or m.group(4) or ""
            base = self._strip_brackets(base)
            alias = self._strip_brackets(alias)
            if alias:
                return alias, base
        # "base alias" (without AS), e.g. FROM TabZakazka NZak.
        parts = text.split()
        if len(parts) == 2 and re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", parts[0]) and re.match(
            r"^[A-Za-z_][A-Za-z0-9_]*$", parts[1]
        ):
            base = parts[0]
            alias = parts[1]
            if alias.upper() not in {
                "WHERE", "GROUP", "ORDER", "HAVING", "LEFT", "RIGHT", "INNER",
                "FULL", "JOIN", "OUTER", "CROSS", "ON",
            }:
                return alias, base
        name = parts[0] if parts else text
        if name.startswith("["):
            bm = re.match(r"^\[([^\]]+)\]", name)
            if bm:
                name = bm.group(1)
        return self._strip_brackets(name), self._strip_brackets(name)

    @staticmethod
    def _strip_outer_parentheses(text: str) -> str:
        """Remove balanced outer parentheses from a SQL expression.

        Handles cases like ``(a = b)`` or ``((a = b))`` while leaving
        ``(a = b) AND (c = d)`` intact.
        """
        text = text.strip()
        while len(text) >= 2 and text.startswith("(") and text.endswith(")"):
            depth = 0
            first_pair_matches_end = True
            for i, ch in enumerate(text):
                if ch == "(":
                    depth += 1
                elif ch == ")":
                    depth -= 1
                if depth == 0 and i < len(text) - 1:
                    first_pair_matches_end = False
                    break
            if not first_pair_matches_end:
                break
            text = text[1:-1].strip()
        return text

    def _ensure_identifier(self, name: str) -> str:
        """Sanitize a table/view/column name and quote it safely."""
        from src.web.db import quote_identifier_dialect

        sanitized = _sanitize_view_name(name)
        return quote_identifier_dialect(sanitized, self.connector)

    def list_tables(self) -> list[dict[str, Any]]:
        """Return user tables and views from the source database."""
        from src.web.dialects import dialect_for_connector

        dialect = dialect_for_connector(self.connector)
        sql = dialect.list_tables_sql()
        with _conn_with_cursor(self.connector) as (_conn, cur):
            try:
                cur.execute(sql)
                rows = _fetchall_as_dicts(cur)
            except Exception as exc:
                raise DatabaseError("Unable to read table/view list.") from exc

        seen: dict[str, dict[str, Any]] = {}
        for row in rows:
            name = row.get("system_name")
            if not name:
                continue
            seen[name] = {
                "system_name": name,
                "display_name": name,
                "kind": row.get("kind", "unknown"),
            }
        return sorted(seen.values(), key=lambda r: (r["kind"], r["display_name"].lower()))

    def get_columns(self, table_name: str) -> list[dict[str, Any]]:
        """Return columns for a table or view with index and type information."""
        from src.web.db import (
            dialect_for_connector,
            index_columns_for,
            quote_identifier_dialect,
        )

        dialect = dialect_for_connector(self.connector)
        sanitized = quote_identifier_dialect(_sanitize_view_name(table_name), self.connector)
        sql = dialect.limit_first_row_sql(sanitized)
        with _conn_with_cursor(self.connector) as (_conn, cur):
            try:
                cur.execute(sql)
            except Exception as exc:
                raise DatabaseError(f"Unable to read columns for {table_name}.") from exc
            descriptions = cur.description or []
            row_raw = cur.fetchone()
            columns_names = [desc[0] for desc in descriptions]
            row: dict[str, Any] | None = None
            if row_raw is not None:
                row = (
                    row_raw
                    if isinstance(row_raw, dict)
                    else dict(zip(columns_names, row_raw))
                )

        index_cols = index_columns_for(table_name, self.connector)

        columns: list[dict[str, Any]] = []
        for desc in descriptions:
            col_name = desc[0]
            sql_type_code = desc[1]
            sample = row.get(col_name) if row else None
            family, is_integer, is_text_storage = dialect.type_family(sql_type_code, sample)
            columns.append(
                {
                    "name": col_name,
                    "type": family,
                    "raw_type": dialect.display_type_name(sql_type_code, sample),
                    "is_integer": is_integer,
                    "is_text_storage": is_text_storage,
                    "is_indexed": col_name in index_cols,
                }
            )
        return columns

    def _index_columns_for(self, table_name: str) -> set[str]:
        """Return the set of column names that are part of any index on the table."""
        from src.web.db import index_columns_for

        return index_columns_for(table_name, self.connector)

    def _columns_of(self, table_name: str) -> list[str]:
        return [c["name"] for c in self.get_columns(table_name)]

    def _columns_info_of(self, table_name: str) -> list[dict[str, Any]]:
        """Return full column metadata for a table/view."""
        return self.get_columns(table_name)

    _CUSTOM_COLUMN_ALIAS_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

    @classmethod
    def _validate_custom_column(cls, alias: str, definition: str) -> None:
        """Validate both the alias and the SQL definition of a custom column."""
        if not alias:
            raise ViewModelingError("Alias vlastního sloupce nesmí být prázdný.")
        if not cls._CUSTOM_COLUMN_ALIAS_RE.match(alias):
            raise ViewModelingError(
                "Alias vlastního sloupce smí obsahovat pouze písmena, číslice a podtržítko "
                "a musí začínat písmenem nebo podtržítkem."
            )
        if not definition:
            raise ViewModelingError("Definice vlastního sloupce nesmí být prázdná.")
        cls._validate_custom_column_definition(definition)

    def _validate_and_quote_custom_column_expression(
        self, definition: str, alias: str
    ) -> str:
        """Return the validated custom column definition wrapped in parentheses.

        Used when the custom column is referenced in a WHERE/ON condition so MSSQL
        sees a valid expression instead of a bare alias.
        """
        if not definition:
            raise ViewModelingError(
                f"Vlastní sloupec {alias} nemá definici."
            )
        self._validate_custom_column_definition(definition)
        return f"({definition})"

    @staticmethod
    def _validate_custom_column_definition(definition: str) -> None:
        """Validate a user-provided custom column expression.

        Allows scalar SQL expressions such as literals, column references,
        function calls and CASE expressions. Rejects statement separators,
        comments, unbalanced parentheses and trailing text after the final
        closing parenthesis (which would indicate appended SQL).
        """
        if not definition:
            raise ViewModelingError("Definice vlastního sloupce nesmí být prázdná.")

        # Reject statement separators and comments in any case / unicode form.
        lower = definition.casefold()
        forbidden_sequences = [
            ";", "\u037e", "\u061b",  # semicolons (ASCII, Greek, Arabic)
            "--", "/*", "*/",
            "union", "insert", "update", "delete", "drop", "alter", "create",
            "exec", "execute", "sp_", "xp_", "merge", "truncate", "into",
            "bulk", "openrowset", "openquery",
        ]
        for seq in forbidden_sequences:
            if seq in lower:
                raise ViewModelingError(
                    f"Vlastní sloupec obsahuje nepovolenou sekvenci: {seq!r}."
                )

        # Count parentheses and brackets, ignoring those inside string literals.
        paren_depth = 0
        bracket_depth = 0
        in_string = False
        string_quote = ""
        for i, ch in enumerate(definition):
            if in_string:
                if ch == string_quote:
                    # SQL Server escapes quotes by doubling them.
                    if i + 1 < len(definition) and definition[i + 1] == string_quote:
                        continue
                    in_string = False
                    string_quote = ""
                continue
            if ch in {"'", '"'}:
                in_string = True
                string_quote = ch
                continue
            if ch == "(":
                paren_depth += 1
            elif ch == ")":
                paren_depth -= 1
                if paren_depth < 0:
                    raise ViewModelingError("Přebytečná uzavírací závorka ')'.")
            elif ch == "[":
                bracket_depth += 1
            elif ch == "]":
                bracket_depth -= 1
                if bracket_depth < 0:
                    raise ViewModelingError("Přebytečná uzavírací hranatá závorka ']'.")

        if paren_depth != 0:
            raise ViewModelingError("Nesprávně uzavřené kulaté závorky.")
        if bracket_depth != 0:
            raise ViewModelingError("Nesprávně uzavřené hranaté závorky.")

        # After the final ')' there must be only whitespace. Anything else means
        # the user appended additional SQL (e.g. '); SELECT ... FROM ...').
        final_paren_idx = -1
        for i in range(len(definition) - 1, -1, -1):
            if definition[i] == ")":
                final_paren_idx = i
                break
        if final_paren_idx >= 0:
            trailing = definition[final_paren_idx + 1 :].strip()
            if trailing:
                raise ViewModelingError(
                    "Za poslední uzavírací závorkou nesmí následovat žádný text."
                )

        # Reject comma and semicolon characters outside of string literals.
        # Commas are allowed inside function calls (inside parentheses/brackets);
        # semicolons are never allowed because they terminate statements.
        in_string = False
        string_quote = ""
        paren_depth = 0
        bracket_depth = 0
        for i, ch in enumerate(definition):
            if in_string:
                if ch == string_quote:
                    if i + 1 < len(definition) and definition[i + 1] == string_quote:
                        continue
                    in_string = False
                    string_quote = ""
                continue
            if ch in {"'", '"'}:
                in_string = True
                string_quote = ch
                continue
            if ch == "(":
                paren_depth += 1
            elif ch == ")":
                paren_depth -= 1
            elif ch == "[":
                bracket_depth += 1
            elif ch == "]":
                bracket_depth -= 1
            elif ch in {";", "\u037e", "\u061b"}:
                raise ViewModelingError(
                    "Středník není v definici sloupce povolený."
                )
            elif ch in {",", "\u201a", "\uff0c", "\u060c"} and paren_depth == 0 and bracket_depth == 0:
                raise ViewModelingError(
                    "Čárka mimo závorky není v definici sloupce povolená."
                )


    def build_sql(
        self, payload: dict[str, Any], *, include_order_by: bool | None = None
    ) -> str:
        """Build a SELECT statement from the modeling payload."""
        primary = (payload.get("primary_table") or "").strip()
        selected_columns = payload.get("selected_columns") or []
        if not primary:
            raise ViewModelingError("Vyberte primární tabulku.")
        if not selected_columns:
            raise ViewModelingError("Vyberte alespoň jeden sloupec.")

        joins = payload.get("joins") or []
        subviews = self._normalize_subviews(payload)
        group_by = payload.get("group_by") or []
        order_by = payload.get("order_by") or []
        aggregations = payload.get("aggregations") or {}
        helios_mode = (
            include_order_by is False
            or (
                include_order_by is None
                and self._tab_obecny_prehled_exists()
            )
        )

        custom_columns = payload.get("custom_columns") or []

        from src.web.dialects import dialect_for_connector

        dialect = dialect_for_connector(self.connector)
        table_hint = dialect.table_hint()

        # Mapping of alias -> real base table name.  Allows using the same base
        # table multiple times on the canvas, each under its own alias.
        table_aliases: dict[str, str] = {}
        for alias, base in (payload.get("table_aliases") or {}).items():
            alias = str(alias).strip()
            base = str(base).strip()
            if alias and base:
                table_aliases[alias] = base

        def _base_table(name: str) -> str:
            name = (name or "").strip()
            return table_aliases.get(name, name)

        subview_sources: dict[str, str] = {}
        subview_columns: dict[str, list[str]] = {}
        for sv in subviews:
            alias = sv.get("alias", sv.get("name", "")).strip()
            if not alias:
                continue
            cols = [c.get("name") for c in (sv.get("columns") or []) if c.get("name")]
            subview_columns[alias] = cols
            subview_sources[alias] = sv.get("definition") or ""

        def _table_columns(table_name: str) -> list[str]:
            if table_name in subview_columns:
                return subview_columns[table_name]
            return self._columns_of(_base_table(table_name))

        column_cache: dict[str, list[dict[str, Any]]] = {}
        column_info: dict[tuple[str, str], dict[str, Any]] = {}

        def _load_columns_info(table_name: str) -> list[dict[str, Any]]:
            if table_name not in column_cache:
                if table_name in subview_columns:
                    column_cache[table_name] = [
                        {"name": c, "type": "text"} for c in subview_columns[table_name]
                    ]
                else:
                    column_cache[table_name] = self._columns_info_of(_base_table(table_name))
            info = column_cache[table_name]
            for c in info:
                column_info[(table_name, c["name"])] = c
            return info

        def _column_type(table_name: str, col_name: str) -> dict[str, Any] | None:
            key = (table_name, col_name)
            if key not in column_info:
                _load_columns_info(table_name)
            return column_info.get(key)

        def _quote_source(table_name: str) -> str:
            # Quote a table source.  WHEN the SQL identifier differs from the
            # real table name, emit `[real] AS [alias]`.
            base = _base_table(table_name)
            if base != table_name:
                return f"{self._qi(base)} AS {self._qi(table_name)} {table_hint}"
            return f"{self._qi(table_name)} {table_hint}".strip()

        available: dict[str, list[str]] = {primary: _table_columns(primary)}

        # Register custom columns under a synthetic table name so they can be used
        # in WHERE conditions. The expression is used as the column source.
        CUSTOM_COLUMNS_TABLE = "[custom_columns]"
        custom_columns_by_alias: dict[str, str] = {}
        for cc in custom_columns:
            alias = (cc.get("alias") or "").strip()
            definition = (cc.get("definition") or "").strip()
            if alias and definition:
                custom_columns_by_alias[alias] = definition
        if custom_columns_by_alias:
            available[CUSTOM_COLUMNS_TABLE] = list(custom_columns_by_alias.keys())
            column_cache[CUSTOM_COLUMNS_TABLE] = [
                {"name": alias, "type": "text"} for alias in custom_columns_by_alias
            ]
            for alias in custom_columns_by_alias:
                column_info[(CUSTOM_COLUMNS_TABLE, alias)] = {"name": alias, "type": "text"}

        # First pass: collect all tables that are actually used in joins so we can
        # safely prefix every column when there is more than one table in play.
        # A join's left side must be a table already present in the query; if the
        # payload has them reversed (common when reusing an existing table as the
        # join target), swap them so the SQL is valid.
        joined_tables: list[tuple[str, str, str, list[dict[str, Any]]]] = []
        joined_so_far: set[str] = {primary}
        for join in joins:
            join_type = (join.get("join_type") or "LEFT").strip().upper()
            if join_type not in {"INNER", "LEFT", "RIGHT", "FULL"}:
                join_type = "LEFT"
            # Start from explicit join endpoints when provided; the first condition
            # will be used to resolve the actual orientation if it differs.
            explicit_left = (join.get("left_table") or "").strip()
            explicit_right = (join.get("right_table") or "").strip()
            left = explicit_left or primary
            right = explicit_right
            conditions = self._normalize_join_conditions(join, left, right)
            if not conditions:
                continue

            # The first condition determines which table should be joined (the new
            # table that is not yet part of the query). The new table becomes the
            # right side of the JOIN; the side that is already known stays on the
            # left. If both sides are already known the user payload is left as-is.
            first = conditions[0]
            cond_left = (first.get("left_table") or "").strip()
            cond_right = (first.get("right_table") or "").strip()
            left_is_new = cond_left and cond_left not in joined_so_far
            right_is_new = cond_right and cond_right not in joined_so_far

            if left_is_new and not right_is_new:
                # First table in the condition is the table to join.
                new_right = cond_left
                new_left = cond_right or explicit_left or primary
                for cond in conditions:
                    old_left_tbl = (cond.get("left_table") or "").strip()
                    old_right_tbl = (cond.get("right_table") or "").strip()
                    old_left_col = (cond.get("left_column") or "").strip()
                    old_right_col = (cond.get("right_column") or "").strip()
                    # Swap column-only conditions. Conditions that compare a
                    # column to a literal value are kept unchanged so the column
                    # stays tied to its original table.
                    if old_left_col and old_right_col:
                        cond["left_table"] = old_right_tbl
                        cond["right_table"] = old_left_tbl
                        cond["left_column"] = old_right_col
                        cond["right_column"] = old_left_col
                left, right = new_left, new_right
            elif right_is_new and not left_is_new:
                # Second table in the condition is the table to join.
                left, right = cond_left, cond_right
            elif right:
                # No clear orientation from the first condition: keep explicit payload.
                pass
            else:
                # No explicit right table and no new table detected: skip join.
                continue

            for tbl in {left, right}:
                if tbl and tbl not in available:
                    available[tbl] = _table_columns(tbl)
                    _load_columns_info(tbl)
            joined_so_far.add(left)
            joined_so_far.add(right)
            joined_tables.append((left, right, join_type, conditions))

        has_joins = bool(joined_tables) or bool(subviews)

        # Resolve selected column metadata first so we can detect duplicate names
        # across tables and auto-alias them.
        selected: list[tuple[str, str, str]] = []
        for col in selected_columns:
            table = col.get("table") or primary
            name = col.get("name")
            if not name:
                continue
            if table not in available:
                available[table] = _table_columns(table)
                _load_columns_info(table)
            if name not in available[table]:
                raise ViewModelingError(
                    f"Sloupec {name} nepatří do tabulky {table}."
                )
            alias = (col.get("alias") or "").strip()
            selected.append((table, name, alias))

        if not selected:
            raise ViewModelingError("Žádné platné sloupce k výběru.")

        # Add custom computed columns after validation.
        for cc in custom_columns:
            alias = (cc.get("alias") or "").strip()
            definition = (cc.get("definition") or "").strip()
            if not alias or not definition:
                continue
            self._validate_custom_column(alias, definition)
            selected.append(("", definition, alias))

        # Detect names that occur in more than one selected column.
        name_counts: dict[str, int] = {}
        for _, name, _ in selected:
            name_counts[name] = name_counts.get(name, 0) + 1

        group_cols_set = {
            (
                (gb.get("table") or primary).strip(),
                (gb.get("column") or "").strip(),
            )
            for gb in group_by
            if (gb.get("column") or "").strip()
        }

        select_parts: list[str] = []
        for table, name, alias in selected:
            if not table:
                # Custom computed column: use the user-provided expression as-is.
                expr = name
            elif (table, name) in group_cols_set:
                # Grouping column: select it directly.
                quoted = self._qi(name)
                prefix = self._qi(table) + "." if has_joins else ""
                expr = f"{prefix}{quoted}"
            elif group_cols_set:
                # Non-grouping column inside an aggregate query requires an aggregation.
                agg = (aggregations.get(f"{table}.{name}") or aggregations.get(name) or "").strip().upper()
                if agg not in {"SUM", "AVG", "MIN", "MAX", "COUNT"}:
                    raise ViewModelingError(
                        f"Sloupec {name} z tabulky {table} musí mít agregaci (SUM, AVG, MIN, MAX, COUNT), "
                        f"protože je použit ve výběru spolu s GROUP BY."
                    )
                quoted = self._qi(name)
                prefix = self._qi(table) + "." if has_joins else ""
                expr = f"{agg}({prefix}{quoted})"
                # Aggregated columns must always have an output alias.
                if table and not alias:
                    alias = f"{table}_{name}" if has_joins and name_counts[name] > 1 else name
            else:
                quoted = self._qi(name)
                # Prefix every column as soon as a join is involved. This avoids
                # "Ambiguous column name" errors when both tables share column names.
                prefix = self._qi(table) + "." if has_joins else ""
                expr = f"{prefix}{quoted}"
            effective_alias = alias
            if table and has_joins and not effective_alias and name_counts[name] > 1:
                effective_alias = f"{table}_{name}"
            if effective_alias:
                expr += f" AS {self._qi(effective_alias)}"
            select_parts.append(expr)

        if not select_parts:
            raise ViewModelingError("Žádné platné sloupce k výběru.")

        sql = "SELECT\n  " + ",\n  ".join(select_parts) + f"\nFROM {_quote_source(primary)}"

        for left, right, join_type, conditions in joined_tables:
            on_clauses: list[str] = []
            for i, cond in enumerate(conditions):
                rendered = self._build_condition_sql(
                    cond, available, is_join=True, left_table=left, right_table=right
                )
                # Strip trailing logical operator appended by _build_condition_sql; ON uses AND for all.
                rendered = re.sub(r"\s+(AND|OR)\s*$", "", rendered)
                on_clauses.append(rendered)
            if on_clauses:
                right_source = subview_sources.get(right)
                if right_source:
                    right_sql = f"({right_source}) AS {self._qi(right)}"
                else:
                    right_sql = _quote_source(right)
                sql += (
                    f"\n{join_type} JOIN {right_sql} ON "
                    f"{' AND '.join(on_clauses)}"
                )

        where_sql = self._build_where_sql(
            payload.get("where_clauses") or [],
            available,
            _column_type,
            base_table=_base_table,
            custom_columns_by_alias=custom_columns_by_alias,
        )
        if where_sql:
            sql += "\n" + where_sql

        if group_by:
            group_parts = []
            for gb in group_by:
                table = (gb.get("table") or primary).strip()
                col = (gb.get("column") or "").strip()
                if not col:
                    continue
                if table not in available:
                    available[table] = _table_columns(table)
                    _load_columns_info(table)
                if col not in available[table]:
                    raise ViewModelingError(
                        f"Sloupec {col} nepatří do tabulky {table}."
                    )
                group_parts.append(f"{self._qi(table)}.{self._qi(col)}")
            if group_parts:
                sql += "\nGROUP BY " + ", ".join(group_parts)

        if order_by and not helios_mode:
            order_parts = []
            for ob in order_by:
                table = (ob.get("table") or primary).strip()
                col = (ob.get("column") or "").strip()
                desc = bool(ob.get("desc"))
                aggregation = (ob.get("aggregation") or "").strip().upper()
                if not col:
                    continue
                if aggregation and aggregation in {"SUM", "AVG", "MIN", "MAX", "COUNT"}:
                    expr = f"{aggregation}({self._qi(table)}.{self._qi(col)})"
                else:
                    if table not in available:
                        available[table] = _table_columns(table)
                        _load_columns_info(table)
                    if col not in available[table]:
                        raise ViewModelingError(
                            f"Sloupec {col} nepatří do tabulky {table}."
                        )
                    expr = f"{self._qi(table)}.{self._qi(col)}"
                order_parts.append(f"{expr} {'DESC' if desc else 'ASC'}")
            if order_parts:
                sql += "\nORDER BY " + ", ".join(order_parts)

        return sql

    def _build_where_sql(
        self,
        where_clauses: list[dict[str, Any]],
        available: dict[str, list[str]],
        column_type_fn=None,
        base_table=None,
        custom_columns_by_alias: dict[str, str] | None = None,
    ) -> str:
        """Render WHERE clause from user conditions."""
        parts: list[str] = []
        for i, wc in enumerate(where_clauses or []):
            rendered = self._build_condition_sql(
                wc,
                available,
                is_join=False,
                column_type_fn=column_type_fn,
                base_table=base_table,
                custom_columns_by_alias=custom_columns_by_alias,
            )
            if not rendered:
                continue
            # Remove the trailing logical operator on the last condition.
            if i == len(where_clauses) - 1:
                rendered = re.sub(r"\s+(AND|OR)\s*$", "", rendered)
            parts.append(rendered)
        if not parts:
            return ""
        return "WHERE\n  " + "\n  ".join(parts)

    def _build_condition_sql(
        self,
        cond: dict[str, Any],
        available: dict[str, list[str]],
        is_join: bool,
        left_table: str = "",
        right_table: str = "",
        column_type_fn=None,
        base_table=None,
        custom_columns_by_alias: dict[str, str] | None = None,
    ) -> str:
        """Render a single condition for WHERE or ON clause."""
        base = base_table or (lambda n: n)
        if is_join:
            left_table = (cond.get("left_table") or left_table or "").strip()
            left_column = (cond.get("left_column") or "").strip()
        else:
            left_table = (cond.get("table") or "").strip()
            left_column = (cond.get("column") or "").strip()
        if not left_table or not left_column:
            return ""
        if left_table not in available:
            available[left_table] = self._columns_of(base(left_table))
            if column_type_fn is not None:
                column_type_fn(left_table, left_column)
        if left_column not in available[left_table]:
            raise ViewModelingError(
                f"Sloupec {left_column} nepatří do tabulky {left_table}."
            )

        left_col_info = column_type_fn(left_table, left_column) if column_type_fn else None

        operator = (cond.get("operator") or "=").strip().upper()
        if operator not in {
            "=",
            "!=",
            "<>",
            "<",
            ">",
            "<=",
            ">=",
            "LIKE",
            "IN",
            "NOT IN",
            "IS NULL",
            "IS NOT NULL",
            "BETWEEN",
        }:
            operator = "="
        if operator in ("<>", "!="):
            operator = "<>"

        open_paren = "(" if cond.get("open_paren") else ""
        close_paren = ")" if cond.get("close_paren") else ""
        CUSTOM_COLUMNS_TABLE = "[custom_columns]"
        custom_columns = custom_columns_by_alias or {}
        if left_table == CUSTOM_COLUMNS_TABLE:
            expr = self._validate_and_quote_custom_column_expression(
                custom_columns.get(left_column, ""), left_column
            )
        else:
            expr = f"{self._qi(left_table)}.{self._qi(left_column)}"

        if is_join:
            second_table = (cond.get("right_table") or right_table or "").strip()
            second_column = (cond.get("right_column") or "").strip()
        else:
            second_table = (cond.get("second_table") or "").strip()
            second_column = (cond.get("second_column") or "").strip()
        has_second = bool(second_table and second_column)
        value_sql = ""
        if has_second:
            if second_table not in available:
                available[second_table] = self._columns_of(base(second_table))
            if second_column not in available[second_table]:
                raise ViewModelingError(
                    f"Sloupec {second_column} nepatří do tabulky {second_table}."
                )
            if second_table == CUSTOM_COLUMNS_TABLE:
                value_sql = self._validate_and_quote_custom_column_expression(
                    custom_columns.get(second_column, ""), second_column
                )
            else:
                value_sql = (
                    f"{self._qi(second_table)}.{self._qi(second_column)}"
                )

        if operator in {"IS NULL", "IS NOT NULL"}:
            clause = f"{open_paren}{expr} {operator}{close_paren}"
            logical = (cond.get("logical_operator") or "AND").strip().upper()
            if logical not in {"AND", "OR"}:
                logical = "AND"
            return clause + f" {logical}"

        if operator == "BETWEEN":
            from_value = (cond.get("from_value") or "").strip()
            to_value = (cond.get("to_value") or "").strip()
            if has_second or not from_value or not to_value:
                return ""
            clause = (
                f"{open_paren}{expr} BETWEEN {self._literal_value(from_value, left_col_info)} "
                f"AND {self._literal_value(to_value, left_col_info)}{close_paren}"
            )
            logical = (cond.get("logical_operator") or "AND").strip().upper()
            if logical not in {"AND", "OR"}:
                logical = "AND"
            return clause + f" {logical}"

        if not has_second:
            raw_value = (cond.get("value") or "").strip()
            if not raw_value:
                return ""
            if raw_value.startswith("("):
                value_sql = raw_value
            elif operator in {"IN", "NOT IN"}:
                value_sql = f"({self._split_in_values(raw_value, left_col_info)})"
            else:
                value_sql = self._literal_value(raw_value, left_col_info, force_text=operator in {"LIKE", "NOT LIKE"})

        clause = f"{open_paren}{expr} {operator} {value_sql}{close_paren}"
        logical = (cond.get("logical_operator") or "AND").strip().upper()
        if logical not in {"AND", "OR"}:
            logical = "AND"
        # Logical operator is meaningful only when there is a following condition.
        # Callers decide whether to append it based on position.
        return clause + f" {logical}"


    def _normalize_subviews(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        """Return a validated list of subview definitions from the payload."""
        subviews = payload.get("subviews") or []
        result: list[dict[str, Any]] = []
        seen: set[str] = set()
        for sv in subviews:
            alias = (sv.get("alias") or sv.get("name") or "").strip()
            if not alias or alias in seen:
                continue
            seen.add(alias)
            if not sv.get("definition"):
                row = self.get_saved_view(sv.get("view_id") or 0)
                if row:
                    sv = dict(sv)
                    sv["definition"] = row.get("DefView") or ""
                    sv["name"] = row.get("NazevSys") or row.get("Nazev") or alias
            sv = dict(sv)
            sv["definition"] = self._add_table_hints_to_subview_sql(sv.get("definition") or "")
            result.append(sv)
        return result

    def _add_table_hints_to_subview_sql(self, sql: str) -> str:
        """Ensure every physical table source in a subview SQL has a hint.

        This is a best-effort rewrite for MSSQL; other dialects are left
        unchanged.  If the SQL already contains the hint, it is returned as-is.
        """
        if not sql:
            return sql
        from src.web.dialects import dialect_for_connector

        if dialect_for_connector(self.connector).table_hint() != "WITH (NOLOCK)":
            return sql
        if re.search(r"\bWITH\s*\(\s*NOLOCK\s*\)", sql, re.IGNORECASE):
            return sql

        def repl(match: re.Match[str]) -> str:
            keyword = match.group(1)
            table = match.group(2)
            alias = match.group(3)
            if alias:
                return f"{keyword} {table} {alias} WITH (NOLOCK)"
            return f"{keyword} {table} WITH (NOLOCK)"

        # Reserved words that can never be a table alias in this context.
        _RESERVED = (
            "LEFT|RIGHT|INNER|OUTER|FULL|CROSS|JOIN|ON|WHERE|GROUP|ORDER|HAVING"
        )

        def _apply(pattern_str: str, text: str) -> str:
            return re.compile(pattern_str, re.IGNORECASE).sub(repl, text)

        # JOIN sources are followed by ON or another JOIN clause.
        join_pattern = (
            rf"\b(JOIN)\s+(\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)(?:(?:\s+AS\s+|\s+)(?!\b(?:{_RESERVED})\b)(\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*))?(?=\s+(?:ON|JOIN|LEFT|RIGHT|INNER|OUTER|FULL|CROSS|WHERE|GROUP|ORDER|HAVING|$))"
        )
        sql = _apply(join_pattern, sql)
        # FROM sources are followed by a JOIN clause or a terminating clause.
        from_pattern = (
            rf"\b(FROM)\s+(\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)(?:(?:\s+AS\s+|\s+)(?!\b(?:{_RESERVED})\b)(\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*))?(?=\s+(?:(?:LEFT|RIGHT|INNER|OUTER|FULL|CROSS)\s+)?JOIN\b|WHERE\b|GROUP\b|ORDER\b|HAVING\b|$)"
        )
        return _apply(from_pattern, sql)

    def _normalize_join_conditions(
        self, join: dict[str, Any], left: str, right: str
    ) -> list[dict[str, Any]]:
        """Convert join payload into a list of ON conditions."""
        conditions = join.get("conditions") or []
        if conditions:
            normalized: list[dict[str, Any]] = []
            for c in conditions:
                if not (
                    c.get("left_column")
                    or c.get("right_column")
                    or c.get("value")
                ):
                    continue
                nc = dict(c)
                if not nc.get("left_table"):
                    nc["left_table"] = left
                if not nc.get("right_table"):
                    nc["right_table"] = right
                normalized.append(nc)
            return normalized
        # Backward compatibility: old key_pairs become '=' conditions.
        key_pairs = join.get("key_pairs") or []
        return [
            {
                "left_table": left,
                "left_column": p.get("left_column", "").strip(),
                "operator": "=",
                "right_table": right,
                "right_column": p.get("right_column", "").strip(),
                "value": "",
                "open_paren": False,
                "close_paren": False,
                "logical_operator": "AND",
            }
            for p in key_pairs
            if p.get("left_column") and p.get("right_column")
        ]

    def _split_in_values(self, raw: str, col_info: dict[str, Any] | None = None) -> str:
        """Return SQL list from comma-separated user values.

        Tokens for text columns are always quoted with single quotes; numeric
        tokens for number columns are kept as-is. Unlike the previous
        implementation a leading ``'`` never bypasses quoting, so input like
        ``' OR '1'='1`` is rendered as a harmless literal.
        """
        force_quote = self._is_text_column(col_info)
        values = [v.strip() for v in raw.split(",") if v.strip()]
        return ", ".join(
            "'" + v.replace("'", "''") + "'"
            if force_quote or not ViewModelingService._is_sql_number(v)
            else v
            for v in values
        )

    @staticmethod
    def _is_sql_number(value: str) -> bool:
        """Return True for tokens that are safe to embed as SQL numeric literals."""
        try:
            float(value)
        except (ValueError, TypeError):
            return False
        return True

    @staticmethod
    def _is_text_column(col_info: dict[str, Any] | None) -> bool:
        """Return True when column metadata says the column stores text."""
        if not col_info:
            return False
        return col_info.get("type") == "text" or bool(col_info.get("is_text_storage"))

    def _literal_value(self, value: str, col_info: dict[str, Any] | None = None, force_text: bool = False) -> str:
        """Quote a literal value for generated SQL string.

        Text columns (including varchar/nvarchar) and operators such as LIKE
        always produce a single-quoted string, even when the value looks like
        a number. Leading zeros (e.g. '00100010200') are preserved.
        """
        stripped = value.strip()
        if stripped.startswith("'") and stripped.endswith("'"):
            return stripped
        if force_text or self._is_text_column(col_info):
            escaped = stripped.replace("'", "''")
            return f"'{escaped}'"
        if stripped.isdigit():
            return stripped
        try:
            float(stripped)
            return stripped
        except ValueError:
            escaped = stripped.replace("'", "''")
            return f"'{escaped}'"

    def preview_view(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Return generated SQL plus a small data preview."""
        sql = self.build_sql(payload)
        settings = get_settings()
        n = min(10, settings.PAGE_SIZE)
        # SQL Server requires ORDER BY for OFFSET/FETCH. Re-use existing ORDER BY
        # when present instead of appending a second one.
        if re.search(r"\bORDER\s+BY\b", sql, re.IGNORECASE):
            preview_sql = sql + f" OFFSET 0 ROWS FETCH NEXT {n} ROWS ONLY"
        else:
            preview_sql = sql + f" ORDER BY (SELECT NULL) OFFSET 0 ROWS FETCH NEXT {n} ROWS ONLY"
        with _conn_with_cursor(self.connector) as (_conn, cur):
            try:
                cur.execute(preview_sql)
                rows = _fetchall_as_dicts(cur)
                columns = [desc[0] for desc in (cur.description or [])]
            except pyodbc.Error as exc:
                raise DatabaseError(f"Chyba při náhledu view: {exc}") from exc

        return {
            "sql": sql,
            "columns": columns,
            "rows": rows,
        }

    def get_saved_view_columns(self, view_id: int) -> list[dict[str, Any]]:
        """Probe a saved view definition and return its result columns."""
        from src.web.db import dialect_for_connector

        row = self.get_saved_view(view_id)
        if not row:
            raise ViewModelingError("View nebylo nalezeno.")
        definition = row.get("DefView") or ""
        if not definition.strip():
            raise ViewModelingError("View nemá definici SQL.")
        dialect = dialect_for_connector(self.connector)
        sql = dialect.limit_first_row_sql(f"({definition}) AS sq")
        with _conn_with_cursor(self.connector) as (_conn, cur):
            try:
                cur.execute(sql)
            except Exception as exc:
                raise DatabaseError(
                    f"Nepodařilo se načíst sloupce uloženého view: {exc}"
                ) from exc
            descriptions = cur.description or []
            row_raw = cur.fetchone()
            columns_names = [desc[0] for desc in descriptions]
            row: dict[str, Any] | None = None
            if row_raw is not None:
                row = (
                    row_raw
                    if isinstance(row_raw, dict)
                    else dict(zip(columns_names, row_raw))
                )

        columns: list[dict[str, Any]] = []
        for desc in descriptions:
            col_name = desc[0]
            sql_type_code = desc[1]
            sample = row.get(col_name) if row else None
            family, is_integer, is_text_storage = dialect.type_family(sql_type_code, sample)
            columns.append(
                {
                    "name": col_name,
                    "type": family,
                    "is_integer": is_integer,
                    "is_text_storage": is_text_storage,
                }
            )
        return columns

    def _tab_obecny_prehled_columns(self) -> list[str]:
        """Return actual columns of TabObecnyPrehled (cached per instance).

        Available only for MSSQL (Helios); other dialects do not persist views
        into a host table, so the cache stays empty.
        """
        from src.web.db import dialect_for_connector

        if not dialect_for_connector(self.connector).list_tables_via_tabobecny_prehled():
            return []
        if self._tab_columns is not None:
            return self._tab_columns
        sql = """
            SELECT c.name
            FROM sys.columns c
            JOIN sys.objects o ON c.object_id = o.object_id
            WHERE o.name = 'TabObecnyPrehled'
            ORDER BY c.column_id
        """
        with _conn_with_cursor(self.connector) as (_conn, cur):
            try:
                cur.execute(sql)
                self._tab_columns = [r[0] for r in cur.fetchall()]
            except pyodbc.Error:
                self._tab_columns = []
        return self._tab_columns

    def _tab_obecny_prehled_exists(self) -> bool:
        """Check whether TabObecnyPrehled exists."""
        return bool(self._tab_obecny_prehled_columns())

    def _build_def_attrs(self, payload: dict[str, Any]) -> str:
        """Return the DefAttrs value for TabObecnyPrehled as CR-separated lines.

        Each line contains 24 fields separated by CHAR(1).  The layout follows
        the working Helios view ID 311:
            name, '', '', 0, '', 1, sumovat, 1, position, 0, 0,
            '', '', 0, 0, 0, 0, 0, 0, 0, '', '', 0, 0
        """
        from src.web.db import _is_integer_sql_type

        selected_columns = payload.get("selected_columns") or []
        order_by = payload.get("order_by") or []

        # Determine output aliases exactly as build_sql produces them.
        has_joins = bool(payload.get("joins") or payload.get("subviews"))
        selected: list[tuple[str, str, str]] = []
        for col in selected_columns:
            table = col.get("table") or payload.get("primary_table", "")
            name = col.get("name")
            if not name:
                continue
            alias = (col.get("alias") or "").strip()
            selected.append((table, name, alias))

        name_counts: dict[str, int] = {}
        for _, name, _ in selected:
            name_counts[name] = name_counts.get(name, 0) + 1

        order_map: dict[str, tuple[bool, bool, int]] = {}
        for idx, ob in enumerate(order_by, start=1):
            table = (ob.get("table") or payload.get("primary_table", "")).strip()
            col = (ob.get("column") or "").strip()
            desc = bool(ob.get("desc"))
            key = f"{table}.{col}" if table else col
            order_map[key] = (True, desc, idx)

        lines: list[str] = []
        for position, (table, name, alias) in enumerate(selected, start=1):
            effective_name = alias
            if not effective_name and has_joins and name_counts[name] > 1:
                effective_name = f"{table}_{name}"
            if not effective_name:
                effective_name = name

            raw_type = ""
            for col in selected_columns:
                if col.get("name") == name and (not table or col.get("table") == table):
                    raw_type = (col.get("raw_type") or "").upper()
                    break
            is_numeric = bool(
                raw_type in {"INT", "INTEGER", "BIGINT", "SMALLINT", "TINYINT"}
                or _is_integer_sql_type(raw_type)
            )

            order_key = f"{table}.{name}" if table else name
            order_info = order_map.get(order_key)
            _in_order_by = order_info is not None
            _sort_desc = bool(order_info[1]) if order_info else False
            _sort_order = order_info[2] if order_info else 0

            parts = [
                effective_name,
                "", "",
                "0",
                "",
                "1",
                "1" if is_numeric else "0",
                "1",
                str(position),
                "0",
                "0",
                "", "",
                "0",
                str(_sort_order) if _in_order_by else "0",
                "1" if (_in_order_by and _sort_desc) else "0",
                "0", "0", "0", "0",
                "", "",
                "0",
                "0",
            ]
            lines.append("\x01".join(parts))

        return "\r".join(lines) + "\r"

    def _def_attrs_sql_expression(self, payload: dict[str, Any]) -> str:
        """Build a T-SQL expression that constructs the DefAttrs value.

        The expression uses CONVERT(VARCHAR(100), REPLACE(..., CHAR(1), ''))
        for each field and concatenates them with CHAR(1).  Lines are joined
        with CHAR(13) so the ntext column stores CR-only line breaks.
        """

        def _sql_value(value: str) -> str:
            escaped = value.replace("'", "''")
            return f"CONVERT(VARCHAR(100), REPLACE('{escaped}', CHAR(1), ''))"

        attrs = self._build_def_attrs(payload)
        if not attrs:
            return "NULL"

        line_expressions: list[str] = []
        for line in attrs.rstrip("\r").split("\r"):
            fields = line.split("\x01")
            # Ensure exactly 24 fields per line.
            fields = (fields + [""] * 24)[:24]
            fragments = [_sql_value(f) for f in fields]
            line_expressions.append(" + CHAR(1) + ".join(fragments) + " + CHAR(13)")

        return " + ".join(line_expressions)

    @staticmethod
    def _helios_view_name(name: str) -> str:
        """Return the view name prefixed with hvw_ when TabObecnyPrehled is used."""
        if not name:
            return name
        if name.lower().startswith("hvw_"):
            return name
        return f"hvw_{name}"

    def save_view(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Save the modeled view definition to TabObecnyPrehled."""
        name = (payload.get("name") or "").strip()
        if not name:
            raise ViewModelingError("Zadejte název view.")

        if not self._tab_obecny_prehled_exists():
            sql = self.build_sql(payload)
            return {
                "saved": False,
                "reason": "Tabulka TabObecnyPrehled neexistuje. View nebylo uloženo.",
                "sql": sql,
            }

        name = self._helios_view_name(name)

        columns = self._tab_obecny_prehled_columns()
        # When re-saving an existing view, keep the same ID instead of inserting
        # a new row with the same NazevSys.
        existing_id = self._existing_view_id(name)

        sql = self.build_sql(payload)

        fields: dict[str, Any] = {}
        defaults: dict[str, Any] = {
            "NazevSys": name,
            "Nazev": name,
            "DefView": sql,
            "JeToDBView": True,
            "Systemovy": False,
            "Skupina": "Uživatelské",
            "Cislo": 0,
            "Autor": self.connector.db_user if self.connector else get_settings().DB_USER,
            "BlobTableName": "",
            "Maximalizovat": False,
            "KOdeslani": False,
            "Poznamka": self._encode_view_note(payload),
        }
        for col, value in defaults.items():
            if col in columns:
                fields[col] = value

        if "Cislo" in fields and fields["Cislo"] == 0:
            fields["Cislo"] = self._next_cislo()

        if "GUID" in columns:
            import uuid

            guid = uuid.uuid4()
            fields["GUID"] = guid.bytes
            # GUIDText is typically a computed column; do not try to insert it.
            fields.pop("GUIDText", None)

        if "DefAttrs" in columns:
            fields["DefAttrs"] = self._def_attrs_sql_expression(payload)

        col_list = ", ".join(self._qi(c) for c in fields)
        placeholders = ", ".join("?" for _ in fields)
        # DefAttrs is built by a SQL expression, so we substitute it inline.
        insert_sql = f"INSERT INTO dbo.TabObecnyPrehled ({col_list}) VALUES ({placeholders})"
        insert_sql = insert_sql.replace("?, ?, ?, ?", "?, ?, ?, ?")  # placeholder
        # Replace the single ? that corresponds to DefAttrs with the expression.
        # Because placeholders are positional, we collect literal params separately.
        params: list[Any] = []
        for col, value in fields.items():
            if col == "DefAttrs":
                continue
            params.append(value)

        def_attrs_expr = self._def_attrs_sql_expression(payload)
        # Rebuild the SQL with DefAttrs expression inline.
        quoted_fields = [self._qi(c) for c in fields]
        value_parts: list[str] = []
        for col in fields:
            if col == "DefAttrs":
                value_parts.append(def_attrs_expr)
            else:
                value_parts.append("?")
        final_sql = (
            f"INSERT INTO dbo.TabObecnyPrehled ({', '.join(quoted_fields)}) "
            f"VALUES ({', '.join(value_parts)})"
        )

        with _conn_with_cursor(self.connector) as (conn, cur):
            try:
                if existing_id is not None:
                    return self.update_view(existing_id, payload)
                cur.execute(final_sql, tuple(params))
                conn.commit()
            except pyodbc.Error as exc:
                raise DatabaseError(f"Nepodařilo se uložit view: {exc}") from exc

        return {"saved": True, "name": name, "sql": sql}

    def _existing_view_id(self, name: str) -> int | None:
        """Return the ID of an existing user view with the given NazevSys."""
        columns = self._tab_obecny_prehled_columns()
        if not columns or "ID" not in columns or "NazevSys" not in columns:
            return None
        sql = "SELECT ID FROM dbo.TabObecnyPrehled WHERE NazevSys = ?"
        with _conn_with_cursor(self.connector) as (_conn, cur):
            try:
                cur.execute(sql, (name,))
                row = cur.fetchone()
                if row is None:
                    return None
                # pyodbc.Row supports indexing by position and by column name,
                # but not dict-style .get() access.
                return row[0]
            except pyodbc.Error:
                return None

    def update_view(self, view_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        """Update an existing row in TabObecnyPrehled."""
        name = (payload.get("name") or "").strip()
        if not name:
            raise ViewModelingError("Zadejte název view.")

        columns = self._tab_obecny_prehled_columns()
        if not columns:
            sql = self.build_sql(payload)
            return {
                "saved": False,
                "reason": "Tabulka TabObecnyPrehled neexistuje. View nebylo uloženo.",
                "sql": sql,
            }

        name = self._helios_view_name(name)
        sql = self.build_sql(payload)

        fields: dict[str, Any] = {
            "NazevSys": name,
            "Nazev": name,
            "DefView": sql,
        }
        if "Poznamka" in columns:
            fields["Poznamka"] = self._encode_view_note(payload)
        if "DefAttrs" in columns:
            fields["DefAttrs"] = self._def_attrs_sql_expression(payload)

        existing = self.get_saved_view(view_id)
        if not existing:
            raise ViewModelingError("Uložené view nebylo nalezeno.")
        # Prevent moving a view to a different connector; connector_id in the note
        # must match the connector used to load this view.
        existing_note = self._decode_view_note(existing.get("Poznamka") or "")
        existing_connector_id = existing_note.get("connector_id")
        new_connector_id = self._connector_id(payload)
        if (
            existing_connector_id is not None
            and new_connector_id is not None
            and existing_connector_id != new_connector_id
        ):
            raise ViewModelingError(
                "Nelze změnit konektor existujícího view. Vytvořte nové view, nebo ponechte stejný konektor."
            )

        set_parts: list[str] = []
        params: list[Any] = []
        for col, value in fields.items():
            if col == "DefAttrs":
                set_parts.append(f"{self._qi(col)} = {self._def_attrs_sql_expression(payload)}")
            else:
                set_parts.append(f"{self._qi(col)} = ?")
                params.append(value)
        set_clause = ", ".join(set_parts)
        update_sql = f"UPDATE dbo.TabObecnyPrehled SET {set_clause} WHERE ID = ?"
        params.append(view_id)
        with _conn_with_cursor(self.connector) as (conn, cur):
            try:
                cur.execute(update_sql, tuple(params))
                conn.commit()
            except pyodbc.Error as exc:
                raise DatabaseError(f"Nepodařilo se upravit view: {exc}") from exc

        return {"saved": True, "id": view_id, "name": name, "sql": sql}

    def delete_view(self, view_id: int) -> None:
        """Delete a row from TabObecnyPrehled."""
        columns = self._tab_obecny_prehled_columns()
        if not columns or "ID" not in columns:
            raise DatabaseError("Tabulka TabObecnyPrehled neexistuje. View nebylo smazáno.")
        sql = "DELETE FROM dbo.TabObecnyPrehled WHERE ID = ?"
        with _conn_with_cursor(self.connector) as (conn, cur):
            try:
                cur.execute(sql, (view_id,))
                conn.commit()
            except pyodbc.Error as exc:
                raise DatabaseError(f"Nepodařilo se smazat view: {exc}") from exc

    def get_saved_view_by_name(self, view_name: str) -> dict[str, Any] | None:
        """Return a saved view row by its unique system name."""
        columns = self._tab_obecny_prehled_columns()
        if not columns:
            return None
        wanted = [c for c in ["ID", "NazevSys", "Nazev", "DefView", "Autor", "DatPorizeni", "Poznamka"] if c in columns]
        sql = (
            f"SELECT {', '.join(self._qi(c) for c in wanted)} "
            f"FROM dbo.TabObecnyPrehled WHERE NazevSys = ?"
        )
        with _conn_with_cursor(self.connector) as (_conn, cur):
            try:
                cur.execute(sql, (view_name,))
                row = cur.fetchone()
                if row is None:
                    return None
                if isinstance(row, dict):
                    return row
                descriptions = cur.description or []
                return dict(zip([desc[0] for desc in descriptions], row))
            except pyodbc.Error as exc:
                raise DatabaseError(f"Nelze načíst uložené view: {exc}") from exc

    def get_saved_view(self, view_id: int) -> dict[str, Any] | None:
        """Return a single saved view row from TabObecnyPrehled."""
        columns = self._tab_obecny_prehled_columns()
        if not columns or "ID" not in columns:
            return None
        wanted = [c for c in ["ID", "NazevSys", "Nazev", "DefView", "Autor", "DatPorizeni", "Poznamka"] if c in columns]
        sql = (
            f"SELECT {', '.join(self._qi(c) for c in wanted)} "
            f"FROM dbo.TabObecnyPrehled WHERE ID = ?"
        )
        with _conn_with_cursor(self.connector) as (_conn, cur):
            try:
                cur.execute(sql, (view_id,))
                row = cur.fetchone()
                if row is None:
                    return None
                if isinstance(row, dict):
                    return row
                descriptions = cur.description or []
                return dict(zip([desc[0] for desc in descriptions], row))
            except pyodbc.Error as exc:
                raise DatabaseError(f"Nelze načíst uložené view: {exc}") from exc

    def parse_saved_view(self, view_id: int) -> dict[str, Any] | None:
        """Load a saved view and try to parse its DefView into editable parts."""
        row = self.get_saved_view(view_id)
        if not row:
            return None
        definition = row.get("DefView") or ""
        parsed = self._parse_select_sql(definition)
        parsed["id"] = row.get("ID")
        parsed["name"] = row.get("NazevSys") or row.get("Nazev") or ""
        note = self._decode_view_note(row.get("Poznamka") or "")
        parsed["description"] = note.get("description", "")
        # Metadata (Poznamka) is authoritative when present for aliases and
        # explicit structure; SQL parse is the fallback.
        if note.get("primary_table"):
            parsed["primary_table"] = note.get("primary_table")
        # Merge table aliases from SQL parse with metadata (metadata wins).
        sql_aliases = parsed.get("table_aliases") or {}
        note_aliases = note.get("table_aliases") or {}
        merged_aliases = {**sql_aliases, **note_aliases}
        parsed["table_aliases"] = merged_aliases
        parsed["where_clauses"] = note.get("where_clauses", [])
        parsed["joins"] = note.get("joins", parsed.get("joins", []))
        parsed["subviews"] = note.get("subviews", [])
        parsed["custom_columns"] = note.get("custom_columns", [])
        parsed["group_by"] = note.get("group_by", [])
        parsed["order_by"] = note.get("order_by", [])
        parsed["aggregations"] = note.get("aggregations", {})
        parsed["api_enabled"] = bool(note.get("api_enabled"))
        parsed["api_put_enabled"] = bool(note.get("api_put_enabled"))
        parsed["api_type"] = note.get("api_type") or "flat"
        parsed["connector_id"] = note.get("connector_id")
        parsed["raw_sql"] = definition
        return parsed

    def _parse_select_sql(self, sql: str) -> dict[str, Any]:
        """Best-effort parser for simple SELECT/FROM/JOIN SQL."""
        result: dict[str, Any] = {
            "primary_table": "",
            "selected_columns": [],
            "joins": [],
            "group_by": [],
            "order_by": [],
            "aggregations": {},
            "table_aliases": {},
        }
        if not sql:
            return result
        upper = sql.upper()
        # Find the outer FROM keyword (the one introducing the source table), not
        # FROM inside a subselect.  We do this by walking the uppercased string and
        # tracking parenthesis depth so the first FROM at depth 0 is our target.
        from_idx = -1
        depth = 0
        for i, ch in enumerate(upper):
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
            elif depth == 0 and upper.startswith("FROM ", i) and (
                i == 0 or not upper[i - 1].isalnum()
            ):
                from_idx = i
                break

        if from_idx == -1:
            return result

        select_part = sql[:from_idx]
        rest = sql[from_idx + 5 :]

        # Parse selected columns.
        columns_str = select_part.replace("SELECT", "", 1).strip()
        # Split by commas, but be tolerant of newlines and spaces.
        for raw_col in self._split_columns(columns_str):
            alias: str | None = None
            name = raw_col
            table = ""
            agg: str | None = None
            # Strip AS clause.
            as_match = re.search(r"\s+AS\s+(.+)$", name, re.IGNORECASE)
            if as_match:
                alias = self._strip_brackets(as_match.group(1).strip())
                name = name[: as_match.start()].strip()
            # Detect aggregate expression: AGG([table].[column]) or AGG([column]).
            agg_match = re.match(r"^(SUM|AVG|MIN|MAX|COUNT)\s*\((.*)\)$", name.strip(), re.IGNORECASE)
            if agg_match:
                agg = agg_match.group(1).upper()
                name = agg_match.group(2).strip()
            # Strip a leading plain table prefix from a simple column reference.
            # Leave complex expressions (e.g. CASE WHEN Tab.Col ... ) untouched
            # so they remain custom columns with table="".
            dot_match = re.match(r"^\[?([A-Za-z_][A-Za-z0-9_]*)\]?\.(.*)$", name)
            if dot_match:
                clean_table = self._strip_brackets(dot_match.group(1).strip())
                rest_name = dot_match.group(2).strip()
                rest_clean = self._strip_brackets(rest_name)
                if (
                    re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", clean_table)
                    and re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", rest_clean)
                ):
                    table = clean_table
                    name = rest_name
            elif "." in name:
                # Unbracketed "Table.Column" references: strip the prefix only when
                # both sides are plain identifiers.
                table_part, _, name_part = name.partition(".")
                clean_table = table_part.strip()
                clean_name = name_part.strip()
                if (
                    re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", clean_table)
                    and re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", clean_name)
                ):
                    table = clean_table
                    name = clean_name
            name = self._strip_brackets(name.strip())
            if agg:
                # Aggregated expressions are stored as custom columns so that a
                # simple column with the same base name (e.g. Celkem) is not
                # mistakenly selected as a table column on reload.
                result["selected_columns"].append(
                    {"table": "", "name": raw_col, "alias": alias or name}
                )
                result.setdefault("aggregations", {})[f"{table}.{name}"] = agg
            else:
                result["selected_columns"].append(
                    {"table": table, "name": name, "alias": alias or ""}
                )

        # Parse FROM and JOINs iteratively.
        join_keywords = [
            "LEFT OUTER JOIN", "RIGHT OUTER JOIN", "FULL OUTER JOIN",
            "INNER JOIN", "LEFT JOIN", "RIGHT JOIN", "FULL JOIN", "JOIN",
        ]
        # Find first JOIN keyword to separate primary table from joins.
        first_join_idx = -1
        for kw in join_keywords:
            idx = self._find_keyword(rest, kw)
            if idx != -1 and (first_join_idx == -1 or idx < first_join_idx):
                first_join_idx = idx

        if first_join_idx == -1:
            primary_table_str = rest.strip()
            result["primary_table"], base = self._parse_source_alias(primary_table_str)
            if base != result["primary_table"]:
                result.setdefault("table_aliases", {})[result["primary_table"]] = base
            return result

        primary_table_str = rest[:first_join_idx].strip()
        result["primary_table"], base = self._parse_source_alias(primary_table_str)
        if base != result["primary_table"]:
            result.setdefault("table_aliases", {})[result["primary_table"]] = base

        remaining = rest[first_join_idx:]
        while remaining:
            join_type = ""
            start = -1
            for kw in join_keywords:
                if remaining.upper().startswith(kw):
                    join_type = kw.replace(" JOIN", "")
                    start = len(kw)
                    break
            if start == -1:
                break
            remaining = remaining[start:].lstrip()
            # Find next JOIN keyword or clause end.
            next_idx = -1
            for kw in join_keywords:
                idx = self._find_keyword(remaining, kw)
                if idx != -1 and (next_idx == -1 or idx < next_idx):
                    next_idx = idx
            for kw in ["WHERE", "ORDER BY", "GROUP BY", "HAVING"]:
                idx = self._find_keyword(remaining, kw)
                if idx != -1 and (next_idx == -1 or idx < next_idx):
                    next_idx = idx
            join_segment = remaining if next_idx == -1 else remaining[:next_idx]
            remaining = "" if next_idx == -1 else remaining[next_idx:]

            # Split join_segment into table part and ON condition.
            on_split = re.split(r"\bON\b", join_segment, flags=re.IGNORECASE)
            if len(on_split) < 2:
                continue
            table_part = on_split[0].strip()
            cond = self._strip_outer_parentheses(on_split[1].strip())
            tokens = table_part.split(None, 1)
            right_table_raw = self._strip_brackets(tokens[0])
            right_table = right_table_raw
            # The bracket stripper only removes balanced pairs; a stray '(' from an
            # unbracketed table name followed by artifacts can remain. Clean it up.
            right_table = right_table.replace("(", "").replace(")", "").strip()
            if right_table_raw.startswith("("):
                alias_match = re.search(r"\)\s+AS\s+(.+)$", table_part, re.IGNORECASE)
                if alias_match:
                    right_table = self._strip_brackets(alias_match.group(1).strip())
                else:
                    alias_match = re.search(r"\)\s+([A-Za-z_][A-Za-z0-9_]*)$", table_part, re.IGNORECASE)
                    if alias_match:
                        right_table = alias_match.group(1).strip()
            else:
                # Plain table on the right side; may carry an alias "[base] AS [alias]".
                right_table, base = self._parse_source_alias(table_part)
                if base != right_table:
                    result.setdefault("table_aliases", {})[right_table] = base

            key_pairs: list[dict[str, str]] = []
            parsed_join_tables: set[str] = {result["primary_table"].lower(), right_table.lower()}
            for raw_part in cond.split(" AND "):
                part = self._strip_outer_parentheses(raw_part.strip())
                eq_match = re.search(r"(.+?)\s*=\s*(.+)", part)
                if not eq_match:
                    continue
                left = self._strip_brackets(eq_match.group(1).strip())
                right = self._strip_brackets(eq_match.group(2).strip())
                left_table, _, left_col = left.rpartition(".")
                right_table, _, right_col = right.rpartition(".")
                if not left_col or not right_col:
                    continue
                # Determine which side belongs to the primary/right table.
                if left_table and right_table and right_table.lower() == result["primary_table"].lower():
                    left_col, right_col = right_col, left_col
                if (
                    left_table
                    and right_table
                    and left_table.lower() not in parsed_join_tables
                    and right_table.lower() not in parsed_join_tables
                ):
                    continue
                if left_table and left_table.lower() not in parsed_join_tables:
                    left_table, left_col, right_table, right_col = right_table, right_col, left_table, left_col
                key_pairs.append({"left_column": left_col, "right_column": right_col})
            if key_pairs:
                result["joins"].append(
                    {
                        "left_table": result["primary_table"],
                        "right_table": right_table,
                        "join_type": join_type,
                        "key_pairs": key_pairs,
                    }
                )

        # Parse GROUP BY and ORDER BY from the remainder (after WHERE if present).
        if remaining:
            where_match = re.search(r"\bWHERE\b", remaining, re.IGNORECASE)
            after_where = remaining[where_match.end():] if where_match else remaining

            group_match = re.search(
                r"\bGROUP\s+BY\b(.*?)((?:\bORDER\s+BY\b)|(?:\bHAVING\b)|$)",
                after_where,
                re.IGNORECASE,
            )
            if group_match:
                for raw in self._split_columns(group_match.group(1)):
                    table, _, col = raw.rpartition(".")
                    table = self._strip_brackets(table) if table else result["primary_table"]
                    col = self._strip_brackets(col)
                    if col:
                        result["group_by"].append({"table": table, "column": col})

            order_match = re.search(
                r"\bORDER\s+BY\b(.*?)((?:\bHAVING\b)|$)",
                after_where,
                re.IGNORECASE,
            )
            if order_match:
                for raw in self._split_columns(order_match.group(1)):
                    desc = bool(re.search(r"\bDESC\s*$", raw, re.IGNORECASE))
                    clean = re.sub(r"\b(ASC|DESC)\s*$", "", raw, flags=re.IGNORECASE).strip()
                    # Detect aggregate expression in ORDER BY.
                    agg_match = re.match(r"^(SUM|AVG|MIN|MAX|COUNT)\s*\((.*)\)$", clean, re.IGNORECASE)
                    aggregation = ""
                    if agg_match:
                        aggregation = agg_match.group(1).upper()
                        clean = agg_match.group(2).strip()
                    table, _, col = clean.rpartition(".")
                    table = self._strip_brackets(table) if table else result["primary_table"]
                    col = self._strip_brackets(col)
                    if col:
                        entry = {"table": table, "column": col, "desc": desc}
                        if aggregation:
                            entry["aggregation"] = aggregation
                        result["order_by"].append(entry)

        return result

    def _find_keyword(self, text: str, keyword: str) -> int:
        """Return the index of a whole-word keyword in text, case-insensitive."""
        pattern = r"(?i)\b" + re.escape(keyword) + r"\b"
        match = re.search(pattern, text)
        return match.start() if match else -1

    def _split_columns(self, columns_str: str) -> list[str]:
        """Split a SELECT column list by top-level commas."""
        parts: list[str] = []
        depth = 0
        bracket_depth = 0
        current = ""
        for ch in columns_str:
            if ch == "[":
                bracket_depth += 1
            elif ch == "]":
                bracket_depth = max(0, bracket_depth - 1)
            elif ch == "(":
                depth += 1
            elif ch == ")":
                depth = max(0, depth - 1)
            elif ch == "," and depth == 0 and bracket_depth == 0:
                parts.append(current.strip())
                current = ""
                continue
            current += ch
        if current.strip():
            parts.append(current.strip())
        return parts


    def _decode_view_note(self, value: str) -> dict[str, Any]:
        """Decode Poznamka; fall back to plain text as description."""
        import json

        if not value or not value.strip():
            return {}
        text = value.strip()
        if text.startswith("{"):
            try:
                parsed = json.loads(text)
                if isinstance(parsed, dict):
                    return parsed
            except json.JSONDecodeError:
                pass
        return {"description": text}

    def _connector_id(self, payload: dict[str, Any] | None = None) -> int | None:
        """Return the connector id from payload or from the service instance."""
        if payload is not None:
            payload_id = payload.get("connector_id")
            if payload_id is not None:
                return int(payload_id)
        return getattr(self.connector, "id", None)

    def _encode_view_note(self, payload: dict[str, Any]) -> str:
        """Encode description, where clauses and joins into a JSON note for Poznamka."""
        import json

        note = {
            "description": (payload.get("description") or "").strip(),
            "primary_table": (payload.get("primary_table") or "").strip(),
            "where_clauses": payload.get("where_clauses") or [],
            "joins": payload.get("joins") or [],
            "subviews": payload.get("subviews") or [],
            "custom_columns": payload.get("custom_columns") or [],
            "group_by": payload.get("group_by") or [],
            "order_by": payload.get("order_by") or [],
            "aggregations": payload.get("aggregations") or {},
            "table_aliases": payload.get("table_aliases") or {},
            "api_enabled": bool(payload.get("api_enabled")),
            "api_put_enabled": bool(payload.get("api_put_enabled")),
            "api_type": (payload.get("api_type") or "flat").strip(),
            "connector_id": self._connector_id(payload),
        }
        return json.dumps(note, ensure_ascii=False)

    def _note_owned_by_connector(self, note_value: Any) -> bool:
        """Return True if the decoded note belongs to the current connector."""
        if self._connector_id() is None:
            return True
        note = self._decode_view_note(note_value or "")
        note_connector_id = note.get("connector_id")
        if note_connector_id is None:
            # Legacy views without connector_id are visible to all connectors
            # using the same DB user for backwards compatibility.
            return True
        return note_connector_id == self._connector_id()

    def _next_cislo(self) -> int:
        """Return next Cislo for user views, kept below the Helios reserved range.

        System/user views in Helios use Cislo < 10000. Anything above that range
        belongs to a different Helios concept, so we cap at 9999 and reuse gaps
        when the sequence would otherwise overflow.
        """
        sql = "SELECT MAX(Cislo) AS m FROM dbo.TabObecnyPrehled WHERE Cislo < 10000"
        with _conn_with_cursor(self.connector) as (_conn, cur):
            try:
                cur.execute(sql)
                row = cur.fetchone()
                next_value = (row[0] or 0) + 1 if row else 1
                return min(next_value, 9999)
            except pyodbc.Error:
                return 1

    def list_saved_views(self) -> list[dict[str, Any]]:
        """Return user-created rows from TabObecnyPrehled for this connector."""
        columns = self._tab_obecny_prehled_columns()
        if not columns:
            return []
        wanted = [c for c in ["ID", "NazevSys", "Nazev", "DefView", "Autor", "DatPorizeni", "Systemovy", "Poznamka"] if c in columns]
        conditions: list[str] = []
        params: list[Any] = []
        if "Systemovy" in columns:
            conditions.append("Systemovy = 0")
        if "Autor" in columns:
            conditions.append("Autor = ?")
            params.append(self.connector.db_user if self.connector else get_settings().DB_USER)
        where = " AND ".join(conditions)
        if where:
            where = "WHERE " + where
        sql = (
            f"SELECT {', '.join(self._qi(c) for c in wanted)} "
            f"FROM dbo.TabObecnyPrehled {where} ORDER BY ID DESC"
        )
        with _conn_with_cursor(self.connector) as (_conn, cur):
            try:
                cur.execute(sql, tuple(params))
                rows = _fetchall_as_dicts(cur)
            except pyodbc.Error as exc:
                raise DatabaseError(f"Nelze načíst uložené views: {exc}") from exc
        return [r for r in rows if self._note_owned_by_connector(r.get("Poznamka"))]
