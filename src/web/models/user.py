"""Pydantic models for users, connectors and authentication."""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class UserRole(str, Enum):
    """User roles.

    ``new_admin`` is a pending admin that has not yet confirmed their email.
    After the first magic-link login the role is promoted to ``admin``.
    """

    ADMIN = "admin"
    USER = "user"
    NEW_ADMIN = "new_admin"


class Connector(BaseModel):
    """Database connector configuration for a user."""

    id: int | None = None
    user_id: int | None = None
    name: str = "Default"
    db_type: str = "mssql"
    db_host: str
    db_port: int = 1433
    db_name: str
    db_user: str
    db_password: str
    db_driver: str = "ODBC Driver 17 for SQL Server"
    view_discovery_mode: str = "tabobecny_prehled"
    api_tenant: str = ""
    api_key: str = ""
    api_key_header: str = "X-API-Key"
    api_allowed_ips: list[str] = Field(default_factory=list)
    api_max_requests_per_minute: int = 0
    created_at: datetime | None = None
    updated_at: datetime | None = None


class User(BaseModel):
    """Application user."""

    id: int | None = None
    email: str
    role: UserRole = UserRole.USER
    is_active: bool = True
    connector_id: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class MagicLinkToken(BaseModel):
    """Single-use magic link token."""

    token_hash: str
    email: str
    expires_at: datetime
    used_at: datetime | None = None


class SessionToken(BaseModel):
    """Daily session JWT / cookie token stored in DB."""

    token_hash: str
    user_id: int
    expires_at: datetime
    created_at: datetime | None = None
