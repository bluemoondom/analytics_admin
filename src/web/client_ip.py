"""Address of the client, also behind a reverse proxy.

``X-Forwarded-For`` / ``X-Real-IP`` can be sent by anyone, so they are used
only when the connection comes from a proxy listed in ``TRUSTED_PROXY_IPS``
(addresses or networks, comma separated). Otherwise the address of the TCP
connection is used. This keeps IP allowlists, rate limits and blocklists from
being bypassed with a forged header.
"""

from __future__ import annotations

import ipaddress
from functools import lru_cache

from starlette.requests import Request

from src.web.config import get_settings


@lru_cache(maxsize=8)
def _networks(raw: tuple[str, ...]) -> tuple[ipaddress._BaseNetwork, ...]:
    nets = []
    for item in raw:
        try:
            nets.append(ipaddress.ip_network(item.strip(), strict=False))
        except ValueError:
            continue
    return tuple(nets)


def _is_trusted(ip: str, nets) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(addr in net for net in nets)


def client_ip(request: Request) -> str:
    peer = request.client.host if request.client else "unknown"
    nets = _networks(tuple(get_settings().TRUSTED_PROXY_IPS))
    if not nets or not _is_trusted(peer, nets):
        return peer
    forwarded = [part.strip() for part in (request.headers.get("X-Forwarded-For") or "").split(",") if part.strip()]
    # The right-most address not added by one of our proxies is the client.
    for candidate in reversed(forwarded):
        if not _is_trusted(candidate, nets):
            return candidate
    real_ip = (request.headers.get("X-Real-Ip") or "").strip()
    return real_ip or (forwarded[0] if forwarded else peer)
