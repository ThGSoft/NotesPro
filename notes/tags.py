import re

from .models import PageTag, Tag

_HASHTAG_RE = re.compile(r'(?:^|\s)#([a-zA-Z0-9_-]+)')
_EXPLICIT_RE = re.compile(r'\[tag:([^\]]+)\]', re.I)
_BRACE_RE = re.compile(r'\{tag:\s*([^}]+)\}', re.I)


def normalize_tag_name(name):
    return (name or '').strip().lower()[:64]


def extract_tags_from_markdown(markdown):
    if not markdown:
        return set()
    names = set()
    for match in _HASHTAG_RE.finditer(markdown):
        tag = normalize_tag_name(match.group(1))
        if tag:
            names.add(tag)
    for match in _EXPLICIT_RE.finditer(markdown):
        tag = normalize_tag_name(match.group(1))
        if tag:
            names.add(tag)
    for match in _BRACE_RE.finditer(markdown):
        tag = normalize_tag_name(match.group(1))
        if tag:
            names.add(tag)
    return names


def sync_page_tags(page):
    if page.is_folder:
        PageTag.objects.filter(page=page).delete()
        return []

    names = extract_tags_from_markdown(page.markdown_content)
    existing = {
        page_tag.tag.name: page_tag
        for page_tag in page.page_tags.select_related('tag')
    }

    for name in names - existing.keys():
        tag, _ = Tag.objects.get_or_create(workspace=page.workspace, name=name)
        PageTag.objects.get_or_create(page=page, tag=tag)

    for name, page_tag in list(existing.items()):
        if name not in names:
            page_tag.delete()

    Tag.objects.filter(workspace=page.workspace, page_tags__isnull=True).delete()
    return sorted(names)


def page_tag_names(page):
    return list(
        page.page_tags.select_related('tag')
        .order_by('tag__name')
        .values_list('tag__name', flat=True)
    )
