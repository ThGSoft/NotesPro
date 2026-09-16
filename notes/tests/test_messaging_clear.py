import os

from cryptography.fernet import Fernet
from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse

from notes import db_crypto
from notes.models import (
    DirectConversation,
    DirectMessage,
    Workspace,
    WorkspaceChatMessage,
    WorkspaceMailMessage,
    WorkspaceMailRecipient,
    WorkspaceMembership,
)


class MessagingClearTests(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        os.environ['DB_ENCRYPTION_KEY'] = Fernet.generate_key().decode()
        db_crypto._fernet = None

    def setUp(self):
        self.owner = User.objects.create_user('demo', password='pass')
        self.peer = User.objects.create_user('kitchen', password='pass')
        self.workspace = Workspace.objects.create(owner=self.owner, name='Main', slug='main')
        WorkspaceMembership.objects.create(workspace=self.workspace, user=self.peer, role='write')
        self.client.force_login(self.owner)

    def test_mail_clear_inbox_keeps_sent(self):
        message = WorkspaceMailMessage.objects.create(
            workspace=self.workspace,
            sender=self.peer,
            subject='Hello',
            body='Body',
        )
        WorkspaceMailRecipient.objects.create(message=message, user=self.owner)
        sent = WorkspaceMailMessage.objects.create(
            workspace=self.workspace,
            sender=self.owner,
            subject='Sent',
            body='Out',
        )
        WorkspaceMailRecipient.objects.create(message=sent, user=self.peer)

        response = self.client.post(
            reverse('workspace_mail_clear', args=[self.workspace.id]),
            data='{"box":"inbox"}',
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(WorkspaceMailRecipient.objects.filter(user=self.owner).exists())
        self.assertTrue(WorkspaceMailMessage.objects.filter(pk=sent.pk).exists())

    def test_mail_clear_sent(self):
        sent = WorkspaceMailMessage.objects.create(
            workspace=self.workspace,
            sender=self.owner,
            subject='Sent',
            body='Out',
        )
        WorkspaceMailRecipient.objects.create(message=sent, user=self.peer)
        response = self.client.post(
            reverse('workspace_mail_clear', args=[self.workspace.id]),
            data='{"box":"sent"}',
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(WorkspaceMailMessage.objects.filter(pk=sent.pk).exists())

    def test_chat_clear(self):
        WorkspaceChatMessage.objects.create(
            workspace=self.workspace, sender=self.owner, body='hi',
        )
        response = self.client.post(reverse('workspace_chat_clear', args=[self.workspace.id]))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(WorkspaceChatMessage.objects.filter(workspace=self.workspace).count(), 0)

    def test_dm_clear_thread_and_all(self):
        a, b = DirectConversation.ordered_pair(self.owner, self.peer)
        conv = DirectConversation.objects.create(participant_a=a, participant_b=b)
        DirectMessage.objects.create(conversation=conv, sender=self.owner, iv='aaaa', ciphertext='bbbb')
        response = self.client.post(reverse('dm_message_clear', args=[conv.id]))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(conv.messages.count(), 0)

        DirectMessage.objects.create(conversation=conv, sender=self.peer, iv='cccc', ciphertext='dddd')
        response = self.client.post(reverse('dm_conversations_clear'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(DirectMessage.objects.filter(conversation=conv).count(), 0)
