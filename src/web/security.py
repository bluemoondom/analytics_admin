"""HTTP security hardening: response headers and CSRF protection."""

from __future__ import annotations

import secrets

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse

from src.web.auth import COOKIE_NAME
from src.web.config import get_settings

CSRF_COOKIE_NAME = "csrf_token"
CSRF_HEADER_NAME = "X-CSRF-Token"
CSRF_SAFE_METHODS = {"GET", "HEAD", "OPTIONS", "TRACE"}


# Auth endpoints are exempt: login/register must work even when the browser
# still carries a stale session cookie (e.g. after a server restart).
CSRF_EXEMPT_PATHS = {
    "/auth/login",
    "/auth/register",
}


def _new_csrf_token() -> str:
    """Return a fresh random CSRF token for the double-submit cookie."""
    return secrets.token_urlsafe(32)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add hardening headers to every HTTP response."""

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> JSONResponse:
        settings = get_settings()
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = (
            "camera=(), microphone=(), geolocation=()"
        )
        response.headers["X-XSS-Protection"] = "0"
        if settings.CSP_POLICY:
            response.headers["Content-Security-Policy"] = settings.CSP_POLICY
        if settings.HSTS_ENABLED:
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return response


class CSRFMiddleware(BaseHTTPMiddleware):
    """Double-submit cookie CSRF protection for cookie-authenticated sessions.

    State-changing requests (POST/PUT/PATCH/DELETE) carrying the ``session``
    cookie must also send the same value in the ``X-CSRF-Token`` header as in
    the ``csrf_token`` cookie. A missing ``csrf_token`` cookie is provisioned
    on the response so the frontend can read it and submit it back.
    """

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> JSONResponse:
        session_token = request.cookies.get(COOKIE_NAME)
        csrf_cookie = request.cookies.get(CSRF_COOKIE_NAME)
        if (
            session_token
            and request.method not in CSRF_SAFE_METHODS
            and request.url.path not in CSRF_EXEMPT_PATHS
        ):
            header_token = request.headers.get(CSRF_HEADER_NAME, "")
            if not csrf_cookie or not header_token or not secrets.compare_digest(
                header_token, csrf_cookie
            ):
                return JSONResponse(
                    status_code=403,
                    content={"detail": "CSRF token missing or invalid"},
                )
        response = await call_next(request)
        if session_token and not csrf_cookie:
            settings = get_settings()
            response.set_cookie(
                key=CSRF_COOKIE_NAME,
                value=_new_csrf_token(),
                httponly=False,
                secure=not settings.LOCALHOST_MODE,
                samesite="lax",
                path="/",
            )
        return response