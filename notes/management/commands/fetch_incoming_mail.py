from django.core.management.base import BaseCommand

from notes.incoming_mail import fetch_incoming_mails, imap_settings_configured


class Command(BaseCommand):
    help = 'Fetch unread IMAP messages with NotesPro:… routing in subject into Incomes inbox.'

    def handle(self, *args, **options):
        if not imap_settings_configured():
            self.stderr.write(self.style.ERROR(
                'IMAP not configured. Set INCOMING_MAIL_IMAP_HOST, INCOMING_MAIL_IMAP_USER, '
                'INCOMING_MAIL_IMAP_PASSWORD in your environment.',
            ))
            return

        result = fetch_incoming_mails()
        self.stdout.write(self.style.SUCCESS(
            f"Imported {result['imported']}, skipped {result['skipped']}, errors {result['errors']}",
        ))
