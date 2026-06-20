import json

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.http import require_GET, require_POST

from .email_urls import build_absolute_link
from .email_utils import (
    delivery_hint,
    email_delivery_mode,
    send_workspace_added_email,
    send_workspace_invite_email,
)
from .models import (
    WorkspaceChatMessage,
    WorkspaceInvite,
    WorkspaceMailMessage,
    WorkspaceMailRecipient,
    WorkspaceMembership,
    _invite_token,
)
from .views import _workspace_qs

User = get_user_model()


def _workspace_for_user(user, workspace_id):
    return get_object_or_404(_workspace_qs(user), pk=workspace_id)


def _is_workspace_owner(user, workspace):
    return workspace.owner_id == user.id


def _workspace_member_ids(workspace):
    member_ids = set(
        WorkspaceMembership.objects.filter(workspace=workspace).values_list('user_id', flat=True)
    )
    member_ids.add(workspace.owner_id)
    return member_ids


def _parse_recipient_ids(raw):
    ids = []
    for value in raw or []:
        try:
            ids.append(int(value))
        except (TypeError, ValueError):
            continue
    return ids


def _resolve_mail_recipients(workspace, sender, recipient_ids):
    member_ids = _workspace_member_ids(workspace)
    if recipient_ids:
        return [uid for uid in recipient_ids if uid in member_ids and uid != sender.id]
    others = [uid for uid in member_ids if uid != sender.id]
    if others:
        return others
    if sender.id in member_ids:
        return [sender.id]
    return []


def _mail_message_to_dict(message, *, user, box):
    recipient = message.recipients.filter(user=user).first()
    return {
        'id': message.id,
        'subject': message.subject,
        'body': message.body,
        'sender': message.sender.username,
        'sender_id': message.sender_id,
        'created_at': message.created_at.isoformat(),
        'read': bool(recipient and recipient.read_at),
        'box': box,
    }


def _chat_to_dict(message):
    return {
        'id': message.id,
        'body': message.body,
        'attachment_url': message.attachment_url,
        'attachment_name': message.attachment_name,
        'sender': message.sender.username,
        'sender_id': message.sender_id,
        'created_at': message.created_at.isoformat(),
    }


@login_required
@require_POST
def workspace_invite_email(request, workspace_id):
    workspace = _workspace_for_user(request.user, workspace_id)
    if not _is_workspace_owner(request.user, workspace):
        return JsonResponse({'status': 'error', 'message': 'Only the workspace owner can invite.'}, status=403)

    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)

    email = (payload.get('email') or '').strip().lower()
    role = payload.get('role', 'read')
    if role not in {'read', 'write'}:
        role = 'read'
    if not email:
        return JsonResponse({'status': 'error', 'message': 'Email is required.'}, status=400)

    existing_user = User.objects.filter(email__iexact=email).first()
    if existing_user and existing_user.id in _workspace_member_ids(workspace):
        return JsonResponse({'status': 'error', 'message': 'User is already a member.'}, status=400)

    if existing_user:
        WorkspaceMembership.objects.get_or_create(
            workspace=workspace,
            user=existing_user,
            defaults={'role': role},
        )
        WorkspaceInvite.objects.filter(
            workspace=workspace, email__iexact=email, accepted=False,
        ).update(accepted=True)
        dashboard_url = build_absolute_link(request, 'dashboard')
        email_sent = False
        email_error = None
        try:
            send_workspace_added_email(
                user=existing_user,
                workspace=workspace,
                inviter_name=request.user.get_username(),
                accept_url=dashboard_url,
            )
            email_sent = True
        except Exception as exc:
            email_error = str(exc)
        message = f'{existing_user.username} was added to the workspace.'
        if email_sent:
            message += f' {delivery_hint()}'
        elif email_error:
            message += f' (Notification email failed: {email_error})'
        else:
            message += ' (No email on file for that user.)'
        return JsonResponse({
            'status': 'success',
            'message': message,
            'added_existing_user': True,
            'email_sent': email_sent,
            'delivery': email_delivery_mode(),
        })

    invite, created = WorkspaceInvite.objects.get_or_create(
        workspace=workspace,
        email=email,
        accepted=False,
        defaults={'role': role, 'invited_by': request.user},
    )
    if not created:
        invite.role = role
        invite.invited_by = request.user
        invite.token = _invite_token()
        invite.save(update_fields=['role', 'invited_by', 'token'])

    accept_url = build_absolute_link(request, 'accept_workspace_invite', invite.token)
    try:
        send_workspace_invite_email(
            invite=invite,
            accept_url=accept_url,
            inviter_name=request.user.get_username(),
            workspace_name=workspace.name,
        )
    except Exception as exc:
        return JsonResponse({'status': 'error', 'message': f'Could not send email: {exc}'}, status=500)

    hint = delivery_hint()
    return JsonResponse({
        'status': 'success',
        'message': f'Invitation sent to {email}. {hint}',
        'added_existing_user': False,
        'email_sent': True,
        'delivery': email_delivery_mode(),
        'invite_link': accept_url,
    })


