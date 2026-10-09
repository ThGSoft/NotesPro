import json
from pathlib import Path
from subprocess import CompletedProcess
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.urls import reverse

from notes.models import UploadedFile, Workspace
from notes.ytdl import YtDlpError, download_youtube, normalize_youtube_url, ytdlp_names


class YoutubeDownloadTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user('owner', password='pass')
        self.workspace = Workspace.objects.create(owner=self.owner, name='Main', slug='main')
        self.client.force_login(self.owner)

    def test_rejects_a_link_that_is_not_youtube(self):
        with self.assertRaises(YtDlpError):
            normalize_youtube_url('https://example.com/watch?v=abc')
        response = self.client.post(
            reverse('api_ytdl'),
            data=json.dumps({'workspace': self.workspace.id, 'url': 'https://example.com/video'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('YouTube', response.json()['error'])

    def test_missing_binary_is_reported(self):
        with patch('notes.ytdl.find_ytdlp', return_value=None):
            response = self.client.post(
                reverse('api_ytdl'),
                data=json.dumps({
                    'workspace': self.workspace.id,
                    'url': 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
                }),
                content_type='application/json',
            )
        self.assertEqual(response.status_code, 400)
        self.assertIn('yt-dlp', response.json()['error'])

    def test_linux_uses_yt_dlp(self):
        with patch('notes.ytdl.sys.platform', 'linux'):
            self.assertEqual(ytdlp_names(), ('yt-dlp',))
            with patch('notes.ytdl.find_ytdlp', return_value=None):
                with self.assertRaises(YtDlpError) as caught:
                    download_youtube('https://youtu.be/dQw4w9WgXcQ')
        self.assertIn('yt-dlp was not found', str(caught.exception))
        self.assertNotIn('yt-dlp_x86', str(caught.exception))

    def test_saves_the_file_yt_dlp_writes(self):
        def fake_run(exe, url, dest):
            (Path(dest) / 'Clip-dQw4w9WgXcQ.mp4').write_bytes(b'fake-video')
            return CompletedProcess(args=[], returncode=0, stdout='', stderr='')

        with TemporaryDirectory() as media_root, override_settings(MEDIA_ROOT=media_root), \
                patch('notes.ytdl.find_ytdlp', return_value=Path('yt-dlp_x86.exe')), \
                patch('notes.ytdl.run_ytdlp', side_effect=fake_run):
            response = self.client.post(
                reverse('api_ytdl'),
                data=json.dumps({
                    'workspace': self.workspace.id,
                    'url': 'https://youtu.be/dQw4w9WgXcQ',
                }),
                content_type='application/json',
            )
            self.assertEqual(response.status_code, 200, response.content)
            body = response.json()
            self.assertTrue(body['success'])
            self.assertEqual(body['file']['original_name'], 'Clip-dQw4w9WgXcQ.mp4')
            stored = UploadedFile.objects.get(workspace=self.workspace)
            self.assertEqual(stored.original_name, 'Clip-dQw4w9WgXcQ.mp4')
            self.assertTrue(Path(media_root, stored.file.name).is_file())
