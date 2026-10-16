"""Client IP extraction and geolocation for visit logging."""

import json
import socket
import threading
import urllib.error
import urllib.parse
import urllib.request
from datetime import timedelta
from ipaddress import ip_address

from django.conf import settings as django_settings
from django.http import HttpResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET


# 1×1 transparent GIF, same role as pixel.gif in the old counter.
PIXEL_GIF = (
    b'GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!'
    b'\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00'
    b'\x00\x02\x02D\x01\x00;'
)


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
    if request.COOKIES.get('dontcount'):
        return False
    path = request.path or ''
    if is_pixel_path(path):
        return False
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


def should_log_anonymous_html(request, response):
    """Log a public HTML page view, including visitors who are not signed in."""
    if not getattr(django_settings, 'IP_VISIT_LOG_ENABLED', True):
        return False
    if request.COOKIES.get('dontcount'):
        return False
    if request.method not in ('GET', 'HEAD'):
        return False
    if getattr(response, 'status_code', 0) != 200:
        return False
    content_type = response.get('Content-Type', '')
    if 'text/html' not in content_type:
        return False
    user = getattr(request, 'user', None)
    if user is not None and user.is_authenticated:
        return False
    path = request.path or ''
    if is_pixel_path(path) or path.startswith('/api/'):
        return False
    if _normalized_path(path).startswith('/drawio/'):
        return False
    skip_prefixes = getattr(
        django_settings,
        'IP_VISIT_LOG_SKIP_PREFIXES',
        ('/static/', '/media/', '/favicon.ico'),
    )
    if any(path.startswith(prefix) for prefix in skip_prefixes):
        return False
    if '/admin/notes/ipvisitlog/' in path:
        return False
    return True


def is_pixel_path(path):
    norm = _normalized_path(path)
    return norm == '/pixel' or norm.endswith('/pixel')


def _normalized_path(path):
    raw = (path or '').rstrip('/') or '/'
    script = (getattr(django_settings, 'FORCE_SCRIPT_NAME', '') or '').rstrip('/')
    if script and raw.startswith(script):
        raw = raw[len(script):] or '/'
    return raw.rstrip('/') or '/'


def hostname_for_ip(ip):
    if not ip or is_private_ip(ip):
        return ''
    from .models import IpVisitLog

    cutoff = timezone.now() - timedelta(days=7)
    prev = (
        IpVisitLog.objects.filter(ip_address=ip, hostname__gt='')
        .filter(created_at__gte=cutoff)
        .order_by('-created_at')
        .values_list('hostname', flat=True)
        .first()
    )
    if prev:
        return prev
    found = {}

    def lookup():
        try:
            found['host'] = socket.gethostbyaddr(ip)[0]
        except (OSError, socket.herror, socket.gaierror):
            found['host'] = ''

    worker = threading.Thread(target=lookup, daemon=True)
    worker.start()
    worker.join(0.4)
    return (found.get('host') or '')[:255]


def log_ip_visit(request, *, event_type='visit', user=None, site='', screen='', color_depth='', path_override=''):
    from django.db.utils import OperationalError

    from .models import IpVisitLog

    ip = get_client_ip(request)
    if not ip:
        return None
    try:
        return _create_ip_visit(
            request, ip, event_type=event_type, user=user, site=site,
            screen=screen, color_depth=color_depth, path_override=path_override,
            model=IpVisitLog,
        )
    except OperationalError:
        # A read-only database must not turn inbox polling into a 500.
        return None


