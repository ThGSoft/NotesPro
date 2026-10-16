from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.contrib import messages
from django.contrib.auth import login
from django.contrib.auth.decorators import login_required
from django.contrib.auth.views import redirect_to_login
from django.db import IntegrityError, models, transaction
from django.http import Http404, HttpResponseBadRequest, HttpResponse, JsonResponse, StreamingHttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.conf import settings as django_settings
from django.contrib.staticfiles import finders
from django.views.decorators.http import require_GET, require_POST
from .forms import RegisterForm
from .models import Page, Workspace, UploadedFile, PastedFile, \
                    UserSettings, User, \
                    WorkspaceMembership, WorkspaceMailMessage, WorkspaceMailRecipient
from django.shortcuts import get_object_or_404
from django.core.files.storage import default_storage
import datetime
import json
import os, urllib, hashlib, re, zipfile
from types import SimpleNamespace
from pathlib import Path
from urllib.parse import urlparse
from django.contrib.auth.models import User
from django.db.models import Q
from django.utils.text import slugify
from .workspace_io import export_workspace_archive, import_workspace_archive
from .version import CREDITS, LICENSE, VERSION
from .game_scores import serialize_workspace_highscores
from .media_quota import StorageQuotaExceeded, assert_can_store

APP_LANGUAGE_CHOICES = (
    ('browser', 'Browser default'),
    ('en', 'English'),
    ('de', 'Deutsch'),
    ('fr', 'Français'),
    ('it', 'Italiano'),
    ('es', 'Español'),
)
ALLOWED_APP_LANGUAGE_VALUES = {code for code, _ in APP_LANGUAGE_CHOICES}


def normalize_app_language(value):
    raw = str(value or '').strip().lower().replace('_', '-')
    if not raw or raw == 'browser':
        return 'browser'
    if raw in ALLOWED_APP_LANGUAGE_VALUES:
        return raw
    primary = raw.split('-', 1)[0]
    if primary in ALLOWED_APP_LANGUAGE_VALUES:
        return primary
    return 'browser'


def stored_app_language(extra_configs):
    extra = extra_configs if isinstance(extra_configs, dict) else {}
    return normalize_app_language(extra.get('language') or extra.get('locale') or 'browser')


_SAFE_SHOP_IMAGE_RE = re.compile(
    r'^(?:https?://[^\s]+|/media/[^\s]+|media/[^\s]+)',
    re.IGNORECASE,
)


def _looks_like_card_number(value):
    raw = str(value or '').strip()
    if re.search(r'[A-Za-z]', raw):
        return False
    digits = re.sub(r'\D', '', raw)
    return 13 <= len(digits) <= 19


def _sanitize_shop_konto(value):
    konto = re.sub(r'\s+', ' ', str(value or '').strip())[:42]
    if _looks_like_card_number(konto):
        return ''
    return konto


def normalize_shop_settings(value):
    src = value if isinstance(value, dict) else {}
    raw_images = src.get('images') or []
    if isinstance(raw_images, str):
        raw_images = [raw_images]
    elif src.get('image') and not raw_images:
        raw_images = [src.get('image')]
    images = []
    for item in raw_images[:8]:
        url = str(item or '').strip()[:500]
        if not url or url.lower().startswith(('javascript:', 'data:')):
            continue
        if _SAFE_SHOP_IMAGE_RE.match(url) or url.startswith('media/'):
            images.append(url)
    mastercard = str(src.get('mastercard') or src.get('card') or '').strip()[:240]
    if _looks_like_card_number(mastercard):
        mastercard = ''
    paypal = str(src.get('paypal') or src.get('paypal_email') or '').strip()[:120]
    konto = _sanitize_shop_konto(src.get('konto') or src.get('iban') or src.get('account'))
    return {
        'description': str(src.get('description') or src.get('desc') or '').strip()[:2000],
        'info': str(src.get('info') or src.get('additional_info') or src.get('about') or '').strip()[:2000],
        'images': images,
        'paypal_enabled': bool(src.get('paypal_enabled') or src.get('paypalEnabled')),
        'paypal': paypal,
        'visa_enabled': bool(src.get('visa_enabled') or src.get('visaEnabled')),
        'mastercard_enabled': bool(src.get('mastercard_enabled') or src.get('mastercardEnabled')),
        'mastercard': mastercard,
        'konto': konto,
    }

from .tags import (
    list_workspace_tag_names,
    page_tag_names,
    search_workspace_pages_by_tag,
    sync_page_tags,
)
from .models import WorkspaceInvite
from .workspace_members import (
    accept_pending_invites_for_user,
    add_existing_user_to_workspace,
    invite_or_add_by_email,
    notify_owners_user_registered,
)
from .activation import (
    SESSION_PENDING_ACTIVATION,
    activation_channel,
    activation_code_is_valid,
    activation_destination_label,
    can_resend_activation,
    issue_activation_code,
    register_mail_enabled,
    register_mobile_enabled,
)


def _workspace_access_q(user):
    return (
        Q(owner=user) |
        Q(workspacemembership__user=user) |
        Q(groups__in=user.groups.all())
    )


def _workspace_qs(user):
    return Workspace.objects.filter(
        _workspace_access_q(user),
        deleted=False,
    ).distinct()


def _page_qs(user, include_deleted=False):
    """
    Gibt alle Seiten aus Workspaces zurück, auf die der User Zugriff hat
    (entweder als Besitzer oder als eingeladenes Mitglied).
    """
    qs = Page.objects.filter(
        Q(workspace__owner=user) |
        Q(workspace__workspacemembership__user=user) |
        Q(workspace__groups__in=user.groups.all()),
        workspace__deleted=False,
    )
    if not include_deleted:
        qs = qs.filter(deleted=False)
    return qs.distinct()


def _active_pages(workspace):
    return workspace.pages.filter(deleted=False)


def _saved_page_id_for_workspace(user_settings, workspace):
    """Last opened page id for *workspace*, or None."""
    pages = user_settings.workspace_pages if isinstance(user_settings.workspace_pages, dict) else {}
    page_id = pages.get(str(workspace.id))
    if page_id is None and user_settings.last_workspace_id == workspace.id:
        page_id = user_settings.last_page_id
    if page_id is None:
        return None
    try:
        return int(page_id)
    except (TypeError, ValueError):
        return None


def _saved_page_for_workspace(user_settings, workspace):
    page_id = _saved_page_id_for_workspace(user_settings, workspace)
    if not page_id:
        return None
    return _active_pages(workspace).filter(id=page_id, is_folder=False).first()


def _set_workspace_page(user_settings, workspace_id, page_id):
    pages = dict(user_settings.workspace_pages or {}) if isinstance(user_settings.workspace_pages, dict) else {}
    ws_key = str(workspace_id)
    if page_id:
        pages[ws_key] = int(page_id)
    else:
        pages.pop(ws_key, None)
    user_settings.workspace_pages = pages


def _soft_delete_page(page):
    descendant_ids = _page_subtree_ids(page)
    Page.objects.filter(id__in=descendant_ids).update(deleted=True)


def _page_subtree_ids(root, include_deleted=False):
    ids = []
    stack = [root.id]
    while stack:
        pid = stack.pop()
        ids.append(pid)
        children = Page.objects.filter(parent_id=pid, workspace_id=root.workspace_id)
        if not include_deleted:
            children = children.filter(deleted=False)
        stack.extend(children.values_list('id', flat=True))
    return ids


def _restore_page(page):
    ids = set(_page_subtree_ids(page, include_deleted=True))
    ancestor = page.parent
    while ancestor is not None and ancestor.deleted:
        ids.add(ancestor.id)
        ancestor = ancestor.parent
    for restored in Page.objects.filter(id__in=ids).order_by('id'):
        restored.deleted = False
        try:
            restored.save(update_fields=['deleted'])
        except IntegrityError:
            restored.slug = ''
            restored.save()


def _user_has_write_access(user, workspace):
    if workspace.owner_id == user.id:
        return True
    if WorkspaceMembership.objects.filter(
        workspace=workspace, user=user, role='write',
    ).exists():
        return True
    if user.groups.filter(name='Group Admin').exists():
        return True
    return False


def _reindex_page_siblings(workspace, parent):
    siblings = list(
        _active_pages(workspace).filter(parent=parent).order_by('sort_order', 'id'),
    )
    for idx, sibling in enumerate(siblings):
        if sibling.sort_order != idx:
            sibling.sort_order = idx
            sibling.save(update_fields=['sort_order'])


def _insert_page_among_siblings(workspace, parent, page, position):
    siblings = list(
        _active_pages(workspace)
        .filter(parent=parent)
        .exclude(pk=page.pk)
        .order_by('sort_order', 'id'),
    )
    position = max(0, min(int(position), len(siblings)))
    siblings.insert(position, page)
    for idx, sibling in enumerate(siblings):
        if sibling.sort_order != idx:
            sibling.sort_order = idx
            sibling.save(update_fields=['sort_order'])


def _move_page_subtree_to_workspace(root_page, target_workspace, target_parent=None):
    if target_parent is not None and (
        target_parent.workspace_id != target_workspace.id or not target_parent.is_folder
    ):
        raise ValueError('Invalid target parent.')

    subtree_ids = _page_subtree_ids(root_page)
    pages = list(Page.objects.filter(id__in=subtree_ids, deleted=False))
    id_to_page = {p.id: p for p in pages}

    max_sort = _active_pages(target_workspace).filter(parent=target_parent).aggregate(
        models.Max('sort_order'),
    )['sort_order__max'] or 0

    bfs_order = []
    queue = [root_page.id]
    while queue:
        pid = queue.pop(0)
        page = id_to_page.get(pid)
        if page:
            bfs_order.append(page)
        for child_id in Page.objects.filter(
            parent_id=pid, id__in=subtree_ids, deleted=False,
        ).order_by('sort_order', 'id').values_list('id', flat=True):
            queue.append(child_id)

    for page in bfs_order:
        page.workspace = target_workspace
        page.slug = ''
        if page.id == root_page.id:
            page.parent = target_parent
            page.sort_order = max_sort + 1
        page.save()


def _soft_delete_workspace(workspace):
    workspace.pages.update(deleted=True)
    workspace.deleted = True
    workspace.save(update_fields=['deleted'])


def _restore_workspace(workspace):
    workspace.deleted = False
    workspace.save(update_fields=['deleted'])
    workspace.pages.update(deleted=False)

def _public_workspace_path(workspace):
    if workspace.normalized_settings().get('root'):
        return _site_root_path()
    path = reverse(
        'public_workspace',
        kwargs={
            'owner': workspace.owner.username,
            'workspace_slug': workspace.slug,
        },
    )
    base = (getattr(django_settings, 'FORCE_SCRIPT_NAME', None) or '').rstrip('/')
    if base and not path.startswith(f'{base}/'):
        return f'{base}{path}'
    return path


def _page_visible_without_login(page):
    if not page or page.deleted or page.is_folder or page.workspace.deleted:
        return False
    if page.normalized_settings().get('public'):
        return True
    return bool(page.workspace.normalized_settings().get('public'))


def _site_root_path():
    base = (getattr(django_settings, 'FORCE_SCRIPT_NAME', None) or '').rstrip('/')
    return f'{base}/' if base else '/'


def _public_page_path(page):
    if page.normalized_settings().get('root'):
        return _site_root_path()
    path = reverse(
        'public_page',
        kwargs={
            'owner': page.workspace.owner.username,
            'workspace_slug': page.workspace.slug,
            'page_slug': page.slug,
        },
    )
    base = (getattr(django_settings, 'FORCE_SCRIPT_NAME', None) or '').rstrip('/')
    if base and not path.startswith(f'{base}/'):
        return f'{base}{path}'
    return path


def _root_public_page():
    page = (
        Page.objects.filter(
            deleted=False,
            is_folder=False,
            workspace__deleted=False,
            settings__root=True,
        )
        .select_related('workspace', 'workspace__owner')
        .order_by('-updated_at', '-id')
        .first()
    )
    if not page:
        return None
    settings = page.normalized_settings()
    if not settings.get('root') or not settings.get('public'):
        return None
    return page


def _root_public_workspace():
    workspace = (
        Workspace.objects.filter(
            deleted=False,
            settings__root=True,
            settings__public=True,
        )
        .select_related('owner')
        .order_by('-id')
        .first()
    )
    if not workspace:
        return None
    settings = workspace.normalized_settings()
    if not settings.get('root') or not settings.get('public'):
        return None
    return workspace


def _public_workspace_or_404(owner, workspace_slug):
    workspace = (
        Workspace.objects.filter(
            deleted=False,
            slug=workspace_slug,
            owner__username=owner,
        )
        .select_related('owner')
        .first()
    )
    if not workspace or not workspace.normalized_settings().get('public'):
        raise Http404('Workspace not found')
    return workspace


def _page_to_dict(page):
    settings = page.normalized_settings()
    return {
        'id': page.id,
        'workspace': page.workspace_id,
        'parent': page.parent_id,
        'title': page.title,
        'slug': page.slug,
        'is_folder': page.is_folder,
        'sort_order': page.sort_order,
        'markdown_content': page.markdown_content,
        'archive': page.archive,
        'settings': settings,
        'tags': page_tag_names(page),
        'public_url': _public_page_path(page) if settings.get('public') and not page.is_folder else '',
    }


def _public_page_boot(page):
    settings = page.normalized_settings()
    return {
        'id': page.id,
        'workspace': page.workspace_id,
        'title': page.title,
        'slug': page.slug,
        'is_folder': False,
        'markdown_content': page.markdown_content,
        'archive': '',
        'settings': settings,
        'tags': page_tag_names(page) if settings.get('tags') else [],
        'public_url': _public_page_path(page),
        'owner': page.workspace.owner.username,
        'workspace_slug': page.workspace.slug,
    }


def _public_page_or_404(owner, workspace_slug, page_slug):
    page = (
        Page.objects.filter(
            deleted=False,
            is_folder=False,
            slug=page_slug,
            workspace__deleted=False,
            workspace__slug=workspace_slug,
            workspace__owner__username=owner,
        )
        .select_related('workspace', 'workspace__owner')
        .first()
    )
    if not page or not _page_visible_without_login(page):
        raise Http404('Page not found')
    return page


_GUEST_EMAIL_RE = re.compile(r'^[^@\s|,;]+@[^@\s|,;]+\.[^@\s|,;]+$')
_FORM_FENCE_RE = re.compile(
    r'```(radiobuttons?|radiolist|radio|votelist|vote|poll|text-area|textarea|'
    r'text-input|textinput|inputtext|numinput|number|dropdown|enum)'
    r'(?:\{([^}]*)\})?[ \t]*(?:\r?\n([\s\S]*?))?```',
    re.IGNORECASE,
)
_VOTE_FENCE_NAMES = {'votelist', 'vote', 'poll'}
_NOTESLIST_FENCE_RE = re.compile(
    r'```(noteslist|notes-list|craigslist|classifieds|clist|ads)'
    r'(?:\{([^}]*)\})?[ \t]*(?:\r?\n([\s\S]*?))?```',
    re.IGNORECASE,
)
_NOTES_BROADCAST = {'all', 'group', 'members', 'everyone', 'workspace', '*', 'alle'}


def _guest_email(value):
    email = re.sub(r'\s+', '', str(value or '')).strip().lower()[:120]
    if not email or not _GUEST_EMAIL_RE.match(email):
        return ''
    return email


def _vote_option_parts(line):
    raw = line.rstrip('\r\n')
    ending = line[len(raw):]
    stripped = raw.strip()
    if not stripped or stripped.startswith('#') or stripped.startswith('`'):
        return None
    if re.match(r'^title:\s*', stripped, re.IGNORECASE) and '|' not in stripped:
        return None
    indent = raw[:len(raw) - len(raw.lstrip())]
    rest = raw[len(indent):]
    bullet = ''
    bullet_match = re.match(r'^([-*+]\s+)(.*)$', rest)
    if bullet_match:
        bullet, rest = bullet_match.group(1), bullet_match.group(2)
    rest = re.sub(r'^(?:\([xXoO*]\)|\[[xX ]\])\s*', '', rest)
    if '|' in rest:
        label, vote_part = rest.split('|', 1)
        votes = [part.strip() for part in re.split(r'[,;]', vote_part) if part.strip()]
        label = label.strip()
    else:
        label, votes = rest.strip(), []
    if not label and not votes:
        return None
    return {
        'indent': indent,
        'bullet': bullet or '- ',
        'label': label,
        'votes': votes,
        'ending': ending,
    }


def _apply_guest_vote(markdown, form_index, option_index, email, select):
    matches = list(_FORM_FENCE_RE.finditer(markdown or ''))
    if form_index < 0 or form_index >= len(matches):
        return None, None, 'That vote was not found.'
    match = matches[form_index]
    if match.group(1).lower() not in _VOTE_FENCE_NAMES or match.start(3) < 0:
        return None, None, 'That block is not a vote.'
    body = match.group(3) or ''
    lines = body.splitlines(keepends=True)
    option_at = []
    for index, line in enumerate(lines):
        parts = _vote_option_parts(line)
        if parts:
            option_at.append((index, parts))
    if option_index < 0 or option_index >= len(option_at):
        return None, None, 'That choice was not found.'
    for _, parts in option_at:
        parts['votes'] = [name for name in parts['votes'] if name.lower() != email]
    if select:
        chosen = option_at[option_index][1]
        if len(chosen['votes']) >= 200:
            return None, None, 'This choice has too many votes.'
        chosen['votes'].append(email)
    for index, parts in option_at:
        votes = ', '.join(parts['votes'])
        tail = f"{parts['label']} | {votes}" if votes else parts['label']
        lines[index] = f"{parts['indent']}{parts['bullet']}{tail}{parts['ending']}"
    updated = f"{markdown[:match.start(3)]}{''.join(lines)}{markdown[match.end(3):]}"
    options = [{'votes': parts['votes']} for _, parts in option_at]
    return updated, options, None


def _clean_listing_field(value, limit):
    return re.sub(r'\s+', ' ', str(value or '')).replace('|', '/').strip()[:limit]


def _listing_until(value):
    raw = str(value or '').strip()
    match = re.match(r'^(\d{4})-(\d{2})-(\d{2})$', raw)
    if not match:
        return ''
    try:
        day = datetime.date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    except ValueError:
        return ''
    today = datetime.date.today()
    if day < today or day > today + datetime.timedelta(days=31):
        return ''
    return day.isoformat()


def _guest_listing_line(payload, email):
    title = _clean_listing_field(payload.get('title'), 120)
    if not title:
        return '', 'Enter a title.'
    until_raw = str(payload.get('until') or '').strip()
    until = _listing_until(until_raw) if until_raw else ''
    if until_raw and not until:
        return '', 'Choose an end date within one month.'
    parts = [
        title,
        _clean_listing_field(payload.get('price'), 40),
        _clean_listing_field(payload.get('location'), 80),
        _clean_listing_field(payload.get('description'), 500),
    ]
    if until:
        parts.append(f'until:{until}')
    parts.append(f'from:{email}')
    return ' | '.join(parts), None


def _insert_listing_line(body, category, line):
    lines = str(body or '').replace('\r\n', '\n').split('\n')
    cat = _clean_listing_field(category, 80)
    if not cat:
        while lines and not lines[-1].strip():
            lines.pop()
        lines.append(line)
        return '\n'.join(lines)
    cat_key = cat.casefold()
    heading_idx = -1
    next_heading = len(lines)
    for index, row in enumerate(lines):
        match = re.match(r'^#+\s+(.+)$', row.strip())
        if not match:
            continue
        if heading_idx >= 0:
            next_heading = index
            break
        if match.group(1).strip().casefold() == cat_key:
            heading_idx = index
    if heading_idx < 0:
        if lines and lines[-1].strip():
            lines.append('')
        lines.extend([f'# {cat}', line])
        return '\n'.join(lines)
    insert_at = next_heading
    while insert_at > heading_idx + 1 and not str(lines[insert_at - 1] or '').strip():
        insert_at -= 1
    lines.insert(insert_at, line)
    return '\n'.join(lines)


def _apply_guest_listing(markdown, list_index, category, line):
    matches = list(_NOTESLIST_FENCE_RE.finditer(markdown or ''))
    if list_index < 0 or list_index >= len(matches):
        return None, 'That notes list was not found.'
    match = matches[list_index]
    if (match.group(3) or '').count('\n') > 400:
        return None, 'This list is full.'
    body = _insert_listing_line(match.group(3) or '', category, line)
    if not body.endswith('\n'):
        body += '\n'
    if match.start(3) < 0:
        attrs = match.group(2)
        header = f"```{match.group(1)}" + (f'{{{attrs}}}' if attrs is not None else '')
        replacement = f'{header}\n{body}```'
        return markdown[:match.start()] + replacement + markdown[match.end():], None
    return markdown[:match.start(3)] + body + markdown[match.end(3):], None


