from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('notes', '0037_user_settings_mobile_activation'),
    ]

    operations = [
        migrations.AddField(
            model_name='page',
            name='settings',
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
