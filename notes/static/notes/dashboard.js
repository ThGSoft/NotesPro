(function () {
  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
  const appBase = (window.APP_BASE || '').replace(/\/$/, '');

  /** Normalize upload/paste URL to markdown path: {appBase}/media/relative/path */
  function mediaMarkdownPath(urlOrPath) {
    if (!urlOrPath) return '';
    let path = String(urlOrPath).replace(/\\/g, '/');
    try {
      if (/^https?:\/\//i.test(path)) path = new URL(path).pathname;
    } catch (_) { /* keep path */ }
    if (appBase && path.startsWith(appBase + '/')) {
      path = path.slice(appBase.length);
    }
    let rel = '';
    const mediaMatch = path.match(/\/media\/(.+)$/i);
    if (mediaMatch) rel = mediaMatch[1];
    else if (/^media\/(.+)$/i.test(path)) rel = path.replace(/^media\//i, '');
    else rel = path.replace(/^\/+/, '');
    const prefix = appBase ? `${appBase}/media/` : '/media/';
    return prefix + rel;
  }

  let workspaceId = window.APP_BOOT?.workspaceId || null;
  let currentPageId = window.APP_BOOT?.pageId || null;

  function getWorkspaceId() {
    const fromSelect = document.getElementById('workspace-select')?.value;
    return fromSelect || workspaceId;
  }

  function syncWorkspaceIdFromDom() {
    const wsId = getWorkspaceId();
    if (wsId) workspaceId = wsId;
    return workspaceId;
  }
  let currentUserId = window.APP_BOOT.userId|| null;
  let currentUserName = window.APP_BOOT.username|| null;

  let currentPage = null;
  let selectedTreeNodeId = null;
  let chartSettingsCache = { ...(window.APP_BOOT?.extraConfigs?.chart_settings || {}) };
  let chartSettingsSaveTimer = null;
  let snippetsCache = normalizeSnippetsList(window.APP_BOOT?.extraConfigs?.snippets);
  let snippetsSaveTimer = null;
  let activeSnippetId = null;
  let panelInsertEditor = null;
  let panelInsertType = 'info';

  let easyMDE = null;
  let autosaveTimer = null;
  let previewRefreshTimer = null;
  let editorPreviewScrollLock = false;
  let previewScrollAnchors = [];
  let tocSpyScrollHandler = null;
  let isEditing = false;
  let userCanEdit = Boolean(window.APP_BOOT?.isStaff);
  let rightPanelWasExpandedBeforePreview = null;
  let currentEditor = null; // Speichert den Editor-Kontext für den Callback
  let chatPollTimer = null;
  let lastChatId = 0;
  let lastSeenChatId = 0;
  let pendingChatAttachment = null;
  let chatMode = 'private';
  let dmPollTimer = null;
  let activeDmConversationId = null;
  let activeDmPeer = null;
  let lastDmMessageId = 0;
  let lastSeenDmMessageId = 0;
  let dmSearchTimer = null;
  const dmAesKeyCache = new Map();
  let dmP2pSession = null;
  let dmTypingHideTimer = null;
  let dmTypingSendTimer = null;
  let dmListPollTimer = null;
  const dmSeenClientIds = new Set();
  const dmSeenCiphertexts = new Set();
  let mailBox = 'inbox';
  let tagWs = null;
  let tagWsReconnectTimer = null;
  let tagSearchTimer = null;
  let activeTagFilter = '';
  let previewContextLine = null;

  let workspacePages = { ...(window.APP_BOOT?.workspacePages || {}) };

  function getWorkspacePageId(wsId) {
    if (!wsId) return null;
    const raw = workspacePages[String(wsId)];
    if (raw === null || raw === undefined || raw === '') return null;
    const n = parseInt(String(raw), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function setWorkspacePageId(wsId, pageId) {
    if (!wsId) return;
    const key = String(wsId);
    if (pageId) workspacePages[key] = Number(pageId);
    else delete workspacePages[key];
  }

  function apiUrl(url) {
    return appBase + '/' + String(url).replace(/^\/+/, '');
  }

  function setStatus(text) {
    const el = document.getElementById('save-status');
    if (el) el.textContent = text;
  }

  async function api(url, method = 'GET', data = null, isForm = false) {
    const options = {
      method,
      headers: isForm
        ? { 'X-CSRFToken': csrfToken }
        : { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken }
    };
    if (data) options.body = isForm ? data : JSON.stringify(data);

    let response;
    try {
      response = await fetch(apiUrl(url), options);
    } catch (netErr) {
      const error = new Error(
        'Cannot reach the server. Start it with: python manage.py runserver'
      );
      error.network = true;
      throw error;
    }

    const text = await response.text();
    const contentType = response.headers.get('content-type') || '';

    if (!response.ok) {
      let message = text;
      if (contentType.includes('application/json')) {
        try {
          const err = JSON.parse(text);
          message = err.message || err.error || err.detail || message;
        } catch (_) { /* keep text */ }
      }
      if (response.status === 404) message = message || 'Not found';
      if (response.status === 403) message = message || 'Access denied';
      const error = new Error(message || `Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }

    if (!text) return {};
    if (!contentType.includes('application/json')) {
      if (text.includes('<!DOCTYPE') || text.includes('<html')) {
        throw new Error('Session expired or invalid response — please refresh and log in again.');
      }
      throw new Error('Unexpected server response');
    }
    return JSON.parse(text);
  }

  function slugifyHeading(text) {
    return (text || '')
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-');
  }

  function extractHeadings(markdown) {
    const lines = markdown.split('\n');
    const headings = [];
    lines.forEach(line => {
      const m = line.match(/^(#{1,6})\s+(.*)$/);
      if (m) {
        headings.push({ level: m[1].length, text: m[2].trim(), id: slugifyHeading(m[2].trim()) });
      }
    });
    return headings;
  }

  function normalizeTagName(name) {
    return String(name || '').trim().toLowerCase().slice(0, 64);
  }

  function extractTags(markdown) {
    const set = new Set();
    const hashtagMatches = markdown.match(/(^|\s)#([a-zA-Z0-9_-]+)/g) || [];
    hashtagMatches.forEach(m => {
      const tag = normalizeTagName(m.trim().replace(/^#/, '').replace(/^.*\s#/, ''));
      if (tag) set.add(tag);
    });
    const explicitMatches = [...markdown.matchAll(/\[tag:([^\]]+)\]/gi)];
    explicitMatches.forEach(m => {
      const tag = normalizeTagName(m[1]);
      if (tag) set.add(tag);
    });
    const braceMatches = [...markdown.matchAll(/\{tag:\s*([^}]+)\}/gi)];
    braceMatches.forEach(m => {
      const tag = normalizeTagName(m[1]);
      if (tag) set.add(tag);
    });
    return [...set];
  }

  function stripInlineTagMarkers(md) {
    return String(md || '')
      .replace(/\[tag:[^\]]+\]/gi, '')
      .replace(/\{tag:\s*[^}]+\}/gi, '');
  }

  function buildTagsHtml(tags) {
    if (!tags.length) return '';
    return `<div class="md-tags">${tags.map(tag => `<span class="md-tag">#${tag}</span>`).join('')}</div>`;
  }

  function parseTagQuery(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    const brace = trimmed.match(/^\{tag:\s*([^}]+)\}$/i);
    if (brace) return normalizeTagName(brace[1]);
    const bracket = trimmed.match(/^\[tag:([^\]]+)\]$/i);
    if (bracket) return normalizeTagName(bracket[1]);
    return trimmed.replace(/^#+/, '').toLowerCase();
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function wsTagsUrl(wsId) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const base = appBase || '';
    return `${proto}//${location.host}${base}/ws/workspaces/${wsId}/tags/`;
  }

  function sendTagWs(payload) {
    if (!tagWs || tagWs.readyState !== WebSocket.OPEN) return false;
    tagWs.send(JSON.stringify(payload));
    return true;
  }

  function disconnectTagWs() {
    clearTimeout(tagWsReconnectTimer);
    tagWsReconnectTimer = null;
    if (tagWs) {
      tagWs.onclose = null;
      tagWs.close();
      tagWs = null;
    }
  }

  function connectTagWs() {
    disconnectTagWs();
    syncWorkspaceIdFromDom();
    if (!workspaceId) return;

    const socket = new WebSocket(wsTagsUrl(workspaceId));
    tagWs = socket;

    socket.onopen = () => {
      const query = parseTagQuery(document.getElementById('tag-search')?.value);
      sendTagWs({ action: 'list_tags', q: query });
    };

    socket.onmessage = event => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (_) {
        return;
      }
      handleTagWsMessage(data);
    };

    socket.onclose = () => {
      if (tagWs !== socket) return;
      tagWs = null;
      tagWsReconnectTimer = setTimeout(connectTagWs, 2500);
    };
  }

  function handleTagWsMessage(data) {
    if (data.type === 'tags') {
      renderTagSuggestions(data.tags || []);
      return;
    }
    if (data.type === 'pages') {
      renderTagSearchResults(data.pages || []);
      return;
    }
    if (data.type === 'tags_updated') {
      const query = parseTagQuery(document.getElementById('tag-search')?.value);
      if (query) sendTagWs({ action: 'list_tags', q: query });
      if (activeTagFilter) sendTagWs({ action: 'search_pages', tag: activeTagFilter, q: query });
    }
  }

  function renderTagSuggestions(tags) {
    const box = document.getElementById('tag-suggestions');
    if (!box) return;
    if (!tags.length) {
      box.classList.add('d-none');
      box.innerHTML = '';
      return;
    }
    box.classList.remove('d-none');
    box.innerHTML = tags.map(tag => (
      `<button type="button" class="tag-suggestion" data-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</button>`
    )).join('');
  }

  function renderTagSearchResults(pages) {
    const box = document.getElementById('tag-search-results');
    if (!box) return;
    if (!activeTagFilter) {
      box.innerHTML = '';
      return;
    }
    if (!pages.length) {
      box.innerHTML = '<div class="tag-search-empty">No pages with this tag.</div>';
      return;
    }
    box.innerHTML = pages.map(page => (
      `<button type="button" class="tag-result-page" data-page-id="${page.id}">${escapeHtml(page.title)}</button>`
    )).join('');
  }

  function searchPagesByTag(tag, query = '') {
    activeTagFilter = tag;
    if (!sendTagWs({ action: 'search_pages', tag, q: query })) {
      connectTagWs();
    }
  }

  function scheduleTagSearch() {
    clearTimeout(tagSearchTimer);
    tagSearchTimer = setTimeout(() => {
      const input = document.getElementById('tag-search');
      const raw = input?.value?.trim() || '';
      const query = parseTagQuery(raw);
      const results = document.getElementById('tag-search-results');
      const suggestions = document.getElementById('tag-suggestions');

      if (!raw) {
        activeTagFilter = '';
        if (results) results.innerHTML = '';
        sendTagWs({ action: 'list_tags', q: '' });
        return;
      }

      if (!query) {
        activeTagFilter = '';
        if (results) results.innerHTML = '';
        if (suggestions) {
          suggestions.innerHTML = '';
          suggestions.classList.add('d-none');
        }
        return;
      }

      if (!sendTagWs({ action: 'list_tags', q: query })) {
        connectTagWs();
      }
    }, 200);
  }

  function initTagSearch() {
    const input = document.getElementById('tag-search');
    if (!input) return;

    input.addEventListener('input', scheduleTagSearch);

    input.addEventListener('focus', () => {
      if (!sendTagWs({ action: 'list_tags', q: parseTagQuery(input.value) })) {
        connectTagWs();
      }
    });

    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const tag = parseTagQuery(input.value);
      if (!tag) return;
      searchPagesByTag(tag);
    });

    document.getElementById('tag-suggestions')?.addEventListener('click', event => {
      const btn = event.target.closest('.tag-suggestion');
      if (!btn) return;
      const tag = btn.dataset.tag;
      if (!tag) return;
      input.value = `#${tag}`;
      searchPagesByTag(tag);
    });

    document.getElementById('tag-search-results')?.addEventListener('click', async event => {
      const btn = event.target.closest('.tag-result-page');
      if (!btn) return;
      const pageId = btn.dataset.pageId;
      if (!pageId) return;
      const tree = $('#tree').jstree(true);
      if (tree) {
        tree.deselect_all();
        tree.select_node(String(pageId));
      }
      await loadPage(pageId);
    });

    connectTagWs();
  }

  function parseMarkdownImageAttrs(attributes) {
    if (!attributes) return { width: null, align: null };
    const widthMatch = attributes.match(/width\s*=\s*["']?([^"';\s,}]+)/i);
    const alignMatch = attributes.match(/align\s*=\s*["']?(\w+)/i);
    let width = widthMatch ? widthMatch[1].trim() : null;
    if (width && /^\d+$/.test(width)) width = `${width}px`;
    const align = alignMatch ? alignMatch[1].toLowerCase() : null;
    return { width, align };
  }

  function renderMarkdownImage(alt, src, attributes) {
    const { width, align } = parseMarkdownImageAttrs(attributes);
    const styles = ['height: auto'];
    if (width) {
      styles.unshift(`width: ${width}`);
      styles.push('max-width: 100%');
    } else {
      styles.unshift('max-width: 100%');
    }
    const img = `<img class="md-image" src="${src}" alt="${alt}" style="${styles.join('; ')}"${width ? ` data-md-width="${width}"` : ''}>`;
    const tabHref = imageTabHref(src);
    const linkedImg = tabHref
      ? `<a href="${String(tabHref).replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer" class="md-image-link">${img}</a>`
      : img;
    if (align && align !== 'left') {
      return `<figure class="md-image-wrap" style="text-align: ${align}; margin: 10px 0;">${linkedImg}</figure>`;
    }
    if (width) {
      return `<figure class="md-image-wrap" style="margin: 10px 0;">${linkedImg}</figure>`;
    }
    return linkedImg;
  }

  function parseMarkdownImages(plainText) {
    const imageRegex = /!\[(.*?)\]\((.*?)\)\s*(?:\{(.*?)\})?/g;
    return plainText.replace(imageRegex, (match, alt, src, attributes) => renderMarkdownImage(alt, src, attributes));
  }

  function applyPreviewImageStyles(root) {
    if (!root) return;
    root.querySelectorAll('img').forEach(img => {
      if (img.closest('.d3-chart-wrap')) return;
      img.classList.add('md-image-zoomable');
      if (img.dataset.mdWidth) {
        img.style.width = img.dataset.mdWidth;
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
      }
      wrapImageWithTabLink(img);
    });
  }

  function initMarked() {
    if (typeof marked === 'undefined' || window.__markedConfigured) return;
    marked.setOptions({ gfm: true });
    window.__markedConfigured = true;
  }

  function parseBacktickConfig(line) {
    const config = {};
    if (!line.trim().startsWith('`')) return config;
    line.replace(/`/g, '').split(';').forEach(pair => {
      const [key, val] = pair.split('=').map(s => s.trim());
      if (key && val !== undefined) config[key] = val;
    });
    return config;
  }

  function sanitizeSheetColor(value) {
    if (!value) return '';
    const v = String(value).trim();
    const lower = v.toLowerCase();
    if (lower === 'none' || lower === 'default') return '';
    if (/^#[0-9a-f]{3,8}$/i.test(v)) return v;
    if (/^[a-zA-Z]+$/.test(v) && v.length <= 20) return v.toLowerCase();
    return '';
  }

  function sanitizeSheetFontSize(value) {
    if (!value) return '';
    const v = String(value).trim();
    const lower = v.toLowerCase();
    if (lower === 'none' || lower === 'default') return '';
    if (lower === 'small' || lower === 'medium' || lower === 'large') return lower;
    if (/^\d+(\.\d+)?(px|em|rem|%)$/i.test(v)) return v;
    return '';
  }

  function sanitizeSheetWidth(value) {
    if (!value) return '';
    const v = String(value).trim();
    const lower = v.toLowerCase();
    if (lower === 'none' || lower === 'default') return '';
    if (/^\d+(\.\d+)?%$/.test(v)) {
      const pct = parseFloat(v);
      if (Number.isFinite(pct) && pct > 100) return '100%';
      return v;
    }
    if (/^\d+(\.\d+)?(px|em|rem)$/i.test(v)) return v;
    if (/^\d+$/.test(v)) return `${v}px`;
    return '';
  }

  const SHEET_BLOCK_RE = /```sheet(?:\{([^}]*)\})?(?:[ \t]*\r?\n)([\s\S]*?)\r?\n```[ \t]*(?:\r?\n|$)/gi;

  function sheetFenceSuffix(attrs) {
    const a = String(attrs || '').trim();
    return a ? `{${a}}` : '';
  }

  function parseSheetFenceAttrs(attrs) {
    const config = {};
    const formatParts = [];
    String(attrs || '').split(';').forEach(part => {
      const p = part.trim();
      if (!p) return;
      if (/\b(id|sheet|header)\s*=/i.test(p)) {
        Object.assign(config, parseBacktickConfig('`' + p + '`'));
      } else {
        formatParts.push(p);
      }
    });
    return { config, formatParts };
  }

  function parseSheetStyleToken(part, state) {
    const p = part.trim();
    if (!p) return;
    const lower = p.toLowerCase();
    if (lower === 'bold') {
      state.bold = true;
      return;
    }
    if (lower === 'normal' || lower === 'nobold') {
      state.bold = false;
      return;
    }
    const eq = p.indexOf('=');
    if (eq === -1) return;
    const key = p.slice(0, eq).trim().toLowerCase();
    const val = p.slice(eq + 1).trim();
    if (key === 'frlen') {
      const n = parseInt(val, 10);
      if (!Number.isNaN(n)) state.frlen = n;
    } else if (key === 'align') {
      const a = val.toLowerCase();
      if (a === 'left' || a === 'center' || a === 'right') state.align = a;
    } else if (key === 'col') {
      state.col = sanitizeSheetColor(val);
    } else if (key === 'bg-col' || key === 'bgcol') {
      state.bgCol = sanitizeSheetColor(val);
    } else if (key === 'font-size' || key === 'fontsize') {
      state.fontSize = sanitizeSheetFontSize(val);
    } else if (key === 'width') {
      state.cellWidth = sanitizeSheetWidth(val);
    }
  }

  function applySheetStyleParts(parts, state) {
    const next = { ...state };
    parts.forEach(part => parseSheetStyleToken(part, next));
    return next;
  }

  function applySheetCellStyle(cell, state) {
    const trimmed = String(cell).trim();
    let parts = null;
    let value = '';

    const styleEq = trimmed.match(/^style\s*=\s*(.+)$/i);
    if (styleEq) {
      parts = styleEq[1].split(',');
    } else if (trimmed.startsWith('`')) {
      const backtickMatch = trimmed.match(/^`([^`]*)`([\s\S]*)$/);
      if (backtickMatch) {
        parts = backtickMatch[1].split(';');
        value = backtickMatch[2];
      } else if (trimmed.endsWith('`') && trimmed.length > 1) {
        parts = trimmed.slice(1, -1).split(';');
      }
    }

    if (!parts) return { value: cell, styleState: state };
    return { value, styleState: applySheetStyleParts(parts, state) };
  }

  function parseBacktickSegments(line) {
    const segments = [];
    const re = /`([^`]*)`/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      const inner = m[1].trim();
      if (inner) segments.push(inner);
    }
    return segments;
  }

  function isSheetMetaLine(trimmed) {
    if (!trimmed.includes('`')) return false;
    if (trimmed.includes('\t')) return false;
    const segments = parseBacktickSegments(trimmed);
    if (!segments.length) return false;
    if (trimmed.replace(/`[^`]*`/g, '').trim()) return false;
    return segments.some(s => /\b(id|sheet|header)\s*=/i.test(s));
  }

  function parseSheetMetaLine(trimmed, config, initialFormatParts) {
    parseBacktickSegments(trimmed).forEach(inner => {
      if (/\b(id|sheet|header)\s*=/i.test(inner)) {
        Object.assign(config, parseBacktickConfig('`' + inner + '`'));
      } else {
        inner.split(';').forEach(part => {
          const p = part.trim();
          if (p) initialFormatParts.push(p);
        });
      }
    });
  }

  function buildSheetStyleGrid(rawGrid, config, initialFormatParts = []) {
    const defaultFrlen = parseInt(config.frLen, 10);
    let state = {
      bold: false,
      frlen: Number.isNaN(defaultFrlen) ? 2 : defaultFrlen,
      align: (config.align || '').toLowerCase(),
      col: sanitizeSheetColor(config.col || ''),
      bgCol: sanitizeSheetColor(config['bg-col'] || config.bgCol || ''),
      fontSize: sanitizeSheetFontSize(config['font-size'] || config.fontSize || ''),
    };
    if (initialFormatParts.length) {
      state = applySheetStyleParts(initialFormatParts, state);
    }
    const styles = [];
    const values = rawGrid.map(row => {
      const styleRow = [];
      const valueRow = row.map(cell => {
        const { value, styleState } = applySheetCellStyle(cell, state);
        state = styleState;
        styleRow.push({ ...state });
        return value;
      });
      styles.push(styleRow);
      return valueRow;
    });
    return { values, styles };
  }

  function sheetCellHasImage(cell, style) {
    const formatted = formatSheetDisplayValue(cell, style);
    return /!\[[^\]]*\]\([^)]+\)/.test(formatted);
  }

  function mergeSheetImageAttrs(inlineAttrs) {
    return String(inlineAttrs || '').trim();
  }

  function renderSheetMarkdownImage(alt, src, attributes) {
    const { width, align } = parseMarkdownImageAttrs(attributes);
    const styles = ['height: auto'];
    if (width) {
      styles.unshift(`width: ${width}`);
      styles.push('max-width: 100%');
    } else {
      styles.unshift('width: 100%', 'max-width: 100%', 'object-fit: contain');
    }
    const img = `<img class="md-image md-image--sheet-cell" src="${src}" alt="${alt}" style="${styles.join('; ')}"${width ? ` data-md-width="${width}"` : ''}>`;
    const tabHref = imageTabHref(src);
    const linkedImg = tabHref
      ? `<a href="${String(tabHref).replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer" class="md-image-link">${img}</a>`
      : img;
    if (align && align !== 'left') {
      return `<figure class="md-image-wrap md-image-wrap--sheet-cell" style="text-align: ${align}; margin: 0;">${linkedImg}</figure>`;
    }
    return `<figure class="md-image-wrap md-image-wrap--sheet-cell" style="margin: 0;">${linkedImg}</figure>`;
  }

  function renderSheetCellContent(cell, style) {
    const formatted = formatSheetDisplayValue(cell, style);
    const imageRegex = /!\[(.*?)\]\((.*?)\)\s*(?:\{(.*?)\})?/g;
    const parts = [];
    let lastIndex = 0;
    let match;
    while ((match = imageRegex.exec(formatted)) !== null) {
      if (match.index > lastIndex) {
        parts.push(escapeHtml(formatted.slice(lastIndex, match.index)));
      }
      parts.push(renderSheetMarkdownImage(
        match[1],
        match[2],
        mergeSheetImageAttrs(match[3]),
      ));
      lastIndex = imageRegex.lastIndex;
    }
    if (!parts.length) return escapeHtml(formatted);
    if (lastIndex < formatted.length) {
      parts.push(escapeHtml(formatted.slice(lastIndex)));
    }
    return parts.join('');
  }

  function formatSheetDisplayValue(cell, style) {
    if (cell === '#ERR!' || cell === '') return cell;
    const trimmed = String(cell).trim();
    const num = Number(trimmed);
    if (trimmed !== '' && !Number.isNaN(num) && Number.isFinite(num)) {
      const fr = style?.frlen ?? 2;
      return Number(num).toFixed(fr);
    }
    return cell;
  }

  function sheetCellStyleAttr(style, options = {}) {
    const parts = [];
    if (style?.align) parts.push(`text-align:${style.align}`);
    if (style?.bold) parts.push('font-weight:bold');
    if (style?.col) parts.push(`color:${style.col}`);
    if (style?.bgCol) parts.push(`background-color:${style.bgCol}`);
    if (style?.fontSize) parts.push(`font-size:${style.fontSize}`);
    if (style?.cellWidth && !options.omitCellWidth) parts.push(`width:${style.cellWidth}`);
    return parts.length ? ` style="${parts.join(';')}"` : '';
  }

  function sheetColumnWidths(cellStyles, colCount) {
    const widths = [];
    for (let c = 0; c < colCount; c++) {
      let w = '';
      for (let r = 0; r < (cellStyles?.length || 0); r++) {
        if (cellStyles[r]?.[c]?.cellWidth) {
          w = cellStyles[r][c].cellWidth;
          break;
        }
      }
      widths.push(w);
    }
    const pctEntries = widths
      .map((w, i) => ({ i, pct: /%$/.test(w) ? parseFloat(w) : NaN }))
      .filter(e => Number.isFinite(e.pct));
    if (!pctEntries.length) return widths;
    const sum = pctEntries.reduce((acc, e) => acc + e.pct, 0);
    if (sum <= 100) return widths;
    const scale = 100 / sum;
    const normalized = [...widths];
    pctEntries.forEach(({ i, pct }) => {
      normalized[i] = `${Math.round(pct * scale * 1000) / 1000}%`;
    });
    return normalized;
  }

  function parseSheetContent(content, fenceAttrs = '') {
    const config = {};
    const dataRows = [];
    const fence = parseSheetFenceAttrs(fenceAttrs);
    Object.assign(config, fence.config);
    const initialFormatParts = [...fence.formatParts];
    content.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (isSheetMetaLine(trimmed)) {
        parseSheetMetaLine(trimmed, config, initialFormatParts);
      } else {
        dataRows.push(trimmed);
      }
    });
    const rawGrid = dataRows.map(row => row.replace(/\t \t/g, '\t&emsp;\t').split('\t').map(c => c.trim()));
    const { values, styles } = buildSheetStyleGrid(rawGrid, config, initialFormatParts);
    const grid = evaluateSheetGrid(values, config, styles);
    return { config, dataRows, grid, rawGrid: values, cellStyles: styles };
  }

  function sheetRelCellValue(out, baseR, baseC, colOff, rowOff) {
    const rr = baseR + parseInt(rowOff, 10);
    const cc = baseC + parseInt(colOff, 10);
    if (!out[rr] || out[rr][cc] === undefined) return 0;
    const val = parseFloat(out[rr][cc]);
    return isNaN(val) ? 0 : val;
  }

  function sheetSumArea(out, baseR, baseC, col1, row1, col2, row2) {
    const absC1 = baseC + parseInt(col1, 10);
    const absR1 = baseR + parseInt(row1, 10);
    const absC2 = baseC + parseInt(col2, 10);
    const absR2 = baseR + parseInt(row2, 10);
    const minCol = Math.min(absC1, absC2);
    const maxCol = Math.max(absC1, absC2);
    const minRow = Math.min(absR1, absR2);
    const maxRow = Math.max(absR1, absR2);
    let total = 0;
    for (let rr = minRow; rr <= maxRow; rr++) {
      for (let cc = minCol; cc <= maxCol; cc++) {
        if (!out[rr] || out[rr][cc] === undefined) continue;
        const val = parseFloat(out[rr][cc]);
        if (!isNaN(val)) total += val;
      }
    }
    return total;
  }

  function evaluateSheetGrid(grid, config, cellStyles) {
    const defaultFrLen = parseInt(config.frLen, 10);
    const frLen = Number.isNaN(defaultFrLen) ? 2 : defaultFrLen;
    const out = grid.map(row => [...row]);
    for (let r = 0; r < out.length; r++) {
      for (let c = 0; c < out[r].length; c++) {
        let cell = out[r][c];
        if (!cell.startsWith('=')) continue;
        try {
          let formula = cell.substring(1);
          if (formula.trim() === 'SUM_ABOVE') {
            let total = 0;
            for (let prevR = 0; prevR < r; prevR++) {
              const val = parseFloat(out[prevR][c]);
              if (!isNaN(val)) total += val;
            }
            const cellFrLen = cellStyles?.[r]?.[c]?.frlen;
            const frac = cellFrLen !== undefined ? cellFrLen : frLen;
            cell = Number(total).toFixed(frac);
          } else {
            const cellFrLen = cellStyles?.[r]?.[c]?.frlen;
            let frac = cellFrLen !== undefined ? cellFrLen : frLen;
            formula = formula.replace(/\.(\d+)$/, (_, digits) => {
              frac = parseInt(digits, 10);
              return '';
            });
            formula = formula.replace(
              /sum\s*\(\s*c\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\]\s*,\s*c\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\]\s*\)/gi,
              (_, col1, row1, col2, row2) => sheetSumArea(out, r, c, col1, row1, col2, row2),
            );
            formula = formula.replace(/c\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\]/g, (_, colOff, rowOff) => {
              return sheetRelCellValue(out, r, c, colOff, rowOff);
            });
            const mathScope = `
              const sqrt = Math.sqrt;
              const sqr = (n) => Math.pow(n, 2);
              const abs = Math.abs;
              const round = Math.round;
              const pow = Math.pow;
              const ln = Math.log;
              const log = Math.log10;
              const PI = Math.PI;
              const E = Math.E;
              const exp = Math.exp;
              const ceil = Math.ceil;
              const floor = Math.floor;
              return ${formula};
            `;
            const result = new Function(mathScope)();
            cell = !isNaN(result) ? Number(result).toFixed(frac) : result;
          }
          out[r][c] = String(cell);
        } catch (e) {
          out[r][c] = '#ERR!';
        }
      }
    }
    return out;
  }

  function sheetHasHeader(config) {
    const h = config.header;
    if (h === '0' || h === 'false' || h === 'no') return false;
    return true;
  }

  function sheetGridToHtml(grid, config, options = {}, cellStyles, rawGrid) {
    const { sheetIndex = 0, editable = false } = options;
    const fontSize = config['font-size'] || 'medium';
    const hasHeader = sheetHasHeader(config) && grid.length > 0;
    const colCount = Math.max(...grid.map(row => row.length), 0);
    const colWidths = sheetColumnWidths(cellStyles, colCount);
    const hasColWidths = colWidths.some(Boolean);
    const fixedCols = hasColWidths;
    const tableClass = `spreadsheet-table${fixedCols ? ' spreadsheet-table--fixed-cols' : ''}`;
    let html = `<table class="${tableClass}" style="font-size:${fontSize}">`;
    if (hasColWidths) {
      html += `<colgroup>${colWidths.map(w => (
        w ? `<col style="width:${w}">` : '<col>'
      )).join('')}</colgroup>`;
    }
    const cellStyleOpts = { omitCellWidth: hasColWidths };

    const renderCell = (cell, tag, row, col) => {
      const style = cellStyles?.[row]?.[col] || {};
      const styleAttr = sheetCellStyleAttr(style, cellStyleOpts);
      const isErr = cell === '#ERR!';
      const isImage = !isErr && sheetCellHasImage(cell, style);
      const display = isErr ? '#ERR!' : renderSheetCellContent(cell, style);
      if (editable && !isErr && !isImage) {
        const errClass = isErr ? ' sheet-cell-err' : '';
        const rawCell = String(rawGrid?.[row]?.[col] ?? '').trim();
        const formulaAttr = rawCell.startsWith('=')
          ? ` data-sheet-formula="${escapeHtml(rawCell)}"`
          : '';
        return `<${tag} contenteditable="plaintext-only" class="sheet-cell-editable${errClass}" data-sheet-index="${sheetIndex}" data-row="${row}" data-col="${col}" spellcheck="false" tabindex="0"${formulaAttr}${styleAttr}>${display}</${tag}>`;
      }
      if (isImage) {
        return `<${tag} class="sheet-cell-image"${styleAttr}>${display}</${tag}>`;
      }
      if (isErr) return `<${tag} class="sheet-cell-err"${styleAttr}>${display}</${tag}>`;
      return `<${tag}${styleAttr}>${display}</${tag}>`;
    };

    if (hasHeader) {
      html += '<thead><tr>';
      grid[0].forEach((cell, col) => { html += renderCell(cell, 'th', 0, col); });
      html += '</tr></thead><tbody>';
      grid.slice(1).forEach((row, ri) => {
        html += '<tr>';
        row.forEach((cell, col) => { html += renderCell(cell, 'td', ri + 1, col); });
        html += '</tr>';
      });
      html += '</tbody>';
    } else {
      html += '<tbody>';
      grid.forEach((row, ri) => {
        html += '<tr>';
        row.forEach((cell, col) => { html += renderCell(cell, 'td', ri, col); });
        html += '</tr>';
      });
      html += '</tbody>';
    }

    html += '</table>';
    return html;
  }

  function serializeSheetContent(parsed) {
    const lines = [];
    const configKeys = Object.keys(parsed.config || {});
    if (configKeys.length) {
      lines.push('`' + configKeys.map(k => `${k}=${parsed.config[k]}`).join(';') + '`');
    }
    (parsed.dataRows || []).forEach(row => lines.push(row));
    return lines.join('\n');
  }

  function updateSheetCellInMarkdown(markdown, sheetIndex, row, col, newValue) {
    let idx = 0;
    return markdown.replace(SHEET_BLOCK_RE, (match, fenceAttrs, content) => {
      if (idx++ !== sheetIndex) return match;
      const parsed = parseSheetContent(content, fenceAttrs);
      if (!parsed.dataRows[row]) return match;
      const cols = parsed.dataRows[row].split('\t');
      while (cols.length <= col) cols.push('');
      cols[col] = String(newValue).replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
      parsed.dataRows[row] = cols.join('\t');
      return `\`\`\`sheet${sheetFenceSuffix(fenceAttrs)}\n${serializeSheetContent(parsed)}\n\`\`\`\n`;
    });
  }

  function collectMarkdownTextLineIndexes(raw) {
    const lines = raw.split('\n');
    const indexes = [];
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (/^```/.test(trimmed)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      if (!trimmed) continue;
      indexes.push(i);
    }
    return indexes;
  }

  function collectPanelLineMaps(raw) {
    const panels = [];
    const re = /```panel(?:\s+\w+)?\s*\n([\s\S]*?)```/gi;
    let match;
    while ((match = re.exec(raw))) {
      const openingLine = raw.slice(0, match.index).split('\n').length - 1;
      const contentLines = match[2].split('\n');
      const lineMap = [];
      let start = 0;

      if (contentLines[0]?.match(/^title:\s*/i) || contentLines[0]?.match(/^#\s+/)) {
        lineMap.push(openingLine + 1);
        start = 1;
      }

      for (let i = start; i < contentLines.length; i++) {
        if (!contentLines[i].trim()) continue;
        lineMap.push(openingLine + 1 + i);
      }
      panels.push(lineMap);
    }
    return panels;
  }

  function isPreviewRichBlock(el) {
    return !!el?.closest?.('.sheet-preview-block, .chart-block, .page-tags');
  }

  function getPreviewBlockSourceLine(node) {
    const preview = document.getElementById('preview-content');
    if (!preview || !node) return null;
    let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    while (el && el !== preview) {
      if (isPreviewRichBlock(el)) return null;
      if (el.dataset?.sourceLine !== undefined) {
        const n = parseInt(el.dataset.sourceLine, 10);
        if (Number.isFinite(n)) return n;
      }
      el = el.parentElement;
    }
    return previewContextLine;
  }

  function applyIndentAtLine(cm, line, outdent = false) {
    if (!cm || line < 0 || line >= cm.lineCount()) return;
    cm.setCursor({ line, ch: 0 });
    cm.execCommand(outdent ? 'indentLess' : 'indentMore');
  }

  function indentPreviewText(outdent = false) {
    const cm = getEditorCm();
    const line = previewContextLine;
    if (!cm || line === null) return false;
    applyIndentAtLine(cm, line, outdent);
    scheduleSave();
    schedulePreviewRefresh();
    return true;
  }

  function setPreviewContextFromEvent(e) {
    if (!isEditing) return;
    if (e.target.closest?.('.sheet-cell-editable, a, button, input, select, textarea, .chart-settings')) return;
    const line = getPreviewBlockSourceLine(e.target);
    if (line !== null) previewContextLine = line;
  }

  function getActiveSheetCell() {
    const active = document.activeElement;
    if (active?.classList?.contains('sheet-cell-editable')) return active;
    const preview = document.getElementById('preview-content');
    if (!preview) return null;
    return preview.querySelector('.sheet-cell-editable:focus');
  }

  function indentSheetCell(cell) {
    if (!cell) return;
    cell.focus();
    if (!document.execCommand('insertText', false, '  ')) {
      cell.textContent = `  ${cell.textContent}`;
    }
  }

  function outdentSheetCell(cell) {
    if (!cell) return;
    cell.focus();
    const text = cell.textContent;
    if (text.startsWith('  ')) {
      cell.textContent = text.slice(2);
      return;
    }
    if (text.startsWith('\t')) {
      cell.textContent = text.slice(1);
      return;
    }
    if (text.startsWith(' ')) {
      cell.textContent = text.slice(1);
      return;
    }
    const sel = window.getSelection();
    if (!sel?.rangeCount || !cell.contains(sel.anchorNode)) return;
    const range = sel.getRangeAt(0);
    if (!range.collapsed || range.startOffset < 1) return;
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return;
    const before = node.textContent.slice(0, range.startOffset);
    if (before.endsWith('  ')) {
      range.setStart(node, range.startOffset - 2);
      range.deleteContents();
    } else if (before.endsWith(' ') || before.endsWith('\t')) {
      range.setStart(node, range.startOffset - 1);
      range.deleteContents();
    }
  }

  function syncSheetCellToMarkdown(cell, { skipRender = false } = {}) {
    if (!easyMDE || !isEditing || !cell?.dataset) return false;
    const sheetIndex = parseInt(cell.dataset.sheetIndex, 10);
    const row = parseInt(cell.dataset.row, 10);
    const col = parseInt(cell.dataset.col, 10);
    if ([sheetIndex, row, col].some(n => Number.isNaN(n))) return false;
    const newValue = cell.textContent.replace(/\r?\n/g, ' ').replace(/\t/g, ' ');
    const oldMarkdown = easyMDE.value();
    const updated = updateSheetCellInMarkdown(oldMarkdown, sheetIndex, row, col, newValue);
    if (updated === oldMarkdown) return false;
    easyMDE.value(updated);
    scheduleSave();
    if (!skipRender) renderPreview();
    return true;
  }

  function editorIndent() {
    const cell = getActiveSheetCell();
    if (cell && isEditing) {
      indentSheetCell(cell);
      syncSheetCellToMarkdown(cell, { skipRender: true });
      return;
    }

    const cm = getEditorCm();
    if (!cm) return;

    if (isEditing && !cm.hasFocus()) {
      const line = previewContextLine ?? getPreviewBlockSourceLine(document.getSelection()?.anchorNode);
      if (line !== null) {
        previewContextLine = line;
        indentPreviewText(false);
        return;
      }
    }

    cm.focus();
    cm.execCommand('indentMore');
    scheduleSave();
    schedulePreviewRefresh();
  }

  function editorOutdent() {
    const cell = getActiveSheetCell();
    if (cell && isEditing) {
      outdentSheetCell(cell);
      syncSheetCellToMarkdown(cell, { skipRender: true });
      return;
    }

    const cm = getEditorCm();
    if (!cm) return;

    if (isEditing && !cm.hasFocus()) {
      const line = previewContextLine ?? getPreviewBlockSourceLine(document.getSelection()?.anchorNode);
      if (line !== null) {
        previewContextLine = line;
        indentPreviewText(true);
        return;
      }
    }

    cm.focus();
    cm.execCommand('indentLess');
    scheduleSave();
    schedulePreviewRefresh();
  }

  function commitSheetCellEdit(cell) {
    syncSheetCellToMarkdown(cell);
  }

  function initSheetCellEditors() {
    const preview = document.getElementById('preview-content');
    if (!preview || preview.dataset.sheetEditBound === '1') return;
    preview.dataset.sheetEditBound = '1';

    preview.addEventListener('mousedown', e => {
      if (!isEditing) return;
      setPreviewContextFromEvent(e);
      if (!e.target.closest?.('.sheet-cell-editable, a, button, input, select, textarea')) {
        preview.focus({ preventScroll: true });
      }
    }, true);

    preview.addEventListener('focusin', e => {
      const cell = e.target.closest?.('.sheet-cell-editable');
      if (cell && preview.contains(cell) && isEditing) {
        const formula = cell.dataset.sheetFormula;
        if (formula) cell.textContent = formula;
        return;
      }
      setPreviewContextFromEvent(e);
    }, true);

    preview.addEventListener('blur', e => {
      const cell = e.target.closest?.('.sheet-cell-editable');
      if (cell && preview.contains(cell)) commitSheetCellEdit(cell);
    }, true);

    preview.addEventListener('keydown', e => {
      if (!isEditing) return;
      const cell = e.target.closest?.('.sheet-cell-editable');
      if (cell && preview.contains(cell)) {
        if (e.key === 'Enter') {
          e.preventDefault();
          cell.blur();
          return;
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          if (e.shiftKey) outdentSheetCell(cell);
          else indentSheetCell(cell);
          syncSheetCellToMarkdown(cell, { skipRender: true });
        }
        return;
      }
      if (e.key === 'Tab') {
        const line = getPreviewBlockSourceLine(e.target);
        if (line === null) return;
        e.preventDefault();
        previewContextLine = line;
        indentPreviewText(e.shiftKey);
      }
    }, true);
  }

  function buildSheetRegistry(markdown) {
    const registry = new Map();
    let autoIdx = 0;
    markdown.replace(SHEET_BLOCK_RE, (_, fenceAttrs, content) => {
      const parsed = parseSheetContent(content, fenceAttrs);
      const id = (parsed.config.id || parsed.config.sheet || `sheet-${autoIdx++}`).trim();
      parsed.id = id;
      registry.set(id, parsed);
      return _;
    });
    return registry;
  }

  function wrapRichPreviewBlock(html) {
    return `\n\n${html}\n\n`;
  }

  function parseSheetBlocks(plainText, options = {}) {
    let sheetIndex = 0;
    return plainText.replace(SHEET_BLOCK_RE, (_, fenceAttrs, content) => {
      const parsed = parseSheetContent(content, fenceAttrs);
      const idx = sheetIndex++;
      const id = parsed.config.id || parsed.config.sheet || '';
      const title = id
        ? `<div class="sheet-block-meta">Sheet: <strong>${escapeHtml(id)}</strong></div>`
        : '';
      const sheetHtml = sheetGridToHtml(parsed.grid, parsed.config, {
        sheetIndex: idx,
        editable: !!options.sheetEditable,
      }, parsed.cellStyles, parsed.rawGrid);
      return wrapRichPreviewBlock(
        `<div class="sheet-preview-block" data-sheet-index="${idx}">${title}${sheetHtml}</div>`,
      );
    });
  }

  function resolveColumnIndex(headers, key, fallback) {
    if (key === undefined || key === null || key === '') return fallback;
    const asNum = parseInt(key, 10);
    if (!Number.isNaN(asNum)) return asNum;
    const idx = headers.findIndex(h => String(h).toLowerCase() === String(key).toLowerCase());
    return idx >= 0 ? idx : fallback;
  }

  function parseChartYKeys(config, plain) {
    if (config.y !== undefined && config.y !== null && config.y !== '') {
      return String(config.y).split(',').map(s => s.trim()).filter(Boolean);
    }
    const fromLines = plain.slice(3).map(s => s.trim()).filter(Boolean);
    if (fromLines.length) return fromLines;
    return ['1'];
  }

  function chartDataFromSheet(sheet, xKey, yKeys) {
    const grid = sheet.grid || [];
    if (!grid.length) return { labels: [], series: [], points: [] };
    const hasHeader = sheetHasHeader(sheet.config) && grid.length > 0;
    const headers = hasHeader ? grid[0] : grid[0].map((_, i) => String(i));
    const start = hasHeader ? 1 : 0;
    const useIndex = xKey === 'index' || xKey === '__index__';
    const xIdx = useIndex ? 0 : resolveColumnIndex(headers, xKey, 0);
    const yList = Array.isArray(yKeys) ? yKeys : [yKeys];

    const rows = grid.slice(start).map((row, ri) => ({
      label: useIndex ? String(ri + 1) : String(row[xIdx] ?? ''),
      values: yList.map((yKey, si) => {
        const yIdx = resolveColumnIndex(headers, yKey, si + 1);
        return parseFloat(row[yIdx]) || 0;
      }),
    })).filter(r => useIndex || r.label !== '');

    const series = yList.map((yKey, si) => ({
      key: yKey,
      name: String(headers[resolveColumnIndex(headers, yKey, si + 1)] ?? yKey),
      values: rows.map(r => r.values[si]),
    }));

    return {
      labels: rows.map(r => r.label),
      series,
      points: rows.map(r => ({ label: r.label, value: r.values[0] ?? 0 })),
      xAxisLabel: useIndex ? 'Index' : String(headers[xIdx] ?? xKey),
    };
  }

  function chartDataFromSheetDual(sheet, xKey, leftYKeys, rightYKeys) {
    const leftKeys = Array.isArray(leftYKeys) ? leftYKeys : [leftYKeys].filter(Boolean);
    const rightKeys = Array.isArray(rightYKeys) ? rightYKeys : [rightYKeys].filter(Boolean);
    const leftOnly = leftKeys.filter(k => !rightKeys.includes(k));
    const rightOnly = rightKeys.filter(k => !leftKeys.includes(k));
    const left = leftOnly.length ? chartDataFromSheet(sheet, xKey, leftOnly) : null;
    const right = rightOnly.length ? chartDataFromSheet(sheet, xKey, rightOnly) : null;
    const labels = left?.labels?.length ? left.labels : (right?.labels ?? []);
    return {
      labels,
      leftSeries: left?.series ?? [],
      rightSeries: right?.series ?? [],
      series: [...(left?.series ?? []), ...(right?.series ?? [])],
      points: left?.points?.length ? left.points : (right?.points ?? []),
      xAxisLabel: left?.xAxisLabel ?? right?.xAxisLabel ?? 'X',
    };
  }

  function splitChartSeries(chartData, options = {}) {
    const leftSeries = options.leftSeries ?? chartData.leftSeries ?? chartData.series ?? [];
    const rightSeries = options.rightSeries ?? chartData.rightSeries ?? [];
    const labels = chartData.labels ?? [];
    const allSeries = [...leftSeries, ...rightSeries];
    return {
      labels,
      leftSeries,
      rightSeries,
      allSeries,
      hasRight: rightSeries.length > 0,
    };
  }

  function chartPlotMargin(xScaleMode, hasRight) {
    return {
      top: 20,
      right: hasRight ? 52 : 16,
      bottom: xScaleMode === 'flat' ? 64 : 52,
      left: 52,
    };
  }

  function appendChartYAxes(g, innerW, yLeft, yRight) {
    if (yLeft) g.append('g').call(d3.axisLeft(yLeft));
    if (yRight) {
      g.append('g').attr('transform', `translate(${innerW},0)`).call(d3.axisRight(yRight));
    }
  }

  function drawLineSeries(g, container, labels, series, xAt, y, color, yScaleMode, xLabel, showPoints) {
    if (!series.length) return;
    const line = d3.line().x((_, i) => xAt(i)).y(d => y(chartYValue(d, yScaleMode)));
    series.forEach(s => {
      g.append('path')
        .datum(s.values)
        .attr('fill', 'none')
        .attr('stroke', color(s.name))
        .attr('stroke-width', 2)
        .attr('d', line);
    });
    if (showPoints) {
      drawScatterPoints(
        g, container, labels, series,
        (_label, i) => xAt(i),
        y, color, yScaleMode, { xLabel },
      );
    }
  }

  function drawBarSeries(g, container, labels, series, x0, y, color, yScaleMode, xLabel, showPoints) {
    if (!series.length) return;
    if (series.length === 1) {
      const x = x0;
      const s0 = series[0];
      const bars = g.selectAll('.chart-bar-left').data(labels.map((label, i) => ({
        label,
        name: s0.name,
        value: s0.values[i],
      }))).join('rect')
        .attr('class', 'chart-bar chart-bar-left')
        .attr('x', d => x(d.label))
        .attr('y', d => chartBarRect(d.value, y, yScaleMode).y)
        .attr('width', x.bandwidth())
        .attr('height', d => chartBarRect(d.value, y, yScaleMode).height)
        .attr('fill', color(s0.name));
      bindBarTooltips(container, bars, d => chartTooltipText(d, { xLabel }));
      if (showPoints) {
        drawScatterPoints(
          g, container, labels, series,
          label => x(label) + x.bandwidth() / 2,
          y, color, yScaleMode, { xLabel },
        );
      }
      return;
    }
    const x1 = d3.scaleBand().domain(series.map(s => s.name)).range([0, x0.bandwidth()]).padding(0.08);
    const bars = g.selectAll('.bar-group-left')
      .data(labels)
      .join('g')
      .attr('class', 'bar-group-left')
      .attr('transform', label => `translate(${x0(label)},0)`)
      .selectAll('rect')
      .data((label, li) => series.map(s => ({ name: s.name, label, value: s.values[li] })))
      .join('rect')
      .attr('class', 'chart-bar')
      .attr('x', d => x1(d.name))
      .attr('y', d => chartBarRect(d.value, y, yScaleMode).y)
      .attr('width', x1.bandwidth())
      .attr('height', d => chartBarRect(d.value, y, yScaleMode).height)
      .attr('fill', d => color(d.name));
    bindBarTooltips(container, bars, d => chartTooltipText(d, { xLabel }));
    if (showPoints) {
      drawScatterPoints(
        g, container, labels, series,
        (label, _i, name) => x0(label) + x1(name) + x1.bandwidth() / 2,
        y, color, yScaleMode, { xLabel },
      );
    }
  }

  function parseChartSpec(content) {
    const config = {};
    const plain = [];
    content.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (trimmed.startsWith('`')) {
        Object.assign(config, parseBacktickConfig(trimmed));
      } else {
        plain.push(trimmed);
      }
    });
    return {
      sheetId: (config.sheet || config.id || plain[0] || '').trim(),
      type: (config.type || plain[1] || 'bar').toLowerCase(),
      x: config.x ?? plain[2] ?? '0',
      y: parseChartYKeys(config, plain),
    };
  }

  function parseChartBlocks(text, registry) {
    return text.replace(/```chart\s*([\s\S]*?)\s*```/gi, (_, content) => {
      const spec = parseChartSpec(content);
      const sheet = registry.get(spec.sheetId);
      if (!sheet) {
        const sid = spec.sheetId || '(missing id)';
        return wrapRichPreviewBlock(
          `<div class="chart-block chart-error">Chart: sheet <strong>${escapeHtml(sid)}</strong> not found. Add a <code>\`\`\`sheet</code> block with <code>\`id=${escapeHtml(sid)}</code>.</div>`,
        );
      }
      const chartData = chartDataFromSheet(sheet, spec.x, spec.y);
      const payload = {
        sheetId: spec.sheetId,
        type: ['bar', 'line', 'pie', 'scatter'].includes(spec.type) ? spec.type : 'bar',
        labels: chartData.labels,
        series: chartData.series,
        points: chartData.points,
        x: spec.x,
        y: spec.y,
      };
      return wrapRichPreviewBlock(
        `<div class="chart-block" data-chart="${encodeURIComponent(JSON.stringify(payload))}"></div>`,
      );
    });
  }

  const PANEL_TYPES = ['info', 'success', 'warning', 'danger', 'note'];
  const PANEL_TYPE_LABELS = {
    info: 'Info',
    success: 'Success',
    warning: 'Warning',
    danger: 'Danger',
    note: 'Note',
  };

  function parsePanelBlockContent(typeRaw, content) {
    const type = PANEL_TYPES.includes(String(typeRaw || '').toLowerCase())
      ? String(typeRaw).toLowerCase()
      : 'info';
    let body = String(content || '').trim();
    let title = PANEL_TYPE_LABELS[type];
    const lines = body.split('\n');
    if (lines[0]?.match(/^title:\s*(.+)/i)) {
      title = lines.shift().replace(/^title:\s*/i, '').trim();
      body = lines.join('\n').trim();
    } else if (lines[0]?.match(/^#\s+(.+)/)) {
      title = lines[0].replace(/^#\s+/, '').trim();
      body = lines.slice(1).join('\n').trim();
    }
    const innerHtml = body ? marked.parse(body) : '';
    return `<div class="md-panel md-panel--${type}"><div class="md-panel-title">${escapeHtml(title)}</div><div class="md-panel-body">${innerHtml}</div></div>`;
  }

  function parsePanelBlocks(text) {
    return text.replace(/```panel(?:\s+(\w+))?\s*\n([\s\S]*?)```/gi, (_, typeRaw, content) => (
      wrapRichPreviewBlock(parsePanelBlockContent(typeRaw, content))
    ));
  }

  function buildPanelFence(type, title, body) {
    const panelType = PANEL_TYPES.includes(type) ? type : 'info';
    const lines = [];
    if (title?.trim()) lines.push(`# ${title.trim()}`);
    if (body?.trim()) lines.push(body.trim());
    return `\n\`\`\`panel ${panelType}\n${lines.join('\n')}\n\`\`\`\n`;
  }

  function appendChartLegend(container, series, colorScale) {
    const legend = document.createElement('div');
    legend.className = 'chart-block-legend';
    series.forEach(s => {
      const item = document.createElement('span');
      item.className = 'chart-legend-item';
      item.innerHTML = `<span class="chart-legend-swatch" style="background:${colorScale(s.name)}"></span>${escapeHtml(s.name)}`;
      legend.appendChild(item);
    });
    container.appendChild(legend);
  }

  function formatChartValue(value) {
    if (!Number.isFinite(value)) return '—';
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
  }

  function ensureChartTooltip(container) {
    let tip = container.querySelector('.chart-tooltip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'chart-tooltip';
      tip.setAttribute('role', 'tooltip');
      container.appendChild(tip);
    }
    return tip;
  }

  function moveChartTooltip(event, tip, container) {
    const bounds = container.getBoundingClientRect();
    const gap = 12;
    let left = event.clientX - bounds.left + gap;
    const top = event.clientY - bounds.top - 10;

    tip.style.top = `${top}px`;
    tip.style.left = `${left}px`;

    const tipW = tip.offsetWidth;
    if (left + tipW > bounds.width) {
      left = event.clientX - bounds.left - tipW - gap;
    }
    if (left < 0) left = 0;
    if (left + tipW > bounds.width) left = Math.max(0, bounds.width - tipW);

    tip.style.left = `${left}px`;
  }

  function bindPointTooltips(container, points, textFn) {
    const tip = ensureChartTooltip(container);
    points
      .on('mouseenter', function (event, d) {
        tip.textContent = textFn(d);
        tip.classList.add('visible');
        moveChartTooltip(event, tip, container);
      })
      .on('mousemove', event => moveChartTooltip(event, tip, container))
      .on('mouseleave', () => tip.classList.remove('visible'));
  }

  function chartYFloor(yScaleMode) {
    return yScaleMode === 'log' ? 1e-6 : null;
  }

  function chartYValue(value, yScaleMode) {
    if (yScaleMode === 'log') return Math.max(chartYFloor(yScaleMode), value);
    return value;
  }

  function chartBarBaseY(y, yScaleMode) {
    return yScaleMode === 'log' ? y.range()[0] : y(0);
  }

  function chartBarRect(value, y, yScaleMode) {
    const v = chartYValue(value, yScaleMode);
    const base = chartBarBaseY(y, yScaleMode);
    const tip = y(v);
    return {
      y: Math.min(base, tip),
      height: Math.max(0, Math.abs(base - tip)),
    };
  }

  function resolveChartAxisLabel(key, columns = []) {
    if (key === 'index' || key === '__index__') return 'Index';
    const raw = String(key ?? '');
    const asNum = parseInt(raw, 10);
    if (!Number.isNaN(asNum) && columns[asNum] !== undefined) return columns[asNum];
    if (columns.includes(raw)) return raw;
    return raw || 'X';
  }

  function chartTooltipText(d, { xLabel = 'X', yLabel } = {}) {
    const yName = yLabel || d.name || 'Y';
    return `${xLabel}: ${d.label} · ${yName}: ${formatChartValue(d.value)}`;
  }

  function drawScatterPoints(g, container, labels, series, xPos, y, color, yScaleMode, axisLabels) {
    series.forEach((s, si) => {
      const pointData = s.values.map((value, i) => ({
        label: labels[i],
        name: s.name,
        value,
      }));
      const dots = g.selectAll(`.chart-scatter-dot-${si}`)
        .data(pointData)
        .join('circle')
        .attr('class', `chart-scatter-dot-${si} chart-point`)
        .attr('cx', (_, i) => xPos(labels[i], i, s.name))
        .attr('cy', d => y(chartYValue(d.value, yScaleMode)))
        .attr('r', 5)
        .attr('fill', '#fff')
        .attr('stroke', color(s.name))
        .attr('stroke-width', 2);
      bindPointTooltips(container, dots, d => chartTooltipText(d, axisLabels));
    });
  }

  function bindBarTooltips(container, rects, textFn) {
    const tip = ensureChartTooltip(container);
    rects
      .attr('class', 'chart-bar')
      .on('mouseenter', function (event, d) {
        tip.textContent = textFn(d);
        tip.classList.add('visible');
        moveChartTooltip(event, tip, container);
      })
      .on('mousemove', event => moveChartTooltip(event, tip, container))
      .on('mouseleave', () => tip.classList.remove('visible'));
  }

  function buildYScale(mode, values, innerH) {
    const nums = values.filter(v => Number.isFinite(v));
    const max = d3.max(nums);
    const min = d3.min(nums);
    const hi = max ?? 1;
    const lo = min ?? 0;
    if (mode === 'log') {
      const positives = nums.filter(v => v > 0);
      const posMin = d3.min(positives) || 1;
      const posMax = d3.max(positives) || posMin * 10;
      return d3.scaleLog().domain([Math.max(posMin, 1e-6), Math.max(posMax, posMin * 10)]).nice().range([innerH, 0]);
    }
    if (mode === 'tight') {
      if (lo === hi) {
        const pad = lo === 0 ? 1 : Math.abs(lo) * 0.1 || 1;
        return d3.scaleLinear().domain([lo - pad, hi + pad]).nice().range([innerH, 0]);
      }
      return d3.scaleLinear().domain([lo, hi]).nice().range([innerH, 0]);
    }
    const domainLo = lo < 0 ? lo : 0;
    const domainHi = hi > 0 ? hi : 0;
    if (domainLo === domainHi) {
      return d3.scaleLinear().domain([0, 1]).nice().range([innerH, 0]);
    }
    return d3.scaleLinear().domain([domainLo, domainHi]).nice().range([innerH, 0]);
  }

  function styleXAxisLabels(selection, xScale) {
    selection.selectAll('text')
      .attr('transform', xScale === 'flat' ? null : `rotate(${xScale === 'compact' ? -45 : -24})`)
      .style('text-anchor', xScale === 'flat' ? 'middle' : 'end')
      .attr('font-size', xScale === 'compact' ? '10px' : '11px');
  }

  function renderBarChart(container, chartData, width, height, options = {}) {
    const { labels, leftSeries, rightSeries, allSeries, hasRight } = splitChartSeries(chartData, options);
    if (!labels.length || !allSeries.length) return;

    const xScaleMode = options.xScale || 'normal';
    const yScaleMode = options.yScale || 'auto';
    const margin = chartPlotMargin(xScaleMode, hasRight);
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    const svg = d3.select(container).append('svg').attr('width', width).attr('height', height);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    const color = d3.scaleOrdinal(d3.schemeTableau10).domain(allSeries.map(s => s.name));
    const bandPadding = xScaleMode === 'compact' ? 0.08 : (leftSeries.length > 1 ? 0.15 : 0.2);
    const x0 = d3.scaleBand().domain(labels).range([0, innerW]).padding(bandPadding);
    const xLabel = options.axisLabels?.x || 'X';
    const showPoints = !!options.showPoints;

    const yLeft = leftSeries.length
      ? buildYScale(yScaleMode, leftSeries.flatMap(s => s.values), innerH)
      : null;
    const yRight = hasRight
      ? buildYScale(yScaleMode, rightSeries.flatMap(s => s.values), innerH)
      : null;

    if (leftSeries.length && yLeft) {
      drawBarSeries(g, container, labels, leftSeries, x0, yLeft, color, yScaleMode, xLabel, showPoints);
    }
    if (rightSeries.length && yRight) {
      drawLineSeries(
        g, container, labels, rightSeries,
        i => x0(labels[i]) + x0.bandwidth() / 2,
        yRight, color, yScaleMode, xLabel, showPoints,
      );
    }

    if (allSeries.length > 1) appendChartLegend(container, allSeries, color);

    styleXAxisLabels(
      g.append('g').attr('transform', `translate(0,${innerH})`).call(d3.axisBottom(x0)),
      xScaleMode,
    );
    appendChartYAxes(g, innerW, yLeft, yRight);
  }

  function renderLineChart(container, chartData, width, height, options = {}) {
    const { labels, leftSeries, rightSeries, allSeries, hasRight } = splitChartSeries(chartData, options);
    if (!labels.length || !allSeries.length) return;

    const xScaleMode = options.xScale || 'normal';
    const yScaleMode = options.yScale || 'auto';
    const margin = chartPlotMargin(xScaleMode, hasRight);
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    const svg = d3.select(container).append('svg').attr('width', width).attr('height', height);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    const color = d3.scaleOrdinal(d3.schemeTableau10).domain(allSeries.map(s => s.name));
    const xPadding = xScaleMode === 'compact' ? 0.2 : 0.5;
    const x = d3.scalePoint().domain(labels).range([0, innerW]).padding(xPadding);
    const xLabel = options.axisLabels?.x || 'X';
    const showPoints = !!options.showPoints;

    const yLeft = leftSeries.length
      ? buildYScale(yScaleMode, leftSeries.flatMap(s => s.values), innerH)
      : null;
    const yRight = hasRight
      ? buildYScale(yScaleMode, rightSeries.flatMap(s => s.values), innerH)
      : null;

    if (leftSeries.length && yLeft) {
      drawLineSeries(g, container, labels, leftSeries, i => x(labels[i]), yLeft, color, yScaleMode, xLabel, showPoints);
    }
    if (rightSeries.length && yRight) {
      drawLineSeries(g, container, labels, rightSeries, i => x(labels[i]), yRight, color, yScaleMode, xLabel, showPoints);
    }

    if (allSeries.length > 1) appendChartLegend(container, allSeries, color);

    styleXAxisLabels(
      g.append('g').attr('transform', `translate(0,${innerH})`).call(d3.axisBottom(x)),
      xScaleMode,
    );
    appendChartYAxes(g, innerW, yLeft, yRight);
  }

  function renderScatterChart(container, chartData, width, height, options = {}) {
    const { labels, leftSeries, rightSeries, allSeries, hasRight } = splitChartSeries(chartData, options);
    if (!labels.length || !allSeries.length) return;

    const xScaleMode = options.xScale || 'normal';
    const yScaleMode = options.yScale || 'auto';
    const margin = chartPlotMargin(xScaleMode, hasRight);
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    const svg = d3.select(container).append('svg').attr('width', width).attr('height', height);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    const color = d3.scaleOrdinal(d3.schemeTableau10).domain(allSeries.map(s => s.name));
    const xPadding = xScaleMode === 'compact' ? 0.2 : 0.5;
    const x = d3.scalePoint().domain(labels).range([0, innerW]).padding(xPadding);
    const xLabel = options.axisLabels?.x || 'X';

    const yLeft = leftSeries.length
      ? buildYScale(yScaleMode, leftSeries.flatMap(s => s.values), innerH)
      : null;
    const yRight = hasRight
      ? buildYScale(yScaleMode, rightSeries.flatMap(s => s.values), innerH)
      : null;

    if (leftSeries.length && yLeft) {
      drawScatterPoints(g, container, labels, leftSeries, label => x(label), yLeft, color, yScaleMode, { xLabel });
    }
    if (rightSeries.length && yRight) {
      drawScatterPoints(g, container, labels, rightSeries, label => x(label), yRight, color, yScaleMode, { xLabel });
    }

    if (allSeries.length > 1) appendChartLegend(container, allSeries, color);

    styleXAxisLabels(
      g.append('g').attr('transform', `translate(0,${innerH})`).call(d3.axisBottom(x)),
      xScaleMode,
    );
    appendChartYAxes(g, innerW, yLeft, yRight);
  }

  function renderPieChart(container, points, width, height, options = {}) {
    const xLabel = options.axisLabels?.x || 'X';
    const yLabel = options.axisLabels?.y || 'Y';
    const radius = Math.min(width, height) / 2 - 24;
    const svg = d3.select(container).append('svg').attr('width', width).attr('height', height);
    const g = svg.append('g').attr('transform', `translate(${width / 2},${height / 2})`);
    const color = d3.scaleOrdinal(d3.schemeTableau10);
    const pie = d3.pie().value(d => d.value).sort(null);
    const arc = d3.arc().innerRadius(0).outerRadius(radius);
    const slices = g.selectAll('path').data(pie(points)).join('path')
      .attr('class', 'chart-pie-slice')
      .attr('d', arc)
      .attr('fill', (_, i) => color(i));
    bindPointTooltips(container, slices, d => chartTooltipText(
      { label: d.data.label, value: d.data.value },
      { xLabel, yLabel },
    ));
    g.selectAll('text').data(pie(points)).join('text')
      .attr('transform', d => `translate(${arc.centroid(d)})`)
      .attr('text-anchor', 'middle')
      .attr('font-size', '11px')
      .text(d => (d.data.value / d3.sum(points, p => p.value) > 0.06 ? d.data.label : ''));
  }

  const CHART_MODES = ['bar', 'line', 'scatter', 'pie'];

  function renderChartModeButtons(container, selected) {
    if (!container) return;
    const mode = CHART_MODES.includes(selected) ? selected : 'bar';
    container.innerHTML = CHART_MODES.map(m => {
      const label = m.charAt(0).toUpperCase() + m.slice(1);
      const active = m === mode ? ' active' : '';
      return `<button type="button" class="btn btn-outline-primary chart-axis-btn${active}" data-value="${m}">${label}</button>`;
    }).join('');
  }

  function renderChartToggleButtons(container, enabled) {
    if (!container) return;
    container.innerHTML = ['Off', 'On'].map((label, i) => {
      const active = (enabled ? 1 : 0) === i ? ' active' : '';
      return `<button type="button" class="btn btn-outline-primary chart-axis-btn${active}" data-value="${i}">${label}</button>`;
    }).join('');
  }

  function chartSettingsStorageKey(chartIndex) {
    return `${currentPageId || 0}:${chartIndex}`;
  }

  function getStoredChartSettings(chartIndex) {
    return chartSettingsCache[chartSettingsStorageKey(chartIndex)] || null;
  }

  function filterChartColumnSelection(selected, columns) {
    if (!Array.isArray(selected)) return [];
    const allowed = new Set(['index', ...columns]);
    return selected.filter(col => allowed.has(String(col)));
  }

  function resolveStoredChartX(stored, columns, fallback) {
    const raw = stored?.x;
    if (raw === 'index') return 'index';
    if (raw && columns.includes(String(raw))) return String(raw);
    return fallback;
  }

  function scheduleChartSettingsSave(chartIndex, settings) {
    const key = chartSettingsStorageKey(chartIndex);
    chartSettingsCache[key] = settings;
    clearTimeout(chartSettingsSaveTimer);
    chartSettingsSaveTimer = setTimeout(() => {
      updateUserSettings({
        extra_configs: {
          chart_settings: { [key]: settings },
        },
      });
    }, 400);
  }

  function resolveChartXSelection(spec, columns) {
    const raw = spec.x ?? '0';
    if (raw === 'index' || raw === '__index__') return 'index';
    const asNum = parseInt(raw, 10);
    if (!Number.isNaN(asNum) && columns[asNum] !== undefined) return columns[asNum];
    if (columns.includes(String(raw))) return String(raw);
    return columns[0] ?? 'index';
  }

  function resolveChartYSelection(spec, columns) {
    const keys = Array.isArray(spec.y) ? spec.y.map(String) : [String(spec.y ?? '1')];
    const resolved = keys.map(key => {
      const asNum = parseInt(key, 10);
      if (!Number.isNaN(asNum) && columns[asNum] !== undefined) return columns[asNum];
      if (columns.includes(key)) return key;
      return null;
    }).filter(Boolean);
    if (resolved.length) return resolved;
    return columns.length > 1 ? [columns[1]] : [columns[0]].filter(Boolean);
  }

  function renderD3Charts(root, sheetRegistry) {
    if (typeof d3 === 'undefined' || !root) return;
    root.querySelectorAll('.chart-block[data-chart]').forEach((el, chartIndex) => {
      let spec;
      try {
        spec = JSON.parse(decodeURIComponent(el.getAttribute('data-chart')));
      } catch (e) {
        el.classList.add('chart-error');
        el.textContent = 'Invalid chart data';
        return;
      }
      if (!spec.labels?.length || !spec.series?.length) {
        el.classList.add('chart-error');
        el.textContent = 'No chart data (check sheet id, x, and y columns)';
        return;
      }
      el.innerHTML = '';
      const header = document.createElement('div');
      header.className = 'chart-block-header';

      const title = document.createElement('div');
      title.className = 'chart-block-title';

      const settingsBtn = document.createElement('button');
      settingsBtn.type = 'button';
      settingsBtn.className = 'chart-block-settings btn btn-sm btn-outline-secondary';
      settingsBtn.title = 'Chart settings';
      settingsBtn.setAttribute('aria-label', 'Chart settings');
      settingsBtn.setAttribute('aria-expanded', 'false');
      settingsBtn.innerHTML = '<span class="chart-settings-icon" aria-hidden="true">⚙</span>';

      header.append(title, settingsBtn);
      el.appendChild(header);

      const sheet = sheetRegistry?.get(spec.sheetId);
      const columns = sheet ? getSheetColumnLabels(sheet) : [];
      const stored = getStoredChartSettings(chartIndex);
      const xDefault = resolveStoredChartX(stored, columns, resolveChartXSelection(spec, columns));
      const yDefault = (() => {
        const fromStore = filterChartColumnSelection(stored?.yLeft, columns);
        return fromStore.length ? fromStore : resolveChartYSelection(spec, columns);
      })();
      const yRightDefault = filterChartColumnSelection(stored?.yRight, columns);
      let chartMode = stored?.mode && CHART_MODES.includes(stored.mode)
        ? stored.mode
        : (CHART_MODES.includes(spec.type) ? spec.type : 'bar');
      let showPoints = !!stored?.showPoints;

      const toolbar = document.createElement('div');
      toolbar.className = 'chart-block-toolbar d-none';

      const modeGroup = document.createElement('div');
      modeGroup.className = 'chart-block-axis-group';
      modeGroup.innerHTML = '<div class="chart-block-axis-label">Chart mode</div>';
      const modeButtons = document.createElement('div');
      modeButtons.className = 'chart-axis-buttons chart-block-axis-buttons';
      modeGroup.appendChild(modeButtons);

      const pointsGroup = document.createElement('div');
      pointsGroup.className = 'chart-block-axis-group';
      pointsGroup.innerHTML = '<div class="chart-block-axis-label">Data points</div>';
      const pointsButtons = document.createElement('div');
      pointsButtons.className = 'chart-axis-buttons chart-block-axis-buttons';
      pointsGroup.appendChild(pointsButtons);

      const xGroup = document.createElement('div');
      xGroup.className = 'chart-block-axis-group';
      xGroup.innerHTML = '<div class="chart-block-axis-label">Bottom axis (X)</div>';
      const xButtons = document.createElement('div');
      xButtons.className = 'chart-axis-buttons chart-block-axis-buttons';
      xGroup.appendChild(xButtons);

      const yGroup = document.createElement('div');
      yGroup.className = 'chart-block-axis-group';
      yGroup.innerHTML = '<div class="chart-block-axis-label">Left axis (Y)</div>';
      const yButtons = document.createElement('div');
      yButtons.className = 'chart-axis-buttons chart-block-axis-buttons';
      yGroup.appendChild(yButtons);

      const yRightGroup = document.createElement('div');
      yRightGroup.className = 'chart-block-axis-group';
      yRightGroup.innerHTML = '<div class="chart-block-axis-label">Right axis (Y)</div>';
      const yRightButtons = document.createElement('div');
      yRightButtons.className = 'chart-axis-buttons chart-block-axis-buttons';
      yRightGroup.appendChild(yRightButtons);

      toolbar.append(modeGroup, pointsGroup, xGroup, yGroup, yRightGroup);

      const canvas = document.createElement('div');
      canvas.className = 'chart-block-canvas';
      el.appendChild(toolbar);
      el.appendChild(canvas);

      function persistChartSettings() {
        scheduleChartSettingsSave(chartIndex, {
          mode: chartMode,
          showPoints,
          x: getChartAxisValues(xButtons)[0] || xDefault,
          yLeft: getChartAxisValues(yButtons),
          yRight: getChartAxisValues(yRightButtons),
          toolbarOpen: !toolbar.classList.contains('d-none'),
        });
      }

      function syncChartTitle() {
        title.textContent = `${chartMode} chart · sheet: ${spec.sheetId}`;
      }

      function syncModeUi() {
        syncChartTitle();
        if (chartMode === 'pie') {
          xGroup.classList.add('d-none');
          yRightGroup.classList.add('d-none');
        } else {
          if (sheet && columns.length) xGroup.classList.remove('d-none');
          yRightGroup.classList.remove('d-none');
        }
        if (chartMode === 'bar' || chartMode === 'line') pointsGroup.classList.remove('d-none');
        else pointsGroup.classList.add('d-none');
      }

      settingsBtn.addEventListener('click', () => {
        const hidden = toolbar.classList.toggle('d-none');
        settingsBtn.classList.toggle('active', !hidden);
        settingsBtn.setAttribute('aria-expanded', hidden ? 'false' : 'true');
        persistChartSettings();
      });

      renderChartModeButtons(modeButtons, chartMode);
      bindChartAxisButtons(modeButtons, false);
      modeButtons.addEventListener('click', () => {
        const next = getChartAxisValues(modeButtons)[0];
        if (next && CHART_MODES.includes(next)) chartMode = next;
        syncModeUi();
        drawChart();
        persistChartSettings();
      });

      renderChartToggleButtons(pointsButtons, showPoints);
      bindChartAxisButtons(pointsButtons, false);
      pointsButtons.addEventListener('click', () => {
        showPoints = getChartAxisValues(pointsButtons)[0] === '1';
        drawChart();
        persistChartSettings();
      });

      const width = Math.max(320, el.clientWidth || 480);
      const height = 280;

      function currentChartData() {
        if (!sheet) {
          return {
            labels: spec.labels,
            leftSeries: spec.series,
            rightSeries: [],
            series: spec.series,
            points: spec.points,
            xAxisLabel: resolveChartAxisLabel(spec.x, columns),
          };
        }
        const leftKeys = getChartAxisValues(yButtons);
        const rightKeys = getChartAxisValues(yRightButtons);
        if (!leftKeys.length && !rightKeys.length) {
          return { labels: [], leftSeries: [], rightSeries: [], series: [], points: [] };
        }
        const xKey = getChartAxisValues(xButtons)[0] || 'index';
        return chartDataFromSheetDual(sheet, xKey, leftKeys, rightKeys);
      }

      function chartRenderOptions(chartData) {
        const xLabel = chartData.xAxisLabel
          || resolveChartAxisLabel(getChartAxisValues(xButtons)[0] || spec.x || 'index', columns);
        const yLabel = chartData.leftSeries?.[0]?.name
          || chartData.rightSeries?.[0]?.name
          || resolveChartAxisLabel(
            (Array.isArray(spec.y) ? spec.y[0] : spec.y) ?? '1',
            columns,
          );
        return {
          axisLabels: { x: xLabel, y: yLabel },
          showPoints: showPoints && (chartMode === 'bar' || chartMode === 'line'),
          leftSeries: chartData.leftSeries,
          rightSeries: chartData.rightSeries,
        };
      }

      function drawChart() {
        canvas.innerHTML = '';
        const chartData = currentChartData();
        const seriesCount = (chartData.leftSeries?.length ?? 0) + (chartData.rightSeries?.length ?? 0);
        if (!chartData.labels?.length || !seriesCount) {
          canvas.textContent = 'Select at least one Y column on the left or right axis';
          return;
        }
        const opts = chartRenderOptions(chartData);
        if (chartMode === 'pie') renderPieChart(canvas, chartData.points, width, height, opts);
        else if (chartMode === 'scatter') renderScatterChart(canvas, chartData, width, height, opts);
        else if (chartMode === 'line') renderLineChart(canvas, chartData, width, height, opts);
        else renderBarChart(canvas, chartData, width, height, opts);
      }

      if (sheet && columns.length) {
        renderChartAxisButtons(xButtons, ['index', ...columns], xDefault, false);
        renderChartAxisButtons(yButtons, columns, yDefault, true);
        renderChartAxisButtons(yRightButtons, columns, yRightDefault, true);
        bindChartAxisButtons(xButtons, false);
        bindChartAxisButtons(yButtons, true);
        bindChartAxisButtons(yRightButtons, true);
        xButtons.addEventListener('click', () => { drawChart(); persistChartSettings(); });
        yButtons.addEventListener('click', () => { drawChart(); persistChartSettings(); });
        yRightButtons.addEventListener('click', () => { drawChart(); persistChartSettings(); });
      } else {
        xGroup.classList.add('d-none');
        yGroup.classList.add('d-none');
        yRightGroup.classList.add('d-none');
      }
      if (stored?.toolbarOpen) {
        toolbar.classList.remove('d-none');
        settingsBtn.classList.add('active');
        settingsBtn.setAttribute('aria-expanded', 'true');
      }
      syncModeUi();
      drawChart();
    });
  }

  function replaceSheetBlocksDiv(markdown) {
    return markdown.replace(/\[sheet:([^\]]+)\]/gi, (_, name) => {
      const clean = (name || '').trim();
      return `
<div class="sheet-block">
  <div class="sheet-block-title">Sheet</div>
  <div class="sheet-block-name">${clean}</div>
</div>`;
    });
  }

  function convertSheetToMd(text) {
    // Regex sucht nach Inhalten zwischen ```sheet und ``` (global, über Zeilen hinweg)
    return text.replace(SHEET_BLOCK_RE, (match, fenceAttrs, content) => {
      const lines = content.trim().split('\n');
      if (lines.length === 0) return "";

      // 1. Spalten bei jedem Tabulator (\t) trennen und in Pipes (|) einbetten
      const mdRows = lines.map(line => `| ${line.split('\t').join(' | ')} |`);

      // 2. Trennlinie basierend auf der Spaltenanzahl der ersten Zeile erstellen
      const colCount = lines[0].split('\t').length;
      const separator = `| ${Array(colCount).fill('---').join(' | ')} |`;

      // 3. Trennlinie direkt nach dem Header einfügen
      mdRows.splice(1, 0, separator);

      return mdRows.join('\n').toString();
    });
  }

function formatTextWithMarkup(rawText) {
    // 1. Text an den Zeilenumbrüchen in ein Array aus einzelnen Zeilen aufteilen
    const lines = rawText.split('\n');
    
    // 2. Jede Zeile einzeln verarbeiten
    const processedLines = lines.map((line, index) => {
        const trimmedLine = line.trim();
      
        // Prüfen, ob die Zeile mit '#' beginnt (Markdown-Überschrift)
        if (trimmedLine.startsWith('#')) {
            // Zeile bleibt wie sie ist (wird nicht mit <br> am Ende versehen)
            return line; 
        } else {

            return line + (index < lines.length - 1 ? '<br>' : '');
        }
    });
    
    // 3. Alle Zeilen wieder zu einem einzigen String zusammenfügen
    return processedLines.join('\n');
}

  function encodePathSegments(normalizedSlashes) {
    return normalizedSlashes.split('/').map((seg, idx) => {
      if (seg === '') return seg;
      if (idx === 0 && /^[A-Za-z]:$/.test(seg)) return seg;
      return encodeURIComponent(seg);
    }).join('/');
  }

  function linkifyFileUrls(md) {
    md = md.replace(/\[([^\]]*)\]\(\s*<([^>]+)>\s*\)/g, (match, label, rawUrl) => {
      const trimmed = rawUrl.trim();
      if (!/^file:/i.test(trimmed) && !/^[A-Za-z]:|^\\\\/.test(trimmed)) return match;
      return `[${label}](${normalizeLocalFileHref(trimmed)})`;
    });
    md = md.replace(/\[([^\]]*)\]\(\s*"([^"]+)"\s*\)/g, (_, label, rawPath) => (
      `[${label}](${normalizeLocalFileHref(rawPath)})`
    ));
    md = md.replace(/\[([^\]]*)\]\(\s*'([^']+)'\s*\)/g, (_, label, rawPath) => (
      `[${label}](${normalizeLocalFileHref(rawPath)})`
    ));
    md = md.replace(/\[([^\]]*)\]\(\s*(file:\/\/[^)]+?)\s*\)/gi, (_, label, rawUrl) => (
      `[${label}](${normalizeLocalFileHref(rawUrl.trim())})`
    ));
    md = md.replace(/\[([^\]]*)\]\(\s*((?:[A-Za-z]:|\\\\)[^)]*?)\s*\)/g, (_, label, rawPath) => (
      `[${label}](${normalizeLocalFileHref(rawPath.trim())})`
    ));
    return md;
  }

  function normalizeLocalFileHref(href) {
    const trimmed = String(href || '').trim().replace(/^["']|["']$/g, '');
    if (!trimmed) return '';
    if (/^file:/i.test(trimmed)) {
      if (/\s/.test(trimmed) && !/%20/i.test(trimmed)) {
        const raw = trimmed.replace(/^file:\/\/\/?/i, '');
        return displayPathToFileUrl(raw.includes('\\') ? raw : raw.replace(/\//g, '\\'));
      }
      // file://C:/... (two slashes) — normalize to file:///C:/...
      return trimmed.replace(/^file:\/\/([A-Za-z]:)/i, 'file:///$1');
    }
    return displayPathToFileUrl(trimmed);
  }

  function displayPathToFileUrl(path) {
    const trimmed = String(path || '').trim().replace(/^["']|["']$/g, '');
    if (!trimmed) return '';
    if (/^file:/i.test(trimmed)) return normalizeLocalFileHref(trimmed);
    if (trimmed.startsWith('\\\\')) {
      const unc = trimmed.replace(/^\\\\/, '').replace(/\\/g, '/');
      const encoded = encodePathSegments(unc);
      return `file://${encoded.startsWith('//') ? encoded : `//${encoded}`}`;
    }
    const normalized = trimmed.replace(/\\/g, '/');
    if (/^[A-Za-z]:/.test(normalized)) return `file:///${encodePathSegments(normalized)}`;
    if (normalized.startsWith('//')) return `file:${encodePathSegments(normalized)}`;
    return `file:///${encodePathSegments(normalized.replace(/^\/+/, ''))}`;
  }

  function isLocalPathText(text) {
    const t = String(text || '').trim().replace(/^["']|["']$/g, '');
    return /^file:/i.test(t)
      || /^[A-Za-z]:[\\/]/.test(t)
      || /^\\\\[^\\]+\\/.test(t);
  }

  function fileUrlToDisplayPath(href) {
    const normalized = normalizeLocalFileHref(href);
    try {
      const url = new URL(normalized);
      let netloc = url.hostname || '';
      let pathname = decodeURIComponent(url.pathname || '');
      // file://C:/Users/... — drive letter in hostname
      if (/^[A-Za-z]$/.test(netloc)) {
        return `${netloc.toUpperCase()}:${pathname.replace(/\//g, '\\')}`.replace(/^:[\\/]/, ':');
      }
      if (/^\/[A-Za-z]:/.test(pathname)) pathname = pathname.slice(1);
      return pathname.replace(/\//g, '\\');
    } catch (_) {
      try {
        let raw = normalized.replace(/^file:\/\/\/?/i, '');
        raw = decodeURIComponent(raw.replace(/\+/g, '%20'));
        if (/^\/[A-Za-z]:/.test(raw)) raw = raw.slice(1);
        return raw.replace(/\//g, '\\');
      } catch (_) {
        return href;
      }
    }
  }

  function fileUrlToTitle(href, fallback) {
    const path = fileUrlToDisplayPath(href);
    return path.split(/[/\\]/).pop() || fallback || 'Local file';
  }

  let fileLinkModal = null;
  let fileLinkDialogContext = null;

  function showDashboardModal(modalEl) {
    if (!modalEl) return null;
    hideEditorColorPicker();
    if (!window.bootstrap?.Modal) {
      showToast('Dialog could not open (Bootstrap not loaded).', 'danger');
      return null;
    }
    return bootstrap.Modal.getOrCreateInstance(modalEl);
  }

  function openDashboardModal(modalEl) {
    const modal = showDashboardModal(modalEl);
    if (!modal) return null;
    modal.show();
    return modal;
  }

  function isManagedFileHref(href) {
    if (!href) return false;
    if (/^file:/i.test(href)) return true;
    let path = href;
    try {
      if (/^https?:\/\//i.test(path)) path = new URL(path).pathname;
    } catch (_) { /* keep path */ }
    if (appBase && path.startsWith(appBase + '/')) path = path.slice(appBase.length);
    return /(^|\/)media\//i.test(path);
  }

  function resolveFileHrefAbsolute(href) {
    if (!href) return '';
    if (/^https?:\/\//i.test(href) || /^file:/i.test(href)) return href;
    const normalized = href.startsWith('/') ? href : `/${href}`;
    return `${window.location.origin}${normalized}`;
  }

  function openManagedFileDirect(href) {
    const absoluteUrl = resolveFileHrefAbsolute(href);
    if (absoluteUrl && !/^file:/i.test(absoluteUrl)) {
      window.open(absoluteUrl, '_blank', 'noopener,noreferrer');
    }
  }

  async function openLocalFileInExplorer(href) {
    if (window.APP_BOOT?.localFileOpenEnabled === false) {
      throw new Error(
        'Local file open is disabled on this server. Run Django on your PC with LOCAL_FILE_OPEN_ENABLED=true.'
      );
    }
    const raw = String(href || '').trim();
    const fileUrl = /^file:/i.test(raw)
      ? normalizeLocalFileHref(raw)
      : displayPathToFileUrl(raw);
    if (!fileUrl) throw new Error('Invalid path');
    const displayPath = /^file:/i.test(fileUrl)
      ? fileUrlToDisplayPath(fileUrl)
      : raw;
    await api('api/local-files/open/', 'POST', {
      path: fileUrl,
      display_path: displayPath,
    });
  }

  function resolveFileLinkOpenTarget() {
    const ctx = fileLinkDialogContext;
    const pathInput = document.getElementById('file-link-modal-path');
    const urlInput = document.getElementById('file-link-modal-url');
    const pathVal = pathInput?.value?.trim() || '';
    const urlVal = urlInput?.value?.trim() || '';

    if (/^file:/i.test(urlVal)) return normalizeLocalFileHref(urlVal);
    if (ctx?.href && /^file:/i.test(ctx.href)) return normalizeLocalFileHref(ctx.href);
    if (pathVal) return displayPathToFileUrl(pathVal);
    if (ctx?.href) return ctx.href;
    return '';
  }

  function updateFileLinkOpenButton() {
    const openBtn = document.getElementById('file-link-open-btn');
    if (!openBtn) return;

    const target = resolveFileLinkOpenTarget();
    const ctx = fileLinkDialogContext;
    const urlVal = document.getElementById('file-link-modal-url')?.value?.trim() || '';

    if (/^file:/i.test(target)) {
      openBtn.classList.remove('d-none');
      openBtn.textContent = 'Open in Explorer';
      return;
    }
    if (!ctx?.editPath && (urlVal || ctx?.href)) {
      openBtn.classList.remove('d-none');
      openBtn.textContent = 'Open file';
      return;
    }
    openBtn.classList.add('d-none');
  }

  function imageTabHref(src) {
    if (!src || /^file:/i.test(src)) return null;
    const absolute = resolveFileHrefAbsolute(src);
    return absolute && !/^file:/i.test(absolute) ? absolute : null;
  }

  function wrapImageWithTabLink(img) {
    if (!img || img.closest('a[href]')) return;
    const href = imageTabHref(img.currentSrc || img.getAttribute('src'));
    if (!href) return;
    const link = document.createElement('a');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'md-image-link';
    img.parentNode.insertBefore(link, img);
    link.appendChild(img);
  }

  function displayPathFromHref(href) {
    if (/^file:/i.test(href)) return fileUrlToDisplayPath(href);
    return mediaMarkdownPath(href);
  }

  function isImageFileHref(href) {
    return /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/i.test(String(href).split(/[?#]/)[0]);
  }

  function insertMarkdownFileLink(href, label) {
    if (!easyMDE) return;
    const url = /^file:/i.test(href) ? href : mediaMarkdownPath(href);
    const text = (label || '').trim() || url.split('/').pop() || fileUrlToTitle(url, 'File');
    easyMDE.codemirror.replaceSelection(`[${text}](${url})\n`);
    easyMDE.codemirror.focus();
    scheduleSave();
    schedulePreviewRefresh();
  }

  function insertLocalFileLink(hrefOrPath, label) {
    if (!easyMDE) return;
    const fileUrl = /^file:/i.test(hrefOrPath) ? hrefOrPath : displayPathToFileUrl(hrefOrPath);
    if (!fileUrl || fileUrl === 'file:///') return;
    const text = (label || '').trim() || fileUrlToTitle(fileUrl, 'File');
    easyMDE.codemirror.replaceSelection(`[${text}](${fileUrl})\n`);
    easyMDE.codemirror.focus();
    scheduleSave();
    schedulePreviewRefresh();
  }

  function ensureEditingForInsert() {
    if (!isEditing && userCanEdit) setEditing(true);
  }

  function openLocalFileLinkInsertDialog(prefillPath = '') {
    ensureEditingForInsert();
    const href = prefillPath
      ? (/^file:/i.test(prefillPath) ? prefillPath : displayPathToFileUrl(prefillPath))
      : '';
    requestAnimationFrame(() => {
      openFileLinkDialog(href, '', { allowInsert: true, editPath: true });
    });
  }

  function openFileLinkDialog(href, label, options = {}) {
    const modalEl = document.getElementById('file-link-modal');
    const pathInput = document.getElementById('file-link-modal-path');
    const urlInput = document.getElementById('file-link-modal-url');
    const titleEl = document.getElementById('file-link-modal-title');
    const hintEl = document.getElementById('file-link-modal-hint');
    const pathLabel = document.getElementById('file-link-modal-path-label');
    const insertRow = document.getElementById('file-link-insert-row');
    const labelInput = document.getElementById('file-link-modal-label');
    const insertBtn = document.getElementById('file-link-insert-btn');
    const openBtn = document.getElementById('file-link-open-btn');
    const copyPathBtn = document.getElementById('file-link-copy-path-btn');
    const browseBtn = document.getElementById('file-link-browse-btn');
    if (!modalEl || !pathInput || !urlInput) return;

    const isLocalFile = /^file:/i.test(href);
    const allowInsert = Boolean(options.allowInsert) && userCanEdit;
    const editPath = Boolean(options.editPath);
    const displayPath = editPath
      ? (href ? fileUrlToDisplayPath(href) : '')
      : displayPathFromHref(href);
    const absoluteUrl = href ? resolveFileHrefAbsolute(href) : '';

    fileLinkDialogContext = { href, label, allowInsert, editPath };

    if (titleEl) {
      titleEl.textContent = editPath
        ? 'Insert local file link'
        : (label?.trim() || fileUrlToTitle(href, 'File'));
    }
    pathInput.value = displayPath;
    pathInput.readOnly = !editPath;
    pathInput.placeholder = editPath ? 'C:\\Users\\you\\Documents\\file.pdf' : '';
    urlInput.value = absoluteUrl;

    if (hintEl) {
      hintEl.textContent = editPath
        ? 'Paste a path from Explorer (Shift+Right click → Copy as path) or type it manually. Browsers cannot open file:// links directly from the web app.'
        : (isLocalFile
          ? 'Click opens the file in Explorer / Finder. You can also copy the path below.'
          : 'Uploaded media file. Open in a new tab or copy the URL/path for use in markdown.');
    }
    if (pathLabel) {
      pathLabel.textContent = editPath || isLocalFile ? 'File path' : 'Media path';
    }
    if (copyPathBtn) {
      copyPathBtn.textContent = isLocalFile || editPath ? 'Copy path' : 'Copy media path';
      copyPathBtn.classList.toggle('d-none', editPath && !displayPath);
    }
    if (insertRow) insertRow.classList.toggle('d-none', !allowInsert);
    if (labelInput) {
      labelInput.value = label?.trim() || (displayPath ? displayPath.split(/[/\\]/).pop() : '') || 'File';
      if (editPath) delete labelInput.dataset.userEdited;
    }
    if (insertBtn) insertBtn.classList.toggle('d-none', !allowInsert);
    if (browseBtn) browseBtn.classList.toggle('d-none', !editPath);
    updateFileLinkOpenButton();

    fileLinkModal = openDashboardModal(modalEl);
    if (!fileLinkModal) return;
    if (editPath) {
      setTimeout(() => pathInput.focus(), 180);
    }
  }

  function syncFileLinkDialogPreview() {
    const ctx = fileLinkDialogContext;
    const pathInput = document.getElementById('file-link-modal-path');
    const urlInput = document.getElementById('file-link-modal-url');
    const labelInput = document.getElementById('file-link-modal-label');
    if (!ctx?.editPath || !pathInput || !urlInput) return;
    const fileUrl = displayPathToFileUrl(pathInput.value);
    urlInput.value = fileUrl || '';
    if (labelInput && !labelInput.dataset.userEdited) {
      const fallback = pathInput.value.split(/[/\\]/).pop();
      if (fallback) labelInput.value = fallback;
    }
    updateFileLinkOpenButton();
  }

  async function copyTextToClipboard(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }

  function markFileLinks(root) {
    if (!root) return;
    root.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href');
      if (!isManagedFileHref(href)) return;
      if (/^file:/i.test(href)) {
        a.classList.add('file-link-app');
        a.removeAttribute('target');
        a.removeAttribute('rel');
        return;
      }
      a.classList.remove('file-link-app');
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    });
  }

  function onFileLinkClick(e) {
    const link = e.target.closest('a.file-link-app[href]');
    if (!link || !link.closest('#preview-content, #markdown-wrap, .editor-preview-side, .editor-preview')) return;
    const href = link.getAttribute('href');
    if (!href) return;
    if (!/^file:/i.test(href)) return;
    e.preventDefault();
    e.stopPropagation();
    const fileUrl = normalizeLocalFileHref(href);
    openLocalFileInExplorer(fileUrl)
      .then(() => showToast('Opened in file manager.', 'success', 2000))
      .catch((err) => {
        openFileLinkDialog(href, link.textContent);
        showToast(err.message || 'Could not open in file manager.', 'warning', 3500);
      });
  }

  function initFileLinkDialog() {
    document.getElementById('preview-content')?.addEventListener('click', onFileLinkClick);
    document.getElementById('markdown-wrap')?.addEventListener('click', onFileLinkClick);
    document.getElementById('file-link-modal-path')?.addEventListener('input', syncFileLinkDialogPreview);
    document.getElementById('file-link-modal-path')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && fileLinkDialogContext?.editPath) {
        e.preventDefault();
        document.getElementById('file-link-insert-btn')?.click();
      }
    });
    document.getElementById('file-link-modal-label')?.addEventListener('input', (e) => {
      if (e.target) e.target.dataset.userEdited = '1';
    });
    document.getElementById('file-link-insert-btn')?.addEventListener('click', () => {
      const ctx = fileLinkDialogContext;
      const label = document.getElementById('file-link-modal-label')?.value;
      const pathVal = document.getElementById('file-link-modal-path')?.value;
      if (!easyMDE) {
        showToast('Editor is not ready.', 'warning', 2500);
        return;
      }
      if (ctx?.editPath) {
        if (!pathVal?.trim()) {
          showToast('Enter a file path.', 'warning', 2500);
          return;
        }
        insertLocalFileLink(pathVal, label);
      } else if (ctx?.href) {
        if (/^file:/i.test(ctx.href)) insertLocalFileLink(ctx.href, label || ctx.label);
        else insertMarkdownFileLink(ctx.href, label || ctx.label);
      } else {
        return;
      }
      fileLinkModal?.hide();
      showToast('Link inserted.', 'success', 2000);
    });
    document.getElementById('file-link-browse-btn')?.addEventListener('click', () => {
      document.getElementById('file-link-modal-picker')?.click();
    });
    document.getElementById('file-link-modal-picker')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const labelInput = document.getElementById('file-link-modal-label');
      if (labelInput && !labelInput.dataset.userEdited) {
        labelInput.value = file.name;
      }
      showToast('Paste the full path — browsers do not expose local file paths.', 'info', 4000);
      e.target.value = '';
    });
    document.getElementById('insert-local-file-link-btn')?.addEventListener('click', () => {
      openLocalFileLinkInsertDialog();
    });
    document.getElementById('local-file-link-picker')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      openLocalFileLinkInsertDialog('');
      const labelInput = document.getElementById('file-link-modal-label');
      if (labelInput) {
        labelInput.value = file.name;
        delete labelInput.dataset.userEdited;
      }
      showToast('Paste the full path — browsers do not expose local file paths.', 'info', 4000);
      e.target.value = '';
    });
    document.getElementById('file-link-open-btn')?.addEventListener('click', async () => {
      const target = resolveFileLinkOpenTarget();
      const url = document.getElementById('file-link-modal-url')?.value?.trim() || '';
      if (/^file:/i.test(target)) {
        try {
          await openLocalFileInExplorer(target);
          showToast('Opened in file manager.', 'success', 2000);
          fileLinkModal?.hide();
        } catch (err) {
          showToast(err.message || 'Could not open in file manager.', 'warning', 3500);
        }
        return;
      }
      const mediaUrl = url || fileLinkDialogContext?.href || '';
      if (!mediaUrl || /^file:/i.test(mediaUrl)) return;
      window.open(resolveFileHrefAbsolute(mediaUrl), '_blank', 'noopener,noreferrer');
    });
    document.getElementById('file-link-copy-path-btn')?.addEventListener('click', async () => {
      const path = document.getElementById('file-link-modal-path')?.value;
      if (!path) return;
      try {
        await copyTextToClipboard(path);
        showToast('Path copied.', 'success', 2500);
      } catch (_) {
        showToast('Could not copy path.', 'danger');
      }
    });
    document.getElementById('file-link-copy-url-btn')?.addEventListener('click', async () => {
      const url = document.getElementById('file-link-modal-url')?.value;
      if (!url) return;
      try {
        await copyTextToClipboard(url);
        showToast('File URL copied.', 'success', 2500);
      } catch (_) {
        showToast('Could not copy URL.', 'danger');
      }
    });
  }

  function onPreviewImageClick(e) {
    const img = e.target.closest('img');
    if (!img || !img.closest('#preview-content, .editor-preview-side, .editor-preview, #chat-messages')) return;
    if (img.closest('.d3-chart-wrap')) return;
    if (img.closest('a[href][target="_blank"]')) return;
    const src = img.currentSrc || img.getAttribute('src');
    if (!src) return;
    e.preventDefault();
    e.stopPropagation();
    const absoluteSrc = resolveFileHrefAbsolute(src);
    if (absoluteSrc) openManagedFileDirect(absoluteSrc);
  }

  function initPreviewImageClicks() {
    document.getElementById('preview-content')?.addEventListener('click', onPreviewImageClick);
    document.getElementById('markdown-wrap')?.addEventListener('click', onPreviewImageClick);
    document.getElementById('chat-messages')?.addEventListener('click', onPreviewImageClick);
  }

  function replaceRichBlocksWithPlaceholders(markdown) {
    let md = markdown;
    md = md.replace(SHEET_BLOCK_RE, (_, fenceAttrs, content) => {
      const parsed = parseSheetContent(content, fenceAttrs);
      const id = (parsed.config.id || parsed.config.sheet || '').trim();
      const label = id ? `Sheet: ${id}` : 'Sheet';
      return `\n\n---\n*${label} — open full preview to view*\n---\n\n`;
    });
    md = md.replace(/```chart\s*([\s\S]*?)\s*```/gi, (_, content) => {
      const spec = parseChartSpec(content);
      const id = (spec.sheetId || '').trim();
      const type = spec.type || 'bar';
      const label = id ? `${type} chart · ${id}` : `${type} chart`;
      return `\n\n---\n*${label} — open full preview to view*\n---\n\n`;
    });
    md = md.replace(/```panel(?:\s+(\w+))?\s*\n([\s\S]*?)```/gi, (_, typeRaw) => {
      const type = PANEL_TYPES.includes(String(typeRaw || '').toLowerCase())
        ? String(typeRaw).toLowerCase()
        : 'info';
      return `\n\n---\n*${PANEL_TYPE_LABELS[type]} panel — open full preview to view*\n---\n\n`;
    });
    return md;
  }

  function preprocessMarkdown(markdown, options = {}) {
    let md = markdown;
    const tags = extractTags(md);
    md = stripInlineTagMarkers(md);
    const richBlocks = options.richBlocks !== false;
    md = linkifyFileUrls(md);
    if (richBlocks) {
      const sheetRegistry = buildSheetRegistry(md);
      md = parseSheetBlocks(md, options);
      md = parseChartBlocks(md, sheetRegistry);
      md = parsePanelBlocks(md);
    } else {
      md = replaceRichBlocksWithPlaceholders(md);
    }
    md = parseMarkdownImages(md);
    return { markdown: md, tagsHtml: buildTagsHtml(tags) };
  }

  function renderMarkdownPreviewHtml(markdown, options = {}) {
    const processed = preprocessMarkdown(markdown, options);
    return marked.parse(processed.markdown) + processed.tagsHtml;
  }

  function isEditorPreviewSplit() {
    return isEditing && document.querySelector('.editor-wrap')?.classList.contains('editor-wrap--split');
  }

  function elementScrollTop(container, el) {
    const cr = container.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    return er.top - cr.top + container.scrollTop;
  }

  function annotatePreviewSourceLines(raw, preview) {
    const mdLines = collectMarkdownTextLineIndexes(raw);
    const blocks = [...preview.querySelectorAll(
      'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre',
    )].filter(el => !el.closest('.md-panel') && !isPreviewRichBlock(el));

    blocks.forEach((el, idx) => {
      if (mdLines[idx] === undefined) return;
      el.dataset.sourceLine = String(mdLines[idx]);
      el.classList.add('preview-source-block');
    });

    const panelLineMaps = collectPanelLineMaps(raw);
    preview.querySelectorAll('.md-panel').forEach((panel, panelIdx) => {
      const lineMap = panelLineMaps[panelIdx] || [];
      let mapIdx = 0;

      const title = panel.querySelector('.md-panel-title');
      if (title && lineMap[mapIdx] !== undefined) {
        title.dataset.sourceLine = String(lineMap[mapIdx]);
        title.classList.add('preview-source-block');
        mapIdx += 1;
      }

      panel.querySelectorAll(
        '.md-panel-body h1, .md-panel-body h2, .md-panel-body h3, .md-panel-body h4, .md-panel-body h5, .md-panel-body h6, .md-panel-body p, .md-panel-body li, .md-panel-body blockquote, .md-panel-body pre',
      ).forEach(el => {
        if (lineMap[mapIdx] === undefined) return;
        el.dataset.sourceLine = String(lineMap[mapIdx]);
        el.classList.add('preview-source-block');
        mapIdx += 1;
      });
    });
  }

  function rebuildPreviewScrollAnchors() {
    const preview = document.getElementById('preview-content');
    const cm = easyMDE?.codemirror;
    if (!preview || !cm) {
      previewScrollAnchors = [];
      return;
    }

    const maxLine = Math.max(0, cm.lineCount() - 1);
    const maxScroll = Math.max(0, preview.scrollHeight - preview.clientHeight);
    const anchors = [{ line: 0, top: 0 }];

    preview.querySelectorAll('[data-source-line]').forEach(el => {
      const line = parseInt(el.dataset.sourceLine, 10);
      if (!Number.isFinite(line)) return;
      anchors.push({ line, top: elementScrollTop(preview, el) });
    });

    anchors.push({ line: maxLine, top: maxScroll });
    anchors.sort((a, b) => a.line - b.line || a.top - b.top);

    const deduped = [];
    for (const a of anchors) {
      if (!deduped.length || deduped[deduped.length - 1].line !== a.line) deduped.push(a);
    }
    previewScrollAnchors = deduped;
  }

  function interpolateScrollAnchors(keyIn, keyOut, value) {
    const anchors = previewScrollAnchors;
    if (!anchors.length) return 0;
    if (value <= anchors[0][keyIn]) return anchors[0][keyOut];
    const last = anchors[anchors.length - 1];
    if (value >= last[keyIn]) return last[keyOut];

    for (let i = 0; i < anchors.length - 1; i += 1) {
      const a = anchors[i];
      const b = anchors[i + 1];
      if (value >= a[keyIn] && value <= b[keyIn]) {
        const span = b[keyIn] - a[keyIn];
        const t = span === 0 ? 0 : (value - a[keyIn]) / span;
        return a[keyOut] + t * (b[keyOut] - a[keyOut]);
      }
    }
    return last[keyOut];
  }

  function getEditorTopLine() {
    const cm = easyMDE?.codemirror;
    if (!cm) return 0;
    return cm.lineAtHeight(cm.getScrollInfo().top + 1, 'local');
  }

  function syncPreviewScrollFromEditor() {
    if (!isEditorPreviewSplit() || editorPreviewScrollLock) return;
    const preview = document.getElementById('preview-content');
    const cm = easyMDE?.codemirror;
    if (!preview || !cm || !previewScrollAnchors.length) return;

    editorPreviewScrollLock = true;
    const line = getEditorTopLine();
    preview.scrollTop = interpolateScrollAnchors('line', 'top', line);
    requestAnimationFrame(() => { editorPreviewScrollLock = false; });
  }

  function syncEditorScrollFromPreview() {
    if (!isEditorPreviewSplit() || editorPreviewScrollLock) return;
    const preview = document.getElementById('preview-content');
    const cm = easyMDE?.codemirror;
    if (!preview || !cm || !previewScrollAnchors.length) return;

    editorPreviewScrollLock = true;
    const line = interpolateScrollAnchors('top', 'line', preview.scrollTop);
    cm.scrollTo(null, cm.heightAtLine(line, 'local'));
    requestAnimationFrame(() => { editorPreviewScrollLock = false; });
  }

  function onEditorPreviewScroll() {
    syncPreviewScrollFromEditor();
  }

  function onPreviewEditorScroll() {
    syncEditorScrollFromPreview();
  }

  function initEditorPreviewScrollSync() {
    const cm = easyMDE?.codemirror;
    const preview = document.getElementById('preview-content');
    if (!cm || !preview) return;

    cm.off('scroll', onEditorPreviewScroll);
    cm.on('scroll', onEditorPreviewScroll);
    preview.removeEventListener('scroll', onPreviewEditorScroll);
    preview.addEventListener('scroll', onPreviewEditorScroll, { passive: true });
  }

  function resetEasyMdePreviewState() {
    if (!easyMDE) return;
    if (typeof easyMDE.isPreviewActive === 'function' && easyMDE.isPreviewActive()) {
      easyMDE.togglePreview();
    }
    if (typeof easyMDE.isSideBySideActive === 'function' && easyMDE.isSideBySideActive()) {
      easyMDE.toggleSideBySide();
    }
  }



  function renderPreview() {
    const preview = document.getElementById('preview-content');
    if (!preview) return;
    const raw = easyMDE ? (easyMDE.value() || '') : '';

    const hasToc = /\[toc\]/i.test(raw);
    const hasHeader = /^#{1,6}\s+/m.test(raw);
    const floatingToc = document.getElementById('floating-toc');

    if (floatingToc) {
      const splitEdit = isEditing && document.querySelector('.editor-wrap')?.classList.contains('editor-wrap--split');
      if (isMobileLayout() || splitEdit) {
        floatingToc.style.display = 'none';
      } else {
        floatingToc.style.display = (!hasToc && !hasHeader) ? 'none' : '';
      }
    }

    const sheetRegistry = buildSheetRegistry(raw);
    const processed = preprocessMarkdown(raw, { sheetEditable: isEditing, richBlocks: true });
    preview.innerHTML = marked.parse(processed.markdown) + processed.tagsHtml;
    applyPreviewImageStyles(preview);
    preview.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => { h.id = slugifyHeading(h.textContent); });
    markFileLinks(preview);
    renderD3Charts(preview, sheetRegistry);
    buildFloatingToc();
    annotatePreviewSourceLines(raw, preview);
    if (isEditing) preview.tabIndex = -1;
    else preview.removeAttribute('tabindex');
    rebuildPreviewScrollAnchors();
    if (isEditorPreviewSplit()) syncPreviewScrollFromEditor();
  }

  function buildFloatingToc() {
    const preview = document.getElementById('preview-content');
    const list = document.getElementById('floating-toc-list');
    if (!preview || !list) return;

    const headings = [...preview.querySelectorAll('h1,h2,h3,h4,h5,h6')];
    if (!headings.length) {
      list.innerHTML = '<div class="text-muted small">No headings</div>';
      return;
    }

    headings.forEach((h, index) => {
      if (!h.id) h.id = slugifyHeading(h.textContent) || `heading-${index + 1}`;
    });

    list.innerHTML = headings.map(h => {
      const level = Number(h.tagName.substring(1));
      return `<a href="#${h.id}" class="toc-link toc-level-${level}" data-target="${h.id}">${h.textContent}</a>`;
    }).join('');

    list.querySelectorAll('.toc-link').forEach(link => {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        const id = this.dataset.target;
        const target = document.getElementById(id);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        closeFloatingToc();
      });
    });

    bindTocSpy();
  }

  function bindTocSpy() {
    const preview = document.getElementById('preview-content');
    if (!preview) return;

    const links = [...document.querySelectorAll('#floating-toc-list .toc-link')];
    const headings = [...preview.querySelectorAll('h1,h2,h3,h4,h5,h6')];
    if (!links.length || !headings.length) return;

    function updateActiveToc() {
      let activeId = headings[0].id;
      for (const h of headings) {
        const rect = h.getBoundingClientRect();
        const previewRect = preview.getBoundingClientRect();
        if (rect.top - previewRect.top <= 80) activeId = h.id;
      }
      links.forEach(link => { link.classList.toggle('active', link.dataset.target === activeId); });
    }

    if (tocSpyScrollHandler) preview.removeEventListener('scroll', tocSpyScrollHandler);
    tocSpyScrollHandler = updateActiveToc;
    preview.addEventListener('scroll', tocSpyScrollHandler, { passive: true });
    updateActiveToc();
  }

  function switchMode(mode) {
    const markdownWrap = document.getElementById('markdown-wrap');
    const previewWrap = document.getElementById('preview-wrap');
    const editorWrap = document.querySelector('.editor-wrap');

    if (!isEditing) mode = 'preview';

    resetEasyMdePreviewState();

    const splitEdit = isEditing && mode === 'markdown';
    editorWrap?.classList.toggle('editor-wrap--split', splitEdit);
    editorWrap?.classList.toggle('editor-wrap--preview-only', !isEditing);

    if (splitEdit) {
      ensureEditorSplitWidth(editorWrap);
      markdownWrap?.classList.remove('hidden');
      previewWrap?.classList.remove('hidden');
      renderPreview();
      if (easyMDE) {
        setTimeout(() => {
          easyMDE.codemirror.refresh();
          const toolbar = document.querySelector('#markdown-wrap .editor-toolbar');
          const cm = document.querySelector('#markdown-wrap .CodeMirror');
          if (toolbar) toolbar.style.display = '';
          if (cm) cm.style.display = '';
          rebuildPreviewScrollAnchors();
          syncPreviewScrollFromEditor();
        }, 50);
      }
      return;
    }

    markdownWrap?.classList.add('hidden');
    previewWrap?.classList.add('hidden');

    if (mode === 'markdown') {
      markdownWrap?.classList.remove('hidden');
      if (easyMDE) {
        setTimeout(() => {
          easyMDE.codemirror.refresh();
          const toolbar = document.querySelector('#markdown-wrap .editor-toolbar');
          const cm = document.querySelector('#markdown-wrap .CodeMirror');
          if (toolbar) toolbar.style.display = '';
          if (cm) cm.style.display = '';
        }, 50);
      }
    } else {
      previewWrap?.classList.remove('hidden');
      renderPreview();
    }
  }

  function setEditing(editing) {
    if (editing && !userCanEdit) editing = false;
    isEditing = editing;
    document.body.classList.toggle('editing', editing);
    const btn = document.getElementById('edit-toggle');
    if (btn) btn.textContent = editing ? 'Preview' : 'Edit';
    if (editing) {
      restoreRightPanelAfterPreview();
      switchMode('markdown');
    } else {
      hideEditorFindBar();
      hideRightPanelForPreview();
      switchMode('preview');
    }
  }

  function hideRightPanelForPreview() {
    const right = document.getElementById('right-panel');
    if (!right) return;
    if (rightPanelWasExpandedBeforePreview === null) {
      rightPanelWasExpandedBeforePreview = !right.classList.contains('collapsed');
    }
    if (!right.classList.contains('collapsed')) {
      right.classList.add('collapsed');
      syncAppShellLayout();
    }
  }

  function restoreRightPanelAfterPreview() {
    const right = document.getElementById('right-panel');
    if (!right || rightPanelWasExpandedBeforePreview !== true) {
      rightPanelWasExpandedBeforePreview = null;
      return;
    }
    right.classList.remove('collapsed');
    syncAppShellLayout();
    rightPanelWasExpandedBeforePreview = null;
    requestAnimationFrame(refreshCommPanelAfterToggle);
  }

  function syncUserEditAccess(isOwner, role) {
    userCanEdit = Boolean(isOwner || role === 'write' || window.APP_BOOT?.isStaff);
    const editToggle = document.getElementById('edit-toggle');
    if (editToggle) editToggle.classList.toggle('d-none', !userCanEdit);
    ['create-page', 'create-folder', 'delete-page'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = !userCanEdit;
    });
    if (!userCanEdit && isEditing) setEditing(false);
  }




  const SIDEBAR_MIN = 260;
  const SIDEBAR_MAX = 640;
  const SIDEBAR_DEFAULT = 420;
  const SIDEBAR_MOBILE_MAX = 300;
  const RIGHT_MIN = 240;
  const RIGHT_MAX = 640;
  const RIGHT_DEFAULT = 320;
  const EDITOR_MARKDOWN_MIN = 280;
  const EDITOR_PREVIEW_MIN = 280;
  const EDITOR_SPLITTER_WIDTH = 6;
  const LEGACY_SIDEBAR_WIDTH_KEY = 'notesSidebarWidth';

  function isMobileLayout() {
    return window.matchMedia('(max-width: 768px)').matches;
  }

  function getMobileSidebarWidth(width) {
    const max = Math.min(SIDEBAR_MOBILE_MAX, Math.max(SIDEBAR_MIN, window.innerWidth - 24));
    const base = Number.isFinite(width) && width >= SIDEBAR_MIN ? width : SIDEBAR_MIN;
    return Math.min(base, max);
  }

  function syncRightPanelLayout() {
    const shell = document.querySelector('.app-shell');
    const right = document.getElementById('right-panel');
    if (!shell || !right) return;

    if (right.classList.contains('collapsed')) {
      const w = parseInt(getComputedStyle(shell).getPropertyValue('--right-width'), 10);
      if (!Number.isNaN(w) && w > 0) {
        right.dataset.rightPanelWidth = String(w);
      }
      shell.style.setProperty('--right-width', '0px');
      shell.style.setProperty('--right-splitter-width', '0px');
      return;
    }

    let width = parseInt(right.dataset.rightPanelWidth, 10);
    if (Number.isNaN(width) || width < RIGHT_MIN) {
      width = parseInt(window.APP_BOOT?.rightPanelWidth, 10);
    }
    if (Number.isNaN(width) || width < RIGHT_MIN || width > RIGHT_MAX) {
      width = RIGHT_DEFAULT;
    }
    shell.style.setProperty('--right-width', `${width}px`);
    shell.style.setProperty('--right-splitter-width', '6px');
  }

  function syncAppShellLayout() {
    const shell = document.querySelector('.app-shell');
    const left = document.getElementById('left-panel');
    if (!shell) return;
    const collapsed = left?.classList.contains('collapsed') ?? false;
    shell.classList.toggle('sidebar-collapsed', collapsed);

    if (collapsed) {
      const w = parseInt(getComputedStyle(shell).getPropertyValue('--sidebar-width'), 10);
      if (!Number.isNaN(w) && w > 0 && left) {
        left.dataset.sidebarWidth = String(isMobileLayout() ? getMobileSidebarWidth(w) : w);
      }
      shell.style.setProperty('--sidebar-width', '0px');
      shell.style.setProperty('--splitter-width', '0px');
    }
    syncRightPanelLayout();
  }

  function applyLayoutFromSettings() {
    const boot = window.APP_BOOT || {};
    const shell = document.querySelector('.app-shell');
    const left = document.getElementById('left-panel');
    const right = document.getElementById('right-panel');

    let width = parseInt(boot.sidebarWidth, 10);
    if (Number.isNaN(width) || width < SIDEBAR_MIN || width > SIDEBAR_MAX) {
      const legacy = parseInt(localStorage.getItem(LEGACY_SIDEBAR_WIDTH_KEY), 10);
      if (!Number.isNaN(legacy) && legacy >= SIDEBAR_MIN && legacy <= SIDEBAR_MAX) {
        width = legacy;
        updateUserSettings({ sidebar_width: legacy });
        localStorage.removeItem(LEGACY_SIDEBAR_WIDTH_KEY);
      }
    }
    if (shell && !Number.isNaN(width) && width >= SIDEBAR_MIN && width <= SIDEBAR_MAX) {
      if (isMobileLayout()) width = getMobileSidebarWidth(width);
      shell.style.setProperty('--sidebar-width', `${width}px`);
    }

    const rightWidth = parseInt(boot.rightPanelWidth, 10);
    if (shell && !Number.isNaN(rightWidth) && rightWidth >= RIGHT_MIN && rightWidth <= RIGHT_MAX) {
      shell.style.setProperty('--right-width', `${rightWidth}px`);
    }

    if (left) {
      left.classList.toggle('collapsed', boot.leftPanelExpanded === false);
    }
    if (right) {
      right.classList.toggle('collapsed', boot.rightPanelExpanded === false);
    }
    applyEditorSplitFromSettings();
    syncAppShellLayout();
  }

  function persistSidebarWidth(w) {
    updateUserSettings({ sidebar_width: w });
  }

  function persistRightPanelWidth(w) {
    updateUserSettings({ right_panel_width: w });
  }

  function setLeftPanelExpanded(expanded) {
    const panel = document.getElementById('left-panel');
    const shell = document.querySelector('.app-shell');
    if (!panel) return;

    const wasCollapsed = panel.classList.contains('collapsed');
    panel.classList.toggle('collapsed', !expanded);
    syncAppShellLayout();

    if (expanded && wasCollapsed && shell) {
      let w = parseInt(panel.dataset.sidebarWidth, 10);
      delete panel.dataset.sidebarWidth;
      if (Number.isNaN(w) || w < SIDEBAR_MIN) {
        w = isMobileLayout() ? getMobileSidebarWidth(SIDEBAR_DEFAULT) : SIDEBAR_DEFAULT;
      } else if (isMobileLayout()) {
        w = getMobileSidebarWidth(w);
      }
      shell.style.setProperty('--sidebar-width', `${w}px`);
      shell.style.setProperty('--splitter-width', '6px');
    }

    updateUserSettings({ left_panel_expanded: expanded });
  }

  function collapseLeftPanel() {
    if (!isMobileLayout()) return;
    setLeftPanelExpanded(false);
  }

  function closeFloatingToc() {
    if (!isMobileLayout()) return;
    const toc = document.getElementById('floating-toc');
    const toggle = document.getElementById('toc-toggle');
    if (toc) toc.classList.remove('active');
    const label = toggle?.querySelector('span');
    if (label) label.textContent = 'content';
  }

  function toggleLeftPanel() {
    const panel = document.getElementById('left-panel');
    if (!panel) return;
    setLeftPanelExpanded(panel.classList.contains('collapsed'));
  }

  function initLeftSplitter() {
    const shell = document.querySelector('.app-shell');
    const splitter = document.getElementById('left-splitter');
    const left = document.getElementById('left-panel');
    if (!shell || !splitter || !left) return;

    let dragging = false;

    function setWidth(clientX) {
      const rect = shell.getBoundingClientRect();
      const w = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, clientX - rect.left));
      shell.style.setProperty('--sidebar-width', `${w}px`);
      return w;
    }

    function endDrag() {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('splitter-dragging');
      const w = parseInt(getComputedStyle(shell).getPropertyValue('--sidebar-width'), 10);
      if (!Number.isNaN(w)) persistSidebarWidth(w);
    }

    splitter.addEventListener('mousedown', e => {
      if (left.classList.contains('collapsed')) return;
      e.preventDefault();
      dragging = true;
      document.body.classList.add('splitter-dragging');
    });

    splitter.addEventListener('dblclick', () => {
      if (left.classList.contains('collapsed')) return;
      shell.style.setProperty('--sidebar-width', `${SIDEBAR_DEFAULT}px`);
      persistSidebarWidth(SIDEBAR_DEFAULT);
    });

    splitter.addEventListener('keydown', e => {
      if (left.classList.contains('collapsed')) return;
      const step = e.shiftKey ? 40 : 16;
      let current = parseInt(getComputedStyle(shell).getPropertyValue('--sidebar-width'), 10);
      if (Number.isNaN(current)) current = SIDEBAR_DEFAULT;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const w = Math.max(SIDEBAR_MIN, current - step);
        shell.style.setProperty('--sidebar-width', `${w}px`);
        persistSidebarWidth(w);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const w = Math.min(SIDEBAR_MAX, current + step);
        shell.style.setProperty('--sidebar-width', `${w}px`);
        persistSidebarWidth(w);
      }
    });

    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      setWidth(e.clientX);
    });

    window.addEventListener('mouseup', endDrag);
    window.addEventListener('blur', endDrag);
  }

  function editorInnerWidth(editorWrap) {
    const padL = parseFloat(getComputedStyle(editorWrap).paddingLeft) || 0;
    const padR = parseFloat(getComputedStyle(editorWrap).paddingRight) || 0;
    return editorWrap.clientWidth - padL - padR - EDITOR_SPLITTER_WIDTH;
  }

  function clampEditorMarkdownWidth(w, editorWrap) {
    const width = parseInt(w, 10);
    if (Number.isNaN(width)) return null;
    if (!editorWrap) return Math.max(EDITOR_MARKDOWN_MIN, width);
    const maxW = editorInnerWidth(editorWrap) - EDITOR_PREVIEW_MIN;
    return Math.max(EDITOR_MARKDOWN_MIN, Math.min(maxW, width));
  }

  function persistEditorMarkdownWidth(w) {
    if (!window.APP_BOOT) window.APP_BOOT = {};
    if (!window.APP_BOOT.extraConfigs) window.APP_BOOT.extraConfigs = {};
    window.APP_BOOT.extraConfigs.editor_markdown_width = w;
    updateUserSettings({ extra_configs: { editor_markdown_width: w } });
  }

  function applyEditorSplitFromSettings() {
    const editorWrap = document.querySelector('.editor-wrap');
    if (!editorWrap) return;
    const saved = window.APP_BOOT?.extraConfigs?.editor_markdown_width;
    const w = clampEditorMarkdownWidth(saved, editorWrap);
    if (w !== null) editorWrap.style.setProperty('--editor-markdown-width', `${w}px`);
  }

  function ensureEditorSplitWidth(editorWrap) {
    if (!editorWrap) return;
    const current = parseInt(editorWrap.style.getPropertyValue('--editor-markdown-width'), 10);
    if (!Number.isNaN(current) && current > 0) return;

    const saved = clampEditorMarkdownWidth(window.APP_BOOT?.extraConfigs?.editor_markdown_width, editorWrap);
    if (saved !== null) {
      editorWrap.style.setProperty('--editor-markdown-width', `${saved}px`);
      return;
    }

    const inner = editorInnerWidth(editorWrap);
    const w = Math.max(EDITOR_MARKDOWN_MIN, Math.min(inner - EDITOR_PREVIEW_MIN, inner * 0.5));
    editorWrap.style.setProperty('--editor-markdown-width', `${w}px`);
  }

  function initEditorSplitter() {
    const editorWrap = document.querySelector('.editor-wrap');
    const splitter = document.getElementById('editor-splitter');
    if (!editorWrap || !splitter) return;

    let dragging = false;

    function setMarkdownWidth(clientX) {
      const rect = editorWrap.getBoundingClientRect();
      const padL = parseFloat(getComputedStyle(editorWrap).paddingLeft) || 0;
      const maxW = editorInnerWidth(editorWrap) - EDITOR_PREVIEW_MIN;
      const w = Math.max(EDITOR_MARKDOWN_MIN, Math.min(maxW, clientX - rect.left - padL));
      editorWrap.style.setProperty('--editor-markdown-width', `${w}px`);
      if (easyMDE) easyMDE.codemirror.refresh();
    }

    function setMarkdownWidthPx(w, persist = false) {
      const clamped = clampEditorMarkdownWidth(w, editorWrap);
      if (clamped === null) return;
      editorWrap.style.setProperty('--editor-markdown-width', `${clamped}px`);
      if (easyMDE) easyMDE.codemirror.refresh();
      if (persist) persistEditorMarkdownWidth(clamped);
    }

    function endDrag() {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('splitter-dragging');
      const w = parseInt(editorWrap.style.getPropertyValue('--editor-markdown-width'), 10);
      if (!Number.isNaN(w)) persistEditorMarkdownWidth(w);
      if (easyMDE) easyMDE.codemirror.refresh();
    }

    splitter.addEventListener('mousedown', e => {
      if (!editorWrap.classList.contains('editor-wrap--split') || isMobileLayout()) return;
      e.preventDefault();
      dragging = true;
      document.body.classList.add('splitter-dragging');
    });

    splitter.addEventListener('dblclick', () => {
      if (!editorWrap.classList.contains('editor-wrap--split') || isMobileLayout()) return;
      const inner = editorInnerWidth(editorWrap);
      const w = Math.max(EDITOR_MARKDOWN_MIN, Math.min(inner - EDITOR_PREVIEW_MIN, inner * 0.5));
      setMarkdownWidthPx(w, true);
    });

    splitter.addEventListener('keydown', e => {
      if (!editorWrap.classList.contains('editor-wrap--split') || isMobileLayout()) return;
      const step = e.shiftKey ? 40 : 16;
      let current = parseInt(editorWrap.style.getPropertyValue('--editor-markdown-width'), 10);
      if (Number.isNaN(current)) {
        ensureEditorSplitWidth(editorWrap);
        current = parseInt(editorWrap.style.getPropertyValue('--editor-markdown-width'), 10);
      }
      const maxW = editorInnerWidth(editorWrap) - EDITOR_PREVIEW_MIN;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setMarkdownWidthPx(Math.max(EDITOR_MARKDOWN_MIN, current - step), true);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setMarkdownWidthPx(Math.min(maxW, current + step), true);
      }
    });

    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      setMarkdownWidth(e.clientX);
    });

    window.addEventListener('mouseup', endDrag);
    window.addEventListener('blur', endDrag);
  }

  function initRightSplitter() {
    const shell = document.querySelector('.app-shell');
    const splitter = document.getElementById('right-splitter');
    const right = document.getElementById('right-panel');
    if (!shell || !splitter || !right) return;

    let dragging = false;

    function setWidth(clientX) {
      const rect = shell.getBoundingClientRect();
      const w = Math.max(RIGHT_MIN, Math.min(RIGHT_MAX, rect.right - clientX));
      shell.style.setProperty('--right-width', `${w}px`);
      return w;
    }

    function endDrag() {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('splitter-dragging');
      const w = parseInt(getComputedStyle(shell).getPropertyValue('--right-width'), 10);
      if (!Number.isNaN(w)) persistRightPanelWidth(w);
    }

    splitter.addEventListener('mousedown', e => {
      if (right.classList.contains('collapsed')) return;
      e.preventDefault();
      dragging = true;
      document.body.classList.add('splitter-dragging');
    });

    splitter.addEventListener('dblclick', () => {
      if (right.classList.contains('collapsed')) return;
      shell.style.setProperty('--right-width', `${RIGHT_DEFAULT}px`);
      persistRightPanelWidth(RIGHT_DEFAULT);
    });

    splitter.addEventListener('keydown', e => {
      if (right.classList.contains('collapsed')) return;
      const step = e.shiftKey ? 40 : 16;
      let current = parseInt(getComputedStyle(shell).getPropertyValue('--right-width'), 10);
      if (Number.isNaN(current)) current = RIGHT_DEFAULT;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const w = Math.max(RIGHT_MIN, current - step);
        shell.style.setProperty('--right-width', `${w}px`);
        persistRightPanelWidth(w);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const w = Math.min(RIGHT_MAX, current + step);
        shell.style.setProperty('--right-width', `${w}px`);
        persistRightPanelWidth(w);
      }
    });

    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      setWidth(e.clientX);
    });

    window.addEventListener('mouseup', endDrag);
    window.addEventListener('blur', endDrag);
  }

  function toggleRightPanel() {
    const panel = document.getElementById('right-panel');
    if (!panel) return;

    panel.classList.toggle('collapsed');
    syncAppShellLayout();
    updateUserSettings({ right_panel_expanded: !panel.classList.contains('collapsed') });
    requestAnimationFrame(() => refreshCommPanelAfterToggle());
  }

  function refreshCommPanelLayout() {
    const panel = document.getElementById('right-panel');
    if (!panel || panel.classList.contains('collapsed')) return;
    void panel.offsetHeight;
    const chatBox = document.getElementById('chat-messages');
    if (chatBox) chatBox.scrollTop = chatBox.scrollHeight;
  }

  function refreshCommPanelAfterToggle() {
    refreshCommPanelLayout();
    if (isChatPanelVisible()) {
      refreshActiveChat();
      markChatSeen();
      return;
    }
    if (isMailPanelVisible()) {
      if (mailBox === 'compose') ensureMailRecipients();
      else loadMailList();
      return;
    }
    updateChatUnreadBadge();
  }


  const FONT_SIZE_PRESETS = {
    bigger: '150%',
    big: '125%',
    normal: null,
    small: '87.5%',
    smaller: '75%',
  };

  function stripFontSizeMarkup(text) {
    let cleaned = String(text || '');
    let prev;
    do {
      prev = cleaned;
      cleaned = cleaned.replace(
        /<span[^>]*style="[^"]*font-size\s*:\s*[^";]+[^"]*"[^>]*>([\s\S]*?)<\/span>/gi,
        '$1',
      );
    } while (cleaned !== prev);
    return cleaned;
  }

  function applyEditorFontSize(editor, sizeKey) {
    const cm = editor?.codemirror;
    if (!cm) return;

    const cssSize = FONT_SIZE_PRESETS[sizeKey];
    let text;
    let range;

    if (cm.somethingSelected()) {
      text = cm.getSelection();
    } else {
      const cursor = cm.getCursor();
      const lineNum = cursor.line;
      text = cm.getLine(lineNum);
      range = {
        from: { line: lineNum, ch: 0 },
        to: { line: lineNum, ch: text.length },
      };
    }

    if (!text) return;

    const next = cssSize
      ? `<span style="font-size:${cssSize}">${text}</span>`
      : stripFontSizeMarkup(text);

    if (cm.somethingSelected()) {
      cm.replaceSelection(next, 'around');
    } else {
      cm.replaceRange(next, range.from, range.to);
    }
    cm.focus();
    scheduleSave();
    schedulePreviewRefresh();
  }

  function buildFontSizeToolbarDropdown() {
    return {
      name: 'fontSizeMenu',
      className: 'fa fa-text-height',
      title: 'Text size',
      children: [
        {
          name: 'fontSizeBigger',
          text: 'bigger',
          title: 'Bigger text (150%)',
          action: (editor) => applyEditorFontSize(editor, 'bigger'),
        },
        {
          name: 'fontSizeBig',
          text: 'big',
          title: 'Big text (125%)',
          action: (editor) => applyEditorFontSize(editor, 'big'),
        },
        {
          name: 'fontSizeNormal',
          text: 'normal',
          title: 'Normal text size',
          action: (editor) => applyEditorFontSize(editor, 'normal'),
        },
        {
          name: 'fontSizeSmall',
          text: 'small',
          title: 'Small text (87.5%)',
          action: (editor) => applyEditorFontSize(editor, 'small'),
        },
        {
          name: 'fontSizeSmaller',
          text: 'smaller',
          title: 'Smaller text (75%)',
          action: (editor) => applyEditorFontSize(editor, 'smaller'),
        },
      ],
    };
  }

  const EDITOR_COLOR_PALETTE = [
    { key: 'red', label: 'red', css: '#dc3545' },
    { key: 'blue', label: 'blue', css: '#0d6efd' },
    { key: 'lightblue', label: 'light blue', css: '#6ea8fe' },
    { key: 'yellow', label: 'yellow', css: '#ffc107' },
    { key: 'lightgreen', label: 'light green', css: '#75b798' },
    { key: 'green', label: 'green', css: '#198754' },
    { key: 'cyan', label: 'cyan', css: '#0dcaf0' },
  ];

  const EDITOR_COLOR_PICKER_COLORS = [
    ...EDITOR_COLOR_PALETTE,
    { key: 'orange', label: 'orange', css: '#fd7e14' },
    { key: 'teal', label: 'teal', css: '#20c997' },
    { key: 'purple', label: 'purple', css: '#6f42c1' },
    { key: 'pink', label: 'pink', css: '#d63384' },
    { key: 'indigo', label: 'indigo', css: '#6610f2' },
    { key: 'secondary', label: 'secondary', css: '#6c757d' },
    { key: 'dark', label: 'dark', css: '#212529' },
  ];

  let editorColorPickerState = null;

  function hideEditorColorPicker() {
    const picker = document.getElementById('editor-color-picker');
    picker?.classList.add('d-none');
    editorColorPickerState = null;
    picker?.querySelectorAll('.editor-color-picker-swatch.is-selected')
      .forEach((el) => el.classList.remove('is-selected'));
  }

  function positionEditorColorPicker() {
    const picker = document.getElementById('editor-color-picker');
    const toolbar = document.querySelector('.EasyMDEContainer .editor-toolbar');
    if (!picker || !toolbar) return;

    const rect = toolbar.getBoundingClientRect();
    const margin = 8;
    let top = rect.bottom + 4;
    let left = rect.left;

    picker.classList.remove('d-none');
    const pickerRect = picker.getBoundingClientRect();
    if (left + pickerRect.width > window.innerWidth - margin) {
      left = window.innerWidth - pickerRect.width - margin;
    }
    if (top + pickerRect.height > window.innerHeight - margin) {
      top = rect.top - pickerRect.height - 4;
    }
    if (left < margin) left = margin;
    if (top < margin) top = margin;

    picker.style.top = `${top}px`;
    picker.style.left = `${left}px`;
  }

  function renderEditorColorPickerGrid() {
    const grid = document.getElementById('editor-color-picker-grid');
    if (!grid) return;

    grid.replaceChildren();
    EDITOR_COLOR_PICKER_COLORS.forEach(({ label, css }) => {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'editor-color-picker-swatch';
      swatch.style.backgroundColor = css;
      swatch.title = `${label} — double-click to apply`;
      swatch.dataset.color = css;
      swatch.setAttribute('aria-label', label);

      swatch.addEventListener('click', () => {
        grid.querySelectorAll('.editor-color-picker-swatch.is-selected')
          .forEach((el) => el.classList.remove('is-selected'));
        swatch.classList.add('is-selected');
        const customInput = document.getElementById('editor-color-picker-input');
        if (customInput) customInput.value = css;
      });

      swatch.addEventListener('dblclick', (e) => {
        e.preventDefault();
        if (!editorColorPickerState) return;
        applyEditorStyleColor(
          editorColorPickerState.editor,
          editorColorPickerState.styleProp,
          css,
        );
        hideEditorColorPicker();
      });

      grid.appendChild(swatch);
    });
  }

  function openEditorColorPicker(editor, styleProp) {
    const picker = document.getElementById('editor-color-picker');
    const title = document.getElementById('editor-color-picker-title');
    if (!picker || !title) return;

    editorColorPickerState = { editor, styleProp };
    title.textContent = styleProp === 'color' ? 'Text color' : 'Background color';
    renderEditorColorPickerGrid();

    const customInput = document.getElementById('editor-color-picker-input');
    if (customInput) customInput.value = '#0d6efd';

    picker.classList.remove('d-none');
    positionEditorColorPicker();
  }

  function initEditorColorPicker() {
    document.getElementById('editor-color-picker-close')
      ?.addEventListener('click', hideEditorColorPicker);

    document.getElementById('editor-color-picker-apply')
      ?.addEventListener('click', () => {
        if (!editorColorPickerState) return;
        const color = document.getElementById('editor-color-picker-input')?.value;
        if (!color) return;
        applyEditorStyleColor(
          editorColorPickerState.editor,
          editorColorPickerState.styleProp,
          color,
        );
        hideEditorColorPicker();
      });

    document.getElementById('editor-color-picker-input')
      ?.addEventListener('input', (e) => {
        const grid = document.getElementById('editor-color-picker-grid');
        grid?.querySelectorAll('.editor-color-picker-swatch.is-selected')
          .forEach((el) => el.classList.remove('is-selected'));
        e.target.dataset.liveColor = e.target.value;
      });

    document.addEventListener('mousedown', (e) => {
      const picker = document.getElementById('editor-color-picker');
      if (!picker || picker.classList.contains('d-none')) return;
      if (picker.contains(e.target)) return;
      if (e.target.closest('.editor-toolbar .easymde-dropdown')) return;
      hideEditorColorPicker();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const picker = document.getElementById('editor-color-picker');
      if (picker && !picker.classList.contains('d-none')) hideEditorColorPicker();
    });
  }

  function applyEditorStyleColor(editor, styleProp, color) {
    const cm = editor?.codemirror;
    if (!cm || !color) return;

    let text;
    let range;

    if (cm.somethingSelected()) {
      text = cm.getSelection();
    } else {
      const cursor = cm.getCursor();
      const lineNum = cursor.line;
      text = cm.getLine(lineNum);
      range = {
        from: { line: lineNum, ch: 0 },
        to: { line: lineNum, ch: text.length },
      };
    }

    if (!text) return;

    const wrapped = `<span style="${styleProp}:${color}">${text}</span>`;
    if (cm.somethingSelected()) {
      cm.replaceSelection(wrapped, 'around');
    } else {
      cm.replaceRange(wrapped, range.from, range.to);
    }
    cm.focus();
    scheduleSave();
    schedulePreviewRefresh();
  }

  function buildColorToolbarDropdown(styleProp, menuName, iconClass, title) {
    return {
      name: menuName,
      className: iconClass,
      title,
      children: [
        ...EDITOR_COLOR_PALETTE.map(({ key, label, css }) => ({
          name: `${menuName}${key}`,
          text: label,
          className: `color-swatch color-swatch--${key}`,
          title: label,
          action: (editor) => applyEditorStyleColor(editor, styleProp, css),
        })),
        {
          name: `${menuName}Palette`,
          text: 'color palette',
          className: 'color-swatch color-swatch--palette',
          title: 'Pick a custom color',
          action: (editor) => openEditorColorPicker(editor, styleProp),
        },
      ],
    };
  }

  const EXAMPLE_SHEET_ID = 'quarterly';
  const EXAMPLE_SHEET_BODY = [
    '`id=quarterly',
    'Month\tSales\tCosts',
    'Jan\t100\t80',
    'Feb\t150\t90',
    'Mar\t200\t110',
    'Apr\t120\t85',
  ].join('\n');
  const EXAMPLE_SHEET_COLUMNS = ['Month', 'Sales', 'Costs'];

  function getSheetColumnLabels(sheet) {
    const grid = sheet?.grid || [];
    if (!grid.length) return ['0', '1'];
    const hasHeader = sheetHasHeader(sheet.config) && grid.length > 0;
    if (hasHeader) return grid[0].map(c => String(c));
    return grid[0].map((_, i) => String(i));
  }

  function renderChartAxisButtons(container, columns, selected, multiple) {
    if (!container) return;
    const selectedSet = new Set(Array.isArray(selected) ? selected : [selected].filter(Boolean));
    container.innerHTML = columns.map(col => {
      const safe = escapeHtml(col);
      const active = selectedSet.has(col) ? ' active' : '';
      return `<button type="button" class="btn btn-sm btn-outline-primary chart-axis-btn${active}" data-value="${safe}">${safe}</button>`;
    }).join('');
  }

  function bindChartAxisButtons(container, multiple) {
    if (!container || container.dataset.bound === '1') return;
    container.dataset.bound = '1';
    container.addEventListener('click', e => {
      const btn = e.target.closest('.chart-axis-btn');
      if (!btn || !container.contains(btn)) return;
      if (multiple) {
        btn.classList.toggle('active');
        return;
      }
      container.querySelectorAll('.chart-axis-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  }

  function getChartAxisValues(container) {
    if (!container) return [];
    return [...container.querySelectorAll('.chart-axis-btn.active')].map(b => b.dataset.value).filter(Boolean);
  }

  let chartInsertEditor = null;
  let chartInsertSheets = [];

  function refreshChartInsertColumns() {
    const sheetSel = document.getElementById('chart-insert-sheet');
    const sheetManual = document.getElementById('chart-insert-sheet-manual');
    let sheetId = sheetSel?.value;
    if (sheetManual && !sheetManual.classList.contains('d-none')) {
      sheetId = sheetManual.value.trim() || EXAMPLE_SHEET_ID;
    }
    const entry = chartInsertSheets.find(s => s.id === sheetId) || chartInsertSheets[0];
    const cols = entry?.columns?.length ? entry.columns : EXAMPLE_SHEET_COLUMNS;
    const xDefault = cols.includes('Month') ? 'Month' : cols[0];
    const yDefault = cols.includes('Sales')
      ? ['Sales', ...(cols.includes('Costs') ? ['Costs'] : [])]
      : [cols[1] ?? cols[0]];

    const xButtons = document.getElementById('chart-insert-x-buttons');
    const yButtons = document.getElementById('chart-insert-y-buttons');
    renderChartAxisButtons(xButtons, cols, xDefault, false);
    renderChartAxisButtons(yButtons, cols, yDefault, true);
    bindChartAxisButtons(xButtons, false);
    bindChartAxisButtons(yButtons, true);
  }

  function openChartInsertModal(editor) {
    chartInsertEditor = editor;
    const registry = buildSheetRegistry(editor.value());
    chartInsertSheets = [...registry.entries()].map(([id, sheet]) => ({
      id,
      columns: getSheetColumnLabels(sheet),
    }));

    const sheetSel = document.getElementById('chart-insert-sheet');
    const sheetManual = document.getElementById('chart-insert-sheet-manual');
    const hint = document.getElementById('chart-insert-hint');

    if (chartInsertSheets.length) {
      hint?.classList.add('d-none');
      sheetSel?.classList.remove('d-none');
      sheetManual?.classList.add('d-none');
      sheetSel.innerHTML = chartInsertSheets.map((s, i) =>
        `<option value="${escapeHtml(s.id)}"${i === 0 ? ' selected' : ''}>${escapeHtml(s.id)}</option>`,
      ).join('');
    } else {
      hint?.classList.remove('d-none');
      sheetSel?.classList.add('d-none');
      sheetManual?.classList.remove('d-none');
      if (sheetManual && !sheetManual.value.trim()) sheetManual.value = EXAMPLE_SHEET_ID;
      chartInsertSheets = [{ id: sheetManual?.value.trim() || EXAMPLE_SHEET_ID, columns: EXAMPLE_SHEET_COLUMNS }];
    }

    refreshChartInsertColumns();

    const modalEl = document.getElementById('chart-insert-modal');
    if (modalEl) openDashboardModal(modalEl);
  }

  function initChartInsertModal() {
    document.getElementById('chart-insert-sheet')?.addEventListener('change', refreshChartInsertColumns);
    document.getElementById('chart-insert-confirm')?.addEventListener('click', () => {
      const type = document.getElementById('chart-insert-type')?.value || 'bar';
      const x = getChartAxisValues(document.getElementById('chart-insert-x-buttons'))[0] || '0';
      const yCols = getChartAxisValues(document.getElementById('chart-insert-y-buttons'));
      if (!yCols.length) yCols.push('1');
      const sheetManual = document.getElementById('chart-insert-sheet-manual');
      let sheetId = document.getElementById('chart-insert-sheet')?.value;
      if (sheetManual && !sheetManual.classList.contains('d-none')) {
        sheetId = sheetManual.value.trim() || EXAMPLE_SHEET_ID;
      }
      if (chartInsertEditor) {
        insertFenceBlock(chartInsertEditor, 'chart', [sheetId, type, x, ...yCols].join('\n'));
      }
      bootstrap.Modal.getInstance(document.getElementById('chart-insert-modal'))?.hide();
    });
  }

  function normalizeSnippetsList(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item, index) => {
        if (!item || typeof item !== 'object') return null;
        const name = String(item.name || '').trim();
        const body = String(item.body ?? '');
        if (!name && !body) return null;
        return {
          id: String(item.id || `snippet_${index + 1}`),
          name: name || `Snippet ${index + 1}`,
          body,
        };
      })
      .filter(Boolean);
  }

  function scheduleSnippetsSave() {
    clearTimeout(snippetsSaveTimer);
    snippetsSaveTimer = setTimeout(() => {
      updateUserSettings({ extra_configs: { snippets: snippetsCache } });
    }, 400);
  }

  function getActiveSnippet() {
    return snippetsCache.find(s => s.id === activeSnippetId) || null;
  }

  function renderSnippetsList() {
    const list = document.getElementById('snippets-list');
    if (!list) return;
    if (!snippetsCache.length) {
      list.innerHTML = '<div class="text-muted small p-2">No snippets yet.</div>';
      return;
    }
    list.innerHTML = snippetsCache.map(snippet => {
      const active = snippet.id === activeSnippetId ? ' active' : '';
      return `<button type="button" class="snippets-list-item${active}" data-snippet-id="${escapeHtml(snippet.id)}">${escapeHtml(snippet.name)}</button>`;
    }).join('');
    list.querySelectorAll('.snippets-list-item').forEach(btn => {
      btn.addEventListener('click', () => selectSnippet(btn.dataset.snippetId));
    });
  }

  function renderSnippetsQuickList() {
    const list = document.getElementById('snippets-quick-list');
    if (!list) return;
    if (!snippetsCache.length) {
      list.innerHTML = '<div class="text-muted small">No snippets — click Manage to add one.</div>';
      return;
    }
    list.innerHTML = snippetsCache.map(snippet => (
      `<button type="button" class="btn btn-sm btn-outline-light snippets-quick-btn w-100 mb-1" data-snippet-id="${escapeHtml(snippet.id)}">${escapeHtml(snippet.name)}</button>`
    )).join('');
    list.querySelectorAll('.snippets-quick-btn').forEach(btn => {
      btn.addEventListener('click', () => insertSnippetById(btn.dataset.snippetId));
    });
  }

  function fillSnippetEditor(snippet) {
    const nameInput = document.getElementById('snippet-edit-name');
    const bodyInput = document.getElementById('snippet-edit-body');
    if (nameInput) nameInput.value = snippet?.name || '';
    if (bodyInput) bodyInput.value = snippet?.body || '';
  }

  function selectSnippet(snippetId) {
    activeSnippetId = snippetId;
    fillSnippetEditor(getActiveSnippet());
    renderSnippetsList();
  }

  function insertSnippetBody(body) {
    if (!easyMDE || !body) return;
    ensureEditingForInsert();
    easyMDE.codemirror.replaceSelection(body);
    easyMDE.codemirror.focus();
    scheduleSave();
    schedulePreviewRefresh();
  }

  function insertSnippetById(snippetId) {
    const snippet = snippetsCache.find(s => s.id === snippetId);
    if (!snippet) return;
    insertSnippetBody(snippet.body);
    showToast(`Inserted “${snippet.name}”.`, 'success', 2000);
  }

  function openSnippetsModal() {
    if (!activeSnippetId && snippetsCache.length) activeSnippetId = snippetsCache[0].id;
    fillSnippetEditor(getActiveSnippet());
    renderSnippetsList();
    const modalEl = document.getElementById('snippets-modal');
    if (modalEl) openDashboardModal(modalEl);
  }

  function initSnippetsModal() {
    document.getElementById('snippets-manage-btn')?.addEventListener('click', openSnippetsModal);
    document.getElementById('snippet-new-btn')?.addEventListener('click', () => {
      activeSnippetId = `snippet_${Date.now()}`;
      fillSnippetEditor({ name: '', body: '' });
      renderSnippetsList();
      document.getElementById('snippet-edit-name')?.focus();
    });
    document.getElementById('snippet-save-btn')?.addEventListener('click', () => {
      const name = document.getElementById('snippet-edit-name')?.value?.trim();
      const body = document.getElementById('snippet-edit-body')?.value ?? '';
      if (!name) {
        showToast('Enter a snippet name.', 'warning', 2500);
        return;
      }
      const existing = snippetsCache.find(s => s.id === activeSnippetId);
      if (existing) {
        existing.name = name;
        existing.body = body;
      } else {
        const id = activeSnippetId || `snippet_${Date.now()}`;
        activeSnippetId = id;
        snippetsCache.push({ id, name, body });
      }
      scheduleSnippetsSave();
      renderSnippetsList();
      renderSnippetsQuickList();
      showToast('Snippet saved.', 'success', 2000);
    });
    document.getElementById('snippet-delete-btn')?.addEventListener('click', () => {
      if (!activeSnippetId) return;
      if (!confirm('Delete this snippet?')) return;
      snippetsCache = snippetsCache.filter(s => s.id !== activeSnippetId);
      activeSnippetId = snippetsCache[0]?.id || null;
      fillSnippetEditor(getActiveSnippet());
      scheduleSnippetsSave();
      renderSnippetsList();
      renderSnippetsQuickList();
      showToast('Snippet deleted.', 'success', 2000);
    });
    document.getElementById('snippet-insert-btn')?.addEventListener('click', () => {
      const body = document.getElementById('snippet-edit-body')?.value ?? '';
      if (!body.trim()) {
        showToast('Snippet content is empty.', 'warning', 2500);
        return;
      }
      insertSnippetBody(body);
      bootstrap.Modal.getInstance(document.getElementById('snippets-modal'))?.hide();
      showToast('Snippet inserted.', 'success', 2000);
    });
    renderSnippetsQuickList();
  }

  function renderPanelTypeButtons() {
    const container = document.getElementById('panel-type-buttons');
    if (!container) return;
    container.innerHTML = PANEL_TYPES.map(type => {
      const active = type === panelInsertType ? ' active' : '';
      return `<button type="button" class="panel-type-btn panel-type-btn--${type}${active}" data-panel-type="${type}" title="${PANEL_TYPE_LABELS[type]}">${escapeHtml(PANEL_TYPE_LABELS[type])}</button>`;
    }).join('');
    container.querySelectorAll('.panel-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        panelInsertType = btn.dataset.panelType;
        renderPanelTypeButtons();
      });
    });
  }

  function openPanelInsertModal(editor) {
    panelInsertEditor = editor;
    panelInsertType = 'info';
    const titleInput = document.getElementById('panel-insert-title');
    const bodyInput = document.getElementById('panel-insert-body');
    if (titleInput) titleInput.value = '';
    if (bodyInput) bodyInput.value = 'Your content here.';
    renderPanelTypeButtons();
    const modalEl = document.getElementById('panel-insert-modal');
    if (modalEl) openDashboardModal(modalEl);
  }

  function initPanelInsertModal() {
    document.getElementById('panel-insert-confirm')?.addEventListener('click', () => {
      const title = document.getElementById('panel-insert-title')?.value || '';
      const body = document.getElementById('panel-insert-body')?.value || '';
      const fence = buildPanelFence(panelInsertType, title, body);
      if (panelInsertEditor?.codemirror) {
        panelInsertEditor.codemirror.replaceSelection(fence);
        panelInsertEditor.codemirror.focus();
      } else if (easyMDE) {
        ensureEditingForInsert();
        easyMDE.codemirror.replaceSelection(fence);
        easyMDE.codemirror.focus();
      }
      scheduleSave();
      schedulePreviewRefresh();
      bootstrap.Modal.getInstance(document.getElementById('panel-insert-modal'))?.hide();
    });
  }

  function insertFenceBlock(editor, fence, body) {
    const cm = editor.codemirror;
    const snippet = `\n\`\`\`${fence}\n${body}\n\`\`\`\n`;
    cm.replaceSelection(snippet);
    cm.focus();
  }

  function getEditorCm() {
    return easyMDE?.codemirror || null;
  }

  function ensureEditingForSearch() {
    if (!isEditing) setEditing(true);
  }

  function editorSearchOptions() {
    const matchCase = document.getElementById('editor-find-case')?.checked;
    return { caseFold: !matchCase };
  }

  function setEditorFindStatus(message) {
    const el = document.getElementById('editor-find-status');
    if (el) el.textContent = message || '';
  }

  function editorSelectionMatchesQuery(cm, query, opts) {
    const sel = cm.getSelection();
    if (!query || !sel) return false;
    if (opts.caseFold) return sel.toLowerCase() === query.toLowerCase();
    return sel === query;
  }

  function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function replaceAllInText(text, query, replacement, caseFold) {
    if (!query) return { text, count: 0 };
    if (caseFold) {
      const re = new RegExp(escapeRegExp(query), 'gi');
      let count = 0;
      const next = text.replace(re, () => {
        count += 1;
        return replacement;
      });
      return { text: next, count };
    }
    let count = 0;
    let idx = 0;
    let result = '';
    while (idx < text.length) {
      const found = text.indexOf(query, idx);
      if (found === -1) {
        result += text.slice(idx);
        break;
      }
      result += text.slice(idx, found) + replacement;
      idx = found + query.length;
      count += 1;
    }
    return { text: count ? result : text, count };
  }

  function cmStartPos(cm) {
    const CM = cm.constructor;
    return CM?.Pos ? CM.Pos(0, 0) : { line: 0, ch: 0 };
  }

  function cmCanSearch(cm) {
    return typeof cm.getSearchCursor === 'function';
  }

  function editorFindNext(backward = false) {
    const cm = getEditorCm();
    const query = document.getElementById('editor-find-input')?.value;
    if (!cm || !query) {
      setEditorFindStatus('');
      return false;
    }

    const opts = editorSearchOptions();

    if (!cmCanSearch(cm)) {
      const doc = cm.getValue();
      const hay = opts.caseFold ? doc.toLowerCase() : doc;
      const needle = opts.caseFold ? query.toLowerCase() : query;
      const cursor = cm.getCursor();
      const cursorIndex = cm.indexFromPos(cursor);
      let foundIndex = -1;

      if (backward) {
        foundIndex = hay.lastIndexOf(needle, cursorIndex - 1);
        if (foundIndex === -1) foundIndex = hay.lastIndexOf(needle);
      } else {
        foundIndex = hay.indexOf(needle, cursorIndex);
        if (foundIndex === -1) foundIndex = hay.indexOf(needle);
      }

      if (foundIndex === -1) {
        setEditorFindStatus('No results');
        return false;
      }

      const from = cm.posFromIndex(foundIndex);
      const to = cm.posFromIndex(foundIndex + query.length);
      cm.setSelection(from, to);
      cm.scrollIntoView({ from, to }, 20);
      setEditorFindStatus('');
      return true;
    }

    let cursor = cm.getSearchCursor(query, cm.getCursor(), opts);
    let found = backward ? cursor.findPrevious() : cursor.findNext();

    if (!found) {
      const CM = cm.constructor;
      const wrapPos = backward
        ? CM.Pos(cm.lastLine(), cm.getLine(cm.lastLine()).length)
        : cmStartPos(cm);
      cursor = cm.getSearchCursor(query, wrapPos, opts);
      found = backward ? cursor.findPrevious() : cursor.findNext();
    }

    if (found) {
      cm.setSelection(cursor.from(), cursor.to());
      cm.scrollIntoView({ from: cursor.from(), to: cursor.to() }, 20);
      setEditorFindStatus('');
      return true;
    }

    setEditorFindStatus('No results');
    return false;
  }

  function editorReplaceOne() {
    const cm = getEditorCm();
    const query = document.getElementById('editor-find-input')?.value;
    const replacement = document.getElementById('editor-replace-input')?.value ?? '';
    if (!cm || !query) return;

    ensureEditingForSearch();
    const opts = editorSearchOptions();
    if (editorSelectionMatchesQuery(cm, query, opts)) {
      cm.replaceSelection(replacement);
      scheduleSave();
      schedulePreviewRefresh();
      editorFindNext(false);
      return;
    }

    if (editorFindNext(false) && editorSelectionMatchesQuery(cm, query, opts)) {
      cm.replaceSelection(replacement);
      scheduleSave();
      schedulePreviewRefresh();
      editorFindNext(false);
    }
  }

  function editorReplaceAll() {
    const cm = getEditorCm();
    const query = document.getElementById('editor-find-input')?.value;
    const replacement = document.getElementById('editor-replace-input')?.value ?? '';
    if (!cm || !query) return;

    ensureEditingForSearch();
    const opts = editorSearchOptions();
    const { text, count } = replaceAllInText(cm.getValue(), query, replacement, opts.caseFold);
    const scroll = cm.getScrollInfo();
    const cursor = cm.getCursor();

    if (count) {
      cm.operation(() => {
        cm.setValue(text);
        cm.setCursor(cursor);
        cm.scrollTo(scroll.left, scroll.top);
      });
      scheduleSave();
      schedulePreviewRefresh();
    }
    setEditorFindStatus(count ? `Replaced ${count}` : 'No results');
  }

  function showEditorFindBar(mode = 'find') {
    ensureEditingForSearch();
    const bar = document.getElementById('editor-find-bar');
    bar?.classList.remove('d-none');
    const findInput = document.getElementById('editor-find-input');
    const replaceInput = document.getElementById('editor-replace-input');
    const cm = getEditorCm();
    const selected = cm?.getSelection()?.trim();
    if (selected && findInput && !findInput.value) findInput.value = selected;

    if (mode === 'replace') {
      replaceInput?.focus();
    } else {
      findInput?.focus();
      findInput?.select();
    }

    if (findInput?.value) editorFindNext(false);
    setTimeout(() => cm?.refresh(), 0);
  }

  function hideEditorFindBar() {
    document.getElementById('editor-find-bar')?.classList.add('d-none');
    setEditorFindStatus('');
    getEditorCm()?.focus();
  }

  function editorFind() {
    showEditorFindBar('find');
  }

  function editorReplace() {
    showEditorFindBar('replace');
  }

  function initEditorFindBar() {
    const findInput = document.getElementById('editor-find-input');
    const replaceInput = document.getElementById('editor-replace-input');

    document.getElementById('editor-find-prev')?.addEventListener('click', () => editorFindNext(true));
    document.getElementById('editor-find-next')?.addEventListener('click', () => editorFindNext(false));
    document.getElementById('editor-replace-one')?.addEventListener('click', editorReplaceOne);
    document.getElementById('editor-replace-all')?.addEventListener('click', editorReplaceAll);
    document.getElementById('editor-find-close')?.addEventListener('click', hideEditorFindBar);
    document.getElementById('editor-find-case')?.addEventListener('change', () => {
      if (findInput?.value) editorFindNext(false);
    });

    findInput?.addEventListener('input', () => {
      if (findInput.value) editorFindNext(false);
      else setEditorFindStatus('');
    });
    findInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        editorFindNext(e.shiftKey);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        hideEditorFindBar();
      }
    });
    replaceInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        editorReplaceOne();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        hideEditorFindBar();
      }
    });
  }

  function initEditors() {
    easyMDE = new EasyMDE({
      element: document.getElementById('markdown-editor'),
      spellChecker: false,
      // status: false,
      status: ["autosave", "lines", "words", "cursor"],
      autosave: { enabled: false },
      indentWithTabs: true,
      forceSync: true,
      sideBySideFullscreen: false,
      minHeight: 'calc(100vh - 240px)',
      toolbar: [
        'code',
        'bold', 'italic', '|',
        'quote', 'unordered-list', 'ordered-list', '|',
        'link','image','table',
        {
          name: 'local-file-link',
          action: () => openLocalFileLinkInsertDialog(),
          className: 'fa fa-folder-open',
          title: 'Insert local file link',
        },
        {
          name: 'insert-sheet',
          action: (editor) => insertFenceBlock(editor, 'sheet', EXAMPLE_SHEET_BODY),
          className: 'fa fa-table',
          title: 'Insert sheet',
        },
        {
          name: 'insert-chart',
          action: (editor) => openChartInsertModal(editor),
          className: 'fa fa-bar-chart',
          title: 'Insert chart',
        },
        {
          name: 'insert-panel',
          action: (editor) => openPanelInsertModal(editor),
          className: 'fa fa-square',
          title: 'Insert colored panel',
        },
        {
          name: 'snippets',
          action: () => openSnippetsModal(),
          className: 'fa fa-puzzle-piece',
          title: 'Snippets',
        },
        'horizontal-rule','|',
        {
          name: 'toolbarRowBreak',
          className: 'editor-toolbar-row-break',
          title: '',
          action: () => {},
          attributes: { 'aria-hidden': 'true', tabindex: '-1' },
        },
        {
          name: 'find',
          action: () => editorFind(),
          className: 'fa fa-search',
          title: 'Find (Ctrl+F)',
        },
        {
          name: 'replace',
          action: () => editorReplace(),
          className: 'fa fa-exchange',
          title: 'Find & Replace (Ctrl+H)',
        },
        '|',
        {
          name: 'side-by-side',
          action: () => {
            if (!isEditing) setEditing(true);
            else switchMode('markdown');
          },
          className: 'fa fa-columns no-disable',
          title: 'Side by side',
        },
        'fullscreen','|',
        {
            name: "add-tag",
            action: (editor) => {
                const cm = editor.codemirror;
                const selectedText = cm.getSelection() || "tag";
                cm.replaceSelection(`#${selectedText.replace(/\s+/g, '')} `);
            },
            className: "fa fa-hashtag",
            title: "Als Tag markieren",
        },
        "|", 
        {
          name: "line-break",
          action: (editor) => {
            const cm = editor.codemirror;
            cm.replaceSelection("<br>\n");
            cm.focus();
          },
          className: "fa fa-level-down fa-rotate-90", // Icon das wie ein Return-Pfeil aussieht
          title: "Zeilenumbruch (br)",
        },
        {
          name: "indent",
          action: () => editorIndent(),
          className: "fa fa-indent",
          title: "Einrücken",
        },
        {
          name: "outdent",
          action: () => editorOutdent(),
          className: "fa fa-outdent",
          title: "Ausrücken",
        },
        "|",
        buildColorToolbarDropdown('color', 'textColorMenu', 'fa fa-font', 'Text color'),
        buildColorToolbarDropdown('background-color', 'bgColorMenu', 'fa fa-paint-brush', 'Background color'),
        '|',
        buildFontSizeToolbarDropdown(),
        '|',
        {
          name: "remove-all-formats",
          action: (editor) => {
            const cm = editor.codemirror;
            let text, range;
            
            // 1. Bereich bestimmen (Markierung oder ganze Zeile)
            if (cm.somethingSelected()) {
              text = cm.getSelection();
            } else {
              const cursor = cm.getCursor();
              const lineNum = cursor.line;
              text = cm.getLine(lineNum);
              range = {
                from: { line: lineNum, ch: 0 },
                to: { line: lineNum, ch: text.length }
              };
            }
            
            // 2. Aggressive Bereinigung (Regex mehrmals anwenden für verschachtelte Tags)
            let cleaned = text;
            
            // Entfernt alle HTML-Tags (span, div, etc.)
            cleaned = cleaned.replace(/<\/?[^>]+(>|$)/g, "");
            
            // Entfernt Markdown (Fett, Kursiv, etc.)
            cleaned = cleaned.replace(/(\*\*|__|\*|_|~~|`)/g, "");
            
            // 3. Text im Editor ersetzen
            if (cm.somethingSelected()) {
                    // "around" sorgt dafür, dass die neue Auswahl die alte ersetzt
                    cm.replaceSelection(cleaned, "around");
                } else {
                    cm.replaceRange(cleaned, range.from, range.to);
                }

                // 4. Fokus erzwingen (Wichtig, damit der nächste Klick sofort geht!)
                cm.focus();
            },
            className: "fa fa-eraser",
            title: "Formatierung komplett entfernen",
          },
          '|',
          {
              name: "export-pdf",
              action: (editor) => {
                  const htmlContent = renderMarkdownPreviewHtml(editor.value(), { sheetEditable: false, richBlocks: true });
                  
                  // Create temp container for html2pdf
                  const element = document.createElement('div');
                  element.innerHTML = htmlContent;

                  html2pdf().set({
                    margin: [20, 10, 20, 10],
                    filename: currentPage.title,
                    html2canvas: {
                      scale: 2,   // ✅ high resolution
                      useCORS: true
                    },
                    jsPDF: {
                      unit: 'mm',
                      format: 'a4',
                      orientation: 'portrait'
                    }
                  }).from(element).toPdf().get('pdf').then(function (pdf) {
                    
                    // ✅ add page numbers
                    const totalPages = pdf.internal.getNumberOfPages();

                    for (let i = 1; i <= totalPages; i++) {
                      pdf.setPage(i);

                      pdf.setFontSize(10);
                      pdf.setTextColor(100);

                      pdf.text(
                        `${i} / ${totalPages}`, 
                        105,          // center horizontally (A4 = 210mm)
                        290,          // bottom position
                        { align: 'center' }
                      );
                    }

                  }).save();


                  // Trigger download using html2pdf library
                  // html2pdf().from(element).save('document.pdf');
              },
              className: "fa fa-file-pdf-o", // FontAwesome icon class
              title: "Export to PDF",        // Tooltip text
          },
          '|', 'guide', '|',
        ],
        previewRender: function(plainText) {
          const processed = preprocessMarkdown(plainText, { sheetEditable: false, richBlocks: false });
          const html = this.parent.markdown(processed.markdown);
          const wrap = document.createElement('div');
          wrap.innerHTML = html;
          markFileLinks(wrap);
          applyPreviewImageStyles(wrap);
          return wrap.innerHTML;
        }
    });

    easyMDE.codemirror.setOption("extraKeys", {
        "Tab": function(cm) {
            const cursor = cm.getCursor();
            const line = cm.getLine(cursor.line);

            // If cursor is at end of line → insert real tab
            if (cursor.ch === line.length) {
                cm.replaceSelection("\t");
            } else {
                // Otherwise indent normally
                cm.execCommand("defaultTab");
            }
        },
        "Shift-Tab": "indentLess",
        "Ctrl-F": () => editorFind(),
        "Cmd-F": () => editorFind(),
        "Ctrl-H": () => editorReplace(),
        "Cmd-Alt-F": () => editorReplace(),
        "Shift-Cmd-H": () => editorReplace(),
        "F3": () => editorFindNext(false),
        "Shift-F3": () => editorFindNext(true),
        "Ctrl-G": () => editorFindNext(false),
        "Cmd-G": () => editorFindNext(false),
        "Shift-Ctrl-G": () => editorFindNext(true),
        "Shift-Cmd-G": () => editorFindNext(true),
    });

    easyMDE.codemirror.on('change', () => {
      if (!isEditing) return;
      scheduleSave();
      schedulePreviewRefresh();
    });

    easyMDE.codemirror.on('paste', (cm, e) => {
      let text = e.clipboardData?.getData('text/plain')?.trim();
      if (!text) return;
      text = text.replace(/^["']|["']$/g, '');
      if (!isLocalPathText(text)) return;
      e.preventDefault();
      insertLocalFileLink(text);
    });

    setTimeout(() => { if (easyMDE) easyMDE.codemirror.refresh(); }, 200);
    initEditorPreviewScrollSync();
  }

  async function saveTree(nodeId)
  {
    var v = $('#tree').jstree(true).get_json('#', {flat:true}); // Hol dir den flachen Baum
    const openedNodes = [];
    $('#tree').find(".jstree-open").each(function () {
      openedNodes.push(this.id);
    });
    const state = {
      workspace: workspaceId, // Ihr Workspace-ID
      opened: openedNodes,
      selected: nodeId,
      // csrfmiddlewaretoken: '{{ csrf_token }}'
    };
    console.log("saveTree",workspaceId, nodeId, state);
    url= `api/workspaces/${workspaceId}/saveTree/`
    console.log(apiUrl(url))
    await api(url, 'POST', state, false);
  }


  async function updateUserSettings(settingsDelta = {}) {
    try {
      syncWorkspaceIdFromDom();
      if (!workspaceId) return false;

      const payload = {
        last_workspace_id: Number(workspaceId),
        last_page_id: currentPageId,
        workspace_pages: workspacePages,
        ...settingsDelta,
      };
      const url = `api/workspaces/${workspaceId}/updateUserSettings/`;
      await api(url, 'POST', payload, false);
      return true;
    } catch (err) {
      console.warn('updateUserSettings failed:', err);
      if (err.network) {
        setStatus('Server offline — last page not saved');
      }
      return false;
    }
  }
  
  function isTreeFolder(node) {
    if (!node) return false;
    if (node.id === '#') return true;
    if (node.type === 'folder') return true;
    if (node.original?.type === 'folder') return true;
    return node.original?.data?.is_folder === true;
  }

  function parsePageId(id) {
    if (id === null || id === undefined || id === '' || id === '#') return null;
    const n = parseInt(String(id), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function firstPageNodeId(tree) {
    if (!tree) return null;
    const nodes = tree.get_json('#', { flat: true });
    for (const n of nodes) {
      const node = tree.get_node(n.id);
      if (node && !isTreeFolder(node)) {
        const pageId = parsePageId(n.id);
        if (pageId) return pageId;
      }
    }
    return null;
  }

  function resolveDeleteTargetId(explicitId) {
    if (explicitId != null && explicitId !== '') {
      return parsePageId(explicitId);
    }
    if (selectedTreeNodeId) {
      const fromTree = parsePageId(selectedTreeNodeId);
      if (fromTree) return fromTree;
    }
    return currentPageId;
  }

  function treeCheckCallback(operation) {
    if (!userCanEdit && ['move_node', 'rename_node', 'create_node', 'delete_node'].includes(operation)) {
      return false;
    }
    return true;
  }

  function bindTreeEvents() {
    const $tree = $('#tree');

    $tree.off('select_node.jstree').on('select_node.jstree', function (e, data) {
      const node = data.node;
      if (!node) return;
      selectedTreeNodeId = node.id;
      if (isTreeFolder(node)) return;
      const pageId = parsePageId(node.id);
      if (!pageId) return;
      loadPage(pageId);
      collapseLeftPanel();
    });

    $tree.off('rename_node.jstree').on('rename_node.jstree', function (e, data) {
      api(`api/pages/${data.node.id}/update/`, 'POST', { title: data.text }).then(p => {
        const titleInput = document.getElementById('page-title');
        const titlePreview = document.getElementById('page-title-preview');
        const slugEl = document.getElementById('page-slug');
        if (String(currentPageId) === String(p.id)) {
          if (titleInput) titleInput.value = p.title;
          if (titlePreview) titlePreview.textContent = p.title;
          if (slugEl) slugEl.textContent = p.slug;
        }
      });
    });

    $tree.off('move_node.jstree').on('move_node.jstree', async function (e, data) {
      if (!userCanEdit) return;
      try {
        setStatus('Saving tree…');
        await api('api/pages/reorder/', 'POST', {
          id: data.node.id,
          parent: data.parent,
          position: data.position,
        });
        await updateUserSettings();
        setStatus('Tree saved');
      } catch (err) {
        console.error('Tree reorder failed:', err);
        showToast(err.message || 'Could not save tree order.', 'danger');
        await loadTree(currentPageId, { skipSelectLoad: true });
      }
    });
  }

  function selectTreeNode(id, suppressEvent = false) {
    const pageId = parsePageId(id);
    if (!pageId) return false;
    const tree = $('#tree').jstree(true);
    if (!tree) return false;
    const nodeId = String(pageId);
    const node = tree.get_node(nodeId);
    if (!node || isTreeFolder(node)) return false;
    tree.select_node(nodeId, suppressEvent);
    if (suppressEvent) selectedTreeNodeId = nodeId;
    return true;
  }

  function sortWorkspaceSelect() {
    const select = document.getElementById('workspace-select');
    if (!select) return;
    const selected = select.value;
    const options = Array.from(select.options);
    options.sort((a, b) => a.textContent.localeCompare(b.textContent, undefined, { sensitivity: 'base' }));
    select.replaceChildren(...options);
    if (selected && Array.from(select.options).some((o) => o.value === selected)) {
      select.value = selected;
    }
  }

  async function loadTree(selectId = null, { skipSelectLoad = false } = {}) {
    syncWorkspaceIdFromDom();
    if (!workspaceId) return Promise.resolve();
    const data = await api(`api/workspaces/${workspaceId}/tree/`);
    const existing = $('#tree').jstree(true);
    const target = selectId ?? currentPageId;
    const explicitSelect = selectId != null && selectId !== '';

    return new Promise((resolve) => {
      const finish = () => {
        const tree = $('#tree').jstree(true);
        const suppress = skipSelectLoad;
        if (target && selectTreeNode(target, suppress)) {
          resolve();
          return;
        }
        if (explicitSelect) {
          resolve();
          return;
        }
        const fallbackId = firstPageNodeId(tree);
        if (fallbackId) {
          selectTreeNode(fallbackId);
        } else {
          currentPageId = null;
          currentPage = null;
          selectedTreeNodeId = null;
          switchMode('preview');
        }
        resolve();
      };

      if (existing) {
        if (!data.length) {
          existing.destroy();
          $('#tree').empty();
          selectedTreeNodeId = null;
          currentPageId = null;
          currentPage = null;
          switchMode('preview');
          resolve();
          return;
        }
        $('#tree').one('refresh.jstree', finish);
        existing.settings.core.data = data;
        existing.refresh();
        return;
      }

      $('#tree').one('ready.jstree', finish);
      $('#tree').jstree({
        core: { data, check_callback: treeCheckCallback },
        plugins: ['dnd', 'search', 'types', 'contextmenu'],
        types: { folder: { icon: 'jstree-folder' }, page: { icon: 'jstree-file' } },
        contextmenu: {
          items: function (node) {
            return {
              createPage: { label: 'Create page', action: () => createNode(false, node.id) },
              createFolder: { label: 'Create folder', action: () => createNode(true, node.id) },
              rename: { label: 'Rename', action: () => $('#tree').jstree(true).edit(node) },
              moveWorkspace: {
                label: 'Move to WS',
                action: () => movePageToWorkspace(node.id),
              },
              deleteItem: { label: 'Delete', action: () => deletePage(node.id) }
            };
          }
        }
      });
    });
  }

  async function loadPage(id) {
    const pageId = parsePageId(id);
    if (!pageId) {
      setStatus('Select a page');
      return;
    }

    try {
      setStatus('Loading...');
      currentPage = await api(`api/pages/${pageId}/`);
      currentPageId = currentPage.id;
      setWorkspacePageId(workspaceId, currentPageId);

      const titleInput = document.getElementById('page-title');
      const titlePreview = document.getElementById('page-title-preview');
      const slugEl = document.getElementById('page-slug');

      if (titleInput) titleInput.value = currentPage.title || '';
      if (titlePreview) titlePreview.textContent = currentPage.title || 'Untitled';
      if (slugEl) slugEl.textContent = currentPage.slug || '';

      if (easyMDE) easyMDE.value(currentPage.markdown_content || '');

      if (isEditing) switchMode('markdown');
      else switchMode('preview');

      await updateUserSettings();
      setStatus('Loaded');
    } catch (err) {
      console.error('loadPage failed:', err);
      const msg = err.message || 'Failed to load page';
      setStatus(msg.length > 80 ? 'Failed to load page' : msg);
      if (err.status === 404) {
        currentPageId = null;
        currentPage = null;
      }
    }
  }

  async function savePage() {
    if (!currentPageId || !currentPage) return;

    setStatus('Saving...');

    const titleInput = document.getElementById('page-title');
    const titlePreview = document.getElementById('page-title-preview');
    const slugEl = document.getElementById('page-slug');

    const payload = {
      title: titleInput ? titleInput.value : (currentPage.title || 'Untitled'),
      markdown_content: easyMDE ? easyMDE.value() : ''
    };

    currentPage = await api(`api/pages/${currentPageId}/update/`, 'POST', payload);

    if (slugEl) slugEl.textContent = currentPage.slug || '';
    if (titlePreview) titlePreview.textContent = currentPage.title || 'Untitled';

    const tree = $('#tree').jstree(true);
    if (tree && currentPageId) tree.rename_node(String(currentPageId), currentPage.title);

    setStatus('Saved');
  }

  function scheduleSave() {
    if (!currentPageId || !isEditing) return;
    clearTimeout(autosaveTimer);
    setStatus('Typing...');
    autosaveTimer = setTimeout(savePage, 700);
  }

  function schedulePreviewRefresh() {
    if (!isEditing) return;
    const active = document.activeElement;
    if (active?.classList?.contains('sheet-cell-editable')) return;
    clearTimeout(previewRefreshTimer);
    previewRefreshTimer = setTimeout(renderPreview, 300);
  }

  async function createNode(isFolder, parentId = null) {
    syncWorkspaceIdFromDom();
    if (!workspaceId) {
      showToast('Select a workspace first.', 'warning');
      return;
    }

    try {
      setStatus('Creating...');
      const page = await api('api/pages/create/', 'POST', {
        workspace: workspaceId,
        title: isFolder ? 'New Folder' : 'New Page',
        parent: parentId || '#',
        is_folder: isFolder,
      });

      await loadTree(page.id, { skipSelectLoad: true });
      if (!isFolder) {
        await loadPage(page.id);
      } else {
        const tree = $('#tree').jstree(true);
        const folderId = String(page.id);
        if (tree?.get_node(folderId)) {
          tree.select_node(folderId, true);
          selectedTreeNodeId = folderId;
        }
        currentPageId = null;
        currentPage = null;
      }
      await updateUserSettings();
      setStatus('Ready');
      showToast(isFolder ? 'Folder created.' : 'Page created.', 'success', 2000);
    } catch (err) {
      console.error('createNode failed:', err);
      showToast(err.message || 'Could not create page.', 'danger');
      setStatus('Ready');
    }
  }

  async function movePageToWorkspace(nodeId) {
    const pageId = parsePageId(nodeId);
    if (!pageId) return;

    const select = document.getElementById('workspace-select');
    if (!select) return;

    const targets = [...select.options].filter(
      o => o.value && o.value !== String(workspaceId),
    );
    if (!targets.length) {
      showToast('No other workspace available.', 'danger');
      return;
    }

    const wsLabel = (o) => o.textContent.replace(/\s+/g, ' ').trim();
    const message = targets.map((o, i) => `${i + 1}. ${wsLabel(o)}`).join(', ');
    const pick = prompt(`Move to WS: \n${message}`);
    const idx = parseInt(pick, 10) - 1;
    if (!Number.isFinite(idx) || idx < 0 || idx >= targets.length) return;

    const targetWorkspaceId = parseInt(targets[idx].value, 10);
    try {
      await api(`api/pages/${pageId}/move/`, 'POST', {
        target_workspace_id: targetWorkspaceId,
      });
      showToast(`Moved to "${wsLabel(targets[idx])}".`, 'success');
      if (String(currentPageId) === String(pageId)) {
        currentPage = null;
        currentPageId = null;
        const titleInput = document.getElementById('page-title');
        const titlePreview = document.getElementById('page-title-preview');
        const slugEl = document.getElementById('page-slug');
        if (titleInput) titleInput.value = '';
        if (titlePreview) titlePreview.textContent = '';
        if (slugEl) slugEl.textContent = '';
        if (easyMDE) easyMDE.value('');
        switchMode('preview');
      }
      await loadTree();
      await updateUserSettings();
    } catch (err) {
      showToast(err.message || 'Could not move item.', 'danger');
    }
  }

  async function deletePage(id) {
    syncWorkspaceIdFromDom();
    const targetId = resolveDeleteTargetId(id);
    if (!targetId) {
      showToast('Select a page or folder in the tree first.', 'warning');
      return;
    }
    if (!confirm('Delete this item?')) return;

    try {
      await api(`api/pages/${targetId}/delete/`, 'POST', {});
    } catch (err) {
      showToast(err.message || 'Could not delete item.', 'danger');
      return;
    }

    currentPage = null;
    currentPageId = null;
    selectedTreeNodeId = null;
    setWorkspacePageId(workspaceId, null);

    const titleInput = document.getElementById('page-title');
    const titlePreview = document.getElementById('page-title-preview');
    const slugEl = document.getElementById('page-slug');

    if (titleInput) titleInput.value = '';
    if (titlePreview) titlePreview.textContent = '';
    if (slugEl) slugEl.textContent = '';
    if (easyMDE) easyMDE.value('');

    await loadTree();
    await updateUserSettings();
    setStatus('Deleted');
  }

  async function loadFiles() {
    const files = await api(`api/workspaces/${workspaceId}/files/`);
    const list = document.getElementById('file-list');
    if (!list) return;

    list.innerHTML = files.map(f => `
      <div class="file-item">
        <div>${f.original_name}</div>
        <div>
          <a href="#" class="open-file-link" data-url="${f.furl}" data-name="${f.original_name}">Open</a>
          <button class="btn btn-sm btn-outline-light insert-file" data-url="${f.furl}" data-name="${f.original_name}">Insert</button>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.open-file-link').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        const href = link.dataset.url;
        if (/^file:/i.test(href)) openFileLinkDialog(href, link.dataset.name);
        else openManagedFileDirect(href);
      });
    });

    list.querySelectorAll('.insert-file').forEach(btn => {
      btn.addEventListener('click', () => {
        ensureEditingForInsert();
        const rawUrl = btn.dataset.url;
        const name = btn.dataset.name || '';
        const url = mediaMarkdownPath(rawUrl);
        if (!easyMDE) return;
        if (isImageFileHref(url)) {
          const fileName = url.split('/').pop();
          const cleanName = fileName.replace(/_[A-Za-z0-9]+(?=\.[a-z0-9]+$)/i, '');
          easyMDE.codemirror.replaceSelection(`![${cleanName}](${url})\n`);
          easyMDE.codemirror.focus();
          scheduleSave();
          return;
        }
        insertMarkdownFileLink(rawUrl, name);
        showToast('Link inserted.', 'success', 2000);
      });
    });
  }

  async function handleFiles(fileList) {
    for (const file of fileList) {
      const data = new FormData();
      data.append('workspace', workspaceId);
      data.append('file', file);
      await api('api/uploads/', 'POST', data, true);
    }
    setStatus('Upload complete');
    await loadFiles();
  }

  function syncWorkspaceOwnerControls(selectedOption) {
    const isOwner = selectedOption?.dataset?.ownerId
      && String(selectedOption.dataset.ownerId) === String(currentUserId);
    ['ws-rename-btn', 'ws-delete-btn', 'admin-link'].forEach(id => {
      document.getElementById(id)?.classList.toggle('d-none', !isOwner);
    });
  }

  function bindUi() {
    bindTreeEvents();
    document.getElementById('page-title')?.addEventListener('change', savePage);
    document.getElementById('create-page')?.addEventListener('click', () => createNode(false));
    document.getElementById('create-folder')?.addEventListener('click', () => createNode(true));
    document.getElementById('delete-page')?.addEventListener('click', () => deletePage());

    function syncWorkspaceOwnerActions() {
      const select = document.getElementById('workspace-select');
      const selectedOption = select?.options[select?.selectedIndex];
      syncWorkspaceOwnerControls(selectedOption);
    }

    document.getElementById('workspace-select')?.addEventListener('change', async e => {
      syncWorkspaceOwnerActions();
      const prevWs = workspaceId;
      const prevPage = currentPageId;
      if (prevWs && prevPage) setWorkspacePageId(prevWs, prevPage);

      const newWs = e.target.value;
      if (prevWs && String(prevWs) !== String(newWs)) {
        try {
          await api(`api/workspaces/${prevWs}/updateUserSettings/`, 'POST', {
            last_workspace_id: Number(prevWs),
            last_page_id: prevPage,
            workspace_pages: workspacePages,
          }, false);
        } catch (err) {
          console.warn('save workspace page before switch failed:', err);
        }
      }

      workspaceId = newWs;
      currentPageId = getWorkspacePageId(newWs);
      currentPage = null;
      selectedTreeNodeId = null;
      await loadTree(currentPageId);
      await updateUserSettings();
      await loadFiles();
      connectTagWs();
      if (isEditing) switchMode('markdown');
      else switchMode('preview');
    });

    syncWorkspaceOwnerActions();

    document.getElementById('new-workspace')?.addEventListener('click', async () => {
      const name = prompt('Workspace name');
      if (!name) return;

      const ws = await api('api/workspaces/', 'POST', { name });
      const select = document.getElementById('workspace-select');
      if (!select) return;

      const option = document.createElement('option');
      option.value = ws.id;
      option.textContent = ws.name;
      if (currentUserId) option.dataset.ownerId = String(currentUserId);
      select.appendChild(option);
      sortWorkspaceSelect();
      select.value = ws.id;

      workspaceId = ws.id;
      currentPageId = null;
      currentPage = null;
      // await loadTree();
      // await updateUserSettings();
      // await loadFiles();
    });

    // CREATE: Add Workspace
// CREATE: Add Workspace
    document.getElementById('ws-add-btn')?.addEventListener('click', async (e) => {
        e.preventDefault();
        const name = prompt('Enter new workspace name:');
        if (!name || !name.trim()) {
            renameBox.classList.add('d-none');
            return;
        }
        try {
            const result = await api('api/workspaces/create/', 'POST', { name: name.trim() });
            if (!result.id) {
                showToast(result.message || 'Workspace created but no ID returned.', 'danger');
                return;
            }
            const select = document.getElementById('workspace-select');
            if (!select) return;

            const newOption = document.createElement('option');
            newOption.value = String(result.id);
            newOption.textContent = result.name || name.trim();
            if (currentUserId) newOption.dataset.ownerId = String(currentUserId);
            select.appendChild(newOption);
            sortWorkspaceSelect();
            select.value = String(result.id);
            workspaceId = result.id;
            select.dispatchEvent(new Event('change'));
            renameBox.classList.add('d-none');
        } catch (err) {
            showToast(err.message || 'Could not create workspace.', 'danger');
        }
    });

    const renameBox = document.getElementById('ws-rename-box');
    document.getElementById('ws-rename-btn').addEventListener('click',async () => {
      const workspaceSelect = document.getElementById('workspace-select');
      const selectedOption = workspaceSelect.options[workspaceSelect.selectedIndex];
      if (!selectedOption) return;
      
      const renameInput = document.getElementById('ws-rename-input');
      renameInput.value = selectedOption.text;
      renameBox.classList.remove('d-none');
    });
    const cancelBtn = document.getElementById('ws-cancel-btn');
    // const workspaceModal = document.getElementById('workspace-modal'); // Dein Modal-Container

    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            renameBox.classList.add('d-none');
            // Option A: Wenn du ein Bootstrap-Modal nutzt
            // const modalInstance = bootstrap.Modal.getInstance(workspaceModal);
            // if (modalInstance) modalInstance.hide();

            // Option B: Reines Vanilla JS (Klasse zum Verstecken entfernen/hinzufügen)
            // workspaceModal.classList.add('hidden');
            
            // Option C: Eventuell das Formular zurücksetzen
            // const wsForm = document.getElementById('workspace-form');
            // if (wsForm) wsForm.reset();
            
            console.log("Workspace-Aktion wurde abgebrochen.");
        });
    }
        // UPDATE: Save New Name
    document.getElementById('ws-save-btn').addEventListener('click', async () => {
        const workspaceSelect = document.getElementById('workspace-select');
        const renameInput = document.getElementById('ws-rename-input');
        const renameBox = document.getElementById('ws-rename-box');
        const workspaceId = workspaceSelect.value;
        const newName = renameInput.value.trim();
        if (newName && workspaceId) {
            api(`api/workspaces/${workspaceId}/update/`,'POST', { name: newName });
            workspaceSelect.options[workspaceSelect.selectedIndex].text = newName;
            sortWorkspaceSelect();
            workspaceSelect.value = workspaceId;
            renameInput.value = '';
            renameBox.classList.add('d-none'); 
        } else {
            renameBox.classList.add('d-none');
        } 
    });

    async function restoreWorkspace(select, wsId, wsName) {
      const result = await api(`api/workspaces/${wsId}/restore/`, 'POST', {});
      const option = document.createElement('option');
      option.value = String(result.id || wsId);
      option.textContent = result.name || wsName;
      if (currentUserId) option.dataset.ownerId = String(currentUserId);
      select.appendChild(option);
      sortWorkspaceSelect();
      select.value = option.value;
      workspaceId = option.value;
      select.dispatchEvent(new Event('change'));
      showToast(`Workspace "${result.name || wsName}" restored.`, 'success');
    }

    async function handleDelete(select, selectedOption, wsId) {
      if (!confirm(`Are you sure you want to delete "${selectedOption.text}"?`)) {
        renameBox.classList.add('d-none');
        return;
      }
      const wsName = selectedOption.text;
      try {
        await api(`api/workspaces/${wsId}/delete/`, 'POST', {});
        const deletedIndex = select.selectedIndex;
        select.remove(deletedIndex);
        if (select.options.length) {
          select.selectedIndex = Math.min(deletedIndex, select.options.length - 1);
          select.dispatchEvent(new Event('change'));
        } else {
          workspaceId = null;
          currentPageId = null;
          currentPage = null;
        }
        showUndoToast(`Workspace "${wsName}" deleted.`, async () => {
          await restoreWorkspace(select, wsId, wsName);
        });
      } catch (error) {
        showToast(error.message || 'Could not delete workspace.', 'danger');
      }
    }

// DELETE: Remove Workspace (owner only; undo via toast)
  document.getElementById('ws-delete-btn')?.addEventListener('click', () => {
    const select = document.getElementById('workspace-select');
    const wsId = select?.value;
    const selectedOption = select?.options[select.selectedIndex];
    if (!wsId || !selectedOption) return;
    handleDelete(select, selectedOption, wsId);
    // if (confirm(`Are you sure you want to delete "${selectedOption.text}"?`)) {
    //     await api(`api/workspaces/${workspaceId}/delete/`,'POST', false)
    //     .then(data => {
    //       //     // Remove option block from DOM structures directly
    //           select.remove(select.selectedIndex);
              
    //       //     // Automatically switch layout view to the next remaining workspace option
    //           select.dispatchEvent(new Event('change'));
    //     });
    // }
  });



    const userListContainer = document.getElementById('worksheet-users');
    const searchInput = document.getElementById('user-search-input');
    const resultsDropdown = document.getElementById('search-results-dropdown');
    const spinnerContainer = document.getElementById('search-spinner-container');
    let searchTimer;

    if (searchInput) {
    searchInput.addEventListener('input', function() {
        const query = this.value.trim();
        
        if (query.length < 2) {
            resultsDropdown?.classList.add('d-none');
            spinnerContainer?.classList.add('d-none');
            return;
        }

        spinnerContainer?.classList.remove('d-none');

        // Debounce: Verhindert zu viele API-Anfragen kurz hintereinander
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            fetch(apiUrl(`/api/users/search/?q=${encodeURIComponent(query)}`))
                .then(res => res.json())
                .then(data => {
                    // Verstecke den Spinner, sobald Daten da sind
                    spinnerContainer?.classList.add('d-none');
                    if (resultsDropdown) resultsDropdown.innerHTML = '';
                    
                    if (data.status === 'success' && data.users.length > 0) {
                        data.users.forEach(user => {
                            const li = document.createElement('li');
                            li.className = 'list-group-item list-group-item-action py-1 px-2 border-0 workspace-search-hit';
                            li.style.cursor = 'pointer';
                            li.style.fontSize = '0.85rem';
                            li.innerHTML = `➕ <strong>${user.username}</strong> <small class="workspace-members-hint">(${user.email || 'no email'})</small>`;
                            
                            li.addEventListener('click', () => {
                                addMemberToWorkspace(user.username);
                                resultsDropdown.classList.add('d-none');
                                searchInput.value = '';
                            });
                            
                            resultsDropdown?.appendChild(li);
                        });
                        resultsDropdown?.classList.remove('d-none');
                    } else if (resultsDropdown) {
                        resultsDropdown.innerHTML = '<li class="list-group-item workspace-members-hint py-1 px-2 border-0 small">No users found</li>';
                        resultsDropdown.classList.remove('d-none');
                    }
                })
                .catch(err => {
                    spinnerContainer?.classList.add('d-none');
                    console.error('Suchfehler:', err);
                });
        }, 300); // Wartet 300ms nach dem letzten Tastendruck
    });


    // Schliesse das Such-Dropdown, wenn man ausserhalb klickt
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !resultsDropdown?.contains(e.target)) {
            resultsDropdown?.classList.add('d-none');
        }
    });
    }

    // 2. MITGLIED HINZUFÜGEN: Sendet Daten an die View
    function addMemberToWorkspace(username) {
        const workspaceId = document.getElementById('workspace-select')?.value;
        if (!workspaceId) return;

        fetch(apiUrl('/api/workspaces/add-user/'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': document.querySelector('[name=csrfmiddlewaretoken]')?.value
            },
            body: JSON.stringify({ username: username, workspace_id: workspaceId })
        })
        .then(res => res.json())
        .then(result => {
            if (result.status === 'success') {
                loadWorkspaceMembers(workspaceId);
                showToast(`${result.username} added.`, 'success');
            } else {
                showToast(result.message || 'Error adding member.', 'danger');
            }
        })
        .catch(() => showToast('action failed.', 'danger'));
    }

      const select = document.getElementById('workspace-select');

      // Main function to load and render members
      function loadWorkspaceMembers(workspaceId) {
        if (!workspaceId) return;

        fetch(apiUrl(`/api/workspaces/${workspaceId}/members/`))
        .then(res => res.json())
        // .then(
        //   res => 
        //     // if (res.ok)
        //     res.json()
        //   )
        .then(data => {
            if (data.status === 'success') {
                window.isCurrentUserOwner = data.is_current_user_owner;

                const currentUserMembership = data.members.find(m => m.id === currentUserId);
                const currentUserRole = currentUserMembership ? currentUserMembership.role : 'read';
                syncUserEditAccess(data.is_current_user_owner, currentUserRole);

                // Danach wird deine Liste wie gewohnt gezeichnet
                const userListContainer = document.getElementById('worksheet-users');
                userListContainer.innerHTML = '';
                const members = [...data.members].sort((a, b) =>
                  (a.username || '').localeCompare(b.username || '', undefined, { sensitivity: 'base' }),
                );
                members.forEach(member => {
                    appendUserRow(member.id, member.username, member.is_owner, member.role);
                });
                updateBadgeCount();
                const inviteBox = document.getElementById('invite-email-box');
                if (inviteBox) {
                    if (data.is_current_user_owner) inviteBox.classList.remove('d-none');
                    else inviteBox.classList.add('d-none');
                }
                populateMailRecipients(data.members);
            }
        })
        .catch(err => console.warn('loadWorkspaceMembers failed:', err));
      }
      // Dynamic row generation builder helper (Updated to support ownership flag)
      function appendUserRow(id, name, isOwner, role) {
          const userListContainer = document.getElementById('worksheet-users');
          if (!userListContainer) return;

          const li = document.createElement('li');
          li.className = 'list-group-item d-flex justify-content-between align-items-center px-2 py-2 border-0 rounded-2 mb-1 user-row-hover';
          li.dataset.userId = id;
          
          const initials = name.split(/[\s._-]+/).map(n => n).join('').toUpperCase().substring(0, 2) || name.toUpperCase();
          const colors = ['#4e73df', '#1cc88a', '#36b9cc', '#f6c23e', '#e74a3b', '#6f42c1'];
          const avatarColor = colors[name.charCodeAt(0) % colors.length];

          let actionHTML = '';
          let badgeHTML = '';

          if (isOwner || role === 'owner') {
              badgeHTML = `<span class="badge bg-warning text-dark ms-1" style="font-size: 0.65rem;">Owner</span>`;
              actionHTML = `<span class="text-muted small" title="Workspace Owner">🔒</span>`;
          } else {
              // Erzeuge ein interaktives Badge mit einer ID/Klasse zum späteren Auswählen
              const badgeClass = role === 'write' ? 'bg-info' : 'bg-secondary';
              const badgeText = role === 'write' ? 'write' : 'only read access';
              const pointerStyle = window.isCurrentUserOwner ? 'cursor: pointer;' : '';
              const titleText = window.isCurrentUserOwner ? 'click to change the role' : 'your role';

              badgeHTML = `<span class="badge ${badgeClass} text-white ms-1 role-toggle-badge" style="font-size: 0.65rem; ${pointerStyle}" title="${titleText}">${badgeText}</span>`;

              if (window.isCurrentUserOwner) {
                  actionHTML = `<button class="btn btn-sm btn-link text-danger p-0 border-0 remove-user-btn" style="text-decoration: none;" title="Mitglied entfernen">✕</button>`;
              }
          }

          if (id !== currentUserId) {
              const msgBtn = `<button type="button" class="btn btn-sm btn-link p-0 border-0 private-message-btn" title="Private message" aria-label="Private message">💬</button>`;
              actionHTML = msgBtn + actionHTML;
          }

          li.innerHTML = `
              <div class="d-flex align-items-center gap-2">
                  <div class="avatar-circle d-flex align-items-center justify-content-center text-white fw-bold shadow-sm" 
                      style="background-color: ${avatarColor}; width: 28px; height: 28px; border-radius: 50%; font-size: 0.75rem;">
                      ${initials}
                  </div>
                  <div class="d-flex flex-column">
                      <div class="d-flex align-items-center gap-1">
                          <span class="fw-semibold workspace-member-name mb-0">${name}</span>
                          <span class="badge-container">${badgeHTML}</span>
                      </div>
                  </div>
              </div>
              <div>${actionHTML}</div>
          `;
          const privateMsgBtn = li.querySelector('.private-message-btn');
          if (privateMsgBtn) {
            privateMsgBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              openPrivateChatWithUser(id, name);
            });
          }
          const removeButton = li.querySelector('.remove-user-btn');
          if (removeButton) {
            removeButton.addEventListener('click', () => {
              const workspaceId = document.getElementById('workspace-select').value;
              fetch(apiUrl('/api/workspaces/remove-user/'), {
                  method: 'POST',
                  headers: {
                      'Content-Type': 'application/json',
                      'X-CSRFToken': document.querySelector('[name=csrfmiddlewaretoken]')?.value
                  },
                  body: JSON.stringify({ user_id: id, workspace_id: workspaceId })
              }).then(res => {
                  if (res.ok) {
                      li.remove();
                      updateBadgeCount();
                  }
              });
            });
          }
          if (window.isCurrentUserOwner && role !== 'owner' && !isOwner) {
              const badgeElement = li.querySelector('.role-toggle-badge');
              if (badgeElement) {
                  badgeElement.addEventListener('click', function() {
                      const workspaceId = document.getElementById('workspace-select').value;
                      
                      fetch(apiUrl('/api/workspaces/change-role/'), {
                          method: 'POST',
                          headers: {
                              'Content-Type': 'application/json',
                              'X-CSRFToken': document.querySelector('[name=csrfmiddlewaretoken]')?.value
                          },
                          body: JSON.stringify({ 
                              user_id: id, 
                              workspace_id: workspaceId 
                          })
                      })
                      .then(res => {
                          if (!res.ok) throw new Error('Netzwerkfehler');
                          return res.json();
                      })
                      .then(result => {
                          if (result.status === 'success') {
                              // Aktualisiere das Badge-Design direkt live im DOM
                              if (result.role === 'write') {
                                  this.className = 'badge bg-info text-white ms-1 role-toggle-badge';
                                  this.textContent = 'write';
                              } else {
                                  this.className = 'badge bg-secondary text-white ms-1 role-toggle-badge';
                                  this.textContent = 'only read';
                              }

                              syncUserEditAccess(window.isCurrentUserOwner, result.role);
                              showToast(result.message, 'success');


                          } else {
                              showToast(result.message, 'danger');
                          }
                      })
                      .catch(() => showToast('Rollenwechsel fehlgeschlagen.', 'danger'));
                  });
              }
          }


          // [Hier bleibt dein bestehender Event-Listener für den remove-user-btn...]
          userListContainer.appendChild(li);
      }

      function updateBadgeCount() {
          const countBadge = document.getElementById('user-count');
          if (countBadge && userListContainer) {
              countBadge.textContent = userListContainer.children.length;
          }
      }

      // RUN ON LOAD: Fetch data immediately for the selected item
      if (select && select.value) {
          loadWorkspaceMembers(select.value);
      }

      // RUN ON CHANGE: Fetch dynamic updates if the dropdown selection changes
      if (select) {
          select.addEventListener('change', function() {
              loadWorkspaceMembers(this.value);
          });
      }


 
    const inviteInput = document.getElementById('invite-username');
    const datalist = document.getElementById('user-suggestions');
    let debounceTimer;

    if (inviteInput && datalist) {
        inviteInput.addEventListener('input', function() {
            const query = this.value.trim();
            
            // Zurücksetzen, wenn das Feld geleert wird oder zu kurz ist
            if (query.length < 2) {
                datalist.innerHTML = '';
                return;
            }

            // Debounce: Wartet 300ms nach dem letzten Tastendruck, bevor gefetcht wird
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                fetch(apiUrl(`/api/users/search/?q=${encodeURIComponent(query)}`))
                    .then(res => res.json())
                    .then(data => {
                        datalist.innerHTML = ''; // Alte Vorschläge löschen
                        
                        if (data.status === 'success') {
                            data.users.forEach(user => {
                                const option = document.createElement('option');
                                option.value = user.username; // Wird im Input eingetragen
                                datalist.appendChild(option);
                            });
                        }
                    })
                    .catch(err => console.error('Error fetching user suggestions:', err));
            }, 300);
        });
    }

    let to = null;
    
    document.getElementById('toggle-left')?.addEventListener('click', toggleLeftPanel);
    document.getElementById('toggle-right')?.addEventListener('click', toggleRightPanel);
    document.getElementById('tree-search')?.addEventListener('keyup', function () {
      if (to) 
        clearTimeout(to);
      to = setTimeout(() => $('#tree').jstree(true).search(this.value), 200);
    });

    initTagSearch();

    document.getElementById('file-input')?.addEventListener('change', async e => {
      await handleFiles(e.target.files);
      e.target.value = '';
    });

    const dz = document.getElementById('dropzone');
    ['dragenter','dragover'].forEach(ev => {
      dz?.addEventListener(ev, e => {
        e.preventDefault();
        dz.classList.add('active');
      });
    });

    ['dragleave','drop'].forEach(ev => {
      dz?.addEventListener(ev, e => {
        e.preventDefault();
        dz.classList.remove('active');
      });
    });

    dz?.addEventListener('drop', async e => {
      await handleFiles(e.dataTransfer.files);
    });

    document.getElementById('edit-toggle')?.addEventListener('click', () => {
      setEditing(!isEditing);
    });

    const initialWsOption = document.getElementById('workspace-select')?.options[
      document.getElementById('workspace-select')?.selectedIndex
    ];
    syncWorkspaceOwnerControls(initialWsOption);
    const isOwner = initialWsOption?.dataset?.ownerId
      && String(initialWsOption.dataset.ownerId) === String(currentUserId);
    if (isOwner) syncUserEditAccess(true, 'write');
  }

  initMarked();
  sortWorkspaceSelect();
  bindUi();
  initEditorColorPicker();
  try {
    initEditors();
  } catch (err) {
    console.error('Editor init failed:', err);
    setStatus('Editor failed to load');
  }
  initEditorFindBar();
  initFileLinkDialog();
  initPreviewImageClicks();
  initSheetCellEditors();
  initChartInsertModal();
  initPanelInsertModal();
  initSnippetsModal();
  syncWorkspaceIdFromDom();
  applyLayoutFromSettings();
  setEditing(false);
  initLeftSplitter();
  initEditorSplitter();
  initRightSplitter();
  loadTree(currentPageId).then(() => {
    if (!currentPageId) switchMode('preview');
  });
  loadFiles();
  syncAppShellLayout();
  initChatAndMail();


  document.getElementById('toc-toggle')?.addEventListener('click', function () {
    const toc = document.getElementById('floating-toc');
    if (!toc) return;
    toc.classList.toggle('active');
    const label = this.querySelector('span');
    if (label) label.textContent = toc.classList.contains('active') ? 'close' : 'content';
  });

  async function saveState() {
      const tree = $('#tree').jstree(true);
      const openedNodes = [];
      $('#tree').find(".jstree-open").each(function () {
        openedNodes.push(this.id);
      });
      // var selected = $('#tree').get_selected();
      // const state = {
      //   workspace: workspaceId, // Ihr Workspace-ID
      //   opened: openedNodes,
      //   selected: selected,

      //     // csrfmiddlewaretoken: '{{ csrf_token }}'
      // };
      // await api('api/save-tree-state/', 'POST', data, true);
  }

  document.addEventListener('paste', function (event) {
    const items = (event.clipboardData || event.originalEvent.clipboardData).items;
    for (let index in items) {
      const item = items[index];
      if (item.kind === 'file') {
        event.preventDefault();
        const blob = item.getAsFile();
        const formData = new FormData();
        formData.append('image', blob, 'screenshot.png');
        formData.append('workspace', workspaceId);
        api(`api/upload_pasted_image/`, 'POST', formData, true)
          .then(data => {
            if (data.success) {
              const cm = easyMDE?.codemirror;
              if (!cm) return;

              const linkName = data.file?.original_name?.split('/').pop() || 'screenshot';
              const mediaPath = mediaMarkdownPath(data.url || data.path || data.file?.mediaName);
              const mdLink = `![${linkName}](${mediaPath}){width=100%}`;

              const doc = cm.getDoc();
              const cursor = doc.getCursor();
              doc.replaceRange(mdLink, cursor);
              cm.focus();
              scheduleSave();
            } else {
              console.error('Django meldet Fehler:', data.error);
            }
          })
          .catch(error => {
            console.error('Error:', error);
          });
      }
    }
  });


  function togglePanel(header) {
      const body = header.nextElementSibling;

      body.classList.toggle("collapsed");
      header.classList.toggle("collapsed");
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.panel-header').forEach(header => {
        header.addEventListener('click', function () {
            togglePanel(header);
        });
    });
  });



  function switchWorkspace(workspaceId) {
      $('#tree').jstree(true).settings.core.data.url = api(`api/get-tree/${workspaceId}/`);
      $('#tree').jstree(true).refresh();
  }

  function downloadPDF() {
      const htmlContent = renderMarkdownPreviewHtml(easyMDE.value(), { sheetEditable: false, richBlocks: true });

      // Create a temporary container for rendering
      const element = document.createElement('div');
      element.innerHTML = htmlContent;

      html2pdf().from(element).save('document.pdf');
  }

  function showToast(message, type = 'success', delayMs = 4000) {
      const toastEl = document.getElementById('action-toast');
      const toastMessage = document.getElementById('toast-message');
      if (!toastEl || !toastMessage) return;

      toastEl.classList.remove('bg-success', 'bg-danger', 'bg-warning');
      if (type === 'warning') toastEl.classList.add('bg-warning', 'text-dark');
      else toastEl.classList.add(type === 'success' ? 'bg-success' : 'bg-danger');
      toastMessage.textContent = message;

      const toast = new bootstrap.Toast(toastEl, { delay: delayMs });
      toast.show();
  }

  function showUndoToast(message, onUndo, delayMs = 8000) {
      const toastEl = document.getElementById('action-toast');
      const toastMessage = document.getElementById('toast-message');
      if (!toastEl || !toastMessage) return;

      toastEl.classList.remove('bg-success', 'bg-danger');
      toastEl.classList.add('bg-success');
      toastMessage.innerHTML = '';
      toastMessage.append(document.createTextNode(message + ' '));

      const undoBtn = document.createElement('button');
      undoBtn.type = 'button';
      undoBtn.className = 'btn btn-sm btn-light ms-1';
      undoBtn.textContent = 'Undo';
      undoBtn.addEventListener('click', async () => {
        bootstrap.Toast.getInstance(toastEl)?.hide();
        try {
          await onUndo();
        } catch (err) {
          showToast(err.message || 'Undo failed.', 'danger');
        }
      });
      toastMessage.appendChild(undoBtn);

      const toast = new bootstrap.Toast(toastEl, { delay: delayMs });
      toast.show();
  }

  // ——— Chat & mail ———

  function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text || '';
    return d.innerHTML;
  }

  function populateMailRecipients(members) {
    const sel = document.getElementById('mail-compose-recipients');
    const hint = document.getElementById('mail-recipients-hint');
    if (!sel) return;
    sel.innerHTML = '';
    (members || []).filter(m => m.id !== currentUserId).forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.username + (m.is_owner ? ' (owner)' : '');
      sel.appendChild(opt);
    });
    if (hint) {
      if (!sel.options.length) {
        hint.textContent = 'You are the only member — mail goes to your own inbox.';
        hint.classList.remove('d-none');
      } else {
        hint.textContent = 'Leave empty to mail all other members.';
        hint.classList.remove('d-none');
      }
    }
  }

  function formatChatTime(iso) {
    try {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (_) {
      return '';
    }
  }

  function formatChatDateLabel(iso) {
    try {
      const d = new Date(iso);
      const today = new Date();
      const yesterday = new Date();
      yesterday.setDate(today.getDate() - 1);
      if (d.toDateString() === today.toDateString()) return 'Today';
      if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
      return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    } catch (_) {
      return '';
    }
  }

  function userInitials(name) {
    const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return String(name || '?').slice(0, 2).toUpperCase();
  }

  function updateP2pStatus(status) {
    const el = document.getElementById('dm-p2p-status');
    if (!el) return;
    const labels = {
      p2p: 'Private · end-to-end encrypted',
      connecting: 'Connecting…',
      relay: 'Private · encrypted',
      off: 'Private · encrypted',
    };
    el.textContent = labels[status] || labels.relay;
    el.dataset.status = status || 'relay';
  }

  function setDmTypingVisible(visible) {
    const el = document.getElementById('dm-typing-indicator');
    if (!el) return;
    el.classList.toggle('d-none', !visible);
  }

  function stopDmP2p() {
    if (dmP2pSession) {
      dmP2pSession.disconnect();
      dmP2pSession = null;
    }
    updateP2pStatus('off');
    setDmTypingVisible(false);
    if (dmTypingHideTimer) {
      clearTimeout(dmTypingHideTimer);
      dmTypingHideTimer = null;
    }
    if (dmTypingSendTimer) {
      clearTimeout(dmTypingSendTimer);
      dmTypingSendTimer = null;
    }
  }

  function startDmP2p() {
    stopDmP2p();
    if (!activeDmPeer || !window.DmP2p?.createSession) {
      updateP2pStatus('relay');
      return;
    }
    dmP2pSession = window.DmP2p.createSession({
      selfId: currentUserId,
      peerId: activeDmPeer.id,
      api,
      onEnvelope: handleP2pEnvelope,
      onTyping: () => {
        setDmTypingVisible(true);
        if (dmTypingHideTimer) clearTimeout(dmTypingHideTimer);
        dmTypingHideTimer = setTimeout(() => setDmTypingVisible(false), 2800);
      },
      onAck: (cid) => {
        const bubble = document.querySelector(`[data-cid="${cid}"]`);
        if (bubble) {
          const status = bubble.querySelector('.chat-bubble-status');
          if (status) status.textContent = '✓✓';
        }
      },
      onStatus: updateP2pStatus,
    });
    dmP2pSession.connect().catch(() => updateP2pStatus('relay'));
  }

  async function handleP2pEnvelope(env) {
    if (!activeDmPeer || env.sid === currentUserId) return;
    if (env.cid && dmSeenClientIds.has(env.cid)) return;
    if (env.iv && env.ct) {
      const sig = `${env.iv}:${env.ct}`;
      if (dmSeenCiphertexts.has(sig)) return;
      dmSeenCiphertexts.add(sig);
    }
    if (env.cid) dmSeenClientIds.add(env.cid);
    const msg = {
      id: env.cid || `p2p-${Date.now()}`,
      client_id: env.cid,
      sender_id: env.sid,
      sender: activeDmPeer.username,
      iv: env.iv,
      ciphertext: env.ct,
      created_at: env.at || new Date().toISOString(),
    };
    await renderDmMessages([msg], true);
    dmP2pSession?.sendAck(env.cid);
  }

  function setBubbleDeliveryStatus(el, status) {
    const node = el?.querySelector('.chat-bubble-status');
    if (node) node.textContent = status;
  }

  function setChatPaneMode(mode) {
    const pane = document.getElementById('comm-chat-pane');
    if (!pane) return;
    pane.dataset.paneMode = mode === 'workspace' ? 'group' : 'private';
  }

  function chatModeTabButtons() {
    return document.querySelectorAll('#chat-mode-tabs [data-chat-mode]');
  }

  function refreshActiveChat() {
    if (!isChatPanelVisible()) return;
    if (chatMode === 'private') {
      if (activeDmConversationId) startDmPolling();
      else {
        loadDmConversations().catch(() => {});
        startDmListPolling();
      }
    } else {
      syncWorkspaceIdFromDom();
      if (!workspaceId) {
        showToast('Select a workspace to use group chat.', 'warning');
        return;
      }
      startChatPolling();
      markChatSeen();
    }
  }

  function updateChatInputPlaceholder() {
    const input = document.getElementById('chat-input');
    if (!input) return;
    input.placeholder = chatMode === 'private'
      ? 'Type a private message…'
      : 'Type a group message…';
  }

  function updateDmEmptyState(hasConversations) {
    const empty = document.getElementById('dm-empty-state');
    const list = document.getElementById('dm-conversation-list');
    if (!empty || !list) return;
    empty.classList.toggle('d-none', hasConversations);
    list.classList.toggle('d-none', !hasConversations);
  }

  function stopDmListPolling() {
    if (dmListPollTimer) {
      clearInterval(dmListPollTimer);
      dmListPollTimer = null;
    }
  }

  function startDmListPolling() {
    stopDmListPolling();
    dmListPollTimer = setInterval(() => {
      if (chatMode !== 'private' || activeDmConversationId) return;
      loadDmConversations().catch(() => {});
    }, 5000);
  }

  async function openPrivateChatPanel() {
    const panel = document.getElementById('right-panel');
    if (panel?.classList.contains('collapsed')) {
      document.getElementById('toggle-right')?.click();
    }
    document.querySelectorAll('[data-comm-tab]').forEach(b => {
      b.classList.toggle('active', b.dataset.commTab === 'chat');
    });
    document.getElementById('comm-chat-pane')?.classList.remove('d-none');
    document.getElementById('comm-mail-pane')?.classList.add('d-none');
    if (chatMode !== 'private') setChatMode('private');
    else loadDmConversations().catch(() => {});
  }

  async function openPrivateChatWithUser(userId, username) {
    try {
      await openPrivateChatPanel();
      await ensureDmKeyPair();
      await startDmWithUser(userId);
    } catch (err) {
      showToast(err.message || `Could not open private chat with ${username || 'user'}.`, 'danger');
    }
  }
  function isChatPanelVisible() {
    const panel = document.getElementById('right-panel');
    const chatTab = document.querySelector('[data-comm-tab="chat"]');
    return panel
      && !panel.classList.contains('collapsed')
      && chatTab?.classList.contains('active');
  }

  function isMailPanelVisible() {
    const panel = document.getElementById('right-panel');
    const mailTab = document.querySelector('[data-comm-tab="mail"]');
    return panel
      && !panel.classList.contains('collapsed')
      && mailTab?.classList.contains('active');
  }

  function updateChatUnreadBadge() {
    const badge = document.getElementById('chat-unread-badge');
    if (!badge) return;
    if (isChatPanelVisible()) {
      badge.classList.add('d-none');
      return;
    }
    const unread = Math.max(0, lastChatId - lastSeenChatId);
    if (unread > 0) {
      badge.textContent = unread > 99 ? '99+' : String(unread);
      badge.classList.remove('d-none');
    } else {
      badge.classList.add('d-none');
    }
  }

  function markChatSeen() {
    lastSeenChatId = lastChatId;
    updateChatUnreadBadge();
  }

  function buildChatBubbleHtml(msg, options = {}) {
    const mine = msg.sender_id === currentUserId;
    const time = formatChatTime(msg.created_at);
    const showStatus = options.showStatus && mine;
    const hideSender = options.privateChat;
    let html = '';
    if (!mine && !hideSender) {
      html += `<div class="chat-bubble-sender">${escapeHtml(msg.sender)}</div>`;
    }
    if (msg.body) {
      html += `<div class="chat-bubble-body">${escapeHtml(msg.body)}</div>`;
    }
    if (msg.attachment_url) {
      const url = resolveFileHrefAbsolute(msg.attachment_url);
      const name = msg.attachment_name || msg.attachment_url.split('/').pop() || 'File';
      if (isImageFileHref(msg.attachment_url)) {
        html += `<div class="chat-bubble-attachment"><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(url)}" alt="${escapeHtml(name)}"></a></div>`;
      } else {
        html += `<div class="chat-bubble-attachment"><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">📎 ${escapeHtml(name)}</a></div>`;
      }
    }
    html += `<div class="chat-bubble-meta">`;
    html += `<span class="chat-bubble-time">${escapeHtml(time)}</span>`;
    if (showStatus) {
      html += `<span class="chat-bubble-status">${escapeHtml(options.deliveryStatus || '✓')}</span>`;
    }
    html += `</div>`;
    return html;
  }

  function appendChatDateSeparator(box, iso) {
    const label = formatChatDateLabel(iso);
    if (!label) return;
    const lastSep = box.querySelector('.chat-date-separator:last-of-type');
    if (lastSep?.dataset.dateLabel === label) return;
    const sep = document.createElement('div');
    sep.className = 'chat-date-separator';
    sep.dataset.dateLabel = label;
    sep.textContent = label;
    box.appendChild(sep);
  }

  function renderChatMessages(messages, appendOnly = false) {
    const box = document.getElementById('chat-messages');
    if (!box) return;
    if (!appendOnly) box.innerHTML = '';
    messages.forEach(msg => {
      if (msg.id > lastChatId) lastChatId = msg.id;
      if (appendOnly && box.querySelector(`[data-id="${msg.id}"]`)) return;
      const mine = msg.sender_id === currentUserId;
      const el = document.createElement('div');
      el.className = 'chat-bubble ' + (mine ? 'mine' : 'theirs');
      el.dataset.id = msg.id;
      el.innerHTML = buildChatBubbleHtml(msg);
      box.appendChild(el);
    });
    box.scrollTop = box.scrollHeight;
    if (isChatPanelVisible()) markChatSeen();
    else updateChatUnreadBadge();
  }

  async function uploadChatFile(file) {
    syncWorkspaceIdFromDom();
    const formData = new FormData();
    formData.append('workspace', workspaceId);
    formData.append('file', file);
    const data = await api('api/uploads/', 'POST', formData, true);
    const url = mediaMarkdownPath(data.url || data.file?.url || data.path);
    const name = data.file?.original_name || file.name || 'file';
    return { url, name };
  }

  function setPendingChatAttachment(att) {
    pendingChatAttachment = att;
    const preview = document.getElementById('chat-attachment-preview');
    if (!preview) return;
    if (!att) {
      preview.classList.add('d-none');
      preview.textContent = '';
      return;
    }
    preview.textContent = `Attached: ${att.name}`;
    preview.classList.remove('d-none');
  }

  async function sendChatMessage(body, attachment) {
    syncWorkspaceIdFromDom();
    const payload = { body: body || '' };
    if (attachment?.url) {
      payload.attachment_url = attachment.url;
      payload.attachment_name = attachment.name || '';
    }
    const data = await api(`api/workspaces/${workspaceId}/chat/send/`, 'POST', payload);
    if (data.message) renderChatMessages([data.message], true);
    else await loadChat(false);
  }

  async function loadChat(full = false) {
    syncWorkspaceIdFromDom();
    if (!workspaceId) return;
    const box = document.getElementById('chat-messages');
    try {
      const chatUrl = lastChatId && !full
        ? `api/workspaces/${workspaceId}/chat/?after=${lastChatId}`
        : `api/workspaces/${workspaceId}/chat/`;
      const data = await api(chatUrl);
      if (data.status === 'success') {
        if (data.messages.length) {
          renderChatMessages(data.messages, !full && lastChatId > 0);
        } else if (full && box) {
          box.innerHTML = '<p class="small text-muted text-center px-2 py-3">No group messages yet. Say hello!</p>';
        }
      }
      if (isChatPanelVisible()) markChatSeen();
      else updateChatUnreadBadge();
    } catch (e) {
      console.warn('chat load', e);
      if (full && box) {
        box.innerHTML = `<p class="small text-danger px-2 py-3">${escapeHtml(e.message || 'Could not load group chat.')}</p>`;
      }
    }
  }

  function startChatPolling() {
    stopChatPolling();
    lastChatId = 0;
    loadChat(true);
    chatPollTimer = setInterval(() => loadChat(false), 2000);
  }

  function stopChatPolling() {
    if (chatPollTimer) {
      clearInterval(chatPollTimer);
      chatPollTimer = null;
    }
  }

  // ——— Direct messages (E2E) ———

  function dmBytesToB64(bytes) {
    return btoa(String.fromCharCode(...bytes));
  }

  function dmB64ToBytes(b64) {
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  }

  async function ensureDmKeyPair() {
    if (!window.crypto?.subtle) {
      throw new Error('This browser does not support end-to-end encryption.');
    }
    let privJwk = localStorage.getItem('dm_private_jwk');
    if (!privJwk) {
      const pair = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveKey']
      );
      const exportedPriv = await crypto.subtle.exportKey('jwk', pair.privateKey);
      const exportedPub = await crypto.subtle.exportKey('jwk', pair.publicKey);
      privJwk = JSON.stringify(exportedPriv);
      localStorage.setItem('dm_private_jwk', privJwk);
      localStorage.setItem('dm_public_jwk', JSON.stringify(exportedPub));
      await api('api/dm/keys/set/', 'POST', { public_key_jwk: exportedPub });
    } else {
      const serverKey = await api('api/dm/keys/');
      const storedPub = localStorage.getItem('dm_public_jwk');
      if (!serverKey.public_key_jwk && storedPub) {
        await api('api/dm/keys/set/', 'POST', { public_key_jwk: JSON.parse(storedPub) });
      }
    }
  }

  async function getDmAesKey(peerId) {
    if (dmAesKeyCache.has(peerId)) return dmAesKeyCache.get(peerId);
    await ensureDmKeyPair();
    const data = await api(`api/dm/keys/${peerId}/`);
    if (!data.public_key_jwk) {
      throw new Error('This user has not opened Private chat yet (no encryption key).');
    }
    const privJwk = JSON.parse(localStorage.getItem('dm_private_jwk'));
    const privateKey = await crypto.subtle.importKey(
      'jwk', privJwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveKey']
    );
    const publicKey = await crypto.subtle.importKey(
      'jwk', data.public_key_jwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      [],
      []
    );
    const aesKey = await crypto.subtle.deriveKey(
      { name: 'ECDH', public: publicKey },
      privateKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    dmAesKeyCache.set(peerId, aesKey);
    return aesKey;
  }

  async function encryptDmPayload(peerId, payload) {
    const key = await getDmAesKey(peerId);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(JSON.stringify(payload))
    );
    return { iv: dmBytesToB64(iv), ciphertext: dmBytesToB64(new Uint8Array(ct)) };
  }

  async function decryptDmMessage(msg, peerId) {
    try {
      const key = await getDmAesKey(peerId);
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: dmB64ToBytes(msg.iv) },
        key,
        dmB64ToBytes(msg.ciphertext)
      );
      return JSON.parse(new TextDecoder().decode(plain));
    } catch (_) {
      return { body: '[Unable to decrypt]', attachment_url: '', attachment_name: '' };
    }
  }

  async function dmPreviewText(msg, peerId) {
    const p = await decryptDmMessage(msg, peerId);
    if (p.attachment_url && !p.body) return '📎 Attachment';
    return (p.body || '').slice(0, 60) || '📎 Attachment';
  }

  function isDmPanelVisible() {
    return isChatPanelVisible() && chatMode === 'private' && activeDmConversationId;
  }

  function updateDmUnreadBadge() {
    const badge = document.getElementById('dm-unread-badge');
    if (!badge) return;
    if (isDmPanelVisible()) {
      badge.classList.add('d-none');
      return;
    }
    const unread = Math.max(0, lastDmMessageId - lastSeenDmMessageId);
    if (chatMode === 'private' && !activeDmConversationId && unread > 0) {
      badge.textContent = unread > 99 ? '99+' : String(unread);
      badge.classList.remove('d-none');
    } else if (!isChatPanelVisible() && unread > 0) {
      badge.textContent = unread > 99 ? '99+' : String(unread);
      badge.classList.remove('d-none');
    } else {
      badge.classList.add('d-none');
    }
  }

  function markDmSeen() {
    lastSeenDmMessageId = lastDmMessageId;
    updateDmUnreadBadge();
  }

  async function renderDmMessages(messages, appendOnly = false) {
    const box = document.getElementById('chat-messages');
    if (!box || !activeDmPeer) return;
    if (!appendOnly) box.innerHTML = '';
    for (const msg of messages) {
      if (msg.iv && msg.ciphertext) {
        const sig = `${msg.iv}:${msg.ciphertext}`;
        if (dmSeenCiphertexts.has(sig)) continue;
        dmSeenCiphertexts.add(sig);
      }
      if (msg.client_id) {
        if (dmSeenClientIds.has(msg.client_id)) {
          const existing = document.querySelector(`[data-cid="${msg.client_id}"]`);
          if (existing && msg.id && !String(msg.id).startsWith('p2p-')) {
            existing.dataset.id = msg.id;
          }
          continue;
        }
        dmSeenClientIds.add(msg.client_id);
      } else if (appendOnly && box.querySelector(`[data-id="${msg.id}"]`)) {
        continue;
      }
      if (typeof msg.id === 'number' && msg.id > lastDmMessageId) lastDmMessageId = msg.id;

      const payload = msg.body !== undefined && !msg.ciphertext
        ? { body: msg.body, attachment_url: msg.attachment_url || '', attachment_name: msg.attachment_name || '' }
        : await decryptDmMessage(msg, activeDmPeer.id);
      const rendered = {
        ...msg,
        body: payload.body || '',
        attachment_url: payload.attachment_url || '',
        attachment_name: payload.attachment_name || '',
      };
      appendChatDateSeparator(box, rendered.created_at);
      const mine = msg.sender_id === currentUserId;
      const el = document.createElement('div');
      el.className = 'chat-bubble ' + (mine ? 'mine' : 'theirs');
      if (msg.client_id) el.dataset.cid = msg.client_id;
      if (msg.id) el.dataset.id = msg.id;
      el.innerHTML = buildChatBubbleHtml(rendered, {
        showStatus: mine,
        deliveryStatus: msg._deliveryStatus || '✓',
        privateChat: true,
      });
      box.appendChild(el);
    }
    box.scrollTop = box.scrollHeight;
    if (isDmPanelVisible()) markDmSeen();
    else updateDmUnreadBadge();
  }

  async function loadDmThread(full = false) {
    if (!activeDmConversationId || !activeDmPeer) return;
    try {
      const url = lastDmMessageId && !full
        ? `api/dm/conversations/${activeDmConversationId}/messages/?after=${lastDmMessageId}`
        : `api/dm/conversations/${activeDmConversationId}/messages/`;
      const data = await api(url);
      if (data.status === 'success' && data.messages.length) {
        await renderDmMessages(data.messages, !full && lastDmMessageId > 0);
      } else if (isDmPanelVisible()) {
        markDmSeen();
      } else {
        updateDmUnreadBadge();
      }
    } catch (e) {
      console.warn('dm load', e);
    }
  }

  function startDmPolling() {
    stopDmPolling();
    lastDmMessageId = 0;
    loadDmThread(true);
    dmPollTimer = setInterval(() => loadDmThread(false), 2000);
  }

  function stopDmPolling() {
    if (dmPollTimer) {
      clearInterval(dmPollTimer);
      dmPollTimer = null;
    }
  }

  async function loadDmConversations() {
    try {
      await ensureDmKeyPair();
      const data = await api('api/dm/conversations/');
      const list = document.getElementById('dm-conversation-list');
      if (!list) return;
      list.innerHTML = '';
      if (!data.conversations?.length) {
        updateDmEmptyState(false);
        return;
      }
      updateDmEmptyState(true);
      for (const conv of data.conversations) {
        const item = document.createElement('div');
        item.className = 'dm-conversation-item';
        const preview = conv.last_message
          ? await dmPreviewText(conv.last_message, conv.peer.id)
          : 'No messages yet';
        if (conv.last_message?.id > lastDmMessageId) lastDmMessageId = conv.last_message.id;
        const timeLabel = conv.last_message?.created_at
          ? formatChatTime(conv.last_message.created_at)
          : '';
        item.innerHTML = `
          <div class="dm-conversation-avatar">${escapeHtml(userInitials(conv.peer.username))}</div>
          <div class="dm-conversation-body">
            <div class="dm-conversation-top">
              <span class="fw-semibold">${escapeHtml(conv.peer.username)}</span>
              <span class="dm-conversation-time">${escapeHtml(timeLabel)}</span>
            </div>
            <div class="dm-preview">${escapeHtml(preview)}</div>
          </div>
          <span class="dm-lock-badge" title="End-to-end encrypted">🔒</span>`;
        item.addEventListener('click', () => openDmThread(conv));
        list.appendChild(item);
      }
      updateDmUnreadBadge();
    } catch (e) {
      showToast(e.message || 'Could not load private chats.', 'danger');
    }
  }

  function openDmThread(conv) {
    activeDmConversationId = conv.id;
    activeDmPeer = conv.peer;
    dmAesKeyCache.delete(conv.peer.id);
    dmSeenClientIds.clear();
    dmSeenCiphertexts.clear();
    const avatar = document.getElementById('dm-peer-avatar');
    if (avatar) avatar.textContent = userInitials(conv.peer.username);
    document.getElementById('dm-peer-name').textContent = conv.peer.username;
    document.getElementById('comm-chat-pane')?.classList.add('dm-thread-active');
    document.getElementById('dm-list-view')?.classList.add('d-none');
    document.getElementById('dm-thread-header')?.classList.remove('d-none');
    document.getElementById('dm-typing-indicator')?.classList.add('d-none');
    stopDmListPolling();
    startDmPolling();
    startDmP2p();
  }

  function closeDmThread() {
    activeDmConversationId = null;
    activeDmPeer = null;
    lastDmMessageId = 0;
    stopDmP2p();
    document.getElementById('comm-chat-pane')?.classList.remove('dm-thread-active');
    document.getElementById('dm-thread-header')?.classList.add('d-none');
    document.getElementById('dm-list-view')?.classList.remove('d-none');
    stopDmPolling();
    startDmListPolling();
    loadDmConversations();
  }

  function setChatMode(mode) {
    chatMode = mode;
    chatModeTabButtons().forEach(btn => {
      btn.classList.toggle('active', btn.dataset.chatMode === mode);
    });
    stopChatPolling();
    stopDmPolling();
    stopDmP2p();
    stopDmListPolling();
    updateChatInputPlaceholder();
    setChatPaneMode(mode);

    if (mode === 'workspace') {
      activeDmConversationId = null;
      activeDmPeer = null;
      document.getElementById('comm-chat-pane')?.classList.remove('dm-thread-active');
      document.getElementById('dm-list-view')?.classList.add('d-none');
      document.getElementById('dm-thread-header')?.classList.add('d-none');
      document.getElementById('dm-typing-indicator')?.classList.add('d-none');
      syncWorkspaceIdFromDom();
      startChatPolling();
    } else {
      activeDmConversationId = null;
      activeDmPeer = null;
      lastDmMessageId = 0;
      document.getElementById('comm-chat-pane')?.classList.remove('dm-thread-active');
      document.getElementById('dm-thread-header')?.classList.add('d-none');
      document.getElementById('dm-list-view')?.classList.remove('d-none');
      document.getElementById('chat-messages').innerHTML = '';
      ensureDmKeyPair()
        .then(() => loadDmConversations())
        .catch(e => showToast(e.message, 'danger'));
      startDmListPolling();
    }
  }

  async function sendDmMessage(body, attachment) {
    if (!activeDmConversationId || !activeDmPeer) return;
    const clientId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const payload = {
      body: body || '',
      attachment_url: attachment?.url || '',
      attachment_name: attachment?.name || '',
    };
    await renderDmMessages([{
      client_id: clientId,
      id: clientId,
      sender_id: currentUserId,
      sender: currentUserName,
      body: payload.body,
      attachment_url: payload.attachment_url,
      attachment_name: payload.attachment_name,
      created_at: createdAt,
      _deliveryStatus: '◷',
    }], true);

    const encrypted = await encryptDmPayload(activeDmPeer.id, payload);
    dmSeenCiphertexts.add(`${encrypted.iv}:${encrypted.ciphertext}`);
    dmP2pSession?.sendEnvelope({
      iv: encrypted.iv,
      ct: encrypted.ciphertext,
      cid: clientId,
      sid: currentUserId,
      at: createdAt,
    });

    const data = await api(
      `api/dm/conversations/${activeDmConversationId}/send/`,
      'POST',
      encrypted
    );
    if (data.message) {
      const bubble = document.querySelector(`[data-cid="${clientId}"]`);
      if (bubble) {
        bubble.dataset.id = data.message.id;
        setBubbleDeliveryStatus(bubble, '✓');
      }
      if (data.message.id > lastDmMessageId) lastDmMessageId = data.message.id;
    } else {
      await loadDmThread(false);
    }
  }

  async function startDmWithUser(userId) {
    const data = await api('api/dm/conversations/start/', 'POST', { user_id: userId });
    if (data.conversation) openDmThread(data.conversation);
  }

  function bindDmUserSearch() {
    const input = document.getElementById('dm-new-search');
    const results = document.getElementById('dm-search-results');
    if (!input || !results) return;
    input.addEventListener('input', () => {
      clearTimeout(dmSearchTimer);
      const q = input.value.trim();
      if (q.length < 2) {
        results.innerHTML = '';
        return;
      }
      dmSearchTimer = setTimeout(async () => {
        try {
          const data = await api(`api/users/search/?q=${encodeURIComponent(q)}`);
          results.innerHTML = '';
          (data.users || []).forEach(u => {
            const hit = document.createElement('div');
            hit.className = 'dm-search-hit';
            hit.textContent = `${u.username}${u.email ? ` (${u.email})` : ''}`;
            hit.addEventListener('click', async () => {
              input.value = '';
              results.innerHTML = '';
              try {
                await ensureDmKeyPair();
                await startDmWithUser(u.id);
              } catch (err) {
                showToast(err.message || 'Could not start chat.', 'danger');
              }
            });
            results.appendChild(hit);
          });
        } catch (_) {
          results.innerHTML = '';
        }
      }, 250);
    });
  }

  async function loadMailList() {
    syncWorkspaceIdFromDom();
    if (!workspaceId || mailBox === 'compose') return;
    const list = document.getElementById('mail-list');
    if (!list) return;
    const box = mailBox === 'sent' ? 'sent' : 'inbox';
    try {
      const data = await api(`api/workspaces/${workspaceId}/mail/?box=${box}`);
      list.innerHTML = '';
      const badge = document.getElementById('mail-unread-badge');
      if (badge) {
        if (data.unread_count > 0) {
          badge.textContent = data.unread_count;
          badge.classList.remove('d-none');
        } else {
          badge.classList.add('d-none');
        }
      }
      if (!data.messages.length) {
        list.innerHTML = '<p class="small text-muted">No messages.</p>';
        return;
      }
      data.messages.forEach(m => {
        const item = document.createElement('div');
        item.className = 'mail-item' + (m.read === false && box === 'inbox' ? ' unread' : '');
        item.innerHTML = `<strong>${escapeHtml(m.subject)}</strong><br><span class="small text-muted">${escapeHtml(m.sender)} · ${new Date(m.created_at).toLocaleString()}</span>`;
        item.addEventListener('click', () => openMailRead(m));
        list.appendChild(item);
      });
    } catch (e) {
      list.innerHTML = `<p class="small text-danger">${escapeHtml(e.message)}</p>`;
    }
  }

  function showMailView(view) {
    const list = document.getElementById('mail-list-view');
    const read = document.getElementById('mail-read-view');
    const compose = document.getElementById('mail-compose-view');
    if (list) list.classList.toggle('d-none', view !== 'list');
    if (read) read.classList.toggle('d-none', view !== 'read');
    if (compose) compose.classList.toggle('d-none', view !== 'compose');
  }

  async function ensureMailRecipients() {
    syncWorkspaceIdFromDom();
    if (!workspaceId) return;
    try {
      const data = await api(`api/workspaces/${workspaceId}/members/`);
      if (data.status === 'success') populateMailRecipients(data.members);
    } catch (e) {
      console.warn('mail recipients', e);
    }
  }

  function openMailCompose() {
    document.querySelectorAll('[data-comm-tab]').forEach(b => {
      b.classList.toggle('active', b.dataset.commTab === 'mail');
    });
    document.getElementById('comm-chat-pane')?.classList.add('d-none');
    document.getElementById('comm-mail-pane')?.classList.remove('d-none');
    stopChatPolling();

    document.querySelectorAll('[data-mail-box]').forEach(b => {
      b.classList.toggle('active', b.dataset.mailBox === 'compose');
    });
    mailBox = 'compose';
    showMailView('compose');
    ensureMailRecipients();
  }

  async function openMailRead(m) {
    showMailView('read');
    document.getElementById('mail-read-subject').textContent = m.subject;
    document.getElementById('mail-read-meta').textContent = `${m.sender} · ${new Date(m.created_at).toLocaleString()}`;
    document.getElementById('mail-read-body').textContent = m.body;
    if (mailBox === 'inbox' && !m.read) {
      try {
        await api(`api/workspaces/${workspaceId}/mail/${m.id}/read/`, 'POST', {});
        loadMailList();
      } catch (_) { /* ignore */ }
    }
  }

  function initChatAndMail() {
    document.querySelectorAll('[data-comm-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-comm-tab]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.commTab;
        document.getElementById('comm-chat-pane')?.classList.toggle('d-none', tab !== 'chat');
        document.getElementById('comm-mail-pane')?.classList.toggle('d-none', tab !== 'mail');
        if (tab === 'chat') {
          refreshActiveChat();
        } else {
          stopChatPolling();
          stopDmPolling();
          stopDmListPolling();
        }
        if (tab === 'mail') {
          if (mailBox === 'compose') showMailView('compose');
          else { showMailView('list'); loadMailList(); }
        }
        requestAnimationFrame(refreshCommPanelLayout);
      });
    });

    document.querySelectorAll('[data-mail-box]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.mailBox === 'compose') {
          openMailCompose();
          return;
        }
        document.querySelectorAll('[data-mail-box]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        mailBox = btn.dataset.mailBox;
        showMailView('list');
        loadMailList();
      });
    });

    chatModeTabButtons().forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        setChatMode(btn.dataset.chatMode);
      });
    });
    document.getElementById('dm-back-btn')?.addEventListener('click', closeDmThread);
    bindDmUserSearch();

    document.getElementById('mail-back-btn')?.addEventListener('click', () => {
      showMailView('list');
      loadMailList();
    });

    document.getElementById('chat-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      const input = document.getElementById('chat-input');
      const body = input?.value.trim();
      const attachment = pendingChatAttachment;
      if (!body && !attachment) return;
      try {
        if (chatMode === 'private') {
          if (!activeDmConversationId) return;
          await sendDmMessage(body, attachment);
        } else {
          syncWorkspaceIdFromDom();
          if (!workspaceId) {
            showToast('Select a workspace to use group chat.', 'warning');
            return;
          }
          await sendChatMessage(body, attachment);
        }
        if (input) {
          input.value = '';
          input.style.height = 'auto';
        }
        setPendingChatAttachment(null);
        const fileInput = document.getElementById('chat-file-input');
        if (fileInput) fileInput.value = '';
      } catch (err) {
        showToast(err.message || 'Could not send message.', 'danger');
      }
    });

    const chatInput = document.getElementById('chat-input');
    chatInput?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        document.getElementById('chat-form')?.requestSubmit();
      }
    });
    chatInput?.addEventListener('input', () => {
      chatInput.style.height = 'auto';
      chatInput.style.height = `${Math.min(chatInput.scrollHeight, 120)}px`;
      if (chatMode === 'private' && activeDmConversationId && dmP2pSession) {
        if (dmTypingSendTimer) clearTimeout(dmTypingSendTimer);
        dmTypingSendTimer = setTimeout(() => {
          dmP2pSession?.sendTyping();
        }, 300);
      }
    });
    chatInput?.addEventListener('paste', async e => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind !== 'file') continue;
        const file = item.getAsFile();
        if (!file) continue;
        e.preventDefault();
        try {
          const uploaded = await uploadChatFile(file);
          setPendingChatAttachment(uploaded);
        } catch (err) {
          showToast(err.message || 'Could not upload file.', 'danger');
        }
        break;
      }
    });

    document.getElementById('chat-attach-btn')?.addEventListener('click', () => {
      document.getElementById('chat-file-input')?.click();
    });

    document.getElementById('chat-file-input')?.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const uploaded = await uploadChatFile(file);
        setPendingChatAttachment(uploaded);
      } catch (err) {
        showToast(err.message || 'Could not upload file.', 'danger');
      }
    });

    document.getElementById('mail-send-btn')?.addEventListener('click', async () => {
      syncWorkspaceIdFromDom();
      if (!workspaceId) {
        showToast('No workspace selected.', 'danger');
        return;
      }
      const subject = document.getElementById('mail-compose-subject')?.value.trim();
      const body = document.getElementById('mail-compose-body')?.value.trim();
      const sel = document.getElementById('mail-compose-recipients');
      const recipient_ids = sel
        ? [...sel.selectedOptions]
            .map(o => parseInt(o.value, 10))
            .filter(id => Number.isFinite(id) && id > 0)
        : [];
      if (!subject || !body) {
        showToast('Subject and body required.', 'danger');
        return;
      }
      try {
        await api(`api/workspaces/${workspaceId}/mail/send/`, 'POST', { subject, body, recipient_ids });
        showToast('Mail sent.', 'success');
        document.getElementById('mail-compose-subject').value = '';
        document.getElementById('mail-compose-body').value = '';
        mailBox = 'sent';
        document.querySelectorAll('[data-mail-box]').forEach(b => {
          b.classList.toggle('active', b.dataset.mailBox === 'sent');
        });
        showMailView('list');
        loadMailList();
      } catch (err) {
        showToast(err.message || 'Could not send mail.', 'danger');
      }
    });

    document.getElementById('invite-email-btn')?.addEventListener('click', async () => {
      syncWorkspaceIdFromDom();
      const email = document.getElementById('invite-email-input')?.value.trim();
      const role = document.getElementById('invite-email-role')?.value || 'read';
      if (!email) {
        showToast('Enter an email address.', 'danger');
        return;
      }
      try {
        const result = await api(`api/workspaces/${workspaceId}/invite-email/`, 'POST', { email, role });
        showToast(result.message || 'Invitation sent.', 'success', 6000);
        if (result.invite_link) {
          console.info('Invite link:', result.invite_link);
        }
        document.getElementById('invite-email-input').value = '';
        if (result.added_existing_user) {
          document.getElementById('workspace-select')?.dispatchEvent(new Event('change'));
        }
      } catch (err) {
        showToast(err.message || 'Invite failed.', 'danger', 8000);
      }
    });

    const wsSelect = document.getElementById('workspace-select');
    if (wsSelect) {
      wsSelect.addEventListener('change', () => {
        lastChatId = 0;
        lastSeenChatId = 0;
        setPendingChatAttachment(null);
        if (document.querySelector('[data-comm-tab].active')?.dataset.commTab === 'chat') {
          refreshActiveChat();
        }
        if (document.querySelector('[data-comm-tab].active')?.dataset.commTab === 'mail') {
          if (mailBox === 'compose') ensureMailRecipients();
          else loadMailList();
        }
      });
    }

    setChatMode('private');
    updateChatInputPlaceholder();
  }

})()
