"""Fetch and parse RSS / Atom feeds into a MagpieRSS-like structure."""

from __future__ import annotations

import ipaddress
import re
import socket
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from html import unescape
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from django.core.cache import cache

MAX_FEED_BYTES = 2 * 1024 * 1024
FETCH_TIMEOUT_SEC = 12
CACHE_TTL_SEC = 300
USER_AGENT = 'NotesProRSS/1.0 (+https://github.com/ThGSoft/NotesPro)'

_TAG_RE = re.compile(r'<[^>]+>')
_WS_RE = re.compile(r'\s+')
_IMG_SRC_RE = re.compile(
    r'<img[^>]+(?:src|data-src)\s*=\s*["\']([^"\']+)["\']',
    re.IGNORECASE,
)
_IMAGE_EXT_RE = re.compile(r'\.(?:jpe?g|png|gif|webp|avif|bmp|svg)(?:$|[?#])', re.IGNORECASE)
_IMAGE_MIME_PREFIXES = ('image/',)


def _local(tag: str) -> str:
    if not tag:
        return ''
    if '}' in tag:
        return tag.rsplit('}', 1)[-1].lower()
    return tag.lower()


def _text(el: ET.Element | None) -> str:
    if el is None:
        return ''
    parts = [el.text or '']
    for child in el:
        parts.append(_text(child))
        parts.append(child.tail or '')
    return unescape(''.join(parts)).strip()


def _child(el: ET.Element, *names: str) -> ET.Element | None:
    want = {n.lower() for n in names}
    for child in el:
        if _local(child.tag) in want:
            return child
    return None


def _children(el: ET.Element, *names: str) -> list[ET.Element]:
    want = {n.lower() for n in names}
    return [c for c in el if _local(c.tag) in want]


def _attr(el: ET.Element | None, *names: str) -> str:
    if el is None:
        return ''
    lower_map = {k.lower(): v for k, v in el.attrib.items()}
    for name in names:
        val = lower_map.get(name.lower())
        if val:
            return unescape(val).strip()
    return ''


def strip_html(value: str, max_len: int = 280) -> str:
    text = _TAG_RE.sub(' ', unescape(value or ''))
    text = _WS_RE.sub(' ', text).strip()
    if max_len and len(text) > max_len:
        return text[: max_len - 1].rstrip() + '…'
    return text


def normalize_feed_url(raw: str) -> str:
    url = (raw or '').strip()
    if not url:
        raise ValueError('Feed URL is required')
    parsed = urlparse(url)
    if parsed.scheme not in ('http', 'https'):
        raise ValueError('Feed URL must be http or https')
    if not parsed.hostname:
        raise ValueError('Feed URL host is missing')
    return url


def _host_is_private(hostname: str) -> bool:
    host = (hostname or '').strip().lower().rstrip('.')
    if not host or host == 'localhost' or host.endswith('.localhost'):
        return True
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError as exc:
        raise ValueError(f'Cannot resolve feed host: {host}') from exc
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


def assert_public_feed_url(url: str) -> None:
    parsed = urlparse(url)
    if _host_is_private(parsed.hostname or ''):
        raise ValueError('Feed URL host is not allowed')


