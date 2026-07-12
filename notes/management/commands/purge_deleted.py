from django.core.management.base import BaseCommand
from django.db import transaction

from notes.models import Page, Workspace


class Command(BaseCommand):
    help = (
        'Permanently remove soft-deleted pages, folders, and workspaces '
        '(records with deleted=True).'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show what would be deleted without removing anything.',
        )
        parser.add_argument(
            '-y', '--yes',
            action='store_true',
            help='Skip confirmation prompt.',
        )
        parser.add_argument(
            '--pages-only',
            action='store_true',
            help='Only purge deleted pages/folders in non-deleted workspaces.',
        )
        parser.add_argument(
            '--workspaces-only',
            action='store_true',
            help='Only purge soft-deleted workspaces (and all their data).',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        pages_only = options['pages_only']
        workspaces_only = options['workspaces_only']

        if pages_only and workspaces_only:
            self.stderr.write(self.style.ERROR(
                'Use at most one of --pages-only and --workspaces-only.',
            ))
            return

        purge_pages = not workspaces_only
        purge_workspaces = not pages_only

        page_qs = Page.objects.filter(deleted=True, workspace__deleted=False)
        ws_qs = Workspace.objects.filter(deleted=True)

        page_count = page_qs.count() if purge_pages else 0
        folder_count = page_qs.filter(is_folder=True).count() if purge_pages else 0
        ws_count = ws_qs.count() if purge_workspaces else 0
        ws_page_count = (
            Page.objects.filter(workspace__in=ws_qs).count()
            if purge_workspaces and ws_count
            else 0
        )

        if not page_count and not ws_count:
            self.stdout.write('Nothing to purge.')
            return

        self.stdout.write('Soft-deleted items to purge permanently:')
        if purge_pages and page_count:
            self.stdout.write(f'  Pages/folders in active workspaces: {page_count} '
                              f'({folder_count} folders)')
        if purge_workspaces and ws_count:
            self.stdout.write(f'  Workspaces: {ws_count} '
                              f'({ws_page_count} pages total inside them)')

        if dry_run:
            self.stdout.write(self.style.WARNING('Dry run — no changes made.'))
            return

        if not options['yes']:
            answer = input('Type "yes" to permanently delete: ').strip().lower()
            if answer != 'yes':
                self.stdout.write('Aborted.')
                return

        with transaction.atomic():
            deleted_pages = 0
            deleted_workspaces = 0

            if purge_pages and page_count:
                deleted_pages, _ = page_qs.delete()
                self.stdout.write(self.style.SUCCESS(
                    f'Deleted {deleted_pages} page-related row(s) '
                    f'({page_count} soft-deleted pages/folders).',
                ))

            if purge_workspaces and ws_count:
                deleted_workspaces, detail = ws_qs.delete()
                self.stdout.write(self.style.SUCCESS(
                    f'Deleted workspace batch: {deleted_workspaces} row(s) total.',
                ))
                for model, count in sorted(detail.items()):
                    if count:
                        self.stdout.write(f'  {model}: {count}')

        self.stdout.write(self.style.SUCCESS('Purge complete.'))
            