"""MSSQL (SQL Server) dialect – zachovává stávající chování."""

from __future__ import annotations

import contextlib

import pyodbc

from src.web.dialects.base import SourceDialect


class MSSQLDialect(SourceDialect):
    name = "mssql"
    error_class = pyodbc.Error
    param_placeholder = "?"

    @contextlib.contextmanager
    def connect(self, connector=None, settings=None):
        if settings is None:
            from src.web.config import get_settings

            settings = get_settings()
        if connector is not None:
            driver = connector.db_driver or "ODBC Driver 17 for SQL Server"
            host = connector.db_host
            port = connector.db_port
            database = connector.db_name
            user = connector.db_user
            password = connector.db_password
        else:
            driver = settings.DB_DRIVER or "ODBC Driver 17 for SQL Server"
            host = settings.DB_HOST
            port = settings.DB_PORT
            database = settings.DB_NAME
            user = settings.DB_USER
            password = settings.DB_PASSWORD
        conn_str = (
            f"DRIVER={{{driver}}};"
            f"SERVER={host},{port};"
            f"DATABASE={database};"
            f"UID={user};"
            f"PWD={password};"
            "Timeout=30;"
        )
        conn = pyodbc.connect(conn_str)
        try:
            yield conn
        finally:
            conn.close()

    def quote_identifier(self, name: str) -> str:
        return "[" + name.replace("]", "]]") + "]"

    def list_tables_sql(self) -> str:
        return """
            SELECT name AS system_name,
                   CASE WHEN type = 'U' THEN 'table' ELSE 'view' END AS kind
            FROM sys.objects
            WHERE type IN ('U', 'V')
              AND is_ms_shipped = 0
              AND name NOT LIKE 'sys%'
            ORDER BY kind, name
        """

    def list_tables_via_tabobecny_prehled(self) -> bool:
        return True

    def table_exists_sql(self, name: str) -> str:
        return "SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(?) AND type IN ('U', 'V')"

    def index_columns_sql(self) -> str:
        return """
            SELECT c.name
            FROM sys.indexes i
            JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
            JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
            JOIN sys.objects o ON i.object_id = o.object_id
            WHERE o.name = ? AND i.is_hypothetical = 0 AND i.type > 0
        """

    def type_family(self, raw_type_code, sample):
        from src.web.db import _guess_type, _is_integer_sql_type, _is_text_sql_type

        return _guess_type(raw_type_code, sample), _is_integer_sql_type(raw_type_code), _is_text_sql_type(raw_type_code)

    def display_type_name(self, raw_type_code, sample=None):
        from src.web.db import _sql_type_name

        return _sql_type_name(raw_type_code, sample)
