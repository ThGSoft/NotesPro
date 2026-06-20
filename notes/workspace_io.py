"""Export and import workspace page trees as JSON or ZIP (JSON + media files)."""
import hashlib
import io
import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import transaction
from django.utils.text import slugify

from .models import Page, PastedFile, UploadedFile, Workspace

FORMAT = 'djnotes-workspace'
PAGES_FORMAT = 'djnotes-pages'
VERSION = 1
WORKSPACE_JSON_NAME = 'workspace.json'
MANIFEST_JSON_NAME = 'manifest.json'
MANIFEST_JSON_NAMES = (WORKSPACE_JSON_NAME, MANIFEST_JSON_NAME)


def _page_ref(row):
    val = row.get('ref') or row.get('id')
    if val is None:
        return None
    return str(val)


def _page_parent_ref(row):
    val = row.get('parent_ref')
    if val is None and 'parent' in row:
        val = row.get('parent')
    if val in (None, '', '#', 'null'):
        return None
    return str(val)


def _page_title(row):
    title = row.get('title') or row.get('text')
    if title is None and isinstance(row.get('data'), dict):
        title = row['data'].get('title')
    return (title or 'Untitled').strip() or 'Untitled'


def _page_is_folder(row):
    if 'is_folder' in row:
        return bool(row.get('is_folder'))
    if row.get('type') == 'folder':
        return True
    data = row.get('data')
    if isinstance(data, dict) and 'is_folder' in data:
        return bool(data.get('is_folder'))
    return False


def _page_markdown(row):
    markdown = row.get('markdown_content') or row.get('content')
    if markdown is None and isinstance(row.get('data'), dict):
        markdown = row['data'].get('markdown_content') or row['data'].get('content')
    return markdown or ''


def _flatten_page_rows(pages):
    flat = []

    def walk(nodes, parent_ref=None):
        for node in nodes:
            if not isinstance(node, dict):
                continue
            row = dict(node)
            children = row.pop('children', None)
            if _page_parent_ref(row) is None and parent_ref is not None:
                row['parent_ref'] = parent_ref
            flat.append(row)
            child_parent = _page_ref(row)
            if children and child_parent:
                walk(children, child_parent)

    if not pages:
        return flat
    if isinstance(pages[0], dict) and pages[0].get('children') is not None:
        walk(pages)
    else:
        flat = list(pages)
    return flat


def _normalize_page_rows(pages):
    normalized = []
    for row in _flatten_page_rows(pages):
        if not isinstance(row, dict):
            continue
        ref = _page_ref(row)
        if not ref:
            ref = str(len(normalized))
        normalized.append({
            'ref': ref,
            'parent_ref': _page_parent_ref(row),
            'title': _page_title(row),
            'slug': row.get('slug') or '',
            'is_folder': _page_is_folder(row),
            'sort_order': int(row.get('sort_order') or row.get('position') or 0),
            'markdown_content': _page_markdown(row),
        })
    return normalized


def export_workspace(workspace):
    pages = list(
        Page.objects.filter(workspace=workspace, deleted=False).order_by('sort_order', 'id'),
    )
    page_rows = _serialize_page_rows(pages)
    return {
        'format': FORMAT,
        'version': VERSION,
        'exported_at': datetime.now(timezone.utc).isoformat(),
        'workspace': {
            'name': workspace.name,
            'slug': workspace.slug,
        },
        'pages': page_rows,
        'files': _collect_workspace_files(workspace),
    }


def _page_subtree_ids(root):
    ids = []
    stack = [root.id]
    while stack:
        pid = stack.pop()
        ids.append(pid)
        stack.extend(
            Page.objects.filter(
                parent_id=pid, workspace_id=root.workspace_id, deleted=False,
            ).values_list('id', flat=True),
        )
    return ids


