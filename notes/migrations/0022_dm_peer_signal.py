from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('notes', '0021_direct_messages_e2e'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='DmPeerSignal',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('kind', models.CharField(max_length=16)),
                ('payload', models.TextField()),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('recipient', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='dm_signals_received', to=settings.AUTH_USER_MODEL)),
                ('sender', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='dm_signals_sent', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['id'],
                'indexes': [models.Index(fields=['recipient', 'id'], name='notes_dmpeer_recip_id_idx')],
            },
        ),
    ]
