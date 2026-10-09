import json
import os

from cryptography.fernet import Fernet
from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse

from notes import db_crypto
from notes.models import Page, UserSettings, Workspace, WorkspaceMailMessage, WorkspaceMembership


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

    def test_anonymous_root_without_a_published_page_goes_to_login(self):
        self.client.logout()
        response = self.client.get('/')
        self.assertEqual(response.status_code, 302)
        self.assertIn('/login/', response.url)
