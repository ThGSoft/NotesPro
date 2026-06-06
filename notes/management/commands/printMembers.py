from django.core.management.base import BaseCommand, CommandError
from django.contrib.auth import get_user_model
# Ersetzen Sie 'ihre_app' durch den echten Namen Ihrer App
from notes.models import Workspace, WorkspaceMembership 

User = get_user_model()

class Command(BaseCommand):
    help = "Listet alle Mitglieder eines Workspaces optimiert auf"

    def add_arguments(self, parser):
        # Pflichtargument: Die ID des Workspaces
        parser.add_argument('workspace_id', type=int, help='ID des Workspaces')
        # Optionaler Filter: Nur bestimmte Rollen anzeigen
        parser.add_argument('--role', type=str, help='Filter nach Rolle (z.B. admin, member)')

    def handle(self, *args, **options):
        workspace_id = options['workspace_id']
        role_filter = options['role']

        # Prüfen, ob der Workspace existiert
        try:
            workspace = Workspace.objects.get(id=workspace_id)
        except Workspace.DoesNotExist:
            raise CommandError(f"Workspace mit ID {workspace_id} existiert nicht.")

        # Basis-Query mit select_related (optimiert)
        queryset = WorkspaceMembership.objects.filter(workspace_id=workspace_id).select_related('user')

        # Optionalen Rollen-Filter anwenden
        if role_filter:
            queryset = queryset.filter(role=role_filter) # Feldname ggf. anpassen

        # Ausgabe formatieren
        self.stdout.write(self.style.SUCCESS(f"\n--- Mitglieder für Workspace: {workspace.name} (ID: {workspace.id}) ---"))
        
        if not queryset.exists():
            self.stdout.write(self.style.WARNING("Keine Mitglieder gefunden."))
            return

        for m in queryset:
            # Dynamische Erkennung des Rollen-Felds (falls vorhanden)
            role_name = getattr(m, 'role', 'N/A')
            self.stdout.write(
                f"ID: {m.user.id:<5} | "
                f"Username: {m.user.username:<15} | "
                f"E-Mail: {m.user.email:<25} | "
                f"Rolle: {role_name}"
            )


from django.contrib.auth.models import User
from notes.models import Workspace, WorkspaceMembership

# 1. Testdaten holen (IDs anpassen!)
workspace = Workspace.objects.get(id=3)
test_user = User.objects.get(username='eva')

# 2. Deine Abfrage testen (Achte auf die schliessende Klammer am Ende!)
is_member = WorkspaceMembership.objects.filter(workspace_id=workspace.id, user_id=test_user.id).exists()




