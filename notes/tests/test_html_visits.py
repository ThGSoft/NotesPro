import os

from cryptography.fernet import Fernet
from django.contrib.auth.models import User
from django.test import Client, TestCase
from django.urls import reverse

from notes import db_crypto
from notes.ip_logging import PIXEL_GIF
from notes.models import IpVisitLog, Page, Workspace


class HtmlVisitLogTests(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        os.environ['DB_ENCRYPTION_KEY'] = Fernet.generate_key().decode()
        db_crypto._fernet = None

    def setUp(self):
        self.owner = User.objects.create_user('owner', password='pass')
        self.workspace = Workspace.objects.create(owner=self.owner, name='Main', slug='main')
        self.page = Page.objects.create(
            workspace=self.workspace,
            title='Notes',
            markdown_content='# Hello\n',
            settings={'public': True},
        )

    def test_anonymous_public_page_is_logged_and_pixel_adds_screen(self):
        client = Client()
        url = reverse('public_page', kwargs={
            'owner': 'owner',
            'workspace_slug': 'main',
            'page_slug': self.page.slug,
        })
        response = client.get(
            url,
            HTTP_REFERER='https://example.com/from?a=1&b=2',
            HTTP_USER_AGENT='VisitTest/1.0',
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn(reverse('visit_pixel'), response.content.decode())
        self.assertEqual(IpVisitLog.objects.count(), 1)
        log = IpVisitLog.objects.get()
        self.assertEqual(log.path, url)
        self.assertEqual(log.referer, 'https://example.com/from?a=1&b=2')
        self.assertEqual(log.user_agent, 'VisitTest/1.0')
        self.assertEqual(log.user, None)
        self.assertEqual(log.hostname, '')
        self.assertEqual(log.country, '')

        pixel = client.get(reverse('visit_pixel'), {'site': url, 'jsres': '1920x1080', 'jscolor': '24'})
        self.assertEqual(pixel.status_code, 200)
        self.assertEqual(pixel['Content-Type'], 'image/gif')
        self.assertEqual(pixel.content, PIXEL_GIF)
        self.assertEqual(IpVisitLog.objects.count(), 1)
        log.refresh_from_db()
        self.assertEqual(log.screen, '1920x1080')
        self.assertEqual(log.color_depth, '24')
        self.assertEqual(log.site, url)
        self.assertEqual(log.referer, 'https://example.com/from?a=1&b=2')

    def test_dontcount_cookie_skips_html_and_pixel(self):
        client = Client()
        client.cookies['dontcount'] = 'yes'
        response = client.get(reverse('login'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(IpVisitLog.objects.count(), 0)
        client.get(reverse('visit_pixel'), {'site': '/login/', 'jsres': '800x600', 'jscolor': '16'})
        self.assertEqual(IpVisitLog.objects.count(), 0)

    def test_js_mode_does_not_log(self):
        response = self.client.get(reverse('visit_pixel'), {'mode': 'js', 'site': '/login/'})
        self.assertEqual(response.status_code, 200)
        self.assertIn('javascript', response['Content-Type'])
        self.assertIn(reverse('visit_pixel'), response.content.decode())
        self.assertEqual(IpVisitLog.objects.count(), 0)

    def test_signed_in_visit_is_updated_not_duplicated(self):
        self.client.force_login(self.owner)
        response = self.client.get(reverse('dashboard'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(IpVisitLog.objects.filter(event_type=IpVisitLog.EVENT_VISIT).count(), 1)
        self.client.get(reverse('visit_pixel'), {'site': '/', 'jsres': '1280x720', 'jscolor': '32'})
        self.assertEqual(IpVisitLog.objects.filter(event_type=IpVisitLog.EVENT_VISIT).count(), 1)
        log = IpVisitLog.objects.get(event_type=IpVisitLog.EVENT_VISIT)
        self.assertEqual(log.screen, '1280x720')
        self.assertEqual(log.color_depth, '32')
        self.assertEqual(log.user, self.owner)