def _collect_pages_for_export(pages_qs):
    roots = list(pages_qs.filter(deleted=False))
    if not roots:
        raise ValueError('No pages selected.')
    workspace_ids = {page.workspace_id for page in roots}
    if len(workspace_ids) > 1:
        raise ValueError('Selected pages must belong to one workspace.')
    workspace = roots[0].workspace
    export_ids = set()
    for root in roots:
        export_ids.update(_page_subtree_ids(root))
    pages = list(
        Page.objects.filter(id__in=export_ids, deleted=False).order_by('sort_order', 'id'),
    )
    return workspace, pages


def _serialize_page_rows(pages):
    exported_ids = {page.id for page in pages}
    page_rows = []
    for page in pages:
        page_rows.append({
            'ref': str(page.id),
            'id': str(page.id),
            'parent_ref': (
                str(page.parent_id)
                if page.parent_id and page.parent_id in exported_ids
                else None
            ),
            'parent': (
                str(page.parent_id)
                if page.parent_id and page.parent_id in exported_ids
                else '#'
            ),
            'title': page.title,
            'text': page.title,
            'slug': page.slug,
            'is_folder': page.is_folder,
            'type': 'folder' if page.is_folder else 'page',
            'sort_order': page.sort_order,
            'markdown_content': page.markdown_content,
        })
    return page_rows


def _files_referenced_in_pages(workspace, page_rows):
    all_files = _collect_workspace_files(workspace)
    if not all_files:
        return []
    text = '\n'.join(row.get('markdown_content') or '' for row in page_rows)
    referenced = []
    for entry in all_files:
        relpath = entry['media_relpath']
        if (
            relpath in text
            or f'/media/{relpath}' in text
            or f'media/{relpath}' in text
        ):
            referenced.append(entry)
    return referenced


def _collect_workspace_files(workspace):
    files = []
    seen_hashes = set()

    def add_file(kind, file_obj):
        if file_obj.md5_hash in seen_hashes:
            return
        if not file_obj.file or not file_obj.file.name:
            return
        seen_hashes.add(file_obj.md5_hash)
        relpath = file_obj.file.name.replace('\\', '/')
        files.append({
            'kind': kind,
            'md5_hash': file_obj.md5_hash,
            'original_name': file_obj.original_name,
            'media_relpath': relpath,
            'archive_path': f'media/{relpath}',
        })

    for uploaded in UploadedFile.objects.filter(workspace=workspace):
        add_file('upload', uploaded)
    for pasted in PastedFile.objects.filter(workspace=workspace):
        add_file('pasted', pasted)
    return files


def export_workspace_json(workspace):
    return json.dumps(export_workspace(workspace), indent=2, ensure_ascii=False)


def _export_data_zip(data):
    payload = json.dumps(data, indent=2, ensure_ascii=False)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(WORKSPACE_JSON_NAME, payload)
        archive.writestr(MANIFEST_JSON_NAME, payload)
        for entry in data['files']:
            archive_path = entry['archive_path']
            disk_path = Path(settings.MEDIA_ROOT) / entry['media_relpath']
            if disk_path.is_file():
                archive.write(disk_path, archive_path)
    return buffer.getvalue()


def export_workspace_zip(workspace):
    return _export_data_zip(export_workspace(workspace))


def export_workspace_archive(workspace):
    return export_workspace_zip(workspace)


def export_pages_archive(pages_qs):
    workspace, pages = _collect_pages_for_export(pages_qs)
    page_rows = _serialize_page_rows(pages)
    data = {
        'format': PAGES_FORMAT,
        'version': VERSION,
        'exported_at': datetime.now(timezone.utc).isoformat(),
        'source_workspace': {
            'name': workspace.name,
            'slug': workspace.slug,
        },
        'pages': page_rows,
        'files': _files_referenced_in_pages(workspace, page_rows),
    }
    return _export_data_zip(data)


def _unique_workspace_slug(owner, base_slug):
    slug = base_slug
    counter = 1
    while Workspace.objects.filter(owner=owner, slug=slug, deleted=False).exists():
        slug = f'{base_slug}-{counter}'
        counter += 1
    return slug


