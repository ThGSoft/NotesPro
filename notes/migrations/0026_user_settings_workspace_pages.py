from django.db import migrations, models


def copy_last_page_to_workspace_pages(apps, schema_editor):
    UserSettings = apps.get_model('notes', 'UserSettings')
    for settings in UserSettings.objects.all():
        pages = dict(settings.workspace_pages or {})
        if settings.last_workspace_id and settings.last_page_id:
            pages[str(settings.last_workspace_id)] = settings.last_page_id
        if pages != (settings.workspace_pages or {}):
            settings.workspace_pages = pages
            settings.save(update_fields=['workspace_pages'])


class Migration(migrations.Migration):

    dependencies = [
        ('notes', '0025_tags'),
    ]

    operations = [
        migrations.AddField(
            model_name='usersettings',
            name='workspace_pages',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.RunPython(copy_last_page_to_workspace_pages, migrations.RunPython.noop),
    ]
