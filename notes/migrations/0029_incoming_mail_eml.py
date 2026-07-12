from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('notes', '0028_incoming_mail_pdf'),
    ]

    operations = [
        migrations.AddField(
            model_name='incomingmail',
            name='eml_file',
            field=models.FileField(blank=True, null=True, upload_to='incoming_mail/%Y/%m/'),
        ),
    ]
