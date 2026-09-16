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
