from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.contrib.auth import login
from django.contrib.auth.decorators import login_required
from django.db import models, transaction
from django.http import HttpResponseBadRequest, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.conf import settings as django_settings
from django.views.decorators.http import require_GET, require_POST
from .forms import RegisterForm
from .models import Page, Workspace, UploadedFile, PastedFile, \
                    UserSettings, User, \
                    WorkspaceMembership
from django.shortcuts import get_object_or_404
from django.core.files.storage import default_storage
import json
import os, urllib, hashlib, re, zipfile
from pathlib import Path
from urllib.parse import urlparse
from django.contrib.auth.models import User
from django.db.models import Q
from django.utils.text import slugify
from .workspace_io import export_workspace_archive, import_workspace_archive
from .tags import (
    list_workspace_tag_names,
    page_tag_names,
    search_workspace_pages_by_tag,
    sync_page_tags,
)
from .models import WorkspaceInvite
from .workspace_members import (
    accept_pending_invites_for_user,
    add_existing_user_to_workspace,
    invite_or_add_by_email,
    notify_owners_user_registered,
)


def _workspace_qs(user):
    return Workspace.objects.filter(
        Q(owner=user) |
        Q(workspacemembership__user=user),
        deleted=False,
    ).distinct()


def _page_qs(user):
    """
    Gibt alle Seiten aus Workspaces zurück, auf die der User Zugriff hat
    (entweder als Besitzer oder als eingeladenes Mitglied).
    """
    return Page.objects.filter(
        Q(workspace__owner=user) |
        Q(workspace__workspacemembership__user=user),
        deleted=False,
        workspace__deleted=False,
    ).distinct()


def _active_pages(workspace):
    return workspace.pages.filter(deleted=False)


def _saved_page_id_for_workspace(user_settings, workspace):
    """Last opened page id for *workspace*, or None."""
    pages = user_settings.workspace_pages if isinstance(user_settings.workspace_pages, dict) else {}
    page_id = pages.get(str(workspace.id))
    if page_id is None and user_settings.last_workspace_id == workspace.id:
        page_id = user_settings.last_page_id
    if page_id is None:
        return None
    try:
        return int(page_id)
    except (TypeError, ValueError):
        return None


def _saved_page_for_workspace(user_settings, workspace):
    page_id = _saved_page_id_for_workspace(user_settings, workspace)
    if not page_id:
        return None
    return _active_pages(workspace).filter(id=page_id, is_folder=False).first()


def _set_workspace_page(user_settings, workspace_id, page_id):
    pages = dict(user_settings.workspace_pages or {}) if isinstance(user_settings.workspace_pages, dict) else {}
    ws_key = str(workspace_id)
    if page_id:
        pages[ws_key] = int(page_id)
    else:
        pages.pop(ws_key, None)
    user_settings.workspace_pages = pages


def _soft_delete_page(page):
    descendant_ids = _page_subtree_ids(page)
    Page.objects.filter(id__in=descendant_ids).update(deleted=True)


def _page_subtree_ids(root):
    ids = []
    stack = [root.id]
    while stack:
        pid = stack.pop()
        ids.append(pid)
        stack.extend(
            Page.objects.filter(parent_id=pid, workspace_id=root.workspace_id, deleted=False)
            .values_list('id', flat=True)
        )
    return ids


def _user_has_write_access(user, workspace):
    if workspace.owner_id == user.id:
        return True
    return WorkspaceMembership.objects.filter(
        workspace=workspace, user=user, role='write',
    ).exists()


def _reindex_page_siblings(workspace, parent):
    siblings = list(
        _active_pages(workspace).filter(parent=parent).order_by('sort_order', 'id'),
    )
    for idx, sibling in enumerate(siblings):
        if sibling.sort_order != idx:
            sibling.sort_order = idx
            sibling.save(update_fields=['sort_order'])


def _insert_page_among_siblings(workspace, parent, page, position):
    siblings = list(
        _active_pages(workspace)
        .filter(parent=parent)
        .exclude(pk=page.pk)
        .order_by('sort_order', 'id'),
    )
    position = max(0, min(int(position), len(siblings)))
    siblings.insert(position, page)
    for idx, sibling in enumerate(siblings):
        if sibling.sort_order != idx:
            sibling.sort_order = idx
            sibling.save(update_fields=['sort_order'])


def _move_page_subtree_to_workspace(root_page, target_workspace, target_parent=None):
    if target_parent is not None and (
        target_parent.workspace_id != target_workspace.id or not target_parent.is_folder
    ):
        raise ValueError('Invalid target parent.')

    subtree_ids = _page_subtree_ids(root_page)
    pages = list(Page.objects.filter(id__in=subtree_ids, deleted=False))
    id_to_page = {p.id: p for p in pages}

    max_sort = _active_pages(target_workspace).filter(parent=target_parent).aggregate(
        models.Max('sort_order'),
    )['sort_order__max'] or 0

    bfs_order = []
    queue = [root_page.id]
    while queue:
        pid = queue.pop(0)
        page = id_to_page.get(pid)
        if page:
            bfs_order.append(page)
        for child_id in Page.objects.filter(
            parent_id=pid, id__in=subtree_ids, deleted=False,
        ).order_by('sort_order', 'id').values_list('id', flat=True):
            queue.append(child_id)

    for page in bfs_order:
        page.workspace = target_workspace
        page.slug = ''
        if page.id == root_page.id:
            page.parent = target_parent
            page.sort_order = max_sort + 1
        page.save()


