from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import SimpleTestCase, TestCase
from django.urls import reverse

from notes.gdrive import (
    collect_folder_images,
    collect_folder_tracks,
    parse_drive_ref,
    parse_embedded_folder_html,
    resolve_drive,
    title_from_filename,
    track_title_for_album,
    is_audio_name,
    is_image_name,
)


GDOWN_SAMPLE_HTML = """
<html>
<head><title>Musik</title></head>
<body>
<div>
<a href="https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz12345/view?usp=drive_web">
<img src="https://drive-thirdparty.googleusercontent.com/16/type/audio/mpeg" alt="">
Fly Me.mp3
</a>
<a href="https://drive.google.com/file/d/1Sul7bhaimPjncS2GE73nVloSPQbtyzu-/view?usp=drive_web">
<img src="https://drive-thirdparty.googleusercontent.com/16/type/image/jpeg" alt="">
cover.jpg
</a>
<a href="https://drive.google.com/drive/folders/1aMZqPaU03E7XOQNXtjSCdguRHBaIQ82m">
<img src="https://drive-thirdparty.googleusercontent.com/16/type/application/vnd.google-apps.folder" alt="">
Jazz
</a>
</div>
</body>
</html>
"""

SAMPLE_FOLDER_HTML = """
<div class="flip-entry" id="entry-aaaaaaaaaaaaaaaaaaaaaaaaaaa">
  <div class="flip-entry-title">Fly Me To The Moon.mp3</div>
</div>
<div class="flip-entry" id="entry-bbbbbbbbbbbbbbbbbbbbbbbbbbb">
  <div class="flip-entry-title">cover.jpg</div>
</div>
<a href="https://drive.google.com/file/d/ccccccccccccccccccccccccccc/view?usp=drive_web">Take Five.mp3</a>
<a href="https://drive.google.com/drive/folders/ddddddddddddddddddddddddddd">Jazz</a>
"""


class DriveParseTests(SimpleTestCase):
    def test_file_view_url(self):
        ref = parse_drive_ref('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz12345/view?usp=sharing')
        self.assertEqual(ref['kind'], 'file')
        self.assertEqual(ref['id'], '1AbCdEfGhIjKlMnOpQrStUvWxYz12345')

    def test_folder_url(self):
        ref = parse_drive_ref('https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMnOpQrStUvWxYzFolder')
        self.assertEqual(ref['kind'], 'folder')
        self.assertEqual(ref['id'], '1AbCdEfGhIjKlMnOpQrStUvWxYzFolder')

    def test_uc_id_query(self):
        ref = parse_drive_ref('https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOpQrStUvWxYz12345')
        self.assertEqual(ref['kind'], 'file')
        self.assertEqual(ref['id'], '1AbCdEfGhIjKlMnOpQrStUvWxYz12345')

    def test_embedded_folder(self):
        ref = parse_drive_ref('https://drive.google.com/embeddedfolderview?id=1AbCdEfGhIjKlMnOpQrStUvWxYzFolder#list')
        self.assertEqual(ref['kind'], 'folder')

    def test_rejects_non_drive(self):
        with self.assertRaises(ValueError):
            parse_drive_ref('https://example.com/file.mp3')

    def test_title_from_filename(self):
        self.assertEqual(title_from_filename('Fly_Me_To_The_Moon.mp3'), 'Fly Me To The Moon')

    def test_track_title_strips_folder_prefix(self):
        self.assertEqual(track_title_for_album('Jazz', 'Jazz - Take Five.mp3'), 'Jazz / Take Five.mp3')
        self.assertEqual(track_title_for_album('Jazz', 'Take Five.mp3'), 'Jazz / Take Five.mp3')
        self.assertEqual(
            track_title_for_album('Jazz', 'The Jazz Messengers.mp3'),
            'Jazz / The Jazz Messengers.mp3',
        )
        self.assertEqual(track_title_for_album('Jazz / Bebop', 'Bebop_Donna Lee.mp3'), 'Bebop / Donna Lee.mp3')

    def test_is_audio_name(self):
        self.assertTrue(is_audio_name('song.MP3'))
        self.assertFalse(is_audio_name('cover.jpg'))
        self.assertTrue(is_audio_name('clip', 'audio/mpeg'))

    def test_embedded_html_lists_mp3s(self):
        name, items = parse_embedded_folder_html(SAMPLE_FOLDER_HTML, 'folderidfolderidfolderid')
        ids = {item['id'] for item in items}
        self.assertIn('ccccccccccccccccccccccccccc', ids)
        self.assertIn('ddddddddddddddddddddddddddd', ids)
        jazz = next(item for item in items if item['id'] == 'ddddddddddddddddddddddddddd')
        self.assertTrue(jazz['is_folder'])
        self.assertEqual(jazz['name'], 'Jazz')
        take = next(item for item in items if item['id'] == 'ccccccccccccccccccccccccccc')
        self.assertEqual(take['name'], 'Take Five.mp3')
        self.assertFalse(take['is_folder'])

    def test_gdown_html_reads_filename_next_to_img(self):
        name, items = parse_embedded_folder_html(GDOWN_SAMPLE_HTML, 'rootrootrootrootrootrootro')
        self.assertEqual(name, 'Musik')
        by_id = {item['id']: item for item in items}
        self.assertEqual(by_id['1AbCdEfGhIjKlMnOpQrStUvWxYz12345']['name'], 'Fly Me.mp3')
        self.assertEqual(by_id['1AbCdEfGhIjKlMnOpQrStUvWxYz12345']['mime'], 'audio/mpeg')
        self.assertFalse(by_id['1AbCdEfGhIjKlMnOpQrStUvWxYz12345']['is_folder'])
        self.assertTrue(by_id['1aMZqPaU03E7XOQNXtjSCdguRHBaIQ82m']['is_folder'])
        self.assertEqual(by_id['1aMZqPaU03E7XOQNXtjSCdguRHBaIQ82m']['name'], 'Jazz')

    def test_folder_tree_becomes_albums(self):
        root = '1rootrootrootrootrootrootroot'
        jazz = '1jazzjazzjazzjazzjazzjazzjazz'
        bebop = '1bebopbebopbebopbebopbebopbeb'
        intro = '1introintrointrointrointroint'
        five = '1fivefivefivefivefivefivefive'
        donna = '1donnadonnadonnadonnadonnadon'

        def fake_list(folder_id):
            mapping = {
                root: ('Musik', [
                    {'id': intro, 'name': 'Intro.mp3', 'is_folder': False, 'mime': 'audio/mpeg'},
                    {'id': jazz, 'name': 'Jazz', 'is_folder': True, 'mime': 'application/vnd.google-apps.folder'},
                ]),
                jazz: ('Jazz', [
                    {'id': five, 'name': 'Jazz - Take Five.mp3', 'is_folder': False, 'mime': ''},
                    {'id': bebop, 'name': 'Bebop', 'is_folder': True, 'mime': 'application/vnd.google-apps.folder'},
                ]),
                bebop: ('Bebop', [
                    {'id': donna, 'name': 'Donna Lee.mp3', 'is_folder': False, 'mime': ''},
                ]),
            }
            return mapping[folder_id]

        with patch('notes.gdrive.list_folder', side_effect=fake_list):
            tracks = collect_folder_tracks(root, album='')
        albums = {track['album']: track['title'] for track in tracks}
        self.assertEqual(albums['Musik'], 'Musik / Intro.mp3')
        self.assertEqual(albums['Jazz'], 'Jazz / Take Five.mp3')
        self.assertEqual(albums['Jazz / Bebop'], 'Bebop / Donna Lee.mp3')

    def test_folder_images_skip_audio(self):
        root = '1rootrootrootrootrootrootroot'
        photo = '1photophotophotophotophotophot'
        song = '1songsongsongsongsongsongson'
        nested = '1nestednestednestednestednest'
        inner = '1innerinnerinnerinnerinnerinn'
        self.assertTrue(is_image_name('Lake_View.jpg', 'image/jpeg'))
        self.assertFalse(is_image_name('Fly Me.mp3', 'audio/mpeg'))

        def fake_list(folder_id):
            mapping = {
                root: ('Album', [
                    {'id': song, 'name': 'Fly Me.mp3', 'is_folder': False, 'mime': 'audio/mpeg'},
                    {'id': photo, 'name': 'Lake_View.jpg', 'is_folder': False, 'mime': 'image/jpeg'},
                    {'id': nested, 'name': 'More', 'is_folder': True, 'mime': 'application/vnd.google-apps.folder'},
                ]),
                nested: ('More', [
                    {'id': inner, 'name': 'coast.png', 'is_folder': False, 'mime': ''},
                ]),
            }
            return mapping[folder_id]

        folder_url = f'https://drive.google.com/drive/folders/{root}'
        with patch('notes.gdrive.list_folder', side_effect=fake_list):
            photos = collect_folder_images(root)
            images = resolve_drive(folder_url, media='image')
            audio = resolve_drive(folder_url)
        self.assertEqual([item['title'] for item in photos], ['Lake View', 'coast'])
        self.assertEqual(images['photos'][0]['src'], f'https://drive.google.com/file/d/{photo}/view')
        self.assertEqual(images['type'], 'folder')
        self.assertEqual([item['src'] for item in audio['tracks']], [
            f'https://drive.google.com/file/d/{song}/view',
        ])


class DriveApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('owner', password='pass')

    def test_resolve_requires_login(self):
        response = self.client.get(
            reverse('api_drive_resolve'),
            {'url': 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz12345/view'},
            HTTP_ACCEPT='application/json',
        )
        self.assertEqual(response.status_code, 401)

    def test_resolve_requires_url(self):
        self.client.force_login(self.user)
        response = self.client.get(reverse('api_drive_resolve'))
        self.assertEqual(response.status_code, 400)

    def test_resolve_file_mocked(self):
        self.client.force_login(self.user)
        payload = {
            'type': 'file',
            'id': '1AbCdEfGhIjKlMnOpQrStUvWxYz12345',
            'url': 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz12345/view',
            'tracks': [{'title': 'Moon', 'src': 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz12345/view', 'album': ''}],
        }
        with patch('notes.gdrive.resolve_drive', return_value=payload):
            response = self.client.get(
                reverse('api_drive_resolve'),
                {'url': 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz12345/view'},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['type'], 'file')
        self.assertEqual(response.json()['tracks'][0]['title'], 'Moon')

    def test_resolve_kind_image(self):
        self.client.force_login(self.user)
        with patch('notes.gdrive.resolve_drive', return_value={'type': 'folder', 'photos': []}) as mocked:
            response = self.client.get(
                reverse('api_drive_resolve'),
                {
                    'url': 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYzFolder',
                    'kind': 'image',
                },
            )
        self.assertEqual(response.status_code, 200)
        self.assertIn('photos', response.json())
        self.assertEqual(mocked.call_args.kwargs['media'], 'image')
        self.assertTrue(
            reverse('api_drive_media', args=['1AbCdEfGhIjKlMnOpQrStUvWxYz12345']).endswith(
                '/api/drive/media/1AbCdEfGhIjKlMnOpQrStUvWxYz12345/'
            )
        )

    def test_audio_rejects_bad_id(self):
        self.client.force_login(self.user)
        response = self.client.get(reverse('api_drive_audio', args=['not-an-id']))
        self.assertEqual(response.status_code, 400)
