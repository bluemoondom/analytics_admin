"""FastAPI application factory and HTML page routes."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, FastAPI, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from src.web.auth import get_current_user_optional
from src.web.config import get_settings
from src.web.models.user import User
from src.web.routers import auth, connectors, dashboards, public_api, views
from src.web.security import CSRFMiddleware, SecurityHeadersMiddleware
from src.web.services.migrations import run_migrations


def _setup_middleware(app: FastAPI, settings) -> None:
    """Add common security middleware to an app."""
    # Middleware is added innermost first: the request passes through
    # TrustedHostMiddleware -> SecurityHeadersMiddleware -> CORSMiddleware
    # -> CSRFMiddleware before reaching the routers.
    app.add_middleware(CSRFMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition"],
        max_age=600,
    )
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=settings.TRUSTED_HOSTS,
    )


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    settings = get_settings()
    app = FastAPI(title=settings.APP_TITLE)

    app.mount("/static", StaticFiles(directory="src/web/static"), name="static")
    templates = Jinja2Templates(directory="src/web/templates")

    run_migrations()
    _setup_middleware(app, settings)

    app.include_router(auth.router)
    app.include_router(dashboards.router)
    app.include_router(views.router)
    app.include_router(connectors.router)

    app.include_router(public_api.router)

    @app.get("/", response_class=HTMLResponse)
    def index(request: Request, user: Annotated[User | None, Depends(get_current_user_optional)]):
        """Render the dashboard administration page or redirect to login."""
        if user is None:
            return RedirectResponse(url="/login", status_code=302)
        return templates.TemplateResponse(
            request,
            "index.html",
            {"title": settings.APP_TITLE, "user": user},
        )

    @app.get("/login", response_class=HTMLResponse)
    def login_page(request: Request, user: Annotated[User | None, Depends(get_current_user_optional)]):
        """Render the magic-link login page or redirect to app if already logged in."""
        if user is not None:
            return RedirectResponse(url="/", status_code=302)
        return templates.TemplateResponse(
            request,
            "login.html",
            {"title": f"Přihlášení – {settings.APP_TITLE}"},
        )

    return app


def create_api_app() -> FastAPI:
    """Create a FastAPI application that only exposes the public API."""
    settings = get_settings()
    app = FastAPI(title=f"{settings.APP_TITLE} – public API")

    run_migrations()
    _setup_middleware(app, settings)

    app.include_router(public_api.router)

    return app


app = create_app()
