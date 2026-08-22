from django.db import migrations

import notes.fields


class Migration(migrations.Migration):

    dependencies = [
        ('notes', '0032_workspace_groups'),
    ]

    operations = [
        migrations.AddField(
            model_name='page',
            name='archive',
            field=notes.fields.EncryptedTextField(blank=True, default=''),
        ),
    ]
