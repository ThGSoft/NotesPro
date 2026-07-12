"""Workspace membership invites and registration hooks."""
from django.contrib.auth import get_user_model

from .email_urls import build_absolute_link
from .email_utils import (
    delivery_hint,
    email_delivery_mode,
    send_owner_new_user_registered_email,
    send_workspace_added_email,
    send_workspace_invite_email,
)
from .models import WorkspaceInvite, WorkspaceMembership, _invite_token

User = get_user_model()


def normalize_member_role(role):
    return role if role in {'read', 'write'} else 'read'


def workspace_member_ids(workspace):
    member_ids = set(
        WorkspaceMembership.objects.filter(workspace=workspace).values_list('user_id', flat=True),
    )
    member_ids.add(workspace.owner_id)
    return member_ids


def invite_or_add_by_email(*, request, workspace, inviter, email, role='read'):
    email = (email or '').strip().lower()
    role = normalize_member_role(role)
    if not email:
        return {'status': 'error', 'message': 'Email is required.', 'http_status': 400}

    existing_user = User.objects.filter(email__iexact=email).first()
    if existing_user and existing_user.id in workspace_member_ids(workspace):
        return {
            'status': 'error',
            'message': 'User is already a member.',
            'http_status': 400,
        }

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
                inviter_name=inviter.get_username(),
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
        return {
            'status': 'success',
            'message': message,
            'added_existing_user': True,
            'email_sent': email_sent,
            'delivery': email_delivery_mode(),
            'username': existing_user.username,
            'http_status': 200,
        }

    invite, created = WorkspaceInvite.objects.get_or_create(
        workspace=workspace,
        email=email,
        accepted=False,
        defaults={'role': role, 'invited_by': inviter},
    )
    if not created:
        invite.role = role
        invite.invited_by = inviter
        invite.token = _invite_token()
        invite.save(update_fields=['role', 'invited_by', 'token'])

    accept_url = build_absolute_link(request, 'accept_workspace_invite', invite.token)
    try:
        send_workspace_invite_email(
            invite=invite,
            accept_url=accept_url,
            inviter_name=inviter.get_username(),
            workspace_name=workspace.name,
        )
    except Exception as exc:
        return {
            'status': 'error',
            'message': f'Could not send email: {exc}',
            'http_status': 500,
        }

    return {
        'status': 'success',
        'message': f'Invitation sent to {email}. {delivery_hint()}',
        'added_existing_user': False,
        'invited': True,
        'email_sent': True,
        'delivery': email_delivery_mode(),
        'invite_link': accept_url,
        'http_status': 200,
    }


def add_existing_user_to_workspace(*, request, workspace, inviter, user, role='read'):
    role = normalize_member_role(role)
    if user.id in workspace_member_ids(workspace):
        return {
            'status': 'error',
            'message': f'{user.username} is already a member of this workspace.',
            'http_status': 400,
        }

    membership, _ = WorkspaceMembership.objects.get_or_create(
        workspace=workspace,
        user=user,
        defaults={'role': role},
    )
    if user.email:
        WorkspaceInvite.objects.filter(
            workspace=workspace, email__iexact=user.email, accepted=False,
        ).update(accepted=True)
        try:
            send_workspace_added_email(
                user=user,
                workspace=workspace,
                inviter_name=inviter.get_username(),
                accept_url=build_absolute_link(request, 'dashboard'),
            )
        except Exception:
            pass

    return {
        'status': 'success',
        'id': user.id,
        'username': user.username,
        'role': membership.role,
        'http_status': 200,
    }


def accept_pending_invites_for_user(user):
    email = (user.email or '').strip()
    if not email:
        return []

    invites = list(
        WorkspaceInvite.objects.filter(
            email__iexact=email,
            accepted=False,
            workspace__deleted=False,
        ).select_related('workspace', 'workspace__owner', 'invited_by'),
    )
    accepted = []
    for invite in invites:
        WorkspaceMembership.objects.get_or_create(
            workspace=invite.workspace,
            user=user,
            defaults={'role': invite.role},
        )
        invite.accepted = True
        invite.save(update_fields=['accepted'])
        accepted.append(invite)
    return accepted


def notify_owners_user_registered(user, accepted_invites):
    if not accepted_invites:
        return
    notified_owner_ids = set()
    for invite in accepted_invites:
        owner = invite.workspace.owner
        if not owner or owner.id == user.id or owner.id in notified_owner_ids:
            continue
        if not owner.email:
            notified_owner_ids.add(owner.id)
            continue
        try:
            send_owner_new_user_registered_email(
                owner=owner,
                new_user=user,
                workspace=invite.workspace,
            )
        except Exception:
            pass
        notified_owner_ids.add(owner.id)
