"""Fetch external email (IMAP) and parse NotesPro routing subjects."""

import email
import imaplib
import logging
import re
from email.header import decode_header
from email.utils import parseaddr

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.urls import reverse

from .email_pdf import ensure_incoming_mail_pdf
from .email_eml import save_incoming_mail_eml
from .models import IncomingMail

logger = logging.getLogger(__name__)

User = get_user_model()

# NotesPro:user:workspace[:folder[:page]] — segments separated by colons only.
# workspace/folder may contain semicolons or slashes, not colons.
_SUBJECT_PREFIX_RE = re.compile(
    r'^(?:(?:re|fwd|fw|aw|wg|antwort|antw)\s*:\s*)+',
    re.IGNORECASE,
)
_FORWARD_BREAK_RE = re.compile(
    r'^(-{3,}|={3,}|_{3,}|'
    r'----------\s*forwarded message\s*---------|'
    r'----------\s*weitergeleitete nachricht\s*---------|'
    r'-----original message-----|'
    r'begin forwarded message:)',
    re.IGNORECASE,
)


def split_email_body_appendix(body):
    """Split body into main text and forwarded appendix block."""
    text = re.sub(r'\r\n?', '\n', body or '')
    if not text.strip():
        return '', ''
    match = _FORWARD_BREAK_RE.search(text, re.MULTILINE)
    if not match:
        return text.strip(), ''
    main = text[:match.start()].strip()
    appendix = text[match.start():].strip()
    return main, appendix


def strip_notespro_lines(text):
    lines = []
    for line in (text or '').splitlines():
        if parse_notespro_route_line(line.strip()):
            continue
        lines.append(line)
    return '\n'.join(lines).strip()


def build_incoming_page_markdown(title, body, pdf_upload=None, eml_upload=None):
    main, appendix = split_email_body_appendix(body)
    main = strip_notespro_lines(main)

    lines = [f'# {title}', '']
    if eml_upload:
        lines.append(f'[{eml_upload.original_name}]({eml_upload.file.url})')
    if pdf_upload:
        lines.append(f'[{pdf_upload.original_name}]({pdf_upload.file.url})')
    if eml_upload or pdf_upload:
        lines.append('')
    if main:
        lines.append(main)
        lines.append('')
    if appendix:
        lines.append('## Appendix')
        lines.append('')
        lines.append(appendix)
    elif not main and (body or '').strip():
        lines.append((body or '').strip())
    return '\n'.join(lines).strip() + '\n'


def decode_mime_header(value):
    if not value:
        return ''
    parts = []
    for chunk, charset in decode_header(value):
        if isinstance(chunk, bytes):
            parts.append(chunk.decode(charset or 'utf-8', errors='replace'))
        else:
            parts.append(chunk)
    return ''.join(parts).strip()


def extract_text_body(msg):
    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            disp = str(part.get('Content-Disposition') or '')
            if ctype == 'text/plain' and 'attachment' not in disp.lower():
                payload = part.get_payload(decode=True)
                if payload:
                    charset = part.get_content_charset() or 'utf-8'
                    return payload.decode(charset, errors='replace').strip()
        return ''
    payload = msg.get_payload(decode=True)
    if not payload:
        return ''
    charset = msg.get_content_charset() or 'utf-8'
    return payload.decode(charset, errors='replace').strip()


def normalize_mail_subject(subject):
    subject = (subject or '').strip()
    while True:
        match = _SUBJECT_PREFIX_RE.match(subject)
        if not match:
            break
        subject = subject[match.end():].strip()
    return subject


def parse_notespro_route_line(line):
    """Parse a single-line NotesPro route. Returns dict or None."""
    line = (line or '').strip()
    if not re.match(r'notespro:', line, re.IGNORECASE):
        return None
    rest = re.sub(r'^notespro:', '', line, count=1, flags=re.IGNORECASE).strip()
    if not rest:
        return None
    parts = [part.strip() for part in rest.split(':')]
    if len(parts) < 2 or not parts[0]:
        return None
    route = {
        'user': parts[0],
        'workspace': parts[1],
        'folder': '',
        'page': '',
    }
    if len(parts) >= 3:
        route['folder'] = parts[2]
    if len(parts) >= 4:
        route['page'] = ':'.join(parts[3:]).strip()
    return route