def _soft_delete_workspace(workspace):
    workspace.pages.update(deleted=True)
    workspace.deleted = True
    workspace.save(update_fields=['deleted'])


def _restore_workspace(workspace):
    workspace.deleted = False
    workspace.save(update_fields=['deleted'])
    workspace.pages.update(deleted=False)

def _page_to_dict(page):
    return {
        'id': page.id,
        'workspace': page.workspace_id,
        'parent': page.parent_id,
        'title': page.title,
        'slug': page.slug,
        'is_folder': page.is_folder,
        'sort_order': page.sort_order,
        'markdown_content': page.markdown_content,
        'tags': page_tag_names(page),
    }


def _broadcast_tags_updated(workspace_id, page_id):
    channel_layer = get_channel_layer()
    if not channel_layer:
        return
    async_to_sync(channel_layer.group_send)(
        f'workspace_tags_{workspace_id}',
        {'type': 'tags_updated', 'page_id': page_id},
    )



def _workspace_display_name(ws, user):
    if ws.owner_id == user.id:
        return ws.name or ''
    return f'{ws.owner.username}: {ws.name}'


def _sort_workspaces(workspaces, user):
    def sort_key(ws):
        owned = ws.owner_id == user.id
        return (0 if owned else 1, _workspace_display_name(ws, user).casefold())

    return sorted(workspaces, key=sort_key)


def _tree_data(user, workspace):
    pages = list(_active_pages(workspace))

    children_by_parent = {}
    for page in pages:
        children_by_parent.setdefault(page.parent_id, []).append(page)

    def sibling_sort_key(page):
        return (page.sort_order, page.id)

    for siblings in children_by_parent.values():
        siblings.sort(key=sibling_sort_key)

    flat = []

    def emit(parent_id):
        for page in children_by_parent.get(parent_id, []):
            flat.append({
                'id': str(page.id),
                'parent': str(page.parent_id) if page.parent_id else '#',
                'text': page.title,
                'type': 'folder' if page.is_folder else 'page',
                'data': {
                    'slug': page.slug,
                    'is_folder': page.is_folder,
                    'workspace': page.workspace_id,
                },
            })
            emit(page.id)

    emit(None)
    return flat


def register_view(request):
    if request.user.is_authenticated:
        return redirect('dashboard')
    initial = {}
    email = (request.GET.get('email') or '').strip()
    if email:
        initial['email'] = email
    form = RegisterForm(request.POST or None, initial=initial)
    if request.method == 'POST' and form.is_valid():
        user = form.save()
        accepted_invites = accept_pending_invites_for_user(user)
        notify_owners_user_registered(user, accepted_invites)
        login(request, user)
        if not _workspace_qs(user).exists():
            Workspace.objects.create(owner=user, name='Main', slug='main')
        return redirect('dashboard')
    return render(request, 'registration/register.html', {'form': form})

@login_required
def dashboard(request):
    # 1. Sicherstellen, dass Workspaces existieren
    workspaces = _workspace_qs(request.user).select_related('owner')
    if not workspaces.exists():
        Workspace.objects.create(owner=request.user, name='Main', slug='main')
        workspaces = _workspace_qs(request.user).select_related('owner')

    workspaces_list = _sort_workspaces(list(workspaces), request.user)

    # 2. UserSettings abrufen (get_or_create verhindert "User has no settings")
    settings, _ = UserSettings.objects.get_or_create(user=request.user)

    # 3. Workspace ermitteln: Entweder der letzte aus den Settings oder der erste verfügbare
    current_workspace = None
    if settings.last_workspace_id:
        current_workspace = next(
            (ws for ws in workspaces_list if ws.id == settings.last_workspace_id),
            None,
        )
    
    if not current_workspace:
        current_workspace = workspaces_list[0] if workspaces_list else None

    # 4. Seite ermitteln: zuletzt geöffnete Seite dieses Workspaces
    page = _saved_page_for_workspace(settings, current_workspace)

    if not page:
        page = _active_pages(current_workspace).filter(
            is_folder=False,
        ).order_by('sort_order', 'id').first()

    # 5. Settings aktualisieren, falls sie leer waren (Auto-Init)
    if settings.last_workspace_id != current_workspace.id or (page and settings.last_page_id != page.id):
        settings.last_workspace_id = current_workspace.id
        settings.last_page_id = page.id if page else None
        if page:
            _set_workspace_page(settings, current_workspace.id, page.id)
        settings.save()

    return render(request, 'notes/dashboard.html', {
        'workspaces': workspaces_list,
        'current_workspace': current_workspace,
        'page': page,
        'user_settings': settings,
        'app_base': (getattr(django_settings, 'FORCE_SCRIPT_NAME', None) or request.META.get('SCRIPT_NAME') or '').rstrip('/'),
        'local_file_open_enabled': getattr(django_settings, 'LOCAL_FILE_OPEN_ENABLED', False),
        'tag_websocket_enabled': getattr(django_settings, 'ENABLE_TAG_WEBSOCKET', False),
    })

