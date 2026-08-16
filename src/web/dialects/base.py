"""Base datadialekt pro zdrojové (analytické) databáze.

Každá databáze poskytuje vlastní implementaci třídy `SourceDialect` popisující
připojení a SQL syntaxovou detaily (quoting identifikátorů, omezení řádek TOP/LIMIT,
metadatové dotazy, zobrazení typů, vyhledání indexů, ...).  Funkce, které databáze
nepodporuje (např. index discovery), se nezobrazují, místo toho se vrací prázdné
hodnoty.
"""

from __future__ import annotations

import contextlib
from typing import Any


class SourceDialect:
    """Per-database behavior for a source (analytical) database.

    Concrete dialects override the metadata queries, identifier quoting, row
    limiting and the ability to map a raw DB-API type to the simplified
    "text / number / date" families.
    """

    name = "base"
    # DB-API exception class used to detect SQL errors (set by subclasses).
    error_class: type[Exception] = Exception
    # Paramstyle placeholder ("?" for pyodbc/sqlite3, "%s" for psycopg2/pymysql).
    param_placeholder = "?"

    # ------------------------------------------------------------------
    # Connection
    # ------------------------------------------------------------------
    @contextlib.contextmanager
    def connect(self, connector=None, settings=None):
        """Yield a DB-API connection for the given connector.

        ``connector`` is a :class:`src.web.models.user.Connector` or ``None``;
        when ``None`` the global ``settings`` (.env) fields are used.
        """
        raise NotImplementedError

    @contextlib.contextmanager
    def cursor(self, conn):
        """Yield a cursor from ``conn`` and clean it up afterwards.

        pyodbc cursors support the context manager protocol; sqlite3,
        pymysql and psycopg2 cursors do not.  We use whichever mechanism the
        driver offers and tolerate the absence of either.
        """
        cur = conn.cursor()
        try:
            yield cur
        finally:
            close = getattr(cur, "close", None)
            if callable(close):
                try:
                    close()
                except self.error_class:
                    pass

    # ------------------------------------------------------------------
    # SQL fragment helpers
    # ------------------------------------------------------------------
    def quote_identifier(self, name: str) -> str:
        """Quote a single identifier (default [SQL-Server brackets])."""
        return "[" + name.replace("]", "]]") + "]"

    def limit_rows_sql(self, table_ref: str, n: int = 1) -> str:
        """Return a SELECT statement restricting the result to ``n`` rows."""
        return f"SELECT TOP {n} * FROM {table_ref}"

    def limit_first_row_sql(self, table_ref: str) -> str:
        """Return a SELECT statement for a single row."""
        return self.limit_rows_sql(table_ref, 1)

    def try_cast_to_float(self, expr: str) -> str:
        """Return a dialect-safe numeric cast expression for aggregates."""
        return f"TRY_CAST({expr} AS FLOAT)"

    # ------------------------------------------------------------------
    # Metadata queries
    # ------------------------------------------------------------------
    def list_tables_sql(self) -> str:
        """Return SQL listing user tables and views (columns: name, kind)."""
        raise NotImplementedError

    def list_tables_via_tabobecny_prehled(self) -> bool:
        """Whether this dialect can read the Helios TabObecnyPrehled table."""
        return False

    def table_exists_sql(self, name: str) -> str:
        """Return SQL checking for the existence of a table/view."""
        raise NotImplementedError

    def index_columns_sql(self) -> str:
        """Return SQL listing indexed column names (parameterised with table).

        Dialects that cannot read index metadata return an empty string, in
        which case index discovery is skipped (no indexes shown in the UI).
        """
        return ""

    # ------------------------------------------------------------------
    # Type mapping / display
    # ------------------------------------------------------------------
    def type_family(
        self, raw_type_code: Any, sample: Any
    ) -> tuple[str, bool, bool]:
        """Return (family, is_integer, is_text_storage) for a column.

        ``raw_type_code`` is the second element of ``cursor.description``
        whose meaning differs per driver; ``sample`` is a value from the first
        fetched row (may be ``None``).
        """
        from src.web.db import _is_integer_sql_type, _is_text_sql_type

        family = "text"
        if _is_integer_sql_type(raw_type_code):
            family = "number"
        return family, _is_integer_sql_type(raw_type_code), _is_text_sql_type(raw_type_code)

    def display_type_name(self, raw_type_code: Any, sample: Any | None = None) -> str:
        """Return the displayed type label (INT, VARCHAR, TEXT, ...)."""
        return "VARCHAR"
