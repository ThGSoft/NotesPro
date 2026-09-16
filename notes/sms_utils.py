"""Send SMS (Twilio when configured, otherwise print like the email console backend)."""
import base64
import logging
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from django.conf import settings

logger = logging.getLogger(__name__)


def sms_delivery_mode():
    sid = getattr(settings, 'TWILIO_ACCOUNT_SID', '')
    token = getattr(settings, 'TWILIO_AUTH_TOKEN', '')
    from_nr = getattr(settings, 'TWILIO_FROM', '')
    if sid and token and from_nr:
        return 'twilio'
    return 'console'


def sms_delivery_hint():
    if sms_delivery_mode() == 'twilio':
        return 'SMS was sent via Twilio.'
    return 'SMS printed in the terminal where runserver is running (no Twilio credentials).'


def send_sms(to, body):
    """Send `body` to E.164 number `to`. Returns delivery mode."""
    mode = sms_delivery_mode()
    text = str(body or '').strip()
    dest = str(to or '').strip()
    if not dest or not text:
        raise ValueError('Mobile number and message are required.')
    if mode == 'twilio':
        _send_twilio(dest, text)
        logger.info('SMS sent to %s via Twilio', dest)
        return mode
    banner = f'\n----- SMS to {dest} -----\n{text}\n----- END SMS -----\n'
    print(banner, flush=True)
    logger.info('SMS (console) to %s', dest)
    return mode


def _send_twilio(to, body):
    sid = settings.TWILIO_ACCOUNT_SID
    token = settings.TWILIO_AUTH_TOKEN
    from_nr = settings.TWILIO_FROM
    url = f'https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json'
    payload = urlencode({'To': to, 'From': from_nr, 'Body': body}).encode('utf-8')
    request = Request(url, data=payload, method='POST')
    auth = base64.b64encode(f'{sid}:{token}'.encode('ascii')).decode('ascii')
    request.add_header('Authorization', f'Basic {auth}')
    request.add_header('Content-Type', 'application/x-www-form-urlencoded')
    with urlopen(request, timeout=20) as response:
        if response.status >= 400:
            raise RuntimeError(f'Twilio SMS failed ({response.status}).')
