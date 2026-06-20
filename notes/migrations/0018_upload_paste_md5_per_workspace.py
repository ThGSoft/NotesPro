from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('notes', '0017_user_settings_right_panel_width'),
    ]

    operations = [
        migrations.AlterField(
            model_name='uploadedfile',
            name='md5_hash',
            field=models.CharField(db_index=True, max_length=32),
        ),
        migrations.AlterField(
            model_name='pastedfile',
            name='md5_hash',
            field=models.CharField(db_index=True, max_length=32),
        ),
        migrations.AddConstraint(
            model_name='uploadedfile',
            constraint=models.UniqueConstraint(
                fields=('workspace', 'md5_hash'),
                name='notes_uploadedfile_workspace_md5',
            ),
        ),
        migrations.AddConstraint(
            model_name='pastedfile',
            constraint=models.UniqueConstraint(
                fields=('workspace', 'md5_hash'),
                name='notes_pastedfile_workspace_md5',
            ),
        ),
    ]
