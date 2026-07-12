import json
import uuid

from django.contrib.auth.decorators import login_required
from django.db.models import Q
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_GET, require_POST

from .models import QuickNote
from .views import _user_has_write_access, _workspace_qs


def _quick_note_qs(user):
    return QuickNote.objects.filter(
        Q(workspace__owner=user) | Q(workspace__workspacemembership__user=user),
        deleted=False,
        workspace__deleted=False,
    ).distinct()


def _normalize_color(value):
    color = (value or QuickNote.COLOR_DEFAULT).strip().lower()
    if color not in QuickNote.VALID_COLORS:
        return QuickNote.COLOR_DEFAULT
    return color


def _normalize_checklist(raw):
    if not isinstance(raw, list):
        return []
    items = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        text = str(entry.get('text', '')).strip()
        item_id = str(entry.get('id') or uuid.uuid4().hex[:12])
        items.append({
            'id': item_id,
            'text': text[:500],
            'checked': bool(entry.get('checked')),
        })
    return items


def _quick_note_to_dict(note):
    return {
        'id': note.id,
        'workspace': note.workspace_id,
        'title': note.title or '',
        'body': note.body or '',
        'color': note.color,
        'pinned': note.pinned,
        'checklist': note.checklist if isinstance(note.checklist, list) else [],
        'archived': note.archived,
        'created_at': note.created_at.isoformat(),
        'updated_at': note.updated_at.isoformat(),
    }


@login_required
@require_GET
def quick_note_list(request, workspace_id):
    get_object_or_404(_workspace_qs(request.user), pk=workspace_id)
    archived = request.GET.get('archived', '0').lower() in ('1', 'true', 'yes')
    q = (request.GET.get('q') or '').strip().lower()
    notes = _quick_note_qs(request.user).filter(
        workspace_id=workspace_id,
        archived=archived,
    )
    if q:
        notes = notes.filter(Q(title__icontains=q) | Q(body__icontains=q))
    return JsonResponse({
        'notes': [_quick_note_to_dict(n) for n in notes[:200]],
    })


@login_required
@require_POST
def quick_note_create(request, workspace_id):
    workspace = get_object_or_404(_workspace_qs(request.user), pk=workspace_id)
    if not _user_has_write_access(request.user, workspace):
        return JsonResponse(
            {'status': 'error', 'message': 'You do not have write access to this workspace.'},
            status=403,
        )
    payload = json.loads(request.body or '{}')
    note = QuickNote.objects.create(
        workspace=workspace,
        title=(payload.get('title') or '').strip(),
        body=(payload.get('body') or '').strip(),
        color=_normalize_color(payload.get('color')),
        pinned=bool(payload.get('pinned')),
        checklist=_normalize_checklist(payload.get('checklist', [])),
        archived=bool(payload.get('archived')),
    )
    return JsonResponse(_quick_note_to_dict(note))


@login_required
@require_GET
def quick_note_detail(request, pk):
    note = get_object_or_404(_quick_note_qs(request.user), pk=pk)
    return JsonResponse(_quick_note_to_dict(note))


@login_required
@require_POST
def quick_note_update(request, pk):
    note = get_object_or_404(_quick_note_qs(request.user), pk=pk)
    if not _user_has_write_access(request.user, note.workspace):
        return JsonResponse(
            {'status': 'error', 'message': 'You do not have write access to this workspace.'},
            status=403,
        )
    payload = json.loads(request.body or '{}')
    if 'title' in payload:
        note.title = (payload.get('title') or '').strip()
    if 'body' in payload:
        note.body = (payload.get('body') or '').strip()
    if 'color' in payload:
        note.color = _normalize_color(payload.get('color'))
    if 'pinned' in payload:
        note.pinned = bool(payload.get('pinned'))
    if 'archived' in payload:
        note.archived = bool(payload.get('archived'))
    if 'checklist' in payload:
        note.checklist = _normalize_checklist(payload.get('checklist'))
    note.save()
    return JsonResponse(_quick_note_to_dict(note))


@login_required
@require_POST
def quick_note_delete(request, pk):
    note = get_object_or_404(_quick_note_qs(request.user), pk=pk)
    if not _user_has_write_access(request.user, note.workspace):
        return JsonResponse(
            {'status': 'error', 'message': 'You do not have write access to this workspace.'},
            status=403,
        )
    note.deleted = True
    note.save(update_fields=['deleted', 'updated_at'])
    return JsonResponse({'success': True})
