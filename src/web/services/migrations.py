"""Migration helpers: create default admins and assign existing dashboards."""

from __future__ import annotations

from src.web.config import get_settings
from src.web.models.user import Connector, UserRole
from src.web.services.storage import DashboardStorage
from src.web.services.user_storage import UserStorage

DEFAULT_ADMIN_EMAILS = ["", ""]


def _default_connector_from_settings(name: str = "Default (.env)") -> Connector:
    settings = get_settings()
    return Connector(
        name=name,
        db_host=settings.DB_HOST,
        db_port=settings.DB_PORT,
        db_name=settings.DB_NAME,
        db_user=settings.DB_USER,
        db_password=settings.DB_PASSWORD,
        db_driver=settings.DB_DRIVER,
        view_discovery_mode=settings.VIEW_DISCOVERY_MODE,
        api_tenant=settings.API_TENANT,
        api_key=settings.API_KEY or "",
        api_key_header=settings.API_KEY_HEADER,
        api_allowed_ips=settings.API_ALLOWED_IPS,
        api_max_requests_per_minute=settings.API_MAX_REQUESTS_PER_MINUTE,
    )


def _ensure_admin(user_storage: UserStorage, email: str) -> tuple[int, int]:
    """Ensure the default admin exists and return (user_id, connector_id)."""
    admin = user_storage.get_user_by_email(email)
    if admin is None:
        connector = _default_connector_from_settings(name=email)
        connector.user_id = -1  # placeholder, updated after user creation
        created_connector = user_storage.create_connector(connector)
        admin = user_storage.create_user(
            email=email,
            role=UserRole.ADMIN,
            connector_id=created_connector.id,
        )
        if admin.id is not None:
            created_connector.user_id = admin.id
            user_storage.update_connector(created_connector)
    if admin.id is None or admin.connector_id is None:
        raise RuntimeError(f"Failed to create admin {email}")
    return admin.id, admin.connector_id


def _assign_connector_owners(user_storage: UserStorage) -> None:
    """Ensure every connector has a user_id matching its owner's connector_id.

    Unassigned connectors are given to the user whose connector_id points to them.
    If no such user exists, the first admin becomes the owner so the connector
    remains manageable.
    """
    users = user_storage.list_users()
    user_by_connector_id = {u.connector_id: u for u in users if u.connector_id}
    admins = [u for u in users if u.role == UserRole.ADMIN]
    fallback_owner = admins[0] if admins else None
    for connector in user_storage.list_connectors():
        if connector.user_id is not None and connector.user_id > 0:
            continue
        owner = user_by_connector_id.get(connector.id) or fallback_owner
        if owner is not None:
            connector.user_id = owner.id
            user_storage.update_connector(connector)
            # Make sure the owner really points to this connector.
            if owner.connector_id != connector.id:
                user_storage.update_user_connector(owner.id, connector.id)


def run_migrations() -> None:
    """Ensure default admin users exist and existing dashboards belong to the first admin."""
    user_storage = UserStorage()
    first_admin_id: int | None = None
    first_connector_id: int | None = None
    for email in DEFAULT_ADMIN_EMAILS:
        user_id, connector_id = _ensure_admin(user_storage, email)
        if first_admin_id is None:
            first_admin_id = user_id
            first_connector_id = connector_id

    _assign_connector_owners(user_storage)

    # Reassign dashboards without an owner to the first admin user.
    dashboard_storage = DashboardStorage()
    if first_admin_id is None or first_connector_id is None:
        return
    orphan_dashboards = [
        d for d in dashboard_storage.list_dashboards(include_all=True)
        if d.user_id is None
    ]
    for dashboard in orphan_dashboards:
        dashboard.user_id = first_admin_id
        if dashboard.connector_id is None:
            dashboard.connector_id = first_connector_id
        dashboard_storage.save_dashboard(dashboard)
