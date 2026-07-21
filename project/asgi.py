import os

from channels.auth import AuthMiddlewareStack
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import AllowedHostsOriginValidator
from django.conf import settings
from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'project.settings')

django_asgi_app = get_asgi_application()

from notes.routing import websocket_urlpatterns  # noqa: E402
from project.asgi_middleware import StripScriptNameMiddleware  # noqa: E402

_websocket_app = StripScriptNameMiddleware(
    AllowedHostsOriginValidator(
        AuthMiddlewareStack(
            URLRouter(websocket_urlpatterns),
        ),
    ),
    script_name=settings.FORCE_SCRIPT_NAME,
)

application = ProtocolTypeRouter({
    'http': django_asgi_app,
    'websocket': _websocket_app,
})
