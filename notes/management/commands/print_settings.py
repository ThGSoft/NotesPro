import os
from pprint import pformat

from django.conf import settings
from django.core.management.base import BaseCommand


# Values whose names match these (case-insensitive substring) are masked.
_SECRET_NAME_PARTS = (
    'SECRET',
    'PASSWORD',
    'PASSWD',
    'TOKEN',
    'API_KEY',
    'PRIVATE',
    'ENCRYPTION_KEY',
)


class Command(BaseCommand):
    help = (
        'Print effective Django settings as loaded at runtime '
        '(after .env / DJANGO_ENV). Secrets are masked unless --show-secrets.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            'names',
            nargs='*',
            help='Optional setting names to print (default: curated list, or all with --all).',
        )
        parser.add_argument(
            '--all',
            action='store_true',
            help='Print all uppercase settings from django.conf.settings.',
        )
        parser.add_argument(
            '--show-secrets',
            action='store_true',
            help='Do not mask secret values (use carefully).',
        )
        parser.add_argument(
            '--env',
            action='store_true',
            help='Also print DJANGO_ENV and which .env file was intended.',
        )

    def handle(self, *args, **options):
        show_secrets = options['show_secrets']
        names = [n.upper() for n in (options['names'] or [])]

        if options['env'] or not names:
            django_env = os.environ.get('DJANGO_ENV', 'dev')
            base_dir = getattr(settings, 'BASE_DIR', None)
            env_file = None
            if base_dir is not None:
                candidate = base_dir / f'.env.{django_env.lower().strip()}'
                fallback = base_dir / '.env.dev'
                env_file = candidate if candidate.is_file() else fallback
            self.stdout.write(f'DJANGO_ENV={django_env}')
            self.stdout.write(f'env_file={env_file}')
            self.stdout.write('')

        if options['all']:
            keys = sorted(
                k for k in dir(settings)
                if k.isupper() and not k.startswith('_')
            )
        elif names:
            keys = names
        else:
            keys = [
                'DEBUG',
                'ALLOWED_HOSTS',
                'SECRET_KEY',
                'FORCE_SCRIPT_NAME',
                'STATIC_URL',
                'MEDIA_URL',
                'STATIC_ROOT',
                'MEDIA_ROOT',
                'LOGIN_URL',
                'LOGIN_REDIRECT_URL',
                'LOGOUT_REDIRECT_URL',
                'SECURE_SSL_REDIRECT',
                'SESSION_COOKIE_SECURE',
                'CSRF_COOKIE_SECURE',
                'USE_X_FORWARDED_HOST',
                'SECURE_PROXY_SSL_HEADER',
                'SITE_NAME',
                'SITE_URL',
                'DEFAULT_FROM_EMAIL',
                'EMAIL_BACKEND',
                'EMAIL_HOST',
                'EMAIL_PORT',
                'EMAIL_HOST_USER',
                'EMAIL_HOST_PASSWORD',
                'EMAIL_USE_TLS',
                'EMAIL_USE_SSL',
                'INCOMING_MAIL_IMAP_HOST',
                'INCOMING_MAIL_IMAP_PORT',
                'INCOMING_MAIL_IMAP_USER',
                'INCOMING_MAIL_IMAP_PASSWORD',
                'INCOMING_MAIL_IMAP_FOLDER',
                'INCOMING_MAIL_IMAP_SSL',
                'ENABLE_TAG_WEBSOCKET',
                'LOCAL_FILE_OPEN_ENABLED',
                'DB_ENCRYPTION_KEY',
                'DATABASES',
                'ROOT_URLCONF',
                'WSGI_APPLICATION',
                'ASGI_APPLICATION',
                'INSTALLED_APPS',
                'MIDDLEWARE',
                'BASE_DIR',
            ]

        width = max((len(k) for k in keys), default=8)
        for key in keys:
            if not hasattr(settings, key):
                self.stdout.write(self.style.WARNING(f'{key:<{width}}  <missing>'))
                continue
            value = getattr(settings, key)
            display = self._format_value(key, value, show_secrets)
            self.stdout.write(f'{key:<{width}}  {display}')

    def _is_secret_name(self, name):
        upper = name.upper()
        return any(part in upper for part in _SECRET_NAME_PARTS)

    def _mask(self, value):
        if value is None or value == '':
            return repr(value)
        text = str(value)
        if len(text) <= 4:
            return '****'
        return f'{text[:2]}…{text[-2:]} ({len(text)} chars)'

    def _format_value(self, key, value, show_secrets):
        if not show_secrets and self._is_secret_name(key):
            if isinstance(value, dict):
                return pformat(
                    {
                        k: (self._mask(v) if self._is_secret_name(k) else v)
                        for k, v in value.items()
                    },
                    width=100,
                    compact=True,
                )
            return self._mask(value)
        if isinstance(value, (dict, list, tuple, set)):
            return pformat(value, width=100, compact=True)
        return repr(value)
