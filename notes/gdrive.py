"""Google Drive helpers for the jukebox: parse share links, list folders, stream audio."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from html import unescape
from http.cookiejar import CookieJar
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import HTTPCookieProcessor, Request, build_opener

from django.conf import settings

USER_AGENT = (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
)
FETCH_TIMEOUT_SEC = 30
LIST_MAX_BYTES = 4 * 1024 * 1024
MAX_FOLDER_DEPTH = 8
MAX_TRACKS = 2000
CHUNK_SIZE = 65536

DRIVE_ID_RE = re.compile(r'^[A-Za-z0-9_-]{16,128}$')
FILE_PATH_RE = re.compile(r'/file/d/([A-Za-z0-9_-]+)', re.IGNORECASE)
FOLDER_PATH_RE = re.compile(r'/drive/(?:u/\d+/)?folders/([A-Za-z0-9_-]+)', re.IGNORECASE)
EMBEDDED_ID_RE = re.compile(r'embeddedfolderview', re.IGNORECASE)
CONFIRM_RE = re.compile(r'confirm=([0-9A-Za-z_-]+)')
A_TAG_RE = re.compile(r'<a\b[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', re.IGNORECASE | re.DOTALL)
TITLE_RE = re.compile(r'<title>([^<]+)</title>', re.IGNORECASE)
FILE_HREF_RE = re.compile(r'https://drive\.google\.com/file/d/([A-Za-z0-9_-]+)/', re.IGNORECASE)
FOLDER_HREF_RE = re.compile(
    r'https://drive\.google\.com/drive/(?:u/\d+/)?folders/([A-Za-z0-9_-]+)',
    re.IGNORECASE,
)
HTML_TAG_RE = re.compile(r'<[^>]+>')
IMG_TYPE_RE = re.compile(r'type/([a-z0-9.+-]+/[a-z0-9.+-]+)', re.IGNORECASE)
DOWNLOAD_HREF_RE = re.compile(r'href=["\'](/uc\?export=download[^"\']+)["\']', re.IGNORECASE)
DOWNLOAD_URL_JSON_RE = re.compile(r'"downloadUrl"\s*:\s*"([^"]+)"')
FORM_ACTION_RE = re.compile(
    r'<form[^>]*id=["\']download-form["\'][^>]*action=["\']([^"\']+)["\']',
    re.IGNORECASE,
)

AUDIO_EXTS = {'.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.oga', '.opus'}
AUDIO_MIMES = {
    'audio/mpeg',
    'audio/mp3',
    'audio/mp4',
    'audio/aac',
    'audio/wav',
    'audio/x-wav',
    'audio/flac',
    'audio/ogg',
    'audio/opus',
    'audio/webm',
}
FOLDER_MIME = 'application/vnd.google-apps.folder'
DRIVE_HOST_SUFFIXES = (
    '.google.com',
    '.googleapis.com',
    '.googleusercontent.com',
)
DRIVE_HOSTS = {
    'drive.google.com',
    'docs.google.com',
    'www.googleapis.com',
    'googleapis.com',
    'lh3.googleusercontent.com',
    'drive.usercontent.google.com',
    'drive-thirdparty.googleusercontent.com',
}


def canonical_file_url(file_id: str) -> str:
    return f'https://drive.google.com/file/d/{file_id}/view'


def canonical_folder_url(folder_id: str) -> str:
    return f'https://drive.google.com/drive/folders/{folder_id}'


def title_from_filename(name: str) -> str:
    base = str(name or '').replace('\\', '/').rstrip('/').split('/')[-1]
    lower = base.lower()
    for ext in sorted(AUDIO_EXTS, key=len, reverse=True):
        if lower.endswith(ext):
            base = base[: -len(ext)]
            break
    cleaned = re.sub(r'[_-]+', ' ', base).strip()
    return cleaned or 'Track'


_FOLDER_EDGE_RE = re.compile(r'^[\s_\-–—:/]+|[\s_\-–—:/]+$')


def strip_folder_from_song_name(folder: str, name: str) -> str:
    raw = str(name or '').strip()
    if not raw:
        return ''
    ext = ''
    lower = raw.lower()
    for audio_ext in sorted(AUDIO_EXTS, key=len, reverse=True):
        if lower.endswith(audio_ext):
            ext = raw[len(raw) - len(audio_ext):]
            raw_body = raw[: -len(audio_ext)]
            break
    else:
        raw_body = raw
    text = raw_body
    parts = [part.strip() for part in str(folder or '').split('/') if len(part.strip()) >= 2]
    parts.sort(key=len, reverse=True)
    for part in parts:
        plen = len(part)
        if plen >= len(text):
            continue
        if text[:plen].casefold() == part.casefold():
            rest = text[plen:]
            if rest and rest[0] in ' \t-_–—:/':
                text = rest.lstrip(' \t-_–—:/').strip()
                continue
        if text[-plen:].casefold() == part.casefold():
            rest = text[:-plen]
            if rest and rest[-1] in ' \t-_–—:/':
                text = rest.rstrip(' \t-_–—:/').strip()
    text = _FOLDER_EDGE_RE.sub('', text).strip()
    if not text:
        return raw
    return f'{text}{ext}' if ext else text


def track_title_for_album(album: str, name: str) -> str:
    folder = str(album or '').split(' / ')[-1].strip()
    song = strip_folder_from_song_name(folder, name) or (name or '').strip()
    if folder and folder.casefold() != re.sub(r'\.(mp3|m4a|aac|wav|flac|ogg|oga|opus)$', '', song, flags=re.I).casefold():
        return f'{folder} / {song}'
    return song or name


def is_audio_name(name: str, mime: str = '') -> bool:
    mime_l = (mime or '').lower().split(';')[0].strip()
    if mime_l in AUDIO_MIMES or mime_l.startswith('audio/'):
        return True
    lower = str(name or '').lower()
    return any(lower.endswith(ext) for ext in AUDIO_EXTS)


def parse_drive_ref(raw: str) -> dict:
    """Parse a Drive share URL or bare id. kind is file, folder, or unknown."""
    text = unescape(str(raw or '').strip())
    if not text:
        raise ValueError('Google Drive link is required')
    if DRIVE_ID_RE.match(text) and '://' not in text:
        return {'kind': 'unknown', 'id': text, 'url': canonical_file_url(text)}

    parsed = urlparse(text)
    if parsed.scheme and parsed.scheme not in ('http', 'https'):
        raise ValueError('Google Drive link must be http or https')
    host = (parsed.hostname or '').lower().rstrip('.')
    query = parse_qs(parsed.query)

    folder_m = FOLDER_PATH_RE.search(parsed.path or '')
    if folder_m:
        folder_id = folder_m.group(1)
        return {'kind': 'folder', 'id': folder_id, 'url': canonical_folder_url(folder_id)}

    if EMBEDDED_ID_RE.search(parsed.path or '') or EMBEDDED_ID_RE.search(text):
        folder_id = (query.get('id') or [''])[0]
        if DRIVE_ID_RE.match(folder_id):
            return {'kind': 'folder', 'id': folder_id, 'url': canonical_folder_url(folder_id)}

    file_m = FILE_PATH_RE.search(parsed.path or '')
    if file_m:
        file_id = file_m.group(1)
        return {'kind': 'file', 'id': file_id, 'url': canonical_file_url(file_id)}

    query_id = (query.get('id') or [''])[0]
    if DRIVE_ID_RE.match(query_id):
        kind = 'folder' if 'folder' in (parsed.path or '').lower() else 'file'
        url = canonical_folder_url(query_id) if kind == 'folder' else canonical_file_url(query_id)
        return {'kind': kind, 'id': query_id, 'url': url}

    if host and 'google' in host:
        raise ValueError('Could not find a Google Drive file or folder id in that link')
    raise ValueError('Not a Google Drive link')


def assert_drive_id(file_id: str) -> str:
    value = str(file_id or '').strip()
    if not DRIVE_ID_RE.match(value):
        raise ValueError('Invalid Google Drive id')
    return value


def _host_allowed(hostname: str) -> bool:
    host = (hostname or '').lower().rstrip('.')
    if not host:
        return False
    if host in DRIVE_HOSTS:
        return True
    return any(host.endswith(suffix) for suffix in DRIVE_HOST_SUFFIXES)


def assert_drive_http_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ('http', 'https'):
        raise ValueError('Drive URL must be http or https')
    host = (parsed.hostname or '').lower().rstrip('.')
    if host == 'accounts.google.com' or host.endswith('.accounts.google.com'):
        raise ValueError(
            'Google Drive asked for sign-in. Share the file or folder as “Anyone with the link”.'
        )
    if not _host_allowed(parsed.hostname or ''):
        raise ValueError('URL host is not Google Drive')


def _drive_api_key() -> str:
    return (
        str(getattr(settings, 'GOOGLE_DRIVE_API_KEY', '') or '').strip()
        or str(getattr(settings, 'GOOGLE_API_KEY', '') or '').strip()
    )


def _opener():
    jar = CookieJar()
    return build_opener(HTTPCookieProcessor(jar)), jar


def _request(url: str, headers: dict | None = None, method: str = 'GET') -> Request:
    hdrs = {'User-Agent': USER_AGENT, 'Accept': '*/*'}
    if headers:
        hdrs.update(headers)
    return Request(url, headers=hdrs, method=method)


def _read_limited(resp, limit: int) -> bytes:
    chunks = []
    total = 0
    while True:
        chunk = resp.read(CHUNK_SIZE)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise ValueError('Google Drive response is too large')
        chunks.append(chunk)
    return b''.join(chunks)


def _open(opener, url: str, headers: dict | None = None):
    assert_drive_http_url(url)
    try:
        resp = opener.open(_request(url, headers), timeout=FETCH_TIMEOUT_SEC)
    except HTTPError as exc:
        final = exc.geturl() if hasattr(exc, 'geturl') else url
        if final:
            assert_drive_http_url(final)
        raise
    assert_drive_http_url(resp.geturl())
    return resp


def _link_label(inner_html: str) -> str:
    text = HTML_TAG_RE.sub(' ', inner_html or '')
    return unescape(re.sub(r'\s+', ' ', text)).strip()


def parse_embedded_folder_html(html: str, folder_id: str) -> tuple[str, list[dict]]:
    """Parse Drive embeddedfolderview HTML into (folder_name, files/folders)."""
    text = html or ''
    title_m = TITLE_RE.search(text)
    folder_name = unescape(title_m.group(1)).strip() if title_m else ''
    items: list[dict] = []
    seen = set()

    def add(item_id: str, name: str, is_folder: bool, mime: str = '') -> None:
        if item_id == folder_id or item_id in seen or not DRIVE_ID_RE.match(item_id):
            return
        seen.add(item_id)
        label = unescape(re.sub(r'\s+', ' ', name or '')).strip() or item_id
        items.append({'id': item_id, 'name': label, 'is_folder': is_folder, 'mime': mime})

    for href, inner in A_TAG_RE.findall(text):
        href = unescape(href)
        label = _link_label(inner)
        mime_m = IMG_TYPE_RE.search(inner)
        mime = mime_m.group(1).lower() if mime_m else ''
        file_m = FILE_HREF_RE.search(href)
        if file_m:
            add(file_m.group(1), label, False, mime)
            continue
        folder_m = FOLDER_HREF_RE.search(href)
        if folder_m:
            add(folder_m.group(1), label, True, FOLDER_MIME)

    return folder_name, items


def _folder_name_api(folder_id: str, api_key: str) -> str:
    url = (
        f'https://www.googleapis.com/drive/v3/files/{quote(folder_id)}'
        f'?fields=name,mimeType&supportsAllDrives=true&key={quote(api_key, safe="")}'
    )
    opener, _ = _opener()
    with _open(opener, url) as resp:
        payload = json.loads(_read_limited(resp, LIST_MAX_BYTES).decode('utf-8', 'replace'))
    return str(payload.get('name') or '').strip()


def _list_folder_api(folder_id: str, api_key: str) -> tuple[str, list[dict]]:
    items: list[dict] = []
    page_token = ''
    q = quote(f"'{folder_id}' in parents and trashed = false", safe='')
    while True:
        url = (
            'https://www.googleapis.com/drive/v3/files'
            f'?q={q}&fields=nextPageToken,files(id,name,mimeType)'
            f'&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true'
            f'&key={quote(api_key, safe="")}'
        )
        if page_token:
            url += f'&pageToken={quote(page_token, safe="")}'
        opener, _ = _opener()
        with _open(opener, url) as resp:
            payload = json.loads(_read_limited(resp, LIST_MAX_BYTES).decode('utf-8', 'replace'))
        for file_info in payload.get('files') or []:
            item_id = str(file_info.get('id') or '')
            if not DRIVE_ID_RE.match(item_id):
                continue
            mime = str(file_info.get('mimeType') or '')
            items.append({
                'id': item_id,
                'name': str(file_info.get('name') or item_id),
                'is_folder': mime == FOLDER_MIME,
                'mime': mime,
            })
        page_token = str(payload.get('nextPageToken') or '')
        if not page_token:
            break
    try:
        name = _folder_name_api(folder_id, api_key)
    except (ValueError, HTTPError, URLError, json.JSONDecodeError, OSError, KeyError):
        name = ''
    return name, items


def _list_folder_html(folder_id: str) -> tuple[str, list[dict]]:
    url = f'https://drive.google.com/embeddedfolderview?id={quote(folder_id)}'
    opener, _ = _opener()
    with _open(opener, url) as resp:
        html = _read_limited(resp, LIST_MAX_BYTES).decode('utf-8', 'replace')
    name, items = parse_embedded_folder_html(html, folder_id)
    lowered = html.lower()
    if not items and ('accounts.google.com' in lowered or 'sign in' in (name or '').lower()):
        raise ValueError(
            'Google Drive asked for sign-in. Share the folder as “Anyone with the link”.'
        )
    return name, items


def list_folder(folder_id: str) -> tuple[str, list[dict]]:
    folder_id = assert_drive_id(folder_id)
    api_key = _drive_api_key()
    errors: list[str] = []
    if api_key:
        try:
            return _list_folder_api(folder_id, api_key)
        except (ValueError, HTTPError, URLError, json.JSONDecodeError, OSError) as exc:
            errors.append(str(exc))
    try:
        return _list_folder_html(folder_id)
    except (ValueError, HTTPError, URLError, OSError) as exc:
        errors.append(str(exc))
        raise ValueError(errors[-1] if errors else 'Could not list Google Drive folder') from exc


def list_folder_items(folder_id: str) -> list[dict]:
    _name, items = list_folder(folder_id)
    return items


def collect_folder_tracks(folder_id: str, album: str = '', depth: int = 0) -> list[dict]:
    """Walk a shared folder. Each Drive folder becomes a jukebox album (nested as Parent / Child)."""
    folder_id = assert_drive_id(folder_id)
    try:
        folder_name, items = list_folder(folder_id)
    except (ValueError, HTTPError, URLError, OSError) as exc:
        raise ValueError(f'Could not list Google Drive folder: {exc}') from exc

    current_album = (album or folder_name or 'Drive').strip() or 'Drive'
    tracks: list[dict] = []
    subfolders = []
    for item in items:
        if item.get('is_folder') or item.get('mime') == FOLDER_MIME:
            subfolders.append(item)
            continue
        name = item.get('name') or ''
        mime = item.get('mime') or ''
        if not is_audio_name(name, mime):
            continue
        tracks.append({
            'title': track_title_for_album(current_album, name),
            'src': canonical_file_url(item['id']),
            'album': current_album,
        })
        if len(tracks) >= MAX_TRACKS:
            return tracks

    if depth >= MAX_FOLDER_DEPTH:
        return tracks
    for folder in subfolders:
        child_name = (folder.get('name') or 'Album').strip() or 'Album'
        child_album = child_name if not album else f'{current_album} / {child_name}'
        remaining = MAX_TRACKS - len(tracks)
        if remaining <= 0:
            break
        child_tracks = collect_folder_tracks(folder['id'], child_album, depth + 1)
        tracks.extend(child_tracks[:remaining])
    return tracks


def resolve_drive(raw: str) -> dict:
    ref = parse_drive_ref(raw)
    kind = ref['kind']
    item_id = ref['id']
    if kind in ('unknown', 'folder'):
        try:
            tracks = collect_folder_tracks(item_id, album='')
        except ValueError:
            if kind == 'folder':
                raise
            tracks = []
        if tracks or kind == 'folder':
            name = 'Drive'
            if tracks:
                name = str(tracks[0].get('album') or name).split(' / ')[0] or name
            return {
                'type': 'folder',
                'id': item_id,
                'name': name,
                'url': canonical_folder_url(item_id),
                'tracks': tracks,
            }
        kind = 'file'
    return {
        'type': 'file',
        'id': item_id,
        'name': title_from_filename(item_id),
        'url': canonical_file_url(item_id),
        'tracks': [{
            'title': 'Drive track',
            'src': canonical_file_url(item_id),
            'album': '',
        }],
    }


def _uc_download_url(file_id: str, confirm: str = 't') -> str:
    url = f'https://drive.google.com/uc?export=download&id={quote(file_id)}'
    if confirm:
        url += f'&confirm={quote(confirm)}'
    return url


def _usercontent_url(file_id: str, confirm: str = 't') -> str:
    url = f'https://drive.usercontent.google.com/download?id={quote(file_id)}&export=download'
    if confirm:
        url += f'&confirm={quote(confirm)}'
    return url


def _api_media_url(file_id: str, api_key: str) -> str:
    return (
        f'https://www.googleapis.com/drive/v3/files/{quote(file_id)}'
        f'?alt=media&key={quote(api_key, safe="")}'
    )


def _html_confirm_token(html: str) -> str:
    match = CONFIRM_RE.search(html or '')
    return match.group(1) if match else ''


def _confirm_download_url(html: str, file_id: str) -> str:
    text = html or ''
    href = DOWNLOAD_HREF_RE.search(text)
    if href:
        return 'https://docs.google.com' + unescape(href.group(1)).replace('&amp;', '&')
    form = FORM_ACTION_RE.search(text)
    if form:
        action = unescape(form.group(1)).replace('&amp;', '&')
        if action.startswith('/'):
            action = 'https://drive.usercontent.google.com' + action
        confirm = _html_confirm_token(text)
        if confirm and 'confirm=' not in action:
            joiner = '&' if '?' in action else '?'
            action = f'{action}{joiner}confirm={quote(confirm)}'
        return action
    json_url = DOWNLOAD_URL_JSON_RE.search(text)
    if json_url:
        return json_url.group(1).replace('\\u003d', '=').replace('\\u0026', '&')
    confirm = _html_confirm_token(text)
    if confirm:
        return _usercontent_url(file_id, confirm)
    return ''


@dataclass
class DriveStream:
    body: object
    status: int
    content_type: str
    content_length: str | None = None
    content_range: str | None = None
    accept_ranges: str | None = 'bytes'


def _headers_from_resp(resp) -> dict:
    try:
        return {k.lower(): v for k, v in resp.headers.items()}
    except Exception:
        return {}


def _iter_resp(resp):
    try:
        while True:
            chunk = resp.read(CHUNK_SIZE)
            if not chunk:
                break
            yield chunk
    finally:
        try:
            resp.close()
        except Exception:
            pass


def _stream_from_url(opener, url: str, range_header: str | None, hops: int = 0) -> DriveStream:
    if hops > 4:
        raise ValueError(
            'Google Drive did not return the audio file. Share it as “Anyone with the link”.'
        )
    headers = {}
    if range_header:
        headers['Range'] = range_header
    resp = _open(opener, url, headers)
    meta = _headers_from_resp(resp)
    content_type = (meta.get('content-type') or 'application/octet-stream').split(';')[0].strip()
    status = getattr(resp, 'status', 200) or 200
    if content_type.startswith('text/html'):
        html = _read_limited(resp, LIST_MAX_BYTES).decode('utf-8', 'replace')
        resp.close()
        file_id_m = FILE_PATH_RE.search(url) or re.search(r'[?&]id=([A-Za-z0-9_-]+)', url)
        file_id = file_id_m.group(1) if file_id_m else ''
        next_url = _confirm_download_url(html, file_id)
        if not next_url or next_url == url:
            raise ValueError(
                'Google Drive did not return the audio file. Share it as “Anyone with the link”.'
            )
        return _stream_from_url(opener, next_url, range_header, hops + 1)
    return DriveStream(
        body=_iter_resp(resp),
        status=206 if range_header and status == 206 else status,
        content_type=content_type or 'audio/mpeg',
        content_length=meta.get('content-length'),
        content_range=meta.get('content-range'),
        accept_ranges=meta.get('accept-ranges') or 'bytes',
    )


def stream_drive_file(file_id: str, range_header: str | None = None) -> DriveStream:
    file_id = assert_drive_id(file_id)
    opener, _ = _opener()
    api_key = _drive_api_key()
    errors: list[str] = []
    if api_key:
        try:
            return _stream_from_url(opener, _api_media_url(file_id, api_key), range_header)
        except (ValueError, HTTPError, URLError, OSError) as exc:
            errors.append(str(exc))
    try:
        return _stream_from_url(opener, _usercontent_url(file_id, 't'), range_header)
    except (ValueError, HTTPError, URLError, OSError) as exc:
        errors.append(str(exc))
    try:
        return _stream_from_url(opener, _uc_download_url(file_id, 't'), range_header)
    except (ValueError, HTTPError, URLError, OSError) as exc:
        errors.append(str(exc))
        raise ValueError(errors[-1] if errors else 'Google Drive download failed') from exc
