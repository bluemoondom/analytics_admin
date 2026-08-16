"""Application configuration loaded from environment variables."""

from __future__ import annotations

import os
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv()


DEFAULT_CSP_POLICY = (
    "default-src 'self' blob:; "
    "script-src 'self' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; "
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; "
    "img-src 'self' data: blob:; "
    "connect-src 'self'; "
    "font-src 'self' data:; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "frame-ancestors 'none'; "
    "form-action 'self'"
)


class Settings:
    """Runtime settings for the dashboard application."""

    def __init__(self) -> None:
        """Read all settings from environment variables."""
        # MSSQL source database (read-only metadata + data)
        # No defaults for host or credentials: the application resolves
        # connections from per-user connectors stored in the database.
        # Env vars remain only for temporary tooling/migrations.
        self.DB_HOST: str = os.getenv("DB_HOST", "")
        self.DB_PORT: int = int(os.getenv("DB_PORT", "1433"))
        self.DB_NAME: str = os.getenv("DB_NAME", "")
        self.DB_USER: str = os.getenv("DB_USER", "")
        self.DB_PASSWORD: str = os.getenv("DB_PASSWORD", "")
        self.DB_DRIVER: str = os.getenv("DB_DRIVER", "ODBC Driver 17 for SQL Server")

        # Dashboard metadata storage backend: "sqlite" or "mssql"

        self.DASHBOARD_STORAGE_BACKEND: str = os.getenv(
            "DASHBOARD_STORAGE_BACKEND", "sqlite"
        )
        self.DASHBOARD_DB_PATH: str = os.getenv(
            "DASHBOARD_DB_PATH",
            os.path.join(os.path.dirname(__file__), "dashboards.sqlite3"),
        )

        # Optional alternative connection for the dashboards table in MSSQL.
        self.DASHBOARD_DB_HOST: str | None = os.getenv("DASHBOARD_DB_HOST") or None
        self.DASHBOARD_DB_PORT: int | None = (
            int(os.getenv("DASHBOARD_DB_PORT"))
            if os.getenv("DASHBOARD_DB_PORT")
            else None
        )
        self.DASHBOARD_DB_NAME: str | None = os.getenv("DASHBOARD_DB_NAME") or None
        self.DASHBOARD_DB_USER: str | None = os.getenv("DASHBOARD_DB_USER") or None
        self.DASHBOARD_DB_PASSWORD: str | None = (
            os.getenv("DASHBOARD_DB_PASSWORD") or None
        )

        # How to discover the list of available views.
        self.VIEW_DISCOVERY_MODE: str = os.getenv("VIEW_DISCOVERY_MODE", "tabobecny_prehled")

        self.APP_TITLE: str = os.getenv("APP_TITLE", "Analytics admin")
        self.PAGE_SIZE: int = int(os.getenv("PAGE_SIZE", "500"))

        # Public API for exported views.
        self.API_KEY: str | None = os.getenv("API_KEY") or None
        self.API_KEY_HEADER: str = os.getenv("API_KEY_HEADER", "X-API-Key")
        self.API_ALLOWED_IPS: list[str] = [
            ip.strip()
            for ip in (os.getenv("API_ALLOWED_IPS") or "").split(",")
            if ip.strip()
        ]
        self.API_TENANT: str = os.getenv("API_TENANT", "")
        self.API_BASE_URL: str = os.getenv(
            "API_BASE_URL",
            f"https://127.0.0.1:8443/{self.API_TENANT}" if self.API_TENANT else "http://127.0.0.1:8443",
        )
        # Allowlist of hosts/domains that may send requests to the app.
        api_base_host = (
            self.API_BASE_URL.split("://", 1)[-1].split("/", 1)[0].split(":", 1)[0]
            if self.API_BASE_URL
            else ""
        )
        default_trusted_hosts = ["localhost", "127.0.0.1", "[::1]"]
        if api_base_host:
            default_trusted_hosts.append(api_base_host)
        self.TRUSTED_HOSTS: list[str] = [
            host.strip()
            for host in (
                os.getenv("TRUSTED_HOSTS") or ",".join(default_trusted_hosts)
            ).split(",")
            if host.strip()
        ]
        self.API_MAX_REQUESTS_PER_MINUTE: int = int(
            os.getenv("API_MAX_REQUESTS_PER_MINUTE", "0")
        )
        self.API_LOG_PATH: str = os.getenv(
            "API_LOG_PATH",
            os.path.join(os.path.dirname(__file__), "..", "..", "logs", "api_access.log"),
        )

        # Magic-link / JWT authentication. No default secret – the app
        # refuses to start without JWT_SECRET set in the environment.
        self.JWT_SECRET: str = os.getenv("JWT_SECRET", "")
        if not self.JWT_SECRET:
            raise RuntimeError(
                "JWT_SECRET environment variable is not set. "
                "Generate a long random secret and add it to your .env file."
            )
        self.LOCALHOST_MODE: bool = os.getenv("LOCALHOST_MODE", "false").lower() in ("1", "true", "yes")
        self.REGISTRATION_ENABLED: bool = os.getenv("REGISTRATION_ENABLED", "true").lower() in ("1", "true", "yes")

        # Control whether magic link is shown in API response
        self.SHOW_MAGIC_LINK: bool = os.getenv("SHOW_MAGIC_LINK", "true").lower() in ("1", "true", "yes")

        # SMTP settings for magic-link emails
        self.SMTP_HOST: str = os.getenv("SMTP_HOST", "")
        self.SMTP_PORT: int = int(os.getenv("SMTP_PORT", "587"))
        self.SMTP_USER: str = os.getenv("SMTP_USER", "")
        self.SMTP_PASSWORD: str = os.getenv("SMTP_PASSWORD", "")
        self.SMTP_FROM: str = os.getenv("SMTP_FROM", self.SMTP_USER)
        self.SMTP_STARTTLS: bool = os.getenv("SMTP_STARTTLS", "true").lower() in ("1", "true", "yes")

        # HTTP security hardening
        self.CORS_ALLOWED_ORIGINS: list[str] = [
            origin.strip()
            for origin in (os.getenv("CORS_ALLOWED_ORIGINS") or "").split(",")
            if origin.strip()
        ]
        self.CSP_POLICY: str = os.getenv("CSP_POLICY") or DEFAULT_CSP_POLICY
        hsts_default = "false" if self.LOCALHOST_MODE else "true"
        self.HSTS_ENABLED: bool = os.getenv("HSTS_ENABLED", hsts_default).lower() in ("1", "true", "yes")

        # Uvicorn HTTP listener
        self.HTTP_HOST: str = os.getenv("HTTP_HOST", "0.0.0.0")
        self.HTTP_PORT: int = int(os.getenv("HTTP_PORT", "8443"))

        # SSL / HTTPS: either point uvicorn at PEM files directly or extract a
        # PFX (.pfx/.p12) bundle on startup into temporary PEM files.
        self.SSL_CERTFILE: str = os.getenv("SSL_CERTFILE", "")
        self.SSL_KEYFILE: str = os.getenv("SSL_KEYFILE", "")
        self.SSL_PFX_PATH: str = os.getenv("SSL_PFX_PATH", "")
        self.SSL_PFX_PASSWORD: str = os.getenv("SSL_PFX_PASSWORD", "")


@lru_cache
def get_settings() -> Settings:
    """Return cached settings instance."""
    return Settings()
