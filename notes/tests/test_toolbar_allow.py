import os

from cryptography.fernet import Fernet
from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.urls import reverse

from notes import db_crypto
from notes.models import Workspace


class ToolbarAllowFlagsTests(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        os.environ['DB_ENCRYPTION_KEY'] = Fernet.generate_key().decode()
        db_crypto._fernet = None

    def setUp(self):
        self.user = User.objects.create_user('demo', password='pass')
        Workspace.objects.create(owner=self.user, name='Main', slug='main')
        self.client.force_login(self.user)

    @override_settings(ALLOW_GAMES=False, ALLOW_PHOTOS=True)
    def test_allow_games_false_in_boot(self):
        response = self.client.get(reverse('dashboard'))
        self.assertContains(response, 'allowGames: false')
        self.assertContains(response, 'allowPhotos: true')

    @override_settings(ALLOW_GAMES=True, ALLOW_PHOTOS=False)
    def test_allow_photos_false_in_boot(self):
        response = self.client.get(reverse('dashboard'))
        self.assertContains(response, 'allowGames: true')
        self.assertContains(response, 'allowPhotos: false')

    @override_settings(ALLOW_OFFLINE=False)
    def test_allow_offline_false_in_boot(self):
        response = self.client.get(reverse('dashboard'))
        self.assertContains(response, 'allowOffline: false')

    @override_settings(ALLOW_OFFLINE=True)
    def test_service_worker_served_when_offline_allowed(self):
        response = self.client.get(reverse('service_worker'))
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'notespro-offline', response.content)

    @override_settings(ALLOW_OFFLINE=False)
    def test_service_worker_hidden_when_offline_disabled(self):
        response = self.client.get(reverse('service_worker'))
        self.assertEqual(response.status_code, 404)
