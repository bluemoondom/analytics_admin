"""Authentication API routes (magic link + logout)."""

from __future__ import annotations

import logging
from typing import Annotated
from urllib.parse import parse_qs

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
logger = logging.getLogger(__name__)


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


# Same answer whether or not the e-mail has an account, so the form cannot be
# used to find out who uses the application.
LOGIN_SENT = "If the e-mail belongs to an account, a sign-in link has been sent to it."
REGISTER_SENT = "A link has been sent to the e-mail. Open it to finish signing in."


def _deliver(email: str, url: str, subject: str) -> str:
    """E-mail the link, or return it when SHOW_MAGIC_LINK is on (then no e-mail is sent)."""
    if get_settings().SHOW_MAGIC_LINK:
        return url
    if not send_magic_link_email(email, url, subject=subject):
        logger.error("Sign-in e-mail to %s could not be sent (check the SMTP settings).", email)
    return ""


@router.post("/login", response_model=MagicLinkResponse)
def login(request: LoginRequest):
    """Send a sign-in link (or show it, with SHOW_MAGIC_LINK=true)."""
    email = (request.email or "").strip()
    url = ""
    try:
        _token, link = create_magic_link(email)
        url = _deliver(email, link, f"Login link – {get_settings().APP_TITLE}")
    except HTTPException:
        pass  # unknown or inactive account: the same answer as for a valid one
    return MagicLinkResponse(email=email, magic_link=url, message=LOGIN_SENT)


@router.post("/register", response_model=MagicLinkResponse)
def register(request: RegisterRequest):
    """Create a pending account and send the verification link.

    For an e-mail that already has an account a sign-in link is sent instead;
    the answer is the same in both cases.
    """
    if not get_settings().REGISTRATION_ENABLED:
        raise HTTPException(status_code=403, detail="Registration is not enabled.")
    email = (request.email or "").strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Invalid e-mail.")
    url = ""
    try:
        if UserStorage().get_user_by_email(email) is None:
            _user, _token, link = register_user(email)
            subject = f"Registration verification – {get_settings().APP_TITLE}"
        else:
            _token, link = create_magic_link(email)
            subject = f"Login link – {get_settings().APP_TITLE}"
        url = _deliver(email, link, subject)
    except HTTPException:
        pass
    return MagicLinkResponse(email=email, magic_link=url, message=REGISTER_SENT)


def _is_localhost(request: Request) -> bool:
    host = request.headers.get("host", "").lower()
    return host.startswith(("127.0.0.1", "localhost", "[::1]"))


def _confirm_page(request: Request, token: str):
    """Page with a sign-in button for the link from the e-mail.

    Opening the link does not use it up: mail security scanners open links in
    e-mails, which used to spend the single-use token before the user clicked.
    The token is used only by the POST of the button.
    """
    from src.web.main import templates

    response = templates.TemplateResponse(
        request, "magic_link.html", {"title": get_settings().APP_TITLE, "token": token}
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Robots-Tag"] = "noindex, nofollow"
    return response


@router.get("/magic-link", response_class=HTMLResponse)
def magic_link_page(request: Request, token: str = ""):
    return _confirm_page(request, token)


@router.get("/magic-link-redirect", response_class=HTMLResponse)
def magic_link_redirect_page(request: Request, token: str = ""):
    """Link sent in e-mails; shows the sign-in button."""
    return _confirm_page(request, token)


@router.post("/magic-link")
async def magic_link_sign_in(request: Request):
    """Use the token from the confirmation page, set the session cookie and open the app."""
    body = (await request.body()).decode("utf-8", errors="ignore")
    token = (parse_qs(body).get("token") or [""])[0]
    try:
        session_token = consume_magic_link(token)
    except HTTPException:
        return RedirectResponse(url="/login?error=invalid", status_code=303)
    response = RedirectResponse(url="/", status_code=303)
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
