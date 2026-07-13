"""HTTP middleware for NotesPro."""

from django.http import JsonResponse


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
