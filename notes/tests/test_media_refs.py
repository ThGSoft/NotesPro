from pathlib import Path
from tempfile import TemporaryDirectory

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import SimpleTestCase, TestCase, override_settings

from notes.media_refs import (
    clear_broken_media_links_in_text,
    extract_media_paths_from_text,
    media_markdown_href,
    normalize_media_paths_in_text,
    normalize_media_relpath,
)
from notes.models import Page, UploadedFile, Workspace


class MediaRefsParseTests(SimpleTestCase):
    def test_normalize_media_paths(self):
        self.assertEqual(
            normalize_media_relpath('/media/uploads/2026/01/report.pdf'),
            'uploads/2026/01/report.pdf',
        )
        self.assertEqual(
            normalize_media_relpath('media/pasted_images/2026/01/screenshot.png'),
            'pasted_images/2026/01/screenshot.png',
        )
        self.assertIsNone(normalize_media_relpath('file:///C:/Users/demo/file.pdf'))
        self.assertIsNone(normalize_media_relpath('https://example.com/page'))

    def test_extract_media_paths_from_markdown(self):
        text = (
            '![shot](/media/pasted_images/2026/01/a.png){width=100%}\n'
            '[PDF](/media/uploads/2026/01/b.pdf)\n'
            'Also pasted_images/2026/01/c.png inline.'
        )
        paths = extract_media_paths_from_text(text)
        self.assertEqual(
            paths,
            {
                'pasted_images/2026/01/a.png',
                'uploads/2026/01/b.pdf',
                'pasted_images/2026/01/c.png',
            },
        )

    def test_normalize_media_paths_in_text(self):
        text = (
            '![shot](/media/pasted_images/2026/01/a.png){width=100%}\n'
            '[PDF](/media/uploads/2026/01/b.pdf)\n'
            'See uploads/2026/01/report.pdf for details.'
        )
        updated, count = normalize_media_paths_in_text(text)
        self.assertEqual(count, 3)
        self.assertIn('![shot](media/pasted_images/2026/01/a.png){width=100%}', updated)
        self.assertIn('[PDF](media/uploads/2026/01/b.pdf)', updated)
        self.assertIn('[report.pdf](media/uploads/2026/01/report.pdf)', updated)

    def test_media_markdown_href(self):
        self.assertEqual(
            media_markdown_href('/media/uploads/2026/01/report.pdf'),
            'media/uploads/2026/01/report.pdf',
        )
        self.assertEqual(
            media_markdown_href('media/pasted_images/2026/01/a.png'),
            'media/pasted_images/2026/01/a.png',
        )

    @override_settings(MEDIA_ROOT='/tmp/notes-media-test')
    def test_clear_broken_media_links(self):
        media_root = Path('/tmp/notes-media-test')
        existing = media_root / 'uploads/2026/01/ok.pdf'
        existing.parent.mkdir(parents=True, exist_ok=True)
        existing.write_bytes(b'pdf')

        text = (
            '![good](/media/uploads/2026/01/ok.pdf)\n'
            '![missing](/media/uploads/2026/01/gone.png){width=50%}\n'
            '[still here](/media/uploads/2026/01/ok.pdf)\n'
            '[gone](/media/uploads/2026/01/missing.docx)'
        )
        updated, count = clear_broken_media_links_in_text(text)
        self.assertEqual(count, 2)
        self.assertIn('good', updated)
        self.assertNotIn('gone.png', updated)
        self.assertIn('still here', updated)
        self.assertNotIn('missing.docx', updated)
        self.assertIn('gone', updated)


class PurgeUnreferencedMediaCommandTests(TestCase):
    @override_settings(DEBUG=True)
    def test_dry_run_lists_unreferenced_upload(self):
        User = get_user_model()
        user = User.objects.create_user(username='owner', password='x')

        with TemporaryDirectory() as tmpdir:
            workspace = Workspace.objects.create(owner=user, name='WS', slug='ws')

            media_dir = Path(tmpdir) / 'uploads/2026/07'
            media_dir.mkdir(parents=True)
            file_path = media_dir / 'unused.pdf'
            file_path.write_bytes(b'pdf')

            uploaded = UploadedFile.objects.create(
                user=user,
                workspace=workspace,
                md5_hash='abc',
                original_name='unused.pdf',
            )
            uploaded.file.name = 'uploads/2026/07/unused.pdf'
            uploaded.save()

            Page.objects.create(
                workspace=workspace,
                title='Home',
                slug='home',
                markdown_content='No media here.',
            )

            from io import StringIO

            out = StringIO()
            with override_settings(MEDIA_ROOT=tmpdir):
                call_command('purge_unreferenced_media', '--dry-run', stdout=out)
            self.assertIn('unused.pdf', out.getvalue())
