"""Media storage usage, quotas, and unreferenced-file purge."""

from __future__ import annotations

from pathlib import Path

from django.conf import settings
from django.db import transaction

from .media_refs import collect_all_referenced_media_paths
from .models import IncomingMail, PastedFile, StorageSettings, UploadedFile, UserSettings, Workspace

MANAGED_DISK_PREFIXES = ('uploads', 'pasted_images', 'incoming_mail')


class StorageQuotaExceeded(Exception):
    def __init__(self, message, code='quota'):
        super().__init__(message)
        self.code = code


def format_bytes(n) -> str:
    size = float(max(0, int(n or 0)))
    units = ('B', 'KB', 'MB', 'GB', 'TB')
    for unit in units:
        if size < 1024 or unit == units[-1]:
            if unit == 'B':
                return f'{int(size)} B'
            label = f'{size:.1f} {unit}'
            return label.replace('.0 ', ' ')
        size /= 1024
    return f'{int(n or 0)} B'


def mb_to_bytes(mb) -> int:
    return max(0, int(mb or 0)) * 1024 * 1024


def stored_file_bytes(file_field) -> int:
    if not file_field:
        return 0
    try:
        size = file_field.size
        if size is not None:
            return int(size)
    except Exception:
        pass
    name = (getattr(file_field, 'name', '') or '').replace('\\', '/')
    if not name:
        return 0
    path = Path(settings.MEDIA_ROOT) / name
    try:
        if path.is_file():
            return path.stat().st_size
    except OSError:
        return 0
    return 0


def disk_tree_usage(root: Path) -> tuple[int, int]:
    total = 0
    count = 0
    if not root.is_dir():
        return 0, 0
    try:
        for path in root.rglob('*'):
            if not path.is_file():
                continue
            try:
                total += path.stat().st_size
            except OSError:
                continue
            count += 1
    except OSError:
        return total, count
    return total, count


def delete_stored_file(file_field) -> bool:
    name = (getattr(file_field, 'name', '') or '').replace('\\', '/')
    if not name:
        return False
    media_root = Path(settings.MEDIA_ROOT).resolve()
    path = (Path(settings.MEDIA_ROOT) / name).resolve()
    try:
        path.relative_to(media_root)
    except ValueError:
        return False
    try:
        if path.is_file():
            path.unlink()
            return True
    except OSError:
        return False
    return False


def workspace_usage_map() -> dict[int, dict]:
    usage: dict[int, dict] = {}
    for model, key in ((UploadedFile, 'uploads'), (PastedFile, 'pastes')):
        for obj in model.objects.only('workspace_id', 'file').iterator():
            bucket = usage.setdefault(obj.workspace_id, {
                'bytes': 0, 'uploads': 0, 'pastes': 0, 'files': 0,
            })
            bucket['bytes'] += stored_file_bytes(obj.file)
            bucket['files'] += 1
            bucket[key] += 1
    return usage


def workspace_media_bytes(workspace) -> int:
    total = 0
    for model in (UploadedFile, PastedFile):
        for obj in model.objects.filter(workspace=workspace).only('file').iterator():
            total += stored_file_bytes(obj.file)
    return total


def _empty_user_bucket() -> dict:
    return {'bytes': 0, 'uploads': 0, 'pastes': 0, 'mail': 0, 'files': 0}


def user_usage_map() -> dict[int, dict]:
    usage: dict[int, dict] = {}
    for model, key in ((UploadedFile, 'uploads'), (PastedFile, 'pastes')):
        for obj in model.objects.only('user_id', 'file').iterator():
            if not obj.user_id:
                continue
            bucket = usage.setdefault(obj.user_id, _empty_user_bucket())
            bucket['bytes'] += stored_file_bytes(obj.file)
            bucket['files'] += 1
            bucket[key] += 1
    for obj in IncomingMail.objects.only('recipient_id', 'pdf_file', 'eml_file').iterator():
        if not obj.recipient_id:
            continue
        nbytes = stored_file_bytes(obj.pdf_file) + stored_file_bytes(obj.eml_file)
        if not nbytes:
            continue
        bucket = usage.setdefault(obj.recipient_id, _empty_user_bucket())
        bucket['bytes'] += nbytes
        if obj.pdf_file:
            bucket['files'] += 1
            bucket['mail'] += 1
        if obj.eml_file:
            bucket['files'] += 1
            bucket['mail'] += 1
    return usage


def user_media_bytes(user) -> int:
    if user is None:
        return 0
    user_id = getattr(user, 'pk', user)
    total = 0
    for model in (UploadedFile, PastedFile):
        for obj in model.objects.filter(user_id=user_id).only('file').iterator():
            total += stored_file_bytes(obj.file)
    for obj in IncomingMail.objects.filter(recipient_id=user_id).only('pdf_file', 'eml_file').iterator():
        total += stored_file_bytes(obj.pdf_file)
        total += stored_file_bytes(obj.eml_file)
    return total


