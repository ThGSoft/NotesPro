"""Build absolute URLs for emails (invite links)."""
from django.conf import settings
from django.urls import reverse


def build_absolute_link(request, viewname, *args):
    path = reverse(viewname, args=args)
    return _absolute_url(path, request)


def build_absolute_link_from_settings(viewname, *args):
    path = reverse(viewname, args=args)
    return _absolute_url(path, None)


def _absolute_url(path, request=None):
    base = (getattr(settings, 'SITE_URL', None) or '').strip().rstrip('/')
    if base:
        return f'{base}{path}'
    if request is not None:
        return request.build_absolute_uri(path)
    return path
