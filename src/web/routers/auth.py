"""Authentication API routes (magic link + logout)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel

from src.web.auth import (
    COOKIE_NAME,
    _hash_token,
    clear_session_cookie,
    consume_magic_link,
    create_magic_link,
    get_current_user,
    register_user,
    set_session_cookie,
)
from src.web.config import get_settings
from src.web.models.user import UserRole
from src.web.services.email_service import send_magic_link_email
from src.web.services.user_storage import UserStorage

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    """Request a magic link by email."""

    email: str


class RegisterRequest(BaseModel):
    """Register a new admin account by email."""

    email: str


class MagicLinkResponse(BaseModel):
    """Response containing the magic link URL.

    During prototyping the link is also logged. SMTP will be configured later.
    """

    email: str
    magic_link: str
    message: str


@router.post("/login", response_model=MagicLinkResponse)
def login(request: LoginRequest):
    """Create a magic link, send it by email, and also return it for verification."""
    _token, url = create_magic_link(request.email)
    email_sent = send_magic_link_email(
        request.email,
        url,
        subject=f"Login link – {get_settings().APP_TITLE}",
    )
    message = "A login link has been sent to your email."
    myurl = ""
    if not email_sent:
        message = "Login link generated (email was not sent – please check the SMTP configuration)."
        myurl = url 
    return MagicLinkResponse(
        email=request.email,
        magic_link=myurl,
        message=message,
    )


@router.post("/register", response_model=MagicLinkResponse)
def register(request: RegisterRequest):
    """Create a pending new_admin account, send verification email, and return the link."""
    if not get_settings().REGISTRATION_ENABLED:
        raise HTTPException(status_code=403, detail="Registration is not enabled.")
    _user, _token, url = register_user(request.email)
    email_sent = send_magic_link_email(
        request.email,
        url,
        subject=f"Registration verification – {get_settings().APP_TITLE}",
    )
    message = "Registration successful. A verification link has been sent to your email."
    myurl = ""
    if not email_sent:
        message = "Registration successful (email was not sent – please check the SMTP configuration)."
        myurl = url
    return MagicLinkResponse(
        email=request.email,
        magic_link=myurl,
        message=message,
    )


def _is_localhost(request: Request) -> bool:
    host = request.headers.get("host", "").lower()
    return host.startswith(("127.0.0.1", "localhost", "[::1]"))


@router.get("/magic-link")
def magic_link_callback(token: str, request: Request):
    """Consume a magic link token, set the session cookie and redirect to app."""
    try:
        session_token = consume_magic_link(token)
    except HTTPException:
        # Invalid/expired token: redirect back to login with an error hint.
        return RedirectResponse(url="/login?error=invalid", status_code=302)
    response = RedirectResponse(url="/", status_code=302)
    set_session_cookie(response, session_token, secure=not _is_localhost(request))
    return response


@router.get("/magic-link-redirect")
def magic_link_redirect_page(token: str, request: Request):
    """Consume the magic link and redirect to app using an HTML page.

    This works around mail clients / browsers that refuse to follow a 302
    redirect from a clicked link. The page refreshes itself to the app root
    after the cookie is set.
    """
    try:
        session_token = consume_magic_link(token)
    except HTTPException:
        return RedirectResponse(url="/login?error=invalid", status_code=302)
    html = (
        "<!DOCTYPE html>\n"
        "<html lang=\"en\">\n"
        "<head>"
        "<meta charset=\"UTF-8\" />"
        "<meta http-equiv=\"refresh\" content=\"0;url=/\" />"
        "<title>Signing in…</title>"
        "</head>\n"
        "<body>\n"
        "  <p>Signing in…</p>\n"
        "</body>\n"
        "</html>"
    )
    response = HTMLResponse(content=html)
    set_session_cookie(response, session_token, secure=not _is_localhost(request))
    return response


@router.post("/logout")
def logout(response: Response, request: Request):
    """Clear the session cookie and revoke it in storage."""
    token = request.cookies.get(COOKIE_NAME)
    if token:
        UserStorage().revoke_session(_hash_token(token))
    clear_session_cookie(response)
    return {"ok": True}


@router.get("/me")
def me(user: Annotated[dict, Depends(get_current_user)]):
    """Return the currently authenticated user with active connector details."""
    storage = UserStorage()
    connector = storage.get_connector_by_id(user.connector_id) if user.connector_id else None
    return {
        "id": user.id,
        "email": user.email,
        "role": user.role.value,
        "is_admin": user.role == UserRole.ADMIN,
        "connector_id": user.connector_id,
        "connector": {
            "id": connector.id,
            "name": connector.name,
            "db_host": connector.db_host,
            "db_port": connector.db_port,
            "db_name": connector.db_name,
            "db_user": connector.db_user,
            "db_driver": connector.db_driver,
            "view_discovery_mode": connector.view_discovery_mode,
            "api_tenant": connector.api_tenant,
            "api_key": "",
            "api_key_header": connector.api_key_header,
            "api_allowed_ips": connector.api_allowed_ips,
            "api_max_requests_per_minute": connector.api_max_requests_per_minute,
        }
        if connector
        else None,
    }