@login_required
def workspace_list_create(request):
    print('workspace_list_create',request.user)
    if request.method == 'GET':
        data = [{'id': ws.id, 'name': ws.name, 'slug': ws.slug} for ws in _sort_workspaces(_workspace_qs(request.user), request.user)]
        return JsonResponse(data, safe=False)
    payload = json.loads(request.body or '{}')
    name = (payload.get('name') or '').strip()
    if not name:
        return JsonResponse({'error': 'Name required'}, status=400)
    base = name.lower().replace(' ', '-') or 'workspace'
    slug = base
    i = 1
    while _workspace_qs(request.user).filter(slug=slug).exists():
        slug = f'{base}-{i}'
        i += 1
    ws = Workspace.objects.create(owner=request.user, name=name, slug=slug)
    return JsonResponse({'id': ws.id, 'name': ws.name, 'slug': ws.slug})


@login_required
def workspace_create(request):
    if request.method != 'POST':
        return JsonResponse({'status': 'error', 'message': 'POST required'}, status=405)
    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON format'}, status=400)

    name = (data.get('name') or '').strip()
    if not name:
        return JsonResponse({'status': 'error', 'message': 'Name is required'}, status=400)

    base_slug = slugify(name) or 'workspace'
    slug = base_slug
    counter = 1
    while Workspace.objects.filter(
        owner=request.user, slug=slug, deleted=False,
    ).exists():
        slug = f'{base_slug}-{counter}'
        counter += 1

    ws = Workspace.objects.create(name=name, owner=request.user, slug=slug)
    return JsonResponse({
        'status': 'success',
        'id': ws.id,
        'name': ws.name,
        'slug': ws.slug,
    })

@login_required
def workspace_update(request, pk):
    print('workspace_update',request.user, pk)
    if request.method == 'POST':
        print(request.body)
        data = json.loads(request.body)
        
        ws = get_object_or_404(Workspace, pk=pk, owner=request.user, deleted=False)
        ws.name = data.get('name', ws.name)
        ws.save()
        return JsonResponse({'status': 'success'})
    return JsonResponse({'status': 'error'}, status=400)

@login_required
def workspace_delete(request, pk):
    if request.method != 'POST':
        return JsonResponse({'status': 'error', 'message': 'POST required'}, status=405)
    ws = get_object_or_404(Workspace, pk=pk, owner=request.user, deleted=False)
    _soft_delete_workspace(ws)
    return JsonResponse({'status': 'success', 'id': ws.id, 'name': ws.name})


@login_required
def workspace_restore(request, pk):
    if request.method != 'POST':
        return JsonResponse({'status': 'error', 'message': 'POST required'}, status=405)
    ws = get_object_or_404(Workspace, pk=pk, owner=request.user, deleted=True)
    _restore_workspace(ws)
    return JsonResponse({'status': 'success', 'id': ws.id, 'name': ws.name})

@login_required
def add_workspace_member(request):
    if request.method != 'POST':
        return JsonResponse({'status': 'error', 'message': 'POST required'}, status=405)

    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)

    workspace_id = data.get('workspace_id')
    username = (data.get('username') or '').strip()
    email = (data.get('email') or '').strip().lower()
    role = data.get('role', 'read')

    workspace = get_object_or_404(Workspace, id=workspace_id, owner=request.user, deleted=False)

    if not username and not email:
        return JsonResponse({'status': 'error', 'message': 'Username or email required.'}, status=400)

    target_user = None
    if username:
        target_user = User.objects.filter(username__iexact=username).first()
    if not target_user and email:
        target_user = User.objects.filter(email__iexact=email).first()
    if not target_user and username and '@' in username:
        email = username.lower()
        username = ''
        target_user = User.objects.filter(email__iexact=email).first()

    if target_user:
        result = add_existing_user_to_workspace(
            request=request,
            workspace=workspace,
            inviter=request.user,
            user=target_user,
            role=role,
        )
        status = result.pop('http_status', 200)
        return JsonResponse(result, status=status)

    invite_email = email or (username if '@' in username else '')
    if invite_email:
        result = invite_or_add_by_email(
            request=request,
            workspace=workspace,
            inviter=request.user,
            email=invite_email,
            role=role,
        )
        status = result.pop('http_status', 200)
        return JsonResponse(result, status=status)

    return JsonResponse({
        'status': 'error',
        'message': 'User not found. Send an email address to invite someone who is not registered yet.',
    }, status=404)


