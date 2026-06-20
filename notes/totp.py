import base64
import io

import pyotp
from django.conf import settings


def generate_secret():
    return pyotp.random_base32()


def provisioning_uri(secret, user):
    label = user.email or user.username
    return pyotp.TOTP(secret).provisioning_uri(
        name=label,
        issuer_name=settings.SITE_NAME,
    )


def verify_token(secret, token):
    if not secret or not token:
        return False
    token = str(token).strip().replace(' ', '')
    if not token.isdigit():
        return False
    totp = pyotp.TOTP(secret)
    return totp.verify(token, valid_window=1)


def qr_code_base64(uri):
    try:
        import qrcode
    except ImportError:
        return None

    image = qrcode.make(uri)
    buffer = io.BytesIO()
    image.save(buffer, format='PNG')
    return base64.b64encode(buffer.getvalue()).decode('ascii')