def _public_notes_recipient_ids(workspace, to_names):
    member_ids = set(
        WorkspaceMembership.objects.filter(workspace=workspace).values_list('user_id', flat=True)
    )
    member_ids.add(workspace.owner_id)
    tokens = []
    broadcast = False
    for name in (to_names or [])[:24]:
        cleaned = str(name or '').strip()
        if not cleaned:
            continue
        if cleaned.lower() in _NOTES_BROADCAST:
            broadcast = True
            continue
        tokens.append(cleaned)
    if broadcast or not tokens:
        return member_ids
    matched = set(
        User.objects.filter(pk__in=member_ids, username__in=tokens).values_list('pk', flat=True)
    )
    return matched or {workspace.owner_id}


def _public_notes_mail(workspace, subject, body, to_names):
    recipient_ids = _public_notes_recipient_ids(workspace, to_names)
    message = WorkspaceMailMessage.objects.create(
        workspace=workspace,
        sender=workspace.owner,
        subject=str(subject or 'Notes list')[:180],
        body=str(body or '')[:4000],
    )
    WorkspaceMailRecipient.objects.bulk_create([
        WorkspaceMailRecipient(message=message, user_id=uid)
        for uid in recipient_ids
    ])
    return message


def _public_shop_order_body(payload, merchant):
    payment = str(payload.get('payment') or '').strip().lower()
    labels = {'paypal': 'PayPal', 'visa': 'Visa', 'mastercard': 'Mastercard'}
    if payment not in labels:
        return None, 'Choose PayPal, Visa, or Mastercard.'
    lines = payload.get('lines') if isinstance(payload.get('lines'), list) else []
    clean_lines = []
    for line in lines[:40]:
        if not isinstance(line, dict):
            continue
        name = re.sub(r'\s+', ' ', str(line.get('name') or '')).strip()[:120]
        if not name:
            continue
        qty_raw = line.get('qty') or 1
        try:
            qty = max(1, min(99, int(qty_raw)))
        except (TypeError, ValueError):
            qty = 1
        price = re.sub(r'\s+', ' ', str(line.get('price') or '')).strip()[:40]
        clean_lines.append((name, qty, price))
    if not clean_lines:
        return None, 'The cart is empty.'
    buyer = _sanitize_shop_konto(payload.get('buyer_konto'))
    if _looks_like_card_number(payload.get('buyer_konto')):
        return None, 'Do not enter card numbers. Use your IBAN or account.'
    if payment in ('visa', 'mastercard') and not buyer:
        return None, 'Enter your Konto to transfer from.'
    email = _guest_email(payload.get('email'))
    if not email:
        return None, 'Enter your email.'
    title = re.sub(r'\s+', ' ', str(payload.get('title') or 'Shop')).strip()[:120] or 'Shop'
    note = re.sub(r'\s+', ' ', str(payload.get('note') or '')).strip()[:120]
    send_to = re.sub(r'\s+', ' ', str(payload.get('send_to') or '')).strip()[:240]
    bill_to = re.sub(r'\s+', ' ', str(payload.get('bill_to') or '')).strip()[:240]
    total = re.sub(r'\s+', ' ', str(payload.get('total') or '')).strip()[:40]
    parts = [f'Shop payment — {title}', f'Buyer: {email}', f'Payment: {labels[payment]}']
    if payment in ('visa', 'mastercard'):
        parts.append(f'Transfer from: {buyer}')
        if merchant.get('konto'):
            parts.append(f'Transfer to: {merchant["konto"]}')
        if merchant.get('mastercard'):
            parts.append(merchant['mastercard'])
    if send_to:
        parts.append(f'Sent to: {send_to}')
    if bill_to:
        parts.append(f'Bill to: {bill_to}')
    if note:
        parts.append(f'Note: {note}')
    for name, qty, price in clean_lines:
        qty_bit = f' ×{qty}' if qty > 1 else ''
        price_bit = f' — {price}' if price else ''
        parts.append(f'• {name}{qty_bit}{price_bit}')
    if total:
        parts.append(f'Total: {total}')
    body = '\n'.join(parts)[:4000]
    subject = f'Shop payment: {title}'
    if total:
        subject = f'{subject} · {total}'
    return {'subject': subject[:180], 'body': body, 'payment': payment}, None


def _broadcast_tags_updated(workspace_id, page_id):
    channel_layer = get_channel_layer()
    if not channel_layer:
        return
    async_to_sync(channel_layer.group_send)(
        f'workspace_tags_{workspace_id}',
        {'type': 'tags_updated', 'page_id': page_id},
    )



def _workspace_display_name(ws, user):
    if ws.owner_id == user.id:
        return ws.name or ''
    return f'{ws.owner.username}: {ws.name}'


def _sort_workspaces(workspaces, user):
    def sort_key(ws):
        owned = ws.owner_id == user.id
        return (0 if owned else 1, _workspace_display_name(ws, user).casefold())

    return sorted(workspaces, key=sort_key)


def _tree_data(user, workspace):
    pages = list(_active_pages(workspace))

    children_by_parent = {}
    for page in pages:
        children_by_parent.setdefault(page.parent_id, []).append(page)

    def sibling_sort_key(page):
        return (page.sort_order, page.id)

    for siblings in children_by_parent.values():
        siblings.sort(key=sibling_sort_key)

    flat = []

    def emit(parent_id):
        for page in children_by_parent.get(parent_id, []):
            flat.append({
                'id': str(page.id),
                'parent': str(page.parent_id) if page.parent_id else '#',
                'text': page.title,
                'type': 'folder' if page.is_folder else 'page',
                'data': {
                    'slug': page.slug,
                    'is_folder': page.is_folder,
                    'workspace': page.workspace_id,
                    'owner': workspace.owner.username,
                    'workspace_slug': workspace.slug,
                },
            })
            emit(page.id)

    emit(None)
    return flat


def _registration_template_flags():
    return {
        'register_mail': register_mail_enabled(),
        'register_mobile': register_mobile_enabled(),
    }


def _finish_new_user_login(request, user, settings_obj=None):
    if settings_obj is not None:
        settings_obj.activation_code_hash = ''
        updates = ['activation_code_hash']
        if settings_obj.mobile:
            settings_obj.mobile_verified = True
            updates.append('mobile_verified')
        settings_obj.save(update_fields=updates)
    request.session.pop(SESSION_PENDING_ACTIVATION, None)
    accepted_invites = accept_pending_invites_for_user(user)
    notify_owners_user_registered(user, accepted_invites)
    login(request, user)
    if not _workspace_qs(user).exists():
        Workspace.objects.create(owner=user, name='Main', slug='main')


def register_view(request):
    if request.user.is_authenticated:
        return redirect('dashboard')
    initial = {}
    email = (request.GET.get('email') or '').strip()
    if email:
        initial['email'] = email
    form = RegisterForm(request.POST or None, initial=initial)
    if request.method == 'POST' and form.is_valid():
        user = form.save()
        settings_obj, _ = UserSettings.objects.get_or_create(user=user)
        channel = activation_channel(user, settings_obj)
        if not channel:
            _finish_new_user_login(request, user, settings_obj)
            messages.success(request, 'Account created. Welcome.')
            return redirect('dashboard')
        dest = activation_destination_label(user, settings_obj)
        try:
            hint = issue_activation_code(user, settings_obj, channel=channel)
            via = 'email' if channel == 'email' else 'mobile number'
            messages.success(request, f'We sent a 6-digit code to {dest} ({via}). {hint}')
        except Exception:
            messages.warning(
                request,
                'Account created, but the activation code could not be sent. Use Resend on the next page.',
            )
        request.session[SESSION_PENDING_ACTIVATION] = user.id
        return redirect('activate')
    ctx = {'form': form, **_registration_template_flags()}
    return render(request, 'registration/register.html', ctx)


def activate_view(request):
    if request.user.is_authenticated:
        return redirect('dashboard')
    user_id = request.session.get(SESSION_PENDING_ACTIVATION)
    user = User.objects.filter(pk=user_id).first() if user_id else None
    if not user or user.is_active:
        messages.info(request, 'Sign in, or create an account first.')
        return redirect('login')
    settings_obj, _ = UserSettings.objects.get_or_create(user=user)
    dest = activation_destination_label(user, settings_obj)
    channel = activation_channel(user, settings_obj)
    activate_ctx = {
        'user': user,
        'mobile_masked': dest,
        'activation_channel': channel,
        **_registration_template_flags(),
    }

    if request.method == 'POST' and request.POST.get('action') == 'resend':
        ok, wait = can_resend_activation(settings_obj)
        if not ok:
            messages.warning(request, f'Wait {wait} seconds before requesting another code.')
            return redirect('activate')
        try:
            hint = issue_activation_code(user, settings_obj, channel=channel)
            messages.success(request, f'A new code was sent to {dest}. {hint}')
        except Exception:
            messages.error(request, 'Could not send the activation code. Try again in a minute.')
        return redirect('activate')

    if request.method == 'POST':
        code = (request.POST.get('code') or '').strip()
        if not activation_code_is_valid(settings_obj, code):
            messages.error(request, 'Invalid or expired code. Check the message or request a new one.')
            return render(request, 'registration/activate.html', activate_ctx)
        user.is_active = True
        user.save(update_fields=['is_active'])
        _finish_new_user_login(request, user, settings_obj)
        if channel == 'email':
            messages.success(request, 'Email confirmed. Welcome.')
        else:
            messages.success(request, 'Mobile number confirmed. Welcome.')
        return redirect('dashboard')

    return render(request, 'registration/activate.html', activate_ctx)

def _editor_login_next(request, page):
    """App URL that opens *page* for someone who can edit it."""
    base = (
        getattr(django_settings, 'FORCE_SCRIPT_NAME', None)
        or request.META.get('SCRIPT_NAME')
        or ''
    ).rstrip('/')
    return f'{base}/?ws={page.workspace_id}&page={page.id}'


def _requested_editor_page(request):
    """Page from ?ws=&page= when this user can edit it, else None."""
    try:
        page_id = int(request.GET.get('page') or '')
    except (TypeError, ValueError):
        return None
    try:
        ws_id = int(request.GET.get('ws') or '')
    except (TypeError, ValueError):
        ws_id = None
    page = (
        Page.objects.filter(
            pk=page_id,
            deleted=False,
            is_folder=False,
            workspace__deleted=False,
        )
        .select_related('workspace', 'workspace__owner')
        .first()
    )
    if not page:
        return None
    if ws_id is not None and page.workspace_id != ws_id:
        return None
    if not _workspace_qs(request.user).filter(pk=page.workspace_id).exists():
        return None
    if not _user_has_write_access(request.user, page.workspace):
        return None
    return page


def _remember_editor_page(request, page):
    settings, _ = UserSettings.objects.get_or_create(user=request.user)
    settings.last_workspace_id = page.workspace_id
    settings.last_page_id = page.id
    _set_workspace_page(settings, page.workspace_id, page.id)
    settings.save()


def site_entry(request):
    """Notes app for signed-in users. A superuser can publish one page at /."""
    if request.user.is_authenticated:
        if request.GET.get('page') or request.GET.get('ws'):
            page = _requested_editor_page(request)
            if page:
                _remember_editor_page(request, page)
                request.session['notespro_open_editing'] = page.id
            return redirect('dashboard')
        return dashboard(request)
    page = _root_public_page()
    if page:
        return _render_public_page(request, page)
    workspace = _root_public_workspace()
    if workspace:
        page = _active_pages(workspace).filter(is_folder=False).order_by('sort_order', 'id').first()
        if page:
            return _render_public_page(
                request,
                page,
                public_tree=_tree_data(None, workspace),
                public_workspace=True,
            )
    return redirect_to_login(request.get_full_path() or '/')


@login_required
def dashboard(request):
    # 1. Sicherstellen, dass Workspaces existieren
    workspaces = _workspace_qs(request.user).select_related('owner')
    if not workspaces.exists():
        Workspace.objects.create(owner=request.user, name='Main', slug='main')
        workspaces = _workspace_qs(request.user).select_related('owner')

    workspaces_list = _sort_workspaces(list(workspaces), request.user)

    # 2. UserSettings abrufen (get_or_create verhindert "User has no settings")
    settings, _ = UserSettings.objects.get_or_create(user=request.user)

    # 3. Workspace ermitteln: Entweder der letzte aus den Settings oder der erste verfügbare
    current_workspace = None
    if settings.last_workspace_id:
        current_workspace = next(
            (ws for ws in workspaces_list if ws.id == settings.last_workspace_id),
            None,
        )
    
    if not current_workspace:
        current_workspace = workspaces_list[0] if workspaces_list else None

    # 4. Seite ermitteln: zuletzt geöffnete Seite dieses Workspaces
    page = _saved_page_for_workspace(settings, current_workspace)

    if not page:
        page = _active_pages(current_workspace).filter(
            is_folder=False,
        ).order_by('sort_order', 'id').first()

    # 5. Settings aktualisieren, falls sie leer waren (Auto-Init)
    if settings.last_workspace_id != current_workspace.id or (page and settings.last_page_id != page.id):
        settings.last_workspace_id = current_workspace.id
        settings.last_page_id = page.id if page else None
        if page:
            _set_workspace_page(settings, current_workspace.id, page.id)
        settings.save()

    open_editing = False
    pending_edit = request.session.pop('notespro_open_editing', None)
    if page and pending_edit is not None:
        try:
            open_editing = int(pending_edit) == page.id
        except (TypeError, ValueError):
            open_editing = False

    extra = settings.extra_configs if isinstance(settings.extra_configs, dict) else {}
    app_language_stored = stored_app_language(extra)
    if app_language_stored == 'browser':
        app_language = django_settings.LANGUAGE_CODE or 'en'
    else:
        app_language = app_language_stored

    return render(request, 'notes/dashboard.html', {
        'workspaces': workspaces_list,
        'current_workspace': current_workspace,
        'page': page,
        'user_settings': settings,
        'app_language': app_language,
        'app_language_stored': app_language_stored,
        'app_language_choices': APP_LANGUAGE_CHOICES,
        'app_base': (getattr(django_settings, 'FORCE_SCRIPT_NAME', None) or request.META.get('SCRIPT_NAME') or '').rstrip('/'),
        'local_file_open_enabled': getattr(django_settings, 'LOCAL_FILE_OPEN_ENABLED', False),
        'tag_websocket_enabled': getattr(django_settings, 'ENABLE_TAG_WEBSOCKET', False),
        'allow_games': getattr(django_settings, 'ALLOW_GAMES', True),
        'allow_photos': getattr(django_settings, 'ALLOW_PHOTOS', True),
        'allow_offline': getattr(django_settings, 'ALLOW_OFFLINE', True),
        'can_write_workspace': bool(
            current_workspace and _user_has_write_access(request.user, current_workspace)
        ),
        'is_group_admin': request.user.groups.filter(name='Group Admin').exists(),
        'app_version': VERSION,
        'app_credits': CREDITS,
        'app_license': LICENSE,
        'game_highscores': serialize_workspace_highscores(current_workspace, request.user),
        'open_editing': open_editing,
    })


def _render_public_page(request, page, *, public_tree=None, public_workspace=False):
    workspace = page.workspace
    owner_settings, _ = UserSettings.objects.get_or_create(user=workspace.owner)
    extra = owner_settings.extra_configs if isinstance(owner_settings.extra_configs, dict) else {}
    public_settings = SimpleNamespace(
        extra_configs={'shop': normalize_shop_settings(extra.get('shop'))},
        workspace_pages={},
        sidebar_width=None,
        left_panel_expanded=bool(public_tree),
        right_panel_width=None,
        right_panel_expanded=False,
        font_size=16,
        stay_informed=False,
    )
    app_language = django_settings.LANGUAGE_CODE or 'en'
    return render(request, 'notes/dashboard.html', {
        'public_view': True,
        'public_workspace': public_workspace,
        'public_tree': public_tree or [],
        'public_page': _public_page_boot(page),
        'workspaces': [workspace],
        'current_workspace': workspace,
        'page': page,
        'user_settings': public_settings,
        'app_language': app_language,
        'app_language_stored': 'browser',
        'app_language_choices': APP_LANGUAGE_CHOICES,
        'app_base': (getattr(django_settings, 'FORCE_SCRIPT_NAME', None) or request.META.get('SCRIPT_NAME') or '').rstrip('/'),
        'local_file_open_enabled': False,
        'tag_websocket_enabled': _public_page_ws_enabled(page) or _public_workspace_ws_enabled(workspace),
        'allow_games': getattr(django_settings, 'ALLOW_GAMES', True),
        'allow_photos': getattr(django_settings, 'ALLOW_PHOTOS', True),
        'allow_offline': False,
        'can_write_workspace': False,
        'is_group_admin': False,
        'app_version': VERSION,
        'app_credits': CREDITS,
        'app_license': LICENSE,
        'game_highscores': {},
        'public_login_next': (
            _editor_login_next(request, page)
            if page and (
                page.normalized_settings().get('root')
                or (public_workspace and workspace.normalized_settings().get('root'))
            )
            else ''
        ),
    })


@require_GET
def public_page(request, owner, workspace_slug, page_slug):
    """Read-only page for visitors who are not signed in.

    The switch lives in page settings (outside markdown fences) so a NotesList
    or shop page can be shared without opening the rest of the workspace.
    """
    page = _public_page_or_404(owner, workspace_slug, page_slug)
    return _render_public_page(request, page)


@require_GET
def public_workspace(request, owner, workspace_slug):
    """Read-only workspace. The tree is visible and cannot be changed."""
    workspace = _public_workspace_or_404(owner, workspace_slug)
    page = _active_pages(workspace).filter(is_folder=False).order_by('sort_order', 'id').first()
    if not page:
        raise Http404('Workspace not found')
    return _render_public_page(
        request,
        page,
        public_tree=_tree_data(None, workspace),
        public_workspace=True,
    )


@require_GET
def public_page_json(request, owner, workspace_slug, page_slug):
    page = _public_page_or_404(owner, workspace_slug, page_slug)
    return JsonResponse(_public_page_boot(page))


@require_POST
def public_shop_order(request, owner, workspace_slug, page_slug):
    """Accept a shop payment from a visitor who cannot open Settings."""
    page = _public_page_or_404(owner, workspace_slug, page_slug)
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)
    if not isinstance(payload, dict):
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)

    owner_settings, _ = UserSettings.objects.get_or_create(user=page.workspace.owner)
    extra = owner_settings.extra_configs if isinstance(owner_settings.extra_configs, dict) else {}
    merchant = normalize_shop_settings(extra.get('shop'))
    built, error = _public_shop_order_body(payload, merchant)
    if error:
        return JsonResponse({'status': 'error', 'message': error}, status=400)

    workspace = page.workspace
    recipient_ids = {workspace.owner_id}
    to_names = payload.get('to') if isinstance(payload.get('to'), list) else []
    names = []
    for name in to_names[:12]:
        cleaned = str(name or '').strip()
        if cleaned and cleaned.lower() not in ('all', 'group', 'user', 'an'):
            names.append(cleaned)
    if names:
        member_ids = User.objects.filter(username__in=names).filter(
            Q(pk=workspace.owner_id) | Q(workspacemembership__workspace=workspace)
        ).values_list('pk', flat=True)
        recipient_ids.update(member_ids)

    message = WorkspaceMailMessage.objects.create(
        workspace=workspace,
        sender=workspace.owner,
        subject=built['subject'],
        body=built['body'],
    )
    WorkspaceMailRecipient.objects.bulk_create([
        WorkspaceMailRecipient(message=message, user_id=uid)
        for uid in recipient_ids
    ])
    return JsonResponse({
        'status': 'success',
        'payment': built['payment'],
        'paypal': merchant.get('paypal') or '',
        'konto': merchant.get('konto') or '',
    })


@require_POST
def public_vote(request, owner, workspace_slug, page_slug):
    """Record one guest vote on a public page. The voter is their email."""
    page = _public_page_or_404(owner, workspace_slug, page_slug)
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)
    if not isinstance(payload, dict):
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)
    email = _guest_email(payload.get('email'))
    if not email:
        return JsonResponse({'status': 'error', 'message': 'Enter your email.'}, status=400)
    try:
        form_index = int(payload.get('form_index'))
        option_index = int(payload.get('option_index'))
    except (TypeError, ValueError):
        return JsonResponse({'status': 'error', 'message': 'That vote was not found.'}, status=400)
    select = payload.get('select') is not False
    with transaction.atomic():
        locked = Page.objects.select_for_update().get(pk=page.pk)
        if not locked.normalized_settings().get('public') or locked.deleted:
            raise Http404('Page not found')
        updated, options, error = _apply_guest_vote(
            locked.markdown_content, form_index, option_index, email, select,
        )
        if error:
            return JsonResponse({'status': 'error', 'message': error}, status=400)
        locked.markdown_content = updated
        locked.save(update_fields=['markdown_content', 'updated_at'])
    return JsonResponse({'status': 'success', 'email': email, 'options': options})


@require_POST
def public_noteslist(request, owner, workspace_slug, page_slug):
    """Reply to or add a NotesList entry without an account. The guest is their email."""
    page = _public_page_or_404(owner, workspace_slug, page_slug)
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)
    if not isinstance(payload, dict):
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)
    email = _guest_email(payload.get('email'))
    if not email:
        return JsonResponse({'status': 'error', 'message': 'Enter your email.'}, status=400)
    action = str(payload.get('action') or '').strip().lower()
    to_names = payload.get('to') if isinstance(payload.get('to'), list) else []
    board = _clean_listing_field(payload.get('board') or 'Notes list', 120) or 'Notes list'
    if action == 'reply':
        title = _clean_listing_field(payload.get('title'), 120)
        text = _clean_listing_field(payload.get('text'), 2000)
        if not title:
            return JsonResponse({'status': 'error', 'message': 'That listing was not found.'}, status=400)
        if not text:
            return JsonResponse({'status': 'error', 'message': 'Enter a reply.'}, status=400)
        parts = [f'Notes list reply — {board}', f'From: {email}', f'Listing: {title}']
        price = _clean_listing_field(payload.get('price'), 40)
        location = _clean_listing_field(payload.get('location'), 80)
        if price:
            parts.append(f'Price: {price}')
        if location:
            parts.append(f'Location: {location}')
        parts.append(f'Message:\n{text}')
        _public_notes_mail(page.workspace, f'Reply: {title}', '\n'.join(parts), to_names)
        return JsonResponse({'status': 'success', 'email': email})
    if action != 'add':
        return JsonResponse({'status': 'error', 'message': 'Unknown notes list action.'}, status=400)
    line, error = _guest_listing_line(payload, email)
    if error:
        return JsonResponse({'status': 'error', 'message': error}, status=400)
    try:
        list_index = int(payload.get('list_index'))
    except (TypeError, ValueError):
        return JsonResponse({'status': 'error', 'message': 'That notes list was not found.'}, status=400)
    category = _clean_listing_field(payload.get('category'), 80)
    with transaction.atomic():
        locked = Page.objects.select_for_update().get(pk=page.pk)
        if not locked.normalized_settings().get('public') or locked.deleted:
            raise Http404('Page not found')
        updated, error = _apply_guest_listing(locked.markdown_content, list_index, category, line)
        if error:
            return JsonResponse({'status': 'error', 'message': error}, status=400)
        locked.markdown_content = updated
        locked.save(update_fields=['markdown_content', 'updated_at'])
    parts = [f'New notes list listing — {board}', f'From: {email}']
    if category:
        parts.append(f'Category: {category}')
    parts.append(line)
    _public_notes_mail(page.workspace, f'New listing: {category or board}', '\n'.join(parts), to_names)
    return JsonResponse({
        'status': 'success',
        'email': email,
        'markdown_content': updated,
    })


@require_GET
def service_worker(request):
    """Serve the offline service worker at /sw.js with a root scope."""
    if not getattr(django_settings, 'ALLOW_OFFLINE', True):
        return HttpResponse(status=404)
    path = finders.find('notes/offline-sw.js')
    if not path:
        fallback = Path(django_settings.BASE_DIR) / 'notes' / 'static' / 'notes' / 'offline-sw.js'
        path = str(fallback) if fallback.is_file() else None
    if not path:
        return HttpResponse(status=404)
    body = Path(path).read_text(encoding='utf-8')
    response = HttpResponse(body, content_type='application/javascript; charset=utf-8')
    script = (getattr(django_settings, 'FORCE_SCRIPT_NAME', None) or request.META.get('SCRIPT_NAME') or '').rstrip('/')
    response['Service-Worker-Allowed'] = f'{script}/' if script else '/'
    response['Cache-Control'] = 'no-cache'
    return response


@login_required
def workspace_list_create(request):
    print('workspace_list_create',request.user)
    if request.method == 'GET':
        data = [{'id': ws.id, 'name': ws.name, 'slug': ws.slug} for ws in _sort_workspaces(_workspace_qs(request.user), request.user)]
        return JsonResponse(data, safe=False)
    payload = json.loads(request.body or '{}')
    name = (payload.get('name') or '').strip()
    if not name:
        return JsonResponse({'error': 'Name required'}, status=400)
    base = name.lower().replace(' ', '-') or 'workspace'
    slug = base
    i = 1
    while _workspace_qs(request.user).filter(slug=slug).exists():
        slug = f'{base}-{i}'
        i += 1
    ws = Workspace.objects.create(owner=request.user, name=name, slug=slug)
    return JsonResponse({'id': ws.id, 'name': ws.name, 'slug': ws.slug})


@login_required
def workspace_create(request):
    if request.method != 'POST':
        return JsonResponse({'status': 'error', 'message': 'POST required'}, status=405)
    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON format'}, status=400)

    name = (data.get('name') or '').strip()
    if not name:
        return JsonResponse({'status': 'error', 'message': 'Name is required'}, status=400)

    base_slug = slugify(name) or 'workspace'
    slug = base_slug
    counter = 1
    while Workspace.objects.filter(
        owner=request.user, slug=slug, deleted=False,
    ).exists():
        slug = f'{base_slug}-{counter}'
        counter += 1

    ws = Workspace.objects.create(name=name, owner=request.user, slug=slug)
    return JsonResponse({
        'status': 'success',
        'id': ws.id,
        'name': ws.name,
        'slug': ws.slug,
    })

@login_required
def workspace_update(request, pk):
    print('workspace_update',request.user, pk)
    if request.method == 'POST':
        print(request.body)
        data = json.loads(request.body)
        
        ws = get_object_or_404(Workspace, pk=pk, owner=request.user, deleted=False)
        if 'name' in data:
            ws.name = (data.get('name') or '').strip() or ws.name
        if 'settings' in data:
            incoming = data.get('settings') if isinstance(data.get('settings'), dict) else {}
            merged = ws.normalized_settings()
            if 'public' in incoming:
                merged['public'] = Page._setting_bool(incoming.get('public'), False)
            if 'root' in incoming and request.user.is_superuser:
                merged['root'] = Page._setting_bool(incoming.get('root'), False)
            if 'ws' in incoming and request.user.is_superuser:
                merged['ws'] = Page._setting_bool(incoming.get('ws'), False)
            if merged.get('ws'):
                merged['root'] = True
            if merged.get('root'):
                merged['public'] = True
            else:
                merged['ws'] = False
            ws.settings = merged
            claim_root = bool(merged.get('root'))
        else:
            claim_root = False
        ws.save()
        if claim_root:
            ws.release_other_site_roots()
            ws.refresh_from_db()
        settings = ws.normalized_settings()
        return JsonResponse({
            'status': 'success',
            'id': ws.id,
            'name': ws.name,
            'slug': ws.slug,
            'settings': settings,
            'public_url': _public_workspace_path(ws) if settings.get('public') else '',
        })
    return JsonResponse({'status': 'error'}, status=400)

@login_required
def workspace_delete(request, pk):
    if request.method != 'POST':
        return JsonResponse({'status': 'error', 'message': 'POST required'}, status=405)
    ws = get_object_or_404(Workspace, pk=pk, owner=request.user, deleted=False)
    _soft_delete_workspace(ws)
    return JsonResponse({'status': 'success', 'id': ws.id, 'name': ws.name})


@login_required
def workspace_restore(request, pk):
    if request.method != 'POST':
        return JsonResponse({'status': 'error', 'message': 'POST required'}, status=405)
    ws = get_object_or_404(Workspace, pk=pk, owner=request.user, deleted=True)
    _restore_workspace(ws)
    return JsonResponse({'status': 'success', 'id': ws.id, 'name': ws.name})

@login_required
def add_workspace_member(request):
    if request.method != 'POST':
        return JsonResponse({'status': 'error', 'message': 'POST required'}, status=405)

    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)

    workspace_id = data.get('workspace_id')
    username = (data.get('username') or '').strip()
    email = (data.get('email') or '').strip().lower()
    role = data.get('role', 'read')

    workspace = get_object_or_404(Workspace, id=workspace_id, owner=request.user, deleted=False)

    if not username and not email:
        return JsonResponse({'status': 'error', 'message': 'Username or email required.'}, status=400)

    target_user = None
    if username:
        target_user = User.objects.filter(username__iexact=username).first()
    if not target_user and email:
        target_user = User.objects.filter(email__iexact=email).first()
    if not target_user and username and '@' in username:
        email = username.lower()
        username = ''
        target_user = User.objects.filter(email__iexact=email).first()

    if target_user:
        result = add_existing_user_to_workspace(
            request=request,
            workspace=workspace,
            inviter=request.user,
            user=target_user,
            role=role,
        )
        status = result.pop('http_status', 200)
        return JsonResponse(result, status=status)

    invite_email = email or (username if '@' in username else '')
    if invite_email:
        result = invite_or_add_by_email(
            request=request,
            workspace=workspace,
            inviter=request.user,
            email=invite_email,
            role=role,
        )
        status = result.pop('http_status', 200)
        return JsonResponse(result, status=status)

    return JsonResponse({
        'status': 'error',
        'message': 'User not found. Send an email address to invite someone who is not registered yet.',
    }, status=404)


