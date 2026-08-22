from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('auth', '0012_alter_user_first_name_max_length'),
        ('notes', '0031_quicknote_sort_order'),
    ]

    operations = [
        migrations.AddField(
            model_name='workspace',
            name='groups',
            field=models.ManyToManyField(blank=True, related_name='workspaces', to='auth.group'),
        ),
    ]
