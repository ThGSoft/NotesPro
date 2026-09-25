from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('notes', '0040_user_storage_quota'),
    ]

    operations = [
        migrations.AddField(
            model_name='usersettings',
            name='stay_informed',
            field=models.BooleanField(
                default=False,
                help_text='Email product updates and news. Opt-in from registration or Settings.',
            ),
        ),
    ]
