from django.apps import AppConfig

class NotesConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'notes'

    def ready(self):
        import notes.signals  # Lädt die Signale beim Serverstart
        from django.conf import settings
        from django.contrib import admin

        # Apache only proxies /NotesPro/ (with the slash). Django's default
        # "View site" link uses SCRIPT_NAME, which has no trailing slash.
        script = (getattr(settings, 'FORCE_SCRIPT_NAME', '') or '').rstrip('/')
        if script:
            admin.site.site_url = f'{script}/'