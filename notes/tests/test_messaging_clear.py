import os
from datetime import timedelta

from cryptography.fernet import Fernet
from django.utils import timezone
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

    def test_mail_list_all_includes_inbox_and_sent(self):
        inbox = WorkspaceMailMessage.objects.create(
            workspace=self.workspace,
            sender=self.peer,
            subject='Hello',
            body='Body',
        )
        WorkspaceMailRecipient.objects.create(message=inbox, user=self.owner)
        sent = WorkspaceMailMessage.objects.create(
            workspace=self.workspace,
            sender=self.owner,
            subject='Sent',
            body='Out',
        )
        WorkspaceMailRecipient.objects.create(message=sent, user=self.peer)
        other = User.objects.create_user('other', password='pass')
        stray = WorkspaceMailMessage.objects.create(
            workspace=self.workspace,
            sender=self.peer,
            subject='Other',
            body='Hidden',
        )
        WorkspaceMailRecipient.objects.create(message=stray, user=other)

        response = self.client.get(
            reverse('workspace_mail_list', args=[self.workspace.id]),
            {'box': 'all'},
        )
        self.assertEqual(response.status_code, 200)
        by_subject = {row['subject']: row for row in response.json()['messages']}
        self.assertEqual(set(by_subject), {'Hello', 'Sent'})
        self.assertEqual(by_subject['Hello']['box'], 'inbox')
        self.assertEqual(by_subject['Hello']['sender'], 'kitchen')
        self.assertEqual(by_subject['Hello']['recipients'], ['demo'])
        self.assertEqual(by_subject['Sent']['box'], 'sent')
        self.assertEqual(by_subject['Sent']['recipients'], ['kitchen'])
        self.assertTrue(by_subject['Sent']['read'])

        inbox_only = self.client.get(
            reverse('workspace_mail_list', args=[self.workspace.id]),
        )
        self.assertEqual(
            {row['subject'] for row in inbox_only.json()['messages']},
            {'Hello'},
        )

    def test_chat_list_all_raises_the_window(self):
        base = timezone.now()
        created = []
        for index in range(81):
            message = WorkspaceChatMessage.objects.create(
                workspace=self.workspace,
                sender=self.owner,
                body=f'm{index}',
            )
            WorkspaceChatMessage.objects.filter(pk=message.pk).update(
                created_at=base + timedelta(seconds=index),
            )
            created.append(message)

        url = reverse('workspace_chat_list', args=[self.workspace.id])
        recent = self.client.get(url)
        everything = self.client.get(url, {'all': '1'})
        self.assertEqual(recent.status_code, 200)
        self.assertEqual(everything.status_code, 200)
        recent_ids = [row['id'] for row in recent.json()['messages']]
        all_ids = [row['id'] for row in everything.json()['messages']]
        self.assertEqual(len(recent_ids), 80)
        self.assertEqual(len(all_ids), 81)
        self.assertEqual(all_ids[0], created[0].id)
        self.assertEqual(recent_ids, all_ids[1:])
        self.assertEqual(everything.json()['messages'][0]['body'], 'm0')
