from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from notes.models import Workspace, Page

class Command(BaseCommand):
    help = 'Create demo workspace and pages'

    def handle(self, *args, **options):
        user, created = User.objects.get_or_create(username='demo', defaults={'email': 'demo@example.com'})
        if created:
            user.set_password('password')
            user.save()
        ws, _ = Workspace.objects.get_or_create(
            owner=user, slug='main', deleted=False, defaults={'name': 'Main'},
        )
        docs, _ = Page.objects.get_or_create(
            workspace=ws, title='Docs', is_folder=True, deleted=False,
            defaults={'slug': 'docs'},
        )
        Page.objects.get_or_create(
            workspace=ws,
            parent=docs,
            title='Welcome',
            deleted=False,
            defaults={
                'slug': 'welcome',
                'editor_mode': 'rich',
                'rich_content': '<h1>Welcome</h1><p>Quill editor is ready.</p>',
                'markdown_content': '# Welcome\n\nMarkdown mode is ready.',
                'blocks_content': [
                    {'type': 'heading', 'text': 'Welcome'},
                    {'type': 'text', 'text': 'Blocks mode is ready.'}
                ],
            },
        )
        self.stdout.write(self.style.SUCCESS('Demo data ready. Login: demo / password'))
