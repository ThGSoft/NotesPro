from django.db import migrations, models
import django.db.models.deletion
from django.conf import settings


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('notes', '0033_page_archive'),
    ]

    operations = [
        migrations.CreateModel(
            name='IpVisitLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('ip_address', models.GenericIPAddressField(db_index=True)),
                ('method', models.CharField(blank=True, default='', max_length=10)),
                ('path', models.CharField(blank=True, default='', max_length=512)),
                ('query_string', models.CharField(blank=True, default='', max_length=512)),
                ('user_agent', models.CharField(blank=True, default='', max_length=512)),
                ('event_type', models.CharField(choices=[('visit', 'Visit'), ('login', 'Login')], db_index=True, default='visit', max_length=16)),
                ('country', models.CharField(blank=True, default='', max_length=120)),
                ('country_code', models.CharField(blank=True, default='', max_length=8)),
                ('region', models.CharField(blank=True, default='', max_length=120)),
                ('city', models.CharField(blank=True, default='', max_length=120)),
                ('latitude', models.DecimalField(blank=True, decimal_places=6, max_digits=9, null=True)),
                ('longitude', models.DecimalField(blank=True, decimal_places=6, max_digits=9, null=True)),
                ('isp', models.CharField(blank=True, default='', max_length=255)),
                ('org', models.CharField(blank=True, default='', max_length=255)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('user', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='ip_visits', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'IP visit log',
                'verbose_name_plural': 'IP visit logs',
                'ordering': ['-created_at'],
            },
        ),
    ]