def effective_user_quota_mb(user) -> int:
    conf = StorageSettings.load()
    if user is None:
        return conf.user_quota_mb
    user_id = getattr(user, 'pk', user)
    settings_obj = UserSettings.objects.filter(user_id=user_id).first()
    if settings_obj is not None:
        return settings_obj.effective_storage_quota_mb()
    return conf.user_quota_mb


def global_media_bytes() -> int:
    total = 0
    for model in (UploadedFile, PastedFile):
        for obj in model.objects.only('file').iterator():
            total += stored_file_bytes(obj.file)
    for obj in IncomingMail.objects.only('pdf_file', 'eml_file').iterator():
        total += stored_file_bytes(obj.pdf_file)
        total += stored_file_bytes(obj.eml_file)
    return total


def assert_can_store(workspace, extra_bytes: int, user=None) -> None:
    extra = max(0, int(extra_bytes or 0))
    conf = StorageSettings.load()
    if conf.max_upload_mb and extra > mb_to_bytes(conf.max_upload_mb):
        raise StorageQuotaExceeded(
            f'File exceeds the {conf.max_upload_mb} MB upload limit.',
            'max_upload',
        )
    ws_quota = workspace.effective_storage_quota_mb() if workspace is not None else 0
    if ws_quota:
        used = workspace_media_bytes(workspace)
        if used + extra > mb_to_bytes(ws_quota):
            raise StorageQuotaExceeded(
                f'This workspace is over its {ws_quota} MB storage quota.',
                'workspace_quota',
            )
    if user is not None:
        user_quota = effective_user_quota_mb(user)
        if user_quota:
            used = user_media_bytes(user)
            if used + extra > mb_to_bytes(user_quota):
                raise StorageQuotaExceeded(
                    f'Your account is over its {user_quota} MB storage quota.',
                    'user_quota',
                )
    if conf.global_quota_mb:
        used = global_media_bytes()
        if used + extra > mb_to_bytes(conf.global_quota_mb):
            raise StorageQuotaExceeded(
                f'Site storage is over the {conf.global_quota_mb} MB limit.',
                'global_quota',
            )


def _relpath_of(obj) -> str:
    return (getattr(obj.file, 'name', '') or '').replace('\\', '/')


def plan_unreferenced_media(*, workspace=None, include_deleted=False, disk_orphans=False) -> dict:
    referenced = collect_all_referenced_media_paths(
        workspace=workspace,
        include_deleted=include_deleted,
    )
    upload_qs = UploadedFile.objects.select_related('workspace')
    paste_qs = PastedFile.objects.select_related('workspace')
    if workspace is not None:
        upload_qs = upload_qs.filter(workspace=workspace)
        paste_qs = paste_qs.filter(workspace=workspace)

    records = []
    db_paths = set()
    for obj in list(upload_qs) + list(paste_qs):
        relpath = _relpath_of(obj)
        if relpath:
            db_paths.add(relpath)
        if not relpath or relpath not in referenced:
            records.append({
                'obj': obj,
                'kind': obj.__class__.__name__,
                'pk': obj.pk,
                'relpath': relpath,
                'reason': 'empty path' if not relpath else 'unreferenced',
                'size': stored_file_bytes(obj.file),
                'workspace_id': obj.workspace_id,
            })

    orphans = []
    if disk_orphans:
        media_root = Path(settings.MEDIA_ROOT)
        prefixes = ('uploads', 'pasted_images')
        if workspace is None:
            prefixes = MANAGED_DISK_PREFIXES
        for prefix in prefixes:
            root = media_root / prefix
            if not root.is_dir():
                continue
            for path in root.rglob('*'):
                if not path.is_file():
                    continue
                relpath = path.relative_to(media_root).as_posix()
                if relpath in db_paths or relpath in referenced:
                    continue
                try:
                    size = path.stat().st_size
                except OSError:
                    size = 0
                orphans.append({'relpath': relpath, 'size': size})

    return {
        'referenced_count': len(referenced),
        'records': records,
        'disk_orphans': orphans,
        'workspace': workspace,
    }


def apply_purge(plan) -> dict:
    deleted_rows = 0
    deleted_orphans = 0
    deleted_bytes = 0
    with transaction.atomic():
        for row in plan.get('records') or []:
            obj = row.get('obj')
            if obj is None:
                continue
            deleted_bytes += int(row.get('size') or 0)
            delete_stored_file(obj.file)
            obj.delete()
            deleted_rows += 1

    media_root = Path(settings.MEDIA_ROOT)
    for orphan in plan.get('disk_orphans') or []:
        relpath = orphan.get('relpath') or ''
        if not relpath:
            continue
        path = media_root / relpath
        try:
            if path.is_file():
                deleted_bytes += path.stat().st_size
                path.unlink()
                deleted_orphans += 1
        except OSError:
            continue

    return {
        'deleted_rows': deleted_rows,
        'deleted_orphans': deleted_orphans,
        'deleted_bytes': deleted_bytes,
    }


def build_storage_report() -> dict:
    conf = StorageSettings.load()
    media_root = Path(settings.MEDIA_ROOT)
    trees = {}
    total_disk = 0
    total_files = 0
    for name in MANAGED_DISK_PREFIXES:
        nbytes, count = disk_tree_usage(media_root / name)
        trees[name] = {
            'bytes': nbytes,
            'files': count,
            'label': format_bytes(nbytes),
        }
        total_disk += nbytes
        total_files += count

    usage_map = workspace_usage_map()
    workspaces = []
    for ws in Workspace.objects.select_related('owner').order_by('name'):
        used = usage_map.get(ws.pk, {'bytes': 0, 'uploads': 0, 'pastes': 0, 'files': 0})
        quota = ws.effective_storage_quota_mb()
        quota_bytes = mb_to_bytes(quota)
        percent = None
        if quota_bytes:
            percent = min(999.0, 100.0 * used['bytes'] / quota_bytes)
        workspaces.append({
            'id': ws.pk,
            'name': ws.name,
            'owner': ws.owner.username,
            'deleted': ws.deleted,
            'used': used['bytes'],
            'used_label': format_bytes(used['bytes']),
            'uploads': used['uploads'],
            'pastes': used['pastes'],
            'quota_mb': quota,
            'quota_label': f'{quota} MB' if quota else 'Unlimited',
            'percent': percent,
            'over': bool(quota_bytes and used['bytes'] > quota_bytes),
        })
    workspaces.sort(key=lambda row: (-row['used'], row['name'].lower()))

    from django.contrib.auth import get_user_model
    User = get_user_model()
    usage_by_user = user_usage_map()
    settings_by_user = {
        row['user_id']: row
        for row in UserSettings.objects.values('pk', 'user_id', 'storage_quota_mb')
    }
    users = []
    for account in User.objects.order_by('username'):
        used = usage_by_user.get(account.pk, _empty_user_bucket())
        settings_row = settings_by_user.get(account.pk)
        if settings_row and settings_row['storage_quota_mb'] is not None:
            quota = int(settings_row['storage_quota_mb'])
        else:
            quota = conf.user_quota_mb
        quota_bytes = mb_to_bytes(quota)
        percent = None
        if quota_bytes:
            percent = min(999.0, 100.0 * used['bytes'] / quota_bytes)
        users.append({
            'id': account.pk,
            'username': account.username,
            'settings_id': settings_row['pk'] if settings_row else None,
            'used': used['bytes'],
            'used_label': format_bytes(used['bytes']),
            'uploads': used['uploads'],
            'pastes': used['pastes'],
            'mail': used['mail'],
            'quota_mb': quota,
            'quota_label': f'{quota} MB' if quota else 'Unlimited',
            'percent': percent,
            'over': bool(quota_bytes and used['bytes'] > quota_bytes),
        })
    users.sort(key=lambda row: (-row['used'], row['username'].lower()))

    preview = plan_unreferenced_media(disk_orphans=True)
    preview_bytes = sum(r['size'] for r in preview['records']) + sum(
        o['size'] for o in preview['disk_orphans']
    )
    preview_rows = [
        {
            'kind': row['kind'],
            'pk': row['pk'],
            'relpath': row['relpath'],
            'size_label': format_bytes(row['size']),
        }
        for row in preview['records'][:40]
    ]
    preview_orphans = [
        {'relpath': row['relpath'], 'size_label': format_bytes(row['size'])}
        for row in preview['disk_orphans'][:40]
    ]

    global_quota = conf.global_quota_mb
    global_bytes = mb_to_bytes(global_quota)
    global_percent = None
    if global_bytes:
        global_percent = min(999.0, 100.0 * total_disk / global_bytes)

    return {
        'media_root': str(media_root),
        'trees': trees,
        'total_disk': total_disk,
        'total_disk_label': format_bytes(total_disk),
        'total_files': total_files,
        'global_quota_mb': global_quota,
        'global_quota_label': f'{global_quota} MB' if global_quota else 'Unlimited',
        'global_percent': global_percent,
        'global_over': bool(global_bytes and total_disk > global_bytes),
        'max_upload_label': f'{conf.max_upload_mb} MB' if conf.max_upload_mb else 'Unlimited',
        'workspace_quota_label': (
            f'{conf.workspace_quota_mb} MB' if conf.workspace_quota_mb else 'Unlimited'
        ),
        'user_quota_label': (
            f'{conf.user_quota_mb} MB' if conf.user_quota_mb else 'Unlimited'
        ),
        'workspaces': workspaces,
        'users': users,
        'preview_count': len(preview['records']),
        'preview_orphan_count': len(preview['disk_orphans']),
        'preview_bytes_label': format_bytes(preview_bytes),
        'preview_referenced': preview['referenced_count'],
        'preview_rows': preview_rows,
        'preview_orphans': preview_orphans,
        'preview_rows_truncated': len(preview['records']) > 40,
        'preview_orphans_truncated': len(preview['disk_orphans']) > 40,
    }