def fetch_feed_bytes(url: str) -> bytes:
    assert_public_feed_url(url)
    req = Request(url, headers={'User-Agent': USER_AGENT, 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'})
    try:
        with urlopen(req, timeout=FETCH_TIMEOUT_SEC) as resp:
            final_url = resp.geturl()
            assert_public_feed_url(final_url)
            chunks = []
            total = 0
            while True:
                chunk = resp.read(65536)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_FEED_BYTES:
                    raise ValueError('Feed is too large')
                chunks.append(chunk)
            return b''.join(chunks)
    except HTTPError as exc:
        raise ValueError(f'Feed HTTP error: {exc.code}') from exc
    except URLError as exc:
        raise ValueError(f'Feed fetch failed: {exc.reason}') from exc


def _item_link(item: ET.Element) -> str:
    link_el = _child(item, 'link')
    if link_el is not None:
        href = _attr(link_el, 'href') or _text(link_el)
        if href:
            return href
    for child in item:
        if _local(child.tag) == 'guid' and _attr(child, 'isPermaLink').lower() != 'false':
            text = _text(child)
            if text.startswith('http'):
                return text
    return ''


def _item_description(item: ET.Element) -> str:
    for name in ('description', 'summary', 'content', 'encoded'):
        el = _child(item, name)
        if el is not None:
            # content:encoded often has rich HTML
            raw = _text(el) or (el.text or '')
            if raw.strip():
                return strip_html(raw)
    return ''


def _item_raw_html(item: ET.Element) -> str:
    chunks = []
    for name in ('description', 'summary', 'content', 'encoded'):
        el = _child(item, name)
        if el is None:
            continue
        raw = _text(el) or (el.text or '')
        if raw.strip():
            chunks.append(raw)
    return '\n'.join(chunks)


def _is_image_url(url: str, mime: str = '') -> bool:
    u = (url or '').strip()
    if not u or not u.startswith(('http://', 'https://')):
        return False
    m = (mime or '').strip().lower()
    if m.startswith(_IMAGE_MIME_PREFIXES):
        return True
    if m and m not in ('', 'application/octet-stream'):
        return False
    return bool(_IMAGE_EXT_RE.search(u))


def _first_img_from_html(html: str) -> str:
    for match in _IMG_SRC_RE.finditer(html or ''):
        src = unescape(match.group(1) or '').strip()
        if _is_image_url(src):
            return src
    return ''


def _item_image(item: ET.Element) -> str:
    """Pick a Magpie-friendly item image (enclosure / media / HTML img)."""
    # media:thumbnail / media:content (Media RSS)
    for child in item.iter():
        name = _local(child.tag)
        if name == 'thumbnail':
            url = _attr(child, 'url', 'href')
            if url.startswith(('http://', 'https://')):
                return url
        if name == 'content':
            url = _attr(child, 'url', 'href')
            mime = _attr(child, 'type')
            medium = _attr(child, 'medium').lower()
            if medium == 'image' and url.startswith(('http://', 'https://')):
                return url
            if _is_image_url(url, mime):
                return url
        if name == 'group':
            for nested in child:
                nname = _local(nested.tag)
                nurl = _attr(nested, 'url', 'href')
                nmime = _attr(nested, 'type')
                nmedium = _attr(nested, 'medium').lower()
                if nname == 'thumbnail' and nurl.startswith(('http://', 'https://')):
                    return nurl
                if nname == 'content' and (
                    nmedium == 'image' or _is_image_url(nurl, nmime)
                ) and nurl.startswith(('http://', 'https://')):
                    return nurl

    # <enclosure url="..." type="image/...">
    for enc in _children(item, 'enclosure'):
        url = _attr(enc, 'url', 'href')
        mime = _attr(enc, 'type')
        if _is_image_url(url, mime):
            return url

    # Atom <link rel="enclosure" type="image/...">
    for link in _children(item, 'link'):
        rel = (_attr(link, 'rel') or '').lower()
        href = _attr(link, 'href') or _text(link)
        mime = _attr(link, 'type')
        if rel in ('enclosure', 'image', 'icon') and _is_image_url(href, mime or 'image/'):
            return href

    # First <img> in description/content HTML
    return _first_img_from_html(_item_raw_html(item))


def _item_date(item: ET.Element) -> str:
    for name in ('pubdate', 'published', 'updated', 'date'):
        el = _child(item, name)
        if el is None:
            continue
        raw = _text(el)
        if not raw:
            continue
        try:
            dt = parsedate_to_datetime(raw)
            if dt is not None:
                return dt.isoformat()
        except (TypeError, ValueError, IndexError):
            pass
        # Atom dates are often ISO already
        return raw
    return ''


def parse_feed_xml(data: bytes) -> dict:
    try:
        root = ET.fromstring(data)
    except ET.ParseError as exc:
        raise ValueError('Invalid feed XML') from exc

    root_name = _local(root.tag)
    channel = {
        'title': '',
        'link': '',
        'description': '',
    }
    items: list[dict] = []

    if root_name == 'feed':
        # Atom
        channel['title'] = _text(_child(root, 'title'))
        channel['description'] = strip_html(_text(_child(root, 'subtitle')) or _text(_child(root, 'summary')))
        for link in _children(root, 'link'):
            rel = (_attr(link, 'rel') or 'alternate').lower()
            href = _attr(link, 'href') or _text(link)
            if href and rel in ('alternate', ''):
                channel['link'] = href
                break
        if not channel['link']:
            channel['link'] = _attr(_child(root, 'link'), 'href') or _text(_child(root, 'link'))
        for entry in _children(root, 'entry'):
            items.append({
                'title': _text(_child(entry, 'title')) or '(untitled)',
                'link': _item_link(entry),
                'description': _item_description(entry),
                'pubDate': _item_date(entry),
                'image': _item_image(entry),
            })
    else:
        # RSS 0.9x / 1.0 / 2.0
        channel_el = _child(root, 'channel') or root
        channel['title'] = _text(_child(channel_el, 'title'))
        channel['link'] = _text(_child(channel_el, 'link'))
        channel['description'] = strip_html(_text(_child(channel_el, 'description')))
        item_parents = [channel_el, root] if channel_el is not root else [root]
        seen = set()
        for parent in item_parents:
            for item in _children(parent, 'item'):
                key = id(item)
                if key in seen:
                    continue
                seen.add(key)
                items.append({
                    'title': _text(_child(item, 'title')) or '(untitled)',
                    'link': _item_link(item),
                    'description': _item_description(item),
                    'pubDate': _item_date(item),
                    'image': _item_image(item),
                })

    return {
        'channel': channel,
        'items': items,
    }


def fetch_rss(url: str, limit: int = 10) -> dict:
    """Magpie-like: returns {channel, items} for a feed URL."""
    feed_url = normalize_feed_url(url)
    try:
        limit_n = int(limit)
    except (TypeError, ValueError):
        limit_n = 10
    limit_n = max(1, min(50, limit_n))

    cache_key = f'notespro:rss:v2:{feed_url}:{limit_n}'
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    raw = fetch_feed_bytes(feed_url)
    parsed = parse_feed_xml(raw)
    parsed['items'] = parsed['items'][:limit_n]
    parsed['url'] = feed_url
    cache.set(cache_key, parsed, CACHE_TTL_SEC)
    return parsed
