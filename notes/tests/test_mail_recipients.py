from django.contrib.auth.models import User
from django.test import TestCase

from notes.models import Workspace, WorkspaceMembership
from notes.views_messaging import _resolve_mail_recipients


class MailRecipientTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user('demo', password='pass')
        self.kitchen = User.objects.create_user('kitchen', password='pass')
        self.workspace = Workspace.objects.create(owner=self.owner, name='Main', slug='main')
        WorkspaceMembership.objects.create(workspace=self.workspace, user=self.kitchen, role='write')

    def test_explicit_self_only_keeps_sender(self):
        ids = _resolve_mail_recipients(self.workspace, self.owner, [self.owner.id])
        self.assertEqual(ids, [self.owner.id])

    def test_mixed_list_drops_sender(self):
        ids = _resolve_mail_recipients(self.workspace, self.owner, [self.owner.id, self.kitchen.id])
        self.assertEqual(ids, [self.kitchen.id])
