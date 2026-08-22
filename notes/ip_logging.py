"""Client IP extraction and geolocation for visit logging."""

import json
import urllib.error
import urllib.parse
import urllib.request
from datetime import timedelta
from ipaddress import ip_address

from django.conf import settings as django_settings
from django.utils import timezone


def get_client_ip(request):
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR')
    if forwarded:
        return forwarded.split(',')[0].strip()
    real_ip = request.META.get('HTTP_X_REAL_IP')
    if real_ip:
        return real_ip.strip()
    return (request.META.get('REMOTE_ADDR') or '').strip()


def is_private_ip(ip):
    if not ip:
        return True
    try:
        addr = ip_address(ip)
    except ValueError:
        return True
    return addr.is_private or addr.is_loopback or addr.is_link_local


def lookup_ip_geo(ip):
    if not ip or is_private_ip(ip):
        return {}
    if not getattr(django_settings, 'IP_VISIT_LOG_GEO', True):
        return {}
    try:
        fields = 'status,message,country,countryCode,regionName,city,lat,lon,isp,org'
        url = f'http://ip-api.com/json/{urllib.parse.quote(ip)}?fields={fields}'
        timeout = float(getattr(django_settings, 'IP_VISIT_LOG_GEO_TIMEOUT', 2.0))
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            data = json.loads(resp.read().decode('utf-8'))
        if data.get('status') != 'success':
            return {}
        lat = data.get('lat')
        lon = data.get('lon')
        return {
            'country': data.get('country') or '',
            'country_code': data.get('countryCode') or '',
            'region': data.get('regionName') or '',
            'city': data.get('city') or '',
            'latitude': lat if lat is not None else None,
            'longitude': lon if lon is not None else None,
            'isp': data.get('isp') or '',
            'org': data.get('org') or '',
        }
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError, OSError):
        return {}


def geo_from_recent_log(ip):
    from .models import IpVisitLog

    if not ip:
        return {}
    cutoff = timezone.now() - timedelta(days=7)
    prev = (
        IpVisitLog.objects.filter(ip_address=ip, country__gt='')
        .filter(created_at__gte=cutoff)
        .order_by('-created_at')
        .first()
    )
    if not prev:
        return {}
    return {
        'country': prev.country,
        'country_code': prev.country_code,
        'region': prev.region,
        'city': prev.city,
        'latitude': prev.latitude,
        'longitude': prev.longitude,
        'isp': prev.isp,
        'org': prev.org,
    }


def resolve_ip_geo(ip):
    cached = geo_from_recent_log(ip)
    if cached:
        return cached
    return lookup_ip_geo(ip)


def should_log_request(request):
    if not getattr(django_settings, 'IP_VISIT_LOG_ENABLED', True):
        return False
    path = request.path or ''
    skip_prefixes = getattr(
        django_settings,
        'IP_VISIT_LOG_SKIP_PREFIXES',
        ('/static/', '/media/', '/favicon.ico'),
    )
    if any(path.startswith(prefix) for prefix in skip_prefixes):
        return False
    skip_parts = getattr(
        django_settings,
        'IP_VISIT_LOG_SKIP_PATH_PARTS',
        (
            'updateUserSettings',
            'saveTree',
            '/update/',
            'upload_pasted',
            '/admin/notes/ipvisitlog/',
        ),
    )
    if any(part in path for part in skip_parts):
        return False
    if path.startswith('/api/'):
        return False
    user = getattr(request, 'user', None)
    if user is not None and user.is_authenticated:
        return True
    norm = _normalized_path(path)
    login_base = _normalized_path(getattr(django_settings, 'LOGIN_URL', '/login/'))
    if request.method == 'POST' and norm in (login_base, f'{login_base}/2fa'):
        return True
    return False


def _normalized_path(path):
    raw = (path or '').rstrip('/') or '/'
    script = (getattr(django_settings, 'FORCE_SCRIPT_NAME', '') or '').rstrip('/')
    if script and raw.startswith(script):
        raw = raw[len(script):] or '/'
    return raw.rstrip('/') or '/'


def log_ip_visit(request, *, event_type='visit', user=None):
    from .models import IpVisitLog

    ip = get_client_ip(request)
    if not ip:
        return None
    geo = resolve_ip_geo(ip)
    auth_user = user
    if auth_user is None:
        auth_user = getattr(request, 'user', None)
        if auth_user is not None and not auth_user.is_authenticated:
            auth_user = None
    user_agent = (request.META.get('HTTP_USER_AGENT') or '')[:512]
    query = request.META.get('QUERY_STRING') or ''
    return IpVisitLog.objects.create(
        ip_address=ip[:45],
        user=auth_user,
        method=(request.method or '')[:10],
        path=(request.path or '')[:512],
        query_string=query[:512],
        user_agent=user_agent,
        event_type=event_type,
        **geo,
    )
