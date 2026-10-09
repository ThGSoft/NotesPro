from django.contrib.auth.models import User
from django.test import Client, TestCase
from django.urls import reverse

from notes.models import Workspace
from notes.version import LICENSE


class SettingsLicenseTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('owner', password='pass')
        Workspace.objects.create(owner=self.user, name='Main', slug='main')
        self.client = Client()
        self.client.force_login(self.user)

    def test_settings_includes_license(self):
        response = self.client.get(reverse('dashboard'))
        self.assertEqual(response.status_code, 200)
        content = response.content.decode()
        self.assertIn('License', content)
        self.assertIn('app-settings-about-license', content)
        for para in LICENSE:
            self.assertIn(para, content)
