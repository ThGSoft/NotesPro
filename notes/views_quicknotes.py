import json
import uuid

from django.contrib.auth.decorators import login_required
from django.db.models import Min, Q
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


def _next_sort_order(workspace_id, *, pinned, archived):
    minimum = (
        QuickNote.objects.filter(
            workspace_id=workspace_id,
            pinned=pinned,
            archived=archived,
            deleted=False,
        ).aggregate(m=Min('sort_order'))['m']
    )
    if minimum is None:
        return 0
    return minimum - 1


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
        'sort_order': note.sort_order,
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
    pinned = bool(payload.get('pinned'))
    archived = bool(payload.get('archived'))
    note = QuickNote.objects.create(
        workspace=workspace,
        title=(payload.get('title') or '').strip(),
        body=(payload.get('body') or '').strip(),
        color=_normalize_color(payload.get('color')),
        pinned=pinned,
        checklist=_normalize_checklist(payload.get('checklist', [])),
        archived=archived,
        sort_order=_next_sort_order(workspace.id, pinned=pinned, archived=archived),
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
    pin_changed = False
    if 'title' in payload:
        note.title = (payload.get('title') or '').strip()
    if 'body' in payload:
        note.body = (payload.get('body') or '').strip()
    if 'color' in payload:
        note.color = _normalize_color(payload.get('color'))
    if 'pinned' in payload:
        new_pinned = bool(payload.get('pinned'))
        if new_pinned != note.pinned:
            pin_changed = True
            note.pinned = new_pinned
    if 'archived' in payload:
        note.archived = bool(payload.get('archived'))
    if 'checklist' in payload:
        note.checklist = _normalize_checklist(payload.get('checklist'))
    if 'sort_order' in payload:
        try:
            note.sort_order = int(payload.get('sort_order'))
        except (TypeError, ValueError):
            pass
    elif pin_changed:
        note.sort_order = _next_sort_order(
            note.workspace_id,
            pinned=note.pinned,
            archived=note.archived,
        )
    note.save()
    return JsonResponse(_quick_note_to_dict(note))


@login_required
@require_POST
def quick_note_reorder(request, workspace_id):
    workspace = get_object_or_404(_workspace_qs(request.user), pk=workspace_id)
    if not _user_has_write_access(request.user, workspace):
        return JsonResponse(
            {'status': 'error', 'message': 'You do not have write access to this workspace.'},
            status=403,
        )
    payload = json.loads(request.body or '{}')
    items = payload.get('notes')
    if not isinstance(items, list) or not items:
        return JsonResponse({'status': 'error', 'message': 'notes list required.'}, status=400)

    parsed = []
    seen = set()
    for entry in items:
        if not isinstance(entry, dict):
            continue
        try:
            note_id = int(entry.get('id'))
        except (TypeError, ValueError):
            continue
        if note_id in seen:
            continue
        seen.add(note_id)
        parsed.append((note_id, bool(entry.get('pinned'))))

    if not parsed:
        return JsonResponse({'status': 'error', 'message': 'No valid note ids.'}, status=400)

    qs = _quick_note_qs(request.user).filter(workspace_id=workspace_id, id__in=[p[0] for p in parsed])
    by_id = {n.id: n for n in qs}
    if len(by_id) != len(parsed):
        return JsonResponse({'status': 'error', 'message': 'One or more notes were not found.'}, status=400)

    pinned_index = 0
    unpinned_index = 0
    for note_id, pinned in parsed:
        note = by_id[note_id]
        sort_order = pinned_index if pinned else unpinned_index
        if pinned:
            pinned_index += 1
        else:
            unpinned_index += 1
        if note.pinned != pinned or note.sort_order != sort_order:
            QuickNote.objects.filter(pk=note.pk).update(pinned=pinned, sort_order=sort_order)

    notes = _quick_note_qs(request.user).filter(
        workspace_id=workspace_id,
        id__in=list(by_id.keys()),
    )
    return JsonResponse({
        'notes': [_quick_note_to_dict(n) for n in notes],
    })


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