def find_notespro_route(subject, body):
    """Find route from subject or first body line (never across multiple lines)."""
    clean_subject = normalize_mail_subject(subject)
    if 'notespro:' in clean_subject.lower():
        route = parse_notespro_route_line(clean_subject)
        if route:
            return route

    for line in (body or '').splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if _FORWARD_BREAK_RE.match(stripped):
            break
        if 'notespro:' in stripped.lower():
            route = parse_notespro_route_line(stripped)
            if route:
                return route
        break
    return None


def parse_notespro_route(text):
    """Backward-compatible helper: parse first NotesPro line in text."""
    if not text:
        return None
    for line in text.splitlines():
        route = parse_notespro_route_line(line.strip())
        if route:
            return route
    return None


def resolve_recipient_user(route, to_addrs):
    if route and route.get('user'):
        user = User.objects.filter(username__iexact=route['user']).first()
        if user:
            return user
    for addr in to_addrs:
        _, email_addr = parseaddr(addr)
        email_addr = (email_addr or '').strip().lower()
        if not email_addr:
            continue
        user = User.objects.filter(email__iexact=email_addr).first()
        if user:
            return user
    imap_user = getattr(settings, 'INCOMING_MAIL_IMAP_USER', '').strip().lower()
    if imap_user:
        user = User.objects.filter(email__iexact=imap_user).first()
        if user:
            return user
    return None


def imap_settings_configured():
    return bool(
        getattr(settings, 'INCOMING_MAIL_IMAP_HOST', '')
        and getattr(settings, 'INCOMING_MAIL_IMAP_USER', '')
        and getattr(settings, 'INCOMING_MAIL_IMAP_PASSWORD', ''),
    )


def _connect_imap():
    host = settings.INCOMING_MAIL_IMAP_HOST
    port = int(getattr(settings, 'INCOMING_MAIL_IMAP_PORT', 993))
    use_ssl = getattr(settings, 'INCOMING_MAIL_IMAP_SSL', True)
    if use_ssl:
        client = imaplib.IMAP4_SSL(host, port)
    else:
        client = imaplib.IMAP4(host, port)
    client.login(settings.INCOMING_MAIL_IMAP_USER, settings.INCOMING_MAIL_IMAP_PASSWORD)
    folder = getattr(settings, 'INCOMING_MAIL_IMAP_FOLDER', 'INBOX')
    client.select(folder)
    return client


def _message_has_notespro_marker(subject, body):
    if 'notespro:' in (subject or '').lower():
        return True
    for line in (body or '').splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if _FORWARD_BREAK_RE.match(stripped):
            break
        return 'notespro:' in stripped.lower()
    return False


