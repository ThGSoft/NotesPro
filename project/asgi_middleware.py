"""ASGI middleware for NotesPro."""


class StripScriptNameMiddleware:
    """Strip FORCE_SCRIPT_NAME prefix from WebSocket paths before URL routing."""

    def __init__(self, inner, script_name=''):
        self.inner = inner
        self.script_name = (script_name or '').rstrip('/')

    async def __call__(self, scope, receive, send):
        if scope['type'] == 'websocket' and self.script_name:
            path = scope.get('path', '')
            prefix = f'{self.script_name}/'
            if path.startswith(prefix):
                scope = dict(scope)
                scope['path'] = '/' + path[len(prefix):].lstrip('/')
            elif path == self.script_name:
                scope = dict(scope)
                scope['path'] = '/'
        return await self.inner(scope, receive, send)
