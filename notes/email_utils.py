from django.conf import settings
from django.core.mail import send_mail
from django.template.loader import render_to_string


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
