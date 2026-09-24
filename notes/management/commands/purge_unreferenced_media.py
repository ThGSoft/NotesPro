from django.core.management.base import BaseCommand

from notes.models import Workspace
from ...media_quota import apply_purge, format_bytes, plan_unreferenced_media


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

        plan = plan_unreferenced_media(
            workspace=workspace,
            include_deleted=include_deleted,
            disk_orphans=disk_orphans,
        )
        to_delete = plan['records']
        disk_only = plan['disk_orphans']

        if not to_delete and not disk_only:
            self.stdout.write('No unreferenced media files found.')
            return

        scope = f'workspace {workspace.pk} ({workspace.name})' if workspace else 'all workspaces'
        self.stdout.write(f'Scope: {scope}')
        self.stdout.write(f'Referenced media paths in content: {plan["referenced_count"]}')

        if to_delete:
            self.stdout.write(f'\nDatabase file records to delete: {len(to_delete)}')
            for row in to_delete[:50]:
                self.stdout.write(
                    f'  [{row["kind"]} #{row["pk"]}] {row["relpath"]} ({row["reason"]})'
                )
            if len(to_delete) > 50:
                self.stdout.write(f'  ... and {len(to_delete) - 50} more')

        if disk_only:
            self.stdout.write(f'\nDisk-only orphan files to delete: {len(disk_only)}')
            for row in disk_only[:50]:
                self.stdout.write(f'  {row["relpath"]}')
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

        result = apply_purge(plan)
        self.stdout.write(self.style.SUCCESS(
            f'Purge complete. Deleted {result["deleted_rows"]} database record(s)'
            f'{f" and {result["deleted_orphans"]} disk orphan(s)" if disk_orphans else ""}'
            f' ({format_bytes(result["deleted_bytes"])}).',
        ))
