"""Convert Redmine Textile wiki text to NotesPro markdown."""
from __future__ import annotations

import re
from html import unescape

_PRE_RE = re.compile(r'<pre(?:\s[^>]*)?>(.*?)</pre>', re.I | re.S)
_CODE_RE = re.compile(r'<code(?:\s[^>]*)?>(.*?)</code>', re.I | re.S)
_HTML_BR_RE = re.compile(r'<br\s*/?>', re.I)
_HTML_TAG_RE = re.compile(r'</?(?:notextile|span|div|p|b|i|u|strong|em|ul|ol|li)(?:\s[^>]*)?>', re.I)

_HEADING_RE = re.compile(r'^(h[1-6])([<>=()#.]*)\.\s+(.*)$', re.M)
_TOC_RE = re.compile(r'\{\{>?\s*toc\s*\}\}', re.I)
_BQ_RE = re.compile(r'^bq\.\s+(.*)$', re.M)

_WIKI_LINK_RE = re.compile(r'\[\[([^\]]+)\]\]')
_TEXTILE_LINK_RE = re.compile(r'"([^"]+)":(\S+)')
_ATTACH_ONLY_RE = re.compile(
    r'(?:^|>)?attachment:(?:"(?P<qname>[^"]+)"|(?P<name>[\w.+-]+\.[A-Za-z0-9]{1,8}))',
    re.I | re.M,
)

_IMAGE_RE = re.compile(
    r'!(?P<align>[<>=])?(?:\{(?P<style>[^}]*)\})?(?P<src>[^!\n]{1,240})!',
)

_BOLD_RE = re.compile(r'(?<!\*)\*([^*\n]+?)\*(?!\*)')
_ITALIC_RE = re.compile(r'(?<![A-Za-z0-9_])_([^_\n]+?)_(?![A-Za-z0-9_])')
_CODE_INLINE_RE = re.compile(r'@([^@\n]+?)@')

IMAGE_EXTS = {'.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.webp', '.tif', '.tiff'}


def wiki_title_key(title: str) -> str:
    text = (title or '').replace('_', ' ')
    text = re.sub(r'\s+', ' ', text).strip().lower()
    return text


def display_wiki_title(title: str) -> str:
    text = (title or '').replace('_', ' ')
    text = re.sub(r'\s+', ' ', text).strip()
    return text or 'Untitled'


def _looks_like_filename(value: str) -> bool:
    name = value.strip().split('?', 1)[0].split('#', 1)[0]
    name = name.split('/')[-1].split('\\')[-1]
    if not name or ' ' in name and '.' not in name:
        return False
    lower = name.lower()
    return any(lower.endswith(ext) for ext in IMAGE_EXTS) or '.' in name[-8:]


def _split_image_src(src: str):
    alt = ''
    body = src.strip()
    match = re.match(r'^(.*?)(?:\(([^)]*)\))?$', body)
    if match:
        body = match.group(1).strip()
        alt = (match.group(2) or '').strip()
    return body, alt


