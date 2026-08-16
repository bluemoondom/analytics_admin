"""MySQL dialekt (pymysql / mysqlclient).  Driver se importuje líně,
takže instalace je volitelná."""

from __future__ import annotations

import contextlib

from src.web.dialects.base import SourceDialect


class MySQLDialect(SourceDialect):
    name = "mysql"
    # ``error_class`` is resolved lazily inside ``connect`` because the driver
    # is optional.
    error_class = Exception
    param_placeholder = "%s"

    @contextlib.contextmanager
    def connect(self, connector=None, settings=None):
        try:
            import pymysql  # type: ignore
        except ModuleNotFoundError:
            try:
                import MySQLdb as pymysql  # type: ignore
            except ModuleNotFoundError as exc:
                raise RuntimeError(
                    "Chybí balíček „pymysqlˮ (pip install pymysql) – potřebný pro MySQL konektor."
                ) from exc
        self.error_class = pymysql.Error  # type: ignore[attr-defined]
        if settings is None:
            from src.web.config import get_settings

            settings = get_settings()
        host = connector.db_host if connector else settings.DB_HOST
        port = int(connector.db_port if connector else settings.DB_PORT)
        database = connector.db_name if connector else settings.DB_NAME
        user = connector.db_user if connector else settings.DB_USER
        password = connector.db_password if connector else settings.DB_PASSWORD
        conn = pymysql.connect(
            host=host, port=port, database=database, user=user, password=password,
            charset="utf8mb4", connect_timeout=30,
        )
        try:
            yield conn
        finally:
            conn.close()

    def quote_identifier(self, name: str) -> str:
        return "`" + name.replace("`", "``") + "`"

    def limit_rows_sql(self, table_ref: str, n: int = 1) -> str:
        return f"SELECT * FROM {table_ref} LIMIT {n}"

    def try_cast_to_float(self, expr: str) -> str:
        return f"CAST({expr} AS DOUBLE PRECISION)"

    def list_tables_sql(self) -> str:
        return (
            "SELECT table_name AS system_name, "
            "CASE WHEN table_type = 'VIEW' THEN 'view' ELSE 'table' END AS kind "
            "FROM information_schema.tables "
            "WHERE table_schema = DATABASE() "
            "ORDER BY kind, system_name"
        )

    def table_exists_sql(self, name: str) -> str:
        return (
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_schema = DATABASE() AND table_name = ?"
        )

    def index_columns_sql(self) -> str:
        return (
            "SELECT column_name FROM information_schema.statistics "
            "WHERE table_schema = DATABASE() AND table_name = %s"
        )

    def type_family(self, raw_type_code, sample):
        from src.web.db import _is_text_sql_type

        # pymysql/mysqlclient deliver Python types in the description code
        # column for many drivers; fall back to the sample value.
        if isinstance(sample, (int, float)) and not isinstance(sample, bool):
            return "number", True, False
        import datetime

        if isinstance(sample, (datetime.datetime, datetime.date, datetime.time)):
            return "date", False, False
        return "text", False, _is_text_sql_type(raw_type_code)

    def display_type_name(self, raw_type_code, sample=None):
        import datetime

        if isinstance(sample, bool):
            return "TINYINT"
        if isinstance(sample, int):
            return "BIGINT"
        if isinstance(sample, float):
            return "DOUBLE"
        if isinstance(sample, (datetime.datetime, datetime.date)):
            return "DATETIME"
        return "VARCHAR"
