from django.contrib.auth.models import Group, User
from django.test import Client, TestCase
from django.urls import reverse

from notes.models import Workspace


class GroupAdminWorkspaceTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser('admin', 'admin@example.com', 'pass')
        self.client = Client()
        self.client.force_login(self.admin)
        self.group = Group.objects.create(name='Team')
        owner = User.objects.create_user('owner', password='pass')
        self.ws = Workspace.objects.create(owner=owner, name='Main', slug='main')

    def test_group_admin_saves_workspaces(self):
        url = reverse('admin:auth_group_change', args=[self.group.pk])
        response = self.client.post(url, {
            'name': self.group.name,
            'workspaces': [str(self.ws.pk)],
            '_save': 'Save',
        })
        self.assertEqual(response.status_code, 302, response.content[:500])
        self.assertEqual(
            list(self.group.workspaces.order_by('id').values_list('id', flat=True)),
            [self.ws.id],
        )