def _parse_export_json(text):
    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError('Export must be a JSON object')
    return data


def parse_import_json(text):
    return _parse_export_json(text)


def _safe_archive_path(path):
    normalized = path.replace('\\', '/').lstrip('/')
    parts = normalized.split('/')
    if not normalized or '..' in parts:
        raise ValueError(f'Unsafe path in archive: {path}')
    return normalized


def _normalize_import_data(data):
    if not isinstance(data, dict):
        raise ValueError('Export must be a JSON object')
    for key in ('workspace_export', 'export', 'data'):
        wrapped = data.get(key)
        if isinstance(wrapped, dict) and wrapped.get('pages') is not None:
            data = wrapped
            break
    if data.get('format') == FORMAT:
        data = dict(data)
        data['pages'] = _normalize_page_rows(data.get('pages') or [])
        return data
    if data.get('pages') is not None and data.get('workspace') is not None:
        return {
            'format': FORMAT,
            'version': data.get('version', VERSION),
            'workspace': data.get('workspace'),
            'pages': _normalize_page_rows(data.get('pages') or []),
            'files': data.get('files') or [],
        }
    if data.get('pages') is not None:
        data = dict(data)
        data['pages'] = _normalize_page_rows(data.get('pages') or [])
        if data.get('format') != FORMAT:
            data['format'] = FORMAT
        if data.get('version') is None:
            data['version'] = VERSION
        return data
    return data


def _find_manifest_in_archive(archive):
    names_by_suffix = {}
    for name in archive.namelist():
        normalized = name.replace('\\', '/').rstrip('/')
        suffix = normalized.rsplit('/', 1)[-1]
        if suffix in MANIFEST_JSON_NAMES and suffix not in names_by_suffix:
            names_by_suffix[suffix] = name
    for manifest_name in MANIFEST_JSON_NAMES:
        if manifest_name in names_by_suffix:
            return names_by_suffix[manifest_name]
    return None


def parse_import_zip(raw):
    buffer = io.BytesIO(raw)
    if not zipfile.is_zipfile(buffer):
        raise ValueError('Not a valid ZIP archive')
    archive = zipfile.ZipFile(buffer)
    json_name = _find_manifest_in_archive(archive)
    if not json_name:
        expected = ', '.join(MANIFEST_JSON_NAMES)
        raise ValueError(f'ZIP archive must contain {expected}')
    raw_json = archive.read(json_name).decode('utf-8')
    data = _normalize_import_data(_parse_export_json(raw_json))
    return data, archive


def parse_import_upload(upload):
    raw = upload.read()
    name = (upload.name or '').lower()
    if name.endswith('.zip') or zipfile.is_zipfile(io.BytesIO(raw)):
        return parse_import_zip(raw)
    text = raw.decode('utf-8')
    return _normalize_import_data(_parse_export_json(text)), None


def _rewrite_media_paths(text, path_map):
    if not text or not path_map:
        return text
    result = text
    for old_path, new_path in path_map.items():
        if not old_path or old_path == new_path:
            continue
        old_norm = old_path.replace('\\', '/')
        new_norm = new_path.replace('\\', '/')
        replacements = {
            old_norm: new_norm,
            f'/media/{old_norm}': f'/media/{new_norm}',
            f'media/{old_norm}': f'media/{new_norm}',
        }
        for old, new in replacements.items():
            result = result.replace(old, new)
    return result


