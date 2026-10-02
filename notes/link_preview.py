"""Fetch a public page and return its preview image (Open Graph / Twitter)."""

from __future__ import annotations

import ipaddress
import re
import socket
from html import unescape
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

from django.core.cache import cache

MAX_HTML_BYTES = 512 * 1024
FETCH_TIMEOUT_SEC = 8
CACHE_TTL_SEC = 600
MISS_TTL_SEC = 60
USER_AGENT = (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
)

_META_RE = re.compile(r'<meta\b([^>]*)/?>', re.IGNORECASE)
_LINK_RE = re.compile(r'<link\b([^>]*)/?>', re.IGNORECASE)
_TITLE_RE = re.compile(r'<title[^>]*>(.*?)</title>', re.IGNORECASE | re.DOTALL)
_ATTR_RE = re.compile(
    r"""([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?""",
)
_WS_RE = re.compile(r'\s+')

_IMAGE_META = (
    ('property', 'og:image'),
    ('property', 'og:image:url'),
    ('property', 'og:image:secure_url'),
    ('name', 'og:image'),
    ('name', 'twitter:image'),
    ('name', 'twitter:image:src'),
    ('itemprop', 'image'),
)


def normalize_page_url(raw: str) -> str:
    url = (raw or '').strip()
    if not url:
        raise ValueError('Link URL is required')
    if len(url) > 2000:
        raise ValueError('Link URL is too long')
    parsed = urlparse(url)
    if parsed.scheme not in ('http', 'https'):
        raise ValueError('Link URL must be http or https')
    if not parsed.hostname:
        raise ValueError('Link URL host is missing')
    if parsed.username or parsed.password:
        raise ValueError('Link URL host is not allowed')
    return url


def _host_is_private(hostname: str) -> bool:
    host = (hostname or '').strip().lower().rstrip('.')
    if not host or host == 'localhost' or host.endswith('.localhost') or host.endswith('.local'):
        return True
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError as exc:
        raise ValueError(f'Cannot resolve link host: {host}') from exc
    for info in infos:
        ip_str = info[4][0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            continue
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            return True
    return False


def _image_host_blocked(hostname: str) -> bool:
    host = (hostname or '').strip().lower().rstrip('.')
    if not host or host == 'localhost' or host.endswith('.localhost') or host.endswith('.local'):
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def assert_public_page_url(url: str) -> None:
    parsed = urlparse(url)
    if _host_is_private(parsed.hostname or ''):
        raise ValueError('Link URL host is not allowed')


def _attrs(blob: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for match in _ATTR_RE.finditer(blob or ''):
        key = match.group(1).lower()
        if key in {'meta', 'link'} or key.startswith('/'):
            continue
        val = next((group for group in match.groups()[1:] if group is not None), '')
        out[key] = unescape(val).strip()
    return out


def _clean_title(value: str) -> str:
    text = _WS_RE.sub(' ', unescape(value or '')).strip()
    return text[:180]


def _absolute_image(raw: str, page_url: str) -> str:
    val = unescape(raw or '').strip()
    if not val or val.lower().startswith('data:'):
        return ''
    absolute = urljoin(page_url, val)
    parsed = urlparse(absolute)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname:
        return ''
    if _image_host_blocked(parsed.hostname):
        return ''
    if len(absolute) > 2000:
        return ''
    return absolute


def extract_link_preview(html: str, page_url: str) -> dict:
    """Pull title and preview image from HTML. Image may be empty."""
    source = html or ''
    metas = [_attrs(match.group(1)) for match in _META_RE.finditer(source)]
    image = ''
    for attr, name in _IMAGE_META:
        if image:
            break
        for meta in metas:
            if meta.get(attr, '').lower() != name:
                continue
            image = _absolute_image(meta.get('content', ''), page_url)
            if image:
                break
    icon = False
    if not image:
        for match in _LINK_RE.finditer(source):
            attrs = _attrs(match.group(1))
            rel = attrs.get('rel', '').lower().split()
            if 'image_src' not in rel:
                continue
            image = _absolute_image(attrs.get('href', ''), page_url)
            if image:
                break
    if not image:
        image = _favicon_from_html(source, page_url)
        icon = bool(image)
    title = ''
    for meta in metas:
        if meta.get('property', '').lower() == 'og:title' and meta.get('content'):
            title = _clean_title(meta['content'])
            break
    if not title:
        found = _TITLE_RE.search(source)
        if found:
            title = _clean_title(found.group(1))
    return {'url': page_url, 'title': title, 'image': image, 'icon': icon}


def _favicon_size(sizes: str) -> int:
    token = (sizes or '').lower().split()[0] if sizes else ''
    if not token or token == 'any':
        return 0
    head = token.split('x', 1)[0]
    try:
        return int(head)
    except ValueError:
        return 0


def _favicon_from_html(html: str, page_url: str) -> str:
    """Site icon when the page has no preview image. Falls back to /favicon.ico."""
    best = ''
    best_score = (-1, -1)
    for match in _LINK_RE.finditer(html or ''):
        attrs = _attrs(match.group(1))
        rel = set(attrs.get('rel', '').lower().split())
        if 'mask-icon' in rel and 'icon' not in rel:
            continue
        if any(token.startswith('apple-touch-icon') for token in rel):
            rank = 3
        elif 'icon' in rel:
            rank = 2
        else:
            continue
        href = _absolute_image(attrs.get('href', ''), page_url)
        if not href:
            continue
        score = (rank, _favicon_size(attrs.get('sizes', '')))
        if score > best_score:
            best, best_score = href, score
    if best:
        return best
    parsed = urlparse(page_url)
    if parsed.scheme not in ('http', 'https') or not parsed.netloc:
        return ''
    return _absolute_image(f'{parsed.scheme}://{parsed.netloc}/favicon.ico', page_url)


def _read_html_head(resp) -> bytes:
    chunks = []
    total = 0
    while total < MAX_HTML_BYTES:
        chunk = resp.read(min(65536, MAX_HTML_BYTES - total))
        if not chunk:
            break
        chunks.append(chunk)
        total += len(chunk)
        lowered = b''.join(chunks).lower()
        if b'</head>' in lowered or b'</html>' in lowered:
            break
    return b''.join(chunks)


def _fetch_preview(url: str) -> dict:
    assert_public_page_url(url)
    req = Request(url, headers={
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,image/*;q=0.8,*/*;q=0.5',
    })
    try:
        with urlopen(req, timeout=FETCH_TIMEOUT_SEC) as resp:
            final_url = resp.geturl()
            assert_public_page_url(final_url)
            ctype = (resp.headers.get('Content-Type') or '').split(';', 1)[0].strip().lower()
            if ctype.startswith('image/'):
                return {'url': final_url, 'title': '', 'image': final_url}
            raw = _read_html_head(resp)
    except HTTPError as exc:
        raise ValueError(f'Link HTTP error: {exc.code}') from exc
    except URLError as exc:
        raise ValueError(f'Link fetch failed: {exc.reason}') from exc
    html = raw.decode('utf-8', errors='replace')
    return extract_link_preview(html, final_url)


def preview_for_url(url: str) -> dict:
    normalized = normalize_page_url(url)
    key = f'link-preview:{normalized}'
    cached = cache.get(key)
    if isinstance(cached, dict):
        return cached
    data = _fetch_preview(normalized)
    cache.set(key, data, CACHE_TTL_SEC if data.get('image') else MISS_TTL_SEC)
    return data