@login_required
def remove_workspace_member(request):
    if request.method != 'POST':
        return JsonResponse({'status': 'error', 'message': 'Methode nicht erlaubt'}, status=405)
        
    try:
        data = json.loads(request.body)
        workspace_id = data.get('workspace_id')
        user_id = data.get('user_id')
        
        # 1. Sicherstellen, dass nur der Besitzer (owner) Personen entfernen darf
        workspace = get_object_or_404(Workspace, id=workspace_id, owner=request.user, deleted=False)
        
        # 2. Den Eintrag direkt aus der WorkspaceMembership-Zwischentabelle suchen
        membership = WorkspaceMembership.objects.filter(workspace=workspace, user_id=user_id)
        
        # 3. Wenn der Eintrag existiert, löschen
        if membership.exists():
            membership.delete()
            return JsonResponse({
                'status': 'success', 
                'message': 'member removed from WorkspaceMembership.'
            })
            
        return JsonResponse({'status': 'error', 'message': 'WorkspaceMembership does not exists.'}, status=400)
        
    except json.JSONDecodeError:
        return JsonResponse({'status': 'error', 'message': 'Ungültiges JSON-Format'}, status=400)


@login_required
def get_workspace_members(request, workspace_id):
    workspace = get_object_or_404(_workspace_qs(request.user), id=workspace_id)
    # Zugriffsschutz: Besitzer, Mitglied, oder Workspace-Gruppe
    is_owner = (workspace.owner == request.user)
    is_member = WorkspaceMembership.objects.filter(workspace_id=workspace.id, user_id=request.user.id).exists()
    has_group_access = workspace.groups.filter(pk__in=request.user.groups.all()).exists()
    print("get_workspace_members", request.user.username, "Owner:", workspace.owner, "WS_ID:", workspace.id, "IsOwner:", is_owner, "IsMember:", is_member)
    if not is_owner and not is_member and not has_group_access:
        return JsonResponse({'status': 'error', 'message': 'Access restricted.'}, status=403)
        
    members_list = []
    seen = set()

    def add_member(entry):
        uid = entry.get('id')
        if uid is None or uid in seen:
            return
        seen.add(uid)
        members_list.append(entry)

    # 1. Den Besitzer (Owner) immer als ersten Eintrag hinzufügen
    add_member({
        'id': workspace.owner.id,
        'username': workspace.owner.username,
        'is_owner': True,
        'role': 'owner'
    })

    # 2. NEU: Alle Mitglieder aus der Zwischentabelle laden (inklusive ihrer Rolle)
    # select_related('user') verhindert zusätzliche DB-Abfragen in der Schleife

    memberships = WorkspaceMembership.objects.filter(workspace_id=workspace_id).select_related('user')

    for ms in memberships:
        print("member:", ms.user.username)

        add_member({
            'id': ms.user.id,
            'username': ms.user.username,
            'is_owner': False,
            'role': ms.role,
        })

    for user in User.objects.filter(groups__in=workspace.groups.all()).distinct().order_by('username'):
        add_member({
            'id': user.id,
            'username': user.username,
            'is_owner': False,
            'role': 'group',
        })

    pending_invites = []
    if is_owner:
        pending_invites = [
            {
                'email': invite.email,
                'role': invite.role,
            }
            for invite in WorkspaceInvite.objects.filter(
                workspace=workspace,
                accepted=False,
            ).order_by('email')
        ]

    return JsonResponse({
        'status': 'success',
        'members': members_list,
        'pending_invites': pending_invites,
        'is_current_user_owner': is_owner,
        'can_write': _user_has_write_access(request.user, workspace),
    })


@login_required
def change_member_role(request):
    print("change_member_role")
    if request.method != 'POST':
        print("change_member_role failed POST")
        return JsonResponse({'status': 'error', 'message': 'Methode nicht erlaubt'}, status=405)
        
    try:
        data = json.loads(request.body)
        workspace_id = data.get('workspace_id')
        user_id = data.get('user_id')
        print("change_member_role data", workspace_id, user_id)
        
        # Nur der Besitzer (owner) des Workspaces darf Rollen verändern
        workspace = get_object_or_404(Workspace, id=workspace_id, owner=request.user, deleted=False)
        print("change_member_role Workspace", workspace.id)
        
        # Die bestehende Mitgliedschaft finden
        membership = get_object_or_404(WorkspaceMembership, workspace=workspace, user_id=user_id)
        # Rolle toggeln (Umschalten)
        new_role = 'write' if membership.role == 'read' else 'read'
        membership.role = new_role
        membership.save()
        
        return JsonResponse({
            'status': 'success', 
            'role': new_role,
            'message': f'Rolle erfolgreich zu {"Schreiben" if new_role == "write" else "Nur Lesen"} geändert.'
        })
        
    except json.JSONDecodeError:
        print("change_member_role failed JSONDecodeError")
        return JsonResponse({'status': 'error', 'message': 'Ungültiges JSON'}, status=400)
# API 1: Durchsucht alle registrierten Benutzer in der Django-Datenbank
@login_required
def user_search_lookup(request):
    query = request.GET.get('q', '').strip()
    if len(query) < 2:
        return JsonResponse({'status': 'success', 'users': []})
        
    # Suche nach Username oder E-Mail, schliesse den suchenden Admin selbst aus
    users = User.objects.filter(
        Q(username__icontains=query) | Q(email__icontains=query)
    ).exclude(id=request.user.id)[:8] # Limitiert auf die besten 8 Treffer
    
    user_data = [{'id': u.id, 'username': u.username, 'email': u.email} for u in users]
    return JsonResponse({'status': 'success', 'users': user_data})




@login_required
def tree_data(request, workspace_id):
    print('tree_data')
    workspace = get_object_or_404(_workspace_qs(request.user), pk=workspace_id)
    return JsonResponse( _tree_data(request.user, workspace), safe=False)


def _public_workspace_ws_enabled(workspace):
    settings = workspace.normalized_settings()
    return bool(
        getattr(django_settings, 'ENABLE_TAG_WEBSOCKET', False)
        and settings.get('ws')
        and settings.get('root')
        and settings.get('public')
    )


def _public_page_ws_enabled(page):
    settings = page.normalized_settings()
    return bool(
        getattr(django_settings, 'ENABLE_TAG_WEBSOCKET', False)
        and settings.get('ws')
        and settings.get('root')
        and settings.get('public')
    ) or _public_workspace_ws_enabled(page.workspace)


def _tag_read_access(request, workspace_id):
    """Members see every tag. Anonymous visitors see public pages when root WebSocket is on."""
    if request.user.is_authenticated:
        get_object_or_404(_workspace_qs(request.user), pk=workspace_id)
        return False, None
    if Page.public_root_ws_enabled(workspace_id):
        return True, None
    return False, redirect_to_login(request.get_full_path() or '/')


@require_GET
def workspace_tags_list(request, workspace_id):
    public_only, denied = _tag_read_access(request, workspace_id)
    if denied:
        return denied
    query = (request.GET.get('q') or '').strip().lower()
    tags = list_workspace_tag_names(workspace_id, query, public_only=public_only)
    return JsonResponse({'tags': tags})


@require_GET
def workspace_tags_search(request, workspace_id):
    public_only, denied = _tag_read_access(request, workspace_id)
    if denied:
        return denied
    tag = (request.GET.get('tag') or '').strip()
    query = (request.GET.get('q') or '').strip()
    pages = search_workspace_pages_by_tag(workspace_id, tag, query, public_only=public_only)
    return JsonResponse({'pages': pages})


@login_required
@require_POST
def workspace_tags_rebuild(request, workspace_id):
    workspace = get_object_or_404(_workspace_qs(request.user), pk=workspace_id)
    if not _user_has_write_access(request.user, workspace):
        return JsonResponse(
            {'status': 'error', 'message': 'You do not have write access to this workspace.'},
            status=403,
        )

    pages = _active_pages(workspace).only('id', 'is_folder', 'markdown_content', 'workspace_id')
    count = 0
    for page in pages.iterator():
        sync_page_tags(page)
        count += 1

    _broadcast_tags_updated(workspace.id, None)
    return JsonResponse({'success': True, 'pages_scanned': count})

@login_required
def _page_tree_for(workspace):
    pages = _active_pages(workspace).order_by("parent_id", "sort_order", "id")
    return [{
        "id": str(p.id),
        "parent": str(p.parent_id) if p.parent_id else "#",
        "text": p.title,
        "type": "folder" if p.is_folder else "page",
        "data": {
            "is_folder": p.is_folder,
            "slug": p.slug,
            "workspace": p.workspace_id,
        }
    } for p in pages]


@login_required
def page_detail(request, pk):
    page = _page_qs(request.user).filter(pk=pk).first()
    if not page:
        return JsonResponse(
            {'status': 'error', 'message': 'Page not found or no longer available.'},
            status=404,
        )
    return JsonResponse(_page_to_dict(page))

@login_required
def page_create(request):
    payload = json.loads(request.body or '{}')
    workspace = get_object_or_404(_workspace_qs(request.user), pk=payload.get('workspace'))
    if not _user_has_write_access(request.user, workspace):
        return JsonResponse(
            {'status': 'error', 'message': 'You do not have write access to this workspace.'},
            status=403,
        )
    title = (payload.get('title') or '').strip() or 'Untitled'
    parent_id = payload.get('parent')
    is_folder = bool(payload.get('is_folder'))
    parent = None
    if parent_id and parent_id != '#':
        parent = get_object_or_404(_page_qs(request.user), pk=parent_id, workspace=workspace)
    max_sort = _active_pages(workspace).filter(parent=parent).aggregate(
        models.Max('sort_order'),
    )['sort_order__max'] or 0
    page = Page.objects.create(
        workspace=workspace,
        parent=parent,
        title=title,
        is_folder=is_folder,
        sort_order=max_sort + 1,
        markdown_content='' if is_folder else '# Start writing\n',
    )
    sync_page_tags(page)
    return JsonResponse(_page_to_dict(page))

