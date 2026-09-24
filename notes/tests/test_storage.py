from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import Client, TestCase, override_settings
from django.urls import reverse

from notes.models import StorageSettings, UploadedFile, UserSettings, Workspace
from notes.media_quota import StorageQuotaExceeded, apply_purge, assert_can_store, plan_unreferenced_media


class StorageControlTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.superuser = User.objects.create_superuser('root', 'root@example.com', 'pass')
        self.staff = User.objects.create_user('staff', 'staff@example.com', 'pass', is_staff=True)
        self.owner = User.objects.create_user('owner', 'owner@example.com', 'pass')
        self.ws = Workspace.objects.create(owner=self.owner, name='Docs', slug='docs')
        self.client = Client()

    def test_storage_settings_singleton_and_quota_inherit(self):
        conf = StorageSettings.load()
        self.assertEqual(conf.pk, 1)
        self.assertEqual(StorageSettings.load().pk, 1)
        conf.workspace_quota_mb = 40
        conf.save()
        self.assertEqual(self.ws.effective_storage_quota_mb(), 40)
        self.ws.storage_quota_mb = 8
        self.ws.save(update_fields=['storage_quota_mb'])
        self.assertEqual(self.ws.effective_storage_quota_mb(), 8)
        self.ws.storage_quota_mb = 0
        self.ws.save(update_fields=['storage_quota_mb'])
        self.assertEqual(self.ws.effective_storage_quota_mb(), 0)

        conf.user_quota_mb = 15
        conf.save()
        settings = UserSettings.objects.get(user=self.owner)
        self.assertEqual(settings.effective_storage_quota_mb(), 15)
        settings.storage_quota_mb = 3
        settings.save(update_fields=['storage_quota_mb'])
        self.assertEqual(settings.effective_storage_quota_mb(), 3)
        settings.storage_quota_mb = 0
        settings.save(update_fields=['storage_quota_mb'])
        self.assertEqual(settings.effective_storage_quota_mb(), 0)

    def test_assert_can_store_enforces_max_upload(self):
        conf = StorageSettings.load()
        conf.max_upload_mb = 1
        conf.save()
        with self.assertRaises(StorageQuotaExceeded) as ctx:
            assert_can_store(self.ws, 1024 * 1024 + 20)
        self.assertEqual(ctx.exception.code, 'max_upload')
        assert_can_store(self.ws, 1024)

    def test_assert_can_store_enforces_workspace_quota(self):
        conf = StorageSettings.load()
        conf.max_upload_mb = 0
        conf.workspace_quota_mb = 1
        conf.save()
        with TemporaryDirectory() as tmpdir:
            media = Path(tmpdir)
            dest = media / 'uploads/2026/09'
            dest.mkdir(parents=True)
            (dest / 'big.bin').write_bytes(b'x' * (900 * 1024))
            uploaded = UploadedFile.objects.create(
                user=self.owner,
                workspace=self.ws,
                md5_hash='aa',
                original_name='big.bin',
            )
            uploaded.file.name = 'uploads/2026/09/big.bin'
            uploaded.save()
            with override_settings(MEDIA_ROOT=tmpdir):
                with self.assertRaises(StorageQuotaExceeded) as ctx:
                    assert_can_store(self.ws, 200 * 1024)
                self.assertEqual(ctx.exception.code, 'workspace_quota')

    def test_assert_can_store_enforces_user_quota(self):
        conf = StorageSettings.load()
        conf.max_upload_mb = 0
        conf.user_quota_mb = 1
        conf.save()
        with TemporaryDirectory() as tmpdir:
            dest = Path(tmpdir) / 'uploads/2026/09'
            dest.mkdir(parents=True)
            (dest / 'big.bin').write_bytes(b'x' * (900 * 1024))
            uploaded = UploadedFile.objects.create(
                user=self.owner,
                workspace=self.ws,
                md5_hash='bb',
                original_name='big.bin',
            )
            uploaded.file.name = 'uploads/2026/09/big.bin'
            uploaded.save()
            with override_settings(MEDIA_ROOT=tmpdir):
                with self.assertRaises(StorageQuotaExceeded) as ctx:
                    assert_can_store(self.ws, 200 * 1024, user=self.owner)
                self.assertEqual(ctx.exception.code, 'user_quota')
                assert_can_store(self.ws, 200 * 1024, user=self.staff)

    def test_superuser_storage_admin_and_staff_denied(self):
        url = reverse('admin:notes_storagesettings_changelist')
        self.client.force_login(self.staff)
        response = self.client.get(url)
        self.assertEqual(response.status_code, 403)

        self.client.force_login(self.superuser)
        response = self.client.get(url)
        self.assertEqual(response.status_code, 302)
        change_url = reverse('admin:notes_storagesettings_change', args=[1])
        self.assertTrue(response.url.endswith(change_url) or change_url in response.url)
        page = self.client.get(change_url)
        self.assertEqual(page.status_code, 200)
        self.assertContains(page, 'Storage control')
        self.assertContains(page, 'Purge unreferenced')
        self.assertContains(page, self.ws.name)
        self.assertContains(page, self.owner.username)
        self.assertContains(page, 'Users')

        saved = self.client.post(change_url, {
            'max_upload_mb': '12',
            'workspace_quota_mb': '100',
            'user_quota_mb': '50',
            'global_quota_mb': '0',
            '_save': 'Save',
        })
        self.assertEqual(saved.status_code, 302, saved.content[:400])
        conf = StorageSettings.load()
        self.assertEqual(conf.max_upload_mb, 12)
        self.assertEqual(conf.workspace_quota_mb, 100)
        self.assertEqual(conf.user_quota_mb, 50)

    def test_upload_rejected_when_over_max_size(self):
        conf = StorageSettings.load()
        conf.max_upload_mb = 1
        conf.save()
        self.client.force_login(self.owner)
        payload = SimpleUploadedFile(
            'too-big.bin',
            b'x' * (1024 * 1024 + 50),
            content_type='application/octet-stream',
        )
        with TemporaryDirectory() as tmpdir:
            with override_settings(MEDIA_ROOT=tmpdir):
                response = self.client.post(reverse('api_upload'), {
                    'workspace': str(self.ws.pk),
                    'file': payload,
                })
        self.assertEqual(response.status_code, 413)
        self.assertFalse(UploadedFile.objects.exists())
        self.assertIn('upload limit', response.json()['error'])

    def test_admin_purge_removes_unreferenced_file(self):
        self.client.force_login(self.superuser)
        with TemporaryDirectory() as tmpdir:
            dest = Path(tmpdir) / 'uploads/2026/09'
            dest.mkdir(parents=True)
            (dest / 'unused.pdf').write_bytes(b'pdf')
            uploaded = UploadedFile.objects.create(
                user=self.owner,
                workspace=self.ws,
                md5_hash='abc',
                original_name='unused.pdf',
            )
            uploaded.file.name = 'uploads/2026/09/unused.pdf'
            uploaded.save()
            change_url = reverse('admin:notes_storagesettings_change', args=[StorageSettings.load().pk])
            with override_settings(MEDIA_ROOT=tmpdir):
                response = self.client.post(change_url, {'_purge': 'Purge unreferenced files'})
                self.assertEqual(response.status_code, 302)
                self.assertFalse(UploadedFile.objects.filter(pk=uploaded.pk).exists())
                self.assertFalse((Path(tmpdir) / 'uploads/2026/09/unused.pdf').exists())

    def test_purge_plan_command_still_dry_runs(self):
        with TemporaryDirectory() as tmpdir:
            dest = Path(tmpdir) / 'uploads/2026/09'
            dest.mkdir(parents=True)
            (dest / 'unused.pdf').write_bytes(b'pdf')
            uploaded = UploadedFile.objects.create(
                user=self.owner,
                workspace=self.ws,
                md5_hash='abc',
                original_name='unused.pdf',
            )
            uploaded.file.name = 'uploads/2026/09/unused.pdf'
            uploaded.save()
            out = StringIO()
            with override_settings(MEDIA_ROOT=tmpdir):
                plan = plan_unreferenced_media()
                self.assertEqual(len(plan['records']), 1)
                call_command('purge_unreferenced_media', '--dry-run', stdout=out)
                self.assertIn('unused.pdf', out.getvalue())
                apply_purge(plan)
            self.assertFalse(UploadedFile.objects.filter(pk=uploaded.pk).exists())