@login_required
def remove_workspace_member(request):
    if request.method != 'POST':
        return JsonResponse({'status': 'error', 'message': 'Methode nicht erlaubt'}, status=405)
        
    try:
        data = json.loads(request.body)
        workspace_id = data.get('workspace_id')
        user_id = data.get('user_id')
        
        # 1. Sicherstellen, dass nur der Besitzer (owner) Personen entfernen darf
        workspace = get_object_or_404(Workspace, id=workspace_id, owner=request.user, deleted=False)
        
        # 2. Den Eintrag direkt aus der WorkspaceMembership-Zwischentabelle suchen
        membership = WorkspaceMembership.objects.filter(workspace=workspace, user_id=user_id)
        
        # 3. Wenn der Eintrag existiert, löschen
        if membership.exists():
            membership.delete()
            return JsonResponse({
                'status': 'success', 
                'message': 'member removed from WorkspaceMembership.'
            })
            
        return JsonResponse({'status': 'error', 'message': 'WorkspaceMembership does not exists.'}, status=400)
        
    except json.JSONDecodeError:
        return JsonResponse({'status': 'error', 'message': 'Ungültiges JSON-Format'}, status=400)


@login_required
def get_workspace_members(request, workspace_id):
    workspace = get_object_or_404(_workspace_qs(request.user), id=workspace_id)
    # Zugriffsschutz: Nur der Besitzer oder bestehende Mitglieder dürfen die Liste sehen
    is_owner = (workspace.owner == request.user)
    is_member = WorkspaceMembership.objects.filter(workspace_id=workspace.id, user_id=request.user.id).exists()
    print("get_workspace_members", request.user.username, "Owner:", workspace.owner, "WS_ID:", workspace.id, "IsOwner:", is_owner, "IsMember:", is_member)
    if not is_owner and not is_member:
        return JsonResponse({'status': 'error', 'message': 'Access restricted.'}, status=403)
        
    members_list = []
    
    # 1. Den Besitzer (Owner) immer als ersten Eintrag hinzufügen
    members_list.append({
        'id': workspace.owner.id,
        'username': workspace.owner.username,
        'is_owner': True,
        'role': 'owner'
    })
    

    # 2. NEU: Alle Mitglieder aus der Zwischentabelle laden (inklusive ihrer Rolle)
    # select_related('user') verhindert zusätzliche DB-Abfragen in der Schleife
   
    memberships = WorkspaceMembership.objects.filter(workspace_id=workspace_id).select_related('user')

    for ms in memberships:
        print("member:", ms.user.username)

        members_list.append({
            'id': ms.user.id,
            'username': ms.user.username,
            'is_owner': False,
            'role': ms.role,
        })

    pending_invites = []
    if is_owner:
        pending_invites = [
            {
                'email': invite.email,
                'role': invite.role,
            }
            for invite in WorkspaceInvite.objects.filter(
                workspace=workspace,
                accepted=False,
            ).order_by('email')
        ]

    return JsonResponse({
        'status': 'success',
        'members': members_list,
        'pending_invites': pending_invites,
        'is_current_user_owner': is_owner,
    })


@login_required
def change_member_role(request):
    print("change_member_role")
    if request.method != 'POST':
        print("change_member_role failed POST")
        return JsonResponse({'status': 'error', 'message': 'Methode nicht erlaubt'}, status=405)
        
    try:
        data = json.loads(request.body)
        workspace_id = data.get('workspace_id')
        user_id = data.get('user_id')
        print("change_member_role data", workspace_id, user_id)
        
        # Nur der Besitzer (owner) des Workspaces darf Rollen verändern
        workspace = get_object_or_404(Workspace, id=workspace_id, owner=request.user, deleted=False)
        print("change_member_role Workspace", workspace.id)
        
        # Die bestehende Mitgliedschaft finden
        membership = get_object_or_404(WorkspaceMembership, workspace=workspace, user_id=user_id)
        # Rolle toggeln (Umschalten)
        new_role = 'write' if membership.role == 'read' else 'read'
        membership.role = new_role
        membership.save()
        
        return JsonResponse({
            'status': 'success', 
            'role': new_role,
            'message': f'Rolle erfolgreich zu {"Schreiben" if new_role == "write" else "Nur Lesen"} geändert.'
        })
        
    except json.JSONDecodeError:
        print("change_member_role failed JSONDecodeError")
        return JsonResponse({'status': 'error', 'message': 'Ungültiges JSON'}, status=400)
# API 1: Durchsucht alle registrierten Benutzer in der Django-Datenbank
@login_required
def user_search_lookup(request):
    query = request.GET.get('q', '').strip()
    if len(query) < 2:
        return JsonResponse({'status': 'success', 'users': []})
        
    # Suche nach Username oder E-Mail, schliesse den suchenden Admin selbst aus
    users = User.objects.filter(
        Q(username__icontains=query) | Q(email__icontains=query)
    ).exclude(id=request.user.id)[:8] # Limitiert auf die besten 8 Treffer
    
    user_data = [{'id': u.id, 'username': u.username, 'email': u.email} for u in users]
    return JsonResponse({'status': 'success', 'users': user_data})




