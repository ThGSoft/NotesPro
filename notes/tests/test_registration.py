from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import Client, TestCase, override_settings
from django.urls import reverse

from notes.activation import hash_activation_code, normalize_mobile
from notes.models import UserSettings, Workspace


class MobileNormalizationTests(TestCase):
    def test_international_number(self):
        self.assertEqual(normalize_mobile('+41 79 123 45 67'), '+41791234567')

    def test_rejects_missing_country_code(self):
        with self.assertRaises(ValueError):
            normalize_mobile('0791234567')


class RegistrationActivationTests(TestCase):
    def setUp(self):
        self.client = Client()

    def test_register_requires_mobile_and_stays_inactive(self):
        response = self.client.post(reverse('register'), {
            'username': 'newuser',
            'email': 'new@example.com',
            'password1': 'NotesPro-pass-9',
            'password2': 'NotesPro-pass-9',
        })
        self.assertEqual(response.status_code, 200)
        self.assertFalse(User.objects.filter(username='newuser').exists())

    @override_settings(TWILIO_ACCOUNT_SID='', TWILIO_AUTH_TOKEN='', TWILIO_FROM='')
    @patch('notes.activation._new_code', return_value='123456')
    def test_register_sends_code_and_activate_logs_in(self, _mock_code):
        response = self.client.post(reverse('register'), {
            'username': 'smsuser',
            'email': 'sms@example.com',
            'mobile': '+41 79 123 45 67',
            'password1': 'NotesPro-pass-9',
            'password2': 'NotesPro-pass-9',
        })
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.url, reverse('activate'))
        user = User.objects.get(username='smsuser')
        self.assertFalse(user.is_active)
        settings_obj = UserSettings.objects.get(user=user)
        self.assertEqual(settings_obj.mobile, '+41791234567')
        self.assertEqual(settings_obj.activation_code_hash, hash_activation_code(user.id, '123456'))

        bad = self.client.post(reverse('activate'), {'code': '000000'})
        self.assertEqual(bad.status_code, 200)
        user.refresh_from_db()
        self.assertFalse(user.is_active)

        ok = self.client.post(reverse('activate'), {'code': '123456'})
        self.assertEqual(ok.status_code, 302)
        user.refresh_from_db()
        self.assertTrue(user.is_active)
        settings_obj.refresh_from_db()
        self.assertTrue(settings_obj.mobile_verified)
        self.assertTrue(Workspace.objects.filter(owner=user).exists())

    @override_settings(REGISTER_MAIL=False, REGISTER_MOBILE=True, TWILIO_ACCOUNT_SID='', TWILIO_AUTH_TOKEN='', TWILIO_FROM='')
    @patch('notes.activation._new_code', return_value='123456')
    def test_register_without_email_when_mail_disabled(self, _mock_code):
        response = self.client.post(reverse('register'), {
            'username': 'nomail',
            'password1': 'NotesPro-pass-9',
            'password2': 'NotesPro-pass-9',
            'mobile': '+41 79 123 45 67',
        })
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.url, reverse('activate'))
        user = User.objects.get(username='nomail')
        self.assertFalse(user.is_active)
        self.assertEqual(user.email, '')

    @override_settings(
        REGISTER_MAIL=True,
        REGISTER_MOBILE=False,
        EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend',
    )
    @patch('notes.activation._new_code', return_value='654321')
    def test_register_email_activation_when_mobile_disabled(self, _mock_code):
        from django.core import mail
        response = self.client.post(reverse('register'), {
            'username': 'mailuser',
            'email': 'mailuser@example.com',
            'password1': 'NotesPro-pass-9',
            'password2': 'NotesPro-pass-9',
        })
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.url, reverse('activate'))
        user = User.objects.get(username='mailuser')
        self.assertFalse(user.is_active)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn('654321', mail.outbox[0].body)
        ok = self.client.post(reverse('activate'), {'code': '654321'})
        self.assertEqual(ok.status_code, 302)
        user.refresh_from_db()
        self.assertTrue(user.is_active)

    @override_settings(REGISTER_MAIL=False, REGISTER_MOBILE=False)
    def test_register_without_mail_or_mobile_activates(self):
        response = self.client.post(reverse('register'), {
            'username': 'plainuser',
            'password1': 'NotesPro-pass-9',
            'password2': 'NotesPro-pass-9',
        })
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.url, reverse('dashboard'))
        user = User.objects.get(username='plainuser')
        self.assertTrue(user.is_active)
        self.assertTrue(Workspace.objects.filter(owner=user).exists())

    def test_duplicate_mobile_rejected(self):
        existing = User.objects.create_user('old', 'old@example.com', 'pass')
        UserSettings.objects.filter(user=existing).update(mobile='+41791112233')
        response = self.client.post(reverse('register'), {
            'username': 'copycat',
            'email': 'copy@example.com',
            'mobile': '+41 79 111 22 33',
            'password1': 'NotesPro-pass-9',
            'password2': 'NotesPro-pass-9',
        })
        self.assertEqual(response.status_code, 200)
        self.assertFalse(User.objects.filter(username='copycat').exists())
