import logging

from django.conf import settings
from django.core.mail import send_mail
from django.template.loader import render_to_string

logger = logging.getLogger(__name__)


def email_delivery_mode():
    backend = getattr(settings, 'EMAIL_BACKEND', '')
    if 'smtp' in backend:
        return 'smtp'
    if 'filebased' in backend:
        return 'file'
    return 'console'


def delivery_hint():
    mode = email_delivery_mode()
    if mode == 'smtp':
        return 'Email was sent via SMTP.'
    if mode == 'file':
        path = getattr(settings, 'EMAIL_FILE_PATH', 'sent_emails')
        return f'Email saved to {path} (file backend).'
    return 'Email printed in the terminal where runserver is running (console backend).'


def send_workspace_invite_email(*, invite, accept_url, inviter_name, workspace_name):
    subject = f'Invitation to workspace "{workspace_name}" on {settings.SITE_NAME}'
    body = render_to_string('notes/emails/workspace_invite.txt', {
        'inviter_name': inviter_name,
        'workspace_name': workspace_name,
        'accept_url': accept_url,
        'role': invite.get_role_display(),
        'site_name': settings.SITE_NAME,
    })
    send_mail(
        subject,
        body,
        settings.DEFAULT_FROM_EMAIL,
        [invite.email],
        fail_silently=False,
    )
    logger.info('Invite email sent to %s (%s)', invite.email, email_delivery_mode())


def send_workspace_added_email(*, user, workspace, inviter_name, accept_url=None):
    """Notify an existing account they were added to a workspace."""
    subject = f'You were added to "{workspace.name}" on {settings.SITE_NAME}'
    lines = [
        f'Hello {user.username},',
        '',
        f'{inviter_name} added you to the workspace "{workspace.name}".',
        '',
    ]
    if accept_url:
        lines.extend(['Open the workspace:', accept_url, ''])
    lines.append(f'— {settings.SITE_NAME}')
    body = '\n'.join(lines)
    if not user.email:
        raise ValueError('User has no email address on file.')
    send_mail(
        subject,
        body,
        settings.DEFAULT_FROM_EMAIL,
        [user.email],
        fail_silently=False,
    )
    logger.info('Added-to-workspace email sent to %s', user.email)


def send_owner_new_user_registered_email(*, owner, new_user, workspace):
    from django.conf import settings as django_settings
    from .email_urls import build_absolute_link_from_settings

    dashboard_url = build_absolute_link_from_settings('dashboard')
    subject = f'{new_user.username} joined "{workspace.name}" on {django_settings.SITE_NAME}'
    body = render_to_string('notes/emails/owner_new_user_registered.txt', {
        'owner_username': owner.get_username(),
        'new_username': new_user.get_username(),
        'new_email': new_user.email or '(no email)',
        'workspace_name': workspace.name,
        'dashboard_url': dashboard_url,
        'site_name': django_settings.SITE_NAME,
    })
    if not owner.email:
        raise ValueError('Owner has no email address on file.')
    send_mail(
        subject,
        body,
        django_settings.DEFAULT_FROM_EMAIL,
        [owner.email],
        fail_silently=False,
    )
    logger.info('Owner notified: %s registered for workspace %s', new_user.username, workspace.id)
