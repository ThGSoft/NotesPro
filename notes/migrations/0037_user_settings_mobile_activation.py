from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('notes', '0036_gamehighscore'),
    ]

    operations = [
        migrations.AddField(
            model_name='usersettings',
            name='mobile',
            field=models.CharField(blank=True, db_index=True, default='', max_length=32),
        ),
        migrations.AddField(
            model_name='usersettings',
            name='mobile_verified',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='usersettings',
            name='activation_code_hash',
            field=models.CharField(blank=True, default='', max_length=128),
        ),
        migrations.AddField(
            model_name='usersettings',
            name='activation_sent_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
