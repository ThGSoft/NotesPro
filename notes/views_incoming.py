import json

from django.contrib.auth.decorators import login_required
from django.db import models
from django.http import FileResponse, JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.http import require_GET, require_POST

from .email_eml import copy_incoming_eml_to_workspace, save_incoming_mail_eml
from .email_pdf import copy_incoming_pdf_to_workspace, ensure_incoming_mail_pdf
from .incoming_mail import (
    build_incoming_page_markdown,
    fetch_incoming_mails,
    format_route_hint,
    imap_settings_configured,
    incoming_mail_to_dict,
)
from .models import IncomingMail, Page, Workspace
from .tags import sync_page_tags
from .views import _active_pages, _page_qs, _user_has_write_access, _workspace_qs


def _incoming_qs(user):
    return IncomingMail.objects.filter(recipient=user)


def _find_workspace_for_hint(user, hint):
    hint = (hint or '').strip()
    if not hint:
        return None
    return _workspace_qs(user).filter(
        models.Q(slug__iexact=hint) | models.Q(name__iexact=hint),
    ).first()


def _find_folder_for_hint(workspace, folder_hint):
    folder_hint = (folder_hint or '').strip()
    if not folder_hint or not workspace:
        return None
    parts = [part.strip() for part in folder_hint.replace('\\', '/').split('/') if part.strip()]
    if not parts:
        return None
    parent = None
    for part in parts:
        folder = _active_pages(workspace).filter(
            is_folder=True,
            parent=parent,
            title__iexact=part,
        ).first()
        if not folder:
            return None
        parent = folder
    return parent


def _resolve_incoming_route(user, item):
    ws_hint = (item.parsed_workspace or '').strip()
    folder_hint = (item.parsed_folder or '').strip()
    workspace = _find_workspace_for_hint(user, ws_hint) if ws_hint else None
    folder = _find_folder_for_hint(workspace, folder_hint) if workspace and folder_hint else None
    return {
        'parsed_workspace': ws_hint,
        'parsed_folder': folder_hint,
        'workspace_found': bool(workspace) if ws_hint else None,
        'workspace_id': workspace.id if workspace else None,
        'workspace_name': workspace.name if workspace else None,
        'folder_found': bool(folder) if folder_hint else None,
        'folder_id': folder.id if folder else None,
        'folder_name': folder.title if folder else None,
        'needs_workspace_select': bool(ws_hint) and workspace is None,
        'needs_folder_select': bool(folder_hint) and workspace is not None and folder is None,
    }


@login_required
@require_GET
def incoming_mail_list(request):
    status = request.GET.get('status', IncomingMail.STATUS_PENDING)
    qs = _incoming_qs(request.user)
    if status and status != 'all':
        qs = qs.filter(status=status)
    items = [incoming_mail_to_dict(m, request) for m in qs[:100]]
    return JsonResponse({
        'status': 'success',
        'items': items,
        'imap_configured': imap_settings_configured(),
    })


@login_required
@require_POST
def incoming_mail_fetch(request):
    if not imap_settings_configured():
        return JsonResponse({
            'status': 'error',
            'message': 'IMAP not configured. Set INCOMING_MAIL_IMAP_* in environment.',
        }, status=400)
    try:
        result = fetch_incoming_mails()
    except Exception as exc:
        return JsonResponse({'status': 'error', 'message': str(exc)}, status=500)
    pending = _incoming_qs(request.user).filter(status=IncomingMail.STATUS_PENDING).count()
    return JsonResponse({
        'status': 'success',
        'fetch': result,
        'pending_count': pending,
    })


@login_required
@require_POST
def incoming_mail_dismiss(request, mail_id):
    item = get_object_or_404(_incoming_qs(request.user), pk=mail_id)
    if item.status != IncomingMail.STATUS_PENDING:
        return JsonResponse({'status': 'error', 'message': 'Already processed.'}, status=400)
    item.status = IncomingMail.STATUS_DISMISSED
    item.save(update_fields=['status'])
    return JsonResponse({'status': 'success'})


