import json
import bleach
from django.contrib.auth import login
from django.contrib.auth.decorators import login_required
from django.db import models
from django.http import HttpResponseBadRequest, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_GET, require_POST
from .forms import RegisterForm
from .models import Page, Workspace, UploadedFile, PastedFile, \
                    UserSettings, User, \
                    WorkspaceMembership
from django.shortcuts import get_object_or_404
from django.core.files.storage import default_storage
from django.conf import settings
import os, urllib, hashlib, re
from pathlib import Path
from urllib.parse import urlparse
from django.contrib.auth.models import User
from django.db.models import Q
from slugify import slugify


ALLOWED_TAGS = list(bleach.sanitizer.ALLOWED_TAGS) + ['p','br','h1','h2','h3','h4','h5','h6','ul','ol','li','span','div','img','pre','code','blockquote','hr','table','thead','tbody','tr','td','th','strong','em']
ALLOWED_ATTRS = {'*':['class','style'], 'a':['href','title','target'], 'img':['src','alt','title','width','height']}


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


def _soft_delete_page(page):
    descendant_ids = []
    stack = [page.id]
    while stack:
        pid = stack.pop()
        descendant_ids.append(pid)
        stack.extend(
            Page.objects.filter(parent_id=pid, workspace_id=page.workspace_id)
            .values_list('id', flat=True)
        )
    Page.objects.filter(id__in=descendant_ids).update(deleted=True)


def _soft_delete_workspace(workspace):
    workspace.pages.update(deleted=True)
    workspace.deleted = True
    workspace.save(update_fields=['deleted'])

def _page_to_dict(page):
    return {
        'id': page.id,
        'workspace': page.workspace_id,
        'parent': page.parent_id,
        'title': page.title,
        'slug': page.slug,
        'is_folder': page.is_folder,
        'sort_order': page.sort_order,
        'editor_mode': page.editor_mode,
        'rich_content': page.rich_content,
        'markdown_content': page.markdown_content,
        'blocks_content': page.blocks_content,
    }



def _tree_data(user, workspace):
    pages = _active_pages(workspace).order_by('parent_id', 'sort_order', 'id')

    # pages = Page.objects.filter(
    #     Q(workspace__owner=user) |
    #     Q(workspace__workspacemembership__user=user),
    #     workspace_id=workspace_id
    # ).distinct().order_by(
    #     'parent_id',
    #     'sort_order',
    #     'id'
    # )

    return [{
        'id': str(p.id),
        'parent': str(p.parent_id) if p.parent_id else '#',
        'text': p.title,
        'type': 'folder' if p.is_folder else 'page',
        'data': {
            'slug': p.slug,
            'is_folder': p.is_folder,
            'workspace': p.workspace_id,
            'editor_mode': p.editor_mode,
        },
    } for p in pages]


def register_view(request):
    if request.user.is_authenticated:
        return redirect('dashboard')
    form = RegisterForm(request.POST or None)
    if request.method == 'POST' and form.is_valid():
        user = form.save()
        login(request, user)
        Workspace.objects.get_or_create(
            owner=user, slug='main', deleted=False, defaults={'name': 'Main'},
        )
        return redirect('dashboard')
    return render(request, 'registration/register.html', {'form': form})

@login_required
def dashboard(request):
    # 1. Sicherstellen, dass Workspaces existieren
    workspaces = _workspace_qs(request.user).select_related('owner')
    if not workspaces.exists():
        Workspace.objects.create(owner=request.user, name='Main', slug='main')
        workspaces = _workspace_qs(request.user)

    # 2. UserSettings abrufen (get_or_create verhindert "User has no settings")
    settings, _ = UserSettings.objects.get_or_create(user=request.user)

    # 3. Workspace ermitteln: Entweder der letzte aus den Settings oder der erste verfügbare
    current_workspace = None
    if settings.last_workspace_id:
        current_workspace = workspaces.filter(id=settings.last_workspace_id).first()
    
    if not current_workspace:
        current_workspace = workspaces.first()

    # 4. Seite ermitteln: Entweder die letzte aus den Settings oder die erste des Workspaces
    page = None
    if settings.last_page_id:
        page = _active_pages(current_workspace).filter(
            id=settings.last_page_id, is_folder=False,
        ).first()
    
    if not page:
        page = _active_pages(current_workspace).filter(
            is_folder=False,
        ).order_by('sort_order', 'id').first()

    # 5. Settings aktualisieren, falls sie leer waren (Auto-Init)
    if settings.last_workspace_id != current_workspace.id or (page and settings.last_page_id != page.id):
        settings.last_workspace_id = current_workspace.id
        settings.last_page_id = page.id if page else None
        settings.save()

    return render(request, 'notes/dashboard.html', {
        'workspaces': workspaces, 
        'current_workspace': current_workspace, 
        'page': page
    })

