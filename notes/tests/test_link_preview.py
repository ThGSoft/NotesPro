from unittest.mock import patch

from django.test import SimpleTestCase

from notes.link_preview import extract_link_preview, preview_for_url


SAMPLE = """
<html><head>
<meta property="og:title" content="Hello &amp; Co">
<meta content="https://cdn.example.com/cover.jpg?x=1&amp;y=2" property="og:image">
<title>Ignored</title>
</head><body></body></html>
"""


class LinkPreviewTests(SimpleTestCase):
    def test_extract_og_image_and_title(self):
        data = extract_link_preview(SAMPLE, 'https://example.com/story')
        self.assertEqual(data['title'], 'Hello & Co')
        self.assertEqual(data['image'], 'https://cdn.example.com/cover.jpg?x=1&y=2')

    def test_extract_resolves_relative_image(self):
        html = '<meta property="og:image" content="/photos/a.png"><title>Shot</title>'
        data = extract_link_preview(html, 'https://example.com/album/')
        self.assertEqual(data['image'], 'https://example.com/photos/a.png')
        self.assertEqual(data['title'], 'Shot')

    def test_extract_twitter_fallback(self):
        html = '<meta name="twitter:image" content="https://cdn.example.com/tw.jpg">'
        data = extract_link_preview(html, 'https://example.com/p')
        self.assertEqual(data['image'], 'https://cdn.example.com/tw.jpg')

    def test_extract_skips_private_image(self):
        html = '<meta property="og:image" content="http://127.0.0.1/secret.jpg">'
        data = extract_link_preview(html, 'https://example.com/p')
        self.assertEqual(data['image'], 'https://example.com/favicon.ico')
        self.assertTrue(data['icon'])

    def test_extract_uses_declared_icon_when_no_preview(self):
        html = '<link rel="icon" href="/touch.png" sizes="32x32"><link rel="apple-touch-icon" href="/apple.png"><title>Bare</title>'
        data = extract_link_preview(html, 'https://example.com/notes')
        self.assertEqual(data['image'], 'https://example.com/apple.png')
        self.assertTrue(data['icon'])
        self.assertEqual(data['title'], 'Bare')

    def test_extract_favicon_ico_when_page_has_no_image(self):
        data = extract_link_preview('<title>Only text</title>', 'https://example.com/page')
        self.assertEqual(data['image'], 'https://example.com/favicon.ico')
        self.assertTrue(data['icon'])

    def test_rejects_loopback_page(self):
        with self.assertRaises(ValueError):
            preview_for_url('http://127.0.0.1/secret')

    def test_fetch_reads_preview_image(self):
        html = b'<html><head><meta property="og:image" content="https://cdn.example.com/a.jpg"><meta property="og:title" content="Demo"></head></html>'

        class FakeResp:
            headers = {'Content-Type': 'text/html; charset=utf-8'}

            def read(self, _n):
                if not hasattr(self, '_done'):
                    self._done = True
                    return html
                return b''

            def geturl(self):
                return 'https://example.com/story'

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

        with patch('notes.link_preview.urlopen', return_value=FakeResp()), \
                patch('notes.link_preview.assert_public_page_url'), \
                patch('notes.link_preview.cache') as cache:
            cache.get.return_value = None
            data = preview_for_url('https://example.com/story')
        self.assertEqual(data['image'], 'https://cdn.example.com/a.jpg')
        self.assertEqual(data['title'], 'Demo')
