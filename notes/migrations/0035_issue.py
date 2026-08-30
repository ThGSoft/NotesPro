from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import notes.fields


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('notes', '0034_ipvisitlog'),
    ]

    operations = [
        migrations.CreateModel(
            name='Issue',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('number', models.PositiveIntegerField(db_index=True)),
                ('title', notes.fields.EncryptedTextField(blank=True, default='')),
                ('body', notes.fields.EncryptedTextField(blank=True, default='')),
                ('status', models.CharField(
                    choices=[
                        ('open', 'Open'),
                        ('in_progress', 'In progress'),
                        ('review', 'Review'),
                        ('closed', 'Closed'),
                    ],
                    db_index=True,
                    default='open',
                    max_length=16,
                )),
                ('priority', models.CharField(
                    choices=[
                        ('low', 'Low'),
                        ('normal', 'Normal'),
                        ('high', 'High'),
                        ('urgent', 'Urgent'),
                    ],
                    db_index=True,
                    default='normal',
                    max_length=16,
                )),
                ('labels', models.JSONField(blank=True, default=list)),
                ('deleted', models.BooleanField(db_index=True, default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('assignee', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='assigned_issues',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('page', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='issues',
                    to='notes.page',
                )),
                ('reporter', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='reported_issues',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('workspace', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='issues',
                    to='notes.workspace',
                )),
            ],
            options={
                'ordering': ['-updated_at', '-id'],
            },
        ),
        migrations.AddConstraint(
            model_name='issue',
            constraint=models.UniqueConstraint(
                fields=('workspace', 'number'),
                name='notes_issue_workspace_number',
            ),
        ),
    ]
