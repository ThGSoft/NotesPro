"""Build absolute URLs for emails (invite links)."""
from django.conf import settings
from django.urls import reverse


def build_absolute_link(request, viewname, *args):
    path = reverse(viewname, args=args)
    base = (getattr(settings, 'SITE_URL', None) or '').strip().rstrip('/')
    if base:
        return f'{base}{path}'
    return request.build_absolute_uri(path)