@login_required
def workspace_list_create(request):
    print('workspace_list_create',request.user)
    if request.method == 'GET':
        data = [{'id': ws.id, 'name': ws.name, 'slug': ws.slug} for ws in _workspace_qs(request.user)]
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
    try:
        if request.method == 'POST':
            try: 
                data = json.loads(request.body)
                print('workspace_create',request)

                name = data.get('name')
                return JsonResponse({'status': 'success', 'name': name})
                if not name:
                    return JsonResponse({'status': 'error', 'message': 'Name is required'}, status=400)
                            # 1. Generate base slug from the clean name string
                base_slug = slugify(name)
                slug = base_slug
                counter = 1
                # 2. Loop to prevent conflicts if this owner already has a workspace with this slug
                while Workspace.objects.filter(
                    owner=request.user, slug=slug, deleted=False,
                ).exists():
                    slug = f"{base_slug}-{counter}"
                    counter += 1
                    # Assumes workspace model links to user
                # 3. Create the database record with the unique slug populated
                print("workspace_create", name, request.user)
                ws = Workspace.objects.create(
                    name=name, 
                    owner=request.user, 
                    slug=slug
                )
                return JsonResponse({'status': 'success', 'id': ws.id})
            except json.JSONDecodeError:        
                return JsonResponse({'status': 'error', 'message': 'Invalid JSON format'}, status=402)
            return JsonResponse({'status': 'error', 'message': str(e)}, status=500)
        return JsonResponse({'status': 'error'}, status=400)
    except Exception as e:
        print("Fehler beim Erstellen:", str(e))  # Zeigt den echten Fehler im Terminal

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
    print("workspace_delete", pk)
    if request.method == 'POST':
        ws = get_object_or_404(Workspace, pk=pk, owner=request.user, deleted=False)
        _soft_delete_workspace(ws)
        print("workspace_delete")
        return JsonResponse({'status': 'success'})
    return JsonResponse({'status': 'error'}, status=400)

