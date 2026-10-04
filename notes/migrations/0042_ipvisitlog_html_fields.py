from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('notes', '0041_user_settings_stay_informed'),
    ]

    operations = [
        migrations.AddField(
            model_name='ipvisitlog',
            name='hostname',
            field=models.CharField(blank=True, default='', max_length=255),
        ),
        migrations.AddField(
            model_name='ipvisitlog',
            name='referer',
            field=models.CharField(blank=True, default='', max_length=1024),
        ),
        migrations.AddField(
            model_name='ipvisitlog',
            name='site',
            field=models.CharField(blank=True, default='', max_length=512),
        ),
        migrations.AddField(
            model_name='ipvisitlog',
            name='screen',
            field=models.CharField(blank=True, default='', max_length=32),
        ),
        migrations.AddField(
            model_name='ipvisitlog',
            name='color_depth',
            field=models.CharField(blank=True, default='', max_length=8),
        ),
    ]
