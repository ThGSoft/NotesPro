"""Render incoming email metadata + body as PDF."""

import re

from django.core.files.base import ContentFile
from django.utils.text import slugify
from fpdf import FPDF


def _pdf_safe(text):
    return (text or '').encode('latin-1', errors='replace').decode('latin-1')


def _pdf_filename(item):
    base = slugify(item.parsed_page or item.subject or f'incoming-{item.pk}')[:80] or f'incoming-{item.pk}'
    return f'{base}-{item.pk}.pdf'


def _pdf_write_paragraph(pdf, text, line_height=5):
    width = pdf.epw
    for paragraph in re.sub(r'\r\n?', '\n', text or '').split('\n'):
        chunk = _pdf_safe(paragraph) or ' '
        pdf.multi_cell(width, line_height, chunk)
        pdf.ln(1)


def build_email_pdf_bytes(*, subject, sender, body, received_at=None, route_hint=''):
    from .incoming_mail import split_email_body_appendix, strip_notespro_lines

    main, appendix = split_email_body_appendix(body)
    main = strip_notespro_lines(main)

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()
    pdf.set_margins(15, 15, 15)
    pdf.set_font('Helvetica', style='B', size=14)
    _pdf_write_paragraph(pdf, subject or '(no subject)', line_height=8)
    pdf.ln(2)

    pdf.set_font('Helvetica', size=10)
    meta_lines = []
    if sender:
        meta_lines.append(f'From: {sender}')
    if received_at:
        meta_lines.append(f'Received: {received_at.strftime("%Y-%m-%d %H:%M UTC")}')
    if route_hint:
        meta_lines.append(f'Route: {route_hint[:500]}')
    for line in meta_lines:
        _pdf_write_paragraph(pdf, line)
    pdf.ln(2)

    pdf.set_font('Helvetica', style='B', size=11)
    pdf.cell(pdf.epw, 6, 'Message')
    pdf.ln(8)
    pdf.set_font('Helvetica', size=10)
    message_text = main or (appendix and '—') or '(empty body)'
    _pdf_write_paragraph(pdf, message_text)

    if appendix:
        pdf.ln(4)
        pdf.set_font('Helvetica', style='B', size=11)
        pdf.cell(pdf.epw, 6, 'Appendix')
        pdf.ln(8)
        pdf.set_font('Helvetica', size=10)
        _pdf_write_paragraph(pdf, appendix)

    return pdf.output()


def ensure_incoming_mail_pdf(item, *, route_hint=''):
    if not item.pk:
        return False
    try:
        pdf_bytes = build_email_pdf_bytes(
            subject=item.subject,
            sender=item.sender_email,
            body=item.body,
            received_at=item.received_at,
            route_hint=route_hint or '',
        )
    except Exception:
        return False
    filename = _pdf_filename(item)
    if item.pdf_file:
        item.pdf_file.delete(save=False)
    item.pdf_file.save(filename, ContentFile(pdf_bytes), save=True)
    return True


def copy_incoming_pdf_to_workspace(item, workspace, user):
    """Copy incoming PDF into workspace uploads; return UploadedFile or None."""
    from hashlib import md5

    from .incoming_mail import format_route_hint
    from .models import UploadedFile

    if not ensure_incoming_mail_pdf(item, route_hint=format_route_hint(item)):
        return None

    item.pdf_file.open('rb')
    try:
        content = item.pdf_file.read()
    finally:
        item.pdf_file.close()

    file_hash = md5(content).hexdigest()
    existing = UploadedFile.objects.filter(workspace=workspace, md5_hash=file_hash).first()
    if existing:
        return existing

    base = slugify(item.parsed_page or item.subject or 'email')[:80] or 'email'
    original_name = f'{base}.pdf'
    upload = UploadedFile(
        user=user,
        workspace=workspace,
        original_name=original_name,
        md5_hash=file_hash,
    )
    upload.file.save(original_name, ContentFile(content), save=True)
    return upload
