from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion

class Migration(migrations.Migration):
    initial = True
    dependencies = [migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.CreateModel(
            name='Workspace',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=120)),
                ('slug', models.SlugField(max_length=140)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('owner', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='workspaces', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['name'], 'unique_together': {('owner', 'slug')}},
        ),
        migrations.CreateModel(
            name='Page',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('title', models.CharField(max_length=255)),
                ('slug', models.SlugField(blank=True, max_length=255)),
                ('is_folder', models.BooleanField(default=False)),
                ('sort_order', models.IntegerField(default=0)),
                ('editor_mode', models.CharField(choices=[('rich', 'Rich'), ('markdown', 'Markdown'), ('blocks', 'Blocks')], default='rich', max_length=20)),
                ('rich_content', models.TextField(blank=True, default='')),
                ('markdown_content', models.TextField(blank=True, default='')),
                ('blocks_content', models.JSONField(blank=True, default=list)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('parent', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='children', to='notes.page')),
                ('workspace', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='pages', to='notes.workspace')),
            ],
            options={'ordering': ['sort_order', 'id'], 'unique_together': {('workspace', 'slug')}},
        ),
        migrations.CreateModel(
            name='UploadedFile',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('file', models.FileField(upload_to='uploads/%Y/%m/')),
                ('original_name', models.CharField(max_length=255)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('workspace', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='uploads', to='notes.workspace')),
            ],
            options={'ordering': ['-created_at']},
        ),
    ]