@login_required
def page_update(request, pk):
    page = get_object_or_404(_page_qs(request.user), pk=pk)
    payload = json.loads(request.body or '{}')
    title = payload.get('title')
    if title is not None:
        page.title = title.strip() or 'Untitled'
    if not page.is_folder and 'markdown_content' in payload:
        page.markdown_content = payload.get('markdown_content') or ''
    if not page.is_folder and 'archive' in payload:
        page.archive = payload.get('archive') or ''
    if 'settings' in payload:
        if not _user_has_write_access(request.user, page.workspace):
            return JsonResponse(
                {'status': 'error', 'message': 'You do not have write access to this workspace.'},
                status=403,
            )
        incoming = payload.get('settings') if isinstance(payload.get('settings'), dict) else {}
        merged = page.normalized_settings()
        if 'contents' in incoming:
            merged['contents'] = bool(incoming.get('contents'))
        if 'tags' in incoming:
            merged['tags'] = bool(incoming.get('tags'))
        if page.is_folder:
            merged['public'] = False
            merged['root'] = False
            merged['ws'] = False
        elif 'public' in incoming:
            merged['public'] = Page._setting_bool(incoming.get('public'), False)
        if (
            not page.is_folder
            and 'root' in incoming
            and request.user.is_superuser
        ):
            merged['root'] = Page._setting_bool(incoming.get('root'), False)
        if (
            not page.is_folder
            and 'ws' in incoming
            and request.user.is_superuser
        ):
            merged['ws'] = Page._setting_bool(incoming.get('ws'), False)
        if merged.get('ws'):
            merged['root'] = True
        if merged.get('root'):
            merged['public'] = True
            claim_root = True
        else:
            merged['ws'] = False
            claim_root = False
        page.settings = merged
    else:
        claim_root = False
    page.slug = ''
    page.save()
    if claim_root:
        page.release_other_site_roots()
    sync_page_tags(page)
    _broadcast_tags_updated(page.workspace_id, page.id)
    return JsonResponse(_page_to_dict(page))

@login_required
def page_delete(request, pk):
    if request.method != 'POST':
        return JsonResponse({'status': 'error', 'message': 'POST required'}, status=405)
    page = get_object_or_404(_page_qs(request.user), pk=pk)
    if not _user_has_write_access(request.user, page.workspace):
        return JsonResponse(
            {'status': 'error', 'message': 'You do not have write access to this workspace.'},
            status=403,
        )
    _soft_delete_page(page)
    return JsonResponse({
        'success': True,
        'id': page.id,
        'title': page.title,
        'is_folder': page.is_folder,
    })


@login_required
def page_restore(request, pk):
    if request.method != 'POST':
        return JsonResponse({'status': 'error', 'message': 'POST required'}, status=405)
    page = get_object_or_404(
        _page_qs(request.user, include_deleted=True), pk=pk, deleted=True,
    )
    if not _user_has_write_access(request.user, page.workspace):
        return JsonResponse(
            {'status': 'error', 'message': 'You do not have write access to this workspace.'},
            status=403,
        )
    _restore_page(page)
    page.refresh_from_db()
    payload = _page_to_dict(page)
    payload['success'] = True
    payload['status'] = 'success'
    return JsonResponse(payload)

@login_required
def page_reorder(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON'}, status=400)

    page = get_object_or_404(_page_qs(request.user), pk=payload.get('id'))
    if not _user_has_write_access(request.user, page.workspace):
        return JsonResponse(
            {'status': 'error', 'message': 'You do not have write access to this workspace.'},
            status=403,
        )

    parent_id = payload.get('parent')
    position = int(payload.get('position', 0))
    parent = None if parent_id in [None, '', '#'] else get_object_or_404(
        _page_qs(request.user), pk=parent_id, workspace=page.workspace,
    )
    if parent is not None:
        if not parent.is_folder:
            # Dropped onto a page: reorder as a sibling in the same folder.
            position = parent.sort_order
            parent = parent.parent
        if parent is not None:
            subtree_ids = set(_page_subtree_ids(page))
            if parent.id == page.id or parent.id in subtree_ids:
                return JsonResponse(
                    {'status': 'error', 'message': 'Cannot move a folder into itself or its descendants.'},
                    status=400,
                )

    with transaction.atomic():
        old_parent_id = page.parent_id
        page.parent = parent
        page.save(update_fields=['parent'])
        _insert_page_among_siblings(page.workspace, parent, page, position)
        new_parent_id = parent.id if parent else None
        if old_parent_id != new_parent_id:
            old_parent = None
            if old_parent_id is not None:
                old_parent = Page.objects.filter(pk=old_parent_id).first()
            _reindex_page_siblings(page.workspace, old_parent)

    return JsonResponse({'status': 'success', 'success': True})


@login_required
def page_move_workspace(request, pk):
    if request.method != 'POST':
        return JsonResponse({'status': 'error', 'message': 'POST required'}, status=405)
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)

    page = get_object_or_404(_page_qs(request.user), pk=pk)
    source_workspace = page.workspace
    target_workspace_id = payload.get('target_workspace_id')
    if not target_workspace_id:
        return JsonResponse({'status': 'error', 'message': 'target_workspace_id is required.'}, status=400)

    target_workspace = get_object_or_404(_workspace_qs(request.user), pk=target_workspace_id)
    if target_workspace.id == source_workspace.id:
        return JsonResponse({'status': 'error', 'message': 'Choose a different workspace.'}, status=400)

    if not _user_has_write_access(request.user, source_workspace):
        return JsonResponse({'status': 'error', 'message': 'Write access required on source workspace.'}, status=403)
    if not _user_has_write_access(request.user, target_workspace):
        return JsonResponse({'status': 'error', 'message': 'Write access required on target workspace.'}, status=403)

    target_parent_id = payload.get('target_parent')
    target_parent = None
    if target_parent_id not in (None, '', '#'):
        target_parent = get_object_or_404(
            _page_qs(request.user), pk=target_parent_id, workspace=target_workspace, is_folder=True,
        )

    try:
        with transaction.atomic():
            _move_page_subtree_to_workspace(page, target_workspace, target_parent)
    except ValueError as exc:
        return JsonResponse({'status': 'error', 'message': str(exc)}, status=400)

    for moved_page in Page.objects.filter(
        id__in=_page_subtree_ids(page),
        deleted=False,
        is_folder=False,
    ):
        sync_page_tags(moved_page)

    page.refresh_from_db()
    return JsonResponse({
        'status': 'success',
        'page': _page_to_dict(page),
        'target_workspace_id': target_workspace.id,
    })


def convert_markdown_file_images(text):
    pattern = r'!\[(.*?)\]\((.*?)\)'

    def repl(match):
        alt_text = match.group(1)
        url = match.group(2)

        parsed = urlparse(url)
        path = parsed.path.lstrip("/")

        filename = os.path.basename(path)
        name_without_ext = os.path.splitext(filename)[0]

        # remove domain, keep relative path
        relative_url = path

        label = name_without_ext or alt_text or "file"

        return f'[{label}]({relative_url})'

    return re.sub(pattern, repl, text)


@login_required
def upload_file(request):
    workspace = get_object_or_404(_workspace_qs(request.user), pk=request.POST.get('workspace'))
    uploaded = request.FILES.get('file')
    if not uploaded:
        return JsonResponse({'error': 'No file'}, status=400)
    # MD5 berechnen
    file_content = uploaded.read()
    file_hash = hashlib.md5(file_content).hexdigest()
    uploaded.seek(0)
    print("upload_file:filehash:", file_hash)
    # Prüfen, ob dieser Hash bereits existiert
    existing_file = UploadedFile.objects.filter(
        md5_hash=file_hash, workspace=workspace,
    ).first()
    print("upload_file:existing_file:", existing_file)
    if existing_file:
            print("file exists")
            # Duplikat gefunden: Bestehende Daten zurückgeben
            absolute_url = request.build_absolute_uri(existing_file.file.url)   
            dest_path = urllib.parse.urlparse(absolute_url).path.lstrip('/')
            return JsonResponse({
                "success": True,
                "url": request.build_absolute_uri(existing_file.file.url),
                "path": existing_file.file.url,
                "is_duplicate": True,
                'file': {
                    # 'id': existing_file.file.id, 
                    'original_name': str(existing_file.file.name),
                    'mediaName': dest_path,
                    'url':absolute_url,
                }
            })
    try:
        assert_can_store(workspace, len(file_content), user=request.user)
    except StorageQuotaExceeded as exc:
        return JsonResponse({'success': False, 'error': str(exc)}, status=413)
    print("upload_file:upload_file")
    item = UploadedFile.objects.create(
            user=request.user,
            workspace=workspace, 
            file=uploaded, 
            original_name=uploaded.name,
            md5_hash=file_hash,

        )
    return JsonResponse(
            {
            'success': True, 
            'url': request.build_absolute_uri(item.file.url), 
            'file': {
                'id': item.id, 
                'original_name': item.original_name, 
                'url': request.build_absolute_uri(item.file.url)
                }
            })

@login_required
def file_manager(request, workspace_id):
    workspace = get_object_or_404(_workspace_qs(request.user), pk=workspace_id)
    data = [
        {
            'id': f.id, 
            'original_name': f.original_name, 
            'url':  request.build_absolute_uri(f.file.url),
            'furl': f.file.url
        } 
        for f in workspace.uploads.all()[:200]
    ]
    # print("file_manager")
    # print(data)
    return JsonResponse(data, safe=False)

@login_required
def debug(request):
    from django.http import JsonResponse
    return JsonResponse({
        "path": request.path,
        "script_name": request.META.get("SCRIPT_NAME"),
    })



@login_required
def updateUserSettings(request, workspace_id):
    # print('updateUserSettings',request)
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            # print('updateUserSettings',data)
            settings, created = UserSettings.objects.get_or_create(user=request.user)
            # print('updateUserSettings',settings)
            # Felder dynamisch aktualisieren
            if 'last_workspace_id' in data:
                settings.last_workspace_id = data['last_workspace_id']
            if 'last_page_id' in data:
                settings.last_page_id = data['last_page_id']
                _set_workspace_page(settings, workspace_id, data['last_page_id'])
            if 'workspace_pages' in data and isinstance(data['workspace_pages'], dict):
                pages = dict(settings.workspace_pages or {}) if isinstance(settings.workspace_pages, dict) else {}
                for key, value in data['workspace_pages'].items():
                    ws_key = str(key)
                    if value is None:
                        pages.pop(ws_key, None)
                    else:
                        try:
                            pages[ws_key] = int(value)
                        except (TypeError, ValueError):
                            continue
                settings.workspace_pages = pages
            if 'theme' in data:
                settings.theme = data['theme']
            if 'sidebar_width' in data:
                w = data['sidebar_width']
                if w is None:
                    settings.sidebar_width = None
                else:
                    settings.sidebar_width = max(260, min(640, int(w)))
            if 'left_panel_expanded' in data:
                settings.left_panel_expanded = bool(data['left_panel_expanded'])
            if 'right_panel_width' in data:
                w = data['right_panel_width']
                if w is None:
                    settings.right_panel_width = None
                else:
                    settings.right_panel_width = max(240, min(640, int(w)))
            if 'right_panel_expanded' in data:
                settings.right_panel_expanded = bool(data['right_panel_expanded'])
            if 'stay_informed' in data:
                settings.stay_informed = bool(data['stay_informed'])
            if 'font_size' in data:
                try:
                    settings.font_size = max(11, min(24, int(data['font_size'])))
                except (TypeError, ValueError):
                    pass
            if 'extra_configs' in data:
                incoming = data['extra_configs']
                if isinstance(incoming, dict):
                    existing = settings.extra_configs if isinstance(settings.extra_configs, dict) else {}
                    merged = dict(existing)
                    for key, value in incoming.items():
                        if key == 'chart_settings' and isinstance(value, dict):
                            charts = dict(merged.get('chart_settings') or {})
                            charts.update(value)
                            merged['chart_settings'] = charts
                        elif key == 'shop' and isinstance(value, dict):
                            merged['shop'] = normalize_shop_settings(value)
                        elif key in ('language', 'locale'):
                            merged['language'] = normalize_app_language(value)
                            merged.pop('locale', None)
                        else:
                            merged[key] = value
                    settings.extra_configs = merged

            settings.save()
            return JsonResponse({'status': 'ok'})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)}, status=400)
        

