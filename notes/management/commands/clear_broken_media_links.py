from django.core.management.base import BaseCommand
from django.db import transaction

from notes.media_refs import (
    clear_broken_media_links_in_text,
    media_file_exists,
    normalize_media_relpath,
)
from notes.models import Page, QuickNote, Workspace, WorkspaceChatMessage


class Command(BaseCommand):
    help = (
        'Remove markdown links and images that point to missing files under media/. '
        'Images become their alt text; links become plain text.'
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

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        workspace_id = options.get('workspace')
        include_deleted = options['include_deleted']

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
            updated, count = clear_broken_media_links_in_text(page.markdown_content)
            if count:
                page_updates.append((page, updated, count))

        note_qs = QuickNote.objects.select_related('workspace')
        if workspace is not None:
            note_qs = note_qs.filter(workspace=workspace)
        if not include_deleted:
            note_qs = note_qs.filter(deleted=False)
        for note in note_qs.iterator():
            title_updated, title_count = clear_broken_media_links_in_text(note.title)
            body_updated, body_count = clear_broken_media_links_in_text(note.body)
            total = title_count + body_count
            if total:
                note_updates.append((note, title_updated, body_updated, total))

        chat_qs = WorkspaceChatMessage.objects.select_related('workspace')
        if workspace is not None:
            chat_qs = chat_qs.filter(workspace=workspace)
        for message in chat_qs.iterator():
            body_updated, body_count = clear_broken_media_links_in_text(message.body)
            attachment_cleared = False
            attachment_relpath = normalize_media_relpath(message.attachment_url)
            if attachment_relpath and not media_file_exists(attachment_relpath):
                attachment_cleared = True
            if body_count or attachment_cleared:
                chat_updates.append((message, body_updated, body_count, attachment_cleared))

        total_changes = (
            sum(count for _, _, count in page_updates)
            + sum(count for _, _, _, count in note_updates)
            + sum(count for _, _, count, _ in chat_updates)
            + sum(1 for _, _, _, cleared in chat_updates if cleared)
        )

        if not total_changes:
            self.stdout.write('No broken media links found.')
            return

        scope = f'workspace {workspace.pk} ({workspace.name})' if workspace else 'all workspaces'
        self.stdout.write(f'Scope: {scope}')
        self.stdout.write(f'Broken media references to fix: {total_changes}')

        if page_updates:
            self.stdout.write(f'\nPages to update: {len(page_updates)}')
            for page, _updated, count in page_updates[:25]:
                self.stdout.write(f'  Page #{page.pk} "{page.title}": {count} link(s)')
            if len(page_updates) > 25:
                self.stdout.write(f'  ... and {len(page_updates) - 25} more pages')

        if note_updates:
            self.stdout.write(f'\nQuick notes to update: {len(note_updates)}')
            for note, _title, _body, count in note_updates[:25]:
                self.stdout.write(f'  QuickNote #{note.pk}: {count} link(s)')

        if chat_updates:
            self.stdout.write(f'\nChat messages to update: {len(chat_updates)}')
            for message, _body, count, cleared in chat_updates[:25]:
                parts = []
                if count:
                    parts.append(f'{count} body link(s)')
                if cleared:
                    parts.append('attachment cleared')
                self.stdout.write(f'  Chat #{message.pk}: {", ".join(parts)}')

        if dry_run:
            self.stdout.write(self.style.WARNING('\nDry run — no changes made.'))
            return

        if not options['yes']:
            answer = input('Type "yes" to update content: ').strip().lower()
            if answer != 'yes':
                self.stdout.write('Aborted.')
                return

        with transaction.atomic():
            for page, updated, _count in page_updates:
                page.markdown_content = updated
                page.save(update_fields=['markdown_content'])
                self.stdout.write(self.style.SUCCESS(
                    f'Updated page #{page.pk} "{page.title}"',
                ))

            for note, title_updated, body_updated, _count in note_updates:
                note.title = title_updated
                note.body = body_updated
                note.save(update_fields=['title', 'body', 'updated_at'])
                self.stdout.write(self.style.SUCCESS(f'Updated quick note #{note.pk}'))

            for message, body_updated, _count, attachment_cleared in chat_updates:
                message.body = body_updated
                update_fields = ['body']
                if attachment_cleared:
                    message.attachment_url = ''
                    message.attachment_name = ''
                    update_fields.extend(['attachment_url', 'attachment_name'])
                message.save(update_fields=update_fields)
                self.stdout.write(self.style.SUCCESS(f'Updated chat message #{message.pk}'))

        self.stdout.write(self.style.SUCCESS('Broken media links cleared.'))
