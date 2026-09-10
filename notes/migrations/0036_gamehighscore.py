from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('notes', '0035_issue'),
    ]

    operations = [
        migrations.CreateModel(
            name='GameHighScore',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('game', models.CharField(db_index=True, max_length=32)),
                ('score', models.PositiveIntegerField(default=0)),
                ('extra', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='game_highscores',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('workspace', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='game_highscores',
                    to='notes.workspace',
                )),
            ],
            options={
                'ordering': ['-score', 'updated_at'],
            },
        ),
        migrations.AddConstraint(
            model_name='gamehighscore',
            constraint=models.UniqueConstraint(
                fields=('workspace', 'user', 'game'),
                name='notes_gamehighscore_workspace_user_game',
            ),
        ),
    ]
