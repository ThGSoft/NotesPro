import os

from cryptography.fernet import Fernet
from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse

from notes import db_crypto
from notes.models import Page, Workspace, WorkspaceMembership


class PageSettingsTests(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        os.environ['DB_ENCRYPTION_KEY'] = Fernet.generate_key().decode()
        db_crypto._fernet = None

    def setUp(self):
        self.owner = User.objects.create_user('owner', password='pass')
        self.reader = User.objects.create_user('reader', password='pass')
        self.workspace = Workspace.objects.create(owner=self.owner, name='Main', slug='main')
        WorkspaceMembership.objects.create(workspace=self.workspace, user=self.reader, role='read')
        self.page = Page.objects.create(
            workspace=self.workspace,
            title='Notes',
            markdown_content='# Hello\n',
        )
        self.client.force_login(self.owner)

    def test_default_contents_enabled(self):
        response = self.client.get(reverse('api_page_detail', args=[self.page.id]))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['settings']['contents'], True)

    def test_owner_can_disable_contents(self):
        response = self.client.post(
            reverse('api_page_update', args=[self.page.id]),
            data='{"settings":{"contents":false}}',
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['settings']['contents'], False)
        self.page.refresh_from_db()
        self.assertEqual(self.page.normalized_settings()['contents'], False)

    def test_reader_cannot_change_contents(self):
        self.client.force_login(self.reader)
        response = self.client.post(
            reverse('api_page_update', args=[self.page.id]),
            data='{"settings":{"contents":false}}',
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 403)
        self.page.refresh_from_db()
        self.assertEqual(self.page.normalized_settings()['contents'], True)
