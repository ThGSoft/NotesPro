import datetime
import json
import os

from asgiref.sync import async_to_sync
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from cryptography.fernet import Fernet
from django.contrib.auth.models import AnonymousUser, User
from django.test import TestCase, override_settings
from django.urls import reverse

from notes import db_crypto
from notes.models import Page, UserSettings, Workspace, WorkspaceMailMessage, WorkspaceMembership
from notes.routing import websocket_urlpatterns
from notes.tags import sync_page_tags


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
        self.assertEqual(response.json()['settings']['public'], False)
        self.assertEqual(response.json()['public_url'], '')

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

    def test_page_settings_modal_includes_tags(self):
        response = self.client.get(reverse('dashboard'))
        self.assertEqual(response.status_code, 200)
        content = response.content.decode()
        self.assertIn('id="page-settings-tags"', content)
        self.assertIn('id="page-settings-tags-visible"', content)
        self.assertIn('id="page-settings-tag-input"', content)
        self.assertIn('id="page-settings-tag-add"', content)
        self.assertIn('id="page-settings-public"', content)
        self.assertIn('Show without login', content)
        self.assertNotIn('id="page-settings-root"', content)
        self.assertNotIn('id="page-settings-ws"', content)

    def test_default_tags_enabled(self):
        response = self.client.get(reverse('api_page_detail', args=[self.page.id]))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['settings']['tags'], True)

    def test_owner_can_hide_tags(self):
        response = self.client.post(
            reverse('api_page_update', args=[self.page.id]),
            data='{"settings":{"tags":false}}',
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['settings']['tags'], False)
        self.page.refresh_from_db()
        self.assertEqual(self.page.normalized_settings()['tags'], False)
        self.assertEqual(self.page.normalized_settings()['contents'], True)

    def test_update_returns_page_tags(self):
        response = self.client.post(
            reverse('api_page_update', args=[self.page.id]),
            data='{"markdown_content":"# Hello\\n{tag: WLAN}\\n"}',
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn('wlan', response.json()['tags'])
        self.assertIn('hello', response.json()['tags'])

    def test_owner_can_publish_page_outside_fence(self):
        self.page.markdown_content = (
            '# Shop\n\n'
            '```shop{title=Office}\n'
            'Lamp | 12 | Desk lamp\n'
            '```\n\n'
            '```noteslist{city=Main}\n'
            '# for sale\n'
            'Bike | 80 | Harbor | City bike\n'
            '```\n'
        )
        self.page.archive = '```shoporder\nsecret-order-42\n```\n'
        self.page.save()
        UserSettings.objects.update_or_create(
            user=self.owner,
            defaults={'extra_configs': {
                'shop': {'description': 'Pay at the counter', 'paypal': 'pay@example.com'},
                'snippets': [{'id': 'private-snippet-secret'}],
            }},
        )
        response = self.client.post(
            reverse('api_page_update', args=[self.page.id]),
            data='{"settings":{"public":true}}',
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload['settings']['public'], True)
        self.assertTrue(payload['public_url'].endswith(f'/p/{self.owner.username}/main/{self.page.slug}/'))
        self.page.refresh_from_db()
        self.assertEqual(self.page.normalized_settings()['public'], True)
        self.assertEqual(self.page.normalized_settings()['contents'], True)

        self.client.logout()
        public = self.client.get(payload['public_url'])
        self.assertEqual(public.status_code, 200)
        body = public.content.decode()
        self.assertIn('Lamp | 12 | Desk lamp', body)
        self.assertIn('Bike | 80 | Harbor | City bike', body)
        self.assertIn('Pay at the counter', body)
        self.assertIn('id="public-login-link"', body)
        self.assertIn('publicView: true', body)
        self.assertNotIn('secret-order-42', body)
        self.assertNotIn('private-snippet-secret', body)

        hidden = self.client.get(reverse('api_page_detail', args=[self.page.id]))
        self.assertNotEqual(hidden.status_code, 200)

    def test_unpublished_page_is_hidden(self):
        self.client.logout()
        url = reverse('public_page', kwargs={
            'owner': self.owner.username,
            'workspace_slug': self.workspace.slug,
            'page_slug': self.page.slug,
        })
        response = self.client.get(url)
        self.assertEqual(response.status_code, 404)

    def test_reader_cannot_publish_page(self):
        self.client.force_login(self.reader)
        response = self.client.post(
            reverse('api_page_update', args=[self.page.id]),
            data='{"settings":{"public":true}}',
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 403)
        self.page.refresh_from_db()
        self.assertEqual(self.page.normalized_settings()['public'], False)

    def _publish(self):
        self.page.settings = {'public': True, 'contents': True, 'tags': True}
        self.page.save(update_fields=['settings'])

    def test_public_shop_checkout_without_settings(self):
        self._publish()
        self.client.logout()
        url = reverse('public_shop_order', kwargs={
            'owner': self.owner.username,
            'workspace_slug': self.workspace.slug,
            'page_slug': self.page.slug,
        })
        response = self.client.post(
            url,
            data=json.dumps({
                'payment': 'visa',
                'email': 'Buyer@Example.com',
                'buyer_konto': 'DE89 3704 0044 0532 0130 00',
                'title': 'Office',
                'total': '12.00',
                'lines': [{'name': 'Lamp', 'qty': 1, 'price': '12.00'}],
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['payment'], 'visa')
        mail = WorkspaceMailMessage.objects.get(workspace=self.workspace)
        self.assertEqual(mail.sender_id, self.owner.id)
        self.assertIn('Visa', mail.body)
        self.assertIn('Buyer: buyer@example.com', mail.body)
        self.assertIn('Lamp', mail.body)
        self.assertIn('DE89 3704 0044 0532 0130 00', mail.body)
        self.assertTrue(mail.recipients.filter(user=self.owner).exists())

    def test_public_shop_checkout_rejects_card_number(self):
        self._publish()
        self.client.logout()
        url = reverse('public_shop_order', kwargs={
            'owner': self.owner.username,
            'workspace_slug': self.workspace.slug,
            'page_slug': self.page.slug,
        })
        response = self.client.post(
            url,
            data=json.dumps({
                'payment': 'mastercard',
                'buyer_konto': '4111111111111111',
                'lines': [{'name': 'Lamp', 'qty': 1, 'price': '12'}],
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(WorkspaceMailMessage.objects.count(), 0)

    def test_public_shop_checkout_requires_email(self):
        self._publish()
        self.client.logout()
        url = reverse('public_shop_order', kwargs={
            'owner': self.owner.username,
            'workspace_slug': self.workspace.slug,
            'page_slug': self.page.slug,
        })
        response = self.client.post(
            url,
            data=json.dumps({
                'payment': 'paypal',
                'lines': [{'name': 'Lamp', 'qty': 1, 'price': '12'}],
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('email', response.json()['message'].lower())
        self.assertEqual(WorkspaceMailMessage.objects.count(), 0)

    def test_public_vote_uses_email_without_login(self):
        self.page.markdown_content = (
            '```radio\n'
            '- Ignore\n'
            '```\n\n'
            '```vote{title=Lunch}\n'
            '- Pizza\n'
            '- Salad | guest@old.test\n'
            '```\n'
        )
        self.page.save()
        self._publish()
        self.client.logout()
        url = reverse('public_vote', kwargs={
            'owner': self.owner.username,
            'workspace_slug': self.workspace.slug,
            'page_slug': self.page.slug,
        })
        response = self.client.post(
            url,
            data=json.dumps({
                'email': 'Guest@Example.com',
                'form_index': 1,
                'option_index': 0,
                'select': True,
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['email'], 'guest@example.com')
        self.assertEqual(response.json()['options'][0]['votes'], ['guest@example.com'])
        self.page.refresh_from_db()
        self.assertIn('- Pizza | guest@example.com', self.page.markdown_content)
        self.assertIn('- Salad | guest@old.test', self.page.markdown_content)
        self.assertIn('- Ignore', self.page.markdown_content)

        moved = self.client.post(
            url,
            data=json.dumps({
                'email': 'guest@example.com',
                'form_index': 1,
                'option_index': 1,
                'select': True,
            }),
            content_type='application/json',
        )
        self.assertEqual(moved.status_code, 200)
        self.page.refresh_from_db()
        self.assertIn('- Pizza\n', self.page.markdown_content)
        self.assertNotIn('Pizza | guest@example.com', self.page.markdown_content)
        self.assertIn('- Salad | guest@old.test, guest@example.com', self.page.markdown_content)

        cleared = self.client.post(
            url,
            data=json.dumps({
                'email': 'guest@example.com',
                'form_index': 1,
                'option_index': 1,
                'select': False,
            }),
            content_type='application/json',
        )
        self.assertEqual(cleared.status_code, 200)
        self.page.refresh_from_db()
        self.assertIn('- Salad | guest@old.test', self.page.markdown_content)
        self.assertNotIn('guest@example.com', self.page.markdown_content)

        missing = self.client.post(
            url,
            data=json.dumps({'email': 'not-an-email', 'form_index': 1, 'option_index': 0}),
            content_type='application/json',
        )
        self.assertEqual(missing.status_code, 400)

    def test_public_noteslist_reply_and_add_use_email(self):
        self.page.markdown_content = (
            '```noteslist{city=Main}\n'
            '# for sale\n'
            'Bike | 80 | Harbor | City bike\n'
            '```\n'
        )
        self.page.save()
        self._publish()
        self.client.logout()
        url = reverse('public_noteslist', kwargs={
            'owner': self.owner.username,
            'workspace_slug': self.workspace.slug,
            'page_slug': self.page.slug,
        })
        missing = self.client.post(
            url,
            data=json.dumps({'action': 'reply', 'title': 'Bike', 'text': 'Is it still here?'}),
            content_type='application/json',
        )
        self.assertEqual(missing.status_code, 400)
        self.assertEqual(WorkspaceMailMessage.objects.count(), 0)

        reply = self.client.post(
            url,
            data=json.dumps({
                'action': 'reply',
                'email': 'Guest@Example.com',
                'title': 'Bike',
                'text': 'Is it still here?',
                'to': ['all'],
            }),
            content_type='application/json',
        )
        self.assertEqual(reply.status_code, 200)
        mail = WorkspaceMailMessage.objects.get(workspace=self.workspace)
        self.assertIn('From: guest@example.com', mail.body)
        self.assertIn('Bike', mail.body)
        self.assertIn('Is it still here?', mail.body)
        self.assertTrue(mail.recipients.filter(user=self.owner).exists())

        until = (datetime.date.today() + datetime.timedelta(days=7)).isoformat()
        added = self.client.post(
            url,
            data=json.dumps({
                'action': 'add',
                'email': 'guest@example.com',
                'list_index': 0,
                'category': 'for sale',
                'title': 'Lamp',
                'price': '12',
                'location': 'Desk',
                'description': 'Bright',
                'until': until,
                'to': [self.owner.username],
            }),
            content_type='application/json',
        )
        self.assertEqual(added.status_code, 200)
        self.page.refresh_from_db()
        self.assertIn('Bike | 80 | Harbor | City bike', self.page.markdown_content)
        self.assertIn(f'Lamp | 12 | Desk | Bright | until:{until} | from:guest@example.com', self.page.markdown_content)
        self.assertIn(added.json()['markdown_content'], self.page.markdown_content)
        listing_mail = WorkspaceMailMessage.objects.exclude(pk=mail.pk).get()
        self.assertIn('From: guest@example.com', listing_mail.body)
        self.assertIn('Lamp', listing_mail.body)

        stale = self.client.post(
            url,
            data=json.dumps({
                'action': 'add',
                'email': 'guest@example.com',
                'list_index': 0,
                'title': 'Old',
                'until': '2000-01-01',
            }),
            content_type='application/json',
        )
        self.assertEqual(stale.status_code, 400)
        self.page.refresh_from_db()
        self.assertNotIn('Old', self.page.markdown_content)

    def test_unpublished_vote_is_hidden(self):
        self.page.markdown_content = '```vote\n- Yes\n```\n'
        self.page.save()
        self.client.logout()
        url = reverse('public_vote', kwargs={
            'owner': self.owner.username,
            'workspace_slug': self.workspace.slug,
            'page_slug': self.page.slug,
        })
        response = self.client.post(
            url,
            data=json.dumps({
                'email': 'guest@example.com',
                'form_index': 0,
                'option_index': 0,
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 404)

    def test_unpublished_shop_order_is_hidden(self):
        self.client.logout()
        url = reverse('public_shop_order', kwargs={
            'owner': self.owner.username,
            'workspace_slug': self.workspace.slug,
            'page_slug': self.page.slug,
        })
        response = self.client.post(
            url,
            data=json.dumps({
                'payment': 'paypal',
                'lines': [{'name': 'Lamp', 'qty': 1, 'price': '12'}],
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 404)

    def test_owner_cannot_publish_page_at_site_root(self):
        response = self.client.post(
            reverse('api_page_update', args=[self.page.id]),
            data='{"settings":{"public":true,"root":true}}',
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        self.page.refresh_from_db()
        self.assertEqual(self.page.normalized_settings()['root'], False)
        self.assertEqual(self.page.normalized_settings()['public'], True)
        self.assertTrue(response.json()['public_url'].endswith(
            f'/p/{self.owner.username}/main/{self.page.slug}/',
        ))

    def test_superuser_can_publish_page_at_site_root(self):
        self.owner.is_staff = True
        self.owner.is_superuser = True
        self.owner.save()
        other = Page.objects.create(
            workspace=self.workspace,
            title='Other',
            markdown_content='# Other\n',
            settings={'public': True, 'root': True, 'contents': True, 'tags': True},
        )
        response = self.client.get(reverse('dashboard'))
        self.assertIn('id="page-settings-root"', response.content.decode())
        response = self.client.post(
            reverse('api_page_update', args=[self.page.id]),
            data='{"settings":{"root":true}}',
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload['settings']['root'], True)
        self.assertEqual(payload['settings']['public'], True)
        self.assertEqual(payload['public_url'], '/')
        other.refresh_from_db()
        self.assertEqual(other.normalized_settings()['root'], False)
        self.assertEqual(other.normalized_settings()['public'], True)

        self.client.logout()
        home = self.client.get('/')
        self.assertEqual(home.status_code, 200)
        body = home.content.decode()
        self.assertIn('# Hello', body)
        self.assertIn('publicView: true', body)
        self.assertIn('id="public-login-link"', body)

        self.client.force_login(self.owner)
        app = self.client.get('/')
        self.assertEqual(app.status_code, 200)
        self.assertIn('publicView: false', app.content.decode())

        still = self.client.get(reverse('public_page', kwargs={
            'owner': self.owner.username,
            'workspace_slug': self.workspace.slug,
            'page_slug': self.page.slug,
        }))
        self.assertEqual(still.status_code, 200)

    def test_site_root_login_opens_the_page_for_editing(self):
        self.owner.is_staff = True
        self.owner.is_superuser = True
        self.owner.save()
        other = Page.objects.create(
            workspace=self.workspace,
            title='Other',
            markdown_content='# Other\n',
        )
        self.client.post(
            reverse('api_page_update', args=[self.page.id]),
            data='{"settings":{"root":true}}',
            content_type='application/json',
        )
        prefs, _ = UserSettings.objects.get_or_create(user=self.owner)
        prefs.last_workspace_id = self.workspace.id
        prefs.last_page_id = other.id
        prefs.workspace_pages = {str(self.workspace.id): other.id}
        prefs.save()

        self.client.logout()
        home = self.client.get('/')
        body = home.content.decode()
        self.assertIn('id="public-login-link"', body)
        self.assertIn(
            f'/%3Fws%3D{self.workspace.id}%26page%3D{self.page.id}',
            body,
        )
        self.assertNotIn('id="edit-toggle"', body)

        response = self.client.post(reverse('login'), {
            'username': 'owner',
            'password': 'pass',
            'next': f'/?ws={self.workspace.id}&page={self.page.id}',
        })
        self.assertEqual(response.status_code, 302)
        self.assertIn(f'ws={self.workspace.id}', response.url)
        self.assertIn(f'page={self.page.id}', response.url)

        app = self.client.get(response.url, follow=True)
        self.assertEqual(app.status_code, 200)
        html = app.content.decode()
        self.assertIn('publicView: false', html)
        self.assertIn(f'pageId: {self.page.id}', html)
        self.assertIn('canWrite: true', html)
        self.assertIn('openEditing: true', html)
        self.assertIn('id="edit-toggle"', html)
        prefs.refresh_from_db()
        self.assertEqual(prefs.last_page_id, self.page.id)

    def test_site_root_login_stays_put_without_write_access(self):
        self.owner.is_staff = True
        self.owner.is_superuser = True
        self.owner.save()
        other = Page.objects.create(
            workspace=self.workspace,
            title='Other',
            markdown_content='# Other\n',
        )
        self.client.post(
            reverse('api_page_update', args=[self.page.id]),
            data='{"settings":{"root":true}}',
            content_type='application/json',
        )
        prefs, _ = UserSettings.objects.get_or_create(user=self.reader)
        prefs.last_workspace_id = self.workspace.id
        prefs.last_page_id = other.id
        prefs.workspace_pages = {str(self.workspace.id): other.id}
        prefs.save()

        self.client.logout()
        response = self.client.post(reverse('login'), {
            'username': 'reader',
            'password': 'pass',
            'next': f'/?ws={self.workspace.id}&page={self.page.id}',
        }, follow=True)
        self.assertEqual(response.status_code, 200)
        html = response.content.decode()
        self.assertIn('publicView: false', html)
        self.assertIn(f'pageId: {other.id}', html)
        self.assertIn('openEditing: false', html)
        prefs.refresh_from_db()
        self.assertEqual(prefs.last_page_id, other.id)

    def test_anonymous_root_without_a_published_page_goes_to_login(self):
        self.client.logout()
        response = self.client.get('/')
        self.assertEqual(response.status_code, 302)
        self.assertIn('/login/', response.url)

    def test_owner_cannot_enable_root_websocket(self):
        response = self.client.post(
            reverse('api_page_update', args=[self.page.id]),
            data='{"settings":{"ws":true}}',
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['settings']['ws'], False)
        self.assertEqual(response.json()['settings']['root'], False)

    def _publish_root_ws(self):
        self.owner.is_staff = True
        self.owner.is_superuser = True
        self.owner.save()
        self.page.markdown_content = '# Shown\n'
        self.page.save()
        sync_page_tags(self.page)
        hidden = Page.objects.create(
            workspace=self.workspace,
            title='Secret',
            markdown_content='# Hidden\n',
        )
        sync_page_tags(hidden)
        response = self.client.get(reverse('dashboard'))
        self.assertIn('id="page-settings-ws"', response.content.decode())
        response = self.client.post(
            reverse('api_page_update', args=[self.page.id]),
            data='{"settings":{"ws":true}}',
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        settings = response.json()['settings']
        self.assertEqual(settings['ws'], True)
        self.assertEqual(settings['root'], True)
        self.assertEqual(settings['public'], True)
        self.assertEqual(response.json()['public_url'], '/')
        return hidden

    @override_settings(ENABLE_TAG_WEBSOCKET=True)
    def test_superuser_root_websocket_serves_public_tags_without_login(self):
        self._publish_root_ws()
        self.client.logout()
        home = self.client.get('/')
        self.assertEqual(home.status_code, 200)
        self.assertIn('tagWebSocketEnabled: true', home.content.decode())

        tags = self.client.get(reverse('api_workspace_tags', args=[self.workspace.id]))
        self.assertEqual(tags.status_code, 200)
        names = tags.json()['tags']
        self.assertIn('shown', names)
        self.assertNotIn('hidden', names)

        found = self.client.get(
            reverse('api_workspace_tags_search', args=[self.workspace.id]),
            {'tag': 'shown'},
        )
        self.assertEqual(found.status_code, 200)
        self.assertEqual([page['title'] for page in found.json()['pages']], ['Notes'])

        hidden_hits = self.client.get(
            reverse('api_workspace_tags_search', args=[self.workspace.id]),
            {'tag': 'hidden'},
        )
        self.assertEqual(hidden_hits.json()['pages'], [])

        rebuild = self.client.post(reverse('api_workspace_tags_rebuild', args=[self.workspace.id]))
        self.assertIn(rebuild.status_code, (302, 401, 403))

    @override_settings(ENABLE_TAG_WEBSOCKET=False)
    def test_root_websocket_stays_off_when_the_server_disables_it(self):
        self._publish_root_ws()
        self.client.logout()
        home = self.client.get('/')
        self.assertIn('tagWebSocketEnabled: false', home.content.decode())

    def test_anonymous_tag_api_requires_root_websocket(self):
        self.client.logout()
        response = self.client.get(reverse('api_workspace_tags', args=[self.workspace.id]))
        self.assertEqual(response.status_code, 302)
        self.assertIn('/login/', response.url)

    @override_settings(ENABLE_TAG_WEBSOCKET=True)
    def test_anonymous_websocket_connects_only_when_root_ws_is_enabled(self):
        async def connect():
            communicator = WebsocketCommunicator(
                URLRouter(websocket_urlpatterns),
                f'/ws/workspaces/{self.workspace.id}/tags/',
            )
            communicator.scope['user'] = AnonymousUser()
            connected, _ = await communicator.connect()
            await communicator.disconnect()
            return connected

        self.assertFalse(async_to_sync(connect)())
        self._publish_root_ws()
        self.assertTrue(async_to_sync(connect)())
