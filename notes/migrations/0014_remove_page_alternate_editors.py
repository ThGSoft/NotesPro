from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('notes', '0013_workspace_invite_mail_chat'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='page',
            name='blocks_content',
        ),
        migrations.RemoveField(
            model_name='page',
            name='editor_mode',
        ),
        migrations.RemoveField(
            model_name='page',
            name='rich_content',
        ),
    ]