def _restore_files_from_zip(archive, files_data, owner, workspace):
    path_map = {}
    model_for_kind = {
        'upload': UploadedFile,
        'pasted': PastedFile,
    }

    for entry in files_data:
        kind = entry.get('kind')
        model = model_for_kind.get(kind)
        if not model:
            continue

        old_relpath = (entry.get('media_relpath') or '').replace('\\', '/')
        md5_hash = entry.get('md5_hash')
        if not old_relpath or not md5_hash:
            continue

        existing = model.objects.filter(md5_hash=md5_hash).first()
        if existing:
            path_map[old_relpath] = existing.file.name.replace('\\', '/')
            continue

        archive_path = _safe_archive_path(entry.get('archive_path') or f'media/{old_relpath}')
        try:
            content = archive.read(archive_path)
        except KeyError:
            raise ValueError(f'Missing file in archive: {archive_path}')

        digest = hashlib.md5(content).hexdigest()
        if digest != md5_hash:
            raise ValueError(f'Checksum mismatch for {archive_path}')

        stored_relpath = old_relpath
        model.objects.create(
            user=owner,
            workspace=workspace,
            md5_hash=md5_hash,
            original_name=entry.get('original_name') or Path(old_relpath).name,
            file=ContentFile(content, name=stored_relpath),
        )
        path_map[old_relpath] = stored_relpath

    return path_map


def _import_pages_into_workspace(owner, workspace, data, archive=None, root_parent=None):
    pages_data = _normalize_page_rows(data.get('pages') or [])
    if not pages_data:
        raise ValueError('No pages found in export.')
    files_data = list(data.get('files') or [])
    created = []

    with transaction.atomic():
        path_map = {}
        if files_data and archive is not None:
            path_map = _restore_files_from_zip(archive, files_data, owner, workspace)

        ref_to_page = {}
        remaining = pages_data
        while remaining:
            progress = False
            next_remaining = []
            for row in remaining:
                parent_ref = row.get('parent_ref')
                if parent_ref and parent_ref not in ref_to_page:
                    next_remaining.append(row)
                    continue
                parent = ref_to_page.get(parent_ref) if parent_ref else root_parent
                ref = row['ref']
                markdown = _rewrite_media_paths(
                    row.get('markdown_content') or '',
                    path_map,
                )
                page = Page.objects.create(
                    workspace=workspace,
                    parent=parent,
                    title=row.get('title') or 'Untitled',
                    slug=row.get('slug') or '',
                    is_folder=bool(row.get('is_folder')),
                    sort_order=int(row.get('sort_order') or 0),
                    markdown_content=markdown,
                )
                ref_to_page[ref] = page
                created.append(page)
                progress = True
            if next_remaining and not progress:
                raise ValueError('Invalid page tree: missing parent references')
            remaining = next_remaining
    return created


def import_workspace(data, owner, name=None, archive=None):
    if data.get('format') != FORMAT:
        raise ValueError('Unrecognized export format')
    if data.get('version') != VERSION:
        raise ValueError(f'Unsupported export version: {data.get("version")}')

    ws_info = data.get('workspace') or {}
    ws_name = (name or ws_info.get('name') or 'Imported workspace').strip()
    base_slug = slugify(ws_name) or slugify(ws_info.get('slug')) or 'workspace'
    slug = _unique_workspace_slug(owner, base_slug)

    with transaction.atomic():
        ws = Workspace.objects.create(owner=owner, name=ws_name, slug=slug)
        _import_pages_into_workspace(owner, ws, data, archive=archive)
    return ws


def import_workspace_archive(owner, uploaded_file):
    data, archive = parse_import_upload(uploaded_file)
    return import_workspace(data, owner, archive=archive)


def import_pages_archive(owner, workspace, uploaded_file, parent_page=None):
    if parent_page is not None and parent_page.workspace_id != workspace.id:
        raise ValueError('Parent page must belong to the target workspace.')

    data, archive = parse_import_upload(uploaded_file)
    if data.get('format') == FORMAT:
        raise ValueError('Full workspace archives must be imported from Workspaces.')
    if data.get('format') != PAGES_FORMAT:
        raise ValueError('Unrecognized export format')
    if data.get('version') != VERSION:
        raise ValueError(f'Unsupported export version: {data.get("version")}')

    return _import_pages_into_workspace(
        owner, workspace, data, archive=archive, root_parent=parent_page,
    )
