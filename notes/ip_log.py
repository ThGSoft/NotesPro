"""Record staff/admin client IPs for the Django admin audit log."""
from __future__ import annotations

import logging

from django.conf import settings

logger = logging.getLogger(__name__)

SKIP_PREFIXES = (
    '/static/',
    '/media/',
    '/favicon',
    '/admin/jsi18n/',
    '/admin/login/',
)


def get_client_ip(request) -> str | None:
    forwarded = (request.META.get('HTTP_X_FORWARDED_FOR') or '').strip()
    use_forwarded = bool(
        getattr(settings, 'USE_X_FORWARDED_HOST', False)
        or getattr(settings, 'SECURE_PROXY_SSL_HEADER', None)
    )
    if use_forwarded and forwarded:
        candidate = forwarded.split(',')[0].strip()
    else:
        candidate = (request.META.get('REMOTE_ADDR') or '').strip()
    return candidate or None


def record_admin_ip(request, user=None, *, event: str, path: str | None = None):
    from .models import AdminIpLog

    user = user if user is not None else getattr(request, 'user', None)
    username = ''
    user_id = None
    if user is not None and getattr(user, 'is_authenticated', False):
        username = (getattr(user, 'username', '') or '')[:150]
        user_id = getattr(user, 'pk', None)
    try:
        AdminIpLog.objects.create(
            user_id=user_id,
            username=username,
            ip_address=get_client_ip(request),
            event=event,
            method=(request.method or '')[:8],
            path=(path if path is not None else (request.path or ''))[:512],
            user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:256],
        )
    except Exception:
        logger.exception('Failed to record admin IP log')


def should_log_admin_request(request) -> bool:
    path = request.path or ''
    if any(path.startswith(prefix) for prefix in SKIP_PREFIXES):
        return False
    return path.startswith('/admin/')
