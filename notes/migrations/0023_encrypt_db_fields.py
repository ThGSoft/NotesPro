from django.db import migrations, models

import notes.fields


def encrypt_existing_rows(apps, schema_editor):
    from notes import db_crypto

    targets = [
        ('Page', 'markdown_content'),
        ('WorkspaceMailMessage', 'subject'),
        ('WorkspaceMailMessage', 'body'),
        ('WorkspaceChatMessage', 'body'),
        ('WorkspaceChatMessage', 'attachment_url'),
        ('WorkspaceChatMessage', 'attachment_name'),
        ('DirectMessage', 'iv'),
        ('DirectMessage', 'ciphertext'),
        ('DmPeerSignal', 'payload'),
        ('UserSettings', 'totp_secret'),
    ]
    for model_name, field_name in targets:
        Model = apps.get_model('notes', model_name)
        table = Model._meta.db_table
        column = field_name
        quoted_table = schema_editor.quote_name(table)
        quoted_column = schema_editor.quote_name(column)
        with schema_editor.connection.cursor() as cursor:
            cursor.execute(f'SELECT id, {quoted_column} FROM {quoted_table}')
            for row_id, raw in cursor.fetchall():
                if not raw or db_crypto.is_encrypted(raw):
                    continue
                encrypted = db_crypto.encrypt(raw)
                cursor.execute(
                    f'UPDATE {quoted_table} SET {quoted_column} = %s WHERE id = %s',
                    [encrypted, row_id],
                )


class Migration(migrations.Migration):

    dependencies = [
        ('notes', '0022_dm_peer_signal'),
    ]

    operations = [
        migrations.AlterField(
            model_name='directmessage',
            name='ciphertext',
            field=notes.fields.EncryptedTextField(),
        ),
        migrations.AlterField(
            model_name='directmessage',
            name='iv',
            field=notes.fields.EncryptedTextField(),
        ),
        migrations.AlterField(
            model_name='dmpeersignal',
            name='payload',
            field=notes.fields.EncryptedTextField(),
        ),
        migrations.AlterField(
            model_name='page',
            name='markdown_content',
            field=notes.fields.EncryptedTextField(blank=True, default=''),
        ),
        migrations.AlterField(
            model_name='usersettings',
            name='totp_secret',
            field=notes.fields.EncryptedTextField(blank=True, default=''),
        ),
        migrations.AlterField(
            model_name='workspacechatmessage',
            name='attachment_name',
            field=notes.fields.EncryptedTextField(blank=True, default=''),
        ),
        migrations.AlterField(
            model_name='workspacechatmessage',
            name='attachment_url',
            field=notes.fields.EncryptedTextField(blank=True, default=''),
        ),
        migrations.AlterField(
            model_name='workspacechatmessage',
            name='body',
            field=notes.fields.EncryptedTextField(blank=True, default=''),
        ),
        migrations.AlterField(
            model_name='workspacemailmessage',
            name='body',
            field=notes.fields.EncryptedTextField(),
        ),
        migrations.AlterField(
            model_name='workspacemailmessage',
            name='subject',
            field=notes.fields.EncryptedTextField(),
        ),
        migrations.RunPython(encrypt_existing_rows, migrations.RunPython.noop),
    ]
