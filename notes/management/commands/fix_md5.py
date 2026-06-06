import hashlib
from django.core.management.base import BaseCommand
from notes.models import UploadedFile


class Command(BaseCommand):
    help = "Berechnet MD5-Hashes für Uploads und löscht verwaiste Datenbank-Einträge."

    def handle(self, *args, **kwargs):
        for obj in UploadedFile.objects.all():
            # 1. Prüfen, ob überhaupt ein Dateipfad im Modell hinterlegt ist
            if not obj.file:
                self.stdout.write(self.style.WARNING(f"Eintrag ID {obj.id} hat keinen Dateipfad. Lösche aus DB..."))
                obj.delete()
                continue

            # 2. Prüfen, ob die Datei physisch im Dateisystem existiert
            if not obj.file.storage.exists(obj.file.name):
                self.stdout.write(self.style.ERROR(f"Datei '{obj.file.name}' existiert nicht auf dem Server. Lösche Eintrag ID {obj.id}..."))
                obj.delete()  # Löscht den Eintrag sicher aus der Datenbank
                continue

            # 3. Datei ist vorhanden -> MD5-Hash berechnen
            try:
                with obj.file.open('rb') as f:
                    md5 = hashlib.md5(f.read()).hexdigest()
                
                obj.md5_hash = md5
                obj.save()
                
                self.stdout.write(self.style.SUCCESS(f"Erfolgreich geupdated: User: {obj.user} | Hash: {md5}"))
            except Exception as e:
                self.stdout.write(self.style.ERROR(f"Fehler beim Verarbeiten von ID {obj.id}: {e}"))