class TextileConverter:
    def __init__(self, *, attachment_urls=None, wiki_hrefs=None, project_hrefs=None):
        self.attachment_urls = {self._attach_key(k): v for k, v in (attachment_urls or {}).items()}
        self.wiki_hrefs = wiki_hrefs or {}
        self.project_hrefs = {wiki_title_key(k): v for k, v in (project_hrefs or {}).items()}
        self._placeholders = []

    @staticmethod
    def _attach_key(name: str) -> str:
        return (name or '').strip().lower()

    def _stash(self, text: str) -> str:
        token = f'§§NP{len(self._placeholders)}§§'
        self._placeholders.append(text)
        return token

    def _unstash(self, text: str) -> str:
        for i, value in enumerate(self._placeholders):
            text = text.replace(f'§§NP{i}§§', value)
        return text

    def _resolve_attachment(self, name: str) -> str | None:
        return self.attachment_urls.get(self._attach_key(name))

    def convert(self, textile: str) -> str:
        if not textile:
            return ''
        self._placeholders = []
        text = textile.replace('\r\n', '\n').replace('\r', '\n')
        text = unescape(text)
        text = _TOC_RE.sub('', text)
        text = _HTML_BR_RE.sub('\n', text)
        text = _PRE_RE.sub(self._replace_pre, text)
        text = _CODE_RE.sub(self._replace_code_block, text)
        text = _CODE_INLINE_RE.sub(self._replace_inline_code, text)
        text = _ATTACH_ONLY_RE.sub(self._replace_attachment, text)
        text = _IMAGE_RE.sub(self._replace_image, text)
        text = _WIKI_LINK_RE.sub(self._replace_wiki_link, text)
        text = _TEXTILE_LINK_RE.sub(self._replace_textile_link, text)
        text = _BQ_RE.sub(r'> \1', text)
        text = self._convert_lists(text)
        text = _HEADING_RE.sub(self._replace_heading, text)
        text = self._convert_tables(text)
        text = _BOLD_RE.sub(r'**\1**', text)
        text = _ITALIC_RE.sub(r'*\1*', text)
        text = _HTML_TAG_RE.sub('', text)
        text = self._unstash(text)
        text = re.sub(r'\n{4,}', '\n\n\n', text)
        return text.strip() + '\n'

    def _replace_pre(self, match: re.Match) -> str:
        body = unescape(match.group(1)).strip('\n')
        return '\n' + self._stash(f'```\n{body}\n```') + '\n'

    def _replace_code_block(self, match: re.Match) -> str:
        body = unescape(match.group(1)).strip('\n')
        return self._stash(f'`{body}`') if '\n' not in body else self._stash(f'```\n{body}\n```')

    def _replace_inline_code(self, match: re.Match) -> str:
        return self._stash(f'`{match.group(1)}`')

    def _replace_heading(self, match: re.Match) -> str:
        level = int(match.group(1)[1])
        return f'{"#" * level} {match.group(3).strip()}'

    def _replace_textile_link(self, match: re.Match) -> str:
        label, url = match.group(1), match.group(2).rstrip('.,;')
        return f'[{label}]({url})'

    def _replace_attachment(self, match: re.Match) -> str:
        name = match.group('qname') or match.group('name')
        url = self._resolve_attachment(name)
        if not url:
            return f'`{name}`'
        ext = '.' + name.rsplit('.', 1)[-1].lower() if '.' in name else ''
        if ext in IMAGE_EXTS:
            return f'![{name}]({url})'
        return f'[{name}]({url})'

    def _replace_image(self, match: re.Match) -> str:
        src, alt = _split_image_src(match.group('src') or '')
        if not src or not _looks_like_filename(src):
            return match.group(0)
        style = (match.group('style') or '').strip()
        url = src
        if not re.match(r'^(?:https?:|/media/)', src, re.I):
            filename = src.split('/')[-1]
            resolved = self._resolve_attachment(filename)
            if resolved:
                url = resolved
            else:
                url = filename
        alt = alt or src.split('/')[-1]
        image = f'![{alt}]({url})'
        width = ''
        if style:
            width_match = re.search(r'width\s*:\s*([^;]+)', style, re.I)
            if width_match:
                width = width_match.group(1).strip()
        if width:
            image += '{width=' + width + '}'
        return image

    def _replace_wiki_link(self, match: re.Match) -> str:
        raw = match.group(1).strip()
        label = None
        if '|' in raw:
            target, label = raw.split('|', 1)
            target, label = target.strip(), label.strip()
        else:
            target = raw
        project_ident = None
        page_part = target
        if ':' in target and not target.lower().startswith(('http:', 'https:')):
            project_ident, page_part = target.split(':', 1)
            project_ident, page_part = project_ident.strip(), page_part.strip()
        page_part = page_part.split('#', 1)[0].strip()
        label = label or display_wiki_title(page_part or project_ident or raw)
        href = None
        if project_ident and page_part:
            href = self.wiki_hrefs.get(f'{wiki_title_key(project_ident)}::{wiki_title_key(page_part)}')
        if href is None and project_ident and not page_part:
            href = self.project_hrefs.get(wiki_title_key(project_ident))
        if href is None and page_part:
            href = self.wiki_hrefs.get(wiki_title_key(page_part))
        if href:
            return f'[{label}]({href})'
        return f'**{label}**'

    def _convert_lists(self, text: str) -> str:
        lines = text.split('\n')
        out = []
        for line in lines:
            match = re.match(r'^([*#]+)\s+(.*)$', line)
            if not match or re.match(r'^h[1-6]([<>=()#.]*)\.\s+', line):
                out.append(line)
                continue
            markers, body = match.group(1), match.group(2)
            indent = '  ' * (len(markers) - 1)
            bullet = '1.' if markers[-1] == '#' else '-'
            out.append(f'{indent}{bullet} {body}')
        return '\n'.join(out)

    def _convert_tables(self, text: str) -> str:
        lines = text.split('\n')
        out = []
        i = 0
        while i < len(lines):
            if self._is_table_line(lines[i]):
                block = []
                while i < len(lines) and self._is_table_line(lines[i]):
                    block.append(lines[i])
                    i += 1
                out.extend(self._markdown_table(block))
                continue
            out.append(lines[i])
            i += 1
        return '\n'.join(out)

    @staticmethod
    def _is_table_line(line: str) -> bool:
        stripped = line.strip()
        if len(stripped) < 3:
            return False
        if stripped.startswith('>|'):
            stripped = stripped[1:]
        if stripped.startswith('|/') or stripped.startswith('|\\'):
            return True
        return stripped.startswith('|') and stripped.endswith('|') and stripped.count('|') >= 2

    @staticmethod
    def _split_cells(line: str) -> list[str]:
        stripped = line.strip()
        if stripped.startswith('>|'):
            stripped = stripped[1:]
        stripped = stripped.strip()
        if stripped.startswith('|'):
            stripped = stripped[1:]
        if stripped.endswith('|'):
            stripped = stripped[:-1]
        cells = [c.strip() for c in stripped.split('|')]
        cleaned = []
        for cell in cells:
            cell = re.sub(r'^[_\/\\]?[.\-=]*\s*', '', cell)
            cleaned.append(cell)
        return cleaned

    def _markdown_table(self, rows: list[str]) -> list[str]:
        parsed = [self._split_cells(row) for row in rows]
        width = max((len(r) for r in parsed), default=0)
        if width < 2:
            return rows
        parsed = [r + [''] * (width - len(r)) for r in parsed]
        header = parsed[0]
        body = parsed[1:]
        md = [
            '| ' + ' | '.join(header) + ' |',
            '| ' + ' | '.join(['---'] * width) + ' |',
        ]
        for row in body:
            md.append('| ' + ' | '.join(row) + ' |')
        return md
