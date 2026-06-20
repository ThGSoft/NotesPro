import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

_django_env = os.environ.get('DJANGO_ENV', 'dev').lower().strip()
_env_file = BASE_DIR / f'.env.{_django_env}'
if _env_file.is_file():
    load_dotenv(_env_file)
else:
    load_dotenv(BASE_DIR / '.env.dev')
load_dotenv(BASE_DIR / '.env', override=False)


def _env_bool(key, default=False):
    val = os.environ.get(key)
    if val is None:
        return default
    return val.lower() in ('1', 'true', 'yes', 'on')


SECRET_KEY = os.environ.get('SECRET_KEY', 'dev-secret-key')
DEBUG = _env_bool('DEBUG', True)
LOCAL_FILE_OPEN_ENABLED = _env_bool('LOCAL_FILE_OPEN_ENABLED', DEBUG)
ALLOWED_HOSTS = [
    h.strip()
    for h in os.environ.get('ALLOWED_HOSTS', '127.0.0.1,localhost').split(',')
    if h.strip()
]

SECURE_SSL_REDIRECT = _env_bool('SECURE_SSL_REDIRECT', False)
SESSION_COOKIE_SECURE = _env_bool('SESSION_COOKIE_SECURE', False)
CSRF_COOKIE_SECURE = _env_bool('CSRF_COOKIE_SECURE', False)

INSTALLED_APPS = [
    'daphne',
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'django_extensions',
    'notes',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
]

ROOT_URLCONF = 'project.urls'
TEMPLATES = [{
    'BACKEND': 'django.template.backends.django.DjangoTemplates',
    'APP_DIRS': True,
    'OPTIONS': {
        'context_processors': [
            'django.template.context_processors.request',
            'django.contrib.auth.context_processors.auth',
            'django.contrib.messages.context_processors.messages',
        ],
    },
}]
WSGI_APPLICATION = 'project.wsgi.application'
ASGI_APPLICATION = 'project.asgi.application'

CHANNEL_LAYERS = {
    'default': {
        'BACKEND': 'channels.layers.InMemoryChannelLayer',
    },
}
DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': BASE_DIR / 'db.sqlite3'}}
AUTH_PASSWORD_VALIDATORS = []
LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

FORCE_SCRIPT_NAME = ""
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'
LOGIN_URL = '/login/'
LOGIN_REDIRECT_URL = '/'
LOGOUT_REDIRECT_URL = '/login/'
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# At-rest encryption for sensitive DB fields (pages, mail, chat, DMs, TOTP secrets).
# Generate: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
DB_ENCRYPTION_KEY = os.environ.get('DB_ENCRYPTION_KEY', '').strip()

SITE_NAME = os.environ.get('SITE_NAME', 'Django Notes Pro')
SITE_URL = os.environ.get('SITE_URL', 'http://127.0.0.1:8000').rstrip('/')
DEFAULT_FROM_EMAIL = os.environ.get('DEFAULT_FROM_EMAIL', 'notes@localhost')

# Email: console (dev default) | file (saved under sent_emails/) | smtp (real inbox)
_email_mode = os.environ.get('DJANGO_EMAIL_BACKEND', 'console').lower().strip()

if _email_mode == 'smtp':
    EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
    EMAIL_HOST = os.environ.get('EMAIL_HOST', 'localhost')
    EMAIL_PORT = int(os.environ.get('EMAIL_PORT', '587'))
    EMAIL_HOST_USER = os.environ.get('EMAIL_HOST_USER', '')
    EMAIL_HOST_PASSWORD = os.environ.get('EMAIL_HOST_PASSWORD', '')
    EMAIL_USE_TLS = os.environ.get('EMAIL_USE_TLS', 'true').lower() in ('1', 'true', 'yes')
    EMAIL_USE_SSL = os.environ.get('EMAIL_USE_SSL', 'false').lower() in ('1', 'true', 'yes')
elif _email_mode == 'file':
    EMAIL_BACKEND = 'django.core.mail.backends.filebased.EmailBackend'
    EMAIL_FILE_PATH = BASE_DIR / 'sent_emails'
    EMAIL_FILE_PATH.mkdir(parents=True, exist_ok=True)
else:
    EMAIL_BACKEND = 'django.core.mail.backends.console.EmailBackend'
