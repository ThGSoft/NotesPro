from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('notes', '0039_storage_settings'),
    ]

    operations = [
        migrations.AddField(
            model_name='storagesettings',
            name='user_quota_mb',
            field=models.PositiveIntegerField(
                default=0,
                help_text='Default storage quota per user (uploads and pastes they created, plus incoming mail). 0 = unlimited. Individual users can override this in User settings.',
            ),
        ),
        migrations.AddField(
            model_name='usersettings',
            name='storage_quota_mb',
            field=models.PositiveIntegerField(
                blank=True,
                help_text='Override the site default quota for this user. Leave empty to inherit. 0 = unlimited.',
                null=True,
            ),
        ),
    ]