@login_required
def tree_data(request, workspace_id):
    print('tree_data')
    workspace = get_object_or_404(_workspace_qs(request.user), pk=workspace_id)
    return JsonResponse( _tree_data(request.user, workspace), safe=False)


@login_required
@require_GET
def workspace_tags_list(request, workspace_id):
    get_object_or_404(_workspace_qs(request.user), pk=workspace_id)
    query = (request.GET.get('q') or '').strip().lower()
    tags = list_workspace_tag_names(workspace_id, query)
    return JsonResponse({'tags': tags})


@login_required
@require_GET
def workspace_tags_search(request, workspace_id):
    get_object_or_404(_workspace_qs(request.user), pk=workspace_id)
    tag = (request.GET.get('tag') or '').strip()
    query = (request.GET.get('q') or '').strip()
    pages = search_workspace_pages_by_tag(workspace_id, tag, query)
    return JsonResponse({'pages': pages})


@login_required
@require_POST
def workspace_tags_rebuild(request, workspace_id):
    workspace = get_object_or_404(_workspace_qs(request.user), pk=workspace_id)
    if not _user_has_write_access(request.user, workspace):
        return JsonResponse(
            {'status': 'error', 'message': 'You do not have write access to this workspace.'},
            status=403,
        )

    pages = _active_pages(workspace).only('id', 'is_folder', 'markdown_content', 'workspace_id')
    count = 0
    for page in pages.iterator():
        sync_page_tags(page)
        count += 1

    _broadcast_tags_updated(workspace.id, None)
    return JsonResponse({'success': True, 'pages_scanned': count})

@login_required
def _page_tree_for(workspace):
    pages = _active_pages(workspace).order_by("parent_id", "sort_order", "id")
    return [{
        "id": str(p.id),
        "parent": str(p.parent_id) if p.parent_id else "#",
        "text": p.title,
        "type": "folder" if p.is_folder else "page",
        "data": {
            "is_folder": p.is_folder,
            "slug": p.slug,
            "workspace": p.workspace_id,
        }
    } for p in pages]


@login_required
def page_detail(request, pk):
    page = _page_qs(request.user).filter(pk=pk).first()
    if not page:
        return JsonResponse(
            {'status': 'error', 'message': 'Page not found or no longer available.'},
            status=404,
        )
    return JsonResponse(_page_to_dict(page))

@login_required
def page_create(request):
    payload = json.loads(request.body or '{}')
    workspace = get_object_or_404(_workspace_qs(request.user), pk=payload.get('workspace'))
    if not _user_has_write_access(request.user, workspace):
        return JsonResponse(
            {'status': 'error', 'message': 'You do not have write access to this workspace.'},
            status=403,
        )
    title = (payload.get('title') or '').strip() or 'Untitled'
    parent_id = payload.get('parent')
    is_folder = bool(payload.get('is_folder'))
    parent = None
    if parent_id and parent_id != '#':
        parent = get_object_or_404(_page_qs(request.user), pk=parent_id, workspace=workspace)
    max_sort = _active_pages(workspace).filter(parent=parent).aggregate(
        models.Max('sort_order'),
    )['sort_order__max'] or 0
    page = Page.objects.create(
        workspace=workspace,
        parent=parent,
        title=title,
        is_folder=is_folder,
        sort_order=max_sort + 1,
        markdown_content='' if is_folder else '# Start writing\n',
    )
    sync_page_tags(page)
    return JsonResponse(_page_to_dict(page))

@login_required
def page_update(request, pk):
    page = get_object_or_404(_page_qs(request.user), pk=pk)
    payload = json.loads(request.body or '{}')
    title = payload.get('title')
    if title is not None:
        page.title = title.strip() or 'Untitled'
    if not page.is_folder and 'markdown_content' in payload:
        page.markdown_content = payload.get('markdown_content') or ''
    page.slug = ''
    page.save()
    sync_page_tags(page)
    _broadcast_tags_updated(page.workspace_id, page.id)
    return JsonResponse(_page_to_dict(page))

@login_required
def page_delete(request, pk):
    page = get_object_or_404(_page_qs(request.user), pk=pk)
    if not _user_has_write_access(request.user, page.workspace):
        return JsonResponse(
            {'status': 'error', 'message': 'You do not have write access to this workspace.'},
            status=403,
        )
    _soft_delete_page(page)
    return JsonResponse({'success': True})

