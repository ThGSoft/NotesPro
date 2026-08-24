"""Parse and validate /media/ references in notes content."""

from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import unquote, urlparse

from django.conf import settings

MANAGED_MEDIA_PREFIXES = ('uploads/', 'pasted_images/', 'incoming_mail/')

IMAGE_LINK_RE = re.compile(r'!\[([^\]]*)\]\(([^)]+)\)(\{[^}]*\})?')
LINK_RE = re.compile(r'(?<!!)\[([^\]]*)\]\(([^)]+)\)')
BARE_MEDIA_PATH_RE = re.compile(
    r'(?<![\w./-])((?:uploads|pasted_images|incoming_mail)/[^\s)\]"\'<>]+)',
    re.IGNORECASE,
)


def _script_media_prefixes():
    script = (getattr(settings, 'FORCE_SCRIPT_NAME', '') or '').rstrip('/')
    prefixes = ['/media/', 'media/']
    if script:
        prefixes.insert(0, f'{script}/media/')
    return prefixes


def normalize_media_relpath(url_or_path: str | None) -> str | None:
    """Return a path relative to MEDIA_ROOT, or None if not a managed media URL."""
    if not url_or_path:
        return None

    raw = str(url_or_path).strip()
    if not raw or raw.startswith(('file://', 'mailto:', '#', 'data:')):
        return None

    if raw.startswith(('http://', 'https://')):
        path = unquote(urlparse(raw).path or '')
    else:
        path = unquote(raw.split(' ', 1)[0].split('\t', 1)[0])

    path = path.replace('\\', '/')
    for prefix in _script_media_prefixes():
        if path.startswith(prefix):
            path = path[len(prefix):]
            break

    path = path.lstrip('/')
    if not path:
        return None

    if not any(path.startswith(prefix) for prefix in MANAGED_MEDIA_PREFIXES):
        return None

    parts = [part for part in path.split('/') if part and part != '.']
    if any(part == '..' for part in parts):
        return None
    return '/'.join(parts)


def media_file_exists(relpath: str) -> bool:
    return (Path(settings.MEDIA_ROOT) / relpath).is_file()


def extract_media_paths_from_text(text: str | None) -> set[str]:
    if not text:
        return set()

    found: set[str] = set()
    for pattern in (IMAGE_LINK_RE, LINK_RE):
        for match in pattern.finditer(text):
            relpath = normalize_media_relpath(match.group(2))
            if relpath:
                found.add(relpath)

    for match in BARE_MEDIA_PATH_RE.finditer(text):
        relpath = normalize_media_relpath(match.group(1))
        if relpath:
            found.add(relpath)

    return found


def collect_referenced_media_paths(texts) -> set[str]:
    referenced: set[str] = set()
    for text in texts:
        referenced.update(extract_media_paths_from_text(text))
    return referenced


def media_markdown_href(url_or_path: str | None) -> str:
    """Canonical markdown href for a managed media file: media/uploads/…"""
    relpath = normalize_media_relpath(url_or_path)
    if relpath:
        return f'media/{relpath}'
    return (url_or_path or '').strip()


def _process_outside_fences(text: str, processor) -> str:
    parts = re.split(r'(```[\s\S]*?```)', text)
    return ''.join(part if part.startswith('```') else processor(part) for part in parts)


def normalize_media_paths_in_text(
    text: str | None,
    *,
    wrap_bare_paths: bool = True,
) -> tuple[str, int]:
    """Rewrite /media/… targets to media/… and optionally wrap bare paths as links."""
    if not text:
        return text or '', 0

    changes = 0

    def rewrite_url(url: str) -> tuple[str, bool]:
        relpath = normalize_media_relpath(url)
        if not relpath:
            return url, False
        canonical = f'media/{relpath}'
        raw = url.split(' ', 1)[0].strip()
        return canonical, raw != canonical

    def fix_image(match: re.Match) -> str:
        nonlocal changes
        alt, url = match.group(1), match.group(2)
        attrs = match.group(3) or ''
        new_url, changed = rewrite_url(url)
        if changed:
            changes += 1
        return f'![{alt}]({new_url}){attrs}'

    def fix_link(match: re.Match) -> str:
        nonlocal changes
        label, url = match.group(1), match.group(2)
        new_url, changed = rewrite_url(url)
        if changed:
            changes += 1
        return f'[{label}]({new_url})'

    def fix_segment(segment: str) -> str:
        nonlocal changes
        updated = IMAGE_LINK_RE.sub(fix_image, segment)
        updated = LINK_RE.sub(fix_link, updated)
        if not wrap_bare_paths:
            return updated

        def wrap_bare(match: re.Match) -> str:
            nonlocal changes
            relpath = normalize_media_relpath(match.group(1))
            if not relpath:
                return match.group(0)
            changes += 1
            label = Path(relpath).name or relpath
            return f'[{label}](media/{relpath})'

        return BARE_MEDIA_PATH_RE.sub(wrap_bare, updated)

    updated = _process_outside_fences(text, fix_segment)
    return updated, changes


def normalize_media_attachment_url(url_or_path: str | None) -> tuple[str, bool]:
    relpath = normalize_media_relpath(url_or_path)
    if not relpath:
        return (url_or_path or '').strip(), False
    canonical = f'media/{relpath}'
    raw = (url_or_path or '').strip()
    return canonical, raw != canonical


def clear_broken_media_links_in_text(
    text: str | None,
    *,
    exists=None,
) -> tuple[str, int]:
    """Remove markdown image/link targets that do not exist under MEDIA_ROOT."""
    if not text:
        return text or '', 0

    exists = exists or media_file_exists
    changes = 0

    def fix_image(match: re.Match) -> str:
        nonlocal changes
        alt, url = match.group(1), match.group(2)
        relpath = normalize_media_relpath(url)
        if not relpath or exists(relpath):
            return match.group(0)
        changes += 1
        return alt

    def fix_link(match: re.Match) -> str:
        nonlocal changes
        label, url = match.group(1), match.group(2)
        relpath = normalize_media_relpath(url)
        if not relpath or exists(relpath):
            return match.group(0)
        changes += 1
        return label

    updated = IMAGE_LINK_RE.sub(fix_image, text)
    updated = LINK_RE.sub(fix_link, updated)
    return updated, changes


def iter_content_texts(*, workspace=None, include_deleted=False):
    from notes.models import Page, QuickNote, UserSettings, WorkspaceChatMessage

    page_qs = Page.objects.select_related('workspace')
    if workspace is not None:
        page_qs = page_qs.filter(workspace=workspace)
    if not include_deleted:
        page_qs = page_qs.filter(deleted=False, workspace__deleted=False)

    for page in page_qs.iterator():
        yield f'page:{page.pk}', page.markdown_content or ''

    chat_qs = WorkspaceChatMessage.objects.select_related('workspace')
    if workspace is not None:
        chat_qs = chat_qs.filter(workspace=workspace)
    for message in chat_qs.iterator():
        if message.body:
            yield f'chat:{message.pk}:body', message.body
        if message.attachment_url:
            yield f'chat:{message.pk}:attachment', message.attachment_url

    note_qs = QuickNote.objects.select_related('workspace')
    if workspace is not None:
        note_qs = note_qs.filter(workspace=workspace)
    if not include_deleted:
        note_qs = note_qs.filter(deleted=False)
    for note in note_qs.iterator():
        if note.title:
            yield f'quicknote:{note.pk}:title', note.title
        if note.body:
            yield f'quicknote:{note.pk}:body', note.body

    settings_qs = UserSettings.objects.all()
    if workspace is not None:
        member_ids = workspace.members.values_list('pk', flat=True)
        settings_qs = settings_qs.filter(user_id__in=member_ids)
    for user_settings in settings_qs.iterator():
        extra = user_settings.extra_configs or {}
        if extra:
            yield f'usersettings:{user_settings.pk}', json.dumps(extra, ensure_ascii=False)


def collect_all_referenced_media_paths(*, workspace=None, include_deleted=False) -> set[str]:
    texts = (text for _, text in iter_content_texts(
        workspace=workspace,
        include_deleted=include_deleted,
    ))
    return collect_referenced_media_paths(texts)