@login_required
@require_POST
def incoming_mail_distribute(request, mail_id):
    item = get_object_or_404(_incoming_qs(request.user), pk=mail_id)
    if item.status != IncomingMail.STATUS_PENDING:
        return JsonResponse({'status': 'error', 'message': 'Already processed.'}, status=400)

    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)

    workspace_id = payload.get('workspace_id')
    if not workspace_id:
        return JsonResponse({'status': 'error', 'message': 'workspace_id is required.'}, status=400)

    route = _resolve_incoming_route(request.user, item)

    workspace = get_object_or_404(_workspace_qs(request.user), pk=workspace_id)
    if not _user_has_write_access(request.user, workspace):
        return JsonResponse({'status': 'error', 'message': 'Write access required.'}, status=403)

    parent_id = payload.get('parent_id')
    parent = None
    if parent_id and parent_id not in ('', '#', None):
        parent = get_object_or_404(
            _page_qs(request.user),
            pk=parent_id,
            workspace=workspace,
            is_folder=True,
        )

    if route['needs_folder_select'] and not parent:
        return JsonResponse({
            'status': 'error',
            'message': f'Folder "{route["parsed_folder"]}" not found. Select a folder.',
            'needs_folder_select': True,
        }, status=400)

    title = (payload.get('title') or item.parsed_page or item.subject or 'Imported mail').strip()
    if not title:
        title = 'Imported mail'

    body = (item.body or '').strip()
    eml_upload = copy_incoming_eml_to_workspace(item, workspace, request.user)
    pdf_upload = copy_incoming_pdf_to_workspace(item, workspace, request.user)
    markdown = build_incoming_page_markdown(title, body, pdf_upload=pdf_upload, eml_upload=eml_upload)

    max_sort = _active_pages(workspace).filter(parent=parent).aggregate(
        models.Max('sort_order'),
    )['sort_order__max'] or 0

    page = Page.objects.create(
        workspace=workspace,
        parent=parent,
        title=title[:255],
        is_folder=False,
        sort_order=max_sort + 1,
        markdown_content=markdown,
    )
    sync_page_tags(page)

    item.status = IncomingMail.STATUS_DISTRIBUTED
    item.distributed_page = page
    item.distributed_at = timezone.now()
    item.save(update_fields=['status', 'distributed_page', 'distributed_at'])

    from .views import _page_to_dict

    return JsonResponse({
        'status': 'success',
        'page': _page_to_dict(page),
        'mail': incoming_mail_to_dict(item, request),
    })


@login_required
@require_GET
def incoming_mail_eml(request, mail_id):
    item = get_object_or_404(_incoming_qs(request.user), pk=mail_id)
    if not item.eml_file:
        save_incoming_mail_eml(item)
    if not item.eml_file:
        return JsonResponse({'status': 'error', 'message': 'EML could not be saved.'}, status=404)
    item.refresh_from_db(fields=['eml_file'])
    filename = item.eml_file.name.rsplit('/', 1)[-1]
    response = FileResponse(item.eml_file.open('rb'), content_type='message/rfc822')
    response['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response


@login_required
@require_GET
def incoming_mail_pdf(request, mail_id):
    item = get_object_or_404(_incoming_qs(request.user), pk=mail_id)
    ensure_incoming_mail_pdf(item, route_hint=format_route_hint(item))
    if not item.pdf_file:
        return JsonResponse({'status': 'error', 'message': 'PDF could not be generated.'}, status=404)
    item.refresh_from_db(fields=['pdf_file'])
    filename = item.pdf_file.name.rsplit('/', 1)[-1]
    response = FileResponse(item.pdf_file.open('rb'), content_type='application/pdf')
    response['Content-Disposition'] = f'inline; filename="{filename}"'
    return response


@login_required
@require_GET
def incoming_mail_resolve_route(request, mail_id):
    """Match parsed workspace/folder; flag when user must select manually."""
    item = get_object_or_404(_incoming_qs(request.user), pk=mail_id)
    route = _resolve_incoming_route(request.user, item)
    return JsonResponse({'status': 'success', **route})


@login_required
@require_GET
def incoming_mail_suggest_workspace(request, mail_id):
    """Backward-compatible alias for workspace id only."""
    item = get_object_or_404(_incoming_qs(request.user), pk=mail_id)
    route = _resolve_incoming_route(request.user, item)
    return JsonResponse({
        'status': 'success',
        'workspace_id': route['workspace_id'],
        'workspace_name': route['workspace_name'],
    })