@login_required
def upload_pasted_image(request):
    try:
        pasted_image = request.FILES['image']
        print(pasted_image)
        if not pasted_image:
            return JsonResponse({'error': 'No file'}, status=400)
        # file_name = default_storage.save(f"pasted_images/{pasted_image}", pasted_image)
        # print(file_name)
        # file_url = default_storage.url(file_name)
        workspaceId = request.POST.get('workspace')
        workspace = get_object_or_404(_workspace_qs(request.user), pk=request.POST.get('workspace'))

        # MD5 berechnen
        file_content = pasted_image.read()
        file_hash = hashlib.md5(file_content).hexdigest()
        
        # Prüfen, ob dieser Hash bereits existiert
        existing_file = PastedFile.objects.filter(
            md5_hash=file_hash, workspace=workspace,
        ).first()

        if existing_file:
            print("file exists")
            # Duplikat gefunden: Bestehende Daten zurückgeben
            absolute_url = request.build_absolute_uri(existing_file.file.url)   
            dest_path = urllib.parse.urlparse(absolute_url).path.lstrip('/')
            return JsonResponse({
                "success": True,
                "url": request.build_absolute_uri(existing_file.file.url),
                "path": existing_file.file.url,
                "is_duplicate": True,
                'file': {
                    # 'id': existing_file.file.id, 
                    'original_name': str(existing_file.file.name),
                    'mediaName': dest_path,
                    'url':absolute_url,
                }
                })
        try:
            assert_can_store(workspace, len(file_content), user=request.user)
        except StorageQuotaExceeded as exc:
            return JsonResponse({'success': False, 'error': str(exc)}, status=413)
        pasted_image.seek(0)
        item = PastedFile.objects.create(
            user=request.user,
            workspace=workspace,
            original_name=str(pasted_image.name),
            file=pasted_image,
            md5_hash=file_hash,
        )
        print("file created")
        absolute_url = request.build_absolute_uri(item.file.url)
        dest_path = urllib.parse.urlparse(absolute_url).path.lstrip('/')
        print(f"DEBUG: Absolute URL ist: {absolute_url}")
        print(f"DEBUG: Media URL ist: {dest_path}")
        return JsonResponse({
            'success': True,
            'url': absolute_url,
            'file': {
                'original_name': item.file.name,
                'mediaName': dest_path,
                'url': absolute_url,
            },
        })
    except Exception as e:
        # Das wird in deinem Terminal ausgegeben (da wo runserver läuft)
        print("--- UPLOAD FEHLER START ---")
        print(f"Fehlertyp: {type(e).__name__}")
        print(f"Nachricht: {str(e)}")
        print("--- UPLOAD FEHLER ENDE ---")
        
        return JsonResponse({
            'success': False, 
            'error': f"Serverfehler: {type(e).__name__}",
            'details': str(e)
        }, status=500)


@login_required
@require_GET
def workspace_export(request, pk):
    workspace = get_object_or_404(_workspace_qs(request.user), pk=pk, deleted=False)
    if workspace.owner_id != request.user.id:
        return JsonResponse({'status': 'error', 'message': 'Only the workspace owner can export.'}, status=403)

    archive = export_workspace_archive(workspace)
    filename = f'{slugify(workspace.name) or "workspace"}-export.zip'
    response = HttpResponse(archive, content_type='application/zip')
    response['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response


@login_required
@require_POST
def workspace_import(request):
    uploaded = request.FILES.get('file')
    if not uploaded:
        return JsonResponse({'status': 'error', 'message': 'No file uploaded.'}, status=400)
    if not uploaded.name.lower().endswith('.zip'):
        return JsonResponse({'status': 'error', 'message': 'Import file must be a .zip archive.'}, status=400)

    try:
        workspace = import_workspace_archive(request.user, uploaded)
    except (ValueError, zipfile.BadZipFile, json.JSONDecodeError) as exc:
        return JsonResponse({'status': 'error', 'message': str(exc)}, status=400)
    except Exception as exc:
        return JsonResponse({'status': 'error', 'message': f'Import failed: {exc}'}, status=500)

    return JsonResponse({
        'status': 'success',
        'id': workspace.id,
        'name': workspace.name,
        'slug': workspace.slug,
    })


@login_required
@require_POST
def open_local_file(request):
    if not getattr(django_settings, 'LOCAL_FILE_OPEN_ENABLED', False):
        return JsonResponse({'error': 'Local file open is disabled on this server.'}, status=403)

    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON'}, status=400)

    href = (payload.get('path') or payload.get('href') or '').strip()
    display_path = (payload.get('display_path') or '').strip()
    if not href and not display_path:
        return JsonResponse({'error': 'Path required'}, status=400)

    from .local_files import file_url_to_path, open_in_file_manager

    candidates = []
    for raw in (href, display_path):
        raw = (raw or '').strip()
        if not raw or raw in candidates:
            continue
        candidates.append(raw)

    fs_path = None
    last_error = None
    for raw in candidates:
        try:
            fs_path = file_url_to_path(raw)
            break
        except ValueError as exc:
            last_error = exc

    if fs_path is None:
        return JsonResponse({'error': str(last_error or 'Invalid path')}, status=400)

    try:
        resolved = open_in_file_manager(fs_path)
        return JsonResponse({'success': True, 'path': resolved})
    except FileNotFoundError:
        return JsonResponse(
            {'error': f'File or folder not found: {fs_path}'},
            status=404,
        )
    except ValueError as exc:
        return JsonResponse({'error': str(exc)}, status=400)
    except OSError as exc:
        return JsonResponse({'error': str(exc)}, status=500)


@login_required
async def rss_fetch(request):
    """Proxy + parse an external RSS/Atom feed (async; MagpieRSS-style JSON)."""
    from asgiref.sync import sync_to_async

    from .rss_feed import fetch_rss

    if request.method != 'GET':
        return JsonResponse({'error': 'GET required'}, status=405)

    url = (request.GET.get('url') or '').strip()
    limit = request.GET.get('limit') or 10
    if not url:
        return JsonResponse({'error': 'url required'}, status=400)
    try:
        # Blocking HTTP/XML work runs in a worker thread so ASGI stays responsive.
        data = await sync_to_async(fetch_rss, thread_sensitive=False)(url, limit=limit)
    except ValueError as exc:
        return JsonResponse({'error': str(exc)}, status=400)
    except Exception as exc:  # noqa: BLE001 — surface fetch failures cleanly
        return JsonResponse({'error': f'Feed error: {exc}'}, status=502)
    return JsonResponse(data)


@login_required
async def link_preview(request):
    """Return a public page's Open Graph / Twitter preview image."""
    from asgiref.sync import sync_to_async

    from .link_preview import preview_for_url

    if request.method != 'GET':
        return JsonResponse({'error': 'GET required'}, status=405)
    url = (request.GET.get('url') or '').strip()
    if not url:
        return JsonResponse({'error': 'url required'}, status=400)
    try:
        data = await sync_to_async(preview_for_url, thread_sensitive=False)(url)
    except ValueError as exc:
        return JsonResponse({'error': str(exc)}, status=400)
    except Exception as exc:  # noqa: BLE001 — surface fetch failures cleanly
        return JsonResponse({'error': f'Link preview failed: {exc}'}, status=502)
    return JsonResponse(data)


@require_GET
def gdrive_resolve(request):
    """List a publicly shared Google Drive file or folder (jukebox / gallery)."""
    from urllib.error import HTTPError, URLError

    from .gdrive import resolve_drive

    raw = (request.GET.get('url') or request.GET.get('id') or '').strip()
    if not raw:
        return JsonResponse({'error': 'url required'}, status=400)
    kind = (request.GET.get('kind') or request.GET.get('media') or 'audio').strip().lower()
    media = 'image' if kind in ('image', 'images', 'photo', 'photos') else 'audio'
    try:
        data = resolve_drive(raw, media=media)
    except ValueError as exc:
        return JsonResponse({'error': str(exc)}, status=400)
    except (HTTPError, URLError, OSError) as exc:
        return JsonResponse({'error': f'Google Drive error: {exc}'}, status=502)
    return JsonResponse(data)


@require_GET
def gdrive_audio(request, file_id):
    """Stream a shared Google Drive file (Anyone with the link) for public playback."""
    from urllib.error import HTTPError, URLError

    from .gdrive import stream_drive_file

    try:
        stream = stream_drive_file(file_id, range_header=request.META.get('HTTP_RANGE'))
    except ValueError as exc:
        return JsonResponse({'error': str(exc)}, status=400)
    except HTTPError as exc:
        status = 404 if exc.code in (404, 410) else 502
        return JsonResponse({'error': f'Google Drive HTTP {exc.code}'}, status=status)
    except (URLError, OSError) as exc:
        return JsonResponse({'error': f'Google Drive fetch failed: {exc}'}, status=502)

    response = StreamingHttpResponse(
        stream.body,
        content_type=stream.content_type or 'audio/mpeg',
        status=stream.status or 200,
    )
    if stream.content_length:
        response['Content-Length'] = stream.content_length
    if stream.content_range:
        response['Content-Range'] = stream.content_range
    if stream.accept_ranges:
        response['Accept-Ranges'] = stream.accept_ranges
    response['Content-Disposition'] = 'inline'
    response['Cache-Control'] = 'private, max-age=86400'
    return response