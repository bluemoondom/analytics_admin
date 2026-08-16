"""PostgreSQL dialekt (psycopg2 / psycopg).  Driver se importuje líně."""

from __future__ import annotations

import contextlib

from src.web.dialects.base import SourceDialect


class PostgreSQLDialect(SourceDialect):
    name = "postgresql"
    error_class = Exception
    param_placeholder = "%s"

    @contextlib.contextmanager
    def connect(self, connector=None, settings=None):
        try:
            import psycopg2  # type: ignore
        except ModuleNotFoundError:
            try:
                import psycopg as psycopg2  # type: ignore  # psycopg3
            except ModuleNotFoundError as exc:
                raise RuntimeError(
                    "Chybí balíček „psycopg2-binaryˮ (pip install psycopg2-binary) – potřebný pro PostgreSQL konektor."
                ) from exc
        self.error_class = psycopg2.Error  # type: ignore[attr-defined]
        if settings is None:
            from src.web.config import get_settings

            settings = get_settings()
        host = connector.db_host if connector else settings.DB_HOST
        port = int(connector.db_port if connector else settings.DB_PORT)
        database = connector.db_name if connector else settings.DB_NAME
        user = connector.db_user if connector else settings.DB_USER
        password = connector.db_password if connector else settings.DB_PASSWORD
        conn = psycopg2.connect(
            host=host, port=port, dbname=database, user=user, password=password,
            connect_timeout=30,
        )
        try:
            yield conn
        finally:
            conn.close()

    def quote_identifier(self, name: str) -> str:
        return '"' + name.replace('"', '""') + '"'

    def limit_rows_sql(self, table_ref: str, n: int = 1) -> str:
        return f"SELECT * FROM {table_ref} LIMIT {n}"

    def try_cast_to_float(self, expr: str) -> str:
        return f"CAST({expr} AS DOUBLE PRECISION)"

    def list_tables_sql(self) -> str:
        return (
            "SELECT table_name AS system_name, "
            "CASE WHEN table_type = 'VIEW' THEN 'view' ELSE 'table' END AS kind "
            "FROM information_schema.tables "
            "WHERE table_schema NOT IN ('pg_catalog', 'information_schema') "
            "ORDER BY kind, table_schema, system_name"
        )

    def table_exists_sql(self, name: str) -> str:
        return (
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_name = %s AND table_schema NOT IN ('pg_catalog', 'information_schema')"
        )

    def index_columns_sql(self) -> str:
        return (
            "SELECT a.attname AS column_name FROM pg_index i "
            "JOIN pg_class t ON t.oid = i.indrelid "
            "JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) "
            "WHERE t.relname = %s"
        )

    def type_family(self, raw_type_code, sample):
        import datetime

        if isinstance(sample, bool):
            return "text", False, False
        if isinstance(sample, (int, float)):
            return "number", True, False
        if isinstance(sample, (datetime.datetime, datetime.date, datetime.time)):
            return "date", False, False
        from src.web.db import _is_text_sql_type

        return "text", False, _is_text_sql_type(raw_type_code)

    def display_type_name(self, raw_type_code, sample=None):
        import datetime

        if isinstance(sample, bool):
            return "BOOLEAN"
        if isinstance(sample, int):
            return "BIGINT"
        if isinstance(sample, float):
            return "DOUBLE PRECISION"
        if isinstance(sample, (datetime.datetime, datetime.date)):
            return "TIMESTAMP"
        return "VARCHAR"
