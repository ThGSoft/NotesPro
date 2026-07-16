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


BLOCKS_DEMO_MARKDOWN = """# Gantt

```gantt{from=01.07.26;to=31.07.26;col=info}
# Project plan
Phase A | 01.07.26 | 15.07.26 | **Start**
Phase B | 15.07.26 | 31.07.26 | Delivery
```
# Calendar
```calendar{from=01.07.26;to=11.07.26;mode=day;col=primary}
```
```calendar{from=01.07.26;to=11.07.26;mode=day;col=danger}
```
```calendar{from=01.07.26;to=31.07.26;mode=week;col=primary}
@w:2026-w27 | Ferien
```
# Mindmap
```mindmap{dir=right;col=warning}
# Ideas
Central topic
  Branch A | **Key point**
    Detail A1
    Detail A2
  Branch B
    Detail B1 | note
```
# Kanban
```kanban{cols=Todo,Doing,Done;col=danger}
# MidasNano Remote
Todo | Create 488 Api | **Basis 488 Commmands**
Todo | Build API
Done | Kickoff | ![](/media/uploads/photo.png)
Done | Define Remote
```

```panel info
# info
Your content here.
```
# Panels
```panel success
# success
Your content here.
```
```panel danger
# danger
Your content here.
```

```panel note
# note
Your content here.
```

```panel warning
# Warning
Your content here.
```
# Sprint Board
```kanbangantt{cols=Todo,Doing,Suspended,Done;withcost=1;rate=50;currency=EUR;col=info}
# Sprint board
Todo | Design wireframes | status=idle;rate=60
Doing | Build API | status=idle;rate=75
Suspended | On hold task | status=suspended;rate=75;elapsed=1800
Done | Kickoff | status=stopped;rate=50;elapsed=7200
```
"""


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
                    'See **README** in this folder for the full project guide and screenshots.\n\n'
                    'Open **Blocks** for interactive gantt, calendar, mindmap, kanban, and panel examples.'
                ),
            },
        )

        Page.objects.update_or_create(
            workspace=ws,
            slug='blocks',
            deleted=False,
            defaults={
                'parent': docs,
                'title': 'Blocks',
                'sort_order': 2,
                'markdown_content': BLOCKS_DEMO_MARKDOWN,
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
            'Demo data ready. Login: demo / password — open Docs > README or Blocks',
        ))
