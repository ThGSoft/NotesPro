from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('notes', '0018_upload_paste_md5_per_workspace'),
    ]

    operations = [
        migrations.AddField(
            model_name='usersettings',
            name='totp_enabled',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='usersettings',
            name='totp_secret',
            field=models.CharField(blank=True, default='', max_length=64),
        ),
    ]