def fetch_incoming_mails(*, mark_seen=True):
    """
    Poll IMAP inbox for unread messages with NotesPro:… in subject or body.
    Returns dict with counts and skip_reasons.
    """
    if not imap_settings_configured():
        raise RuntimeError('IMAP is not configured (INCOMING_MAIL_IMAP_* settings).')

    imported = 0
    skipped = 0
    errors = 0
    skip_reasons = []

    client = _connect_imap()
    try:
        typ, data = client.search(None, 'UNSEEN')
        if typ != 'OK':
            raise RuntimeError('IMAP search failed')
        ids = data[0].split() if data and data[0] else []
        for msg_id in ids:
            try:
                typ, msg_data = client.fetch(msg_id, '(RFC822)')
                if typ != 'OK' or not msg_data or not msg_data[0]:
                    errors += 1
                    continue
                raw = msg_data[0][1]
                if isinstance(raw, str):
                    raw_bytes = raw.encode('utf-8', errors='replace')
                else:
                    raw_bytes = raw
                msg = email.message_from_bytes(raw_bytes)
                subject = decode_mime_header(msg.get('Subject'))
                body = extract_text_body(msg)

                if not _message_has_notespro_marker(subject, body):
                    skipped += 1
                    skip_reasons.append({
                        'reason': 'no_notespro_marker',
                        'subject': (subject or '')[:120],
                    })
                    if mark_seen:
                        client.store(msg_id, '+FLAGS', '\\Seen')
                    continue

                route = find_notespro_route(subject, body)
                to_addrs = [
                    msg.get('To', ''),
                    msg.get('Cc', ''),
                    msg.get('Delivered-To', ''),
                    msg.get('X-Original-To', ''),
                ]
                recipient = resolve_recipient_user(route, to_addrs)
                if not recipient:
                    logger.warning('No recipient for incoming mail: %s', subject[:80])
                    skipped += 1
                    skip_reasons.append({
                        'reason': 'no_recipient',
                        'subject': (subject or '')[:120],
                        'route_user': (route or {}).get('user', ''),
                    })
                    if mark_seen:
                        client.store(msg_id, '+FLAGS', '\\Seen')
                    continue

                message_id = (msg.get('Message-ID') or '').strip()
                if not message_id:
                    message_id = f'imap:{msg_id.decode() if isinstance(msg_id, bytes) else msg_id}'

                if IncomingMail.objects.filter(external_id=message_id).exists():
                    skipped += 1
                    skip_reasons.append({
                        'reason': 'already_imported',
                        'subject': (subject or '')[:120],
                    })
                    if mark_seen:
                        client.store(msg_id, '+FLAGS', '\\Seen')
                    continue

                from_name, from_email = parseaddr(msg.get('From', ''))
                page_title = (route or {}).get('page') or normalize_mail_subject(subject) or 'Imported mail'
                with transaction.atomic():
                    item = IncomingMail.objects.create(
                        recipient=recipient,
                        sender_email=from_email or from_name or '',
                        subject=subject or '(no subject)',
                        body=body,
                        external_id=message_id,
                        parsed_user=route.get('user', '') if route else '',
                        parsed_workspace=route.get('workspace', '') if route else '',
                        parsed_folder=route.get('folder', '') if route else '',
                        parsed_page=page_title,
                    )
                save_incoming_mail_eml(item, raw_bytes)
                ensure_incoming_mail_pdf(item, route_hint=format_route_hint(item))
                imported += 1
                if mark_seen:
                    client.store(msg_id, '+FLAGS', '\\Seen')
            except Exception:
                logger.exception('Failed to import IMAP message %s', msg_id)
                errors += 1
    finally:
        try:
            client.logout()
        except Exception:
            pass

    return {
        'imported': imported,
        'skipped': skipped,
        'errors': errors,
        'skip_reasons': skip_reasons,
    }


def incoming_mail_to_dict(item, request=None):
    pdf_url = None
    eml_url = None
    if item.pdf_file:
        pdf_url = item.pdf_file.url
    if item.eml_file:
        eml_url = item.eml_file.url
    if request:
        if pdf_url:
            pdf_url = request.build_absolute_uri(pdf_url)
        else:
            pdf_url = request.build_absolute_uri(reverse('incoming_mail_pdf', args=[item.id]))
        if eml_url:
            eml_url = request.build_absolute_uri(eml_url)
        else:
            eml_url = request.build_absolute_uri(reverse('incoming_mail_eml', args=[item.id]))
    return {
        'id': item.id,
        'sender_email': item.sender_email,
        'subject': item.subject,
        'body': item.body,
        'status': item.status,
        'parsed_user': item.parsed_user,
        'parsed_workspace': item.parsed_workspace,
        'parsed_folder': item.parsed_folder,
        'parsed_page': item.parsed_page,
        'route_hint': format_route_hint(item),
        'received_at': item.received_at.isoformat(),
        'distributed_page_id': item.distributed_page_id,
        'has_pdf': bool(item.pdf_file),
        'pdf_url': pdf_url,
        'has_eml': bool(item.eml_file),
        'eml_url': eml_url,
    }


def format_route_hint(item):
    parts = [p for p in (
        item.parsed_user,
        item.parsed_workspace,
        item.parsed_folder,
        item.parsed_page,
    ) if p]
    if not parts:
        return ''
    return 'NotesPro:' + ':'.join(parts)
