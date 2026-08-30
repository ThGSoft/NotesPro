from django.core.management.base import BaseCommand
from django.db import transaction

from notes.media_refs import normalize_media_attachment_url, normalize_media_paths_in_text
from notes.models import Page, QuickNote, Workspace, WorkspaceChatMessage


class Command(BaseCommand):
    help = (
        'Rewrite markdown media URLs from /media/… to media/… and wrap bare '
        'uploads/… paths as markdown links.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show what would change without saving.',
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
            help='Also scan soft-deleted pages and quick notes.',
        )
        parser.add_argument(
            '--no-wrap-bare',
            action='store_true',
            help='Only rewrite /media/… URLs; do not wrap bare uploads/… paths.',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        workspace_id = options.get('workspace')
        include_deleted = options['include_deleted']
        wrap_bare_paths = not options['no_wrap_bare']

        workspace = None
        if workspace_id is not None:
            workspace = Workspace.objects.filter(pk=workspace_id).first()
            if workspace is None:
                self.stderr.write(self.style.ERROR(f'Workspace {workspace_id} not found.'))
                return

        page_updates = []
        note_updates = []
        chat_updates = []

        page_qs = Page.objects.select_related('workspace')
        if workspace is not None:
            page_qs = page_qs.filter(workspace=workspace)
        if not include_deleted:
            page_qs = page_qs.filter(deleted=False, workspace__deleted=False)
        for page in page_qs.iterator():
            markdown_updated, markdown_count = normalize_media_paths_in_text(
                page.markdown_content,
                wrap_bare_paths=wrap_bare_paths,
            )
            archive_updated, archive_count = normalize_media_paths_in_text(
                page.archive,
                wrap_bare_paths=wrap_bare_paths,
            )
            total = markdown_count + archive_count
            if total:
                page_updates.append((page, markdown_updated, archive_updated, total))

        note_qs = QuickNote.objects.select_related('workspace')
        if workspace is not None:
            note_qs = note_qs.filter(workspace=workspace)
        if not include_deleted:
            note_qs = note_qs.filter(deleted=False)
        for note in note_qs.iterator():
            title_updated, title_count = normalize_media_paths_in_text(
                note.title,
                wrap_bare_paths=wrap_bare_paths,
            )
            body_updated, body_count = normalize_media_paths_in_text(
                note.body,
                wrap_bare_paths=wrap_bare_paths,
            )
            total = title_count + body_count
            if total:
                note_updates.append((note, title_updated, body_updated, total))

        chat_qs = WorkspaceChatMessage.objects.select_related('workspace')
        if workspace is not None:
            chat_qs = chat_qs.filter(workspace=workspace)
        for message in chat_qs.iterator():
            body_updated, body_count = normalize_media_paths_in_text(
                message.body,
                wrap_bare_paths=wrap_bare_paths,
            )
            attachment_updated, attachment_changed = normalize_media_attachment_url(
                message.attachment_url,
            )
            if body_count or attachment_changed:
                chat_updates.append((
                    message,
                    body_updated,
                    body_count,
                    attachment_updated if attachment_changed else None,
                ))

        total_changes = (
            sum(count for _, _, _, count in page_updates)
            + sum(count for _, _, _, count in note_updates)
            + sum(count for _, _, count, _ in chat_updates)
            + sum(1 for _, _, _, attachment in chat_updates if attachment is not None)
        )

        if not total_changes:
            self.stdout.write('No media paths to normalize.')
            return

        scope = f'workspace {workspace.pk} ({workspace.name})' if workspace else 'all workspaces'
        self.stdout.write(f'Scope: {scope}')
        self.stdout.write(f'Media path updates: {total_changes}')

        if page_updates:
            self.stdout.write(f'\nPages to update: {len(page_updates)}')
            for page, _markdown, _archive, count in page_updates[:25]:
                self.stdout.write(f'  Page #{page.pk} "{page.title}": {count} change(s)')
            if len(page_updates) > 25:
                self.stdout.write(f'  ... and {len(page_updates) - 25} more pages')

        if note_updates:
            self.stdout.write(f'\nQuick notes to update: {len(note_updates)}')
            for note, _title, _body, count in note_updates[:25]:
                self.stdout.write(f'  QuickNote #{note.pk}: {count} change(s)')

        if chat_updates:
            self.stdout.write(f'\nChat messages to update: {len(chat_updates)}')

        if dry_run:
            self.stdout.write(self.style.WARNING('\nDry run — no changes made.'))
            return

        if not options['yes']:
            answer = input('Type "yes" to update content: ').strip().lower()
            if answer != 'yes':
                self.stdout.write('Aborted.')
                return

        with transaction.atomic():
            for page, markdown_updated, archive_updated, _count in page_updates:
                page.markdown_content = markdown_updated
                page.archive = archive_updated
                page.save(update_fields=['markdown_content', 'archive'])
                self.stdout.write(self.style.SUCCESS(
                    f'Updated page #{page.pk} "{page.title}"',
                ))

            for note, title_updated, body_updated, _count in note_updates:
                note.title = title_updated
                note.body = body_updated
                note.save(update_fields=['title', 'body', 'updated_at'])
                self.stdout.write(self.style.SUCCESS(f'Updated quick note #{note.pk}'))

            for message, body_updated, _count, attachment_updated in chat_updates:
                message.body = body_updated
                update_fields = ['body']
                if attachment_updated is not None:
                    message.attachment_url = attachment_updated
                    update_fields.append('attachment_url')
                message.save(update_fields=update_fields)
                self.stdout.write(self.style.SUCCESS(f'Updated chat message #{message.pk}'))

        self.stdout.write(self.style.SUCCESS('Media paths normalized.'))
