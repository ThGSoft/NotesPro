import re

from .models import PageTag, Tag

_BRACE_RE = re.compile(r'\{tag:\s*([^}]+)\}', re.I)
_HEADING_RE = re.compile(r'^\s*#{1,6}\s+(.+?)\s*$', re.M)


def normalize_tag_name(name):
    return (name or '').strip().lower()[:64]


def extract_tags_from_markdown(markdown):
    if not markdown:
        return set()
    names = set()
    for match in _BRACE_RE.finditer(markdown):
        tag = normalize_tag_name(match.group(1))
        if tag:
            names.add(tag)
    for match in _HEADING_RE.finditer(markdown):
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


def list_workspace_tag_names(workspace_id, query=''):
    from .models import Tag

    tags = Tag.objects.filter(
        workspace_id=workspace_id,
        page_tags__page__deleted=False,
        page_tags__page__is_folder=False,
    ).distinct().order_by('name')
    q = (query or '').strip().lower()
    if q:
        tags = tags.filter(name__icontains=q)
    return list(tags.values_list('name', flat=True)[:100])


def search_workspace_pages_by_tag(workspace_id, tag_name, query=''):
    from .models import Page

    tag = normalize_tag_name(tag_name)
    if not tag:
        return []

    pages = Page.objects.filter(
        workspace_id=workspace_id,
        deleted=False,
        is_folder=False,
        page_tags__tag__name__iexact=tag,
    ).distinct().order_by('title')

    q = (query or '').strip()
    if q:
        pages = pages.filter(title__icontains=q)

    return [
        {
            'id': page.id,
            'title': page.title,
            'parent': page.parent_id,
            'tags': page_tag_names(page),
        }
        for page in pages[:50]
    ]