def accept_workspace_invite(request, token):
    invite = WorkspaceInvite.objects.filter(
        token=token, accepted=False,
    ).select_related('workspace').first()
    if not invite or invite.workspace.deleted:
        return render(request, 'notes/invite_accept.html', {
            'error': 'This invitation is invalid or has already been used.',
            'site_name': getattr(settings, 'SITE_NAME', 'Django Notes Pro'),
        })

    if request.method == 'POST' and request.user.is_authenticated:
        if request.user.email.lower() != invite.email.lower():
            return render(request, 'notes/invite_accept.html', {
                'error': f'Please log in with {invite.email} to accept this invitation.',
                'site_name': getattr(settings, 'SITE_NAME', 'Django Notes Pro'),
            })
        WorkspaceMembership.objects.get_or_create(
            workspace=invite.workspace,
            user=request.user,
            defaults={'role': invite.role},
        )
        invite.accepted = True
        invite.save(update_fields=['accepted'])
        return render(request, 'notes/invite_accept.html', {
            'success': True,
            'workspace': invite.workspace,
            'site_name': getattr(settings, 'SITE_NAME', 'Django Notes Pro'),
        })

    login_url = f"{reverse('login')}?next={request.path}"
    return render(request, 'notes/invite_accept.html', {
        'invite': invite,
        'login_url': login_url,
        'site_name': getattr(settings, 'SITE_NAME', 'Django Notes Pro'),
    })


@login_required
@require_GET
def workspace_mail_list(request, workspace_id):
    workspace = _workspace_for_user(request.user, workspace_id)
    box = request.GET.get('box', 'inbox')

    if box == 'sent':
        messages = WorkspaceMailMessage.objects.filter(
            workspace=workspace, sender=request.user,
        ).prefetch_related('recipients__user').order_by('-created_at')[:100]
        data = [_mail_message_to_dict(m, user=request.user, box='sent') for m in messages]
    else:
        messages = WorkspaceMailMessage.objects.filter(
            workspace=workspace, recipients__user=request.user,
        ).select_related('sender').distinct().order_by('-created_at')[:100]
        data = [_mail_message_to_dict(m, user=request.user, box='inbox') for m in messages]

    unread = WorkspaceMailRecipient.objects.filter(
        user=request.user,
        message__workspace=workspace,
        read_at__isnull=True,
    ).count()

    return JsonResponse({'status': 'success', 'messages': data, 'unread_count': unread})


@login_required
@require_POST
def workspace_mail_send(request, workspace_id):
    workspace = _workspace_for_user(request.user, workspace_id)
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)

    subject = (payload.get('subject') or '').strip()
    body = (payload.get('body') or '').strip()
    recipient_ids = _parse_recipient_ids(payload.get('recipient_ids'))

    if not subject or not body:
        return JsonResponse({'status': 'error', 'message': 'Subject and body are required.'}, status=400)

    target_ids = _resolve_mail_recipients(workspace, request.user, recipient_ids)
    if not target_ids:
        return JsonResponse({
            'status': 'error',
            'message': 'No valid recipients. Add a workspace member or pick someone from the list.',
        }, status=400)

    message = WorkspaceMailMessage.objects.create(
        workspace=workspace,
        sender=request.user,
        subject=subject,
        body=body,
    )
    WorkspaceMailRecipient.objects.bulk_create([
        WorkspaceMailRecipient(message=message, user_id=uid)
        for uid in target_ids
    ])

    return JsonResponse({
        'status': 'success',
        'message': _mail_message_to_dict(message, user=request.user, box='sent'),
    })


@login_required
@require_POST
def workspace_mail_mark_read(request, workspace_id, message_id):
    workspace = _workspace_for_user(request.user, workspace_id)
    recipient = get_object_or_404(
        WorkspaceMailRecipient,
        message_id=message_id,
        message__workspace=workspace,
        user=request.user,
    )
    if not recipient.read_at:
        recipient.read_at = timezone.now()
        recipient.save(update_fields=['read_at'])
    return JsonResponse({'status': 'success'})


@login_required
@require_GET
def workspace_chat_list(request, workspace_id):
    workspace = _workspace_for_user(request.user, workspace_id)
    after_id = request.GET.get('after')
    qs = WorkspaceChatMessage.objects.filter(workspace=workspace).select_related('sender')
    if after_id:
        try:
            qs = qs.filter(id__gt=int(after_id)).order_by('id')
            return JsonResponse({
                'status': 'success',
                'messages': [_chat_to_dict(m) for m in qs],
            })
        except (TypeError, ValueError):
            pass
    messages = list(reversed(list(qs.order_by('-created_at')[:80])))
    return JsonResponse({
        'status': 'success',
        'messages': [_chat_to_dict(m) for m in messages],
    })


@login_required
@require_POST
def workspace_chat_send(request, workspace_id):
    workspace = _workspace_for_user(request.user, workspace_id)
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)

    body = (payload.get('body') or '').strip()
    attachment_url = (payload.get('attachment_url') or '').strip()
    attachment_name = (payload.get('attachment_name') or '').strip()
    if not body and not attachment_url:
        return JsonResponse({'status': 'error', 'message': 'Message cannot be empty.'}, status=400)
    if len(body) > 4000:
        return JsonResponse({'status': 'error', 'message': 'Message is too long.'}, status=400)
    if attachment_url and len(attachment_url) > 500:
        return JsonResponse({'status': 'error', 'message': 'Attachment URL is too long.'}, status=400)

    message = WorkspaceChatMessage.objects.create(
        workspace=workspace,
        sender=request.user,
        body=body,
        attachment_url=attachment_url,
        attachment_name=attachment_name,
    )
    return JsonResponse({'status': 'success', 'message': _chat_to_dict(message)})
