"""Persistent storage for users, connectors, sessions and magic link tokens."""

from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any

import pymssql

from src.web.config import get_settings
from src.web.models.user import Connector, User, UserRole
from src.web.services.encryption import decrypt, encrypt


class UserStorageError(Exception):
    """Raised when a user storage operation fails."""


class UserStorage:
    """Backend-agnostic storage for users, connectors and auth tokens."""

    def __init__(self) -> None:
        self.backend = get_settings().DASHBOARD_STORAGE_BACKEND
        if self.backend == "mssql":
            self._ensure_mssql_tables()
        else:
            self._ensure_sqlite_tables()

    # ------------------------------------------------------------------
    # SQLite backend
    # ------------------------------------------------------------------
    def _ensure_sqlite_tables(self) -> None:
        path = os.path.abspath(get_settings().DASHBOARD_DB_PATH)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with sqlite3.connect(path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email TEXT NOT NULL UNIQUE,
                    role TEXT NOT NULL DEFAULT 'user',
                    is_active INTEGER NOT NULL DEFAULT 1,
                    connector_id INTEGER,
                    created_at TEXT,
                    updated_at TEXT
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS connectors (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    name TEXT NOT NULL,
                    db_type TEXT NOT NULL DEFAULT 'mssql',
                    db_host TEXT NOT NULL,
                    db_port INTEGER NOT NULL DEFAULT 1433,
                    db_name TEXT NOT NULL,
                    db_user TEXT NOT NULL,
                    db_password TEXT NOT NULL,
                    db_driver TEXT NOT NULL DEFAULT 'ODBC Driver 17 for SQL Server',
                    view_discovery_mode TEXT NOT NULL DEFAULT 'tabobecny_prehled',
                    api_tenant TEXT NOT NULL DEFAULT '',
                    api_key TEXT NOT NULL DEFAULT '',
                    api_key_header TEXT NOT NULL DEFAULT 'X-API-Key',
                    api_allowed_ips TEXT NOT NULL DEFAULT '[]',
                    api_max_requests_per_minute INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT,
                    updated_at TEXT
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS magic_links (
                    token_hash TEXT PRIMARY KEY,
                    email TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    used_at TEXT
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    expires_at TEXT NOT NULL,
                    created_at TEXT
                )
                """
            )
            # Migration: add user_id to connectors if missing.
            try:
                conn.execute("ALTER TABLE connectors ADD COLUMN user_id INTEGER")
            except sqlite3.OperationalError:
                pass
            try:
                conn.execute("ALTER TABLE connectors ADD COLUMN db_type TEXT NOT NULL DEFAULT 'mssql'")
            except sqlite3.OperationalError:
                pass
            self._migrate_encrypt_secrets_sqlite(conn)
            conn.commit()

    def _ensure_mssql_tables(self) -> None:
        # For MSSQL backend we reuse the same dashboards connection.
        settings = get_settings()
        host = settings.DASHBOARD_DB_HOST or settings.DB_HOST
        port = settings.DASHBOARD_DB_PORT or settings.DB_PORT
        database = settings.DASHBOARD_DB_NAME or settings.DB_NAME
        user = settings.DASHBOARD_DB_USER or settings.DB_USER
        password = settings.DASHBOARD_DB_PASSWORD or settings.DB_PASSWORD
        with pymssql.connect(
            server=host,
            port=port,
            database=database,
            user=user,
            password=password,
        ) as conn, conn.cursor() as cur:
            cur.execute(
                """
                IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'users')
                CREATE TABLE users (
                    id INT IDENTITY(1,1) PRIMARY KEY,
                    email NVARCHAR(255) NOT NULL UNIQUE,
                    role NVARCHAR(20) NOT NULL DEFAULT 'user',
                    is_active BIT NOT NULL DEFAULT 1,
                    connector_id INT NULL,
                    created_at DATETIME2 DEFAULT GETUTCDATE(),
                    updated_at DATETIME2 DEFAULT GETUTCDATE()
                )
                """
            )
            cur.execute(
                """
                IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'connectors')
                CREATE TABLE connectors (
                    id INT IDENTITY(1,1) PRIMARY KEY,
                    user_id INT NULL,
                    name NVARCHAR(100) NOT NULL,
                    db_type NVARCHAR(40) NOT NULL DEFAULT 'mssql',
                    db_host NVARCHAR(255) NOT NULL,
                    db_port INT NOT NULL DEFAULT 1433,
                    db_name NVARCHAR(255) NOT NULL,
                    db_user NVARCHAR(100) NOT NULL,
                    db_password NVARCHAR(255) NOT NULL,
                    db_driver NVARCHAR(100) NOT NULL DEFAULT 'ODBC Driver 17 for SQL Server',
                    view_discovery_mode NVARCHAR(50) NOT NULL DEFAULT 'tabobecny_prehled',
                    api_tenant NVARCHAR(50) NOT NULL DEFAULT '',
                    api_key NVARCHAR(255) NOT NULL DEFAULT '',
                    api_key_header NVARCHAR(100) NOT NULL DEFAULT 'X-API-Key',
                    api_allowed_ips NVARCHAR(500) NOT NULL DEFAULT '[]',
                    api_max_requests_per_minute INT NOT NULL DEFAULT 0,
                    created_at DATETIME2 DEFAULT GETUTCDATE(),
                    updated_at DATETIME2 DEFAULT GETUTCDATE()
                )
                """
            )
            cur.execute(
                """
                IF COL_LENGTH('connectors', 'user_id') IS NULL
                ALTER TABLE connectors ADD user_id INT NULL
                """
            )
            cur.execute(
                """
                IF COL_LENGTH('connectors', 'db_type') IS NULL
                ALTER TABLE connectors ADD db_type NVARCHAR(40) NOT NULL DEFAULT 'mssql'
                """
            )
            cur.execute(
                """
                IF COL_LENGTH('connectors', 'db_password') IS NOT NULL
                ALTER TABLE connectors ALTER COLUMN db_password NVARCHAR(500) NOT NULL
                """
            )
            cur.execute(
                """
                IF COL_LENGTH('connectors', 'api_key') IS NOT NULL
                ALTER TABLE connectors ALTER COLUMN api_key NVARCHAR(500) NOT NULL
                """
            )
            cur.execute(
                """
                IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'magic_links')
                CREATE TABLE magic_links (
                    token_hash NVARCHAR(64) PRIMARY KEY,
                    email NVARCHAR(255) NOT NULL,
                    expires_at DATETIME2 NOT NULL,
                    used_at DATETIME2 NULL
                )
                """
            )
            cur.execute(
                """
                IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'sessions')
                CREATE TABLE sessions (
                    token_hash NVARCHAR(64) PRIMARY KEY,
                    user_id INT NOT NULL,
                    expires_at DATETIME2 NOT NULL,
                    created_at DATETIME2 DEFAULT GETUTCDATE()
                )
                """
            )
            self._migrate_encrypt_secrets_mssql(cur)
            conn.commit()

    def _migrate_encrypt_secrets_sqlite(self, conn: sqlite3.Connection) -> None:
        """Encrypt any plaintext db_password / api_key values in SQLite."""
        rows = conn.execute(
            "SELECT id, db_password, api_key FROM connectors"
        ).fetchall()
        for row in rows:
            row_id = row[0]
            db_password = row[1]
            api_key = row[2]
            updates: dict[str, str] = {}
            if db_password and not db_password.startswith("gAAAA"):
                updates["db_password"] = encrypt(db_password)
            if api_key and not api_key.startswith("gAAAA"):
                updates["api_key"] = encrypt(api_key)
            if updates:
                cols = ", ".join(f"{k} = ?" for k in updates)
                params = (*updates.values(), row_id)
                conn.execute(f"UPDATE connectors SET {cols} WHERE id = ?", params)

    def _migrate_encrypt_secrets_mssql(self, cur) -> None:
        """Encrypt any plaintext db_password / api_key values in MSSQL."""
        cur.execute("SELECT id, db_password, api_key FROM connectors")
        rows = cur.fetchall()
        for row in rows:
            db_password = row[1]
            api_key = row[2]
            updates: dict[str, str] = {}
            if db_password and not db_password.startswith("gAAAA"):
                updates["db_password"] = encrypt(db_password)
            if api_key and not api_key.startswith("gAAAA"):
                updates["api_key"] = encrypt(api_key)
            if updates:
                cols = ", ".join(f"{k} = %s" for k in updates)
                params = (*updates.values(), row[0])
                cur.execute(f"UPDATE connectors SET {cols} WHERE id = %s", params)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _now(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    @staticmethod
    def _row_to_user(row: Any) -> User:
        return User(
            id=row["id"],
            email=row["email"],
            role=UserRole(row["role"]),
            is_active=bool(row["is_active"]),
            connector_id=row["connector_id"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    @staticmethod
    def _row_to_connector(row: Any) -> Connector:
        keys = set(row.keys()) if hasattr(row, "keys") else set()
        return Connector(
            id=row["id"],
            user_id=row["user_id"] if row["user_id"] is not None else None,
            name=row["name"],
            db_type=(row["db_type"] if "db_type" in keys and row["db_type"] else "mssql"),
            db_host=row["db_host"],
            db_port=row["db_port"],
            db_name=row["db_name"],
            db_user=row["db_user"],
            db_password=decrypt(row["db_password"]),
            db_driver=row["db_driver"],
            view_discovery_mode=row["view_discovery_mode"],
            api_tenant=row["api_tenant"],
            api_key=decrypt(row["api_key"]),
            api_key_header=row["api_key_header"],
            api_allowed_ips=json.loads(row["api_allowed_ips"] or "[]"),
            api_max_requests_per_minute=row["api_max_requests_per_minute"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    # ------------------------------------------------------------------
    # Users
    # ------------------------------------------------------------------
    def get_user_by_email(self, email: str) -> User | None:
        if self.backend == "mssql":
            return self._get_user_by_email_mssql(email)
        return self._get_user_by_email_sqlite(email)

    def _get_user_by_email_sqlite(self, email: str) -> User | None:
        path = os.path.abspath(get_settings().DASHBOARD_DB_PATH)
        with sqlite3.connect(path) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        return self._row_to_user(row) if row else None

    def _get_user_by_email_mssql(self, email: str) -> User | None:
        settings = get_settings()
        with pymssql.connect(
            server=settings.DASHBOARD_DB_HOST or settings.DB_HOST,
            port=settings.DASHBOARD_DB_PORT or settings.DB_PORT,
            database=settings.DASHBOARD_DB_NAME or settings.DB_NAME,
            user=settings.DASHBOARD_DB_USER or settings.DB_USER,
            password=settings.DASHBOARD_DB_PASSWORD or settings.DB_PASSWORD,
        ) as conn, conn.cursor(as_dict=True) as cur:
            cur.execute("SELECT * FROM users WHERE email = %s", (email,))
            row = cur.fetchone()
        return self._row_to_user(row) if row else None

    def get_user_by_id(self, user_id: int) -> User | None:
        if self.backend == "mssql":
            return self._get_user_by_id_mssql(user_id)
        return self._get_user_by_id_sqlite(user_id)

    def _get_user_by_id_sqlite(self, user_id: int) -> User | None:
        path = os.path.abspath(get_settings().DASHBOARD_DB_PATH)
        with sqlite3.connect(path) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return self._row_to_user(row) if row else None

    def _get_user_by_id_mssql(self, user_id: int) -> User | None:
        settings = get_settings()
        with pymssql.connect(
            server=settings.DASHBOARD_DB_HOST or settings.DB_HOST,
            port=settings.DASHBOARD_DB_PORT or settings.DB_PORT,
            database=settings.DASHBOARD_DB_NAME or settings.DB_NAME,
            user=settings.DASHBOARD_DB_USER or settings.DB_USER,
            password=settings.DASHBOARD_DB_PASSWORD or settings.DB_PASSWORD,
        ) as conn, conn.cursor(as_dict=True) as cur:
            cur.execute("SELECT * FROM users WHERE id = %s", (user_id,))
            row = cur.fetchone()
        return self._row_to_user(row) if row else None

    def create_user(self, email: str, role: UserRole = UserRole.USER, connector_id: int | None = None) -> User:
        if self.backend == "mssql":
            return self._create_user_mssql(email, role, connector_id)
        return self._create_user_sqlite(email, role, connector_id)

    def _create_user_sqlite(self, email: str, role: UserRole, connector_id: int | None) -> User:
        path = os.path.abspath(get_settings().DASHBOARD_DB_PATH)
        now = self._now()
        is_active = 1 if role != UserRole.NEW_ADMIN else 0
        with sqlite3.connect(path) as conn:
            cur = conn.execute(
                "INSERT INTO users (email, role, is_active, connector_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                (email, role.value, is_active, connector_id, now, now),
            )
            conn.commit()
            user_id = cur.lastrowid
        return User(
            id=user_id,
            email=email,
            role=role,
            is_active=bool(is_active),
            connector_id=connector_id,
            created_at=now,
            updated_at=now,
        )

    def _create_user_mssql(self, email: str, role: UserRole, connector_id: int | None) -> User:
        settings = get_settings()
        is_active = role != UserRole.NEW_ADMIN
        with pymssql.connect(
            server=settings.DASHBOARD_DB_HOST or settings.DB_HOST,
            port=settings.DASHBOARD_DB_PORT or settings.DB_PORT,
            database=settings.DASHBOARD_DB_NAME or settings.DB_NAME,
            user=settings.DASHBOARD_DB_USER or settings.DB_USER,
            password=settings.DASHBOARD_DB_PASSWORD or settings.DB_PASSWORD,
        ) as conn, conn.cursor() as cur:
            cur.execute(
                "INSERT INTO users (email, role, is_active, connector_id) OUTPUT INSERTED.id VALUES (%s, %s, %s, %s)",
                (email, role.value, is_active, connector_id),
            )
            user_id = cur.fetchone()[0]
            conn.commit()
        return self.get_user_by_id(user_id) or User(
            id=user_id, email=email, role=role, is_active=is_active, connector_id=connector_id
        )

    def activate_new_admin(self, user_id: int) -> None:
        """Promote a pending new_admin to active admin."""
        if self.backend == "mssql":
            self._activate_new_admin_mssql(user_id)
        else:
            self._activate_new_admin_sqlite(user_id)

    def _activate_new_admin_sqlite(self, user_id: int) -> None:
        path = os.path.abspath(get_settings().DASHBOARD_DB_PATH)
        now = self._now()
        with sqlite3.connect(path) as conn:
            conn.execute(
                "UPDATE users SET role = ?, is_active = 1, updated_at = ? WHERE id = ? AND role = ?",
                (UserRole.ADMIN.value, now, user_id, UserRole.NEW_ADMIN.value),
            )
            conn.commit()

    def _activate_new_admin_mssql(self, user_id: int) -> None:
        settings = get_settings()
        with pymssql.connect(
            server=settings.DASHBOARD_DB_HOST or settings.DB_HOST,
            port=settings.DASHBOARD_DB_PORT or settings.DB_PORT,
            database=settings.DASHBOARD_DB_NAME or settings.DB_NAME,
            user=settings.DASHBOARD_DB_USER or settings.DB_USER,
            password=settings.DASHBOARD_DB_PASSWORD or settings.DB_PASSWORD,
        ) as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE users SET role = %s, is_active = 1, updated_at = GETUTCDATE() WHERE id = %s AND role = %s",
                (UserRole.ADMIN.value, user_id, UserRole.NEW_ADMIN.value),
            )
            conn.commit()

    def list_users(self) -> list[User]:
        if self.backend == "mssql":
            return self._list_users_mssql()
        return self._list_users_sqlite()

    def _list_users_sqlite(self) -> list[User]:
        path = os.path.abspath(get_settings().DASHBOARD_DB_PATH)
        with sqlite3.connect(path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute("SELECT * FROM users ORDER BY id DESC").fetchall()
        return [self._row_to_user(r) for r in rows]

    def _list_users_mssql(self) -> list[User]:
        settings = get_settings()
        with pymssql.connect(
            server=settings.DASHBOARD_DB_HOST or settings.DB_HOST,
            port=settings.DASHBOARD_DB_PORT or settings.DB_PORT,
            database=settings.DASHBOARD_DB_NAME or settings.DB_NAME,
            user=settings.DASHBOARD_DB_USER or settings.DB_USER,
            password=settings.DASHBOARD_DB_PASSWORD or settings.DB_PASSWORD,
        ) as conn, conn.cursor(as_dict=True) as cur:
            cur.execute("SELECT * FROM users ORDER BY id DESC")
            rows = cur.fetchall()
        return [self._row_to_user(r) for r in rows]

    # ------------------------------------------------------------------
    # Connectors
    # ------------------------------------------------------------------
    def create_connector(self, connector: Connector) -> Connector:
        if self.backend == "mssql":
            return self._create_connector_mssql(connector)
        return self._create_connector_sqlite(connector)

    def _create_connector_sqlite(self, connector: Connector) -> Connector:
        path = os.path.abspath(get_settings().DASHBOARD_DB_PATH)
        now = self._now()
        with sqlite3.connect(path) as conn:
            cur = conn.execute(
                """INSERT INTO connectors
                (user_id, name, db_type, db_host, db_port, db_name, db_user, db_password, db_driver,
                 view_discovery_mode, api_tenant, api_key, api_key_header,
                 api_allowed_ips, api_max_requests_per_minute, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    connector.user_id, connector.name, connector.db_type or "mssql",
                    connector.db_host, connector.db_port, connector.db_name,
                    connector.db_user, encrypt(connector.db_password), connector.db_driver,
                    connector.view_discovery_mode, connector.api_tenant, encrypt(connector.api_key),
                    connector.api_key_header, json.dumps(connector.api_allowed_ips),
                    connector.api_max_requests_per_minute, now, now,
                ),
            )
            conn.commit()
            connector.id = cur.lastrowid
        connector.created_at = now
        connector.updated_at = now
        return connector

    def _create_connector_mssql(self, connector: Connector) -> Connector:
        settings = get_settings()
        with pymssql.connect(
            server=settings.DASHBOARD_DB_HOST or settings.DB_HOST,
            port=settings.DASHBOARD_DB_PORT or settings.DB_PORT,
            database=settings.DASHBOARD_DB_NAME or settings.DB_NAME,
            user=settings.DASHBOARD_DB_USER or settings.DB_USER,
            password=settings.DASHBOARD_DB_PASSWORD or settings.DB_PASSWORD,
        ) as conn, conn.cursor() as cur:
            cur.execute(
                """INSERT INTO connectors
                (user_id, name, db_type, db_host, db_port, db_name, db_user, db_password, db_driver,
                 view_discovery_mode, api_tenant, api_key, api_key_header,
                 api_allowed_ips, api_max_requests_per_minute)
                OUTPUT INSERTED.id
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (
                    connector.user_id, connector.name, connector.db_type or "mssql",
                    connector.db_host, connector.db_port, connector.db_name,
                    connector.db_user, encrypt(connector.db_password), connector.db_driver,
                    connector.view_discovery_mode, connector.api_tenant, encrypt(connector.api_key),
                    connector.api_key_header, json.dumps(connector.api_allowed_ips),
                    connector.api_max_requests_per_minute,
                ),
            )
            connector.id = cur.fetchone()[0]
            conn.commit()
        return self.get_connector_by_id(connector.id) or connector

    def get_connector_by_id(self, connector_id: int) -> Connector | None:
        if self.backend == "mssql":
            return self._get_connector_by_id_mssql(connector_id)
        return self._get_connector_by_id_sqlite(connector_id)

    def _get_connector_by_id_sqlite(self, connector_id: int) -> Connector | None:
        path = os.path.abspath(get_settings().DASHBOARD_DB_PATH)
        with sqlite3.connect(path) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute("SELECT * FROM connectors WHERE id = ?", (connector_id,)).fetchone()
        return self._row_to_connector(row) if row else None

    def _get_connector_by_id_mssql(self, connector_id: int) -> Connector | None:
        settings = get_settings()
        with pymssql.connect(
            server=settings.DASHBOARD_DB_HOST or settings.DB_HOST,
            port=settings.DASHBOARD_DB_PORT or settings.DB_PORT,
            database=settings.DASHBOARD_DB_NAME or settings.DB_NAME,
            user=settings.DASHBOARD_DB_USER or settings.DB_USER,
            password=settings.DASHBOARD_DB_PASSWORD or settings.DB_PASSWORD,
        ) as conn, conn.cursor(as_dict=True) as cur:
            cur.execute("SELECT * FROM connectors WHERE id = %s", (connector_id,))
            row = cur.fetchone()
        return self._row_to_connector(row) if row else None

    def list_connectors_for_user(self, user_id: int) -> list[Connector]:
        if self.backend == "mssql":
            return self._list_connectors_for_user_mssql(user_id)
        return self._list_connectors_for_user_sqlite(user_id)

    def _list_connectors_for_user_sqlite(self, user_id: int) -> list[Connector]:
        path = os.path.abspath(get_settings().DASHBOARD_DB_PATH)
        with sqlite3.connect(path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT * FROM connectors WHERE user_id = ? ORDER BY id DESC", (user_id,)
            ).fetchall()
        return [self._row_to_connector(r) for r in rows]

    def _list_connectors_for_user_mssql(self, user_id: int) -> list[Connector]:
        settings = get_settings()
        with pymssql.connect(
            server=settings.DASHBOARD_DB_HOST or settings.DB_HOST,
            port=settings.DASHBOARD_DB_PORT or settings.DB_PORT,
            database=settings.DASHBOARD_DB_NAME or settings.DB_NAME,
            user=settings.DASHBOARD_DB_USER or settings.DB_USER,
            password=settings.DASHBOARD_DB_PASSWORD or settings.DB_PASSWORD,
        ) as conn, conn.cursor(as_dict=True) as cur:
            cur.execute("SELECT * FROM connectors WHERE user_id = %s ORDER BY id DESC", (user_id,))
            rows = cur.fetchall()
        return [self._row_to_connector(r) for r in rows]

    def list_connectors(self) -> list[Connector]:
        if self.backend == "mssql":
            return self._list_connectors_mssql()
        return self._list_connectors_sqlite()

    def _list_connectors_sqlite(self) -> list[Connector]:
        path = os.path.abspath(get_settings().DASHBOARD_DB_PATH)
        with sqlite3.connect(path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute("SELECT * FROM connectors ORDER BY id DESC").fetchall()
        return [self._row_to_connector(r) for r in rows]

    def _list_connectors_mssql(self) -> list[Connector]:
        settings = get_settings()
        with pymssql.connect(
            server=settings.DASHBOARD_DB_HOST or settings.DB_HOST,
            port=settings.DASHBOARD_DB_PORT or settings.DB_PORT,
            database=settings.DASHBOARD_DB_NAME or settings.DB_NAME,
            user=settings.DASHBOARD_DB_USER or settings.DB_USER,
            password=settings.DASHBOARD_DB_PASSWORD or settings.DB_PASSWORD,
        ) as conn, conn.cursor(as_dict=True) as cur:
            cur.execute("SELECT * FROM connectors ORDER BY id DESC")
            rows = cur.fetchall()
        return [self._row_to_connector(r) for r in rows]

    def update_connector(self, connector: Connector) -> Connector | None:
        if self.backend == "mssql":
            return self._update_connector_mssql(connector)
        return self._update_connector_sqlite(connector)

    def _update_connector_sqlite(self, connector: Connector) -> Connector | None:
        if connector.id is None:
            return None
        path = os.path.abspath(get_settings().DASHBOARD_DB_PATH)
        now = self._now()
        with sqlite3.connect(path) as conn:
            conn.execute(
                """UPDATE connectors SET
                    user_id = ?, name = ?, db_type = ?, db_host = ?, db_port = ?, db_name = ?, db_user = ?,
                    db_password = ?, db_driver = ?, view_discovery_mode = ?,
                    api_tenant = ?, api_key = ?, api_key_header = ?,
                    api_allowed_ips = ?, api_max_requests_per_minute = ?, updated_at = ?
                WHERE id = ?""",
                (
                    connector.user_id, connector.name, connector.db_type or "mssql",
                    connector.db_host, connector.db_port, connector.db_name,
                    connector.db_user, encrypt(connector.db_password), connector.db_driver,
                    connector.view_discovery_mode, connector.api_tenant, encrypt(connector.api_key),
                    connector.api_key_header, json.dumps(connector.api_allowed_ips),
                    connector.api_max_requests_per_minute, now, connector.id,
                ),
            )
            conn.commit()
        return self.get_connector_by_id(connector.id)

    def _update_connector_mssql(self, connector: Connector) -> Connector | None:
        if connector.id is None:
            return None
        settings = get_settings()
        with pymssql.connect(
            server=settings.DASHBOARD_DB_HOST or settings.DB_HOST,
            port=settings.DASHBOARD_DB_PORT or settings.DB_PORT,
            database=settings.DASHBOARD_DB_NAME or settings.DB_NAME,
            user=settings.DASHBOARD_DB_USER or settings.DB_USER,
            password=settings.DASHBOARD_DB_PASSWORD or settings.DB_PASSWORD,
        ) as conn, conn.cursor() as cur:
            cur.execute(
                """UPDATE connectors SET
                    user_id = %s, name = %s, db_type = %s, db_host = %s, db_port = %s, db_name = %s, db_user = %s,
                    db_password = %s, db_driver = %s, view_discovery_mode = %s,
                    api_tenant = %s, api_key = %s, api_key_header = %s,
                    api_allowed_ips = %s, api_max_requests_per_minute = %s, updated_at = GETUTCDATE()
                WHERE id = %s""",
                (
                    connector.user_id, connector.name, connector.db_type or "mssql",
                    connector.db_host, connector.db_port, connector.db_name,
                    connector.db_user, encrypt(connector.db_password), connector.db_driver,
                    connector.view_discovery_mode, connector.api_tenant, encrypt(connector.api_key),
                    connector.api_key_header, json.dumps(connector.api_allowed_ips),
                    connector.api_max_requests_per_minute, connector.id,
                ),
            )
            conn.commit()
        return self.get_connector_by_id(connector.id)

    def delete_connector(self, connector_id: int) -> None:
        if self.backend == "mssql":
            self._delete_connector_mssql(connector_id)
        else:
            self._delete_connector_sqlite(connector_id)

    def _delete_connector_sqlite(self, connector_id: int) -> None:
        path = os.path.abspath(get_settings().DASHBOARD_DB_PATH)
        with sqlite3.connect(path) as conn:
            conn.execute("DELETE FROM connectors WHERE id = ?", (connector_id,))
            conn.commit()

    def _delete_connector_mssql(self, connector_id: int) -> None:
        settings = get_settings()
        with pymssql.connect(
            server=settings.DASHBOARD_DB_HOST or settings.DB_HOST,
            port=settings.DASHBOARD_DB_PORT or settings.DB_PORT,
            database=settings.DASHBOARD_DB_NAME or settings.DB_NAME,
            user=settings.DASHBOARD_DB_USER or settings.DB_USER,
            password=settings.DASHBOARD_DB_PASSWORD or settings.DB_PASSWORD,
        ) as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM connectors WHERE id = %s", (connector_id,))
            conn.commit()

    def update_user_connector(self, user_id: int, connector_id: int | None) -> None:
        if self.backend == "mssql":
            self._update_user_connector_mssql(user_id, connector_id)
        else:
            self._update_user_connector_sqlite(user_id, connector_id)

    def _update_user_connector_sqlite(self, user_id: int, connector_id: int | None) -> None:
        path = os.path.abspath(get_settings().DASHBOARD_DB_PATH)
        now = self._now()
        with sqlite3.connect(path) as conn:
            conn.execute(
                "UPDATE users SET connector_id = ?, updated_at = ? WHERE id = ?",
                (connector_id, now, user_id),
            )
            conn.commit()

    def _update_user_connector_mssql(self, user_id: int, connector_id: int | None) -> None:
        settings = get_settings()
        with pymssql.connect(
            server=settings.DASHBOARD_DB_HOST or settings.DB_HOST,
            port=settings.DASHBOARD_DB_PORT or settings.DB_PORT,
            database=settings.DASHBOARD_DB_NAME or settings.DB_NAME,
            user=settings.DASHBOARD_DB_USER or settings.DB_USER,
            password=settings.DASHBOARD_DB_PASSWORD or settings.DB_PASSWORD,
        ) as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE users SET connector_id = %s, updated_at = GETUTCDATE() WHERE id = %s",
                (connector_id, user_id),
            )
            conn.commit()

    # ------------------------------------------------------------------
    # Magic links
    # ------------------------------------------------------------------
    def save_magic_link(self, token_hash: str, email: str, expires_at: datetime) -> None:
        if self.backend == "mssql":
            self._save_magic_link_mssql(token_hash, email, expires_at)
        else:
            self._save_magic_link_sqlite(token_hash, email, expires_at)

    def _save_magic_link_sqlite(self, token_hash: str, email: str, expires_at: datetime) -> None:
        path = os.path.abspath(get_settings().DASHBOARD_DB_PATH)
        with sqlite3.connect(path) as conn:
            conn.execute(
                "INSERT INTO magic_links (token_hash, email, expires_at) VALUES (?, ?, ?)",
                (token_hash, email, expires_at.isoformat()),
            )
            conn.commit()

    def _save_magic_link_mssql(self, token_hash: str, email: str, expires_at: datetime) -> None:
        settings = get_settings()
        with pymssql.connect(
            server=settings.DASHBOARD_DB_HOST or settings.DB_HOST,
            port=settings.DASHBOARD_DB_PORT or settings.DB_PORT,
            database=settings.DASHBOARD_DB_NAME or settings.DB_NAME,
            user=settings.DASHBOARD_DB_USER or settings.DB_USER,
            password=settings.DASHBOARD_DB_PASSWORD or settings.DB_PASSWORD,
        ) as conn, conn.cursor() as cur:
            cur.execute(
                "INSERT INTO magic_links (token_hash, email, expires_at) VALUES (%s, %s, %s)",
                (token_hash, email, expires_at),
            )
            conn.commit()

    def use_magic_link(self, token_hash: str) -> dict[str, Any] | None:
        if self.backend == "mssql":
            return self._use_magic_link_mssql(token_hash)
        return self._use_magic_link_sqlite(token_hash)

    def _use_magic_link_sqlite(self, token_hash: str) -> dict[str, Any] | None:
        path = os.path.abspath(get_settings().DASHBOARD_DB_PATH)
        with sqlite3.connect(path) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT * FROM magic_links WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?",
                (token_hash, datetime.now(timezone.utc).isoformat()),
            ).fetchone()
            if not row:
                return None
            conn.execute(
                "UPDATE magic_links SET used_at = ? WHERE token_hash = ?",
                (datetime.now(timezone.utc).isoformat(), token_hash),
            )
            conn.commit()
        return {"email": row["email"]}

    # ------------------------------------------------------------------
    # Sessions
    # ------------------------------------------------------------------
    def save_session(self, token_hash: str, user_id: int) -> None:
        if self.backend == "mssql":
            self._save_session_mssql(token_hash, user_id)
        else:
            self._save_session_sqlite(token_hash, user_id)

    def _save_session_sqlite(self, token_hash: str, user_id: int) -> None:
        path = os.path.abspath(get_settings().DASHBOARD_DB_PATH)
        with sqlite3.connect(path) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
                (token_hash, user_id, (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()),
            )
            conn.commit()

    def _save_session_mssql(self, token_hash: str, user_id: int) -> None:
        settings = get_settings()
        with pymssql.connect(
            server=settings.DASHBOARD_DB_HOST or settings.DB_HOST,
            port=settings.DASHBOARD_DB_PORT or settings.DB_PORT,
            database=settings.DASHBOARD_DB_NAME or settings.DB_NAME,
            user=settings.DASHBOARD_DB_USER or settings.DB_USER,
            password=settings.DASHBOARD_DB_PASSWORD or settings.DB_PASSWORD,
        ) as conn, conn.cursor() as cur:
            cur.execute(
                """MERGE sessions AS target
                USING (VALUES (%s, %s, DATEADD(hour, 24, GETUTCDATE()))) AS source (token_hash, user_id, expires_at)
                ON target.token_hash = source.token_hash
                WHEN MATCHED THEN UPDATE SET user_id = source.user_id, expires_at = source.expires_at
                WHEN NOT MATCHED THEN INSERT (token_hash, user_id, expires_at) VALUES (source.token_hash, source.user_id, source.expires_at);""",
                (token_hash, user_id),
            )
            conn.commit()

    def is_session_valid(self, token_hash: str) -> bool:
        if self.backend == "mssql":
            return self._is_session_valid_mssql(token_hash)
        return self._is_session_valid_sqlite(token_hash)

    def _is_session_valid_sqlite(self, token_hash: str) -> bool:
        path = os.path.abspath(get_settings().DASHBOARD_DB_PATH)
        with sqlite3.connect(path) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT 1 FROM sessions WHERE token_hash = ? AND expires_at > ?",
                (token_hash, datetime.now(timezone.utc).isoformat()),
            ).fetchone()
        return row is not None

    def _is_session_valid_mssql(self, token_hash: str) -> bool:
        settings = get_settings()
        with pymssql.connect(
            server=settings.DASHBOARD_DB_HOST or settings.DB_HOST,
            port=settings.DASHBOARD_DB_PORT or settings.DB_PORT,
            database=settings.DASHBOARD_DB_NAME or settings.DB_NAME,
            user=settings.DASHBOARD_DB_USER or settings.DB_USER,
            password=settings.DASHBOARD_DB_PASSWORD or settings.DB_PASSWORD,
        ) as conn, conn.cursor(as_dict=True) as cur:
            cur.execute(
                "SELECT 1 FROM sessions WHERE token_hash = %s AND expires_at > GETUTCDATE()",
                (token_hash,),
            )
            return cur.fetchone() is not None

    def revoke_session(self, token_hash: str) -> None:
        if self.backend == "mssql":
            self._revoke_session_mssql(token_hash)
        else:
            self._revoke_session_sqlite(token_hash)

    def _revoke_session_sqlite(self, token_hash: str) -> None:
        path = os.path.abspath(get_settings().DASHBOARD_DB_PATH)
        with sqlite3.connect(path) as conn:
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
            conn.commit()

    def _revoke_session_mssql(self, token_hash: str) -> None:
        settings = get_settings()
        with pymssql.connect(
            server=settings.DASHBOARD_DB_HOST or settings.DB_HOST,
            port=settings.DASHBOARD_DB_PORT or settings.DB_PORT,
            database=settings.DASHBOARD_DB_NAME or settings.DB_NAME,
            user=settings.DASHBOARD_DB_USER or settings.DB_USER,
            password=settings.DASHBOARD_DB_PASSWORD or settings.DB_PASSWORD,
        ) as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM sessions WHERE token_hash = %s", (token_hash,))
            conn.commit()

    def _use_magic_link_mssql(self, token_hash: str) -> dict[str, Any] | None:
        settings = get_settings()
        with pymssql.connect(
            server=settings.DASHBOARD_DB_HOST or settings.DB_HOST,
            port=settings.DASHBOARD_DB_PORT or settings.DB_PORT,
            database=settings.DASHBOARD_DB_NAME or settings.DB_NAME,
            user=settings.DASHBOARD_DB_USER or settings.DB_USER,
            password=settings.DASHBOARD_DB_PASSWORD or settings.DB_PASSWORD,
        ) as conn, conn.cursor(as_dict=True) as cur:
            cur.execute(
                "SELECT * FROM magic_links WHERE token_hash = %s AND used_at IS NULL AND expires_at > GETUTCDATE()",
                (token_hash,),
            )
            row = cur.fetchone()
            if not row:
                return None
            cur.execute(
                "UPDATE magic_links SET used_at = GETUTCDATE() WHERE token_hash = %s",
                (token_hash,),
            )
            conn.commit()
        return {"email": row["email"]}
