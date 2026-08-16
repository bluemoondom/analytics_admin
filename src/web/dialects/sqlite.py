"""SQLite dialekt – používá stdlib sqlite3, databáze je soubor.

Pro SQLite se u databázového pole (``db_name``) očekává cesta k .sqlite nebo
.db souboru.  Host/port se ignorují.  Index metadata lze číst pomocí
PRAGMA index_list / index_info; TabObecnyPrehled není podporováno.
"""

from __future__ import annotations

import contextlib
import datetime
import decimal
import os
import sqlite3

from src.web.dialects.base import SourceDialect


class SQLiteDialect(SourceDialect):
    name = "sqlite"
    error_class = sqlite3.Error
    param_placeholder = "?"

    @contextlib.contextmanager
    def connect(self, connector=None, settings=None):
        # SQLite databases are files; host/port are ignored.  The path is read
        # from ``db_name`` (e.g. "/data/my.sqlite3").
        path = os.path.abspath(connector.db_name if connector else settings.DB_NAME)
        conn = sqlite3.connect(path)
        conn.row_factory = None
        try:
            yield conn
        finally:
            conn.close()

    def quote_identifier(self, name: str) -> str:
        return '"' + name.replace('"', '""') + '"'

    def limit_rows_sql(self, table_ref: str, n: int = 1) -> str:
        return f"SELECT * FROM {table_ref} LIMIT {n}"

    def try_cast_to_float(self, expr: str) -> str:
        return f"CAST({expr} AS REAL)"

    def list_tables_sql(self) -> str:
        return (
            "SELECT name AS system_name, "
            "CASE WHEN type = 'view' THEN 'view' ELSE 'table' END AS kind "
            "FROM sqlite_master "
            "WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' "
            "ORDER BY kind, name"
        )

    def table_exists_sql(self, name: str) -> str:
        return (
            "SELECT 1 FROM sqlite_master WHERE name = ? AND type IN ('table', 'view')"
        )

    def index_columns_sql(self) -> str:
        # Return indexed column names; uses sqlite_master + pragmas joined in the
        # caller, because pragma parameters are not supported.  The caller queries
        # a flattened list created by querying sqlite_master + pragma_index_info.
        return ""

    def index_columns(self, conn, table_name: str) -> set[str]:
        """Return the set of indexed column names on a table (SQLite)."""
        indexes: set[str] = set()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?",
                    (table_name,),
                )
                for (idx_name,) in cur.fetchall():
                    try:
                        cur.execute(f"PRAGMA index_info({idx_name!r})")
                    except sqlite3.Error:
                        continue
                    for row in cur.fetchall():
                        # PRAGMA index_info(...) -> [seqno, cid, name]
                        if row and row[2]:
                            indexes.add(str(row[2]))
        except sqlite3.Error:
            pass
        return indexes

    def type_family(self, raw_type_code, sample):
        from src.web.db import _is_integer_sql_type, _is_text_sql_type

        if _is_integer_sql_type(raw_type_code) or isinstance(sample, (int, float, decimal.Decimal)) and not isinstance(sample, bool):
            return "number", True, False
        if isinstance(sample, (datetime.datetime, datetime.date, datetime.time)):
            return "date", False, False
        family = "text"
        return family, False, _is_text_sql_type(raw_type_code)

    def display_type_name(self, raw_type_code, sample=None):
        if isinstance(sample, bool):
            return "INTEGER"
        if isinstance(sample, int):
            return "INTEGER"
        if isinstance(sample, float):
            return "REAL"
        if isinstance(sample, (datetime.datetime, datetime.date)):
            return "TEXT"
        return "TEXT"
