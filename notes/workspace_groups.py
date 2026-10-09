"""Keep WorkspaceMembership in sync with auth.Group workspace assignments."""
from django.contrib.auth.models import Group, User
from django.db.models.signals import m2m_changed
from django.dispatch import receiver

from .models import Workspace, WorkspaceMembership

GROUP_MEMBER_ROLE = 'read'


def _grant_group_workspace(user, workspace):
    if not user or not workspace or workspace.deleted:
        return
    if user.id == workspace.owner_id:
        return
    WorkspaceMembership.objects.get_or_create(
        workspace=workspace,
        user=user,
        defaults={'role': GROUP_MEMBER_ROLE, 'via_group': True},
    )


def _workspace_ids_for_user_groups(user):
    return set(
        Workspace.objects.filter(
            deleted=False,
            groups__in=user.groups.all(),
        ).exclude(owner=user).values_list('pk', flat=True).distinct()
    )


def _user_ids_for_workspace_groups(workspace):
    return set(
        User.objects.filter(groups__in=workspace.groups.all())
        .exclude(pk=workspace.owner_id)
        .values_list('pk', flat=True)
        .distinct()
    )


def sync_user_group_workspaces(user):
    if not user or not getattr(user, 'pk', None):
        return
    wanted = _workspace_ids_for_user_groups(user)
    for workspace in Workspace.objects.filter(pk__in=wanted):
        _grant_group_workspace(user, workspace)
    WorkspaceMembership.objects.filter(user=user, via_group=True).exclude(
        workspace_id__in=wanted,
    ).delete()


def sync_workspace_group_members(workspace):
    if not workspace or not getattr(workspace, 'pk', None):
        return
    wanted = _user_ids_for_workspace_groups(workspace)
    for user in User.objects.filter(pk__in=wanted):
        _grant_group_workspace(user, workspace)
    WorkspaceMembership.objects.filter(workspace=workspace, via_group=True).exclude(
        user_id__in=wanted,
    ).delete()


def _sync_users(user_ids):
    for user in User.objects.filter(pk__in=user_ids):
        sync_user_group_workspaces(user)


def _sync_workspaces(workspace_ids):
    for workspace in Workspace.objects.filter(pk__in=workspace_ids):
        sync_workspace_group_members(workspace)


@receiver(m2m_changed, sender=User.groups.through)
def user_groups_changed(sender, instance, action, reverse, pk_set, **kwargs):
    if action not in {'post_add', 'post_remove', 'post_clear'}:
        return
    if reverse:
        group = instance
        if pk_set:
            _sync_users(pk_set)
        else:
            _sync_workspaces(group.shared_workspaces.values_list('pk', flat=True))
            _sync_users(
                WorkspaceMembership.objects.filter(
                    via_group=True,
                    workspace__in=group.shared_workspaces.all(),
                ).values_list('user_id', flat=True)
            )
        return
    sync_user_group_workspaces(instance)


@receiver(m2m_changed, sender=Workspace.groups.through)
def workspace_groups_changed(sender, instance, action, reverse, pk_set, **kwargs):
    if action not in {'post_add', 'post_remove', 'post_clear'}:
        return
    if reverse:
        group = instance
        if pk_set:
            _sync_workspaces(pk_set)
        else:
            _sync_users(group.user_set.values_list('pk', flat=True))
        return
    sync_workspace_group_members(instance)