@login_required
def add_workspace_member(request):
    if request.method == 'POST':
        print("add_workspace_member")
        try:
            data = json.loads(request.body)
            print("add_workspace_member data:", data)
            

            user = get_object_or_404(User, username=data.get('username'))
            print("owner_user found:", user)
            print("owner_user id:", user.id)


            # 1. Workspace anhand des Besitzers (owner) finden
            # 'owner' matched dein DB-Schema, 'request.user' ist das aktuelle User-Objekt
            workspace = get_object_or_404(Workspace, id=data.get('workspace_id'), owner=data.get('owner'))
            print("add_workspace found:", workspace)
            
            # 2. Den einzuladenden User anhand seines Usernamens in der DB finden
            # Erstes Argument MUSS die Klasse 'User' sein, das Feld heisst 'username'
            target_user = get_object_or_404(User, username=data.get('username'))
            print("target_user found:", target_user)
            
            isMember = WorkspaceMembership.objects.filter(workspace=workspace, user_id=target_user).exists();
            # 3. Sicherheits-Check: Ist der User schon im Workspace?
            if isMember:
                return JsonResponse({'status': 'error', 'message': 'User ist already member'}, status=400)
            
            # 4. Hinzufügen und Erfolg zurückgeben

            membership, created = WorkspaceMembership.objects.get_or_create(
                workspace=workspace,
                user=target_user,
                defaults={'role': 'read'} # Standardrolle, falls neu erstellt
)

            return JsonResponse({
                'status': 'success', 
                'id': target_user.id, 
                'username': target_user.username
            })
            
        except json.JSONDecodeError:
            return JsonResponse({'status': 'error', 'message': 'Ungültiges JSON-Format'}, status=400)
            




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
            'role': ms.role  # Gibt 'read' oder 'write' an das Frontend weiter
        })
        
    return JsonResponse({
        'status': 'success', 
        'members': members_list,
        'is_current_user_owner': is_owner
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
def add_workspace_member(request):
    if request.method != 'POST':
        return JsonResponse({'status': 'error', 'message': 'Methode nicht erlaubt'}, status=405)
        
    try:
        print("add_workspace_member")
        data = json.loads(request.body)
        workspace_id = data.get('workspace_id')
        username = data.get('username')
        # Standardmässig 'read' (Nur Lesen), falls keine Rolle übergeben wird
        role = data.get('role', 'read') 
        
        # 1. Sicherstellen, dass nur der Besitzer (owner) Personen hinzufügen darf
        workspace = get_object_or_404(Workspace, id=workspace_id, owner=request.user, deleted=False)
        
        # 2. Den einzuladenden Benutzer in der Django-Datenbank finden
        target_user = get_object_or_404(User, username=username)
        
        print(workspace_id, username, data, role, workspace.id, target_user)
        # 3. Sicherheits-Check: Ist der Benutzer schon in der Zwischentabelle registriert?
        membership_exists = WorkspaceMembership.objects.filter(
            workspace=workspace, 
            user=target_user
        ).exists()
        
        if membership_exists:
            return JsonResponse({
                'status': 'error', 
                'message': f'{username} ist bereits Mitglied in diesem Workspace.'
            }, status=400)
            
        # 4. NEU: Eintrag direkt in der WorkspaceMembership-Tabelle erstellen
        new_membership = WorkspaceMembership.objects.create(
            workspace=workspace,
            user=target_user,
            role=role
        )
        
        # 5. Erfolg ans Frontend melden (inklusive ID, Name und zugewiesener Rolle)
        return JsonResponse({
            'status': 'success',
            'id': target_user.id,
            'username': target_user.username,
            'role': new_membership.role
        })
        
    except json.JSONDecodeError:
        return JsonResponse({'status': 'error', 'message': 'Ungültiges JSON-Format'}, status=400)





@login_required
def tree_data(request, workspace_id):
    print('tree_data')
    workspace = get_object_or_404(_workspace_qs(request.user), pk=workspace_id)
    return JsonResponse( _tree_data(request.user, workspace), safe=False)

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
            "editor_mode": p.editor_mode,
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
        rich_content='' if is_folder else '<p>Start writing...</p>',
        markdown_content='' if is_folder else '# Start writing\n',
        blocks_content=[] if is_folder else [{'type': 'text', 'text': 'Start writing...'}],
    )
    return JsonResponse(_page_to_dict(page))

@login_required
def page_update(request, pk):
    page = get_object_or_404(_page_qs(request.user), pk=pk)
    payload = json.loads(request.body or '{}')
    title = payload.get('title')
    if title is not None:
        page.title = title.strip() or 'Untitled'
    editor_mode = payload.get('editor_mode')
    if editor_mode in {'rich', 'markdown', 'blocks'}:
        page.editor_mode = editor_mode
    if not page.is_folder:
        if 'rich_content' in payload:
            page.rich_content = bleach.clean(payload.get('rich_content') or '', tags=ALLOWED_TAGS, attributes=ALLOWED_ATTRS, strip=True)
        if 'markdown_content' in payload:
            page.markdown_content = payload.get('markdown_content') or ''
        if 'blocks_content' in payload:
            page.blocks_content = payload.get('blocks_content') or []
    page.slug = ''
    page.save()
    return JsonResponse(_page_to_dict(page))

@login_required
def page_delete(request, pk):
    page = get_object_or_404(_page_qs(request.user), pk=pk)
    _soft_delete_page(page)
    return JsonResponse({'success': True})

@login_required
def page_reorder(request):
    payload = json.loads(request.body or '{}')
    page = get_object_or_404(_page_qs(request.user), pk=payload.get('id'))
    parent_id = payload.get('parent')
    position = int(payload.get('position', 0))
    parent = None if parent_id in [None, '', '#'] else get_object_or_404(_page_qs(request.user), pk=parent_id, workspace=page.workspace)
    page.parent = parent
    page.sort_order = position
    page.save()
    siblings = _active_pages(page.workspace).filter(parent=parent).order_by('sort_order', 'id')
    for idx, sibling in enumerate(siblings):
        if sibling.sort_order != idx:
            sibling.sort_order = idx
            sibling.save(update_fields=['sort_order'])
    return JsonResponse({'success': True})




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
    existing_file = UploadedFile.objects.filter(md5_hash=file_hash).first()
    print("upload_file:existing_file:", existing_file)
    if existing_file:
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
            if 'theme' in data:
                settings.theme = data['theme']
                
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
        existing_file = PastedFile.objects.filter(md5_hash=file_hash).first()

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