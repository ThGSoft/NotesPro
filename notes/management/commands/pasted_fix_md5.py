from django.core.management.base import BaseCommand
from notes.models import PastedFile
import hashlib

class Command(BaseCommand):
    def handle(self, *args, **kwargs):
        for obj in PastedFile.objects.all():
            if obj.file:
                with obj.file.open('rb') as f:
                    md5 = hashlib.md5(f.read()).hexdigest()
                obj.md5_hash = md5
                obj.save()
                print("saved:", obj.id, md5)