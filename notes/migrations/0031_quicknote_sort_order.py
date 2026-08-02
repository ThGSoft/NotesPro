from django.db import migrations, models


def backfill_sort_order(apps, schema_editor):
    QuickNote = apps.get_model('notes', 'QuickNote')
    workspace_ids = (
        QuickNote.objects.order_by('workspace_id')
        .values_list('workspace_id', flat=True)
        .distinct()
    )
    for workspace_id in workspace_ids:
        for archived in (False, True):
            for pinned in (True, False):
                notes = list(
                    QuickNote.objects.filter(
                        workspace_id=workspace_id,
                        archived=archived,
                        pinned=pinned,
                        deleted=False,
                    ).order_by('-updated_at', '-id')
                )
                for index, note in enumerate(notes):
                    if note.sort_order != index:
                        QuickNote.objects.filter(pk=note.pk).update(sort_order=index)


class Migration(migrations.Migration):

    dependencies = [
        ('notes', '0030_quicknote'),
    ]

    operations = [
        migrations.AddField(
            model_name='quicknote',
            name='sort_order',
            field=models.IntegerField(db_index=True, default=0),
        ),
        migrations.AlterModelOptions(
            name='quicknote',
            options={'ordering': ['-pinned', 'sort_order', '-updated_at', '-id']},
        ),
        migrations.RunPython(backfill_sort_order, migrations.RunPython.noop),
    ]
