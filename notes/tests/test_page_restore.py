from django.contrib.auth.models import User
from django.test import Client, TestCase
from django.urls import reverse

from notes.models import Page, Workspace, WorkspaceMembership


class PageRestoreTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user('owner', password='pass')
        self.reader = User.objects.create_user('reader', password='pass')
        self.admin = User.objects.create_superuser('admin', 'admin@example.com', 'pass')
        self.client = Client()
        self.client.force_login(self.owner)
        self.workspace = Workspace.objects.create(owner=self.owner, name='Main', slug='main')
        WorkspaceMembership.objects.create(workspace=self.workspace, user=self.reader, role='read')
        self.folder = Page.objects.create(
            workspace=self.workspace, title='Docs', is_folder=True, sort_order=0,
        )
        self.child = Page.objects.create(
            workspace=self.workspace, parent=self.folder, title='Notes', sort_order=0,
        )
        self.sibling = Page.objects.create(
            workspace=self.workspace, title='Keep', sort_order=1,
        )

    def test_delete_and_restore_page(self):
        response = self.client.post(reverse('api_page_delete', args=[self.sibling.id]))
        self.assertEqual(response.status_code, 200)
        self.sibling.refresh_from_db()
        self.assertTrue(self.sibling.deleted)

        missing = self.client.get(reverse('api_page_detail', args=[self.sibling.id]))
        self.assertEqual(missing.status_code, 404)

        restored = self.client.post(reverse('api_page_restore', args=[self.sibling.id]))
        self.assertEqual(restored.status_code, 200)
        self.assertEqual(restored.json()['title'], 'Keep')
        self.sibling.refresh_from_db()
        self.assertFalse(self.sibling.deleted)

    def test_delete_folder_restores_children(self):
        self.client.post(reverse('api_page_delete', args=[self.folder.id]))
        self.folder.refresh_from_db()
        self.child.refresh_from_db()
        self.assertTrue(self.folder.deleted)
        self.assertTrue(self.child.deleted)

        restored = self.client.post(reverse('api_page_restore', args=[self.folder.id]))
        self.assertEqual(restored.status_code, 200)
        self.folder.refresh_from_db()
        self.child.refresh_from_db()
        self.assertFalse(self.folder.deleted)
        self.assertFalse(self.child.deleted)

    def test_reader_cannot_restore(self):
        self.client.post(reverse('api_page_delete', args=[self.sibling.id]))
        self.client.force_login(self.reader)
        response = self.client.post(reverse('api_page_restore', args=[self.sibling.id]))
        self.assertEqual(response.status_code, 403)
        self.sibling.refresh_from_db()
        self.assertTrue(self.sibling.deleted)

    def test_admin_restore_action(self):
        self.client.post(reverse('api_page_delete', args=[self.folder.id]))
        self.client.force_login(self.admin)
        response = self.client.post(reverse('admin:notes_page_changelist'), {
            'action': 'restore_pages_action',
            '_selected_action': [str(self.folder.pk)],
        })
        self.assertEqual(response.status_code, 302)
        self.folder.refresh_from_db()
        self.child.refresh_from_db()
        self.assertFalse(self.folder.deleted)
        self.assertFalse(self.child.deleted)

    def test_admin_delete_is_soft_delete(self):
        self.client.force_login(self.admin)
        response = self.client.post(reverse('admin:notes_page_delete', args=[self.sibling.pk]), {
            'post': 'yes',
        })
        self.assertEqual(response.status_code, 302)
        self.sibling.refresh_from_db()
        self.assertTrue(self.sibling.deleted)
        self.assertTrue(Page.objects.filter(pk=self.sibling.pk).exists())
