import json

from django.contrib.auth import get_user_model
from django.contrib.auth.decorators import login_required
from django.db import transaction
from django.db.models import Max, Q
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_GET, require_POST

from .models import Issue, Page, WorkspaceMembership
from .views import _user_has_write_access, _workspace_qs

User = get_user_model()


def _issue_qs(user):
    return Issue.objects.filter(
        Q(workspace__owner=user) |
        Q(workspace__workspacemembership__user=user) |
        Q(workspace__groups__in=user.groups.all()),
        deleted=False,
        workspace__deleted=False,
    ).select_related('assignee', 'reporter', 'page').distinct()


def _normalize_status(value):
    status = (value or Issue.STATUS_OPEN).strip().lower()
    if status not in Issue.VALID_STATUSES:
        return Issue.STATUS_OPEN
    return status


def _normalize_priority(value):
    priority = (value or Issue.PRIORITY_NORMAL).strip().lower()
    if priority not in Issue.VALID_PRIORITIES:
        return Issue.PRIORITY_NORMAL
    return priority


def _normalize_labels(raw):
    if isinstance(raw, str):
        parts = [p.strip() for p in raw.split(',') if p.strip()]
    elif isinstance(raw, list):
        parts = [str(p).strip() for p in raw if str(p).strip()]
    else:
        parts = []
    return [p[:40] for p in parts[:20]]


def _workspace_member_ids(workspace):
    ids = {workspace.owner_id}
    ids.update(
        WorkspaceMembership.objects.filter(workspace_id=workspace.id).values_list('user_id', flat=True)
    )
    return ids


def _resolve_assignee(workspace, assignee_id):
    if assignee_id in (None, '', 0, '0'):
        return None
    try:
        user_id = int(assignee_id)
    except (TypeError, ValueError):
        return None
    if user_id not in _workspace_member_ids(workspace):
        return None
    return User.objects.filter(pk=user_id).first()


def _resolve_page(workspace, page_id):
    if page_id in (None, '', 0, '0'):
        return None
    try:
        pk = int(page_id)
    except (TypeError, ValueError):
        return None
    return Page.objects.filter(pk=pk, workspace_id=workspace.id, deleted=False, is_folder=False).first()


@transaction.atomic
def _next_issue_number(workspace_id):
    current = (
        Issue.objects.filter(workspace_id=workspace_id)
        .select_for_update()
        .aggregate(m=Max('number'))['m']
    )
    return (current or 0) + 1


def _user_label(user):
    if not user:
        return ''
    return user.username or user.get_username() or str(user.pk)


def _issue_to_dict(issue):
    return {
        'id': issue.id,
        'workspace': issue.workspace_id,
        'number': issue.number,
        'title': issue.title or '',
        'body': issue.body or '',
        'status': issue.status,
        'priority': issue.priority,
        'assignee': issue.assignee_id,
        'assignee_username': _user_label(issue.assignee),
        'reporter': issue.reporter_id,
        'reporter_username': _user_label(issue.reporter),
        'page': issue.page_id,
        'page_title': issue.page.title if issue.page_id else '',
        'labels': issue.labels if isinstance(issue.labels, list) else [],
        'created_at': issue.created_at.isoformat(),
        'updated_at': issue.updated_at.isoformat(),
    }


@login_required
@require_GET
def issue_list(request, workspace_id):
    get_object_or_404(_workspace_qs(request.user), pk=workspace_id)
    status = (request.GET.get('status') or '').strip().lower()
    q = (request.GET.get('q') or '').strip().lower()
    issues = _issue_qs(request.user).filter(workspace_id=workspace_id)
    if status and status in Issue.VALID_STATUSES:
        issues = issues.filter(status=status)
    elif status != '__all__':
        issues = issues.exclude(status=Issue.STATUS_CLOSED)
    if q:
        issues = issues.filter(Q(title__icontains=q) | Q(body__icontains=q))
    items = [_issue_to_dict(i) for i in issues[:300]]
    open_count = _issue_qs(request.user).filter(
        workspace_id=workspace_id,
    ).exclude(status=Issue.STATUS_CLOSED).count()
    return JsonResponse({'issues': items, 'open_count': open_count})


@login_required
@require_POST
def issue_create(request, workspace_id):
    workspace = get_object_or_404(_workspace_qs(request.user), pk=workspace_id)
    if not _user_has_write_access(request.user, workspace):
        return JsonResponse(
            {'status': 'error', 'message': 'You do not have write access to this workspace.'},
            status=403,
        )
    payload = json.loads(request.body or '{}')
    assignee = _resolve_assignee(workspace, payload.get('assignee'))
    page = _resolve_page(workspace, payload.get('page'))
    issue = Issue.objects.create(
        workspace=workspace,
        number=_next_issue_number(workspace.id),
        title=(payload.get('title') or '').strip(),
        body=(payload.get('body') or '').strip(),
        status=_normalize_status(payload.get('status')),
        priority=_normalize_priority(payload.get('priority')),
        assignee=assignee,
        reporter=request.user,
        page=page,
        labels=_normalize_labels(payload.get('labels')),
    )
    issue = _issue_qs(request.user).get(pk=issue.pk)
    return JsonResponse(_issue_to_dict(issue))


@login_required
@require_GET
def issue_detail(request, pk):
    issue = get_object_or_404(_issue_qs(request.user), pk=pk)
    return JsonResponse(_issue_to_dict(issue))


@login_required
@require_POST
def issue_update(request, pk):
    issue = get_object_or_404(_issue_qs(request.user), pk=pk)
    if not _user_has_write_access(request.user, issue.workspace):
        return JsonResponse(
            {'status': 'error', 'message': 'You do not have write access to this workspace.'},
            status=403,
        )
    payload = json.loads(request.body or '{}')
    if 'title' in payload:
        issue.title = (payload.get('title') or '').strip()
    if 'body' in payload:
        issue.body = (payload.get('body') or '').strip()
    if 'status' in payload:
        issue.status = _normalize_status(payload.get('status'))
    if 'priority' in payload:
        issue.priority = _normalize_priority(payload.get('priority'))
    if 'assignee' in payload:
        issue.assignee = _resolve_assignee(issue.workspace, payload.get('assignee'))
    if 'page' in payload:
        issue.page = _resolve_page(issue.workspace, payload.get('page'))
    if 'labels' in payload:
        issue.labels = _normalize_labels(payload.get('labels'))
    issue.save()
    issue = _issue_qs(request.user).get(pk=issue.pk)
    return JsonResponse(_issue_to_dict(issue))


@login_required
@require_POST
def issue_delete(request, pk):
    issue = get_object_or_404(_issue_qs(request.user), pk=pk)
    if not _user_has_write_access(request.user, issue.workspace):
        return JsonResponse(
            {'status': 'error', 'message': 'You do not have write access to this workspace.'},
            status=403,
        )
    issue.deleted = True
    issue.save(update_fields=['deleted', 'updated_at'])
    return JsonResponse({'success': True})