@login_required
def page_reorder(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON'}, status=400)

    page = get_object_or_404(_page_qs(request.user), pk=payload.get('id'))
    if not _user_has_write_access(request.user, page.workspace):
        return JsonResponse(
            {'status': 'error', 'message': 'You do not have write access to this workspace.'},
            status=403,
        )

    parent_id = payload.get('parent')
    position = int(payload.get('position', 0))
    parent = None if parent_id in [None, '', '#'] else get_object_or_404(
        _page_qs(request.user), pk=parent_id, workspace=page.workspace,
    )
    if parent is not None:
        if not parent.is_folder:
            return JsonResponse(
                {'status': 'error', 'message': 'Pages can only be moved into folders or the workspace root.'},
                status=400,
            )
        subtree_ids = set(_page_subtree_ids(page))
        if parent.id == page.id or parent.id in subtree_ids:
            return JsonResponse(
                {'status': 'error', 'message': 'Cannot move a folder into itself or its descendants.'},
                status=400,
            )

    with transaction.atomic():
        old_parent_id = page.parent_id
        page.parent = parent
        page.save(update_fields=['parent'])
        _insert_page_among_siblings(page.workspace, parent, page, position)
        new_parent_id = parent.id if parent else None
        if old_parent_id != new_parent_id:
            old_parent = None
            if old_parent_id is not None:
                old_parent = Page.objects.filter(pk=old_parent_id).first()
            _reindex_page_siblings(page.workspace, old_parent)

    return JsonResponse({'status': 'success', 'success': True})


@login_required
def page_move_workspace(request, pk):
    if request.method != 'POST':
        return JsonResponse({'status': 'error', 'message': 'POST required'}, status=405)
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)

    page = get_object_or_404(_page_qs(request.user), pk=pk)
    source_workspace = page.workspace
    target_workspace_id = payload.get('target_workspace_id')
    if not target_workspace_id:
        return JsonResponse({'status': 'error', 'message': 'target_workspace_id is required.'}, status=400)

    target_workspace = get_object_or_404(_workspace_qs(request.user), pk=target_workspace_id)
    if target_workspace.id == source_workspace.id:
        return JsonResponse({'status': 'error', 'message': 'Choose a different workspace.'}, status=400)

    if not _user_has_write_access(request.user, source_workspace):
        return JsonResponse({'status': 'error', 'message': 'Write access required on source workspace.'}, status=403)
    if not _user_has_write_access(request.user, target_workspace):
        return JsonResponse({'status': 'error', 'message': 'Write access required on target workspace.'}, status=403)

    target_parent_id = payload.get('target_parent')
    target_parent = None
    if target_parent_id not in (None, '', '#'):
        target_parent = get_object_or_404(
            _page_qs(request.user), pk=target_parent_id, workspace=target_workspace, is_folder=True,
        )

    try:
        with transaction.atomic():
            _move_page_subtree_to_workspace(page, target_workspace, target_parent)
    except ValueError as exc:
        return JsonResponse({'status': 'error', 'message': str(exc)}, status=400)

    for moved_page in Page.objects.filter(
        id__in=_page_subtree_ids(page),
        deleted=False,
        is_folder=False,
    ):
        sync_page_tags(moved_page)

    page.refresh_from_db()
    return JsonResponse({
        'status': 'success',
        'page': _page_to_dict(page),
        'target_workspace_id': target_workspace.id,
    })


def convert_markdown_file_images(text):
    pattern = r'!\[(.*?)\]\((.*?)\)'

    def repl(match):
        alt_text = match.group(1)
        url = match.group(2)

        parsed = urlparse(url)
        path = parsed.path.lstrip("/")

        filename = os.path.basename(path)
        name_without_ext = os.path.splitext(filename)[0]

        # remove domain, keep relative path
        relative_url = path

        label = name_without_ext or alt_text or "file"

        return f'[{label}]({relative_url})'

    return re.sub(pattern, repl, text)


@login_required
def upload_file(request):
    workspace = get_object_or_404(_workspace_qs(request.user), pk=request.POST.get('workspace'))
    uploaded = request.FILES.get('file')
    if not uploaded:
        return JsonResponse({'error': 'No file'}, status=400)
    # MD5 berechnen
    file_content = uploaded.read()
    file_hash = hashlib.md5(file_content).hexdigest()
    print("upload_file:filehash:", file_hash)
    # Prüfen, ob dieser Hash bereits existiert
    existing_file = UploadedFile.objects.filter(
        md5_hash=file_hash, workspace=workspace,
    ).first()
    print("upload_file:existing_file:", existing_file)
    if existing_file:
            print("file exists")
            # Duplikat gefunden: Bestehende Daten zurückgeben
            absolute_url = request.build_absolute_uri(existing_file.file.url)   
            dest_path = urllib.parse.urlparse(absolute_url).path.lstrip('/')
            return JsonResponse({
                "success": True,
                "url": request.build_absolute_uri(existing_file.file.url),
                "path": existing_file.file.url,
                "is_duplicate": True,
                'file': {
                    # 'id': existing_file.file.id, 
                    'original_name': str(existing_file.file.name),
                    'mediaName': dest_path,
                    'url':absolute_url,
                }
            })
    else:    
        print("upload_file:upload_file")
        item = UploadedFile.objects.create(
            user=request.user,
            workspace=workspace, 
            file=uploaded, 
            original_name=uploaded.name,
            md5_hash=file_hash,

        )
        return JsonResponse(
            {
            'success': True, 
            'url': request.build_absolute_uri(item.file.url), 
            'file': {
                'id': item.id, 
                'original_name': item.original_name, 
                'url': request.build_absolute_uri(item.file.url)
                }
            })

