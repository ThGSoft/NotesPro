"""Store and copy raw RFC822 email as .eml (Gmail-compatible)."""

from email.message import EmailMessage
from hashlib import md5

from django.core.files.base import ContentFile
from django.utils.text import slugify


def _eml_filename(item):
    base = slugify(item.parsed_page or item.subject or f'incoming-{item.pk}')[:80] or f'incoming-{item.pk}'
    return f'{base}-{item.pk}.eml'


def build_eml_bytes_from_item(item):
    """Rebuild a minimal .eml when raw RFC822 was not stored."""
    msg = EmailMessage()
    msg['Subject'] = item.subject or '(no subject)'
    if item.sender_email:
        msg['From'] = item.sender_email
    msg['Message-ID'] = item.external_id or f'<incoming-{item.pk}@notespro>'
    msg.set_content(item.body or '')
    return msg.as_bytes()


def save_incoming_mail_eml(item, raw_bytes=None):
    if not item.pk:
        return False
    payload = raw_bytes
    if payload is None:
        if item.eml_file:
            return True
        payload = build_eml_bytes_from_item(item)
    if isinstance(payload, str):
        payload = payload.encode('utf-8')
    filename = _eml_filename(item)
    if item.eml_file:
        item.eml_file.delete(save=False)
    item.eml_file.save(filename, ContentFile(payload), save=True)
    return True


def copy_incoming_eml_to_workspace(item, workspace, user):
    from .models import UploadedFile

    if not item.eml_file and not save_incoming_mail_eml(item):
        return None

    item.eml_file.open('rb')
    try:
        content = item.eml_file.read()
    finally:
        item.eml_file.close()

    file_hash = md5(content).hexdigest()
    existing = UploadedFile.objects.filter(workspace=workspace, md5_hash=file_hash).first()
    if existing:
        return existing

    base = slugify(item.parsed_page or item.subject or 'email')[:80] or 'email'
    original_name = f'{base}.eml'
    upload = UploadedFile(
        user=user,
        workspace=workspace,
        original_name=original_name,
        md5_hash=file_hash,
    )
    upload.file.save(original_name, ContentFile(content), save=True)
    return upload
