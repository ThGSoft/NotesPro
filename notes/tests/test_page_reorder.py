from django.contrib.auth.models import User
from django.test import Client, TestCase

from notes.models import Page, Workspace


class PageReorderTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='owner', password='pass')
        self.client = Client()
        self.client.login(username='owner', password='pass')
        self.workspace = Workspace.objects.create(owner=self.user, name='Main', slug='main')
        self.a = Page.objects.create(
            workspace=self.workspace, title='A', sort_order=0, is_folder=False,
        )
        self.b = Page.objects.create(
            workspace=self.workspace, title='B', sort_order=1, is_folder=False,
        )
        self.c = Page.objects.create(
            workspace=self.workspace, title='C', sort_order=2, is_folder=False,
        )

    def test_reorder_moves_middle_item_to_top(self):
        response = self.client.post(
            '/api/pages/reorder/',
            data={
                'id': self.c.id,
                'parent': '#',
                'position': 0,
            },
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)

        order = list(
            Page.objects.filter(workspace=self.workspace, parent=None)
            .order_by('sort_order', 'id')
            .values_list('title', flat=True),
        )
        self.assertEqual(order, ['C', 'A', 'B'])

    def test_tree_endpoint_returns_saved_order(self):
        self.c.sort_order = 0
        self.a.sort_order = 1
        self.b.sort_order = 2
        Page.objects.bulk_update([self.a, self.b, self.c], ['sort_order'])

        response = self.client.get(f'/api/workspaces/{self.workspace.id}/tree/')
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        root_ids = [item['id'] for item in payload if item['parent'] == '#']
        self.assertEqual(root_ids, [str(self.c.id), str(self.a.id), str(self.b.id)])

    def test_drop_onto_page_reorders_in_same_folder(self):
        response = self.client.post(
            '/api/pages/reorder/',
            data={
                'id': self.c.id,
                'parent': self.a.id,
                'position': 0,
            },
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)

        order = list(
            Page.objects.filter(workspace=self.workspace, parent=None)
            .order_by('sort_order', 'id')
            .values_list('title', flat=True),
        )
        self.assertEqual(order, ['C', 'A', 'B'])