@login_required
def file_manager(request, workspace_id):
    workspace = get_object_or_404(_workspace_qs(request.user), pk=workspace_id)
    data = [
        {
            'id': f.id, 
            'original_name': f.original_name, 
            'url':  request.build_absolute_uri(f.file.url),
            'furl': f.file.url
        } 
        for f in workspace.uploads.all()[:200]
    ]
    # print("file_manager")
    # print(data)
    return JsonResponse(data, safe=False)

@login_required
def debug(request):
    from django.http import JsonResponse
    return JsonResponse({
        "path": request.path,
        "script_name": request.META.get("SCRIPT_NAME"),
    })



@login_required
def updateUserSettings(request, workspace_id):
    # print('updateUserSettings',request)
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            # print('updateUserSettings',data)
            settings, created = UserSettings.objects.get_or_create(user=request.user)
            # print('updateUserSettings',settings)
            # Felder dynamisch aktualisieren
            if 'last_workspace_id' in data:
                settings.last_workspace_id = data['last_workspace_id']
            if 'last_page_id' in data:
                settings.last_page_id = data['last_page_id']
                _set_workspace_page(settings, workspace_id, data['last_page_id'])
            if 'workspace_pages' in data and isinstance(data['workspace_pages'], dict):
                pages = dict(settings.workspace_pages or {}) if isinstance(settings.workspace_pages, dict) else {}
                for key, value in data['workspace_pages'].items():
                    ws_key = str(key)
                    if value is None:
                        pages.pop(ws_key, None)
                    else:
                        try:
                            pages[ws_key] = int(value)
                        except (TypeError, ValueError):
                            continue
                settings.workspace_pages = pages
            if 'theme' in data:
                settings.theme = data['theme']
            if 'sidebar_width' in data:
                w = data['sidebar_width']
                if w is None:
                    settings.sidebar_width = None
                else:
                    settings.sidebar_width = max(260, min(640, int(w)))
            if 'left_panel_expanded' in data:
                settings.left_panel_expanded = bool(data['left_panel_expanded'])
            if 'right_panel_width' in data:
                w = data['right_panel_width']
                if w is None:
                    settings.right_panel_width = None
                else:
                    settings.right_panel_width = max(240, min(640, int(w)))
            if 'right_panel_expanded' in data:
                settings.right_panel_expanded = bool(data['right_panel_expanded'])
            if 'font_size' in data:
                try:
                    settings.font_size = max(11, min(24, int(data['font_size'])))
                except (TypeError, ValueError):
                    pass
            if 'extra_configs' in data:
                incoming = data['extra_configs']
                if isinstance(incoming, dict):
                    existing = settings.extra_configs if isinstance(settings.extra_configs, dict) else {}
                    merged = dict(existing)
                    for key, value in incoming.items():
                        if key == 'chart_settings' and isinstance(value, dict):
                            charts = dict(merged.get('chart_settings') or {})
                            charts.update(value)
                            merged['chart_settings'] = charts
                        else:
                            merged[key] = value
                    settings.extra_configs = merged

            settings.save()
            return JsonResponse({'status': 'ok'})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)}, status=400)
        

@login_required
def upload_pasted_image(request):
    try:
        pasted_image = request.FILES['image']
        print(pasted_image)
        if not pasted_image:
            return JsonResponse({'error': 'No file'}, status=400)
        # file_name = default_storage.save(f"pasted_images/{pasted_image}", pasted_image)
        # print(file_name)
        # file_url = default_storage.url(file_name)
        workspaceId = request.POST.get('workspace')
        workspace = get_object_or_404(_workspace_qs(request.user), pk=request.POST.get('workspace'))

        # MD5 berechnen
        file_content = pasted_image.read()
        file_hash = hashlib.md5(file_content).hexdigest()
        
        # Prüfen, ob dieser Hash bereits existiert
        existing_file = PastedFile.objects.filter(
            md5_hash=file_hash, workspace=workspace,
        ).first()

        if existing_file:
            print("file exists")
            # Duplikat gefunden: Bestehende Daten zurückgeben
            absolute_url = request.build_absolute_uri(existing_file.file.url)   
            dest_path = urllib.parse.urlparse(absolute_url).path.lstrip('/')
            return JsonResponse({
                "success": True,
                "url": request.build_absolute_uri(existing_file.file.url),
                "path": existing_file.file.url,
                "is_duplicate": True,
                'file': {
                    # 'id': existing_file.file.id, 
                    'original_name': str(existing_file.file.name),
                    'mediaName': dest_path,
                    'url':absolute_url,
                }
                })
        else:
            # Falls kein Duplikat: Neu speichern
            item = PastedFile.objects.create(
                user=request.user,
                workspace=workspace, 
                original_name= str(pasted_image.name),
                file=pasted_image,
                md5_hash=file_hash,
            )
            
            print("file created")
            # dest_path = os.path.join(settings.MEDIA_ROOT, f"{file_path.stem}_{item.file.name}{file_path.suffix}")
            absolute_url = request.build_absolute_uri(item.file.url)   
            dest_path = urllib.parse.urlparse(absolute_url).path.lstrip('/')
            print(f"DEBUG: Absolute URL ist: {absolute_url}")
            print(f"DEBUG: Media URL ist: {dest_path}")
            return JsonResponse({
                'success': True, 
                'url': absolute_url, 
                'file': {
                    # 'id': item.id, 
                    'original_name': item.file.name,
                    'mediaName': dest_path,
                    'url':absolute_url
                    }
                })
    except Exception as e:
        # Das wird in deinem Terminal ausgegeben (da wo runserver läuft)
        print("--- UPLOAD FEHLER START ---")
        print(f"Fehlertyp: {type(e).__name__}")
        print(f"Nachricht: {str(e)}")
        print("--- UPLOAD FEHLER ENDE ---")
        
        return JsonResponse({
            'success': False, 
            'error': f"Serverfehler: {type(e).__name__}",
            'details': str(e)
        }, status=500)


