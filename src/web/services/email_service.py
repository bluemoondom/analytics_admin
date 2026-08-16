"""Email sending service: SMTP magic-link delivery with styled templates."""

from __future__ import annotations

import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from src.web.config import get_settings

logger = logging.getLogger(__name__)


def send_magic_link_email(to_email: str, magic_link: str, subject: str | None = None) -> bool:
    """Send a styled magic-link email via SMTP.

    Returns True on success, False on failure (logs the error).
    """
    settings = get_settings()
    if not settings.SMTP_HOST:
        logger.warning("SMTP_HOST is not configured, skipping email to %s", to_email)
        return False

    app_title = get_settings().APP_TITLE
    subj = subject or f"Přihlašovací odkaz – {app_title}"

    html_body = _render_html_template(magic_link, app_title)
    text_body = (
        f"Dobrý den,\n\n"
        f"pro přihlášení do aplikace {app_title} klikněte na následující odkaz:\n\n"
        f"{magic_link}\n\n"
        f"Odkaz je platný 15 minut a lze jej použít pouze jednou.\n\n"
        f"Pokud jste o přihlášení nežádali, tento email můžete ignorovat.\n\n"
        f"S pozdravem\n{app_title}"
    )

    msg = MIMEMultipart("alternative")
    msg["From"] = settings.SMTP_FROM
    msg["To"] = to_email
    msg["Subject"] = subj
    msg.attach(MIMEText(text_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as server:
            if settings.SMTP_STARTTLS:
                server.starttls()
            if settings.SMTP_USER and settings.SMTP_PASSWORD:
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.send_message(msg)
        logger.info("Magic link email sent to %s", to_email)
        return True
    except Exception:
        logger.exception("Failed to send magic link email to %s", to_email)
        return False


def _render_html_template(magic_link: str, app_title: str) -> str:
    """Return a styled HTML email body with a prominent CTA button."""
    return f"""<!DOCTYPE html>
<html lang="cs">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Přihlášení – {_escape(app_title)}</title>
<style>
  body {{ margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f4f6f9; color: #1a1a2e; }}
  .container {{ max-width: 480px; margin: 40px auto; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); overflow: hidden; }}
  .header {{ background: linear-gradient(135deg, #1e3a5f 0%, #2d5a8a 100%); color: #ffffff; padding: 28px 32px; text-align: center; }}
  .header h1 {{ margin: 0; font-size: 22px; font-weight: 600; letter-spacing: 0.3px; }}
  .header p {{ margin: 6px 0 0; font-size: 13px; opacity: 0.85; }}
  .content {{ padding: 32px; }}
  .content p {{ margin: 0 0 16px; font-size: 15px; line-height: 1.6; color: #444; }}
  .cta {{ text-align: center; margin: 28px 0; }}
  .cta a {{ display: inline-block; background: #2d5a8a; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; padding: 14px 36px; border-radius: 8px; box-shadow: 0 3px 12px rgba(45,90,138,0.35); }}
  .cta a:hover {{ background: #234c74; }}
  .link-fallback {{ margin: 20px 0 0; padding: 14px; background: #f0f4f8; border-radius: 8px; word-break: break-all; font-size: 12px; color: #666; }}
  .link-fallback code {{ font-family: Consolas, monospace; }}
  .footer {{ padding: 20px 32px; font-size: 12px; color: #999; text-align: center; border-top: 1px solid #eee; }}
  .warning {{ margin-top: 20px; padding: 12px; background: #fff8e1; border-left: 3px solid #f0c96b; border-radius: 0 6px 6px 0; font-size: 13px; color: #7a6a3a; }}
</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>&#128274; {_escape(app_title)}</h1>
      <p>Bezpečné přihlášení jedním kliknutím</p>
    </div>
    <div class="content">
      <p>Dobrý den,</p>
      <p>právě jste požádali o přihlášení. Klikněte na tlačítko níže pro okamžité přihlášení do aplikace.</p>
      <div class="cta">
        <a href="{_escape(magic_link)}">Přihlásit se</a>
      </div>
      <p>Odkaz je platný <strong>15 minut</strong> a lze jej použít pouze jednou.</p>
      <div class="warning">
        Pokud jste o přihlášení nežádali, tento email můžete ignorovat.
        Nikomu nepředávejte tento odkaz.
      </div>
      <div class="link-fallback">
        Pokud tlačítko nefunguje, zkopírujte tento odkaz do prohlížeče:<br/>
        <code>{_escape(magic_link)}</code>
      </div>
    </div>
    <div class="footer">
      {_escape(app_title)} &bull; Automatický email, neodpovídejte
    </div>
  </div>
</body>
</html>"""


def _escape(text: str) -> str:
    """Minimal HTML escaping for safe template insertion."""
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )
