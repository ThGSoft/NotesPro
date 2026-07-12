from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import transaction

from notes.media_refs import collect_all_referenced_media_paths
from notes.models import PastedFile, UploadedFile, Workspace


class Command(BaseCommand):
    help = (
        'Delete uploaded/pasted media files that are not referenced in page markdown, '
        'chat attachments, quick notes, or user snippets.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='List files that would be deleted without removing anything.',
        )
        parser.add_argument(
            '-y', '--yes',
            action='store_true',
            help='Skip confirmation prompt.',
        )
        parser.add_argument(
            '--workspace',
            type=int,
            metavar='ID',
            help='Only process a single workspace.',
        )
        parser.add_argument(
            '--include-deleted',
            action='store_true',
            help='Treat soft-deleted pages/notes as still referencing media.',
        )
        parser.add_argument(
            '--disk-orphans',
            action='store_true',
            help='Also remove files on disk under uploads/ and pasted_images/ with no DB row.',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        workspace_id = options.get('workspace')
        include_deleted = options['include_deleted']
        disk_orphans = options['disk_orphans']

        workspace = None
        if workspace_id is not None:
            workspace = Workspace.objects.filter(pk=workspace_id).first()
            if workspace is None:
                self.stderr.write(self.style.ERROR(f'Workspace {workspace_id} not found.'))
                return

        referenced = collect_all_referenced_media_paths(
            workspace=workspace,
            include_deleted=include_deleted,
        )

        upload_qs = UploadedFile.objects.select_related('workspace')
        paste_qs = PastedFile.objects.select_related('workspace')
        if workspace is not None:
            upload_qs = upload_qs.filter(workspace=workspace)
            paste_qs = paste_qs.filter(workspace=workspace)

        to_delete = []
        for obj in list(upload_qs) + list(paste_qs):
            relpath = (obj.file.name or '').replace('\\', '/')
            if not relpath:
                to_delete.append((obj, relpath, 'empty path'))
                continue
            if relpath not in referenced:
                to_delete.append((obj, relpath, 'unreferenced'))

        disk_only = []
        if disk_orphans:
            db_paths = {
                (obj.file.name or '').replace('\\', '/')
                for obj in list(upload_qs) + list(paste_qs)
                if obj.file and obj.file.name
            }
            media_root = Path(settings.MEDIA_ROOT)
            for prefix in ('uploads', 'pasted_images'):
                root = media_root / prefix
                if not root.is_dir():
                    continue
                for path in root.rglob('*'):
                    if not path.is_file():
                        continue
                    relpath = path.relative_to(media_root).as_posix()
                    if relpath not in db_paths and relpath not in referenced:
                        disk_only.append(relpath)

        if not to_delete and not disk_only:
            self.stdout.write('No unreferenced media files found.')
            return

        scope = f'workspace {workspace.pk} ({workspace.name})' if workspace else 'all workspaces'
        self.stdout.write(f'Scope: {scope}')
        self.stdout.write(f'Referenced media paths in content: {len(referenced)}')

        if to_delete:
            self.stdout.write(f'\nDatabase file records to delete: {len(to_delete)}')
            for obj, relpath, reason in to_delete[:50]:
                kind = obj.__class__.__name__
                self.stdout.write(f'  [{kind} #{obj.pk}] {relpath} ({reason})')
            if len(to_delete) > 50:
                self.stdout.write(f'  ... and {len(to_delete) - 50} more')

        if disk_only:
            self.stdout.write(f'\nDisk-only orphan files to delete: {len(disk_only)}')
            for relpath in disk_only[:50]:
                self.stdout.write(f'  {relpath}')
            if len(disk_only) > 50:
                self.stdout.write(f'  ... and {len(disk_only) - 50} more')

        if dry_run:
            self.stdout.write(self.style.WARNING('\nDry run — no changes made.'))
            return

        if not options['yes']:
            answer = input('Type "yes" to permanently delete these files: ').strip().lower()
            if answer != 'yes':
                self.stdout.write('Aborted.')
                return

        deleted_rows = 0
        deleted_disk = 0
        with transaction.atomic():
            for obj, relpath, _reason in to_delete:
                label = f'{obj.__class__.__name__} #{obj.pk}: {relpath}'
                obj.delete()
                deleted_rows += 1
                self.stdout.write(self.style.SUCCESS(f'Deleted {label}'))

        for relpath in disk_only:
            path = Path(settings.MEDIA_ROOT) / relpath
            if path.is_file():
                path.unlink()
                deleted_disk += 1
                self.stdout.write(self.style.SUCCESS(f'Removed disk orphan {relpath}'))

        self.stdout.write(self.style.SUCCESS(
            f'Purge complete. Deleted {deleted_rows} database record(s)'
            f'{f" and {deleted_disk} disk orphan(s)" if disk_orphans else ""}.',
        ))
