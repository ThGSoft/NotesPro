"""HTTP middleware for NotesPro."""

from django.conf import settings
from django.http import JsonResponse

from .ip_logging import _normalized_path, log_ip_visit, should_log_request


class ApiLoginRequiredJsonMiddleware:
    """
    For /api/ requests, return JSON 401 instead of redirecting to the login HTML page.

    Avoids fetch() following a login redirect to a wrong path (Apache 404 / Port 443)
    and surfacing HTML error documents in the UI.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = request.path or ''
        if not path.startswith('/api/'):
            return self.get_response(request)

        user = getattr(request, 'user', None)
        if user is not None and not user.is_authenticated:
            accept = request.headers.get('Accept', '')
            xrw = request.headers.get('X-Requested-With', '')
            if (
                'application/json' in accept
                or xrw == 'XMLHttpRequest'
                or request.method in ('POST', 'PUT', 'PATCH', 'DELETE')
            ):
                return JsonResponse(
                    {'status': 'error', 'message': 'Please sign in again.'},
                    status=401,
                )

        return self.get_response(request)


class IpVisitLogMiddleware:
    """Log client IP and geolocation for authenticated visits and logins."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        track_login = False
        if should_log_request(request):
            user = getattr(request, 'user', None)
            norm = _normalized_path(request.path)
            login_base = _normalized_path(getattr(settings, 'LOGIN_URL', '/login/'))
            track_login = (
                request.method == 'POST'
                and norm in (login_base, f'{login_base}/2fa')
                and user is not None
                and not user.is_authenticated
            )
            if user is not None and user.is_authenticated:
                log_ip_visit(request, event_type='visit')

        response = self.get_response(request)

        if track_login and getattr(request, 'user', None) and request.user.is_authenticated:
            log_ip_visit(request, event_type='login')

        return response
