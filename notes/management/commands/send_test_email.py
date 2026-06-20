from django.conf import settings
from django.core.mail import send_mail
from django.core.management.base import BaseCommand

from notes.email_utils import delivery_hint, email_delivery_mode


class Command(BaseCommand):
    help = 'Send a test email using the configured EMAIL_BACKEND'

    def add_arguments(self, parser):
        parser.add_argument('to', nargs='?', default='test@example.com', help='Recipient email')

    def handle(self, *args, **options):
        to = options['to']
        self.stdout.write(f'Backend: {settings.EMAIL_BACKEND}')
        self.stdout.write(f'Mode: {email_delivery_mode()}')
        send_mail(
            'Notes Pro test email',
            'If you read this, email delivery is working.',
            settings.DEFAULT_FROM_EMAIL,
            [to],
            fail_silently=False,
        )
        self.stdout.write(self.style.SUCCESS(f'Sent to {to}'))
        self.stdout.write(delivery_hint())
