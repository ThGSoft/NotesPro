from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('notes', '0027_incoming_mail'),
    ]

    operations = [
        migrations.AddField(
            model_name='incomingmail',
            name='pdf_file',
            field=models.FileField(blank=True, null=True, upload_to='incoming_mail/%Y/%m/'),
        ),
    ]
