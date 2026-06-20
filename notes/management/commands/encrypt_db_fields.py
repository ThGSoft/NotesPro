"""Encrypt existing plaintext rows at rest (safe to re-run)."""

from django.core.management.base import BaseCommand
from django.db import connection

from notes import db_crypto
from notes.models import (
    DirectMessage,
    DmPeerSignal,
    Page,
    UserSettings,
    WorkspaceChatMessage,
    WorkspaceMailMessage,
)


class Command(BaseCommand):
    help = 'Encrypt sensitive database fields that are still stored as plaintext.'

    def handle(self, *args, **options):
        updated = 0
        targets = [
            (Page._meta.db_table, 'markdown_content'),
            (WorkspaceMailMessage._meta.db_table, 'subject'),
            (WorkspaceMailMessage._meta.db_table, 'body'),
            (WorkspaceChatMessage._meta.db_table, 'body'),
            (WorkspaceChatMessage._meta.db_table, 'attachment_url'),
            (WorkspaceChatMessage._meta.db_table, 'attachment_name'),
            (DirectMessage._meta.db_table, 'iv'),
            (DirectMessage._meta.db_table, 'ciphertext'),
            (DmPeerSignal._meta.db_table, 'payload'),
            (UserSettings._meta.db_table, 'totp_secret'),
        ]
        with connection.cursor() as cursor:
            for table, column in targets:
                cursor.execute(f'SELECT id, "{column}" FROM "{table}"')
                for row_id, raw in cursor.fetchall():
                    if not raw or db_crypto.is_encrypted(raw):
                        continue
                    cursor.execute(
                        f'UPDATE "{table}" SET "{column}" = %s WHERE id = %s',
                        [db_crypto.encrypt(raw), row_id],
                    )
                    updated += 1
        self.stdout.write(self.style.SUCCESS(f'Encrypted values updated: {updated}'))
