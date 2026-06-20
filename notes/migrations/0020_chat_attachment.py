from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('notes', '0019_user_settings_totp'),
    ]

    operations = [
        migrations.AddField(
            model_name='workspacechatmessage',
            name='attachment_url',
            field=models.CharField(blank=True, default='', max_length=500),
        ),
        migrations.AddField(
            model_name='workspacechatmessage',
            name='attachment_name',
            field=models.CharField(blank=True, default='', max_length=255),
        ),
        migrations.AlterField(
            model_name='workspacechatmessage',
            name='body',
            field=models.TextField(blank=True, default='', max_length=4000),
        ),
    ]