@login_required
@require_GET
def workspace_export(request, pk):
    workspace = get_object_or_404(_workspace_qs(request.user), pk=pk, deleted=False)
    if workspace.owner_id != request.user.id:
        return JsonResponse({'status': 'error', 'message': 'Only the workspace owner can export.'}, status=403)

    archive = export_workspace_archive(workspace)
    filename = f'{slugify(workspace.name) or "workspace"}-export.zip'
    response = HttpResponse(archive, content_type='application/zip')
    response['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response


@login_required
@require_POST
def workspace_import(request):
    uploaded = request.FILES.get('file')
    if not uploaded:
        return JsonResponse({'status': 'error', 'message': 'No file uploaded.'}, status=400)
    if not uploaded.name.lower().endswith('.zip'):
        return JsonResponse({'status': 'error', 'message': 'Import file must be a .zip archive.'}, status=400)

    try:
        workspace = import_workspace_archive(request.user, uploaded)
    except (ValueError, zipfile.BadZipFile, json.JSONDecodeError) as exc:
        return JsonResponse({'status': 'error', 'message': str(exc)}, status=400)
    except Exception as exc:
        return JsonResponse({'status': 'error', 'message': f'Import failed: {exc}'}, status=500)

    return JsonResponse({
        'status': 'success',
        'id': workspace.id,
        'name': workspace.name,
        'slug': workspace.slug,
    })


@login_required
@require_POST
def open_local_file(request):
    if not getattr(django_settings, 'LOCAL_FILE_OPEN_ENABLED', False):
        return JsonResponse({'error': 'Local file open is disabled on this server.'}, status=403)

    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON'}, status=400)

    href = (payload.get('path') or payload.get('href') or '').strip()
    display_path = (payload.get('display_path') or '').strip()
    if not href and not display_path:
        return JsonResponse({'error': 'Path required'}, status=400)

    from .local_files import file_url_to_path, open_in_file_manager

    candidates = []
    for raw in (href, display_path):
        raw = (raw or '').strip()
        if not raw or raw in candidates:
            continue
        candidates.append(raw)

    fs_path = None
    last_error = None
    for raw in candidates:
        try:
            fs_path = file_url_to_path(raw)
            break
        except ValueError as exc:
            last_error = exc

    if fs_path is None:
        return JsonResponse({'error': str(last_error or 'Invalid path')}, status=400)

    try:
        resolved = open_in_file_manager(fs_path)
        return JsonResponse({'success': True, 'path': resolved})
    except FileNotFoundError:
        return JsonResponse(
            {'error': f'File or folder not found: {fs_path}'},
            status=404,
        )
    except ValueError as exc:
        return JsonResponse({'error': str(exc)}, status=400)
    except OSError as exc:
        return JsonResponse({'error': str(exc)}, status=500)


@login_required
async def rss_fetch(request):
    """Proxy + parse an external RSS/Atom feed (async; MagpieRSS-style JSON)."""
    from asgiref.sync import sync_to_async

    from .rss_feed import fetch_rss

    if request.method != 'GET':
        return JsonResponse({'error': 'GET required'}, status=405)

    url = (request.GET.get('url') or '').strip()
    limit = request.GET.get('limit') or 10
    if not url:
        return JsonResponse({'error': 'url required'}, status=400)
    try:
        # Blocking HTTP/XML work runs in a worker thread so ASGI stays responsive.
        data = await sync_to_async(fetch_rss, thread_sensitive=False)(url, limit=limit)
    except ValueError as exc:
        return JsonResponse({'error': str(exc)}, status=400)
    except Exception as exc:  # noqa: BLE001 — surface fetch failures cleanly
        return JsonResponse({'error': f'Feed error: {exc}'}, status=502)
    return JsonResponse(data)