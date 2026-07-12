import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import notes.fields


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('notes', '0026_user_settings_workspace_pages'),
    ]

    operations = [
        migrations.CreateModel(
            name='IncomingMail',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('sender_email', models.CharField(blank=True, default='', max_length=255)),
                ('subject', notes.fields.EncryptedTextField()),
                ('body', notes.fields.EncryptedTextField(blank=True, default='')),
                ('external_id', models.CharField(max_length=255, unique=True)),
                ('parsed_user', models.CharField(blank=True, default='', max_length=150)),
                ('parsed_workspace', models.CharField(blank=True, default='', max_length=255)),
                ('parsed_folder', models.CharField(blank=True, default='', max_length=500)),
                ('parsed_page', models.CharField(blank=True, default='', max_length=255)),
                ('status', models.CharField(
                    choices=[
                        ('pending', 'Pending'),
                        ('distributed', 'Distributed'),
                        ('dismissed', 'Dismissed'),
                    ],
                    db_index=True,
                    default='pending',
                    max_length=16,
                )),
                ('received_at', models.DateTimeField(auto_now_add=True)),
                ('distributed_at', models.DateTimeField(blank=True, null=True)),
                ('distributed_page', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='source_incoming_mails',
                    to='notes.page',
                )),
                ('recipient', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='incoming_mails',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'ordering': ['-received_at'],
            },
        ),
    ]
