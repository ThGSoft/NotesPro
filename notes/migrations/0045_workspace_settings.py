from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('notes', '0044_issue_title_body'),
    ]

    operations = [
        migrations.AddField(
            model_name='workspace',
            name='settings',
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