def _create_ip_visit(request, ip, *, event_type, user, site, screen, color_depth, path_override, model):
    geo = resolve_ip_geo(ip)
    auth_user = user
    if auth_user is None:
        auth_user = getattr(request, 'user', None)
        if auth_user is not None and not auth_user.is_authenticated:
            auth_user = None
    user_agent = (request.META.get('HTTP_USER_AGENT') or '')[:512]
    query = '' if path_override else (request.META.get('QUERY_STRING') or '')
    path = (path_override or request.path or '')[:512]
    site_value = (site or path)[:512]
    return model.objects.create(
        ip_address=ip[:45],
        user=auth_user,
        method=(request.method or '')[:10],
        path=path,
        query_string=query[:512],
        user_agent=user_agent,
        event_type=event_type,
        hostname=hostname_for_ip(ip),
        referer=(request.META.get('HTTP_REFERER') or '')[:1024],
        site=site_value,
        screen=(screen or '')[:32],
        color_depth=(color_depth or '')[:8],
        **geo,
    )


def _site_matches_log(site_path, log_path):
    site_path = site_path or ''
    log_path = log_path or ''
    if site_path == log_path:
        return True
    if not site_path or not log_path or log_path == '/':
        return False
    if site_path.endswith(log_path):
        before = site_path[: -len(log_path)]
        return before.endswith('/')
    return False


def recent_visit_for_pixel(ip, site):
    from .models import IpVisitLog

    if not ip:
        return None
    cutoff = timezone.now() - timedelta(seconds=45)
    site_path = (site or '').split('?', 1)[0]
    recent = list(
        IpVisitLog.objects.filter(ip_address=ip, event_type=IpVisitLog.EVENT_VISIT, created_at__gte=cutoff)
        .order_by('-created_at')[:8]
    )
    for log in recent:
        if site_path and log.path == site_path:
            return log
    for log in recent:
        if _site_matches_log(site_path, log.path):
            return log
    return None


def record_pixel_visit(request):
    if request.COOKIES.get('dontcount'):
        return None
    if not getattr(django_settings, 'IP_VISIT_LOG_ENABLED', True):
        return None
    site = (request.GET.get('site') or '')[:512]
    screen = (request.GET.get('jsres') or '')[:32]
    color_depth = (request.GET.get('jscolor') or '')[:8]
    ip = get_client_ip(request)
    log = recent_visit_for_pixel(ip, site)
    if log:
        updates = []
        if screen and log.screen != screen:
            log.screen = screen
            updates.append('screen')
        if color_depth and log.color_depth != color_depth:
            log.color_depth = color_depth
            updates.append('color_depth')
        if site and log.site != site:
            log.site = site[:512]
            updates.append('site')
        if updates:
            log.save(update_fields=updates)
        return log
    page_path = site.split('?', 1)[0] if site.startswith('/') else ''
    return log_ip_visit(
        request,
        site=site,
        screen=screen,
        color_depth=color_depth,
        path_override=page_path,
    )


def _js_string(value):
    return (
        str(value or '')
        .replace('\\', '\\\\')
        .replace('"', '\\"')
        .replace('\r', '')
        .replace('\n', '')
        .replace('<', '\\u003c')
    )


@csrf_exempt
@require_GET
def visit_pixel(request):
    """1×1 visit counter. Screen size arrives the same way as pixel.php's js mode."""
    if request.GET.get('mode') == 'js':
        from django.urls import reverse

        site = _js_string(request.GET.get('site') or '')
        pixel_url = _js_string(reverse('visit_pixel'))
        body = (
            f'site="{site}";\n'
            'w=screen.width;\n'
            'h=screen.height;\n'
            "v=navigator.appName;\n"
            "if (v != 'Netscape') {var c=screen.colorDepth;}\n"
            'else {var c=screen.pixelDepth;}\n'
            f'jsinfo = "{pixel_url}?site=" + encodeURIComponent(site) + "&jsres=" + w + "x" + h + "&jscolor=" + c;\n'
            'str = "<img src=\\""+jsinfo+"\\" alt=\\"\\" height=\\"1\\" width=\\"1\\">";\n'
            'document.write(str+"\\n");\n'
        )
        return HttpResponse(body, content_type='text/javascript; charset=utf-8')
    record_pixel_visit(request)
    response = HttpResponse(PIXEL_GIF, content_type='image/gif')
    response['Cache-Control'] = 'no-store'
    response['Content-Length'] = str(len(PIXEL_GIF))
    return response
