import hashlib
from pathlib import Path

from django.conf import settings
from django.contrib.auth.models import User
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand

from notes.models import Page, UploadedFile, Workspace

SCREENSHOT_FILES = (
    'dashboard-overview.png',
    'dashboard-editor.png',
    'dashboard-preview.png',
    'dashboard-chat.png',
)


def ensure_screenshot_uploads(workspace, user):
    """Copy docs/screenshots PNGs into the workspace file manager."""
    url_by_name = {}
    src_dir = Path(settings.BASE_DIR) / 'docs' / 'screenshots'

    for name in SCREENSHOT_FILES:
        src = src_dir / name
        if not src.is_file():
            continue

        data = src.read_bytes()
        file_hash = hashlib.md5(data).hexdigest()
        existing = UploadedFile.objects.filter(
            workspace=workspace,
            md5_hash=file_hash,
        ).first()
        if existing:
            url_by_name[name] = existing.file.url
            continue

        item = UploadedFile(
            user=user,
            workspace=workspace,
            md5_hash=file_hash,
            original_name=name,
        )
        item.file.save(name, ContentFile(data), save=True)
        url_by_name[name] = item.file.url

    return url_by_name


def build_readme_markdown(workspace, user):
    readme_path = Path(settings.BASE_DIR) / 'README.md'
    if not readme_path.is_file():
        return (
            '# Django Notes Pro\n\n'
            'README.md was not found in the project root.\n'
        )

    text = readme_path.read_text(encoding='utf-8')
    for name, url in ensure_screenshot_uploads(workspace, user).items():
        text = text.replace(f'docs/screenshots/{name}', url)
    return text


class Command(BaseCommand):
    help = 'Create demo workspace and pages'

    def handle(self, *args, **options):
        user, created = User.objects.get_or_create(
            username='demo',
            defaults={'email': 'demo@example.com'},
        )
        if created:
            user.set_password('password')
            user.save()

        ws, _ = Workspace.objects.get_or_create(
            owner=user,
            slug='main',
            deleted=False,
            defaults={'name': 'Main'},
        )
        docs, _ = Page.objects.get_or_create(
            workspace=ws,
            title='Docs',
            is_folder=True,
            deleted=False,
            defaults={'slug': 'docs'},
        )

        readme_content = build_readme_markdown(ws, user)
        Page.objects.update_or_create(
            workspace=ws,
            slug='readme',
            deleted=False,
            defaults={
                'parent': docs,
                'title': 'README',
                'sort_order': 0,
                'markdown_content': readme_content,
            },
        )

        Page.objects.update_or_create(
            workspace=ws,
            slug='welcome',
            deleted=False,
            defaults={
                'parent': docs,
                'title': 'Welcome',
                'sort_order': 1,
                'markdown_content': (
                    '# Welcome\n\n'
                    'Edit in markdown, preview when you are done.\n\n'
                    'See **README** in this folder for the full project guide and screenshots.'
                ),
            },
        )

        missing = [
            name for name in SCREENSHOT_FILES
            if not (Path(settings.BASE_DIR) / 'docs' / 'screenshots' / name).is_file()
        ]
        if missing:
            self.stdout.write(self.style.WARNING(
                f'Screenshot files missing (README images may be broken): {", ".join(missing)}',
            ))

        self.stdout.write(self.style.SUCCESS(
            'Demo data ready. Login: demo / password — open Docs → README',
        ))
