"""Mobile number normalization and SMS / email activation codes."""
import hashlib
import hmac
import re
import secrets
from datetime import timedelta

from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone

from .sms_utils import send_sms, sms_delivery_hint

CODE_TTL = timedelta(minutes=int(getattr(settings, 'SMS_CODE_TTL_MINUTES', 15) or 15))
RESEND_SECONDS = int(getattr(settings, 'SMS_CODE_RESEND_SECONDS', 60) or 60)
SESSION_PENDING_ACTIVATION = 'pending_activation_user_id'

_MOBILE_RE = re.compile(r'^\+[1-9]\d{7,14}$')


def register_mail_enabled():
    return bool(getattr(settings, 'REGISTER_MAIL', True))


def register_mobile_enabled():
    return bool(getattr(settings, 'REGISTER_MOBILE', True))


def activation_channel(user, user_settings):
    """Prefer SMS when mobile registration is on; otherwise email. Fall back for pending accounts."""
    mobile = str(getattr(user_settings, 'mobile', '') or '').strip()
    email = str(getattr(user, 'email', '') or '').strip()
    if register_mobile_enabled() and mobile:
        return 'mobile'
    if register_mail_enabled() and email:
        return 'email'
    if mobile:
        return 'mobile'
    if email:
        return 'email'
    return None


def mask_email(value):
    raw = str(value or '').strip()
    if '@' not in raw:
        return raw or '—'
    local, _, domain = raw.partition('@')
    shown = f'{local[:1]}•••' if local else '•••'
    return f'{shown}@{domain}'


def activation_destination_label(user, user_settings):
    channel = activation_channel(user, user_settings)
    if channel == 'email':
        return mask_email(user.email)
    return mask_mobile(getattr(user_settings, 'mobile', ''))


def normalize_mobile(value):
    raw = str(value or '').strip()
    if not raw:
        return ''
    compact = re.sub(r'[\s().\-]', '', raw)
    if compact.startswith('00'):
        compact = f'+{compact[2:]}'
    if not compact.startswith('+'):
        raise ValueError('Use international format with country code, e.g. +41 79 123 45 67.')
    compact = '+' + re.sub(r'\D', '', compact)
    if not _MOBILE_RE.fullmatch(compact):
        raise ValueError('Enter a valid mobile number with country code.')
    return compact


def mask_mobile(value):
    try:
        compact = normalize_mobile(value)
    except ValueError:
        compact = str(value or '').strip()
    if len(compact) < 8:
        return compact or '—'
    return f'{compact[:4]}••••{compact[-2:]}'


def _new_code():
    return f'{secrets.randbelow(900000) + 100000:06d}'


def hash_activation_code(user_id, code):
    payload = f'{user_id}:{code}:{settings.SECRET_KEY}'.encode('utf-8')
    return hashlib.sha256(payload).hexdigest()


def activation_code_is_valid(user_settings, code):
    stored = str(user_settings.activation_code_hash or '')
    if not stored or not str(code or '').strip():
        return False
    sent = user_settings.activation_sent_at
    if not sent or timezone.now() - sent > CODE_TTL:
        return False
    expected = hash_activation_code(user_settings.user_id, str(code).strip())
    return hmac.compare_digest(stored, expected)


def can_resend_activation(user_settings):
    sent = user_settings.activation_sent_at
    if not sent:
        return True, 0
    wait = RESEND_SECONDS - int((timezone.now() - sent).total_seconds())
    if wait > 0:
        return False, wait
    return True, 0


def issue_activation_code(user, user_settings, *, code=None, channel=None):
    code = str(code or _new_code())
    user_settings.activation_code_hash = hash_activation_code(user.id, code)
    user_settings.activation_sent_at = timezone.now()
    user_settings.mobile_verified = False
    user_settings.save(update_fields=['activation_code_hash', 'activation_sent_at', 'mobile_verified'])
    site = getattr(settings, 'SITE_NAME', 'NotesPro')
    minutes = int(CODE_TTL.total_seconds() // 60)
    body = f'{site} activation code: {code}. Valid {minutes} minutes.'
    channel = channel or activation_channel(user, user_settings)
    if channel == 'email':
        from .email_utils import delivery_hint
        dest = str(user.email or '').strip()
        if not dest:
            raise ValueError('Email address is required to send an activation code.')
        send_mail(
            f'{site} activation code',
            body,
            settings.DEFAULT_FROM_EMAIL,
            [dest],
            fail_silently=False,
        )
        return delivery_hint()
    send_sms(user_settings.mobile, body)
    return sms_delivery_hint()
