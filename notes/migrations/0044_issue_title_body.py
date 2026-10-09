from django.db import migrations, models

import notes.fields


def align_issue_columns(apps, schema_editor):
    """Repair databases created with subject/description before title/body.

    Migration 0035 is already recorded on those databases, so Django will not
    recreate the table. Fresh installs already have title, body, and labels.
    """
    connection = schema_editor.connection
    table = 'notes_issue'
    qn = schema_editor.quote_name

    def column_names():
        with connection.cursor() as cursor:
            return {
                col.name
                for col in connection.introspection.get_table_description(cursor, table)
            }

    columns = column_names()
    if 'subject' in columns and 'title' not in columns:
        schema_editor.execute(
            f'ALTER TABLE {qn(table)} RENAME COLUMN {qn("subject")} TO {qn("title")}'
        )
    if 'description' in columns and 'body' not in columns:
        schema_editor.execute(
            f'ALTER TABLE {qn(table)} RENAME COLUMN {qn("description")} TO {qn("body")}'
        )

    columns = column_names()
    Issue = apps.get_model('notes', 'Issue')
    if 'title' not in columns:
        field = notes.fields.EncryptedTextField(blank=True, default='')
        field.set_attributes_from_name('title')
        schema_editor.add_field(Issue, field)
    if 'body' not in columns:
        field = notes.fields.EncryptedTextField(blank=True, default='')
        field.set_attributes_from_name('body')
        schema_editor.add_field(Issue, field)
    if 'labels' not in columns:
        field = models.JSONField(blank=True, default=list)
        field.set_attributes_from_name('labels')
        schema_editor.add_field(Issue, field)


class Migration(migrations.Migration):

    dependencies = [
        ('notes', '0042_ipvisitlog_html_fields'),
    ]

    operations = [
        migrations.RunPython(align_issue_columns, migrations.RunPython.noop),
    ]
