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
  let pendingTreeMoveUndo = null;
  let treeMoveConfirmTimer = null;
  let treeMoveMouseListener = null;
  let treeMovePointerListener = null;
  let suppressTreeMovePersist = false;
  let treeMoveConfirmModal = null;
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
  let editorPreviewScrollLockUntil = 0;
  let previewScrollAnchors = [];
  let preservedPreviewScrollTop = null;
  let editorPreviewResizeObserver = null;
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
  let tagWsConnectFailures = 0;
  let tagWsUseHttp = !window.APP_BOOT?.tagWebSocketEnabled
    || sessionStorage.getItem('notespro_tag_ws_http') === '1';
  const TAG_WS_MAX_RETRIES = 1;
  let tagSearchTimer = null;
  let tagAutoOpenNextResult = false;
  let tagsReadyForWorkspace = false;
  let activeTagFilter = '';
  let previewContextLine = null;

  let workspacePages = { ...(window.APP_BOOT?.workspacePages || {}) };
  let workspaceTreeOpen = { ...(window.APP_BOOT?.extraConfigs?.tree_open || {}) };
  let treeOpenSaveTimer = null;

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

  function sanitizeApiErrorMessage(raw, status) {
    let text = String(raw || '').trim();
    if (!text) {
      if (status === 404) return 'Not found';
      if (status === 403) return 'Access denied';
      if (status === 401) return 'Please sign in again';
      return status ? `Request failed (${status})` : 'Request failed';
    }
    // Never surface Apache/nginx/HTML error documents (e.g. "Port 443 … not found on this server").
    if (/<!DOCTYPE|<html[\s>]|<body[\s>]/i.test(text) || /not found on this server/i.test(text) || /\bPort\s+443\b/i.test(text)) {
      if (status === 404) return 'Not found';
      if (status === 403) return 'Access denied';
      if (status === 401) return 'Please sign in again';
      if (status === 502 || status === 503 || status === 504) return 'Server temporarily unavailable';
      return status ? `Request failed (${status})` : 'Unexpected server response';
    }
    if (text.length > 240) text = `${text.slice(0, 237)}…`;
    return text;
  }

  async function api(url, method = 'GET', data = null, isForm = false) {
    const options = {
      method,
      headers: isForm
        ? { 'X-CSRFToken': csrfToken, 'Accept': 'application/json' }
        : { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken, 'Accept': 'application/json' }
    };
    if (data) options.body = isForm ? data : JSON.stringify(data);

    const requestPath = String(url || '').replace(/^\/+/, '');
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
      message = sanitizeApiErrorMessage(message, response.status);
      if (response.status === 404 && requestPath && message === 'Not found') {
        message = `Not found (${requestPath})`;
      }
      const error = new Error(message);
      error.status = response.status;
      error.url = requestPath;
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

  function formatTagMarker(tag) {
    return `{tag:${tag}}`;
  }

  function extractTags(markdown) {
    const set = new Set();
    const headingMatches = [...String(markdown || '').matchAll(/^\s*#{1,6}\s+(.+?)\s*$/gmi)];
    headingMatches.forEach(m => {
      const tag = normalizeTagName(m[1]);
      if (tag) set.add(tag);
    });
    const braceMatches = [...String(markdown || '').matchAll(/\{tag:\s*([^}]+)\}/gi)];
    braceMatches.forEach(m => {
      const tag = normalizeTagName(m[1]);
      if (tag) set.add(tag);
    });
    return [...set];
  }

  function stripInlineTagMarkers(md) {
    return String(md || '').replace(/\{tag:\s*[^}]+\}/gi, '');
  }

  function buildTagsHtml(tags) {
    if (!tags.length) return '';
    return `<div class="md-tags">${tags.map(tag => `<span class="md-tag">${escapeHtml(formatTagMarker(tag))}</span>`).join('')}</div>`;
  }

  function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function findTagDeclarationLine(raw, tag) {
    if (!raw || !tag) return null;
    const re = new RegExp(`\\{tag:\\s*${escapeRegex(tag)}\\s*\\}`, 'i');
    const lines = String(raw).split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (re.test(lines[i])) return i;
    }
    return null;
  }

  function findTagSourceLine(raw, tag) {
    const braceLine = findTagDeclarationLine(raw, tag);
    if (braceLine != null) return braceLine;
    const lines = String(raw).split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const match = lines[i].match(/^#{1,6}\s+(.+?)\s*$/);
      if (match && normalizeTagName(match[1]) === tag) return i;
    }
    return null;
  }

  function findPreviewTargetForLine(preview, lineNum, raw) {
    if (!preview || lineNum == null) return null;
    const lines = String(raw || '').split('\n');
    const lineText = lines[lineNum] || '';
    const headingMatch = lineText.match(/^#{1,6}\s+(.+?)\s*$/);
    if (headingMatch) {
      const id = slugifyHeading(headingMatch[1].trim());
      if (id) {
        const heading = preview.querySelector(`#${id}`);
        if (heading) return heading;
      }
    }

    const exact = preview.querySelector(`[data-source-line="${lineNum}"]`);
    if (exact) return exact;

    const prevHeader = findPrevHeaderLine(lines, lineNum);
    if (prevHeader != null) {
      const prevMatch = lines[prevHeader]?.match(/^#{1,6}\s+(.+?)\s*$/);
      if (prevMatch) {
        const id = slugifyHeading(prevMatch[1].trim());
        if (id) {
          const heading = preview.querySelector(`#${id}`);
          if (heading) return heading;
        }
      }
    }

    let best = null;
    let bestLine = -1;
    preview.querySelectorAll('[data-source-line]').forEach(el => {
      const n = parseInt(el.dataset.sourceLine, 10);
      if (!Number.isFinite(n) || n > lineNum) return;
      if (n >= bestLine) {
        bestLine = n;
        best = el;
      }
    });
    return best;
  }

  function scrollPreviewToElement(target) {
    const preview = document.getElementById('preview-content');
    if (!preview || !target || !preview.contains(target)) return false;
    lockEditorPreviewScroll(400);
    const top = elementScrollTop(preview, target);
    preview.scrollTo({ top: Math.max(0, top - 16), behavior: 'smooth' });
    if (isEditorPreviewSplit() && previewScrollAnchors.length >= 2) {
      syncEditorScrollFromPreview();
    }
    return true;
  }

  function jumpPreviewToLine(lineNum, raw = easyMDE?.value?.() || '') {
    const preview = document.getElementById('preview-content');
    if (!preview || lineNum == null) return false;
    const target = findPreviewTargetForLine(preview, lineNum, raw);
    if (!target) return false;
    return scrollPreviewToElement(target);
  }

  function findPrevHeaderLine(lines, fromLine) {
    if (!Array.isArray(lines) || fromLine == null) return null;
    const start = Math.min(lines.length - 1, Math.max(0, fromLine));
    for (let i = start; i >= 0; i -= 1) {
      if (/^#{1,6}\s+\S/.test(lines[i])) return i;
    }
    return null;
  }

  function jumpEditorToLine(lineNum) {
    const cm = easyMDE?.codemirror;
    if (!cm || lineNum == null) return false;
    const line = Math.max(0, Math.min(cm.lineCount() - 1, lineNum));
    cm.focus();
    cm.setCursor({ line, ch: 0 });
    cm.scrollIntoView({ line, ch: 0 }, 120);
    return true;
  }

  function jumpToTagDeclaration(tagRaw) {
    const tag = normalizeTagName(tagRaw);
    if (!tag) return false;
    const raw = easyMDE?.value?.() || '';
    const line = findTagSourceLine(raw, tag);
    if (line == null) return false;
    const scrolledPreview = jumpPreviewToLine(line, raw);
    if (isEditing && easyMDE?.codemirror) return jumpEditorToLine(line) || scrolledPreview;
    return scrolledPreview;
  }

  function parseTagQuery(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    const brace = trimmed.match(/^\{tag:\s*([^}]+)\}$/i);
    if (brace) return normalizeTagName(brace[1]);
    return normalizeTagName(trimmed);
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

  function tagWsReady() {
    return tagWs && tagWs.readyState === WebSocket.OPEN;
  }

  function resetTagTransport() {
    tagWsConnectFailures = 0;
    tagWsUseHttp = !window.APP_BOOT?.tagWebSocketEnabled
      || sessionStorage.getItem('notespro_tag_ws_http') === '1';
  }

  function initTagTransport() {
    if (tagWsUseHttp) return;
    connectTagWs();
  }

  async function fetchTagsHttp(q = '') {
    syncWorkspaceIdFromDom();
    if (!workspaceId) return;
    try {
      const data = await api(`api/workspaces/${workspaceId}/tags/?q=${encodeURIComponent(q || '')}`);
      handleTagWsMessage({ type: 'tags', tags: data.tags || [] });
    } catch (err) {
      console.warn('fetchTagsHttp failed:', err);
    }
  }

  async function fetchTagPagesHttp(tag, q = '') {
    syncWorkspaceIdFromDom();
    if (!workspaceId || !tag) return;
    try {
      const data = await api(
        `api/workspaces/${workspaceId}/tags/search/?tag=${encodeURIComponent(tag)}&q=${encodeURIComponent(q || '')}`,
      );
      handleTagWsMessage({ type: 'pages', pages: data.pages || [] });
    } catch (err) {
      console.warn('fetchTagPagesHttp failed:', err);
    }
  }

  async function activateTagSearch() {
    syncWorkspaceIdFromDom();
    if (!workspaceId) return false;
    if (tagsReadyForWorkspace) {
      if (!tagWsReady() && !tagWsUseHttp) initTagTransport();
      return true;
    }
    try {
      await api(`api/workspaces/${workspaceId}/tags/rebuild/`, 'POST', {});
    } catch (err) {
      console.warn('rebuild tags failed:', err);
    }
    resetTagTransport();
    initTagTransport();
    tagsReadyForWorkspace = true;
    return true;
  }

  function requestTagList(q = '') {
    if (!tagsReadyForWorkspace) return;
    if (tagWsReady()) {
      sendTagWs({ action: 'list_tags', q });
      return;
    }
    if (tagWsUseHttp) {
      fetchTagsHttp(q);
      return;
    }
    initTagTransport();
  }

  function requestTagPages(tag, q = '') {
    if (!tagsReadyForWorkspace) return;
    if (tagWsReady()) {
      sendTagWs({ action: 'search_pages', tag, q });
      return;
    }
    if (tagWsUseHttp) {
      fetchTagPagesHttp(tag, q);
      return;
    }
    initTagTransport();
  }

  function enableTagHttpFallback() {
    if (tagWsUseHttp) return;
    tagWsUseHttp = true;
    sessionStorage.setItem('notespro_tag_ws_http', '1');
    disconnectTagWs();
    const query = parseTagQuery(document.getElementById('tag-search')?.value);
    fetchTagsHttp(query);
    if (activeTagFilter) fetchTagPagesHttp(activeTagFilter, query);
  }

  function sendTagWs(payload) {
    if (!tagWsReady()) return false;
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
    if (tagWsUseHttp || !window.APP_BOOT?.tagWebSocketEnabled) return;
    disconnectTagWs();
    syncWorkspaceIdFromDom();
    if (!workspaceId) return;

    const socket = new WebSocket(wsTagsUrl(workspaceId));
    tagWs = socket;

    socket.onopen = () => {
      tagWsConnectFailures = 0;
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

    socket.onerror = () => {
      tagWsConnectFailures += 1;
    };

    socket.onclose = () => {
      if (tagWs !== socket) return;
      tagWs = null;
      tagWsConnectFailures += 1;
      if (tagWsConnectFailures >= TAG_WS_MAX_RETRIES) {
        enableTagHttpFallback();
        return;
      }
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
      if (query) requestTagList(query);
      if (activeTagFilter) requestTagPages(activeTagFilter, query);
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
      `<button type="button" class="tag-suggestion" data-tag="${escapeHtml(tag)}">${escapeHtml(formatTagMarker(tag))}</button>`
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

    if (tagAutoOpenNextResult) {
      tagAutoOpenNextResult = false;
      const first = pages[0];
      const pageId = first?.id;
      const tree = $('#tree').jstree(true);
      if (tree && pageId != null) {
        openTreeAncestors(String(pageId));
        tree.deselect_all();
        tree.select_node(String(pageId));
      }
      if (pageId != null) loadPage(pageId);
    }

    box.innerHTML = pages.map(page => (
      `<button type="button" class="tag-result-page" data-page-id="${page.id}">${escapeHtml(page.title)}</button>`
    )).join('');
  }

  function searchPagesByTag(tag, query = '') {
    activeTagFilter = tag;
    requestTagPages(tag, query);
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
        requestTagList('');
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

      requestTagList(query);
    }, 200);
  }

  function initTagSearch() {
    const input = document.getElementById('tag-search');
    if (!input) return;

    input.addEventListener('input', scheduleTagSearch);

    input.addEventListener('focus', async () => {
      await activateTagSearch();
      requestTagList(parseTagQuery(input.value));
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
      input.value = formatTagMarker(tag);
      tagAutoOpenNextResult = true;
      searchPagesByTag(tag);
    });

    document.getElementById('tag-search-results')?.addEventListener('click', async event => {
      const btn = event.target.closest('.tag-result-page');
      if (!btn) return;
      const pageId = btn.dataset.pageId;
      if (!pageId) return;
      const tree = $('#tree').jstree(true);
      if (tree) {
        openTreeAncestors(String(pageId));
        tree.deselect_all();
        tree.select_node(String(pageId));
      }
      await loadPage(pageId);
    });

    document.getElementById('tag-rebuild-btn')?.addEventListener('click', async () => {
      syncWorkspaceIdFromDom();
      if (!workspaceId) return;
      try {
        await api(`api/workspaces/${workspaceId}/tags/rebuild/`, 'POST', {});
        resetTagTransport();
        initTagTransport();
        tagsReadyForWorkspace = true;
        const query = parseTagQuery(input.value);
        requestTagList(query);
        if (activeTagFilter) requestTagPages(activeTagFilter, query);
      } catch (err) {
        console.warn('rebuild tags failed:', err);
      }
    });
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
    marked.setOptions({ gfm: true, breaks: true });
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
    return !!el?.closest?.('.sheet-preview-block, .chart-block, .calendar-block, .gantt-block, .kanban-block, .mindmap-block, .page-tags');
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
    if (!easyMDE || !isPreviewInteractionEnabled() || !cell?.dataset) return false;
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
    if (cell && isPreviewInteractionEnabled()) {
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
    if (cell && isPreviewInteractionEnabled()) {
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
      if (!isPreviewInteractionEnabled()) return;
      if (e.target.closest?.('.md-tag, .md-tags, .calendar-unit, a, button, input, select, textarea')) return;
      setPreviewContextFromEvent(e);
      if (!e.target.closest?.('.sheet-cell-editable')) {
        preview.focus({ preventScroll: true });
      }
    }, true);

    preview.addEventListener('focusin', e => {
      const cell = e.target.closest?.('.sheet-cell-editable');
      if (cell && preview.contains(cell) && isPreviewInteractionEnabled()) {
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
      if (!isPreviewInteractionEnabled()) return;
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

  function expandTabsToNbsp(text, tabSize = EDITOR_TAB_SIZE) {
    const size = Math.max(2, Math.min(8, tabSize));
    return String(text || '').split('\n').map(line => {
      let out = '';
      let col = 0;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '\t') {
          const spaces = size - (col % size);
          out += '\u00A0'.repeat(spaces);
          col += spaces;
        } else {
          out += ch;
          col += 1;
        }
      }
      return out;
    }).join('\n');
  }

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
    // Keep in-line tabs (e.g. name columns) — HTML would otherwise collapse them.
    body = expandTabsToNbsp(body);
    const innerHtml = body ? marked.parse(body) : '';
    return `<div class="md-panel md-panel--${type}"><div class="md-panel-title">${escapeHtml(title)}</div><div class="md-panel-body">${innerHtml}</div></div>`;
  }

  function parsePanelBlocks(text) {
    return text.replace(/```panel(?:\s+(\w+))?\s*\n([\s\S]*?)```/gi, (_, typeRaw, content) => (
      wrapRichPreviewBlock(parsePanelBlockContent(typeRaw, content))
    ));
  }

  const CALENDAR_BLOCK_RE = /```(?:calendar|calender)(?:\{([^}]*)\})?[ \t]*(?:\r?\n([\s\S]*?))?```/gi;
  const CALENDAR_MODES = ['day', 'week', 'month', 'year'];
  const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const MONTH_LABELS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function parseCalendarDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    let m = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
    if (m) {
      let year = parseInt(m[3], 10);
      if (m[3].length === 2) year += year >= 70 ? 1900 : 2000;
      const month = parseInt(m[2], 10) - 1;
      const day = parseInt(m[1], 10);
      const d = new Date(year, month, day);
      if (d.getFullYear() === year && d.getMonth() === month && d.getDate() === day) return d;
      return null;
    }
    m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) {
      const year = parseInt(m[1], 10);
      const month = parseInt(m[2], 10) - 1;
      const day = parseInt(m[3], 10);
      const d = new Date(year, month, day);
      if (d.getFullYear() === year && d.getMonth() === month && d.getDate() === day) return d;
    }
    return null;
  }

  function formatCalendarDate(d) {
    if (!d) return '';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}.${mm}.${yy}`;
  }

  function formatDateInputValue(d) {
    if (!d) return '';
    const yyyy = String(d.getFullYear());
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function setDateInputValue(input, value) {
    if (!input) return;
    if (value instanceof Date) {
      input.value = formatDateInputValue(value);
      return;
    }
    const parsed = parseCalendarDate(value);
    input.value = parsed ? formatDateInputValue(parsed) : '';
  }

  function readDateInputValue(input) {
    return parseCalendarDate(input?.value || '');
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function startOfWeek(d) {
    const date = startOfDay(d);
    const mondayOffset = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - mondayOffset);
    return date;
  }

  function isoWeekNumber(d) {
    const date = startOfDay(d);
    date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
    const week1 = new Date(date.getFullYear(), 0, 4);
    return 1 + Math.round(((date - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  }

  function padCalendarTime(h, m) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function parseCalendarTimeToken(value) {
    const raw = String(value || '').trim();
    if (!raw) return { allday: true, timeFrom: null, timeTo: null };
    const lower = raw.toLowerCase();
    if (/^(allday|all-day|all\s*day|whole\s*day|ganztag)$/i.test(lower)) {
      return { allday: true, timeFrom: null, timeTo: null };
    }
    const range = raw.match(/^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})$/);
    if (range) {
      return {
        allday: false,
        timeFrom: padCalendarTime(range[1], range[2]),
        timeTo: padCalendarTime(range[3], range[4]),
      };
    }
    const single = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (single) {
      return {
        allday: false,
        timeFrom: padCalendarTime(single[1], single[2]),
        timeTo: null,
      };
    }
    return null;
  }

  function formatCalendarTimeToken(entry) {
    if (!entry || entry.allday !== false) return '';
    if (entry.timeFrom && entry.timeTo) return `${entry.timeFrom}-${entry.timeTo}`;
    if (entry.timeFrom) return entry.timeFrom;
    return '';
  }

  function formatCalendarEntryTimeLabel(entry) {
    if (!entry) return '';
    if (entry.allday !== false) {
      return '<span class="calendar-unit-allday" title="All day" aria-label="All day"></span>';
    }
    if (entry.timeFrom && entry.timeTo) {
      return `<span class="calendar-unit-time">${escapeHtml(entry.timeFrom)}–${escapeHtml(entry.timeTo)}</span>`;
    }
    if (entry.timeFrom) {
      return `<span class="calendar-unit-time">${escapeHtml(entry.timeFrom)}</span>`;
    }
    return '';
  }

  function calendarPeriodBarColor(key) {
    const palette = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#0d9488'];
    const s = String(key || '');
    let hash = 0;
    for (let i = 0; i < s.length; i += 1) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    return palette[hash % palette.length];
  }

  function calendarPeriodRole(dateFrom, dateTo, viewDate) {
    if (!dateFrom || !dateTo || !viewDate) return null;
    const from = startOfDay(dateFrom).getTime();
    const to = startOfDay(dateTo).getTime();
    const day = startOfDay(viewDate).getTime();
    if (from === to) return null;
    if (day === from) return 'start';
    if (day === to) return 'end';
    if (day > from && day < to) return 'middle';
    return null;
  }

  function formatCalendarPeriodBar(entry, { showTitle = false, titleText = '' } = {}) {
    const role = entry?.periodRole;
    if (!role) return '';
    const color = calendarPeriodBarColor(entry.key);
    const title = showTitle ? String(titleText || calendarEntryPlainTitle(entry) || '').trim() : '';
    const label = title
      ? `<span class="calendar-unit-period-bar-label">${escapeHtml(title)}</span>`
      : '';
    return `<div class="calendar-unit-period-bar calendar-unit-period-bar--${escapeHtml(role)}${title ? ' calendar-unit-period-bar--labeled' : ''}" style="--period-color:${escapeHtml(color)}">${label}</div>`;
  }

  function calendarEntryPlainTitle(entry) {
    let text = String(entry?.text || '').trim();
    if (!text) return '';
    text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').trim();
    text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    text = text.replace(/[*_`~#>]+/g, '');
    text = text.replace(/\s+/g, ' ').trim();
    return text;
  }

  function calendarPeriodTooltipText(entry, dayEntries = []) {
    if (!entry) return '';
    const related = (dayEntries.length ? dayEntries : [entry]).filter(e => e?.key === entry.key);
    const titles = [];
    related.forEach(e => {
      const title = calendarEntryPlainTitle(e);
      const time = formatCalendarTimeToken(e);
      if (title && time) titles.push(`${title} (${time})`);
      else if (title) titles.push(title);
      else if (time) titles.push(time);
    });
    const uniqueTitles = [...new Set(titles.filter(Boolean))];
    const range = (entry.dateFrom && entry.dateTo)
      ? `${formatCalendarDate(entry.dateFrom)} – ${formatCalendarDate(entry.dateTo)}`
      : '';
    if (uniqueTitles.length && range) return `${uniqueTitles.join('\n')}\n${range}`;
    if (uniqueTitles.length) return uniqueTitles.join('\n');
    return range;
  }

  function parseCalendarDayKeyPayload(payload) {
    const raw = String(payload || '').trim();
    if (!raw) return null;
    const rangeMatch = raw.match(
      /^(\d{1,2}[./-]\d{1,2}[./-](?:\d{2}|\d{4}))\s*(?:-|–|\.\.)\s*(\d{1,2}[./-]\d{1,2}[./-](?:\d{2}|\d{4}))$/,
    );
    if (rangeMatch) {
      let from = parseCalendarDate(rangeMatch[1]);
      let to = parseCalendarDate(rangeMatch[2]);
      if (!from || !to) return null;
      if (to < from) {
        const tmp = from;
        from = to;
        to = tmp;
      }
      return { from, to };
    }
    const from = parseCalendarDate(raw);
    if (!from) return null;
    return { from, to: from };
  }

  function parseCalendarDayKey(key) {
    const m = String(key || '').trim().match(/^@d:(.+)$/i);
    if (!m) return null;
    return parseCalendarDayKeyPayload(m[1]);
  }

  function calendarDayKeyFromDates(from, to) {
    if (!from) return '';
    const start = startOfDay(from);
    const end = to ? startOfDay(to) : start;
    const a = formatCalendarDate(start);
    const b = formatCalendarDate(end < start ? start : end);
    if (a === b) return calendarEntryKey('day', a);
    return calendarEntryKey('day', `${a}-${b}`);
  }

  function normalizeCalendarStorageKey(key) {
    const dayRange = parseCalendarDayKey(key);
    if (dayRange) return calendarDayKeyFromDates(dayRange.from, dayRange.to);
    return String(key || '').toLowerCase();
  }

  function parseCalendarEntryLine(trimmed) {
    const keyMatch = String(trimmed || '').trim().match(/^(@(?:d|w|m|y):[^\s|]+)/i);
    if (!keyMatch) return null;
    const key = normalizeCalendarStorageKey(keyMatch[0]);
    const dayRange = parseCalendarDayKey(key);
    const tail = trimmed.slice(keyMatch[0].length).trim();
    const parts = tail ? tail.split('|').map(p => p.trim()) : [];
    let allday = true;
    let timeFrom = null;
    let timeTo = null;
    let restParts = parts;
    if (parts.length) {
      const timeSpec = parseCalendarTimeToken(parts[0]);
      if (timeSpec) {
        allday = timeSpec.allday;
        timeFrom = timeSpec.timeFrom;
        timeTo = timeSpec.timeTo;
        restParts = parts.slice(1);
      }
    }
    const rest = restParts.join(' | ').trim();
    let text = rest;
    let image = '';
    const imgMatch = rest.match(/!\[[^\]]*\]\(([^)\s]+)\)/);
    if (imgMatch) {
      image = imgMatch[1];
      text = rest.replace(imgMatch[0], '').trim();
    }
    return {
      key,
      text,
      image,
      allday,
      timeFrom,
      timeTo,
      dateFrom: dayRange?.from || null,
      dateTo: dayRange?.to || null,
    };
  }

  function getCalendarBlockSpec(markdown, calendarIndex) {
    const re = new RegExp(CALENDAR_BLOCK_RE.source, CALENDAR_BLOCK_RE.flags);
    let idx = 0;
    let match;
    while ((match = re.exec(String(markdown || ''))) !== null) {
      if (idx === calendarIndex) return parseCalendarSpec(match[1], match[2]);
      idx += 1;
    }
    return null;
  }

  function parseCalendarSpec(fenceAttrs, body = '') {
    const config = { ...parseBacktickConfig(`\`${String(fenceAttrs || '').replace(/`/g, '')}\``) };
    const entries = {};
    String(body || '').split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      if (trimmed.startsWith('`') && trimmed.endsWith('`')) {
        Object.assign(config, parseBacktickConfig(trimmed));
        return;
      }
      const entry = parseCalendarEntryLine(trimmed);
      if (entry) {
        if (!entries[entry.key]) entries[entry.key] = [];
        const sourceIndex = Object.values(entries).reduce((n, list) => n + list.length, 0);
        entries[entry.key].push({
          text: entry.text,
          image: entry.image,
          allday: entry.allday,
          timeFrom: entry.timeFrom,
          timeTo: entry.timeTo,
          key: entry.key,
          dateFrom: entry.dateFrom,
          dateTo: entry.dateTo,
          sourceIndex,
        });
        return;
      }
      const kv = trimmed.match(/^([A-Za-z_-]+)\s*[:=]\s*(.+)$/);
      if (kv) config[kv[1].toLowerCase()] = kv[2].trim();
    });
    let from = parseCalendarDate(config.from);
    let to = parseCalendarDate(config.to);
    if (from && to && to < from) {
      const tmp = from;
      from = to;
      to = tmp;
    }
    const modeRaw = String(config.mode || 'day').toLowerCase();
    const colRaw = String(config.col || config.bg || config.color || '').trim().toLowerCase();
    const panelCols = ['info', 'success', 'warning', 'danger', 'note'];
    let col = '';
    let colCss = '';
    if (panelCols.includes(colRaw)) {
      col = colRaw;
    } else {
      colCss = sanitizeSheetColor(config.col || config.bg || config.color || '');
    }
    return {
      from,
      to,
      mode: CALENDAR_MODES.includes(modeRaw) ? modeRaw : 'day',
      title: (config.title || config.name || '').trim(),
      col,
      colCss,
      entries,
    };
  }

  function calendarEntryKey(mode, payload) {
    if (mode === 'week') return `@w:${payload}`;
    if (mode === 'month') return `@m:${payload}`;
    if (mode === 'year') return `@y:${payload}`;
    return `@d:${payload}`;
  }

  function normalizeCalendarEntryList(entryOrList) {
    if (!entryOrList) return [];
    return Array.isArray(entryOrList) ? entryOrList.filter(Boolean) : [entryOrList];
  }

  function entriesForCalendarDay(entries, date) {
    const day = startOfDay(date).getTime();
    const result = [];
    Object.keys(entries || {}).forEach(key => {
      const dayRange = parseCalendarDayKey(key);
      if (!dayRange) return;
      const from = startOfDay(dayRange.from).getTime();
      const to = startOfDay(dayRange.to || dayRange.from).getTime();
      if (day < from || day > to) return;
      const periodRole = calendarPeriodRole(dayRange.from, dayRange.to || dayRange.from, date);
      normalizeCalendarEntryList(entries[key]).forEach(entry => {
        result.push({
          ...entry,
          key,
          dateFrom: dayRange.from,
          dateTo: dayRange.to || dayRange.from,
          periodRole,
          viewDate: date,
          sourceIndex: Number.isFinite(entry.sourceIndex) ? entry.sourceIndex : 0,
        });
      });
    });
    return result;
  }

  function nextCalendarSourceIndex(entries) {
    let max = -1;
    Object.values(entries || {}).forEach(list => {
      normalizeCalendarEntryList(list).forEach(entry => {
        if (Number.isFinite(entry?.sourceIndex) && entry.sourceIndex > max) max = entry.sourceIndex;
      });
    });
    return max + 1;
  }

  function uniquePeriodEntriesForDay(dayEntries) {
    const byKey = new Map();
    dayEntries.forEach(entry => {
      if (!entry?.periodRole || !entry.key) return;
      const prev = byKey.get(entry.key);
      if (!prev || (entry.sourceIndex ?? 0) < (prev.sourceIndex ?? 0)) byKey.set(entry.key, entry);
    });
    return [...byKey.values()].sort((a, b) => (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0));
  }

  function calendarEntryHasContent(entryOrList) {
    return normalizeCalendarEntryList(entryOrList).some(e => (
      e?.text
      || e?.image
      || (e?.allday === false && e?.timeFrom)
      || !!e?.periodRole
    ));
  }

  function calendarEntriesMarkdown(entryOrList) {
    return normalizeCalendarEntryList(entryOrList)
      .map(e => String(e?.text || '').trim())
      .filter(Boolean)
      .join('\n');
  }

  function calendarNotesFromModalFields(text, image, timeOpts = {}) {
    const lines = String(text || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
    const cleanImage = String(image || '').trim();
    const allday = timeOpts.allday !== false;
    const timeFrom = allday ? null : (timeOpts.timeFrom || null);
    const timeTo = allday ? null : (timeOpts.timeTo || null);
    const sourceIndex = Number.isFinite(timeOpts.sourceIndex) ? timeOpts.sourceIndex : undefined;
    if (!lines.length) {
      if (!cleanImage && allday) return [];
      return [{
        text: '',
        image: cleanImage,
        allday,
        timeFrom,
        timeTo,
        ...(sourceIndex !== undefined ? { sourceIndex } : {}),
      }];
    }
    return lines.map((line, i) => ({
      text: line,
      image: i === 0 ? cleanImage : '',
      allday,
      timeFrom,
      timeTo,
      ...(sourceIndex !== undefined ? { sourceIndex: sourceIndex + i } : {}),
    }));
  }

  function calendarEntryTooltipText(entry) {
    if (!entry) return '';
    const title = calendarEntryPlainTitle(entry);
    const time = formatCalendarTimeToken(entry);
    if (title && time) return `${time}\n${title}`;
    if (title && entry.allday !== false) return title;
    if (title) return title;
    if (time) return time;
    if (entry.allday !== false) return 'All day';
    return '';
  }

  function formatCalendarPeriodBarWrap(entry, dayEntries = [], { showTitle = null } = {}) {
    const related = (dayEntries.length ? dayEntries : [entry]).filter(e => e?.key === entry.key);
    const titles = [...new Set(related.map(calendarEntryPlainTitle).filter(Boolean))];
    const time = related.map(formatCalendarTimeToken).find(Boolean) || '';
    const titleCore = titles.join(' · ');
    const titleText = [time, titleCore].filter(Boolean).join(' ');
    const labeled = showTitle == null
      ? (entry.periodRole === 'start' || entry.periodRole === 'end')
      : !!showTitle;
    const bar = formatCalendarPeriodBar(entry, { showTitle: labeled, titleText });
    if (!bar) return '';
    const noteKey = entry.key ? ` data-calendar-key="${escapeHtml(entry.key)}"` : '';
    const tip = calendarPeriodTooltipText(entry, dayEntries);
    const tipAttr = tip ? ` data-calendar-tooltip="${escapeHtml(tip)}"` : '';
    return `<div class="calendar-unit-period-bar-wrap${labeled && titleText ? ' calendar-unit-period-bar-wrap--labeled' : ''}"${noteKey}${tipAttr}>${bar}</div>`;
  }

  function sortCalendarDaySingles(singles) {
    return [...singles].sort((a, b) => {
      const aAll = a.allday !== false;
      const bAll = b.allday !== false;
      if (aAll !== bAll) return aAll ? -1 : 1;
      const at = a.timeFrom || '';
      const bt = b.timeFrom || '';
      if (at !== bt) return at.localeCompare(bt);
      return (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0);
    });
  }

  function calendarEntryPointMarkup(entry) {
    const tip = calendarEntryTooltipText(entry);
    const tipAttr = tip ? ` data-calendar-tooltip="${escapeHtml(tip)}"` : '';
    const noteKey = entry.key ? ` data-calendar-key="${escapeHtml(entry.key)}"` : '';
    const timed = entry.allday === false && entry.timeFrom;
    const timeText = timed
      ? (entry.timeTo ? `${entry.timeFrom}–${entry.timeTo}` : entry.timeFrom)
      : '';
    const mobile = typeof isMobileLayout === 'function' && isMobileLayout();

    // Mobile: points only. Desktop timed: time text only (title in tooltip).
    if (timed && !mobile) {
      return `<div class="calendar-unit-event-point-row calendar-unit-event-point-row--time-only"${noteKey}${tipAttr}>`
        + `<span class="calendar-unit-event-time">${escapeHtml(timeText)}</span>`
        + `</div>`;
    }
    const pointClass = timed
      ? 'calendar-unit-event-point'
      : 'calendar-unit-event-point calendar-unit-event-point--allday';
    return `<div class="calendar-unit-event-point-row"${noteKey}${tipAttr}>`
      + `<span class="${pointClass}" aria-hidden="true"></span>`
      + `</div>`;
  }

  function calendarEntryPointsMarkup(entryOrList) {
    const list = sortCalendarDaySingles(normalizeCalendarEntryList(entryOrList).filter(e => !e.periodRole));
    if (!list.length) return '';
    return `<div class="calendar-unit-event-points">${list.map(calendarEntryPointMarkup).join('')}</div>`;
  }

  function calendarDayEntriesMarkup(dayEntries) {
    const singles = [];
    const periodItems = [];
    normalizeCalendarEntryList(dayEntries).forEach(entry => {
      if (entry.periodRole) periodItems.push(entry);
      else singles.push(entry);
    });

    const periods = uniquePeriodEntriesForDay(periodItems);
    const compact = (singles.length + periods.length) > 1;
    const mobile = typeof isMobileLayout === 'function' && isMobileLayout();
    const timedSingles = singles.filter(e => e.allday === false && e.timeFrom);
    const otherSingles = singles.filter(e => !(e.allday === false && e.timeFrom));

    // Mobile: always points for day events. Desktop: time for timed; compact points otherwise.
    let singleHtml = '';
    if (mobile) {
      singleHtml = calendarEntryPointsMarkup(singles);
    } else {
      const timedHtml = calendarEntryPointsMarkup(timedSingles);
      const otherHtml = (compact || timedSingles.length || otherSingles.length > 1)
        ? calendarEntryPointsMarkup(otherSingles)
        : calendarEntryMarkup(otherSingles);
      singleHtml = `${timedHtml}${otherHtml}`;
    }

    const stackHtml = periods.length
      ? `<div class="calendar-unit-period-stack">${periods.map(entry => formatCalendarPeriodBarWrap(entry, periodItems, {
        showTitle: !mobile && (entry.periodRole === 'start' || (!compact && entry.periodRole === 'end')),
      })).join('')}</div>`
      : '';

    return `${singleHtml}${stackHtml}`;
  }

  function calendarEntryMarkup(entryOrList) {
    return normalizeCalendarEntryList(entryOrList).map(entry => {
      if (entry.periodRole) return '';
      const raw = String(entry.text || '');
      let textHtml = '';
      if (raw) {
        try {
          textHtml = typeof marked !== 'undefined' ? marked.parse(raw) : escapeHtml(raw);
        } catch (_) {
          textHtml = escapeHtml(raw);
        }
      }
      const image = entry.image
        ? `<img class="calendar-unit-image md-image" src="${escapeHtml(entry.image)}" alt="">`
        : '';
      const timeLabel = formatCalendarEntryTimeLabel(entry);
      const tip = calendarEntryTooltipText(entry);
      const tipAttr = tip ? ` data-calendar-tooltip="${escapeHtml(tip)}"` : '';
      if (!textHtml && !image && !timeLabel) return '';
      const noteKey = entry.key ? ` data-calendar-key="${escapeHtml(entry.key)}"` : '';
      const alldayClass = entry.allday !== false ? ' calendar-unit-note--allday' : '';
      return `<div class="calendar-unit-note${alldayClass}"${noteKey}${tipAttr}>${timeLabel}${image}${textHtml ? `<div class="calendar-unit-text">${textHtml}</div>` : ''}</div>`;
    }).join('');
  }

  function calendarUnitAttrs(key, editable, entryOrList = null) {
    const editAttr = editable ? ' tabindex="0" role="button"' : '';
    const md = calendarEntriesMarkdown(entryOrList);
    const mdAttr = md ? ` data-calendar-markdown="${escapeHtml(md)}"` : '';
    return ` data-calendar-key="${escapeHtml(key)}"${mdAttr}${editAttr}`;
  }

  function collectCalendarDays(from, to) {
    const days = [];
    const cursor = startOfDay(from);
    const end = startOfDay(to);
    let guard = 0;
    while (cursor <= end && guard < 3700) {
      days.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
      guard += 1;
    }
    return days;
  }

  function collectCalendarWeeks(from, to) {
    const weeks = [];
    const cursor = startOfWeek(from);
    const endWeek = startOfWeek(to);
    let guard = 0;
    while (cursor <= endWeek && guard < 530) {
      const weekStart = new Date(cursor);
      const weekEnd = new Date(cursor);
      weekEnd.setDate(weekEnd.getDate() + 6);
      weeks.push({ start: weekStart, end: weekEnd, week: isoWeekNumber(weekStart), year: weekStart.getFullYear() });
      cursor.setDate(cursor.getDate() + 7);
      guard += 1;
    }
    return weeks;
  }

  function collectCalendarMonths(from, to) {
    const months = [];
    const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
    const end = new Date(to.getFullYear(), to.getMonth(), 1);
    let guard = 0;
    while (cursor <= end && guard < 240) {
      months.push({ year: cursor.getFullYear(), month: cursor.getMonth() });
      cursor.setMonth(cursor.getMonth() + 1);
      guard += 1;
    }
    return months;
  }

  function collectCalendarYears(from, to) {
    const years = [];
    for (let y = from.getFullYear(); y <= to.getFullYear() && years.length < 200; y += 1) {
      years.push(y);
    }
    return years;
  }

  function renderCalendarGroup(title, unitsHtml) {
    return [
      `<div class="calendar-group">`,
      `<div class="calendar-group-title">${escapeHtml(title)}</div>`,
      `<div class="calendar-units">${unitsHtml}</div>`,
      `</div>`,
    ].join('');
  }

  function weekBelongsToMonth(week, year, month) {
    // Assign week to the month that contains the Thursday of that ISO week.
    const thursday = new Date(week.start);
    thursday.setDate(thursday.getDate() + 3);
    return thursday.getFullYear() === year && thursday.getMonth() === month;
  }

  function renderCalendarDayUnit(date, from, to, entries, editable, today) {
    const rangeFrom = startOfDay(from);
    const rangeTo = startOfDay(to);
    const day = startOfDay(date);
    if (day < rangeFrom || day > rangeTo) {
      return '<div class="calendar-unit calendar-unit--day calendar-unit--pad" aria-hidden="true"></div>';
    }
    const key = calendarEntryKey('day', formatCalendarDate(day));
    const dayOwn = normalizeCalendarEntryList(entries[key]);
    const entry = entriesForCalendarDay(entries, day);
    const isToday = day.getTime() === today.getTime();
    const classes = [
      'calendar-unit',
      'calendar-unit--day',
      isToday ? 'calendar-unit--today' : '',
      calendarEntryHasContent(entry) ? 'calendar-unit--has-note' : '',
      editable ? 'calendar-unit--editable' : '',
    ].filter(Boolean).join(' ');
    return `<div class="${classes}"${calendarUnitAttrs(key, editable, dayOwn)}>`
      + `<span class="calendar-unit-primary">${day.getDate()}</span>`
      + calendarDayEntriesMarkup(entry)
      + `</div>`;
  }

  function renderCalendarUnitsDay(from, to, entries = {}, editable = false) {
    const today = startOfDay(new Date());
    const rangeFrom = startOfDay(from);
    const rangeTo = startOfDay(to);
    const months = collectCalendarMonths(from, to);
    const weekdayHeader = WEEKDAY_LABELS
      .map(label => `<div class="calendar-weekday-label">${escapeHtml(label)}</div>`)
      .join('');

    return months.map(({ year, month }) => {
      const monthStart = new Date(year, month, 1);
      const monthEnd = new Date(year, month + 1, 0);
      const first = rangeFrom > monthStart ? rangeFrom : monthStart;
      const last = rangeTo < monthEnd ? rangeTo : monthEnd;
      if (first > last) return '';

      const gridStart = startOfWeek(first);
      const gridEnd = startOfWeek(last);
      gridEnd.setDate(gridEnd.getDate() + 6);

      const weekRows = [];
      const cursor = new Date(gridStart);
      let guard = 0;
      while (cursor <= gridEnd && guard < 60) {
        const cells = [];
        for (let i = 0; i < 7; i += 1) {
          const cellDate = new Date(cursor);
          if (cellDate.getFullYear() !== year || cellDate.getMonth() !== month) {
            cells.push('<div class="calendar-unit calendar-unit--day calendar-unit--pad" aria-hidden="true"></div>');
          } else {
            cells.push(renderCalendarDayUnit(cellDate, from, to, entries, editable, today));
          }
          cursor.setDate(cursor.getDate() + 1);
        }
        weekRows.push(`<div class="calendar-week-row">${cells.join('')}</div>`);
        guard += 1;
      }

      return [
        `<div class="calendar-group">`,
        `<div class="calendar-group-title">${escapeHtml(`${MONTH_LABELS_SHORT[month]} ${year}`)}</div>`,
        `<div class="calendar-units calendar-units--weeks">`,
        `<div class="calendar-week-row calendar-week-row--header">${weekdayHeader}</div>`,
        weekRows.join(''),
        `</div>`,
        `</div>`,
      ].join('');
    }).join('');
  }

  function renderCalendarUnitsWeek(from, to, entries = {}, editable = false) {
    const weeks = collectCalendarWeeks(from, to);
    const months = collectCalendarMonths(from, to);
    return months.map(({ year, month }) => {
      const unitHtml = weeks
        .filter(week => weekBelongsToMonth(week, year, month))
        .map(week => {
          const payload = `${week.year}-W${String(week.week).padStart(2, '0')}`;
          const key = calendarEntryKey('week', payload);
          const entry = entries[key];
          const label = `W${String(week.week).padStart(2, '0')}`;
          const range = `${formatCalendarDate(week.start)} – ${formatCalendarDate(week.end)}`;
          const classes = [
            'calendar-unit',
            'calendar-unit--week',
            calendarEntryHasContent(entry) ? 'calendar-unit--has-note' : '',
            editable ? 'calendar-unit--editable' : '',
          ].filter(Boolean).join(' ');
          return `<div class="${classes}"${calendarUnitAttrs(key, editable, entry)}>`
            + `<span class="calendar-unit-primary">${escapeHtml(label)}</span>`
            + `<span class="calendar-unit-secondary">${escapeHtml(range)}</span>`
            + calendarEntryMarkup(entry)
            + `</div>`;
        }).join('');
      if (!unitHtml) return '';
      return renderCalendarGroup(`${MONTH_LABELS_SHORT[month]} ${year}`, unitHtml);
    }).join('');
  }

  function renderCalendarUnitsMonth(from, to, entries = {}, editable = false) {
    const months = collectCalendarMonths(from, to);
    const years = collectCalendarYears(from, to);
    return years.map(year => {
      const unitHtml = months
        .filter(m => m.year === year)
        .map(({ year: y, month }) => {
          const payload = `${y}-${month + 1}`;
          const key = calendarEntryKey('month', payload);
          const entry = entries[key];
          const classes = [
            'calendar-unit',
            'calendar-unit--month',
            calendarEntryHasContent(entry) ? 'calendar-unit--has-note' : '',
            editable ? 'calendar-unit--editable' : '',
          ].filter(Boolean).join(' ');
          return `<div class="${classes}"${calendarUnitAttrs(key, editable, entry)}>`
            + `<span class="calendar-unit-primary">${MONTH_LABELS_SHORT[month]}</span>`
            + calendarEntryMarkup(entry)
            + `</div>`;
        }).join('');
      if (!unitHtml) return '';
      return renderCalendarGroup(String(year), unitHtml);
    }).join('');
  }

  function renderCalendarUnitsYear(from, to, entries = {}, editable = false) {
    const items = collectCalendarYears(from, to).map(year => {
      const key = calendarEntryKey('year', String(year));
      const entry = entries[key];
      const classes = [
        'calendar-unit',
        'calendar-unit--year',
        calendarEntryHasContent(entry) ? 'calendar-unit--has-note' : '',
        editable ? 'calendar-unit--editable' : '',
      ].filter(Boolean).join(' ');
      return `<div class="${classes}"${calendarUnitAttrs(key, editable, entry)}>`
        + `<span class="calendar-unit-primary">${year}</span>`
        + calendarEntryMarkup(entry)
        + `</div>`;
    }).join('');
    return renderCalendarGroup('Years', items);
  }

  function renderCalendarBlockHtml(spec, options = {}) {
    if (!spec.from || !spec.to) {
      return `<div class="calendar-block calendar-block--error">Calendar: invalid <code>from</code>/<code>to</code> (use <code>D.M.YY</code> or <code>D.M.YYYY</code>).</div>`;
    }
    const editable = !!options.editable;
    const entries = spec.entries || {};
    const title = spec.title
      || `${formatCalendarDate(spec.from)} – ${formatCalendarDate(spec.to)}`;
    let bodyHtml = '';
    if (spec.mode === 'week') bodyHtml = renderCalendarUnitsWeek(spec.from, spec.to, entries, editable);
    else if (spec.mode === 'month') bodyHtml = renderCalendarUnitsMonth(spec.from, spec.to, entries, editable);
    else if (spec.mode === 'year') bodyHtml = renderCalendarUnitsYear(spec.from, spec.to, entries, editable);
    else bodyHtml = renderCalendarUnitsDay(spec.from, spec.to, entries, editable);
    const colClass = spec.col ? ` calendar-block--${escapeHtml(spec.col)}` : '';
    const colStyle = spec.colCss ? ` style="--calendar-bg:${escapeHtml(spec.colCss)}"` : '';
    return [
      `<div class="calendar-block${colClass}${editable ? ' calendar-block--editable' : ''}" data-calendar-mode="${escapeHtml(spec.mode)}" data-calendar-index="${options.calendarIndex ?? 0}"${colStyle}>`,
      `<div class="calendar-block-header">`,
      `<div class="calendar-block-title">${escapeHtml(title)}</div>`,
      `<div class="calendar-block-meta">mode: ${escapeHtml(spec.mode)}</div>`,
      `</div>`,
      bodyHtml,
      `</div>`,
    ].join('');
  }

  function serializeCalendarEntries(entries) {
    const rows = [];
    Object.keys(entries || {}).forEach(key => {
      normalizeCalendarEntryList(entries[key]).forEach(entry => {
        rows.push({ key, entry, sourceIndex: Number.isFinite(entry.sourceIndex) ? entry.sourceIndex : 1e9 });
      });
    });
    rows.sort((a, b) => a.sourceIndex - b.sourceIndex || String(a.key).localeCompare(String(b.key)));
    return rows
      .map(({ key, entry }) => {
        const parts = [key];
        const timeToken = formatCalendarTimeToken(entry);
        if (timeToken) parts.push(timeToken);
        if (entry.text) parts.push(String(entry.text).replace(/\r?\n/g, ' ').trim());
        if (entry.image) parts.push(`![](${entry.image})`);
        return parts.filter(Boolean).join(' | ');
      })
      .filter(line => {
        const rest = line.replace(/^@[dwmy]:[^\s|]+\s*(?:\|\s*)?/i, '');
        return !!rest;
      });
  }

  function updateCalendarEntryInMarkdown(markdown, calendarIndex, key, text, image, timeOpts = {}, options = {}) {
    let idx = 0;
    const re = /```(?:calendar|calender)(?:\{([^}]*)\})?[ \t]*(?:\r?\n([\s\S]*?))?```/gi;
    return String(markdown || '').replace(re, (match, fenceAttrs, content = '') => {
      const thisIndex = idx;
      idx += 1;
      if (thisIndex !== calendarIndex) return match;
      const spec = parseCalendarSpec(fenceAttrs, content);
      const entries = { ...(spec.entries || {}) };
      const oldKey = normalizeCalendarStorageKey(options.oldKey || key);
      const targetKey = normalizeCalendarStorageKey(key);
      const previous = normalizeCalendarEntryList(entries[oldKey] || entries[targetKey]);
      let sourceIndex = previous[0]?.sourceIndex;
      if (!Number.isFinite(sourceIndex)) sourceIndex = nextCalendarSourceIndex(entries);
      const notes = calendarNotesFromModalFields(text, image, { ...timeOpts, sourceIndex });
      if (oldKey && oldKey !== targetKey) delete entries[oldKey];
      if (!notes.length) delete entries[targetKey];
      else entries[targetKey] = notes;
      const entryLines = serializeCalendarEntries(entries);
      const body = entryLines.length ? `\n${entryLines.join('\n')}\n` : '\n';
      const fence = fenceAttrs != null && String(fenceAttrs).length
        ? `calendar{${fenceAttrs}}`
        : 'calendar';
      return `\`\`\`${fence}${body}\`\`\``;
    });
  }

  function parseCalendarBlocks(text, options = {}) {
    let calendarIndex = 0;
    return text.replace(CALENDAR_BLOCK_RE, (_, fenceAttrs, content) => {
      const spec = parseCalendarSpec(fenceAttrs, content);
      const idx = calendarIndex++;
      return wrapRichPreviewBlock(renderCalendarBlockHtml(spec, {
        editable: !!options.sheetEditable || !!options.calendarEditable,
        calendarIndex: idx,
      }));
    });
  }

  const GANTT_BLOCK_RE = /```(?:gantt|gant)(?:\{([^}]*)\})?[ \t]*(?:\r?\n([\s\S]*?))?```/gi;
  const GANTT_BAR_COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777'];

  function parseGanttSpec(fenceAttrs, body = '') {
    const config = { ...parseBacktickConfig(`\`${String(fenceAttrs || '').replace(/`/g, '')}\``) };
    const tasks = [];
    let bodyTitle = '';
    let expectingTitle = true;
    String(body || '').split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (expectingTitle) {
        expectingTitle = false;
        if (trimmed.match(/^#\s+(.+)/)) {
          bodyTitle = trimmed.replace(/^#\s+/, '').trim();
          return;
        }
        if (trimmed.match(/^title:\s*(.+)/i) && !trimmed.includes('|')) {
          bodyTitle = trimmed.replace(/^title:\s*/i, '').trim();
          return;
        }
      }
      if (trimmed.startsWith('#')) return;
      if (trimmed.startsWith('`') && trimmed.endsWith('`')) {
        Object.assign(config, parseBacktickConfig(trimmed));
        return;
      }
      const kv = trimmed.match(/^([A-Za-z_-]+)\s*[:=]\s*(.+)$/);
      if (kv && !trimmed.includes('|')) {
        config[kv[1].toLowerCase()] = kv[2].trim();
        return;
      }
      // Task: Label | from | to | optional markdown note | optional ![](img)
      const parts = trimmed.split('|').map(p => p.trim()).filter((p, i, arr) => i === 0 || p || arr.length > 1);
      if (parts.length < 3) return;
      let from = parseCalendarDate(parts[1]);
      let to = parseCalendarDate(parts[2]);
      if (!from || !to) return;
      if (to < from) {
        const tmp = from;
        from = to;
        to = tmp;
      }
      let note = parts.slice(3).join(' | ').trim();
      let image = '';
      const imgMatch = note.match(/!\[[^\]]*\]\(([^)\s]+)\)/);
      if (imgMatch) {
        image = imgMatch[1];
        note = note.replace(imgMatch[0], '').trim();
      }
      tasks.push({
        id: `t${tasks.length + 1}`,
        label: parts[0] || `Task ${tasks.length + 1}`,
        from,
        to,
        text: note,
        image,
      });
    });
    let from = parseCalendarDate(config.from);
    let to = parseCalendarDate(config.to);
    if (!from && tasks.length) {
      from = tasks.reduce((min, t) => (t.from < min ? t.from : min), tasks[0].from);
    }
    if (!to && tasks.length) {
      to = tasks.reduce((max, t) => (t.to > max ? t.to : max), tasks[0].to);
    }
    if (from && to && to < from) {
      const tmp = from;
      from = to;
      to = tmp;
    }
    const colRaw = String(config.col || config.bg || config.color || '').trim().toLowerCase();
    const panelCols = ['info', 'success', 'warning', 'danger', 'note'];
    let col = '';
    let colCss = '';
    if (panelCols.includes(colRaw)) col = colRaw;
    else colCss = sanitizeSheetColor(config.col || config.bg || config.color || '');
    return {
      from,
      to,
      title: (config.title || config.name || bodyTitle || '').trim(),
      col,
      colCss,
      tasks,
    };
  }

  function daysBetweenInclusive(from, to) {
    const a = startOfDay(from).getTime();
    const b = startOfDay(to).getTime();
    return Math.floor((b - a) / 86400000) + 1;
  }

  function ganttTaskMarkup(task) {
    const raw = String(task.text || '');
    let textHtml = '';
    if (raw) {
      try {
        textHtml = typeof marked !== 'undefined' ? marked.parse(raw) : escapeHtml(raw);
      } catch (_) {
        textHtml = escapeHtml(raw);
      }
    }
    const image = task.image
      ? `<img class="gantt-task-image md-image" src="${escapeHtml(task.image)}" alt="">`
      : '';
    if (!textHtml && !image) return '';
    return `<div class="gantt-task-note">${image}${textHtml ? `<div class="gantt-task-text">${textHtml}</div>` : ''}</div>`;
  }

  function renderGanttScale(from, to) {
    const days = daysBetweenInclusive(from, to);
    const showMonths = days > 45;
    let ticks = '';
    if (showMonths) {
      const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
      const end = new Date(to.getFullYear(), to.getMonth(), 1);
      while (cursor <= end) {
        const monthStart = cursor < from ? from : new Date(cursor);
        const monthEndDate = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
        const monthEnd = monthEndDate > to ? to : monthEndDate;
        const left = ((monthStart - from) / 86400000) / Math.max(1, days - 1) * 100;
        const width = (daysBetweenInclusive(monthStart, monthEnd) / days) * 100;
        ticks += `<div class="gantt-scale-tick" style="left:${left}%;width:${width}%"><span>${MONTH_LABELS_SHORT[cursor.getMonth()]} ${cursor.getFullYear()}</span></div>`;
        cursor.setMonth(cursor.getMonth() + 1);
      }
    } else {
      const step = days > 21 ? 7 : days > 10 ? 3 : 1;
      for (let i = 0; i < days; i += step) {
        const d = new Date(from);
        d.setDate(d.getDate() + i);
        const left = (i / Math.max(1, days - 1)) * 100;
        ticks += `<div class="gantt-scale-tick gantt-scale-tick--day" style="left:${left}%"><span>${d.getDate()}.${d.getMonth() + 1}</span></div>`;
      }
    }
    return `<div class="gantt-scale">${ticks}</div>`;
  }

  function renderGanttBlockHtml(spec, options = {}) {
    if (!spec.from || !spec.to) {
      return `<div class="gantt-block gantt-block--error">Gantt: set <code>from</code>/<code>to</code> or add tasks with dates.</div>`;
    }
    const editable = !!options.editable;
    const totalDays = Math.max(1, daysBetweenInclusive(spec.from, spec.to));
    const customTitle = String(spec.title || '').trim();
    const title = customTitle
      || `Gantt ${formatCalendarDate(spec.from)} – ${formatCalendarDate(spec.to)}`;
    const colClass = spec.col ? ` gantt-block--${escapeHtml(spec.col)}` : '';
    const colStyle = spec.colCss ? ` style="--gantt-bg:${escapeHtml(spec.colCss)}"` : '';
    const titleEditAttr = editable ? ' tabindex="0" role="button"' : '';

    const rows = (spec.tasks || []).map((task, index) => {
      const startOffset = Math.max(0, Math.floor((startOfDay(task.from) - startOfDay(spec.from)) / 86400000));
      const duration = Math.max(1, daysBetweenInclusive(task.from, task.to));
      const left = (startOffset / totalDays) * 100;
      const width = (duration / totalDays) * 100;
      const color = GANTT_BAR_COLORS[index % GANTT_BAR_COLORS.length];
      const hasNote = !!(task.text || task.image);
      const editAttr = editable ? ' tabindex="0" role="button"' : '';
      const mdAttr = task.text ? ` data-gantt-markdown="${escapeHtml(task.text)}"` : '';
      return [
        `<div class="gantt-row${hasNote ? ' gantt-row--has-note' : ''}${editable ? ' gantt-row--editable' : ''}" data-gantt-task-id="${escapeHtml(task.id)}" data-gantt-from="${escapeHtml(formatCalendarDate(task.from))}" data-gantt-to="${escapeHtml(formatCalendarDate(task.to))}"${mdAttr}${editAttr}>`,
        `<div class="gantt-row-label"><span class="gantt-row-name">${escapeHtml(task.label)}</span>`,
        `<span class="gantt-row-dates">${formatCalendarDate(task.from)} – ${formatCalendarDate(task.to)}</span></div>`,
        `<div class="gantt-row-track">`,
        `<div class="gantt-bar" style="left:${left}%;width:${Math.max(width, 1.2)}%;background:${color}" title="${escapeHtml(task.label)}"></div>`,
        `</div>`,
        ganttTaskMarkup(task),
        `</div>`,
      ].join('');
    }).join('');

    const empty = !(spec.tasks || []).length
      ? `<div class="gantt-empty">No tasks yet — add lines like <code>Task | 1.1.26 | 15.1.26 | note</code></div>`
      : '';

    return [
      `<div class="gantt-block${colClass}${editable ? ' gantt-block--editable' : ''}" data-gantt-index="${options.ganttIndex ?? 0}" data-gantt-from="${escapeHtml(formatCalendarDate(spec.from))}" data-gantt-to="${escapeHtml(formatCalendarDate(spec.to))}" data-gantt-title="${escapeHtml(customTitle)}"${colStyle}>`,
      `<div class="gantt-block-header">`,
      `<div class="gantt-block-title${editable ? ' gantt-block-title--editable' : ''}"${titleEditAttr}>${escapeHtml(title)}</div>`,
      `<div class="gantt-block-meta">${(spec.tasks || []).length} task(s)</div>`,
      `</div>`,
      renderGanttScale(spec.from, spec.to),
      `<div class="gantt-rows">${rows || empty}</div>`,
      `</div>`,
    ].join('');
  }

  function setGanttFenceAttr(fenceAttrs, key, value) {
    const attrs = String(fenceAttrs || '');
    const re = new RegExp(`(?:^|;)\\s*${key}\\s*=[^;]*`, 'i');
    const cleanValue = String(value ?? '').trim();
    if (!cleanValue) {
      return attrs
        .replace(re, '')
        .replace(/^;+|;+$/g, '')
        .replace(/;{2,}/g, ';')
        .trim();
    }
    const assignment = `${key}=${cleanValue}`;
    if (re.test(attrs)) {
      return attrs.replace(re, (m) => (m.startsWith(';') ? `;${assignment}` : assignment));
    }
    return attrs ? `${attrs.replace(/;+$/, '')};${assignment}` : assignment;
  }

  function buildGanttFenceBody(spec, fenceAttrs) {
    const taskLines = serializeGanttTasks(spec.tasks || []);
    const titleInFence = /(?:^|;)\s*title\s*=/i.test(String(fenceAttrs || ''));
    const titleLine = spec.title && !titleInFence ? `# ${spec.title}` : '';
    const bodyLines = [titleLine, ...taskLines].filter(Boolean);
    return bodyLines.length ? `\n${bodyLines.join('\n')}\n` : '\n';
  }

  function serializeGanttTasks(tasks) {
    return (tasks || []).map(task => {
      const parts = [
        task.label,
        formatCalendarDate(task.from),
        formatCalendarDate(task.to),
      ];
      if (task.text) parts.push(String(task.text).replace(/\r?\n/g, ' ').trim());
      if (task.image) parts.push(`![](${task.image})`);
      return parts.join(' | ');
    });
  }

  function updateGanttTaskInMarkdown(markdown, ganttIndex, taskId, { label, from, to, text, image } = {}) {
    let idx = 0;
    return String(markdown || '').replace(GANTT_BLOCK_RE, (match, fenceAttrs, content = '') => {
      const thisIndex = idx;
      idx += 1;
      if (thisIndex !== ganttIndex) return match;
      const spec = parseGanttSpec(fenceAttrs, content);
      const tasks = (spec.tasks || []).map(t => ({ ...t }));
      const task = tasks.find(t => t.id === taskId);
      if (!task) return match;
      if (label != null) task.label = String(label).trim() || task.label;
      if (from) task.from = from;
      if (to) task.to = to;
      if (task.to < task.from) {
        const tmp = task.from;
        task.from = task.to;
        task.to = tmp;
      }
      const cleanText = String(text || '').replace(/\r?\n/g, ' ').trim();
      const cleanImage = String(image || '').trim();
      task.text = cleanText;
      task.image = cleanImage;
      spec.tasks = tasks;
      const body = buildGanttFenceBody(spec, fenceAttrs);
      const fence = fenceAttrs != null && String(fenceAttrs).length
        ? `gantt{${fenceAttrs}}`
        : 'gantt';
      return `\`\`\`${fence}${body}\`\`\``;
    });
  }

  function updateGanttMetaInMarkdown(markdown, ganttIndex, { title, from, to } = {}) {
    let idx = 0;
    return String(markdown || '').replace(GANTT_BLOCK_RE, (match, fenceAttrs, content = '') => {
      const thisIndex = idx;
      idx += 1;
      if (thisIndex !== ganttIndex) return match;
      const spec = parseGanttSpec(fenceAttrs, content);
      const cleanTitle = String(title || '').trim();
      spec.title = cleanTitle;
      let nextAttrs = String(fenceAttrs || '');
      if (from) nextAttrs = setGanttFenceAttr(nextAttrs, 'from', formatCalendarDate(from));
      if (to) nextAttrs = setGanttFenceAttr(nextAttrs, 'to', formatCalendarDate(to));
      // Prefer body `# Title` over fence title= when editing via dialog
      if (/(?:^|;)\s*title\s*=/i.test(nextAttrs)) {
        nextAttrs = setGanttFenceAttr(nextAttrs, 'title', '');
      }
      const body = buildGanttFenceBody(spec, nextAttrs);
      const fence = nextAttrs ? `gantt{${nextAttrs}}` : 'gantt';
      return `\`\`\`${fence}${body}\`\`\``;
    });
  }

  function parseGanttBlocks(text, options = {}) {
    let ganttIndex = 0;
    return text.replace(GANTT_BLOCK_RE, (_, fenceAttrs, content) => {
      const spec = parseGanttSpec(fenceAttrs, content);
      const idx = ganttIndex++;
      return wrapRichPreviewBlock(renderGanttBlockHtml(spec, {
        editable: !!options.sheetEditable || !!options.ganttEditable,
        ganttIndex: idx,
      }));
    });
  }

  const KANBAN_BLOCK_RE = /```(?:kanban|kanb)(?![a-zA-Z])(?:\{([^}]*)\})?[ \t]*(?:\r?\n([\s\S]*?))?```/gi;
  const KANBAN_DEFAULT_COLS = ['Todo', 'Doing', 'Done'];
  const KANBANGANTT_DEFAULT_COLS = ['Todo', 'Doing', 'Suspended', 'Done'];
  const KANBANGANTT_SUSPEND_COL = 'Suspended';
  const KANBANGANTT_BLOCK_RE = /```(?:kanbangantt|kbgantt|kgantt)(?:\{([^}]*)\})?[ \t]*(?:\r?\n([\s\S]*?))?```/gi;
  const KANBANGANTT_STATUSES = ['idle', 'running', 'suspended', 'stopped'];

  function kgColumnByName(columns, name) {
    return (columns || []).find(c => String(c).trim().toLowerCase() === String(name).trim().toLowerCase()) || null;
  }

  function kgSuspendColumn(spec) {
    return kgColumnByName(spec?.columns, KANBANGANTT_SUSPEND_COL) || KANBANGANTT_SUSPEND_COL;
  }

  function kgDoingColumn(spec) {
    return kgColumnByName(spec?.columns, 'Doing')
      || kgColumnByName(spec?.columns, 'Todo')
      || (spec?.columns || []).find(c => String(c).toLowerCase() !== 'suspended' && String(c).toLowerCase() !== 'done')
      || spec?.columns?.[0]
      || 'Doing';
  }

  function kgEnsureSuspendColumn(spec) {
    const suspendCol = kgSuspendColumn(spec);
    if (!spec.columns.includes(suspendCol)) {
      const doneIdx = spec.columns.findIndex(c => String(c).toLowerCase() === 'done');
      if (doneIdx >= 0) spec.columns.splice(doneIdx, 0, suspendCol);
      else spec.columns.push(suspendCol);
    }
    return suspendCol;
  }

  function parseKanbanColumns(raw) {
    return String(raw || '')
      .split(/[,;|]/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  function parseKanbanSpec(fenceAttrs, body = '') {
    const config = { ...parseBacktickConfig(`\`${String(fenceAttrs || '').replace(/`/g, '')}\``) };
    const cards = [];
    const discoveredCols = [];
    let bodyTitle = '';
    let expectingTitle = true;
    let currentCol = '';

    String(body || '').split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (expectingTitle) {
        expectingTitle = false;
        if (trimmed.match(/^#\s+(.+)/) && !trimmed.startsWith('##')) {
          bodyTitle = trimmed.replace(/^#\s+/, '').trim();
          return;
        }
        if (trimmed.match(/^title:\s*(.+)/i) && !trimmed.includes('|')) {
          bodyTitle = trimmed.replace(/^title:\s*/i, '').trim();
          return;
        }
      }
      if (trimmed.match(/^##\s+(.+)/)) {
        currentCol = trimmed.replace(/^##\s+/, '').trim();
        if (currentCol && !discoveredCols.includes(currentCol)) discoveredCols.push(currentCol);
        return;
      }
      if (trimmed.startsWith('#')) return;
      if (trimmed.startsWith('`') && trimmed.endsWith('`')) {
        Object.assign(config, parseBacktickConfig(trimmed));
        return;
      }
      const kv = trimmed.match(/^([A-Za-z_-]+)\s*[:=]\s*(.+)$/);
      if (kv && !trimmed.includes('|')) {
        config[kv[1].toLowerCase()] = kv[2].trim();
        return;
      }

      const parts = trimmed.split('|').map(p => p.trim());
      if (!parts.length || !parts[0]) return;

      let col = '';
      let label = '';
      let restParts = [];
      if (currentCol) {
        // Under ## Column: Label | note | image
        col = currentCol;
        label = parts[0];
        restParts = parts.slice(1);
      } else if (parts.length === 1) {
        col = KANBAN_DEFAULT_COLS[0];
        label = parts[0];
      } else {
        // Column | Label | note | image
        col = parts[0];
        label = parts[1] || parts[0];
        restParts = parts.slice(2);
        if (!discoveredCols.includes(col)) discoveredCols.push(col);
      }

      let note = restParts.join(' | ').trim();
      let image = '';
      const imgMatch = note.match(/!\[[^\]]*\]\(([^)\s]+)\)/);
      if (imgMatch) {
        image = imgMatch[1];
        note = note.replace(imgMatch[0], '').trim();
      }
      cards.push({
        id: `c${cards.length + 1}`,
        col,
        label: label || `Card ${cards.length + 1}`,
        text: note,
        image,
      });
    });

    const configuredCols = parseKanbanColumns(config.cols || config.columns || '');
    const columns = configuredCols.length
      ? configuredCols
      : (discoveredCols.length ? discoveredCols : [...KANBAN_DEFAULT_COLS]);
    cards.forEach(card => {
      if (card.col && !columns.includes(card.col)) columns.push(card.col);
    });

    const colRaw = String(config.col || config.bg || config.color || '').trim().toLowerCase();
    const panelCols = ['info', 'success', 'warning', 'danger', 'note'];
    let colTheme = '';
    let colCss = '';
    if (panelCols.includes(colRaw)) colTheme = colRaw;
    else colCss = sanitizeSheetColor(config.col || config.bg || config.color || '');

    return {
      title: (config.title || config.name || bodyTitle || '').trim(),
      columns,
      cards,
      col: colTheme,
      colCss,
    };
  }

  function kanbanCardMarkup(card) {
    const raw = String(card.text || '');
    let textHtml = '';
    if (raw) {
      try {
        textHtml = typeof marked !== 'undefined' ? marked.parse(raw) : escapeHtml(raw);
      } catch (_) {
        textHtml = escapeHtml(raw);
      }
    }
    const image = card.image
      ? `<img class="kanban-card-image md-image" src="${escapeHtml(card.image)}" alt="" draggable="false">`
      : '';
    return [
      image,
      `<div class="kanban-card-label">${escapeHtml(card.label)}</div>`,
      textHtml ? `<div class="kanban-card-text">${textHtml}</div>` : '',
    ].join('');
  }

  function renderKanbanBlockHtml(spec, options = {}) {
    const editable = !!options.editable;
    const customTitle = String(spec.title || '').trim();
    const title = customTitle || 'Kanban';
    const colClass = spec.col ? ` kanban-block--${escapeHtml(spec.col)}` : '';
    const colStyle = spec.colCss ? ` style="--kanban-bg:${escapeHtml(spec.colCss)}"` : '';
    const titleEditAttr = editable ? ' tabindex="0" role="button"' : '';
    const columns = spec.columns || [];
    const cards = spec.cards || [];

    const colsHtml = columns.map(column => {
      const colCards = cards.filter(c => c.col === column);
      const cardsHtml = colCards.map(card => {
        const hasNote = !!(card.text || card.image);
        const mdAttr = card.text ? ` data-kanban-markdown="${escapeHtml(card.text)}"` : '';
        const dragAttr = editable ? ' draggable="true"' : '';
        const editClass = editable ? ' kanban-card--editable' : '';
        return [
          `<div class="kanban-card${hasNote ? ' kanban-card--has-note' : ''}${editClass}" data-kanban-card-id="${escapeHtml(card.id)}" data-kanban-col="${escapeHtml(card.col)}"${mdAttr}${dragAttr}>`,
          kanbanCardMarkup(card),
          `</div>`,
        ].join('');
      }).join('');
      return [
        `<div class="kanban-column" data-kanban-col="${escapeHtml(column)}">`,
        `<div class="kanban-column-header">`,
        `<span class="kanban-column-title">${escapeHtml(column)}</span>`,
        `<span class="kanban-column-count">${colCards.length}</span>`,
        `</div>`,
        `<div class="kanban-column-cards">${cardsHtml || '<div class="kanban-column-empty">Drop cards here</div>'}</div>`,
        `</div>`,
      ].join('');
    }).join('');

    return [
      `<div class="kanban-block${colClass}${editable ? ' kanban-block--editable' : ''}" data-kanban-index="${options.kanbanIndex ?? 0}" data-kanban-title="${escapeHtml(customTitle)}" data-kanban-cols="${escapeHtml(columns.join(','))}"${colStyle}>`,
      `<div class="kanban-block-header">`,
      `<div class="kanban-block-title${editable ? ' kanban-block-title--editable' : ''}"${titleEditAttr}>${escapeHtml(title)}</div>`,
      `<div class="kanban-block-meta">${cards.length} card(s)</div>`,
      `</div>`,
      `<div class="kanban-board">${colsHtml}</div>`,
      `</div>`,
    ].join('');
  }

  function serializeKanbanCards(cards) {
    return (cards || []).map(card => {
      const parts = [card.col, card.label];
      if (card.text) parts.push(String(card.text).replace(/\r?\n/g, ' ').trim());
      if (card.image) parts.push(`![](${card.image})`);
      return parts.join(' | ');
    });
  }

  function buildKanbanFenceBody(spec, fenceAttrs) {
    const titleInFence = /(?:^|;)\s*title\s*=/i.test(String(fenceAttrs || ''));
    const titleLine = spec.title && !titleInFence ? `# ${spec.title}` : '';
    const cardLines = serializeKanbanCards(spec.cards || []);
    const bodyLines = [titleLine, ...cardLines].filter(Boolean);
    return bodyLines.length ? `\n${bodyLines.join('\n')}\n` : '\n';
  }

  function setKanbanFenceAttr(fenceAttrs, key, value) {
    return setGanttFenceAttr(fenceAttrs, key, value);
  }

  function rewriteKanbanBlock(markdown, kanbanIndex, mutateFn) {
    let idx = 0;
    return String(markdown || '').replace(KANBAN_BLOCK_RE, (match, fenceAttrs, content = '') => {
      const thisIndex = idx;
      idx += 1;
      if (thisIndex !== kanbanIndex) return match;
      const spec = parseKanbanSpec(fenceAttrs, content);
      const next = mutateFn({ ...spec, cards: (spec.cards || []).map(c => ({ ...c })), columns: [...(spec.columns || [])] }, fenceAttrs) || {};
      const nextSpec = next.spec || spec;
      const nextAttrs = next.fenceAttrs != null ? next.fenceAttrs : fenceAttrs;
      const body = buildKanbanFenceBody(nextSpec, nextAttrs);
      const fence = nextAttrs != null && String(nextAttrs).length
        ? `kanban{${nextAttrs}}`
        : 'kanban';
      return `\`\`\`${fence}${body}\`\`\``;
    });
  }

  function updateKanbanCardInMarkdown(markdown, kanbanIndex, cardId, { label, col, text, image } = {}) {
    return rewriteKanbanBlock(markdown, kanbanIndex, (spec) => {
      const card = spec.cards.find(c => c.id === cardId);
      if (!card) return { spec };
      if (label != null) card.label = String(label).trim() || card.label;
      if (col != null && String(col).trim()) {
        card.col = String(col).trim();
        if (!spec.columns.includes(card.col)) spec.columns.push(card.col);
      }
      if (text != null) card.text = String(text || '').replace(/\r?\n/g, ' ').trim();
      if (image != null) card.image = String(image || '').trim();
      return { spec };
    });
  }

  function moveKanbanCardInMarkdown(markdown, kanbanIndex, cardId, targetCol, beforeCardId = null) {
    return rewriteKanbanBlock(markdown, kanbanIndex, (spec) => {
      const fromIdx = spec.cards.findIndex(c => c.id === cardId);
      if (fromIdx < 0) return { spec };
      const [card] = spec.cards.splice(fromIdx, 1);
      card.col = targetCol;
      if (!spec.columns.includes(targetCol)) spec.columns.push(targetCol);

      let insertAt = spec.cards.length;
      if (beforeCardId) {
        const beforeIdx = spec.cards.findIndex(c => c.id === beforeCardId);
        if (beforeIdx >= 0) insertAt = beforeIdx;
      } else {
        // Append after last card of target column
        for (let i = spec.cards.length - 1; i >= 0; i -= 1) {
          if (spec.cards[i].col === targetCol) {
            insertAt = i + 1;
            break;
          }
        }
        // If column empty, place near other columns order: after previous columns' cards
        if (!spec.cards.some(c => c.col === targetCol)) {
          const colIdx = spec.columns.indexOf(targetCol);
          insertAt = 0;
          for (let i = 0; i < colIdx; i += 1) {
            const cName = spec.columns[i];
            const last = [...spec.cards].map((c, idx) => (c.col === cName ? idx : -1)).filter(n => n >= 0).pop();
            if (last != null) insertAt = last + 1;
          }
        }
      }
      spec.cards.splice(insertAt, 0, card);
      return { spec };
    });
  }

  function updateKanbanMetaInMarkdown(markdown, kanbanIndex, { title, columns } = {}) {
    return rewriteKanbanBlock(markdown, kanbanIndex, (spec, fenceAttrs) => {
      const cleanTitle = String(title || '').trim();
      spec.title = cleanTitle;
      let nextAttrs = String(fenceAttrs || '');
      if (columns != null) {
        const cols = parseKanbanColumns(columns);
        if (cols.length) {
          spec.columns = cols;
          nextAttrs = setKanbanFenceAttr(nextAttrs, 'cols', cols.join(','));
          // Reassign orphaned cards to first column
          spec.cards.forEach(card => {
            if (!cols.includes(card.col)) card.col = cols[0];
          });
        }
      }
      if (/(?:^|;)\s*title\s*=/i.test(nextAttrs)) {
        nextAttrs = setKanbanFenceAttr(nextAttrs, 'title', '');
      }
      return { spec, fenceAttrs: nextAttrs };
    });
  }

  function parseKanbanBlocks(text, options = {}) {
    let kanbanIndex = 0;
    return text.replace(KANBAN_BLOCK_RE, (_, fenceAttrs, content) => {
      const spec = parseKanbanSpec(fenceAttrs, content);
      const idx = kanbanIndex++;
      return wrapRichPreviewBlock(renderKanbanBlockHtml(spec, {
        editable: !!options.sheetEditable || !!options.kanbanEditable,
        kanbanIndex: idx,
      }));
    });
  }

  function parseKgRate(value, fallback = 0) {
    const n = parseFloat(String(value ?? '').replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) return fallback;
    return n;
  }

  function parseKgBool(value, fallback = true) {
    if (value == null || value === '') return fallback;
    const s = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on', 'y'].includes(s)) return true;
    if (['0', 'false', 'no', 'off', 'n'].includes(s)) return false;
    return fallback;
  }

  function parseKgElapsed(value) {
    const n = parseInt(String(value ?? '').trim(), 10);
    if (!Number.isFinite(n) || n < 0) return 0;
    return n;
  }

  function parseKgStatus(value) {
    const s = String(value || 'idle').trim().toLowerCase();
    return KANBANGANTT_STATUSES.includes(s) ? s : 'idle';
  }

  function formatKgDateTime(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    const yy = String(date.getFullYear()).slice(-2);
    return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${yy} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function parseKgDateTime(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;
    const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})(?:[ T](\d{1,2}):(\d{2}))?$/);
    if (m) {
      let year = parseInt(m[3], 10);
      if (year < 100) year += 2000;
      const d = new Date(
        year,
        parseInt(m[2], 10) - 1,
        parseInt(m[1], 10),
        parseInt(m[4] || '0', 10),
        parseInt(m[5] || '0', 10),
        0,
        0,
      );
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const iso = new Date(s);
    return Number.isNaN(iso.getTime()) ? null : iso;
  }

  function parseKgMetaPart(part) {
    const text = String(part || '').trim();
    if (!text || !/^[A-Za-z_-]+\s*=/.test(text)) return null;
    const meta = {};
    text.split(';').forEach(pair => {
      const [k, ...rest] = pair.split('=');
      if (!k || !rest.length) return;
      meta[k.trim().toLowerCase()] = rest.join('=').trim();
    });
    return Object.keys(meta).length ? meta : null;
  }

  function kgEffectiveElapsed(card, now = Date.now()) {
    let elapsed = parseKgElapsed(card.elapsed);
    if (card.status === 'running' && card.started) {
      const started = card.started instanceof Date ? card.started : parseKgDateTime(card.started);
      if (started) elapsed += Math.max(0, Math.floor((now - started.getTime()) / 1000));
    }
    return elapsed;
  }

  function kgCardCost(card, defaultRate = 0, now = Date.now()) {
    const rate = Number.isFinite(card.rate) ? card.rate : defaultRate;
    return (kgEffectiveElapsed(card, now) / 3600) * rate;
  }

  function formatKgMoney(amount, currency = 'EUR') {
    const cur = String(currency || 'EUR').trim() || 'EUR';
    const n = Number.isFinite(amount) ? amount : 0;
    return `${n.toFixed(2)} ${cur}`;
  }

  function formatKgDuration(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
    if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
    return `${sec}s`;
  }

  function parseKanbanganttSpec(fenceAttrs, body = '') {
    const config = { ...parseBacktickConfig(`\`${String(fenceAttrs || '').replace(/`/g, '')}\``) };
    const cards = [];
    const discoveredCols = [];
    let bodyTitle = '';
    let expectingTitle = true;
    let currentCol = '';

    String(body || '').split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (expectingTitle) {
        expectingTitle = false;
        if (trimmed.match(/^#\s+(.+)/) && !trimmed.startsWith('##')) {
          bodyTitle = trimmed.replace(/^#\s+/, '').trim();
          return;
        }
        if (trimmed.match(/^title:\s*(.+)/i) && !trimmed.includes('|')) {
          bodyTitle = trimmed.replace(/^title:\s*/i, '').trim();
          return;
        }
      }
      if (trimmed.match(/^##\s+(.+)/)) {
        currentCol = trimmed.replace(/^##\s+/, '').trim();
        if (currentCol && !discoveredCols.includes(currentCol)) discoveredCols.push(currentCol);
        return;
      }
      if (trimmed.startsWith('#')) return;
      if (trimmed.startsWith('`') && trimmed.endsWith('`')) {
        Object.assign(config, parseBacktickConfig(trimmed));
        return;
      }
      const kv = trimmed.match(/^([A-Za-z_-]+)\s*[:=]\s*(.+)$/);
      if (kv && !trimmed.includes('|')) {
        config[kv[1].toLowerCase()] = kv[2].trim();
        return;
      }

      const parts = trimmed.split('|').map(p => p.trim());
      if (!parts.length || !parts[0]) return;

      let col = '';
      let label = '';
      let restParts = [];
      if (currentCol) {
        col = currentCol;
        label = parts[0];
        restParts = parts.slice(1);
      } else if (parts.length === 1) {
        col = KANBANGANTT_DEFAULT_COLS[0];
        label = parts[0];
      } else {
        col = parts[0];
        label = parts[1] || parts[0];
        restParts = parts.slice(2);
        if (!discoveredCols.includes(col)) discoveredCols.push(col);
      }

      let meta = {};
      const noteParts = [];
      restParts.forEach(part => {
        const parsedMeta = parseKgMetaPart(part);
        if (parsedMeta) Object.assign(meta, parsedMeta);
        else noteParts.push(part);
      });

      let note = noteParts.join(' | ').trim();
      let image = '';
      const imgMatch = note.match(/!\[[^\]]*\]\(([^)\s]+)\)/);
      if (imgMatch) {
        image = imgMatch[1];
        note = note.replace(imgMatch[0], '').trim();
      }

      const defaultRate = parseKgRate(config.rate || config.hourly || 0, 0);
      cards.push({
        id: `kg${cards.length + 1}`,
        col,
        label: label || `Task ${cards.length + 1}`,
        text: note,
        image,
        status: parseKgStatus(meta.status || meta.state),
        rate: meta.rate != null || meta.cost != null || meta.hourly != null
          ? parseKgRate(meta.rate ?? meta.cost ?? meta.hourly, defaultRate)
          : null,
        elapsed: parseKgElapsed(meta.elapsed || meta.seconds || 0),
        started: parseKgDateTime(meta.started || meta.start || ''),
      });
    });

    const configuredCols = parseKanbanColumns(config.cols || config.columns || '');
    const columns = configuredCols.length
      ? configuredCols
      : (discoveredCols.length ? discoveredCols : [...KANBANGANTT_DEFAULT_COLS]);
    cards.forEach(card => {
      if (card.col && !columns.includes(card.col)) columns.push(card.col);
    });

    const colRaw = String(config.col || config.bg || config.color || '').trim().toLowerCase();
    const panelCols = ['info', 'success', 'warning', 'danger', 'note'];
    let colTheme = '';
    let colCss = '';
    if (panelCols.includes(colRaw)) colTheme = colRaw;
    else colCss = sanitizeSheetColor(config.col || config.bg || config.color || '');

    return {
      title: (config.title || config.name || bodyTitle || '').trim(),
      columns,
      cards,
      rate: parseKgRate(config.rate || config.hourly || 0, 0),
      currency: String(config.currency || config.cur || 'EUR').trim() || 'EUR',
      withCost: parseKgBool(config.withcost ?? config.costs ?? config.showcost, true),
      col: colTheme,
      colCss,
    };
  }

  function serializeKanbanganttCards(cards, defaultRate = 0) {
    return (cards || []).map(card => {
      const metaParts = [`status=${card.status || 'idle'}`];
      const rate = card.rate != null ? card.rate : defaultRate;
      if (rate > 0) metaParts.push(`rate=${rate}`);
      const elapsed = parseKgElapsed(card.elapsed);
      if (elapsed > 0) metaParts.push(`elapsed=${elapsed}`);
      if (card.status === 'running' && card.started) {
        const started = card.started instanceof Date ? card.started : parseKgDateTime(card.started);
        if (started) metaParts.push(`started=${formatKgDateTime(started)}`);
      }
      const parts = [card.col, card.label, metaParts.join(';')];
      if (card.text) parts.push(String(card.text).replace(/\r?\n/g, ' ').trim());
      if (card.image) parts.push(`![](${card.image})`);
      return parts.join(' | ');
    });
  }

  function buildKanbanganttFenceBody(spec, fenceAttrs) {
    const titleInFence = /(?:^|;)\s*title\s*=/i.test(String(fenceAttrs || ''));
    const titleLine = spec.title && !titleInFence ? `# ${spec.title}` : '';
    const cardLines = serializeKanbanganttCards(spec.cards || [], spec.rate || 0);
    const bodyLines = [titleLine, ...cardLines].filter(Boolean);
    return bodyLines.length ? `\n${bodyLines.join('\n')}\n` : '\n';
  }

  function setKanbanganttFenceAttr(fenceAttrs, key, value) {
    return setGanttFenceAttr(fenceAttrs, key, value);
  }

  function kanbanganttCardMarkup(card, spec, now = Date.now(), options = {}) {
    const editable = !!options.editable;
    const withCost = spec.withCost !== false;
    const defaultRate = spec.rate || 0;
    const rate = card.rate != null ? card.rate : defaultRate;
    const elapsed = kgEffectiveElapsed(card, now);
    const cost = kgCardCost(card, defaultRate, now);
    const currency = spec.currency || 'EUR';
    const maxHours = Math.max(1, ...(spec.cards || []).map(c => kgEffectiveElapsed(c, now) / 3600), elapsed / 3600);
    const barPct = Math.min(100, Math.round((elapsed / 3600 / maxHours) * 100));
    const status = card.status || 'idle';

    const raw = String(card.text || '');
    let textHtml = '';
    if (raw) {
      try {
        textHtml = typeof marked !== 'undefined' ? marked.parse(raw) : escapeHtml(raw);
      } catch (_) {
        textHtml = escapeHtml(raw);
      }
    }
    const image = card.image
      ? `<img class="kg-card-image md-image" src="${escapeHtml(card.image)}" alt="" draggable="false">`
      : '';

    const actions = [];
    if (status === 'idle' || status === 'stopped' || status === 'suspended') {
      actions.push(`<button type="button" class="kg-action-btn kg-action-start" data-kg-action="start" title="${status === 'suspended' ? 'Resume' : 'Start'}">${status === 'suspended' ? '▶ Resume' : '▶ Start'}</button>`);
    }
    if (status === 'running') {
      actions.push(`<button type="button" class="kg-action-btn kg-action-suspend" data-kg-action="suspend" title="Suspend">❚❚ Suspend</button>`);
      actions.push(`<button type="button" class="kg-action-btn kg-action-stop" data-kg-action="stop" title="Stop">■ Stop</button>`);
    }
    if (status === 'suspended') {
      actions.push(`<button type="button" class="kg-action-btn kg-action-stop" data-kg-action="stop" title="Stop">■ Stop</button>`);
    }

    const handleHtml = editable
      ? `<span class="kg-drag-handle" draggable="true" title="Drag task" aria-label="Drag task">⠿</span>`
      : '';

    const metrics = [
      `<div class="kg-card-metrics">`,
      `<span>${escapeHtml(formatKgDuration(elapsed))}</span>`,
      withCost ? `<span class="kg-card-rate">${escapeHtml(String(rate))} /h</span>` : '',
      withCost ? `<span class="kg-card-cost">${escapeHtml(formatKgMoney(cost, currency))}</span>` : '',
      `</div>`,
    ].join('');

    return [
      handleHtml,
      image,
      `<div class="kg-card-label">${escapeHtml(card.label)}</div>`,
      `<div class="kg-card-status kg-card-status--${escapeHtml(status)}">${escapeHtml(status)}</div>`,
      metrics,
      `<div class="kg-card-bar" title="Time vs board"><span style="width:${barPct}%"></span></div>`,
      textHtml ? `<div class="kg-card-text">${textHtml}</div>` : '',
      actions.length ? `<div class="kg-card-actions">${actions.join('')}</div>` : '',
    ].join('');
  }

  function renderKanbanganttBlockHtml(spec, options = {}) {
    const editable = !!options.editable;
    const now = Date.now();
    const customTitle = String(spec.title || '').trim();
    const title = customTitle || 'Kanban Gantt';
    const withCost = spec.withCost !== false;
    const colClass = [
      spec.col ? ` kg-block--${escapeHtml(spec.col)}` : '',
      withCost ? '' : ' kg-block--no-cost',
      editable ? ' kg-block--editable' : '',
    ].join('');
    const colStyle = spec.colCss ? ` style="--kg-bg:${escapeHtml(spec.colCss)}"` : '';
    const titleEditAttr = editable ? ' tabindex="0" role="button"' : '';
    const columns = spec.columns || [];
    const cards = spec.cards || [];
    const currency = spec.currency || 'EUR';
    const defaultRate = spec.rate || 0;
    const totalCost = cards.reduce((sum, card) => sum + kgCardCost(card, defaultRate, now), 0);
    const totalElapsed = cards.reduce((sum, card) => sum + kgEffectiveElapsed(card, now), 0);
    const metaParts = [
      `${cards.length} task(s)`,
      formatKgDuration(totalElapsed),
    ];
    if (withCost) {
      metaParts.push(formatKgMoney(totalCost, currency));
      if (defaultRate > 0) metaParts.push(`default ${defaultRate}/h`);
    }

    const colsHtml = columns.map(column => {
      const colCards = cards.filter(c => c.col === column);
      const colCost = colCards.reduce((sum, card) => sum + kgCardCost(card, defaultRate, now), 0);
      const cardsHtml = colCards.map(card => {
        const hasNote = !!(card.text || card.image);
        const mdAttr = card.text ? ` data-kg-markdown="${escapeHtml(card.text)}"` : '';
        const editClass = editable ? ' kg-card--editable' : '';
        const startedIso = card.started instanceof Date && !Number.isNaN(card.started.getTime())
          ? card.started.toISOString()
          : '';
        const rate = card.rate != null ? card.rate : defaultRate;
        return [
          `<div class="kg-card kg-card--${escapeHtml(card.status || 'idle')}${hasNote ? ' kg-card--has-note' : ''}${editClass}"`,
          ` data-kg-card-id="${escapeHtml(card.id)}"`,
          ` data-kg-col="${escapeHtml(card.col)}"`,
          ` data-kg-status="${escapeHtml(card.status || 'idle')}"`,
          ` data-kg-rate="${escapeHtml(String(rate))}"`,
          ` data-kg-elapsed="${escapeHtml(String(parseKgElapsed(card.elapsed)))}"`,
          startedIso ? ` data-kg-started="${escapeHtml(startedIso)}"` : '',
          mdAttr,
          `>`,
          kanbanganttCardMarkup(card, spec, now, { editable }),
          `</div>`,
        ].join('');
      }).join('');
      return [
        `<div class="kg-column${column.toLowerCase() === 'suspended' ? ' kg-column--suspended' : ''}" data-kg-col="${escapeHtml(column)}">`,
        `<div class="kg-column-header">`,
        `<span class="kg-column-title">${escapeHtml(column)}</span>`,
        `<span class="kg-column-count">${colCards.length}</span>`,
        `</div>`,
        withCost ? `<div class="kg-column-cost">${escapeHtml(formatKgMoney(colCost, currency))}</div>` : '',
        `<div class="kg-column-cards">${cardsHtml || '<div class="kg-column-empty">Drop tasks here</div>'}</div>`,
        `</div>`,
      ].join('');
    }).join('');

    return [
      `<div class="kg-block${colClass}"`,
      ` data-kg-index="${options.kgIndex ?? 0}"`,
      ` data-kg-title="${escapeHtml(customTitle)}"`,
      ` data-kg-cols="${escapeHtml(columns.join(','))}"`,
      ` data-kg-rate="${escapeHtml(String(defaultRate))}"`,
      ` data-kg-currency="${escapeHtml(currency)}"`,
      ` data-kg-withcost="${withCost ? '1' : '0'}"`,
      colStyle,
      `>`,
      `<div class="kg-block-header">`,
      `<div class="kg-block-title${editable ? ' kg-block-title--editable' : ''}"${titleEditAttr}>${escapeHtml(title)}</div>`,
      `<div class="kg-block-meta">${escapeHtml(metaParts.join(' · '))}</div>`,
      `</div>`,
      `<div class="kg-board">${colsHtml}</div>`,
      withCost
        ? `<div class="kg-block-footer">Board cost: <strong>${escapeHtml(formatKgMoney(totalCost, currency))}</strong></div>`
        : '',
      `</div>`,
    ].join('');
  }

  function parseKanbanganttBlockAt(markdown, kgIndex) {
    let idx = 0;
    let spec = null;
    String(markdown || '').replace(KANBANGANTT_BLOCK_RE, (_, fenceAttrs, content) => {
      if (idx === kgIndex) spec = parseKanbanganttSpec(fenceAttrs, content);
      idx += 1;
      return '';
    });
    return spec;
  }

  function refreshKgPreviewCard(cardId, kgIndex) {
    const preview = document.getElementById('preview-content');
    if (!preview || !easyMDE) return false;
    const block = preview.querySelector(`.kg-block[data-kg-index="${kgIndex}"]`);
    const cardEl = block?.querySelector(`.kg-card[data-kg-card-id="${cardId}"]`);
    if (!block || !cardEl) return false;

    const spec = parseKanbanganttBlockAt(easyMDE.value(), kgIndex);
    const card = spec?.cards?.find(c => c.id === cardId);
    if (!spec || !card) return false;

    const editable = isPreviewInteractionEnabled();
    const startedIso = card.started instanceof Date && !Number.isNaN(card.started.getTime())
      ? card.started.toISOString()
      : '';
    const rate = card.rate != null ? card.rate : (spec.rate || 0);

    cardEl.className = [
      'kg-card',
      `kg-card--${card.status || 'idle'}`,
      (card.text || card.image) ? 'kg-card--has-note' : '',
      editable ? 'kg-card--editable' : '',
    ].filter(Boolean).join(' ');
    cardEl.dataset.kgCol = card.col;
    cardEl.dataset.kgStatus = card.status || 'idle';
    cardEl.dataset.kgRate = String(rate);
    cardEl.dataset.kgElapsed = String(parseKgElapsed(card.elapsed));
    if (startedIso) cardEl.dataset.kgStarted = startedIso;
    else delete cardEl.dataset.kgStarted;
    if (card.text) cardEl.dataset.kgMarkdown = card.text;
    else delete cardEl.dataset.kgMarkdown;

    cardEl.innerHTML = kanbanganttCardMarkup(card, spec, Date.now(), { editable });

    const column = [...block.querySelectorAll('.kg-column')].find(c => c.dataset.kgCol === card.col);
    const cardsHost = column?.querySelector('.kg-column-cards');
    if (cardsHost && !cardsHost.contains(cardEl)) {
      cardsHost.appendChild(cardEl);
      cardsHost.querySelector('.kg-column-empty')?.remove();
    }

    tickKgRunningCards();
    return true;
  }

  function rewriteKanbanganttBlock(markdown, kgIndex, mutateFn) {
    let idx = 0;
    return String(markdown || '').replace(KANBANGANTT_BLOCK_RE, (match, fenceAttrs, content = '') => {
      const thisIndex = idx;
      idx += 1;
      if (thisIndex !== kgIndex) return match;
      const spec = parseKanbanganttSpec(fenceAttrs, content);
      const next = mutateFn({
        ...spec,
        cards: (spec.cards || []).map(c => ({ ...c })),
        columns: [...(spec.columns || [])],
      }, fenceAttrs) || {};
      const nextSpec = next.spec || spec;
      const nextAttrs = next.fenceAttrs != null ? next.fenceAttrs : fenceAttrs;
      const body = buildKanbanganttFenceBody(nextSpec, nextAttrs);
      const fence = nextAttrs != null && String(nextAttrs).length
        ? `kanbangantt{${nextAttrs}}`
        : 'kanbangantt';
      return `\`\`\`${fence}${body}\`\`\``;
    });
  }

  function updateKanbanganttCardInMarkdown(markdown, kgIndex, cardId, patch = {}) {
    return rewriteKanbanganttBlock(markdown, kgIndex, (spec) => {
      const card = spec.cards.find(c => c.id === cardId);
      if (!card) return { spec };
      if (patch.label != null) card.label = String(patch.label).trim() || card.label;
      if (patch.col != null && String(patch.col).trim()) {
        card.col = String(patch.col).trim();
        if (!spec.columns.includes(card.col)) spec.columns.push(card.col);
      }
      if (patch.text != null) card.text = String(patch.text || '').replace(/\r?\n/g, ' ').trim();
      if (patch.image != null) card.image = String(patch.image || '').trim();
      if (patch.status != null) card.status = parseKgStatus(patch.status);
      if (patch.rate != null) {
        const r = parseKgRate(patch.rate, spec.rate || 0);
        card.rate = r === (spec.rate || 0) ? null : r;
      }
      if (patch.elapsed != null) card.elapsed = parseKgElapsed(patch.elapsed);
      if (Object.prototype.hasOwnProperty.call(patch, 'started')) {
        card.started = patch.started instanceof Date
          ? patch.started
          : parseKgDateTime(patch.started);
      }
      if (card.status === 'running' && !card.started) {
        card.started = new Date();
      }
      if (card.status !== 'running') {
        card.started = null;
      }
      if (card.status === 'suspended') {
        card.col = kgEnsureSuspendColumn(spec);
      } else if (card.status === 'running' && card.col === kgSuspendColumn(spec)) {
        card.col = kgDoingColumn(spec);
      }
      return { spec };
    });
  }

  function applyKanbanganttTimerInMarkdown(markdown, kgIndex, cardId, action) {
    return rewriteKanbanganttBlock(markdown, kgIndex, (spec) => {
      const card = spec.cards.find(c => c.id === cardId);
      if (!card) return { spec };
      const now = new Date();
      const status = card.status || 'idle';

      if (action === 'start') {
        if (status === 'running') return { spec };
        if (status === 'suspended' || card.col === kgSuspendColumn(spec)) {
          card.col = kgDoingColumn(spec);
        }
        card.status = 'running';
        card.started = now;
        return { spec };
      }

      if (action === 'suspend') {
        if (status !== 'running') return { spec };
        card.elapsed = kgEffectiveElapsed(card, now.getTime());
        card.started = null;
        card.status = 'suspended';
        card.col = kgEnsureSuspendColumn(spec);
        return { spec };
      }

      if (action === 'stop') {
        if (status === 'running') {
          card.elapsed = kgEffectiveElapsed(card, now.getTime());
        }
        card.started = null;
        card.status = 'stopped';
        return { spec };
      }

      return { spec };
    });
  }

  function moveKanbanganttCardInMarkdown(markdown, kgIndex, cardId, targetCol, placement = {}) {
    const beforeCardId = placement.beforeCardId || null;
    const afterCardId = placement.afterCardId || null;
    return rewriteKanbanganttBlock(markdown, kgIndex, (spec) => {
      const fromIdx = spec.cards.findIndex(c => c.id === cardId);
      if (fromIdx < 0) return { spec };
      const [card] = spec.cards.splice(fromIdx, 1);
      card.col = targetCol;
      if (!spec.columns.includes(targetCol)) spec.columns.push(targetCol);

      let insertAt = spec.cards.length;
      if (beforeCardId) {
        const beforeIdx = spec.cards.findIndex(c => c.id === beforeCardId);
        if (beforeIdx >= 0) insertAt = beforeIdx;
      } else if (afterCardId) {
        const afterIdx = spec.cards.findIndex(c => c.id === afterCardId);
        if (afterIdx >= 0) insertAt = afterIdx + 1;
      } else {
        for (let i = spec.cards.length - 1; i >= 0; i -= 1) {
          if (spec.cards[i].col === targetCol) {
            insertAt = i + 1;
            break;
          }
        }
        if (!spec.cards.some(c => c.col === targetCol)) {
          const colIdx = spec.columns.indexOf(targetCol);
          insertAt = 0;
          for (let i = 0; i < colIdx; i += 1) {
            const cName = spec.columns[i];
            const last = [...spec.cards].map((c, idx) => (c.col === cName ? idx : -1)).filter(n => n >= 0).pop();
            if (last != null) insertAt = last + 1;
          }
        }
      }
      spec.cards.splice(insertAt, 0, card);
      return { spec };
    });
  }

  function updateKanbanganttMetaInMarkdown(markdown, kgIndex, { title, columns, rate, currency, withCost } = {}) {
    return rewriteKanbanganttBlock(markdown, kgIndex, (spec, fenceAttrs) => {
      const cleanTitle = String(title || '').trim();
      spec.title = cleanTitle;
      let nextAttrs = String(fenceAttrs || '');
      if (columns != null) {
        const cols = parseKanbanColumns(columns);
        if (cols.length) {
          spec.columns = cols;
          nextAttrs = setKanbanganttFenceAttr(nextAttrs, 'cols', cols.join(','));
          spec.cards.forEach(card => {
            if (!cols.includes(card.col)) card.col = cols[0];
          });
        }
      }
      if (withCost != null) {
        spec.withCost = Boolean(withCost);
        nextAttrs = setKanbanganttFenceAttr(nextAttrs, 'withcost', spec.withCost ? '1' : '0');
      }
      if (rate != null) {
        const r = parseKgRate(rate, 0);
        spec.rate = r;
        nextAttrs = setKanbanganttFenceAttr(nextAttrs, 'rate', r > 0 ? String(r) : '');
      }
      if (currency != null) {
        const cur = String(currency || '').trim() || 'EUR';
        spec.currency = cur;
        nextAttrs = setKanbanganttFenceAttr(nextAttrs, 'currency', cur === 'EUR' ? '' : cur);
      }
      if (/(?:^|;)\s*title\s*=/i.test(nextAttrs)) {
        nextAttrs = setKanbanganttFenceAttr(nextAttrs, 'title', '');
      }
      return { spec, fenceAttrs: nextAttrs };
    });
  }

  function parseKanbanganttBlocks(text, options = {}) {
    let kgIndex = 0;
    return text.replace(KANBANGANTT_BLOCK_RE, (_, fenceAttrs, content) => {
      const spec = parseKanbanganttSpec(fenceAttrs, content);
      const idx = kgIndex++;
      return wrapRichPreviewBlock(renderKanbanganttBlockHtml(spec, {
        editable: !!options.sheetEditable || !!options.kanbanEditable,
        kgIndex: idx,
      }));
    });
  }

  const MINDMAP_BLOCK_RE = /```(?:mindmap|mmap|mind)(?:\{([^}]*)\})?[ \t]*(?:\r?\n([\s\S]*?))?```/gi;

  function mindmapIndentLevel(line) {
    const match = String(line || '').match(/^(\s*)/);
    if (!match) return 0;
    const ws = match[1];
    let spaces = 0;
    for (const ch of ws) {
      if (ch === '\t') spaces += 2;
      else spaces += 1;
    }
    return Math.floor(spaces / 2);
  }

  function parseMindmapNodeLine(trimmed) {
    const parts = String(trimmed || '').split('|').map(p => p.trim());
    if (!parts.length || !parts[0]) return null;
    let note = parts.slice(1).join(' | ').trim();
    let image = '';
    const imgMatch = note.match(/!\[[^\]]*\]\(([^)\s]+)\)/);
    if (imgMatch) {
      image = imgMatch[1];
      note = note.replace(imgMatch[0], '').trim();
    }
    return {
      label: parts[0],
      text: note,
      image,
      children: [],
    };
  }

  function assignMindmapNodeIds(nodes, prefix = 'n') {
    nodes.forEach((node, i) => {
      node.id = `${prefix}${i}`;
      if (node.children?.length) assignMindmapNodeIds(node.children, `${node.id}-`);
    });
  }

  function countMindmapNodes(nodes) {
    return (nodes || []).reduce((sum, n) => sum + 1 + countMindmapNodes(n.children), 0);
  }

  function findMindmapNode(nodes, id) {
    for (const node of nodes || []) {
      if (node.id === id) return node;
      const found = findMindmapNode(node.children, id);
      if (found) return found;
    }
    return null;
  }

  function removeMindmapNode(nodes, id) {
    const list = nodes || [];
    for (let i = 0; i < list.length; i += 1) {
      if (list[i].id === id) {
        list.splice(i, 1);
        return true;
      }
      if (removeMindmapNode(list[i].children, id)) return true;
    }
    return false;
  }

  function parseMindmapSpec(fenceAttrs, body = '') {
    const config = { ...parseBacktickConfig(`\`${String(fenceAttrs || '').replace(/`/g, '')}\``) };
    let bodyTitle = '';
    const stack = [{ level: -1, children: [] }];

    String(body || '').split('\n').forEach(rawLine => {
      if (!rawLine.trim()) return;
      const trimmed = rawLine.trim();
      if (!bodyTitle && trimmed.match(/^#\s+(.+)/) && !trimmed.startsWith('##')) {
        bodyTitle = trimmed.replace(/^#\s+/, '').trim();
        return;
      }
      if (trimmed.match(/^title:\s*(.+)/i) && !trimmed.includes('|') && stack.length === 1 && !stack[0].children.length) {
        bodyTitle = trimmed.replace(/^title:\s*/i, '').trim();
        return;
      }
      if (trimmed.startsWith('`') && trimmed.endsWith('`')) {
        Object.assign(config, parseBacktickConfig(trimmed));
        return;
      }
      const kv = trimmed.match(/^([A-Za-z_-]+)\s*[:=]\s*(.+)$/);
      if (kv && !trimmed.includes('|') && mindmapIndentLevel(rawLine) === 0 && stack.length === 1 && !stack[0].children.length) {
        config[kv[1].toLowerCase()] = kv[2].trim();
        return;
      }

      const level = mindmapIndentLevel(rawLine);
      const node = parseMindmapNodeLine(trimmed);
      if (!node) return;
      while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
      const parent = stack[stack.length - 1];
      parent.children.push(node);
      stack.push({ level, children: node.children });
    });

    const roots = stack[0].children;
    assignMindmapNodeIds(roots);

    const colRaw = String(config.col || config.bg || config.color || '').trim().toLowerCase();
    const panelCols = ['info', 'success', 'warning', 'danger', 'note'];
    let col = '';
    let colCss = '';
    if (panelCols.includes(colRaw)) col = colRaw;
    else colCss = sanitizeSheetColor(config.col || config.bg || config.color || '');

    const dirRaw = String(config.dir || config.direction || 'right').toLowerCase();
    const dir = dirRaw === 'down' || dirRaw === 'vertical' ? 'down' : 'right';

    return {
      title: (config.title || config.name || bodyTitle || '').trim(),
      nodes: roots,
      col,
      colCss,
      dir,
    };
  }

  function serializeMindmapNodes(nodes, indent = 0) {
    const pad = '  '.repeat(indent);
    const lines = [];
    (nodes || []).forEach(node => {
      const parts = [node.label || 'Node'];
      if (node.text) parts.push(String(node.text).replace(/\r?\n/g, ' ').trim());
      if (node.image) parts.push(`![](${node.image})`);
      lines.push(`${pad}${parts.filter(Boolean).join(' | ')}`);
      if (node.children?.length) lines.push(...serializeMindmapNodes(node.children, indent + 1));
    });
    return lines;
  }

  function serializeMindmapBody(spec) {
    const lines = [];
    if (spec.title) lines.push(`# ${spec.title}`);
    lines.push(...serializeMindmapNodes(spec.nodes || []));
    return lines.length ? `\n${lines.join('\n')}\n` : '\n';
  }

  function mindmapNodeMarkup(node) {
    const raw = String(node.text || '');
    let textHtml = '';
    if (raw) {
      try {
        textHtml = typeof marked !== 'undefined' ? marked.parse(raw) : escapeHtml(raw);
      } catch (_) {
        textHtml = escapeHtml(raw);
      }
    }
    const image = node.image
      ? `<img class="mindmap-node-image md-image" src="${escapeHtml(node.image)}" alt="">`
      : '';
    return [
      `<div class="mindmap-node-label">${escapeHtml(node.label || 'Node')}</div>`,
      image,
      textHtml ? `<div class="mindmap-node-text">${textHtml}</div>` : '',
    ].join('');
  }

  function renderMindmapNodeHtml(node, editable = false) {
    const hasNote = !!(node.text || node.image);
    const mdAttr = node.text ? ` data-mindmap-markdown="${escapeHtml(node.text)}"` : '';
    const editAttr = editable ? ' tabindex="0" role="button"' : '';
    const editClass = editable ? ' mindmap-node-card--editable' : '';
    const children = (node.children || []).map(child => renderMindmapNodeHtml(child, editable)).join('');
    return [
      `<li class="mindmap-node${hasNote ? ' mindmap-node--has-note' : ''}" data-mindmap-node-id="${escapeHtml(node.id)}">`,
      `<div class="mindmap-node-card${editClass}"${mdAttr}${editAttr}>${mindmapNodeMarkup(node)}</div>`,
      children ? `<ul class="mindmap-children">${children}</ul>` : '',
      `</li>`,
    ].join('');
  }

  function renderMindmapBlockHtml(spec, options = {}) {
    const editable = !!options.editable;
    const title = spec.title || 'Mindmap';
    const customTitle = spec.title || '';
    const colClass = spec.col ? ` mindmap-block--${escapeHtml(spec.col)}` : '';
    const colStyle = spec.colCss ? ` style="--mindmap-bg:${escapeHtml(spec.colCss)}"` : '';
    const dir = spec.dir === 'down' ? 'down' : 'right';
    const nodes = spec.nodes || [];
    const count = countMindmapNodes(nodes);
    const tree = nodes.length
      ? `<ul class="mindmap-tree">${nodes.map(n => renderMindmapNodeHtml(n, editable)).join('')}</ul>`
      : '<div class="mindmap-empty">No nodes yet — add indented lines under the mindmap fence.</div>';
    const titleEditAttr = editable ? ' tabindex="0" role="button"' : '';
    return [
      `<div class="mindmap-block${colClass}${editable ? ' mindmap-block--editable' : ''}" data-mindmap-index="${options.mindmapIndex ?? 0}" data-mindmap-title="${escapeHtml(customTitle)}" data-mindmap-dir="${dir}"${colStyle}>`,
      `<div class="mindmap-block-header">`,
      `<div class="mindmap-block-title${editable ? ' mindmap-block-title--editable' : ''}"${titleEditAttr}>${escapeHtml(title)}</div>`,
      `<div class="mindmap-block-meta">${count} node(s) · ${dir}</div>`,
      `</div>`,
      `<div class="mindmap-canvas mindmap-dir-${dir}">${tree}</div>`,
      `</div>`,
    ].join('');
  }

  function rewriteMindmapBlock(markdown, mindmapIndex, mutateFn) {
    let idx = 0;
    return String(markdown || '').replace(MINDMAP_BLOCK_RE, (match, fenceAttrs, content = '') => {
      const thisIndex = idx;
      idx += 1;
      if (thisIndex !== mindmapIndex) return match;
      const spec = parseMindmapSpec(fenceAttrs, content);
      const next = mutateFn(spec, fenceAttrs) || {};
      const nextSpec = next.spec || spec;
      const nextAttrs = next.fenceAttrs != null ? next.fenceAttrs : fenceAttrs;
      const fence = nextAttrs != null && String(nextAttrs).length
        ? `mindmap{${nextAttrs}}`
        : 'mindmap';
      return `\`\`\`${fence}${serializeMindmapBody(nextSpec)}\`\`\``;
    });
  }

  function updateMindmapNodeInMarkdown(markdown, mindmapIndex, nodeId, { label, text, image } = {}) {
    return rewriteMindmapBlock(markdown, mindmapIndex, (spec) => {
      const node = findMindmapNode(spec.nodes, nodeId);
      if (!node) return { spec };
      if (label != null) node.label = String(label).trim() || node.label;
      if (text != null) node.text = String(text);
      if (image != null) node.image = String(image).trim();
      return { spec };
    });
  }

  function addMindmapChildInMarkdown(markdown, mindmapIndex, parentId, label = 'New idea') {
    return rewriteMindmapBlock(markdown, mindmapIndex, (spec) => {
      const child = { label: String(label || 'New idea').trim() || 'New idea', text: '', image: '', children: [] };
      if (!parentId) {
        spec.nodes.push(child);
      } else {
        const parent = findMindmapNode(spec.nodes, parentId);
        if (!parent) return { spec };
        parent.children.push(child);
      }
      assignMindmapNodeIds(spec.nodes);
      return { spec };
    });
  }

  function deleteMindmapNodeInMarkdown(markdown, mindmapIndex, nodeId) {
    return rewriteMindmapBlock(markdown, mindmapIndex, (spec) => {
      removeMindmapNode(spec.nodes, nodeId);
      assignMindmapNodeIds(spec.nodes);
      return { spec };
    });
  }

  function updateMindmapMetaInMarkdown(markdown, mindmapIndex, { title, dir } = {}) {
    return rewriteMindmapBlock(markdown, mindmapIndex, (spec, fenceAttrs) => {
      const attrs = { ...parseBacktickConfig(`\`${String(fenceAttrs || '').replace(/`/g, '')}\``) };
      if (title != null) {
        spec.title = String(title).trim();
        if (spec.title) attrs.title = spec.title;
        else delete attrs.title;
      }
      if (dir != null) {
        spec.dir = dir === 'down' ? 'down' : 'right';
        attrs.dir = spec.dir;
      }
      const nextAttrs = Object.entries(attrs)
        .map(([k, v]) => `${k}=${v}`)
        .join(';');
      return { spec, fenceAttrs: nextAttrs };
    });
  }

  function parseMindmapBlocks(text, options = {}) {
    let mindmapIndex = 0;
    return text.replace(MINDMAP_BLOCK_RE, (_, fenceAttrs, content) => {
      const spec = parseMindmapSpec(fenceAttrs, content);
      const idx = mindmapIndex++;
      return wrapRichPreviewBlock(renderMindmapBlockHtml(spec, {
        editable: !!options.sheetEditable || !!options.mindmapEditable,
        mindmapIndex: idx,
      }));
    });
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

  function onPreviewTagClick(e) {
    const target = e.target?.closest?.('.md-tag');
    if (!target) return;
    if (!target.closest('.md-tags')) return;
    e.preventDefault();
    e.stopPropagation();
    const text = String(target.textContent || '');
    const tag = parseTagQuery(text);
    if (!tag) return;
    jumpToTagDeclaration(tag);
  }

  function initPreviewTagClicks() {
    document.getElementById('preview-content')?.addEventListener('click', onPreviewTagClick);
    document.getElementById('markdown-wrap')?.addEventListener('click', onPreviewTagClick);
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
    md = md.replace(/```(?:calendar|calender)(?:\{([^}]*)\})?[ \t]*(?:\r?\n([\s\S]*?))?```/gi, (_, fenceAttrs) => {
      const spec = parseCalendarSpec(fenceAttrs, '');
      const label = (spec.from && spec.to)
        ? `Calendar ${formatCalendarDate(spec.from)} – ${formatCalendarDate(spec.to)}`
        : 'Calendar';
      return `\n\n---\n*${label} — open full preview to view*\n---\n\n`;
    });
    md = md.replace(/```(?:gantt|gant)(?:\{([^}]*)\})?[ \t]*(?:\r?\n([\s\S]*?))?```/gi, (_, fenceAttrs) => {
      const spec = parseGanttSpec(fenceAttrs, '');
      const label = (spec.from && spec.to)
        ? `Gantt ${formatCalendarDate(spec.from)} – ${formatCalendarDate(spec.to)}`
        : 'Gantt';
      return `\n\n---\n*${label} — open full preview to view*\n---\n\n`;
    });
    md = md.replace(/```(?:kanbangantt|kbgantt|kgantt)(?:\{([^}]*)\})?[ \t]*(?:\r?\n([\s\S]*?))?```/gi, (_, fenceAttrs) => {
      const spec = parseKanbanganttSpec(fenceAttrs, '');
      const label = spec.title || 'Kanban Gantt';
      return `\n\n---\n*${label} — open full preview to view*\n---\n\n`;
    });
    md = md.replace(/```(?:kanban|kanb)(?![a-zA-Z])(?:\{([^}]*)\})?[ \t]*(?:\r?\n([\s\S]*?))?```/gi, (_, fenceAttrs) => {
      const spec = parseKanbanSpec(fenceAttrs, '');
      const label = spec.title || 'Kanban';
      return `\n\n---\n*${label} — open full preview to view*\n---\n\n`;
    });
    md = md.replace(/```(?:mindmap|mmap|mind)(?:\{([^}]*)\})?[ \t]*(?:\r?\n([\s\S]*?))?```/gi, (_, fenceAttrs) => {
      const spec = parseMindmapSpec(fenceAttrs, '');
      const label = spec.title || 'Mindmap';
      return `\n\n---\n*${label} — open full preview to view*\n---\n\n`;
    });
    return md;
  }

  function expandLeadingTabsForPreview(markdown) {
    const tabSize = Math.max(2, Math.min(8, EDITOR_TAB_SIZE));
    const lines = String(markdown || '').split('\n');
    let inFence = false;
    return lines.map(line => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      const match = line.match(/^(\t+)(.*)$/);
      if (!match) return line;
      // Convert leading tabs to NBSP so preview keeps indent without creating <pre> code blocks.
      return `${'\u00A0'.repeat(match[1].length * tabSize)}${match[2]}`;
    }).join('\n');
  }

  function preprocessMarkdown(markdown, options = {}) {
    let md = markdown;
    const tags = extractTags(md);
    md = stripInlineTagMarkers(md);
    md = expandLeadingTabsForPreview(md);
    const richBlocks = options.richBlocks !== false;
    md = linkifyFileUrls(md);
    if (richBlocks) {
      const sheetRegistry = buildSheetRegistry(md);
      md = parseSheetBlocks(md, options);
      md = parseChartBlocks(md, sheetRegistry);
      md = parsePanelBlocks(md);
      md = parseCalendarBlocks(md, options);
      md = parseGanttBlocks(md, options);
      md = parseKanbanganttBlocks(md, options);
      md = parseKanbanBlocks(md, options);
      md = parseMindmapBlocks(md, options);
    } else {
      md = replaceRichBlocksWithPlaceholders(md);
    }
    md = parseMarkdownImages(md);
    const styled = materializeMarkdownInStyledSpans(md);
    return {
      markdown: styled.markdown,
      tagsHtml: buildTagsHtml(tags),
      styledSpanHtml: styled.rendered,
    };
  }

  function renderMarkdownToHtml(markdown, options = {}) {
    const processed = preprocessMarkdown(markdown, options);
    let html = marked.parse(processed.markdown) + processed.tagsHtml;
    html = restoreStyledSpanTokens(html, processed.styledSpanHtml);
    // Tokens can remain wrapped in <p> after marked.
    html = html.replace(/<p>\s*(<div class="md-styled-block"[\s\S]*?<\/div>)\s*<\/p>/gi, '$1');
    html = html.replace(/@@MDSTYLE(\d+)@@/g, (_, id) => {
      const idx = Number(id);
      return Number.isFinite(idx) && processed.styledSpanHtml?.[idx] != null
        ? processed.styledSpanHtml[idx]
        : '';
    });
    return html;
  }

  function renderMarkdownPreviewHtml(markdown, options = {}) {
    return renderMarkdownToHtml(markdown, options);
  }

  function isEditorPreviewSplit() {
    return isEditing && !isMobileLayout()
      && document.querySelector('.editor-wrap')?.classList.contains('editor-wrap--split');
  }

  function shouldShowEditPreview() {
    return isEditing && !isMobileLayout();
  }

  function isPreviewInteractionEnabled() {
    return userCanEdit && (isEditing || isMobileLayout());
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

  function isEditorPreviewScrollLocked() {
    return Date.now() < editorPreviewScrollLockUntil;
  }

  function lockEditorPreviewScroll(ms = 100) {
    editorPreviewScrollLockUntil = Date.now() + ms;
  }

  function capturePreviewScrollPosition() {
    const preview = document.getElementById('preview-content');
    if (preview) preservedPreviewScrollTop = preview.scrollTop;
  }

  function restorePreviewScrollPosition(preview) {
    if (!preview || preservedPreviewScrollTop == null) return;
    const top = preservedPreviewScrollTop;
    preservedPreviewScrollTop = null;
    lockEditorPreviewScroll(600);
    const apply = () => {
      const max = Math.max(0, preview.scrollHeight - preview.clientHeight);
      preview.scrollTop = Math.min(top, max);
    };
    apply();
    requestAnimationFrame(apply);
  }

  function rebuildPreviewScrollAnchors() {
    const preview = document.getElementById('preview-content');
    const cm = easyMDE?.codemirror;
    const raw = easyMDE?.value() || '';
    if (!preview || !cm) {
      previewScrollAnchors = [];
      return;
    }

    const mdLines = raw.split('\n');
    const maxLine = Math.max(0, cm.lineCount() - 1);
    const maxScroll = Math.max(0, preview.scrollHeight - preview.clientHeight);
    const anchors = [{ line: 0, top: 0 }];
    const seenLines = new Set([0]);

    const addAnchor = (line, el) => {
      if (!Number.isFinite(line) || line < 0 || line > maxLine || seenLines.has(line)) return;
      seenLines.add(line);
      anchors.push({ line, top: elementScrollTop(preview, el) });
    };

    preview.querySelectorAll('[data-source-line]').forEach(el => {
      addAnchor(parseInt(el.dataset.sourceLine, 10), el);
    });

    preview.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => {
      if (h.dataset.sourceLine) return;
      const text = h.textContent.trim();
      for (let i = 0; i < mdLines.length; i += 1) {
        const m = mdLines[i].match(/^#{1,6}\s+(.*)$/);
        if (m && m[1].trim() === text) {
          addAnchor(i, h);
          break;
        }
      }
    });

    if (!seenLines.has(maxLine)) {
      anchors.push({ line: maxLine, top: maxScroll });
    }

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

  function getEditorScrollLine() {
    const cm = easyMDE?.codemirror;
    if (!cm) return 0;
    const top = cm.getScrollInfo().top;
    const line = cm.lineAtHeight(top, 'local');
    const lineTop = cm.heightAtLine(line, 'local');
    const nextTop = line + 1 < cm.lineCount()
      ? cm.heightAtLine(line + 1, 'local')
      : lineTop + cm.defaultTextHeight();
    const lineH = Math.max(1, nextTop - lineTop);
    return line + Math.max(0, Math.min(1, (top - lineTop) / lineH));
  }

  function scrollEditorToLine(fracLine) {
    const cm = easyMDE?.codemirror;
    if (!cm) return;
    const line = Math.max(0, Math.min(cm.lineCount() - 1, Math.floor(fracLine)));
    const fraction = fracLine - line;
    const lineTop = cm.heightAtLine(line, 'local');
    const nextTop = line + 1 < cm.lineCount()
      ? cm.heightAtLine(line + 1, 'local')
      : lineTop + cm.defaultTextHeight();
    const lineH = Math.max(1, nextTop - lineTop);
    cm.scrollTo(null, lineTop + fraction * lineH);
  }

  function syncPreviewScrollFromEditor() {
    if (!isEditorPreviewSplit() || isEditorPreviewScrollLocked()) return;
    const preview = document.getElementById('preview-content');
    const cm = easyMDE?.codemirror;
    if (!preview || !cm) return;

    lockEditorPreviewScroll();
    const line = getEditorScrollLine();
    if (previewScrollAnchors.length >= 2) {
      preview.scrollTop = interpolateScrollAnchors('line', 'top', line);
    } else {
      const info = cm.getScrollInfo();
      const editorMax = Math.max(1, info.height - info.clientHeight);
      const previewMax = Math.max(0, preview.scrollHeight - preview.clientHeight);
      preview.scrollTop = (info.top / editorMax) * previewMax;
    }
  }

  function syncEditorScrollFromPreview() {
    if (!isEditorPreviewSplit() || isEditorPreviewScrollLocked()) return;
    const preview = document.getElementById('preview-content');
    const cm = easyMDE?.codemirror;
    if (!preview || !cm) return;

    lockEditorPreviewScroll();
    if (previewScrollAnchors.length >= 2) {
      scrollEditorToLine(interpolateScrollAnchors('top', 'line', preview.scrollTop));
    } else {
      const previewMax = Math.max(1, preview.scrollHeight - preview.clientHeight);
      const info = cm.getScrollInfo();
      const editorMax = Math.max(0, info.height - info.clientHeight);
      const ratio = preview.scrollTop / previewMax;
      cm.scrollTo(null, ratio * editorMax);
    }
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
    const previewWrap = document.getElementById('preview-wrap');
    if (!cm || !preview) return;

    cm.off('scroll', onEditorPreviewScroll);
    cm.on('scroll', onEditorPreviewScroll);
    preview.removeEventListener('scroll', onPreviewEditorScroll);
    preview.addEventListener('scroll', onPreviewEditorScroll, { passive: true });

    if (editorPreviewResizeObserver) {
      editorPreviewResizeObserver.disconnect();
      editorPreviewResizeObserver = null;
    }
    if (previewWrap && typeof ResizeObserver !== 'undefined') {
      editorPreviewResizeObserver = new ResizeObserver(() => {
        if (!isEditorPreviewSplit()) return;
        rebuildPreviewScrollAnchors();
        syncPreviewScrollFromEditor();
      });
      editorPreviewResizeObserver.observe(previewWrap);
      editorPreviewResizeObserver.observe(preview);
    }
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
    if (isMobileLayout() && isEditing) {
      buildFloatingToc();
      syncMobileContentMenu();
      return;
    }
    const raw = easyMDE ? (easyMDE.value() || '') : '';
    const savedPreviewScrollTop = preservedPreviewScrollTop ?? preview.scrollTop;
    preservedPreviewScrollTop = null;

    const hasToc = /\[toc\]/i.test(raw);
    const hasHeader = /^#{1,6}\s+/m.test(raw);
    const floatingToc = document.getElementById('floating-toc');

    if (floatingToc) {
      const splitEdit = isEditing && document.querySelector('.editor-wrap')?.classList.contains('editor-wrap--split');
      if (isMobileLayout()) {
        floatingToc.style.display = 'flex';
        floatingToc.classList.remove('is-hidden');
      } else if (splitEdit) {
        floatingToc.style.display = 'none';
        floatingToc.classList.add('is-hidden');
      } else {
        const show = hasToc || hasHeader;
        floatingToc.style.display = show ? 'flex' : 'none';
        floatingToc.classList.toggle('is-hidden', !show);
      }
    }
    const editorWrap = document.querySelector('.editor-wrap');
    const tocShown = floatingToc
      && floatingToc.style.display !== 'none'
      && !floatingToc.classList.contains('is-hidden');
    editorWrap?.classList.toggle('has-page-toc', tocShown);

    const sheetRegistry = buildSheetRegistry(raw);
    const processed = preprocessMarkdown(raw, {
      sheetEditable: isPreviewInteractionEnabled(),
      richBlocks: true,
    });
    let html = marked.parse(processed.markdown) + processed.tagsHtml;
    html = restoreStyledSpanTokens(html, processed.styledSpanHtml);
    html = html.replace(/<p>\s*(<div class="md-styled-block"[\s\S]*?<\/div>)\s*<\/p>/gi, '$1');
    preview.innerHTML = html;
    applyPreviewImageStyles(preview);
    preview.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => { h.id = slugifyHeading(h.textContent); });
    markFileLinks(preview);
    renderD3Charts(preview, sheetRegistry);
    buildFloatingToc();
    annotatePreviewSourceLines(raw, preview);
    if (isEditing) preview.tabIndex = -1;
    else preview.removeAttribute('tabindex');
    rebuildPreviewScrollAnchors();
    syncMobileContentMenu();
    lockEditorPreviewScroll(600);
    const applyPreviewScroll = () => {
      const previewMax = Math.max(0, preview.scrollHeight - preview.clientHeight);
      preview.scrollTop = Math.min(savedPreviewScrollTop, previewMax);
    };
    applyPreviewScroll();
    requestAnimationFrame(applyPreviewScroll);
  }

  function collectMarkdownHeadings(raw) {
    const headings = [];
    (raw || '').split('\n').forEach((line, lineIndex) => {
      const match = line.match(/^(#{1,6})\s+(.+?)\s*$/);
      if (!match) return;
      const text = match[2].trim();
      headings.push({
        level: match[1].length,
        text,
        line: lineIndex,
        id: slugifyHeading(text) || `heading-${headings.length + 1}`,
      });
    });
    return headings;
  }

  function pageHasTocHeadings(raw) {
    return /\[toc\]/i.test(raw || '') || /^#{1,6}\s+/m.test(raw || '');
  }

  function buildFloatingToc() {
    const preview = document.getElementById('preview-content');
    const list = document.getElementById('floating-toc-list');
    if (!list) return;

    const raw = easyMDE ? (easyMDE.value() || '') : '';
    const useMarkdown = isMobileLayout() && isEditing;
    let items = [];

    if (!useMarkdown && preview) {
      const headings = [...preview.querySelectorAll('h1,h2,h3,h4,h5,h6')];
      headings.forEach((h, index) => {
        if (!h.id) h.id = slugifyHeading(h.textContent) || `heading-${index + 1}`;
      });
      items = headings.map(h => ({
        level: Number(h.tagName.substring(1)),
        text: h.textContent,
        id: h.id,
        line: null,
      }));
    }

    if (!items.length) {
      items = collectMarkdownHeadings(raw).map(h => ({
        level: h.level,
        text: h.text,
        id: h.id,
        line: h.line,
      }));
    }

    if (!items.length) {
      list.innerHTML = '<div class="text-muted small">No headings</div>';
      return;
    }

    list.innerHTML = items.map(h => (
      `<a href="#${h.id}" class="toc-link toc-level-${h.level}" data-target="${h.id}"${h.line != null ? ` data-line="${h.line}"` : ''}>${escapeHtml(h.text)}</a>`
    )).join('');

    list.querySelectorAll('.toc-link').forEach(link => {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        const line = this.dataset.line;
        if (line != null && isEditing && easyMDE?.codemirror) {
          const lineNum = parseInt(line, 10);
          if (Number.isFinite(lineNum)) {
            easyMDE.codemirror.setCursor({ line: lineNum, ch: 0 });
            easyMDE.codemirror.scrollIntoView({ line: lineNum, ch: 0 }, 120);
            easyMDE.codemirror.focus();
          }
          closeFloatingToc();
          return;
        }
        const id = this.dataset.target;
        const target = id ? document.getElementById(id) : null;
        if (target && preview?.contains(target)) scrollPreviewToElement(target);
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

    const splitEdit = shouldShowEditPreview() && mode === 'markdown';
    editorWrap?.classList.toggle('editor-wrap--split', splitEdit);
    editorWrap?.classList.toggle('editor-wrap--preview-only', !isEditing);

    if (isMobileLayout() && isEditing) {
      resetEasyMdePreviewState();
      markdownWrap?.classList.remove('hidden');
      previewWrap?.classList.add('hidden');
      if (easyMDE) {
        setTimeout(() => {
          easyMDE.codemirror.refresh();
          const toolbar = document.querySelector('#markdown-wrap .editor-toolbar');
          const cm = document.querySelector('#markdown-wrap .CodeMirror');
          if (toolbar) toolbar.style.display = '';
          if (cm) cm.style.display = '';
        }, 50);
      }
      syncMobileContentMenu();
      if (isMobileLayout()) buildFloatingToc();
      return;
    }

    if (splitEdit) {
      ensureEditorSplitWidth(editorWrap);
      markdownWrap?.classList.remove('hidden');
      previewWrap?.classList.remove('hidden');
      updateEditorSplitRangeBounds();
      renderPreview();
      initEditorPreviewScrollSync();
      applyEditorTypographyFromSettings();
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
    syncMobileContentMenu();
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
    syncMobileContentMenu();
    if (isMobileLayout()) buildFloatingToc();
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
    document.getElementById('keep-composer')?.classList.toggle('d-none', !userCanEdit);
    if (isMobileLayout() && !isEditing) renderPreview();
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

  function syncMobileContentMenu() {
    const btn = document.getElementById('toc-toggle');
    if (!btn) return;
    if (!isMobileLayout()) {
      btn.classList.remove('visible');
      return;
    }
    const raw = easyMDE ? (easyMDE.value() || '') : '';
    btn.classList.toggle('visible', pageHasTocHeadings(raw));
  }

  function syncMobileLayoutClass() {
    const wasMobile = document.body.classList.contains('mobile-layout');
    const mobile = isMobileLayout();
    document.body.classList.toggle('mobile-layout', mobile);
    if (!mobile) {
      closeFloatingToc();
      closeMobileTopbarMenu();
    }
    if (mobile !== wasMobile && isEditing) switchMode('markdown');
    if (mobile !== wasMobile && userCanEdit && !isEditing) renderPreview();
    syncMobileContentMenu();
  }

  function closeFloatingToc() {
    const toc = document.getElementById('floating-toc');
    const toggle = document.getElementById('toc-toggle');
    const backdrop = document.getElementById('mobile-toc-backdrop');
    if (toc) toc.classList.remove('active');
    backdrop?.classList.add('d-none');
    toggle?.setAttribute('aria-expanded', 'false');
    const label = toggle?.querySelector('span');
    if (label) label.textContent = 'Contents';
  }

  function closeMobileTopbarMenu() {
    const menu = document.getElementById('mobile-topbar-menu');
    const toggle = document.getElementById('mobile-topbar-menu-toggle');
    const backdrop = document.getElementById('mobile-topbar-menu-backdrop');
    menu?.classList.remove('active');
    backdrop?.classList.add('d-none');
    toggle?.setAttribute('aria-expanded', 'false');
  }

  function toggleMobileTopbarMenu() {
    if (!isMobileLayout()) return;
    const menu = document.getElementById('mobile-topbar-menu');
    const toggle = document.getElementById('mobile-topbar-menu-toggle');
    const backdrop = document.getElementById('mobile-topbar-menu-backdrop');
    if (!menu || !toggle) return;
    closeFloatingToc();
    const open = !menu.classList.contains('active');
    menu.classList.toggle('active', open);
    backdrop?.classList.toggle('d-none', !open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function toggleFloatingToc() {
    if (!isMobileLayout()) return;
    const toc = document.getElementById('floating-toc');
    const toggle = document.getElementById('toc-toggle');
    const backdrop = document.getElementById('mobile-toc-backdrop');
    if (!toc) return;
    closeMobileTopbarMenu();
    buildFloatingToc();
    const open = !toc.classList.contains('active');
    toc.classList.toggle('active', open);
    backdrop?.classList.toggle('d-none', !open);
    toggle?.setAttribute('aria-expanded', open ? 'true' : 'false');
    const label = toggle?.querySelector('span');
    if (label) label.textContent = open ? 'Close' : 'Contents';
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

  const EDITOR_LINE_HEIGHT_DEFAULT_PERCENT = 150;
  const EDITOR_TAB_SIZE = 4;

  function getEditorMarkdownWidthPx(editorWrap = document.querySelector('.editor-wrap')) {
    if (!editorWrap) return null;
    const w = parseInt(getComputedStyle(editorWrap).getPropertyValue('--editor-markdown-width'), 10);
    return Number.isNaN(w) ? null : w;
  }

  function updateEditorSplitRangeBounds() {
    const editorWrap = document.querySelector('.editor-wrap');
    const range = document.getElementById('editor-split-range');
    if (!editorWrap || !range) return;
    const maxW = Math.max(EDITOR_MARKDOWN_MIN, editorInnerWidth(editorWrap) - EDITOR_PREVIEW_MIN);
    range.min = String(EDITOR_MARKDOWN_MIN);
    range.max = String(maxW);
    const current = getEditorMarkdownWidthPx(editorWrap);
    if (current !== null) {
      range.value = String(Math.max(EDITOR_MARKDOWN_MIN, Math.min(maxW, current)));
    }
  }

  function setEditorMarkdownSplitWidth(w, options = {}) {
    const editorWrap = document.querySelector('.editor-wrap');
    if (!editorWrap) return;
    const clamped = clampEditorMarkdownWidth(w, editorWrap);
    if (clamped === null) return;
    editorWrap.style.setProperty('--editor-markdown-width', `${clamped}px`);
    if (!options.skipRangeUpdate) {
      const range = document.getElementById('editor-split-range');
      if (range) range.value = String(clamped);
    }
    if (easyMDE) {
      easyMDE.codemirror.refresh();
      if (isEditorPreviewSplit()) {
        rebuildPreviewScrollAnchors();
        if (!options.skipScrollSync) syncPreviewScrollFromEditor();
      }
    }
    if (options.persist) persistEditorMarkdownWidth(clamped);
  }

  function persistEditorLineHeightPercent(percent) {
    if (!window.APP_BOOT) window.APP_BOOT = {};
    if (!window.APP_BOOT.extraConfigs) window.APP_BOOT.extraConfigs = {};
    window.APP_BOOT.extraConfigs.editor_line_height_percent = percent;
    updateUserSettings({ extra_configs: { editor_line_height_percent: percent } });
  }

  function persistEditorFontSizePx(px) {
    updateUserSettings({ font_size: px });
    if (!window.APP_BOOT) window.APP_BOOT = {};
    window.APP_BOOT.fontSize = px;
  }

  function applyEditorLineHeightPercent(percent, options = {}) {
    const editorWrap = document.querySelector('.editor-wrap');
    if (!editorWrap) return;
    const safe = Math.max(100, Math.min(220, parseInt(percent, 10) || EDITOR_LINE_HEIGHT_DEFAULT_PERCENT));
    const ratio = safe / 100;
    editorWrap.style.setProperty('--editor-line-height', String(ratio));
    const cm = easyMDE?.codemirror;
    if (cm) {
      cm.getWrapperElement().style.lineHeight = String(ratio);
      cm.refresh();
    }
    const preview = document.getElementById('preview-content');
    if (preview) preview.style.lineHeight = String(ratio);
    if (!options.skipRangeUpdate) {
      const range = document.getElementById('editor-line-height-range');
      if (range) range.value = String(safe);
    }
    if (options.persist) persistEditorLineHeightPercent(safe);
    if (isEditorPreviewSplit()) {
      rebuildPreviewScrollAnchors();
      if (!options.skipScrollSync) syncPreviewScrollFromEditor();
    }
  }

  function applyEditorFontSizePx(px, options = {}) {
    const editorWrap = document.querySelector('.editor-wrap');
    if (!editorWrap) return;
    const safe = Math.max(11, Math.min(24, parseInt(px, 10) || 14));
    editorWrap.style.setProperty('--editor-font-size', `${safe}px`);
    const cm = easyMDE?.codemirror;
    if (cm) {
      cm.getWrapperElement().style.fontSize = `${safe}px`;
      cm.refresh();
    }
    const preview = document.getElementById('preview-content');
    if (preview) preview.style.fontSize = `${safe}px`;
    if (options.persist) persistEditorFontSizePx(safe);
    if (isEditorPreviewSplit()) {
      rebuildPreviewScrollAnchors();
      if (!options.skipScrollSync) syncPreviewScrollFromEditor();
    }
  }

  function applyEditorTabSize(size = EDITOR_TAB_SIZE) {
    const editorWrap = document.querySelector('.editor-wrap');
    const tabSize = Math.max(2, Math.min(8, parseInt(size, 10) || EDITOR_TAB_SIZE));
    editorWrap?.style.setProperty('--editor-tab-size', String(tabSize));
    const cm = easyMDE?.codemirror;
    if (cm) {
      cm.setOption('tabSize', tabSize);
      cm.setOption('indentUnit', tabSize);
      cm.refresh();
    }
  }

  function applyEditorTypographyFromSettings() {
    const fontSize = window.APP_BOOT?.fontSize || 14;
    const lhPercent = window.APP_BOOT?.extraConfigs?.editor_line_height_percent
      || EDITOR_LINE_HEIGHT_DEFAULT_PERCENT;
    applyEditorFontSizePx(fontSize, { skipPersist: true, skipScrollSync: true });
    applyEditorLineHeightPercent(lhPercent, { skipPersist: true, skipScrollSync: true });
    applyEditorTabSize(EDITOR_TAB_SIZE);
    if (isEditorPreviewSplit()) {
      rebuildPreviewScrollAnchors();
      syncPreviewScrollFromEditor();
    }
  }

  function injectEditorToolbarHeightControls() {
    const toolbar = document.querySelector('#markdown-wrap .editor-toolbar');
    if (!toolbar || toolbar.dataset.heightControlsInjected === '1') return;
    toolbar.dataset.heightControlsInjected = '1';

    const splitWrap = document.createElement('div');
    splitWrap.className = 'editor-toolbar-split-control';
    splitWrap.title = 'Markdown / preview split';
    splitWrap.innerHTML = `
      <span class="editor-toolbar-split-icon" aria-hidden="true">◧</span>
      <input type="range" id="editor-split-range" class="editor-toolbar-split-range" min="280" max="800" step="8" aria-label="Markdown and preview split">
    `;

    const lineWrap = document.createElement('div');
    lineWrap.className = 'editor-toolbar-lineheight-control';
    lineWrap.title = 'Editor and preview line height';
    lineWrap.innerHTML = `
      <span class="editor-toolbar-lineheight-icon fa fa-text-height" aria-hidden="true"></span>
      <input type="range" id="editor-line-height-range" class="editor-toolbar-lineheight-range" min="100" max="220" step="5" aria-label="Editor and preview line height">
    `;

    const sideBySideBtn = toolbar.querySelector('button.side-by-side');
    const anchor = sideBySideBtn?.closest('button') || sideBySideBtn;
    if (anchor?.parentElement) {
      anchor.parentElement.insertBefore(lineWrap, anchor);
      anchor.parentElement.insertBefore(splitWrap, lineWrap);
    } else {
      toolbar.appendChild(splitWrap);
      toolbar.appendChild(lineWrap);
    }

    const splitRange = document.getElementById('editor-split-range');
    splitRange?.addEventListener('input', () => {
      setEditorMarkdownSplitWidth(parseInt(splitRange.value, 10), { skipRangeUpdate: true });
    });
    splitRange?.addEventListener('change', () => {
      setEditorMarkdownSplitWidth(parseInt(splitRange.value, 10), { persist: true });
    });

    const lhRange = document.getElementById('editor-line-height-range');
    const lhDefault = window.APP_BOOT?.extraConfigs?.editor_line_height_percent
      || EDITOR_LINE_HEIGHT_DEFAULT_PERCENT;
    if (lhRange) lhRange.value = String(lhDefault);
    lhRange?.addEventListener('input', () => {
      applyEditorLineHeightPercent(parseInt(lhRange.value, 10), { skipRangeUpdate: true });
    });
    lhRange?.addEventListener('change', () => {
      applyEditorLineHeightPercent(parseInt(lhRange.value, 10), { persist: true });
    });

    updateEditorSplitRangeBounds();
  }

  window.addEventListener('resize', () => {
    if (document.getElementById('editor-split-range')) updateEditorSplitRangeBounds();
  });

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
      setEditorMarkdownSplitWidth(w, { skipRangeUpdate: false });
    }

    function setMarkdownWidthPx(w, persist = false) {
      setEditorMarkdownSplitWidth(w, { persist, skipRangeUpdate: false });
    }

    function endDrag() {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('splitter-dragging');
      const w = getEditorMarkdownWidthPx(editorWrap);
      if (w !== null) persistEditorMarkdownWidth(w);
      if (easyMDE) {
        easyMDE.codemirror.refresh();
        rebuildPreviewScrollAnchors();
        syncPreviewScrollFromEditor();
      }
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

  function stripInlineStyleMarkup(text, styleProp) {
    const prop = String(styleProp || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(
      `<span([^>]*?)\\sstyle="([^"]*?)\\b${prop}\\s*:\\s*[^";]+;?([^"]*)"([^>]*)>([\\s\\S]*?)<\\/span>`,
      'gi',
    );
    let cleaned = String(text || '');
    let prev;
    do {
      prev = cleaned;
      cleaned = cleaned.replace(re, (_, before, styleBefore, styleAfter, after, inner) => {
        const style = `${styleBefore || ''}${styleAfter || ''}`.replace(/;\s*;/g, ';').trim().replace(/^;|;$/g, '');
        if (!style) return inner;
        return `<span${before || ''} style="${style}"${after || ''}>${inner}</span>`;
      });
    } while (cleaned !== prev);
    return cleaned;
  }

  function styledSpanNeedsBlockWrapper(inner) {
    const text = String(inner || '');
    const trimmed = text.trim();
    if (!trimmed) return false;
    if (/\n/.test(text)) return true;
    if (/^```/m.test(trimmed)) return true;
    if (/^#{1,6}\s/m.test(trimmed)) return true;
    if (/^([-*+]|\d+\.)\s/m.test(trimmed)) return true;
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/m.test(trimmed)) return true;
    if (/^>/m.test(trimmed)) return true;
    if (/<\/?(div|p|ul|ol|li|pre|table|h[1-6]|hr|blockquote)\b/i.test(trimmed)) return true;
    return false;
  }

  function renderStyledSpanHtml(attrs, inner) {
    const blocky = styledSpanNeedsBlockWrapper(inner);
    let content = '';
    try {
      content = blocky
        ? marked.parse(String(inner || '').replace(/^\n+|\n+$/g, ''), { async: false })
        : marked.parseInline(String(inner || ''));
    } catch (_) {
      content = escapeHtml(inner);
    }
    if (blocky) {
      return `<div class="md-styled-block"${attrs || ''}>${content}</div>`;
    }
    return `<span${attrs || ''}>${content}</span>`;
  }

  /** Parse markdown inside <span style="...">…</span> (innermost first). */
  function materializeMarkdownInStyledSpans(markdown) {
    let md = String(markdown || '');
    const rendered = [];
    // Innermost styled spans only (no nested <span ...> inside).
    const re = /<span(\s[^>]*?\bstyle\s*=\s*(?:"[^"]*"|'[^']*')[^>]*)>((?:(?!<span[\s>])[\s\S])*?)<\/span>/i;
    let guard = 0;
    while (guard++ < 100) {
      const match = md.match(re);
      if (!match) break;
      const token = `@@MDSTYLE${rendered.length}@@`;
      let inner = match[2] || '';
      // Nested spans were already turned into tokens — expand those before parsing.
      inner = inner.replace(/@@MDSTYLE(\d+)@@/g, (_, id) => {
        const idx = Number(id);
        return Number.isFinite(idx) && rendered[idx] != null ? rendered[idx] : '';
      });
      rendered.push(renderStyledSpanHtml(match[1] || '', inner));
      md = `${md.slice(0, match.index)}${token}${md.slice(match.index + match[0].length)}`;
    }
    return { markdown: md, rendered };
  }

  function restoreStyledSpanTokens(html, rendered) {
    if (!rendered?.length) return html;
    let out = String(html || '');
    out = out.replace(/<p>\s*(@@MDSTYLE\d+@@)\s*<\/p>/gi, '$1');
    out = out.replace(/@@MDSTYLE(\d+)@@/g, (_, id) => {
      const idx = Number(id);
      return Number.isFinite(idx) && rendered[idx] != null ? rendered[idx] : '';
    });
    return out;
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

    // Multi-line: one outer span so markdown (fences, lists, etc.) can live inside.
    const cleaned = stripFontSizeMarkup(text);
    const next = cssSize
      ? `<span style="font-size:${cssSize}">${cleaned}</span>`
      : cleaned;

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

  const HR_THICKNESS_PRESETS = [
    { key: 'thin', label: 'thin', px: 1 },
    { key: 'normal', label: 'normal', px: 2 },
    { key: 'medium', label: 'medium', px: 4 },
    { key: 'thick', label: 'thick', px: 6 },
    { key: 'heavy', label: 'heavy', px: 10 },
  ];

  function insertHorizontalRule(editor, thicknessKey) {
    const cm = editor?.codemirror;
    if (!cm) return;
    const preset = HR_THICKNESS_PRESETS.find(p => p.key === thicknessKey) || HR_THICKNESS_PRESETS[1];
    const snippet = thicknessKey === 'normal'
      ? '\n\n---\n\n'
      : `\n\n<hr class="md-hr md-hr--${preset.key}">\n\n`;
    cm.replaceSelection(snippet);
    cm.focus();
    scheduleSave();
    schedulePreviewRefresh();
  }

  function buildHorizontalRuleToolbarDropdown() {
    return {
      name: 'horizontalRuleMenu',
      className: 'fa fa-minus',
      title: 'Horizontal line',
      children: HR_THICKNESS_PRESETS.map(({ key, label }) => ({
        name: `hr${key}`,
        text: label,
        className: `hr-thickness-swatch hr-thickness-swatch--${key}`,
        title: `${label} horizontal line`,
        action: (editor) => insertHorizontalRule(editor, key),
      })),
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

    const cleaned = stripInlineStyleMarkup(text, styleProp);
    const wrapped = `<span style="${styleProp}:${color}">${cleaned}</span>`;

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

  let calendarNoteContext = null;

  function syncCalendarNoteTimeUi() {
    const timed = document.getElementById('calendar-note-timed')?.checked;
    document.getElementById('calendar-note-time-range')?.classList.toggle('d-none', !timed);
  }

  function setCalendarNotePeriodFields(startDate, untilDate, { showPeriod = false } = {}) {
    const wrap = document.getElementById('calendar-note-period-range');
    const fromInput = document.getElementById('calendar-note-date-from');
    const untilInput = document.getElementById('calendar-note-date-until');
    wrap?.classList.toggle('d-none', !showPeriod);
    setDateInputValue(fromInput, startDate || null);
    setDateInputValue(untilInput, untilDate || startDate || null);
  }

  function readCalendarNotePeriodUntil() {
    let until = readDateInputValue(document.getElementById('calendar-note-date-until'));
    let start = readDateInputValue(document.getElementById('calendar-note-date-from'));
    if (!start) {
      showToast('Choose a start date.', 'warning');
      return null;
    }
    if (!until) until = start;
    if (until < start) {
      const tmp = start;
      start = until;
      until = tmp;
      setDateInputValue(document.getElementById('calendar-note-date-from'), start);
      setDateInputValue(document.getElementById('calendar-note-date-until'), until);
    }
    return { start, until };
  }

  function setCalendarNoteTimeFields(entry = {}) {
    const allday = entry.allday !== false;
    const alldayEl = document.getElementById('calendar-note-allday');
    const timedEl = document.getElementById('calendar-note-timed');
    if (alldayEl) alldayEl.checked = allday;
    if (timedEl) timedEl.checked = !allday;
    const fromInput = document.getElementById('calendar-note-time-from');
    const toInput = document.getElementById('calendar-note-time-to');
    if (fromInput) fromInput.value = entry.timeFrom || '';
    if (toInput) toInput.value = entry.timeTo || '';
    syncCalendarNoteTimeUi();
  }

  function readCalendarNoteTimeOptions() {
    const timed = document.getElementById('calendar-note-timed')?.checked;
    if (!timed) return { allday: true, timeFrom: null, timeTo: null };
    const timeFrom = document.getElementById('calendar-note-time-from')?.value || '';
    const timeTo = document.getElementById('calendar-note-time-to')?.value || '';
    if (!timeFrom) {
      showToast('Enter a start time or choose All day.', 'warning');
      return null;
    }
    if (timeTo && timeTo < timeFrom) {
      showToast('End time must be after start time.', 'warning');
      return null;
    }
    return { allday: false, timeFrom, timeTo: timeTo || null };
  }

  function refreshCalendarNoteImagePreview() {
    const wrap = document.getElementById('calendar-note-preview');
    const image = document.getElementById('calendar-note-image')?.value?.trim() || '';
    if (!wrap) return;
    if (!image) {
      wrap.classList.add('d-none');
      wrap.innerHTML = '';
      return;
    }
    wrap.classList.remove('d-none');
    wrap.innerHTML = `<img src="${escapeHtml(image)}" alt="" class="calendar-note-preview-img">`;
  }

  function openCalendarNoteModal(unitEl, preferredKey = null) {
    if (!isPreviewInteractionEnabled()) return;
    const block = unitEl.closest('.calendar-block');
    const dayKey = unitEl.dataset.calendarKey;
    if (!block || !dayKey) return;
    const calendarIndex = parseInt(block.dataset.calendarIndex, 10);
    if (!Number.isFinite(calendarIndex)) return;

    const key = normalizeCalendarStorageKey(preferredKey || dayKey);
    const dayRange = parseCalendarDayKey(key);
    const isDayMode = !!dayRange || String(key).startsWith('@d:');

    const noteEls = preferredKey
      ? [...unitEl.querySelectorAll('.calendar-unit-note')].filter(n => n.dataset.calendarKey === key)
      : [...unitEl.querySelectorAll('.calendar-unit-note')].filter(n => {
          const noteKey = n.dataset.calendarKey;
          return !noteKey || noteKey === dayKey;
        });

    const text = (!preferredKey && unitEl.dataset.calendarMarkdown)
      || noteEls.map(noteEl => noteEl.querySelector('.calendar-unit-text')?.textContent?.trim() || '').filter(Boolean).join('\n')
      || '';
    const image = noteEls.map(n => n.querySelector('img')?.getAttribute('src') || '').find(Boolean) || '';

    calendarNoteContext = {
      calendarIndex,
      key,
      oldKey: key,
      isDayMode,
    };
    const spec = easyMDE ? getCalendarBlockSpec(easyMDE.value(), calendarIndex) : null;
    const storedEntries = normalizeCalendarEntryList(spec?.entries?.[key]);
    const firstEntry = storedEntries[0] || {};

    const title = document.getElementById('calendar-note-modal-title');
    if (title) {
      const label = dayRange
        ? (startOfDay(dayRange.from).getTime() === startOfDay(dayRange.to).getTime()
          ? formatCalendarDate(dayRange.from)
          : `${formatCalendarDate(dayRange.from)} – ${formatCalendarDate(dayRange.to)}`)
        : key.replace(/^@[dwmy]:/i, '');
      title.textContent = `Calendar note · ${label}`;
    }
    const hint = document.getElementById('calendar-note-modal-hint');
    if (hint) {
      hint.textContent = isDayMode
        ? 'All day or a time range. Edit Start / Until for a multi-day period. One note per line; image attaches to the first line.'
        : 'All day or a time range. One note per line for the same slot; image attaches to the first line.';
    }
    const textInput = document.getElementById('calendar-note-text');
    const imageInput = document.getElementById('calendar-note-image');
    if (textInput) textInput.value = text || calendarEntriesMarkdown(storedEntries);
    if (imageInput) imageInput.value = image || (firstEntry.image || '');
    setCalendarNoteTimeFields(firstEntry);
    setCalendarNotePeriodFields(
      dayRange?.from || null,
      dayRange?.to || dayRange?.from || null,
      { showPeriod: isDayMode },
    );
    refreshCalendarNoteImagePreview();
    const modalEl = document.getElementById('calendar-note-modal');
    if (modalEl) openDashboardModal(modalEl);
  }

  function saveCalendarNoteFromModal({ clear = false } = {}) {
    if (!easyMDE || !calendarNoteContext) return;
    const text = clear ? '' : (document.getElementById('calendar-note-text')?.value || '');
    const image = clear ? '' : (document.getElementById('calendar-note-image')?.value || '');
    const timeOpts = clear ? { allday: true, timeFrom: null, timeTo: null } : readCalendarNoteTimeOptions();
    if (!clear && timeOpts === null) return;

    let targetKey = calendarNoteContext.key;
    const oldKey = calendarNoteContext.oldKey || calendarNoteContext.key;
    if (!clear && calendarNoteContext.isDayMode) {
      const period = readCalendarNotePeriodUntil();
      if (period === null) return;
      if (period.start) targetKey = calendarDayKeyFromDates(period.start, period.until);
    }

    const oldMarkdown = easyMDE.value();
    const updated = updateCalendarEntryInMarkdown(
      oldMarkdown,
      calendarNoteContext.calendarIndex,
      clear ? oldKey : targetKey,
      text,
      image,
      timeOpts,
      clear ? {} : { oldKey },
    );
    if (updated !== oldMarkdown) {
      easyMDE.value(updated);
      scheduleSave();
      schedulePreviewRefresh();
    }
    bootstrap.Modal.getInstance(document.getElementById('calendar-note-modal'))?.hide();
    calendarNoteContext = null;
  }

  async function uploadCalendarNoteImage(file) {
    if (!file) return;
    syncWorkspaceIdFromDom();
    const formData = new FormData();
    formData.append('file', file);
    formData.append('workspace', workspaceId);
    try {
      const data = await api('api/uploads/', 'POST', formData, true);
      const mediaPath = mediaMarkdownPath(data.url || data.path || data.file?.url || data.file?.mediaName);
      const imageInput = document.getElementById('calendar-note-image');
      if (imageInput && mediaPath) {
        imageInput.value = mediaPath;
        refreshCalendarNoteImagePreview();
      }
    } catch (err) {
      console.warn('calendar image upload failed:', err);
      showToast(err.message || 'Image upload failed.', 'danger');
    }
  }

  function ensureCalendarHoverTooltip() {
    let tip = document.getElementById('calendar-hover-tooltip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'calendar-hover-tooltip';
      tip.className = 'calendar-hover-tooltip';
      tip.setAttribute('role', 'tooltip');
      document.body.appendChild(tip);
    }
    return tip;
  }

  function moveCalendarHoverTooltip(event) {
    const tip = ensureCalendarHoverTooltip();
    const pad = 14;
    tip.style.left = `${event.clientX + pad}px`;
    tip.style.top = `${event.clientY + pad}px`;
    const rect = tip.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) {
      tip.style.left = `${Math.max(8, event.clientX - rect.width - pad)}px`;
    }
    if (rect.bottom > window.innerHeight - 8) {
      tip.style.top = `${Math.max(8, event.clientY - rect.height - pad)}px`;
    }
  }

  function showCalendarHoverTooltip(event, text) {
    const tip = ensureCalendarHoverTooltip();
    tip.textContent = text;
    tip.classList.add('visible');
    moveCalendarHoverTooltip(event);
  }

  function hideCalendarHoverTooltip() {
    document.getElementById('calendar-hover-tooltip')?.classList.remove('visible');
  }

  function initCalendarNoteEditors() {
    const preview = document.getElementById('preview-content');
    if (!preview || preview.dataset.calendarEditBound === '1') return;
    preview.dataset.calendarEditBound = '1';

    preview.addEventListener('click', e => {
      if (!isPreviewInteractionEnabled()) return;
      const unit = e.target.closest?.('.calendar-unit--editable');
      if (!unit || !preview.contains(unit)) return;
      if (e.target.closest('a, button, input, textarea, img.md-image-link')) return;
      e.preventDefault();
      e.stopPropagation();
      hideCalendarHoverTooltip();
      const note = e.target.closest?.('.calendar-unit-note, .calendar-unit-period-bar-wrap, .calendar-unit-event-point-row');
      const noteKey = note?.dataset?.calendarKey || null;
      openCalendarNoteModal(unit, noteKey);
    });

    preview.addEventListener('pointerover', e => {
      const hit = e.target.closest?.('[data-calendar-tooltip]');
      if (!hit || !preview.contains(hit)) return;
      const text = hit.getAttribute('data-calendar-tooltip') || '';
      if (!text) return;
      showCalendarHoverTooltip(e, text);
    });
    preview.addEventListener('pointermove', e => {
      const hit = e.target.closest?.('[data-calendar-tooltip]');
      if (!hit || !preview.contains(hit)) {
        hideCalendarHoverTooltip();
        return;
      }
      if (document.getElementById('calendar-hover-tooltip')?.classList.contains('visible')) {
        moveCalendarHoverTooltip(e);
      }
    });
    preview.addEventListener('pointerout', e => {
      const from = e.target.closest?.('[data-calendar-tooltip]');
      const to = e.relatedTarget?.closest?.('[data-calendar-tooltip]');
      if (from && from !== to) hideCalendarHoverTooltip();
    });
    preview.addEventListener('scroll', hideCalendarHoverTooltip, true);

    document.getElementById('calendar-note-save-btn')?.addEventListener('click', () => {
      saveCalendarNoteFromModal();
    });
    document.getElementById('calendar-note-clear-btn')?.addEventListener('click', () => {
      saveCalendarNoteFromModal({ clear: true });
    });
    document.getElementById('calendar-note-allday')?.addEventListener('change', syncCalendarNoteTimeUi);
    document.getElementById('calendar-note-timed')?.addEventListener('change', syncCalendarNoteTimeUi);
    document.getElementById('calendar-note-image')?.addEventListener('input', refreshCalendarNoteImagePreview);
    document.getElementById('calendar-note-upload-btn')?.addEventListener('click', () => {
      document.getElementById('calendar-note-file')?.click();
    });
    document.getElementById('calendar-note-file')?.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (file) await uploadCalendarNoteImage(file);
    });
  }

  let ganttNoteContext = null;
  let ganttTitleContext = null;

  function refreshGanttNoteImagePreview() {
    const wrap = document.getElementById('gantt-note-preview');
    const image = document.getElementById('gantt-note-image')?.value?.trim() || '';
    if (!wrap) return;
    if (!image) {
      wrap.classList.add('d-none');
      wrap.innerHTML = '';
      return;
    }
    wrap.classList.remove('d-none');
    wrap.innerHTML = `<img src="${escapeHtml(image)}" alt="" class="calendar-note-preview-img">`;
  }

  function openGanttTitleModal(titleEl) {
    if (!isPreviewInteractionEnabled()) return;
    const block = titleEl.closest('.gantt-block');
    if (!block) return;
    const ganttIndex = parseInt(block.dataset.ganttIndex, 10);
    if (!Number.isFinite(ganttIndex)) return;

    ganttTitleContext = { ganttIndex };
    const titleInput = document.getElementById('gantt-title-input');
    const fromInput = document.getElementById('gantt-title-from');
    const toInput = document.getElementById('gantt-title-to');
    if (titleInput) titleInput.value = block.dataset.ganttTitle || '';
    setDateInputValue(fromInput, block.dataset.ganttFrom || '');
    setDateInputValue(toInput, block.dataset.ganttTo || '');
    const modalEl = document.getElementById('gantt-title-modal');
    if (modalEl) openDashboardModal(modalEl);
  }

  function saveGanttTitleFromModal({ clear = false } = {}) {
    if (!easyMDE || !ganttTitleContext) return;
    const title = clear ? '' : (document.getElementById('gantt-title-input')?.value || '');
    const from = readDateInputValue(document.getElementById('gantt-title-from'));
    const to = readDateInputValue(document.getElementById('gantt-title-to'));
    const oldMarkdown = easyMDE.value();
    const updated = updateGanttMetaInMarkdown(
      oldMarkdown,
      ganttTitleContext.ganttIndex,
      { title, from, to },
    );
    if (updated !== oldMarkdown) {
      easyMDE.value(updated);
      scheduleSave();
      schedulePreviewRefresh();
    }
    bootstrap.Modal.getInstance(document.getElementById('gantt-title-modal'))?.hide();
    ganttTitleContext = null;
  }

  function openGanttNoteModal(rowEl) {
    if (!isPreviewInteractionEnabled()) return;
    const block = rowEl.closest('.gantt-block');
    const taskId = rowEl.dataset.ganttTaskId;
    if (!block || !taskId) return;
    const ganttIndex = parseInt(block.dataset.ganttIndex, 10);
    if (!Number.isFinite(ganttIndex)) return;

    const label = rowEl.querySelector('.gantt-row-name')?.textContent || '';
    const text = rowEl.dataset.ganttMarkdown
      || rowEl.querySelector('.gantt-task-text')?.textContent
      || '';
    const image = rowEl.querySelector('.gantt-task-image')?.getAttribute('src') || '';
    const from = rowEl.dataset.ganttFrom || '';
    const to = rowEl.dataset.ganttTo || '';

    ganttNoteContext = { ganttIndex, taskId };
    const title = document.getElementById('gantt-note-modal-title');
    if (title) title.textContent = `Gantt task · ${label || taskId}`;
    const labelInput = document.getElementById('gantt-note-label');
    const fromInput = document.getElementById('gantt-note-from');
    const toInput = document.getElementById('gantt-note-to');
    const textInput = document.getElementById('gantt-note-text');
    const imageInput = document.getElementById('gantt-note-image');
    if (labelInput) labelInput.value = label;
    setDateInputValue(fromInput, from);
    setDateInputValue(toInput, to);
    if (textInput) textInput.value = text;
    if (imageInput) imageInput.value = image;
    refreshGanttNoteImagePreview();
    const modalEl = document.getElementById('gantt-note-modal');
    if (modalEl) openDashboardModal(modalEl);
  }

  function saveGanttNoteFromModal({ clear = false } = {}) {
    if (!easyMDE || !ganttNoteContext) return;
    const label = clear ? null : (document.getElementById('gantt-note-label')?.value || '');
    const from = clear ? null : readDateInputValue(document.getElementById('gantt-note-from'));
    const to = clear ? null : readDateInputValue(document.getElementById('gantt-note-to'));
    const text = clear ? '' : (document.getElementById('gantt-note-text')?.value || '');
    const image = clear ? '' : (document.getElementById('gantt-note-image')?.value || '');
    const oldMarkdown = easyMDE.value();
    const updated = updateGanttTaskInMarkdown(
      oldMarkdown,
      ganttNoteContext.ganttIndex,
      ganttNoteContext.taskId,
      { label, from, to, text, image },
    );
    if (updated !== oldMarkdown) {
      easyMDE.value(updated);
      scheduleSave();
      schedulePreviewRefresh();
    }
    bootstrap.Modal.getInstance(document.getElementById('gantt-note-modal'))?.hide();
    ganttNoteContext = null;
  }

  async function uploadGanttNoteImage(file) {
    if (!file) return;
    syncWorkspaceIdFromDom();
    const formData = new FormData();
    formData.append('file', file);
    formData.append('workspace', workspaceId);
    try {
      const data = await api('api/uploads/', 'POST', formData, true);
      const mediaPath = mediaMarkdownPath(data.url || data.path || data.file?.url || data.file?.mediaName);
      const imageInput = document.getElementById('gantt-note-image');
      if (imageInput && mediaPath) {
        imageInput.value = mediaPath;
        refreshGanttNoteImagePreview();
      }
    } catch (err) {
      console.warn('gantt image upload failed:', err);
      showToast(err.message || 'Image upload failed.', 'danger');
    }
  }

  function initGanttNoteEditors() {
    const preview = document.getElementById('preview-content');
    if (!preview || preview.dataset.ganttEditBound === '1') return;
    preview.dataset.ganttEditBound = '1';

    preview.addEventListener('click', e => {
      if (!isPreviewInteractionEnabled()) return;
      if (e.target.closest('a, button, input, textarea, img.md-image-link')) return;
      const title = e.target.closest?.('.gantt-block-title--editable');
      if (title && preview.contains(title)) {
        e.preventDefault();
        e.stopPropagation();
        openGanttTitleModal(title);
        return;
      }
      const row = e.target.closest?.('.gantt-row--editable');
      if (!row || !preview.contains(row)) return;
      e.preventDefault();
      e.stopPropagation();
      openGanttNoteModal(row);
    });

    document.getElementById('gantt-note-save-btn')?.addEventListener('click', () => {
      saveGanttNoteFromModal();
    });
    document.getElementById('gantt-note-clear-btn')?.addEventListener('click', () => {
      saveGanttNoteFromModal({ clear: true });
    });
    document.getElementById('gantt-note-image')?.addEventListener('input', refreshGanttNoteImagePreview);
    document.getElementById('gantt-note-upload-btn')?.addEventListener('click', () => {
      document.getElementById('gantt-note-file')?.click();
    });
    document.getElementById('gantt-note-file')?.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (file) await uploadGanttNoteImage(file);
    });
    document.getElementById('gantt-title-save-btn')?.addEventListener('click', () => {
      saveGanttTitleFromModal();
    });
    document.getElementById('gantt-title-clear-btn')?.addEventListener('click', () => {
      saveGanttTitleFromModal({ clear: true });
    });
  }

  let kanbanCardContext = null;
  let kanbanTitleContext = null;
  let kanbanDragState = null;

  function refreshKanbanCardImagePreview() {
    const wrap = document.getElementById('kanban-card-preview');
    const image = document.getElementById('kanban-card-image')?.value?.trim() || '';
    if (!wrap) return;
    if (!image) {
      wrap.classList.add('d-none');
      wrap.innerHTML = '';
      return;
    }
    wrap.classList.remove('d-none');
    wrap.innerHTML = `<img src="${escapeHtml(image)}" alt="" class="calendar-note-preview-img">`;
  }

  function fillKanbanColumnSelect(selectEl, columns, selected) {
    if (!selectEl) return;
    const cols = columns?.length ? columns : [...KANBAN_DEFAULT_COLS];
    selectEl.innerHTML = cols.map(col => (
      `<option value="${escapeHtml(col)}"${col === selected ? ' selected' : ''}>${escapeHtml(col)}</option>`
    )).join('');
  }

  function openKanbanTitleModal(titleEl) {
    if (!isPreviewInteractionEnabled()) return;
    const block = titleEl.closest('.kanban-block');
    if (!block) return;
    const kanbanIndex = parseInt(block.dataset.kanbanIndex, 10);
    if (!Number.isFinite(kanbanIndex)) return;
    kanbanTitleContext = { kanbanIndex };
    const titleInput = document.getElementById('kanban-title-input');
    const colsInput = document.getElementById('kanban-title-cols');
    if (titleInput) titleInput.value = block.dataset.kanbanTitle || '';
    if (colsInput) colsInput.value = block.dataset.kanbanCols || '';
    const modalEl = document.getElementById('kanban-title-modal');
    if (modalEl) openDashboardModal(modalEl);
  }

  function saveKanbanTitleFromModal({ clear = false } = {}) {
    if (!easyMDE || !kanbanTitleContext) return;
    const title = clear ? '' : (document.getElementById('kanban-title-input')?.value || '');
    const columns = document.getElementById('kanban-title-cols')?.value || '';
    const oldMarkdown = easyMDE.value();
    const updated = updateKanbanMetaInMarkdown(
      oldMarkdown,
      kanbanTitleContext.kanbanIndex,
      { title, columns },
    );
    if (updated !== oldMarkdown) {
      easyMDE.value(updated);
      scheduleSave();
      schedulePreviewRefresh();
    }
    bootstrap.Modal.getInstance(document.getElementById('kanban-title-modal'))?.hide();
    kanbanTitleContext = null;
  }

  function openKanbanCardModal(cardEl) {
    if (!isPreviewInteractionEnabled()) return;
    const block = cardEl.closest('.kanban-block');
    const cardId = cardEl.dataset.kanbanCardId;
    if (!block || !cardId) return;
    const kanbanIndex = parseInt(block.dataset.kanbanIndex, 10);
    if (!Number.isFinite(kanbanIndex)) return;

    const columns = parseKanbanColumns(block.dataset.kanbanCols || '');
    const label = cardEl.querySelector('.kanban-card-label')?.textContent || '';
    const text = cardEl.dataset.kanbanMarkdown
      || cardEl.querySelector('.kanban-card-text')?.textContent
      || '';
    const image = cardEl.querySelector('.kanban-card-image')?.getAttribute('src') || '';
    const col = cardEl.dataset.kanbanCol || columns[0] || '';

    kanbanCardContext = { kanbanIndex, cardId };
    const title = document.getElementById('kanban-card-modal-title');
    if (title) title.textContent = `Kanban card · ${label || cardId}`;
    const labelInput = document.getElementById('kanban-card-label');
    const colSelect = document.getElementById('kanban-card-col');
    const textInput = document.getElementById('kanban-card-text');
    const imageInput = document.getElementById('kanban-card-image');
    if (labelInput) labelInput.value = label;
    fillKanbanColumnSelect(colSelect, columns, col);
    if (textInput) textInput.value = text;
    if (imageInput) imageInput.value = image;
    refreshKanbanCardImagePreview();
    const modalEl = document.getElementById('kanban-card-modal');
    if (modalEl) openDashboardModal(modalEl);
  }

  function saveKanbanCardFromModal({ clear = false } = {}) {
    if (!easyMDE || !kanbanCardContext) return;
    const label = clear ? null : (document.getElementById('kanban-card-label')?.value || '');
    const col = clear ? null : (document.getElementById('kanban-card-col')?.value || '');
    const text = clear ? '' : (document.getElementById('kanban-card-text')?.value || '');
    const image = clear ? '' : (document.getElementById('kanban-card-image')?.value || '');
    const oldMarkdown = easyMDE.value();
    const updated = updateKanbanCardInMarkdown(
      oldMarkdown,
      kanbanCardContext.kanbanIndex,
      kanbanCardContext.cardId,
      { label, col, text, image },
    );
    if (updated !== oldMarkdown) {
      easyMDE.value(updated);
      scheduleSave();
      schedulePreviewRefresh();
    }
    bootstrap.Modal.getInstance(document.getElementById('kanban-card-modal'))?.hide();
    kanbanCardContext = null;
  }

  async function uploadKanbanCardImage(file) {
    if (!file) return;
    syncWorkspaceIdFromDom();
    const formData = new FormData();
    formData.append('file', file);
    formData.append('workspace', workspaceId);
    try {
      const data = await api('api/uploads/', 'POST', formData, true);
      const mediaPath = mediaMarkdownPath(data.url || data.path || data.file?.url || data.file?.mediaName);
      const imageInput = document.getElementById('kanban-card-image');
      if (imageInput && mediaPath) {
        imageInput.value = mediaPath;
        refreshKanbanCardImagePreview();
      }
    } catch (err) {
      console.warn('kanban image upload failed:', err);
      showToast(err.message || 'Image upload failed.', 'danger');
    }
  }

  function clearKanbanDropTargets(preview) {
    preview?.querySelectorAll('.kanban-column--drop-target, .kanban-card--drop-before').forEach(el => {
      el.classList.remove('kanban-column--drop-target', 'kanban-card--drop-before');
    });
  }

  function applyKanbanMove(cardId, kanbanIndex, targetCol, beforeCardId) {
    if (!easyMDE || !cardId || !targetCol) return;
    const oldMarkdown = easyMDE.value();
    const updated = moveKanbanCardInMarkdown(oldMarkdown, kanbanIndex, cardId, targetCol, beforeCardId);
    if (updated !== oldMarkdown) {
      easyMDE.value(updated);
      scheduleSave();
      schedulePreviewRefresh();
    }
  }

  function initKanbanEditors() {
    const preview = document.getElementById('preview-content');
    if (!preview || preview.dataset.kanbanEditBound === '1') return;
    preview.dataset.kanbanEditBound = '1';

    preview.addEventListener('click', e => {
      if (!isPreviewInteractionEnabled()) return;
      if (e.target.closest('a, button, input, textarea, img.md-image-link')) return;
      const title = e.target.closest?.('.kanban-block-title--editable');
      if (title && preview.contains(title)) {
        e.preventDefault();
        e.stopPropagation();
        openKanbanTitleModal(title);
        return;
      }
      const card = e.target.closest?.('.kanban-card--editable');
      if (!card || !preview.contains(card)) return;
      if (kanbanDragState?.moved) return;
      e.preventDefault();
      e.stopPropagation();
      openKanbanCardModal(card);
    });

    preview.addEventListener('dragstart', e => {
      if (!isPreviewInteractionEnabled()) return;
      const card = e.target.closest?.('.kanban-card--editable');
      if (!card || !preview.contains(card)) return;
      const block = card.closest('.kanban-block');
      const kanbanIndex = parseInt(block?.dataset?.kanbanIndex, 10);
      if (!Number.isFinite(kanbanIndex)) return;
      kanbanDragState = {
        cardId: card.dataset.kanbanCardId,
        fromCol: card.dataset.kanbanCol,
        kanbanIndex,
        moved: false,
      };
      card.classList.add('kanban-card--dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.kanbanCardId || '');
      try {
        e.dataTransfer.setData('application/x-kanban-card', JSON.stringify(kanbanDragState));
      } catch (_) { /* ignore */ }
    });

    preview.addEventListener('dragend', e => {
      const card = e.target.closest?.('.kanban-card');
      card?.classList.remove('kanban-card--dragging');
      clearKanbanDropTargets(preview);
      // Delay clear so click after drag doesn't open modal
      setTimeout(() => { kanbanDragState = null; }, 50);
    });

    preview.addEventListener('dragover', e => {
      if (!kanbanDragState || !isPreviewInteractionEnabled()) return;
      const column = e.target.closest?.('.kanban-column');
      if (!column || !preview.contains(column)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      clearKanbanDropTargets(preview);
      column.classList.add('kanban-column--drop-target');
      const overCard = e.target.closest?.('.kanban-card');
      if (overCard && overCard.dataset.kanbanCardId !== kanbanDragState.cardId) {
        const rect = overCard.getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) {
          overCard.classList.add('kanban-card--drop-before');
        }
      }
    });

    preview.addEventListener('dragleave', e => {
      const column = e.target.closest?.('.kanban-column');
      if (!column) return;
      if (!column.contains(e.relatedTarget)) {
        column.classList.remove('kanban-column--drop-target');
      }
    });

    preview.addEventListener('drop', e => {
      if (!kanbanDragState || !isPreviewInteractionEnabled()) return;
      const column = e.target.closest?.('.kanban-column');
      if (!column || !preview.contains(column)) return;
      e.preventDefault();
      e.stopPropagation();
      const targetCol = column.dataset.kanbanCol;
      const overCard = column.querySelector('.kanban-card--drop-before');
      const beforeCardId = overCard?.dataset?.kanbanCardId || null;
      const { cardId, kanbanIndex, fromCol } = kanbanDragState;
      kanbanDragState.moved = true;
      clearKanbanDropTargets(preview);
      if (!targetCol || !cardId) return;
      if (targetCol === fromCol && !beforeCardId) return;
      applyKanbanMove(cardId, kanbanIndex, targetCol, beforeCardId);
    });

    document.getElementById('kanban-card-save-btn')?.addEventListener('click', () => {
      saveKanbanCardFromModal();
    });
    document.getElementById('kanban-card-clear-btn')?.addEventListener('click', () => {
      saveKanbanCardFromModal({ clear: true });
    });
    document.getElementById('kanban-card-image')?.addEventListener('input', refreshKanbanCardImagePreview);
    document.getElementById('kanban-card-upload-btn')?.addEventListener('click', () => {
      document.getElementById('kanban-card-file')?.click();
    });
    document.getElementById('kanban-card-file')?.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (file) await uploadKanbanCardImage(file);
    });
    document.getElementById('kanban-title-save-btn')?.addEventListener('click', () => {
      saveKanbanTitleFromModal();
    });
    document.getElementById('kanban-title-clear-btn')?.addEventListener('click', () => {
      saveKanbanTitleFromModal({ clear: true });
    });
  }

  let kgCardContext = null;
  let kgTitleContext = null;
  let kgDragState = null;
  let kgTickTimer = null;

  function clearKgDropTargets(preview) {
    preview?.querySelectorAll('.kg-column--drop-target, .kg-card--drop-before, .kg-card--drop-after').forEach(el => {
      el.classList.remove('kg-column--drop-target', 'kg-card--drop-before', 'kg-card--drop-after');
    });
  }

  function refreshKgCardImagePreview() {
    const wrap = document.getElementById('kg-card-preview');
    const image = document.getElementById('kg-card-image')?.value?.trim() || '';
    if (!wrap) return;
    if (!image) {
      wrap.classList.add('d-none');
      wrap.innerHTML = '';
      return;
    }
    wrap.classList.remove('d-none');
    wrap.innerHTML = `<img src="${escapeHtml(image)}" alt="" class="calendar-note-preview-img">`;
  }

  function fillKgColumnSelect(selectEl, columns, selected) {
    if (!selectEl) return;
    const cols = columns?.length ? columns : [...KANBANGANTT_DEFAULT_COLS];
    selectEl.innerHTML = cols.map(col => (
      `<option value="${escapeHtml(col)}"${col === selected ? ' selected' : ''}>${escapeHtml(col)}</option>`
    )).join('');
  }

  function syncKgTitleCostFields() {
    const enabled = document.getElementById('kg-title-withcost')?.checked !== false;
    document.getElementById('kg-title-cost-fields')?.classList.toggle('d-none', !enabled);
  }

  function openKgTitleModal(titleEl) {
    if (!isPreviewInteractionEnabled()) return;
    const block = titleEl.closest('.kg-block');
    if (!block) return;
    const kgIndex = parseInt(block.dataset.kgIndex, 10);
    if (!Number.isFinite(kgIndex)) return;

    kgTitleContext = { kgIndex };
    const titleInput = document.getElementById('kg-title-input');
    const colsInput = document.getElementById('kg-title-cols');
    const withCostInput = document.getElementById('kg-title-withcost');
    const rateInput = document.getElementById('kg-title-rate');
    const currencyInput = document.getElementById('kg-title-currency');
    if (titleInput) titleInput.value = block.dataset.kgTitle || '';
    if (colsInput) colsInput.value = block.dataset.kgCols || '';
    if (withCostInput) withCostInput.checked = block.dataset.kgWithcost !== '0';
    if (rateInput) rateInput.value = block.dataset.kgRate || '0';
    if (currencyInput) currencyInput.value = block.dataset.kgCurrency || 'EUR';
    syncKgTitleCostFields();
    const modalEl = document.getElementById('kg-title-modal');
    if (modalEl) openDashboardModal(modalEl);
  }

  function saveKgTitleFromModal({ clear = false } = {}) {
    if (!easyMDE || !kgTitleContext) return;
    const title = clear ? '' : (document.getElementById('kg-title-input')?.value || '');
    const columns = document.getElementById('kg-title-cols')?.value || '';
    const withCost = document.getElementById('kg-title-withcost')?.checked !== false;
    const currency = document.getElementById('kg-title-currency')?.value || 'EUR';
    const patch = { title, columns, currency, withCost };
    if (withCost) patch.rate = document.getElementById('kg-title-rate')?.value || '0';
    const oldMarkdown = easyMDE.value();
    const updated = updateKanbanganttMetaInMarkdown(
      oldMarkdown,
      kgTitleContext.kgIndex,
      patch,
    );
    if (updated !== oldMarkdown) {
      easyMDE.value(updated);
      scheduleSave();
      schedulePreviewRefresh();
    }
    bootstrap.Modal.getInstance(document.getElementById('kg-title-modal'))?.hide();
    kgTitleContext = null;
  }

  function openKgCardModal(cardEl) {
    if (!isPreviewInteractionEnabled()) return;
    const block = cardEl.closest('.kg-block');
    const cardId = cardEl.dataset.kgCardId;
    if (!block || !cardId) return;
    const kgIndex = parseInt(block.dataset.kgIndex, 10);
    if (!Number.isFinite(kgIndex)) return;

    const columns = parseKanbanColumns(block.dataset.kgCols || '');
    const label = cardEl.querySelector('.kg-card-label')?.textContent || '';
    const text = cardEl.dataset.kgMarkdown
      || cardEl.querySelector('.kg-card-text')?.textContent
      || '';
    const image = cardEl.querySelector('.kg-card-image')?.getAttribute('src') || '';
    const col = cardEl.dataset.kgCol || columns[0] || 'Todo';
    const rate = cardEl.dataset.kgRate || block.dataset.kgRate || '0';
    const status = cardEl.dataset.kgStatus || 'idle';
    const elapsed = cardEl.dataset.kgElapsed || '0';
    const withCost = block.dataset.kgWithcost !== '0';

    kgCardContext = { kgIndex, cardId };
    const title = document.getElementById('kg-card-modal-title');
    if (title) title.textContent = `Task · ${label || cardId}`;
    const labelInput = document.getElementById('kg-card-label');
    const colSelect = document.getElementById('kg-card-col');
    const rateInput = document.getElementById('kg-card-rate');
    const rateField = document.getElementById('kg-card-rate-field');
    const statusSelect = document.getElementById('kg-card-status');
    const elapsedInput = document.getElementById('kg-card-elapsed');
    const textInput = document.getElementById('kg-card-text');
    const imageInput = document.getElementById('kg-card-image');
    if (labelInput) labelInput.value = label;
    fillKgColumnSelect(colSelect, columns, col);
    rateField?.classList.toggle('d-none', !withCost);
    if (rateInput) rateInput.value = rate;
    if (statusSelect) statusSelect.value = parseKgStatus(status);
    if (elapsedInput) elapsedInput.value = elapsed;
    if (textInput) textInput.value = text;
    if (imageInput) imageInput.value = image;
    refreshKgCardImagePreview();
    const modalEl = document.getElementById('kg-card-modal');
    if (modalEl) openDashboardModal(modalEl);
  }

  function saveKgCardFromModal({ clear = false } = {}) {
    if (!easyMDE || !kgCardContext) return;
    const label = clear ? null : (document.getElementById('kg-card-label')?.value || '');
    const col = clear ? null : (document.getElementById('kg-card-col')?.value || '');
    const withCost = document.getElementById('preview-content')
      ?.querySelector(`.kg-block[data-kg-index="${kgCardContext.kgIndex}"]`)
      ?.dataset?.kgWithcost !== '0';
    const rate = clear || !withCost ? null : (document.getElementById('kg-card-rate')?.value || '');
    const status = clear ? null : (document.getElementById('kg-card-status')?.value || 'idle');
    const elapsed = clear ? null : (document.getElementById('kg-card-elapsed')?.value || '0');
    const text = clear ? '' : (document.getElementById('kg-card-text')?.value || '');
    const image = clear ? '' : (document.getElementById('kg-card-image')?.value || '');
    const patch = { label, col, status, elapsed, text, image };
    if (rate != null) patch.rate = rate;
    if (!clear && status && status !== 'running') patch.started = null;
    const oldMarkdown = easyMDE.value();
    const updated = updateKanbanganttCardInMarkdown(
      oldMarkdown,
      kgCardContext.kgIndex,
      kgCardContext.cardId,
      patch,
    );
    if (updated !== oldMarkdown) {
      easyMDE.value(updated);
      scheduleSave();
      schedulePreviewRefresh();
    }
    bootstrap.Modal.getInstance(document.getElementById('kg-card-modal'))?.hide();
    kgCardContext = null;
  }

  async function uploadKgCardImage(file) {
    if (!file) return;
    syncWorkspaceIdFromDom();
    const formData = new FormData();
    formData.append('file', file);
    formData.append('workspace', workspaceId);
    try {
      const data = await api('api/uploads/', 'POST', formData, true);
      const mediaPath = mediaMarkdownPath(data.url || data.path || data.file?.url || data.file?.mediaName);
      const imageInput = document.getElementById('kg-card-image');
      if (imageInput && mediaPath) {
        imageInput.value = mediaPath;
        refreshKgCardImagePreview();
      }
    } catch (err) {
      console.warn('kanbangantt image upload failed:', err);
      showToast(err.message || 'Image upload failed.', 'danger');
    }
  }

  function applyKgTimerAction(cardId, kgIndex, action) {
    if (!easyMDE || !cardId || !Number.isFinite(kgIndex)) return;
    capturePreviewScrollPosition();
    lockEditorPreviewScroll(800);
    const oldMarkdown = easyMDE.value();
    const updated = applyKanbanganttTimerInMarkdown(oldMarkdown, kgIndex, cardId, action);
    if (updated === oldMarkdown) return;
    easyMDE.value(updated);
    scheduleSave();
    if (refreshKgPreviewCard(cardId, kgIndex)) {
      restorePreviewScrollPosition(document.getElementById('preview-content'));
    } else {
      schedulePreviewRefresh();
    }
  }

  function applyKgMove(cardId, kgIndex, targetCol, placement = {}) {
    if (!easyMDE || !cardId || !targetCol) return;
    capturePreviewScrollPosition();
    lockEditorPreviewScroll(800);
    const beforeCardId = placement.beforeCardId === cardId ? null : (placement.beforeCardId || null);
    const afterCardId = placement.afterCardId === cardId ? null : (placement.afterCardId || null);
    const oldMarkdown = easyMDE.value();
    const updated = moveKanbanganttCardInMarkdown(oldMarkdown, kgIndex, cardId, targetCol, {
      beforeCardId,
      afterCardId,
    });
    if (updated === oldMarkdown) return;
    easyMDE.value(updated);
    scheduleSave();
    if (refreshKgPreviewCard(cardId, kgIndex)) {
      restorePreviewScrollPosition(document.getElementById('preview-content'));
    } else {
      schedulePreviewRefresh();
    }
  }

  function tickKgRunningCards() {
    const preview = document.getElementById('preview-content');
    if (!preview) return;
    const now = Date.now();
    preview.querySelectorAll('.kg-card[data-kg-status="running"]').forEach(card => {
      const elapsedBase = parseKgElapsed(card.dataset.kgElapsed);
      const startedMs = Date.parse(card.dataset.kgStarted || '');
      let elapsed = elapsedBase;
      if (Number.isFinite(startedMs)) elapsed += Math.max(0, Math.floor((now - startedMs) / 1000));
      const rate = parseKgRate(card.dataset.kgRate, 0);
      const block = card.closest('.kg-block');
      const withCost = block?.dataset?.kgWithcost !== '0';
      const currency = block?.dataset?.kgCurrency || 'EUR';
      const metrics = card.querySelector('.kg-card-metrics');
      if (metrics) {
        const durationEl = metrics.querySelector('span');
        const costEl = metrics.querySelector('.kg-card-cost');
        if (durationEl) durationEl.textContent = formatKgDuration(elapsed);
        if (withCost && costEl) costEl.textContent = formatKgMoney((elapsed / 3600) * rate, currency);
      }
    });
    preview.querySelectorAll('.kg-block').forEach(block => {
      const withCost = block.dataset.kgWithcost !== '0';
      const currency = block.dataset.kgCurrency || 'EUR';
      let totalCost = 0;
      let totalElapsed = 0;
      block.querySelectorAll('.kg-card').forEach(card => {
        const elapsedBase = parseKgElapsed(card.dataset.kgElapsed);
        let elapsed = elapsedBase;
        if (card.dataset.kgStatus === 'running') {
          const startedMs = Date.parse(card.dataset.kgStarted || '');
          if (Number.isFinite(startedMs)) elapsed += Math.max(0, Math.floor((now - startedMs) / 1000));
        }
        const rate = parseKgRate(card.dataset.kgRate, 0);
        totalElapsed += elapsed;
        totalCost += (elapsed / 3600) * rate;
      });
      const footer = block.querySelector('.kg-block-footer strong');
      if (footer && withCost) footer.textContent = formatKgMoney(totalCost, currency);
      const meta = block.querySelector('.kg-block-meta');
      if (meta) {
        const count = block.querySelectorAll('.kg-card').length;
        const rate = block.dataset.kgRate || '0';
        const parts = [`${count} task(s)`, formatKgDuration(totalElapsed)];
        if (withCost) {
          parts.push(formatKgMoney(totalCost, currency));
          if (parseKgRate(rate) > 0) parts.push(`default ${rate}/h`);
        }
        meta.textContent = parts.join(' · ');
      }
      if (!withCost) return;
      block.querySelectorAll('.kg-column').forEach(column => {
        let colCost = 0;
        column.querySelectorAll('.kg-card').forEach(card => {
          const elapsedBase = parseKgElapsed(card.dataset.kgElapsed);
          let elapsed = elapsedBase;
          if (card.dataset.kgStatus === 'running') {
            const startedMs = Date.parse(card.dataset.kgStarted || '');
            if (Number.isFinite(startedMs)) elapsed += Math.max(0, Math.floor((now - startedMs) / 1000));
          }
          colCost += (elapsed / 3600) * parseKgRate(card.dataset.kgRate, 0);
        });
        const costEl = column.querySelector('.kg-column-cost');
        if (costEl) costEl.textContent = formatKgMoney(colCost, currency);
      });
    });
  }

  function ensureKgTickTimer() {
    if (kgTickTimer) return;
    kgTickTimer = setInterval(() => {
      const preview = document.getElementById('preview-content');
      if (!preview?.querySelector('.kg-card[data-kg-status="running"]')) return;
      tickKgRunningCards();
    }, 1000);
  }

  function initKanbanganttEditors() {
    const preview = document.getElementById('preview-content');
    if (!preview || preview.dataset.kgEditBound === '1') return;
    preview.dataset.kgEditBound = '1';
    ensureKgTickTimer();

    preview.addEventListener('click', e => {
      if (!isPreviewInteractionEnabled()) return;
      const actionBtn = e.target.closest?.('.kg-action-btn');
      if (actionBtn && preview.contains(actionBtn)) {
        e.preventDefault();
        e.stopPropagation();
        const card = actionBtn.closest('.kg-card');
        const block = actionBtn.closest('.kg-block');
        const cardId = card?.dataset?.kgCardId;
        const kgIndex = parseInt(block?.dataset?.kgIndex, 10);
        const action = actionBtn.dataset.kgAction;
        if (cardId && Number.isFinite(kgIndex) && action) applyKgTimerAction(cardId, kgIndex, action);
        return;
      }
      if (e.target.closest('a, button, input, textarea, img.md-image-link, .kg-drag-handle')) return;
      const title = e.target.closest?.('.kg-block-title--editable');
      if (title && preview.contains(title)) {
        e.preventDefault();
        e.stopPropagation();
        openKgTitleModal(title);
        return;
      }
      const card = e.target.closest?.('.kg-card--editable');
      if (!card || !preview.contains(card)) return;
      if (kgDragState?.moved) return;
      e.preventDefault();
      e.stopPropagation();
      openKgCardModal(card);
    });

    preview.addEventListener('dragstart', e => {
      if (!isPreviewInteractionEnabled()) return;
      const handle = e.target.closest?.('.kg-drag-handle');
      if (!handle || !preview.contains(handle)) return;
      const card = handle.closest('.kg-card--editable');
      if (!card || !preview.contains(card)) return;
      const block = card.closest('.kg-block');
      const kgIndex = parseInt(block?.dataset?.kgIndex, 10);
      if (!Number.isFinite(kgIndex)) return;
      e.stopPropagation();
      kgDragState = {
        cardId: card.dataset.kgCardId,
        fromCol: card.dataset.kgCol,
        kgIndex,
        moved: false,
      };
      card.classList.add('kg-card--dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.kgCardId || '');
      try {
        e.dataTransfer.setData('application/x-kg-card', JSON.stringify(kgDragState));
      } catch (_) { /* ignore */ }
    });

    preview.addEventListener('dragend', e => {
      const card = e.target.closest?.('.kg-card');
      card?.classList.remove('kg-card--dragging');
      clearKgDropTargets(preview);
      setTimeout(() => { kgDragState = null; }, 50);
    });

    preview.addEventListener('dragover', e => {
      if (!kgDragState || !isPreviewInteractionEnabled()) return;
      const column = e.target.closest?.('.kg-column');
      if (!column || !preview.contains(column)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      clearKgDropTargets(preview);
      column.classList.add('kg-column--drop-target');
      const overCard = e.target.closest?.('.kg-card');
      if (overCard && overCard.dataset.kgCardId !== kgDragState.cardId) {
        const rect = overCard.getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) {
          overCard.classList.add('kg-card--drop-before');
        } else {
          overCard.classList.add('kg-card--drop-after');
        }
      }
    });

    preview.addEventListener('dragleave', e => {
      const column = e.target.closest?.('.kg-column');
      if (!column) return;
      if (!column.contains(e.relatedTarget)) {
        column.classList.remove('kg-column--drop-target');
      }
    });

    preview.addEventListener('drop', e => {
      if (!kgDragState || !isPreviewInteractionEnabled()) return;
      const column = e.target.closest?.('.kg-column');
      if (!column || !preview.contains(column)) return;
      e.preventDefault();
      e.stopPropagation();
      const targetCol = column.dataset.kgCol;
      const beforeEl = column.querySelector('.kg-card--drop-before');
      const afterEl = column.querySelector('.kg-card--drop-after');
      const beforeCardId = beforeEl?.dataset?.kgCardId || null;
      const afterCardId = afterEl?.dataset?.kgCardId || null;
      const { cardId, kgIndex } = kgDragState;
      kgDragState.moved = true;
      clearKgDropTargets(preview);
      if (!targetCol || !cardId) return;
      applyKgMove(cardId, kgIndex, targetCol, { beforeCardId, afterCardId });
    });

    document.getElementById('kg-card-save-btn')?.addEventListener('click', () => {
      saveKgCardFromModal();
    });
    document.getElementById('kg-card-clear-btn')?.addEventListener('click', () => {
      saveKgCardFromModal({ clear: true });
    });
    document.getElementById('kg-card-image')?.addEventListener('input', refreshKgCardImagePreview);
    document.getElementById('kg-card-upload-btn')?.addEventListener('click', () => {
      document.getElementById('kg-card-file')?.click();
    });
    document.getElementById('kg-card-file')?.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (file) await uploadKgCardImage(file);
    });
    document.getElementById('kg-title-save-btn')?.addEventListener('click', () => {
      saveKgTitleFromModal();
    });
    document.getElementById('kg-title-clear-btn')?.addEventListener('click', () => {
      saveKgTitleFromModal({ clear: true });
    });
    document.getElementById('kg-title-withcost')?.addEventListener('change', syncKgTitleCostFields);
  }

  let mindmapNodeContext = null;
  let mindmapTitleContext = null;

  function refreshMindmapNodeImagePreview() {
    const wrap = document.getElementById('mindmap-node-preview');
    const image = document.getElementById('mindmap-node-image')?.value?.trim() || '';
    if (!wrap) return;
    if (!image) {
      wrap.classList.add('d-none');
      wrap.innerHTML = '';
      return;
    }
    wrap.classList.remove('d-none');
    wrap.innerHTML = `<img src="${escapeHtml(image)}" alt="" class="calendar-note-preview-img">`;
  }

  function openMindmapTitleModal(titleEl) {
    if (!isPreviewInteractionEnabled()) return;
    const block = titleEl.closest('.mindmap-block');
    if (!block) return;
    const mindmapIndex = parseInt(block.dataset.mindmapIndex, 10);
    if (!Number.isFinite(mindmapIndex)) return;
    mindmapTitleContext = { mindmapIndex };
    const titleInput = document.getElementById('mindmap-title-input');
    const dirInput = document.getElementById('mindmap-title-dir');
    if (titleInput) titleInput.value = block.dataset.mindmapTitle || '';
    if (dirInput) dirInput.value = block.dataset.mindmapDir || 'right';
    const modalEl = document.getElementById('mindmap-title-modal');
    if (modalEl) openDashboardModal(modalEl);
  }

  function saveMindmapTitleFromModal({ clear = false } = {}) {
    if (!easyMDE || !mindmapTitleContext) return;
    const title = clear ? '' : (document.getElementById('mindmap-title-input')?.value || '');
    const dir = document.getElementById('mindmap-title-dir')?.value || 'right';
    const oldMarkdown = easyMDE.value();
    const updated = updateMindmapMetaInMarkdown(
      oldMarkdown,
      mindmapTitleContext.mindmapIndex,
      { title, dir },
    );
    if (updated !== oldMarkdown) {
      easyMDE.value(updated);
      scheduleSave();
      schedulePreviewRefresh();
    }
    bootstrap.Modal.getInstance(document.getElementById('mindmap-title-modal'))?.hide();
    mindmapTitleContext = null;
  }

  function openMindmapNodeModal(cardEl) {
    if (!isPreviewInteractionEnabled()) return;
    const block = cardEl.closest('.mindmap-block');
    const nodeEl = cardEl.closest('.mindmap-node');
    const nodeId = nodeEl?.dataset?.mindmapNodeId;
    if (!block || !nodeId) return;
    const mindmapIndex = parseInt(block.dataset.mindmapIndex, 10);
    if (!Number.isFinite(mindmapIndex)) return;

    const label = cardEl.querySelector('.mindmap-node-label')?.textContent || '';
    const text = cardEl.dataset.mindmapMarkdown
      || cardEl.querySelector('.mindmap-node-text')?.textContent
      || '';
    const image = cardEl.querySelector('.mindmap-node-image')?.getAttribute('src') || '';

    mindmapNodeContext = { mindmapIndex, nodeId };
    const title = document.getElementById('mindmap-node-modal-title');
    if (title) title.textContent = `Mindmap node · ${label || nodeId}`;
    const labelInput = document.getElementById('mindmap-node-label');
    const textInput = document.getElementById('mindmap-node-text');
    const imageInput = document.getElementById('mindmap-node-image');
    if (labelInput) labelInput.value = label;
    if (textInput) textInput.value = text;
    if (imageInput) imageInput.value = image;
    refreshMindmapNodeImagePreview();
    const modalEl = document.getElementById('mindmap-node-modal');
    if (modalEl) openDashboardModal(modalEl);
  }

  function saveMindmapNodeFromModal({ clear = false } = {}) {
    if (!easyMDE || !mindmapNodeContext) return;
    const label = document.getElementById('mindmap-node-label')?.value || '';
    const text = clear ? '' : (document.getElementById('mindmap-node-text')?.value || '');
    const image = clear ? '' : (document.getElementById('mindmap-node-image')?.value || '');
    const oldMarkdown = easyMDE.value();
    const updated = updateMindmapNodeInMarkdown(
      oldMarkdown,
      mindmapNodeContext.mindmapIndex,
      mindmapNodeContext.nodeId,
      { label, text, image },
    );
    if (updated !== oldMarkdown) {
      easyMDE.value(updated);
      scheduleSave();
      schedulePreviewRefresh();
    }
    bootstrap.Modal.getInstance(document.getElementById('mindmap-node-modal'))?.hide();
    mindmapNodeContext = null;
  }

  function addMindmapChildFromModal() {
    if (!easyMDE || !mindmapNodeContext) return;
    const oldMarkdown = easyMDE.value();
    const updated = addMindmapChildInMarkdown(
      oldMarkdown,
      mindmapNodeContext.mindmapIndex,
      mindmapNodeContext.nodeId,
      'New idea',
    );
    if (updated !== oldMarkdown) {
      easyMDE.value(updated);
      scheduleSave();
      schedulePreviewRefresh();
    }
    bootstrap.Modal.getInstance(document.getElementById('mindmap-node-modal'))?.hide();
    mindmapNodeContext = null;
  }

  function deleteMindmapNodeFromModal() {
    if (!easyMDE || !mindmapNodeContext) return;
    if (!confirm('Delete this node and its children?')) return;
    const oldMarkdown = easyMDE.value();
    const updated = deleteMindmapNodeInMarkdown(
      oldMarkdown,
      mindmapNodeContext.mindmapIndex,
      mindmapNodeContext.nodeId,
    );
    if (updated !== oldMarkdown) {
      easyMDE.value(updated);
      scheduleSave();
      schedulePreviewRefresh();
    }
    bootstrap.Modal.getInstance(document.getElementById('mindmap-node-modal'))?.hide();
    mindmapNodeContext = null;
  }

  async function uploadMindmapNodeImage(file) {
    if (!file) return;
    syncWorkspaceIdFromDom();
    const formData = new FormData();
    formData.append('file', file);
    formData.append('workspace', workspaceId);
    try {
      const data = await api('api/uploads/', 'POST', formData, true);
      const mediaPath = mediaMarkdownPath(data.url || data.path || data.file?.url || data.file?.mediaName);
      const imageInput = document.getElementById('mindmap-node-image');
      if (imageInput && mediaPath) {
        imageInput.value = mediaPath;
        refreshMindmapNodeImagePreview();
      }
    } catch (err) {
      console.warn('mindmap image upload failed:', err);
      showToast(err.message || 'Image upload failed.', 'danger');
    }
  }

  function initMindmapEditors() {
    const preview = document.getElementById('preview-content');
    if (!preview || preview.dataset.mindmapEditBound === '1') return;
    preview.dataset.mindmapEditBound = '1';

    preview.addEventListener('click', e => {
      if (!isPreviewInteractionEnabled()) return;
      if (e.target.closest('a, button, input, textarea, img.md-image-link')) return;
      const title = e.target.closest?.('.mindmap-block-title--editable');
      if (title && preview.contains(title)) {
        e.preventDefault();
        e.stopPropagation();
        openMindmapTitleModal(title);
        return;
      }
      const card = e.target.closest?.('.mindmap-node-card--editable');
      if (!card || !preview.contains(card)) return;
      e.preventDefault();
      e.stopPropagation();
      openMindmapNodeModal(card);
    });

    document.getElementById('mindmap-node-save-btn')?.addEventListener('click', () => {
      saveMindmapNodeFromModal();
    });
    document.getElementById('mindmap-node-clear-btn')?.addEventListener('click', () => {
      saveMindmapNodeFromModal({ clear: true });
    });
    document.getElementById('mindmap-node-add-child-btn')?.addEventListener('click', () => {
      addMindmapChildFromModal();
    });
    document.getElementById('mindmap-node-delete-btn')?.addEventListener('click', () => {
      deleteMindmapNodeFromModal();
    });
    document.getElementById('mindmap-node-image')?.addEventListener('input', refreshMindmapNodeImagePreview);
    document.getElementById('mindmap-node-upload-btn')?.addEventListener('click', () => {
      document.getElementById('mindmap-node-file')?.click();
    });
    document.getElementById('mindmap-node-file')?.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (file) await uploadMindmapNodeImage(file);
    });
    document.getElementById('mindmap-title-save-btn')?.addEventListener('click', () => {
      saveMindmapTitleFromModal();
    });
    document.getElementById('mindmap-title-clear-btn')?.addEventListener('click', () => {
      saveMindmapTitleFromModal({ clear: true });
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
      tabSize: EDITOR_TAB_SIZE,
      indentUnit: EDITOR_TAB_SIZE,
      forceSync: true,
      sideBySideFullscreen: false,
      minHeight: '200px',
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
          name: 'insert-calendar',
          action: (editor) => {
            const today = new Date();
            const from = formatCalendarDate(new Date(today.getFullYear(), today.getMonth(), 1));
            const to = formatCalendarDate(new Date(today.getFullYear(), today.getMonth() + 1, 0));
            insertFenceBlock(editor, `calendar{from=${from};to=${to};mode=day}`, '');
          },
          className: 'fa fa-calendar',
          title: 'Insert calendar',
        },
        {
          name: 'insert-gantt',
          action: (editor) => {
            const today = new Date();
            const from = formatCalendarDate(new Date(today.getFullYear(), today.getMonth(), 1));
            const mid = formatCalendarDate(new Date(today.getFullYear(), today.getMonth(), 15));
            const to = formatCalendarDate(new Date(today.getFullYear(), today.getMonth() + 1, 0));
            const body = [
              '# Project plan',
              `Phase A | ${from} | ${mid} | **Start**`,
              `Phase B | ${mid} | ${to} | Delivery`,
            ].join('\n');
            insertFenceBlock(editor, `gantt{from=${from};to=${to};col=info}`, body);
          },
          className: 'fa fa-tasks',
          title: 'Insert gantt',
        },
        {
          name: 'insert-kanban',
          action: (editor) => {
            const body = [
              '# Board',
              'Todo | Design wireframes | **First draft**',
              'Todo | Write copy',
              'Doing | Build API',
              'Done | Kickoff | ![](/media/uploads/photo.png)',
            ].join('\n');
            insertFenceBlock(editor, 'kanban{cols=Todo,Doing,Done;col=info}', body);
          },
          className: 'fa fa-th-large',
          title: 'Insert kanban',
        },
        {
          name: 'insert-kanbangantt',
          action: (editor) => {
            const body = [
              '# Sprint board',
              'Todo | Design wireframes | status=idle;rate=60',
              'Doing | Build API | status=idle;rate=75',
              'Suspended | On hold task | status=suspended;rate=75;elapsed=1800',
              'Done | Kickoff | status=stopped;rate=50;elapsed=7200',
            ].join('\n');
            insertFenceBlock(editor, 'kanbangantt{cols=Todo,Doing,Suspended,Done;withcost=1;rate=50;currency=EUR;col=info}', body);
          },
          className: 'fa fa-clock-o',
          title: 'Insert kanban gantt (time + cost)',
        },
        {
          name: 'insert-mindmap',
          action: (editor) => {
            const body = [
              '# Ideas',
              'Central topic',
              '  Branch A | **Key point**',
              '    Detail A1',
              '    Detail A2',
              '  Branch B',
              '    Detail B1 | note',
            ].join('\n');
            insertFenceBlock(editor, 'mindmap{dir=right;col=info}', body);
          },
          className: 'fa fa-sitemap',
          title: 'Insert mindmap',
        },
        {
          name:         'snippets',
          action: () => openSnippetsModal(),
          className: 'fa fa-puzzle-piece',
          title: 'Snippets',
        },
        buildHorizontalRuleToolbarDropdown(),'|',
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
            else if (!isMobileLayout()) switchMode('markdown');
          },
          className: 'fa fa-columns no-disable',
          title: 'Side by side',
        },
        'fullscreen','|',
        {
            name: "add-tag",
            action: (editor) => {
                const cm = editor.codemirror;
                const selectedText = (cm.getSelection() || "tag").trim();
                cm.replaceSelection(`{tag:${selectedText}} `);
            },
            className: "fa fa-tag",
            title: "Als Tag markieren ({tag: …})",
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
                  const element = createPdfExportRoot(htmlContent);

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
          let html = this.parent.markdown(processed.markdown);
          html = restoreStyledSpanTokens(html, processed.styledSpanHtml);
          html = html.replace(/<p>\s*(<div class="md-styled-block"[\s\S]*?<\/div>)\s*<\/p>/gi, '$1');
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
      if (isMobileLayout()) syncMobileContentMenu();
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
    injectEditorToolbarHeightControls();
    applyEditorTypographyFromSettings();
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

  function clearTreeMoveConfirmSchedule() {
    if (treeMoveConfirmTimer) {
      clearTimeout(treeMoveConfirmTimer);
      treeMoveConfirmTimer = null;
    }
    if (treeMoveMouseListener) {
      window.removeEventListener('mousemove', treeMoveMouseListener);
      treeMoveMouseListener = null;
    }
    if (treeMovePointerListener) {
      window.removeEventListener('pointermove', treeMovePointerListener);
      treeMovePointerListener = null;
    }
  }

  function treeMoveConfirmMessage(moveData) {
    const itemLabel = moveData.node?.text || 'item';
    if (String(moveData.old_parent) !== String(moveData.parent)) {
      return `Keep move of "${itemLabel}" under "${treeMoveTargetLabel(moveData.parent)}"?`;
    }
    return `Keep the new position of "${itemLabel}" in the tree?`;
  }

  function askTreeMoveConfirm(message) {
    const modalEl = document.getElementById('tree-move-confirm-modal');
    const msgEl = document.getElementById('tree-move-confirm-message');
    if (!modalEl || !window.bootstrap?.Modal) {
      return Promise.resolve(window.confirm(message));
    }

    return new Promise((resolve) => {
      if (msgEl) msgEl.textContent = message;
      if (!treeMoveConfirmModal) {
        treeMoveConfirmModal = bootstrap.Modal.getOrCreateInstance(modalEl);
      }

      const okBtn = document.getElementById('tree-move-confirm-ok');
      const cancelBtn = document.getElementById('tree-move-confirm-cancel');
      let settled = false;

      const finish = (keepMove) => {
        if (settled) return;
        settled = true;
        okBtn?.removeEventListener('click', onOk);
        cancelBtn?.removeEventListener('click', onCancel);
        modalEl.removeEventListener('hidden.bs.modal', onHidden);
        treeMoveConfirmModal.hide();
        resolve(keepMove);
      };

      const onOk = () => finish(true);
      const onCancel = () => finish(false);
      const onHidden = () => finish(false);

      okBtn?.addEventListener('click', onOk);
      cancelBtn?.addEventListener('click', onCancel);
      modalEl.addEventListener('hidden.bs.modal', onHidden);
      treeMoveConfirmModal.show();
    });
  }

  async function runTreeMoveConfirm() {
    const pending = pendingTreeMoveUndo;
    pendingTreeMoveUndo = null;
    if (!pending) return;

    const keepMove = await askTreeMoveConfirm(treeMoveConfirmMessage(pending));
    if (keepMove) {
      setStatus('Tree saved');
      return;
    }

    revertPendingTreeMoveInUi(pending);
    await revertPendingTreeMoveInDb(pending);
    setStatus('Move undone');
  }

  function scheduleTreeMoveConfirm(moveData) {
    clearTreeMoveConfirmSchedule();
    pendingTreeMoveUndo = moveData;
    let lastActivity = Date.now();

    const markActivity = () => {
      lastActivity = Date.now();
    };

    const waitForIdle = () => {
      if (Date.now() - lastActivity >= 1000) {
        clearTreeMoveConfirmSchedule();
        void runTreeMoveConfirm();
        return;
      }
      treeMoveConfirmTimer = setTimeout(waitForIdle, 100);
    };

    treeMoveMouseListener = markActivity;
    treeMovePointerListener = markActivity;
    window.addEventListener('mousemove', markActivity, { passive: true });
    window.addEventListener('pointermove', markActivity, { passive: true });
    treeMoveConfirmTimer = setTimeout(waitForIdle, 1000);
  }

  function revertPendingTreeMoveInDb(moveData) {
    return persistTreeMove({
      node: moveData.node,
      parent: moveData.old_parent,
      position: moveData.old_position,
    });
  }

  function revertPendingTreeMoveInUi(moveData) {
    const tree = $('#tree').jstree(true);
    if (!tree || !moveData) return;
    suppressTreeMovePersist = true;
    try {
      tree.move_node(moveData.node, moveData.old_parent, moveData.old_position, false, false, false);
    } finally {
      suppressTreeMovePersist = false;
    }
  }

  function treeMovePayload(moveData) {
    const parent = moveData.parent;
    return {
      id: moveData.node?.id ?? moveData.node,
      parent: parent === '#' || parent == null ? '#' : String(parent),
      position: Number.isFinite(Number(moveData.position)) ? Number(moveData.position) : 0,
    };
  }

  async function persistTreeMove(moveData) {
    try {
      setStatus('Saving tree…');
      await api('api/pages/reorder/', 'POST', treeMovePayload(moveData));
      await updateUserSettings();
      setStatus('Tree saved');
      return true;
    } catch (err) {
      console.error('Tree reorder failed:', err);
      showToast(err.message || 'Could not save tree order.', 'danger');
      await loadTree(currentPageId, { skipSelectLoad: true });
      return false;
    }
  }


  function treeMoveTargetLabel(parentId) {
    if (parentId === '#' || parentId == null) return 'workspace root';
    const tree = $('#tree').jstree(true);
    const parentNode = tree?.get_node(parentId);
    return parentNode?.text || 'folder';
  }

  function treeCheckCallback(operation, node, parent, position, more) {
    if (!userCanEdit && ['move_node', 'rename_node', 'create_node', 'delete_node'].includes(operation)) {
      return false;
    }
    return true;
  }

  function captureTreeOpenState(wsId = workspaceId) {
    const tree = $('#tree').jstree(true);
    if (!tree || !wsId) return;
    const opened = [];
    $('#tree').find('.jstree-open').each(function () {
      const id = this.id;
      if (id && id !== '#') opened.push(id);
    });
    workspaceTreeOpen[String(wsId)] = opened;
  }

  function openTreeAncestors(nodeId) {
    const tree = $('#tree').jstree(true);
    if (!tree || !nodeId) return;
    let node = tree.get_node(String(nodeId));
    while (node && node.parent && node.parent !== '#') {
      tree.open_node(node.parent, false);
      node = tree.get_node(node.parent);
    }
  }

  function restoreTreeOpenState(wsId = workspaceId) {
    const tree = $('#tree').jstree(true);
    if (!tree || !wsId) return;
    const opened = workspaceTreeOpen[String(wsId)] || [];
    opened.forEach(id => {
      const node = tree.get_node(id);
      if (node) tree.open_node(id, false);
    });
    const selectedId = selectedTreeNodeId || (currentPageId ? String(currentPageId) : null);
    if (selectedId) openTreeAncestors(selectedId);
  }

  function scheduleTreeOpenPersist() {
    clearTimeout(treeOpenSaveTimer);
    treeOpenSaveTimer = setTimeout(() => {
      captureTreeOpenState();
      if (!window.APP_BOOT) window.APP_BOOT = {};
      if (!window.APP_BOOT.extraConfigs) window.APP_BOOT.extraConfigs = {};
      window.APP_BOOT.extraConfigs.tree_open = { ...workspaceTreeOpen };
      updateUserSettings({ extra_configs: { tree_open: workspaceTreeOpen } });
    }, 400);
  }

  function bindTreeEvents() {
    const $tree = $('#tree');

    $tree.off('select_node.jstree').on('select_node.jstree', function (e, data) {
      const node = data.node;
      if (!node) return;
      exitKeepViewIfActive();
      const tree = $('#tree').jstree(true);
      selectedTreeNodeId = node.id;
      if (isTreeFolder(node)) {
        tree?.open_node(node.id);
        scheduleTreeOpenPersist();
        return;
      }
      const pageId = parsePageId(node.id);
      if (!pageId) return;
      openTreeAncestors(node.id);
      scheduleTreeOpenPersist();
      loadPage(pageId);
      collapseLeftPanel();
    });

    $tree.off('open_node.jstree close_node.jstree')
      .on('open_node.jstree close_node.jstree', scheduleTreeOpenPersist);

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
      if (!userCanEdit || suppressTreeMovePersist) return;

      const saved = await persistTreeMove(data);
      if (!saved) return;

      scheduleTreeMoveConfirm(data);
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

  function sortSelectByLabel(select, { ownFirst = true } = {}) {
    if (!select) return;
    const selected = select.value;
    const options = Array.from(select.options);
    options.sort((a, b) => {
      if (ownFirst && currentUserId) {
        const aOwn = a.dataset.ownerId === String(currentUserId);
        const bOwn = b.dataset.ownerId === String(currentUserId);
        if (aOwn !== bOwn) return aOwn ? -1 : 1;
      }
      return a.textContent.localeCompare(b.textContent, undefined, { sensitivity: 'base' });
    });
    select.replaceChildren(...options);
    if (selected && Array.from(select.options).some((o) => o.value === selected)) {
      select.value = selected;
    }
  }

  function syncIncomesWorkspaceSelect(selectedId) {
    const sel = document.getElementById('incomes-distribute-workspace');
    const wsSelect = document.getElementById('workspace-select');
    if (!sel || !wsSelect) return;
    const selected = selectedId ?? sel.value;
    sel.innerHTML = '';
    [...wsSelect.options].forEach(opt => {
      sel.appendChild(opt.cloneNode(true));
    });
    sortSelectByLabel(sel);
    if (selected && [...sel.options].some(o => o.value === String(selected))) {
      sel.value = String(selected);
    }
  }

  function sortWorkspaceSelect() {
    sortSelectByLabel(document.getElementById('workspace-select'));
    syncIncomesWorkspaceSelect();
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
          restoreTreeOpenState();
          resolve();
          return;
        }
        if (explicitSelect) {
          restoreTreeOpenState();
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
        restoreTreeOpenState();
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

    try {
      currentPage = await api(`api/pages/${currentPageId}/update/`, 'POST', payload);

      if (slugEl) slugEl.textContent = currentPage.slug || '';
      if (titlePreview) titlePreview.textContent = currentPage.title || 'Untitled';

      const tree = $('#tree').jstree(true);
      if (tree && currentPageId) tree.rename_node(String(currentPageId), currentPage.title);

      setStatus('Saved');
    } catch (err) {
      console.warn('savePage failed:', err);
      setStatus(err.network ? 'Server offline — not saved' : 'Save failed');
    }
  }

  function scheduleSave() {
    if (!currentPageId || !isPreviewInteractionEnabled()) return;
    clearTimeout(autosaveTimer);
    setStatus('Typing...');
    autosaveTimer = setTimeout(savePage, 700);
  }

  function schedulePreviewRefresh() {
    if (!isPreviewInteractionEnabled()) return;
    const active = document.activeElement;
    if (active?.classList?.contains('sheet-cell-editable')) return;
    capturePreviewScrollPosition();
    clearTimeout(previewRefreshTimer);
    if (isMobileLayout() && !isEditing) {
      previewRefreshTimer = setTimeout(() => {
        renderPreview();
        buildFloatingToc();
        syncMobileContentMenu();
      }, 300);
      return;
    }
    if (isMobileLayout()) {
      previewRefreshTimer = setTimeout(() => {
        buildFloatingToc();
        syncMobileContentMenu();
      }, 300);
      return;
    }
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

    const tree = $('#tree').jstree(true);
    const node = tree?.get_node(String(pageId));
    const itemLabel = node?.text || `item ${pageId}`;
    const targetLabel = wsLabel(targets[idx]);
    if (!confirm(`Move "${itemLabel}" to workspace "${targetLabel}"?`)) return;

    const targetWorkspaceId = parseInt(targets[idx].value, 10);
    try {
      await api(`api/pages/${pageId}/move/`, 'POST', {
        target_workspace_id: targetWorkspaceId,
      });
      showToast(`Moved to "${targetLabel}".`, 'success');
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

  const KEEP_COLORS = [
    { id: 'default', swatch: '#ffffff' },
    { id: 'coral', swatch: '#faafa8' },
    { id: 'peach', swatch: '#f39f76' },
    { id: 'sand', swatch: '#fff8b8' },
    { id: 'mint', swatch: '#e2f6d3' },
    { id: 'sage', swatch: '#b4eee3' },
    { id: 'fog', swatch: '#d4e4ed' },
    { id: 'storm', swatch: '#aeccdc' },
    { id: 'dark', swatch: '#494646' },
  ];

  let mainView = window.APP_BOOT?.extraConfigs?.main_view === 'keep' ? 'keep' : 'pages';
  let quickNotesCache = [];
  let keepSearchTimer = null;
  let keepShowArchived = Boolean(window.APP_BOOT?.extraConfigs?.keep_show_archived);
  let keepComposerColor = 'default';
  let keepComposerChecklist = false;
  const quickNoteSaveTimers = new Map();
  const quickNotePendingPatch = new Map();
  let expandedKeepCardId = null;
  let keepDragState = null;

  function keepCardClass(color) {
    const id = KEEP_COLORS.some(c => c.id === color) ? color : 'default';
    return `keep-card--${id}`;
  }

  function applyKeepCardSurface(card, color) {
    if (!card) return;
    card.classList.remove(...KEEP_COLORS.map(c => keepCardClass(c.id)));
    card.classList.add(keepCardClass(color));
  }

  function isKeepComposerEditing() {
    return !document.getElementById('keep-composer-expanded')?.classList.contains('d-none');
  }

  function renderKeepColorDots(container, selected, onPick) {
    if (!container) return;
    container.innerHTML = KEEP_COLORS.map(c => (
      `<button type="button" class="keep-color-dot${c.id === selected ? ' selected' : ''}" data-color="${c.id}" style="background:${c.swatch}" title="${c.id}"></button>`
    )).join('');
    container.querySelectorAll('.keep-color-dot').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        onPick(btn.dataset.color);
      });
    });
  }

  function setMainView(mode) {
    mainView = mode === 'keep' ? 'keep' : 'pages';
    const mainPane = document.querySelector('.main-pane');
    const keepWrap = document.getElementById('quick-notes-wrap');
    const editorWrap = document.querySelector('.editor-wrap');
    const keepBtn = document.getElementById('view-keep-toggle');
    const editToggle = document.getElementById('edit-toggle');
    const titlePreview = document.getElementById('page-title-preview');

    mainPane?.classList.toggle('main-pane--keep', mainView === 'keep');
    keepWrap?.classList.toggle('d-none', mainView !== 'keep');
    editorWrap?.classList.toggle('d-none', mainView === 'keep');
    keepBtn?.classList.toggle('btn-primary', mainView === 'keep');
    keepBtn?.classList.toggle('btn-outline-light', mainView !== 'keep');
    editToggle?.classList.toggle('d-none', mainView === 'keep');

    if (mainView === 'keep') {
      if (titlePreview) titlePreview.textContent = 'Keep';
      loadQuickNotes();
    } else if (titlePreview && currentPage) {
      titlePreview.textContent = currentPage.title || '';
    }

    updateUserSettings({ extra_configs: { main_view: mainView } });
  }

  function exitKeepViewIfActive() {
    if (mainView !== 'keep') return;
    expandedKeepCardId = null;
    collapseKeepComposer();
    setMainView('pages');
  }

  async function loadQuickNotes() {
    syncWorkspaceIdFromDom();
    if (!workspaceId || mainView !== 'keep') return;
    const q = document.getElementById('keep-search')?.value?.trim() || '';
    const archived = keepShowArchived ? '1' : '0';
    try {
      const data = await api(
        `api/workspaces/${workspaceId}/quick-notes/?archived=${archived}&q=${encodeURIComponent(q)}`,
      );
      quickNotesCache = data.notes || [];
      sortQuickNotesCache();
      renderKeepGrid();
    } catch (err) {
      console.warn('loadQuickNotes failed:', err);
    }
  }

  function scheduleKeepSearch() {
    clearTimeout(keepSearchTimer);
    keepSearchTimer = setTimeout(loadQuickNotes, 250);
  }

  function renderKeepChecklistItems(items, { editable = false, noteId = null } = {}) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length && !editable) return '';
    const rows = list.map(item => {
      const checked = Boolean(item.checked);
      const text = escapeHtml(item.text || '');
      if (!editable) {
        return `<div class="keep-checklist-item${checked ? ' is-checked' : ''}"><input type="checkbox" disabled ${checked ? 'checked' : ''}><span>${text}</span></div>`;
      }
      return `<div class="keep-checklist-item${checked ? ' is-checked' : ''}" data-item-id="${escapeHtml(item.id)}"><input type="checkbox" class="keep-cl-check" ${checked ? 'checked' : ''}><input type="text" class="keep-cl-text" value="${text}" placeholder="List item"></div>`;
    }).join('');
    if (editable) {
      return `${rows}<button type="button" class="btn btn-link btn-sm keep-cl-add" data-note-id="${noteId || ''}">+ Add item</button>`;
    }
    return rows;
  }

  function noteChecklistFromDom(card) {
    return [...card.querySelectorAll('.keep-checklist-item')].map(row => ({
      id: row.dataset.itemId || crypto.randomUUID?.().slice(0, 12) || String(Date.now()),
      text: row.querySelector('.keep-cl-text')?.value || '',
      checked: row.querySelector('.keep-cl-check')?.checked || false,
    })).filter(item => item.text.trim() || item.checked);
  }

  function renderKeepMarkdown(body) {
    const raw = String(body || '');
    if (!raw.trim()) return '';
    try {
      initMarked();
      if (typeof marked === 'undefined') return escapeHtml(raw);
      return renderMarkdownToHtml(raw, { richBlocks: false });
    } catch (_) {
      return escapeHtml(raw);
    }
  }

  function keepSearchActive() {
    return Boolean(document.getElementById('keep-search')?.value?.trim());
  }

  function sortQuickNotesCache() {
    quickNotesCache.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const ao = Number.isFinite(a.sort_order) ? a.sort_order : 0;
      const bo = Number.isFinite(b.sort_order) ? b.sort_order : 0;
      if (ao !== bo) return ao - bo;
      return String(b.updated_at).localeCompare(String(a.updated_at)) || b.id - a.id;
    });
  }

  function clearKeepDropTargets(grid) {
    grid?.querySelectorAll('.keep-card--drop-before, .keep-card--drop-after').forEach(el => {
      el.classList.remove('keep-card--drop-before', 'keep-card--drop-after');
    });
  }

  function renderKeepGrid() {
    const grid = document.getElementById('keep-grid');
    const keepWrap = document.getElementById('quick-notes-wrap');
    if (!grid) return;
    const savedScrollTop = keepWrap?.scrollTop ?? 0;
    const anchorNoteId = expandedKeepCardId;
    clearKeepDropTargets(grid);
    if (!quickNotesCache.length) {
      grid.innerHTML = `<div class="keep-empty">${keepShowArchived ? 'No archived notes.' : 'No notes yet — take one above.'}</div>`;
      return;
    }
    const canDrag = userCanEdit && !keepSearchActive();
    grid.innerHTML = quickNotesCache.map(note => {
      const expanded = expandedKeepCardId === note.id;
      const hasChecklist = Array.isArray(note.checklist) && note.checklist.length > 0;
      const colorClass = keepCardClass(note.color);
      const checklistHtml = hasChecklist
        ? `<div class="keep-checklist">${renderKeepChecklistItems(note.checklist, { editable: expanded && userCanEdit, noteId: note.id })}</div>`
        : '';
      const dragAttr = canDrag && !expanded ? ' draggable="true"' : '';
      if (expanded && userCanEdit) {
        return `
          <article class="keep-card ${colorClass} keep-card--expanded" data-note-id="${note.id}" data-pinned="${note.pinned ? '1' : '0'}">
            <div class="keep-card-inner">
              <input type="text" class="keep-input keep-input-title keep-note-title" value="${escapeHtml(note.title || '')}" placeholder="Title">
              <textarea class="keep-input keep-input-body keep-note-body" placeholder="Note (markdown)…" rows="4">${escapeHtml(note.body || '')}</textarea>
              ${checklistHtml}
            </div>
            <div class="keep-card-footer">
              <button type="button" class="keep-icon-btn keep-note-pin${note.pinned ? ' active' : ''}" title="Pin">📌</button>
              <div class="keep-color-picker keep-note-colors"></div>
              <button type="button" class="keep-icon-btn keep-note-checklist" title="Checklist">☑</button>
              <button type="button" class="keep-icon-btn keep-note-archive" title="${note.archived ? 'Unarchive' : 'Archive'}">📥</button>
              <button type="button" class="keep-icon-btn keep-note-delete" title="Delete">🗑️</button>
            </div>
          </article>`;
      }
      const titleHtml = note.title ? `<div class="keep-card-title">${escapeHtml(note.title)}</div>` : '';
      const bodyHtml = note.body ? `<div class="keep-card-body keep-md">${renderKeepMarkdown(note.body)}</div>` : '';
      return `
        <article class="keep-card ${colorClass}${canDrag && !expanded ? ' keep-card--draggable' : ''}" data-note-id="${note.id}" data-pinned="${note.pinned ? '1' : '0'}"${dragAttr}>
          <div class="keep-card-inner keep-card-view">
            ${titleHtml}
            ${bodyHtml}
            ${checklistHtml}
          </div>
          <div class="keep-card-footer">
            <button type="button" class="keep-icon-btn keep-note-pin${note.pinned ? ' active' : ''}" title="Pin">📌</button>
            <button type="button" class="keep-icon-btn keep-note-checklist" title="Checklist">☑</button>
            <button type="button" class="keep-icon-btn keep-note-archive" title="${note.archived ? 'Unarchive' : 'Archive'}">📥</button>
            <button type="button" class="keep-icon-btn keep-note-delete" title="Delete">🗑️</button>
          </div>
        </article>`;
    }).join('');

    grid.querySelectorAll('.keep-card').forEach(card => {
      const noteId = parseInt(card.dataset.noteId, 10);
      const note = quickNotesCache.find(n => n.id === noteId);
      if (!note) return;
      if (!card.classList.contains('keep-card--expanded')) return;
      renderKeepColorDots(card.querySelector('.keep-note-colors'), note.color, color => {
        patchQuickNote(noteId, { color });
      });
    });
    applyPreviewImageStyles(grid);
    requestAnimationFrame(() => {
      if (keepWrap) keepWrap.scrollTop = savedScrollTop;
      if (anchorNoteId != null) {
        const card = grid.querySelector(`.keep-card[data-note-id="${anchorNoteId}"]`);
        card?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    });
  }

  function mergeQuickNoteCache(updated) {
    const idx = quickNotesCache.findIndex(n => n.id === updated.id);
    if (idx >= 0) quickNotesCache[idx] = updated;
    else quickNotesCache.unshift(updated);
    sortQuickNotesCache();
    if (updated.archived !== keepShowArchived && mainView === 'keep') {
      quickNotesCache = quickNotesCache.filter(n => n.id !== updated.id);
    }
  }

  async function persistKeepOrder(orderedNotes) {
    syncWorkspaceIdFromDom();
    if (!workspaceId || !orderedNotes.length) return;
    try {
      const data = await api(`api/workspaces/${workspaceId}/quick-notes/reorder/`, 'POST', {
        notes: orderedNotes.map(n => ({ id: n.id, pinned: Boolean(n.pinned) })),
      });
      const byId = new Map((data.notes || []).map(n => [n.id, n]));
      quickNotesCache = quickNotesCache.map(n => byId.get(n.id) || n);
      sortQuickNotesCache();
    } catch (err) {
      console.warn('persistKeepOrder failed:', err);
      loadQuickNotes();
    }
  }

  function applyKeepReorder(draggedId, targetId, placeAfter) {
    const from = quickNotesCache.findIndex(n => n.id === draggedId);
    const to = quickNotesCache.findIndex(n => n.id === targetId);
    if (from < 0 || to < 0 || from === to) return false;
    const target = quickNotesCache[to];
    const [moved] = quickNotesCache.splice(from, 1);
    moved.pinned = Boolean(target.pinned);
    let insertAt = quickNotesCache.findIndex(n => n.id === targetId);
    if (insertAt < 0) return false;
    if (placeAfter) insertAt += 1;
    quickNotesCache.splice(insertAt, 0, moved);

    let pinnedOrder = 0;
    let unpinnedOrder = 0;
    quickNotesCache.forEach(note => {
      note.sort_order = note.pinned ? pinnedOrder++ : unpinnedOrder++;
    });
    return true;
  }

  async function flushQuickNoteSave(noteId) {
    const patch = quickNotePendingPatch.get(noteId);
    if (!patch) return;
    quickNotePendingPatch.delete(noteId);
    try {
      const updated = await api(`api/quick-notes/${noteId}/update/`, 'POST', patch);
      mergeQuickNoteCache(updated);
      // Keep expanded editor DOM intact so typing does not lose focus.
      if (expandedKeepCardId === noteId) {
        const card = document.querySelector(`.keep-card.keep-card--expanded[data-note-id="${noteId}"]`);
        if (card) {
          applyKeepCardSurface(card, updated.color);
          const pinBtn = card.querySelector('.keep-note-pin');
          pinBtn?.classList.toggle('active', updated.pinned);
        }
        return;
      }
      const card = document.querySelector(`.keep-card[data-note-id="${noteId}"]`);
      if (card) {
        applyKeepCardSurface(card, updated.color);
        const pinBtn = card.querySelector('.keep-note-pin');
        pinBtn?.classList.toggle('active', updated.pinned);
      }
    } catch (err) {
      console.warn('saveQuickNote failed:', err);
    }
  }

  function scheduleQuickNoteSave(noteId, patch) {
    const existing = quickNotePendingPatch.get(noteId) || {};
    quickNotePendingPatch.set(noteId, { ...existing, ...patch });
    clearTimeout(quickNoteSaveTimers.get(noteId));
    quickNoteSaveTimers.set(noteId, setTimeout(() => flushQuickNoteSave(noteId), 500));
  }

  async function patchQuickNote(noteId, patch) {
    scheduleQuickNoteSave(noteId, patch);
    const note = quickNotesCache.find(n => n.id === noteId);
    if (note) {
      Object.assign(note, patch);
      if (patch.pinned != null || patch.archived != null) {
        await flushQuickNoteSave(noteId);
        renderKeepGrid();
      } else if (patch.color) {
        const card = document.querySelector(`.keep-card[data-note-id="${noteId}"]`);
        if (card) applyKeepCardSurface(card, patch.color);
      }
    }
  }

  async function deleteQuickNote(noteId) {
    if (!confirm('Delete this note?')) return;
    try {
      await api(`api/quick-notes/${noteId}/delete/`, 'POST', {});
      quickNotesCache = quickNotesCache.filter(n => n.id !== noteId);
      if (expandedKeepCardId === noteId) expandedKeepCardId = null;
      renderKeepGrid();
    } catch (err) {
      console.warn('deleteQuickNote failed:', err);
    }
  }

  function collapseExpandedKeepNote() {
    if (expandedKeepCardId == null) return;
    const noteId = expandedKeepCardId;
    expandedKeepCardId = null;
    if (quickNotePendingPatch.has(noteId)) flushQuickNoteSave(noteId);
    renderKeepGrid();
  }

  function focusExpandedKeepNote() {
    const card = document.querySelector('.keep-card.keep-card--expanded');
    if (!card) return;
    const body = card.querySelector('.keep-note-body');
    const title = card.querySelector('.keep-note-title');
    const target = body || title;
    if (!target) return;
    requestAnimationFrame(() => {
      target.focus({ preventScroll: true });
      if (typeof target.selectionStart === 'number') {
        const len = target.value?.length ?? 0;
        try { target.setSelectionRange(len, len); } catch (_) { /* ignore */ }
      }
    });
  }

  function collapseKeepComposer() {
    document.getElementById('keep-composer-collapsed')?.classList.remove('d-none');
    document.getElementById('keep-composer-expanded')?.classList.add('d-none');
    document.getElementById('keep-composer')?.classList.remove('keep-composer--editing');
    resetKeepComposerFields();
  }

  function expandKeepComposer() {
    if (!userCanEdit) return;
    document.getElementById('keep-composer-collapsed')?.classList.add('d-none');
    document.getElementById('keep-composer-expanded')?.classList.remove('d-none');
    document.getElementById('keep-composer')?.classList.add('keep-composer--editing');
    setKeepComposerColor(keepComposerColor);
    document.getElementById('keep-composer-title')?.focus({ preventScroll: true });
  }

  function setKeepComposerColor(color) {
    keepComposerColor = KEEP_COLORS.some(c => c.id === color) ? color : 'default';
    const composer = document.getElementById('keep-composer');
    if (isKeepComposerEditing()) {
      applyKeepCardSurface(composer, keepComposerColor);
      renderKeepColorDots(
        document.getElementById('keep-composer-colors'),
        keepComposerColor,
        setKeepComposerColor,
      );
    } else {
      applyKeepCardSurface(composer, 'default');
    }
  }

  function resetKeepComposerFields() {
    keepComposerColor = 'default';
    keepComposerChecklist = false;
    const title = document.getElementById('keep-composer-title');
    const body = document.getElementById('keep-composer-body');
    const checklist = document.getElementById('keep-composer-checklist');
    if (title) title.value = '';
    if (body) body.value = '';
    if (checklist) {
      checklist.innerHTML = '';
      checklist.classList.add('d-none');
    }
    setKeepComposerColor('default');
  }

  function renderComposerChecklist() {
    const box = document.getElementById('keep-composer-checklist');
    if (!box) return;
    if (!keepComposerChecklist) {
      box.classList.add('d-none');
      box.innerHTML = '';
      return;
    }
    box.classList.remove('d-none');
    box.innerHTML = renderKeepChecklistItems(
      [{ id: 'new1', text: '', checked: false }],
      { editable: true },
    );
    bindComposerChecklistEvents(box);
  }

  function bindComposerChecklistEvents(container) {
    container.querySelector('.keep-cl-add')?.addEventListener('click', () => {
      const item = document.createElement('div');
      item.className = 'keep-checklist-item';
      item.dataset.itemId = `c${Date.now()}`;
      item.innerHTML = '<input type="checkbox" class="keep-cl-check"><input type="text" class="keep-cl-text" placeholder="List item">';
      container.insertBefore(item, container.querySelector('.keep-cl-add'));
    });
  }

  async function submitKeepComposer() {
    if (!userCanEdit) return;
    syncWorkspaceIdFromDom();
    if (!workspaceId) return;
    const title = document.getElementById('keep-composer-title')?.value?.trim() || '';
    const body = document.getElementById('keep-composer-body')?.value?.trim() || '';
    let checklist = [];
    if (keepComposerChecklist) {
      const composer = document.getElementById('keep-composer-checklist');
      if (composer) checklist = noteChecklistFromDom(composer);
    }
    if (!title && !body && !checklist.length) {
      collapseKeepComposer();
      return;
    }
    try {
      const created = await api(`api/workspaces/${workspaceId}/quick-notes/create/`, 'POST', {
        title,
        body,
        color: keepComposerColor,
        checklist,
      });
      mergeQuickNoteCache(created);
      renderKeepGrid();
      collapseKeepComposer();
    } catch (err) {
      console.warn('submitKeepComposer failed:', err);
    }
  }

  function initKeepNotes() {
    setKeepComposerColor('default');
    document.getElementById('keep-composer')?.classList.toggle('d-none', !userCanEdit);

    document.getElementById('view-keep-toggle')?.addEventListener('click', () => {
      setMainView(mainView === 'keep' ? 'pages' : 'keep');
    });

    document.getElementById('keep-composer-collapsed')?.addEventListener('click', expandKeepComposer);
    document.getElementById('keep-composer-close')?.addEventListener('click', collapseKeepComposer);
    document.getElementById('keep-composer-save')?.addEventListener('click', submitKeepComposer);
    document.getElementById('keep-composer-checklist-btn')?.addEventListener('click', () => {
      keepComposerChecklist = !keepComposerChecklist;
      renderComposerChecklist();
    });

    document.getElementById('keep-search')?.addEventListener('input', scheduleKeepSearch);
    document.getElementById('keep-show-archived')?.addEventListener('change', e => {
      keepShowArchived = e.target.checked;
      updateUserSettings({ extra_configs: { keep_show_archived: keepShowArchived } });
      loadQuickNotes();
    });
    const archivedBox = document.getElementById('keep-show-archived');
    if (archivedBox) archivedBox.checked = keepShowArchived;

    document.getElementById('quick-notes-wrap')?.addEventListener('pointerdown', e => {
      if (expandedKeepCardId == null) return;
      if (e.target.closest('.keep-card')) return;
      if (e.target.closest('#keep-composer')) return;
      collapseExpandedKeepNote();
    });

    document.getElementById('keep-grid')?.addEventListener('click', async e => {
      if (keepDragState?.moved) return;
      const card = e.target.closest('.keep-card');
      if (!card) return;
      const noteId = parseInt(card.dataset.noteId, 10);
      if (!Number.isFinite(noteId)) return;

      if (e.target.closest('.keep-note-pin')) {
        e.stopPropagation();
        const note = quickNotesCache.find(n => n.id === noteId);
        patchQuickNote(noteId, { pinned: !note?.pinned });
        return;
      }
      if (e.target.closest('.keep-note-archive')) {
        e.stopPropagation();
        const note = quickNotesCache.find(n => n.id === noteId);
        patchQuickNote(noteId, { archived: !note?.archived });
        return;
      }
      if (e.target.closest('.keep-note-delete')) {
        e.stopPropagation();
        deleteQuickNote(noteId);
        return;
      }
      if (e.target.closest('.keep-note-checklist')) {
        e.stopPropagation();
        const note = quickNotesCache.find(n => n.id === noteId);
        if (!note) return;
        const items = Array.isArray(note.checklist) && note.checklist.length
          ? note.checklist
          : [{ id: `c${Date.now()}`, text: '', checked: false }];
        expandedKeepCardId = noteId;
        patchQuickNote(noteId, { checklist: items });
        renderKeepGrid();
        focusExpandedKeepNote();
        return;
      }
      if (e.target.closest('.keep-card-footer') || e.target.closest('.keep-color-dot')) return;
      if (e.target.closest('a, button, input, textarea, label, .md-image-link')) return;
      if (!userCanEdit) return;
      if (expandedKeepCardId !== noteId) {
        expandedKeepCardId = noteId;
        renderKeepGrid();
        focusExpandedKeepNote();
      }
    });

    document.getElementById('keep-grid')?.addEventListener('input', e => {
      const card = e.target.closest('.keep-card.keep-card--expanded');
      if (!card) return;
      const noteId = parseInt(card.dataset.noteId, 10);
      if (!Number.isFinite(noteId)) return;
      if (e.target.classList.contains('keep-note-title') || e.target.classList.contains('keep-note-body')) {
        scheduleQuickNoteSave(noteId, {
          title: card.querySelector('.keep-note-title')?.value || '',
          body: card.querySelector('.keep-note-body')?.value || '',
        });
      }
      if (e.target.classList.contains('keep-cl-text') || e.target.classList.contains('keep-cl-check')) {
        const row = e.target.closest('.keep-checklist-item');
        if (row) row.classList.toggle('is-checked', row.querySelector('.keep-cl-check')?.checked);
        scheduleQuickNoteSave(noteId, { checklist: noteChecklistFromDom(card) });
      }
    });

    document.getElementById('keep-grid')?.addEventListener('click', e => {
      if (!e.target.classList.contains('keep-cl-add')) return;
      const card = e.target.closest('.keep-card');
      const checklist = card?.querySelector('.keep-checklist');
      if (!checklist) return;
      const item = document.createElement('div');
      item.className = 'keep-checklist-item';
      item.dataset.itemId = `c${Date.now()}`;
      item.innerHTML = '<input type="checkbox" class="keep-cl-check"><input type="text" class="keep-cl-text" placeholder="List item">';
      checklist.insertBefore(item, e.target);
    });

    const keepGrid = document.getElementById('keep-grid');
    keepGrid?.addEventListener('dragstart', e => {
      if (!userCanEdit || keepSearchActive()) return;
      const card = e.target.closest?.('.keep-card');
      if (!card || !keepGrid.contains(card) || card.classList.contains('keep-card--expanded')) return;
      if (e.target.closest('button, input, textarea, a, .keep-color-dot')) {
        e.preventDefault();
        return;
      }
      const noteId = parseInt(card.dataset.noteId, 10);
      if (!Number.isFinite(noteId)) return;
      keepDragState = { noteId, moved: false };
      card.classList.add('keep-card--dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(noteId));
      try {
        e.dataTransfer.setData('application/x-keep-note', String(noteId));
      } catch (_) { /* ignore */ }
    });

    keepGrid?.addEventListener('dragend', e => {
      const card = e.target.closest?.('.keep-card');
      card?.classList.remove('keep-card--dragging');
      clearKeepDropTargets(keepGrid);
      setTimeout(() => { keepDragState = null; }, 50);
    });

    keepGrid?.addEventListener('dragover', e => {
      if (!keepDragState || !userCanEdit) return;
      const card = e.target.closest?.('.keep-card');
      if (!card || !keepGrid.contains(card)) return;
      const overId = parseInt(card.dataset.noteId, 10);
      if (overId === keepDragState.noteId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      clearKeepDropTargets(keepGrid);
      const rect = card.getBoundingClientRect();
      const placeAfter = e.clientX > rect.left + rect.width / 2;
      card.classList.add(placeAfter ? 'keep-card--drop-after' : 'keep-card--drop-before');
    });

    keepGrid?.addEventListener('dragleave', e => {
      const card = e.target.closest?.('.keep-card');
      if (!card || card.contains(e.relatedTarget)) return;
      card.classList.remove('keep-card--drop-before', 'keep-card--drop-after');
    });

    keepGrid?.addEventListener('drop', async e => {
      if (!keepDragState || !userCanEdit) return;
      const card = e.target.closest?.('.keep-card');
      if (!card || !keepGrid.contains(card)) return;
      e.preventDefault();
      e.stopPropagation();
      const targetId = parseInt(card.dataset.noteId, 10);
      const placeAfter = card.classList.contains('keep-card--drop-after');
      clearKeepDropTargets(keepGrid);
      if (!Number.isFinite(targetId) || targetId === keepDragState.noteId) return;
      const changed = applyKeepReorder(keepDragState.noteId, targetId, placeAfter);
      keepDragState.moved = true;
      if (!changed) return;
      renderKeepGrid();
      await persistKeepOrder(quickNotesCache);
    });

    if (mainView === 'keep') setMainView('keep');
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
        captureTreeOpenState(prevWs);
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

      // Reset tag UI + transport on workspace switch
      activeTagFilter = '';
      tagAutoOpenNextResult = false;
      const tagInput = document.getElementById('tag-search');
      if (tagInput) tagInput.value = '';
      const tagResults = document.getElementById('tag-search-results');
      if (tagResults) tagResults.innerHTML = '';
      const tagSuggestions = document.getElementById('tag-suggestions');
      if (tagSuggestions) {
        tagSuggestions.innerHTML = '';
        tagSuggestions.classList.add('d-none');
      }
      tagsReadyForWorkspace = false;
      disconnectTagWs();
      resetTagTransport();
      if (mainView === 'keep') loadQuickNotes();
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
    const membersModalList = document.getElementById('workspace-members-modal-list');
    const membersModalEl = document.getElementById('workspace-members-modal');
    const membersModalHint = document.getElementById('workspace-members-modal-hint');
    const countBadgeBtn = document.getElementById('user-count-btn');
    const searchInput = document.getElementById('user-search-input');
    const resultsDropdown = document.getElementById('search-results-dropdown');
    const spinnerContainer = document.getElementById('search-spinner-container');
    let searchTimer;
    const workspaceMemberIds = new Set();
    let cachedWorkspaceMembers = [];
    let cachedPendingInvites = [];

    function looksLikeEmail(value) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((value || '').trim());
    }

    function filterWorkspaceMemberRows(query, container) {
      const list = container || membersModalList;
      if (!list) return;
      const needle = query.trim().toLowerCase();
      list.querySelectorAll('li[data-user-id], li[data-pending-email]').forEach(row => {
        const name = row.querySelector('.workspace-member-name')?.textContent?.toLowerCase() || '';
        const email = row.dataset.pendingEmail?.toLowerCase() || '';
        row.classList.toggle('d-none', Boolean(needle) && !name.includes(needle) && !email.includes(needle));
      });
    }

    function hideMemberSearchDropdown() {
      resultsDropdown?.classList.add('d-none');
      spinnerContainer?.classList.add('d-none');
    }

    async function searchUsersToAdd(query) {
      if (!window.isCurrentUserOwner || !resultsDropdown) return;
      spinnerContainer?.classList.remove('d-none');
      try {
        const data = await api(`api/users/search/?q=${encodeURIComponent(query)}`);
        spinnerContainer?.classList.add('d-none');
        resultsDropdown.innerHTML = '';

        const users = (data.users || []).filter(
          user => user.id !== currentUserId && !workspaceMemberIds.has(user.id),
        );

        if (users.length) {
          users.forEach(user => {
            const li = document.createElement('li');
            li.className = 'list-group-item list-group-item-action py-1 px-2 border-0 workspace-search-hit';
            li.style.cursor = 'pointer';
            li.style.fontSize = '0.85rem';
            li.innerHTML = `➕ <strong>${escapeHtml(user.username)}</strong> <small class="workspace-members-hint">(${escapeHtml(user.email || 'no email')})</small>`;
            li.addEventListener('click', () => {
              addMemberToWorkspace(user.username);
              hideMemberSearchDropdown();
              if (searchInput) searchInput.value = '';
              filterWorkspaceMemberRows('');
            });
            resultsDropdown.appendChild(li);
          });
          resultsDropdown.classList.remove('d-none');
          return;
        }

        if (looksLikeEmail(query)) {
          const li = document.createElement('li');
          li.className = 'list-group-item list-group-item-action py-1 px-2 border-0 workspace-search-hit';
          li.style.cursor = 'pointer';
          li.style.fontSize = '0.85rem';
          li.innerHTML = `✉️ Invite <strong>${escapeHtml(query)}</strong> <small class="workspace-members-hint">(not registered)</small>`;
          li.addEventListener('click', () => {
            inviteMemberByEmail(query);
            hideMemberSearchDropdown();
            if (searchInput) searchInput.value = '';
            filterWorkspaceMemberRows('');
          });
          resultsDropdown.appendChild(li);
          resultsDropdown.classList.remove('d-none');
          return;
        }

        resultsDropdown.innerHTML = '<li class="list-group-item workspace-members-hint py-1 px-2 border-0 small">No users found</li>';
        resultsDropdown.classList.remove('d-none');
      } catch (err) {
        spinnerContainer?.classList.add('d-none');
        resultsDropdown.innerHTML = `<li class="list-group-item text-danger py-1 px-2 border-0 small">${escapeHtml(err.message || 'Search failed')}</li>`;
        resultsDropdown.classList.remove('d-none');
        console.warn('Member search failed:', err);
      }
    }

    if (searchInput) {
      searchInput.addEventListener('input', function () {
        const query = this.value.trim();
        if (membersModalEl?.classList.contains('show')) {
          filterWorkspaceMemberRows(query, membersModalList);
        }

        if (query.length < 2) {
          hideMemberSearchDropdown();
          return;
        }

        if (!window.isCurrentUserOwner) {
          hideMemberSearchDropdown();
          return;
        }

        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => searchUsersToAdd(query), 300);
      });

      document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !resultsDropdown?.contains(e.target)) {
          hideMemberSearchDropdown();
        }
      });
    }

    async function addMemberToWorkspace(username) {
      const workspaceId = document.getElementById('workspace-select')?.value;
      if (!workspaceId) return;

      try {
        const result = await api('api/workspaces/add-user/', 'POST', {
          username,
          workspace_id: workspaceId,
        });
        if (result.status === 'success') {
          await loadWorkspaceMembers(workspaceId);
          const label = result.username || username;
          const message = result.invited
            ? (result.message || `Invitation sent to ${label}.`)
            : (result.message || `${label} added.`);
          showToast(message, 'success', result.invited ? 6000 : 4000);
        } else {
          showToast(result.message || 'Error adding member.', 'danger');
        }
      } catch (err) {
        showToast(err.message || 'Action failed.', 'danger');
      }
    }

    async function inviteMemberByEmail(email, role = 'read') {
      const workspaceId = document.getElementById('workspace-select')?.value;
      if (!workspaceId) return;

      try {
        const result = await api('api/workspaces/add-user/', 'POST', {
          email,
          role,
          workspace_id: workspaceId,
        });
        if (result.status === 'success') {
          await loadWorkspaceMembers(workspaceId);
          showToast(result.message || `Invitation sent to ${email}.`, 'success', 6000);
        } else {
          showToast(result.message || 'Invite failed.', 'danger');
        }
      } catch (err) {
        showToast(err.message || 'Invite failed.', 'danger', 8000);
      }
    }

    async function removeWorkspaceMember(userId, username) {
      if (!window.isCurrentUserOwner) return;
      if (!confirm(`Remove ${username} from this workspace?`)) return;

      const workspaceId = document.getElementById('workspace-select')?.value;
      if (!workspaceId) return;

      try {
        await api('api/workspaces/remove-user/', 'POST', {
          user_id: userId,
          workspace_id: workspaceId,
        });
        await loadWorkspaceMembers(workspaceId);
        showToast('Member removed.', 'success');
      } catch (err) {
        showToast(err.message || 'Could not remove member.', 'danger');
      }
    }

    async function changeMemberRole(userId, badgeElement) {
      const workspaceId = document.getElementById('workspace-select')?.value;
      if (!workspaceId) return;

      try {
        const result = await api('api/workspaces/change-role/', 'POST', {
          user_id: userId,
          workspace_id: workspaceId,
        });
        if (result.status === 'success') {
          if (result.role === 'write') {
            badgeElement.className = 'badge bg-info text-white ms-1 role-toggle-badge';
            badgeElement.textContent = 'write';
          } else {
            badgeElement.className = 'badge bg-secondary text-white ms-1 role-toggle-badge';
            badgeElement.textContent = 'only read access';
          }
          if (userId === currentUserId) {
            syncUserEditAccess(window.isCurrentUserOwner, result.role);
          }
          showToast(result.message, 'success');
        } else {
          showToast(result.message, 'danger');
        }
      } catch (err) {
        showToast(err.message || 'Could not change role.', 'danger');
      }
    }

    function createMemberRow(id, name, isOwner, role) {
      const li = document.createElement('li');
      li.className = 'list-group-item d-flex justify-content-between align-items-center px-2 py-2 border-0 rounded-2 mb-1 user-row-hover';
      li.dataset.userId = id;

      const initials = name.split(/[\s._-]+/).map(n => n).join('').toUpperCase().substring(0, 2) || name.toUpperCase();
      const colors = ['#4e73df', '#1cc88a', '#36b9cc', '#f6c23e', '#e74a3b', '#6f42c1'];
      const avatarColor = colors[name.charCodeAt(0) % colors.length];

      let actionHTML = '';
      let badgeHTML = '';

      if (isOwner || role === 'owner') {
        badgeHTML = '<span class="badge bg-warning text-dark ms-1" style="font-size: 0.65rem;">Owner</span>';
        actionHTML = '<span class="text-muted small" title="Workspace Owner">🔒</span>';
      } else {
        const badgeClass = role === 'write' ? 'bg-info' : 'bg-secondary';
        const badgeText = role === 'write' ? 'write' : 'only read access';
        const pointerStyle = window.isCurrentUserOwner ? 'cursor: pointer;' : '';
        const titleText = window.isCurrentUserOwner ? 'Click to change role' : 'Your role';
        badgeHTML = `<span class="badge ${badgeClass} text-white ms-1 role-toggle-badge" style="font-size: 0.65rem; ${pointerStyle}" title="${titleText}">${badgeText}</span>`;
        if (window.isCurrentUserOwner) {
          actionHTML = '<button type="button" class="btn btn-sm btn-link text-danger p-0 border-0 remove-user-btn" style="text-decoration: none;" title="Remove member">✕</button>';
        }
      }

      if (id !== currentUserId) {
        actionHTML = `<button type="button" class="btn btn-sm btn-link p-0 border-0 private-message-btn" title="Private message" aria-label="Private message">💬</button>${actionHTML}`;
      }

      li.innerHTML = `
        <div class="d-flex align-items-center gap-2">
          <div class="avatar-circle d-flex align-items-center justify-content-center text-white fw-bold shadow-sm"
            style="background-color: ${avatarColor}; width: 28px; height: 28px; border-radius: 50%; font-size: 0.75rem;">
            ${escapeHtml(initials)}
          </div>
          <div class="d-flex flex-column">
            <div class="d-flex align-items-center gap-1">
              <span class="fw-semibold workspace-member-name mb-0">${escapeHtml(name)}</span>
              <span class="badge-container">${badgeHTML}</span>
            </div>
          </div>
        </div>
        <div class="d-flex align-items-center gap-1">${actionHTML}</div>
      `;

      li.querySelector('.private-message-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openPrivateChatWithUser(id, name);
      });

      li.querySelector('.remove-user-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        removeWorkspaceMember(id, name);
      });

      const badgeElement = li.querySelector('.role-toggle-badge');
      if (badgeElement && window.isCurrentUserOwner && role !== 'owner' && !isOwner) {
        badgeElement.addEventListener('click', (e) => {
          e.stopPropagation();
          changeMemberRole(id, badgeElement);
        });
      }

      return li;
    }

    function createPendingInviteRow(email, role) {
      const li = document.createElement('li');
      li.className = 'list-group-item d-flex justify-content-between align-items-center px-2 py-2 border-0 rounded-2 mb-1 user-row-hover';
      li.dataset.pendingEmail = email;

      const badgeClass = role === 'write' ? 'bg-info' : 'bg-secondary';
      const badgeText = role === 'write' ? 'write' : 'only read access';

      li.innerHTML = `
        <div class="d-flex align-items-center gap-2">
          <div class="avatar-circle d-flex align-items-center justify-content-center text-white fw-bold shadow-sm"
            style="background-color: #6c757d; width: 28px; height: 28px; border-radius: 50%; font-size: 0.75rem;">
            ✉
          </div>
          <div class="d-flex flex-column">
            <div class="d-flex align-items-center gap-1 flex-wrap">
              <span class="fw-semibold workspace-member-name mb-0">${escapeHtml(email)}</span>
              <span class="badge bg-warning text-dark" style="font-size: 0.65rem;">Pending invite</span>
              <span class="badge ${badgeClass} text-white" style="font-size: 0.65rem;">${badgeText}</span>
            </div>
          </div>
        </div>
        <span class="text-muted small" title="Invitation sent">⏳</span>
      `;
      return li;
    }

    function renderMembersList(container, members, pendingInvites = []) {
      if (!container) return;
      container.innerHTML = '';
      members.forEach(member => {
        container.appendChild(
          createMemberRow(member.id, member.username, member.is_owner, member.role),
        );
      });
      pendingInvites.forEach(invite => {
        container.appendChild(createPendingInviteRow(invite.email, invite.role));
      });
    }

    function updateBadgeCount() {
      const countBadge = document.getElementById('user-count');
      if (countBadge) {
        const pendingCount = cachedPendingInvites.length;
        countBadge.textContent = pendingCount
          ? `${cachedWorkspaceMembers.length}+${pendingCount}`
          : String(cachedWorkspaceMembers.length);
      }
    }

    function openWorkspaceMembersModal() {
      if (!membersModalEl || !membersModalList) return;
      renderMembersList(membersModalList, cachedWorkspaceMembers, cachedPendingInvites);
      const query = searchInput?.value.trim() || '';
      if (query) filterWorkspaceMemberRows(query, membersModalList);
      const title = document.getElementById('workspace-members-modal-title');
      if (title) {
        const pendingSuffix = cachedPendingInvites.length
          ? `, ${cachedPendingInvites.length} pending`
          : '';
        title.textContent = `Workspace Members (${cachedWorkspaceMembers.length}${pendingSuffix})`;
      }
      if (membersModalHint) {
        membersModalHint.classList.toggle('d-none', !window.isCurrentUserOwner);
      }
      bootstrap.Modal.getOrCreateInstance(membersModalEl).show();
    }

    countBadgeBtn?.addEventListener('click', () => {
      const panel = document.getElementById('right-panel');
      if (panel?.classList.contains('collapsed')) {
        toggleRightPanel();
      }
      openWorkspaceMembersModal();
    });

    function loadWorkspaceMembers(workspaceId) {
      if (!workspaceId) return Promise.resolve();

      return fetch(apiUrl(`/api/workspaces/${workspaceId}/members/`))
        .then(res => res.json())
        .then(data => {
          if (data.status !== 'success') return;

          window.isCurrentUserOwner = data.is_current_user_owner;

          const currentUserMembership = data.members.find(m => m.id === currentUserId);
          const currentUserRole = currentUserMembership ? currentUserMembership.role : 'read';
          syncUserEditAccess(data.is_current_user_owner, currentUserRole);

          workspaceMemberIds.clear();
          cachedWorkspaceMembers = [...data.members].sort((a, b) =>
            (a.username || '').localeCompare(b.username || '', undefined, { sensitivity: 'base' }),
          );
          cachedWorkspaceMembers.forEach(member => workspaceMemberIds.add(member.id));
          cachedPendingInvites = Array.isArray(data.pending_invites) ? [...data.pending_invites] : [];

          if (userListContainer) userListContainer.innerHTML = '';
          renderMembersList(membersModalList, cachedWorkspaceMembers, cachedPendingInvites);
          updateBadgeCount();

          const inviteBox = document.getElementById('invite-email-box');
          if (inviteBox) {
            if (data.is_current_user_owner) inviteBox.classList.remove('d-none');
            else inviteBox.classList.add('d-none');
          }
          populateMailRecipients(data.members);
          if (searchInput) {
            searchInput.placeholder = data.is_current_user_owner
              ? 'Filter members or add users…'
              : 'Filter members…';
          }
          if (membersModalEl?.classList.contains('show')) {
            const query = searchInput?.value.trim() || '';
            if (query) filterWorkspaceMemberRows(query, membersModalList);
          }
        })
        .catch(err => console.warn('loadWorkspaceMembers failed:', err));
    }

    const select = document.getElementById('workspace-select');
    if (select?.value) {
      loadWorkspaceMembers(select.value);
    }
    select?.addEventListener('change', function () {
      loadWorkspaceMembers(this.value);
    });


 
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
    initKeepNotes();

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
  initPreviewTagClicks();
  initSheetCellEditors();
  initCalendarNoteEditors();
  initGanttNoteEditors();
  initKanbanEditors();
  initKanbanganttEditors();
  initMindmapEditors();
  initChartInsertModal();
  initPanelInsertModal();
  initSnippetsModal();
  syncWorkspaceIdFromDom();
  applyLayoutFromSettings();
  syncMobileLayoutClass();
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
  initIncomes();


  document.getElementById('toc-toggle')?.addEventListener('click', toggleFloatingToc);
  document.getElementById('mobile-toc-backdrop')?.addEventListener('click', closeFloatingToc);
  document.getElementById('floating-toc-list')?.addEventListener('wheel', (event) => {
    event.stopPropagation();
  }, { passive: true });
  document.getElementById('floating-toc-list')?.addEventListener('touchmove', (event) => {
    event.stopPropagation();
  }, { passive: true });
  document.getElementById('mobile-topbar-menu-toggle')?.addEventListener('click', toggleMobileTopbarMenu);
  document.getElementById('mobile-topbar-menu-backdrop')?.addEventListener('click', closeMobileTopbarMenu);
  document.getElementById('mobile-topbar-menu')?.addEventListener('click', event => {
    if (event.target.closest('a, button')) closeMobileTopbarMenu();
  });
  window.addEventListener('resize', () => {
    // Mobile browser chrome show/hide fires resize often — debounce mode switches.
    clearTimeout(window.__notesproResizeTimer);
    window.__notesproResizeTimer = setTimeout(() => {
      const wasMobile = document.body.classList.contains('mobile-layout');
      syncMobileLayoutClass();
      const mobile = isMobileLayout();
      if (wasMobile === mobile) return;
      if (isEditing) switchMode('markdown');
      else switchMode('preview');
    }, 150);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.getElementById('floating-toc')?.classList.contains('active')) {
      closeFloatingToc();
    }
    if (event.key === 'Escape' && document.getElementById('mobile-topbar-menu')?.classList.contains('active')) {
      closeMobileTopbarMenu();
    }
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

  function createPdfExportRoot(htmlContent) {
    const element = document.createElement('div');
    element.className = 'pdf-export preview-layout';
    element.innerHTML = htmlContent;
    return element;
  }

  function downloadPDF() {
      const htmlContent = renderMarkdownPreviewHtml(easyMDE.value(), { sheetEditable: false, richBlocks: true });
      const element = createPdfExportRoot(htmlContent);
      html2pdf().from(element).save('document.pdf');
  }

  let lastToastKey = '';
  let lastToastAt = 0;

  function showToast(message, type = 'success', delayMs = 4000) {
      const toastEl = document.getElementById('action-toast');
      const toastMessage = document.getElementById('toast-message');
      if (!toastEl || !toastMessage) return;

      const clean = sanitizeApiErrorMessage(message);
      // Avoid toast spam (e.g. polling / resize loops with the same failure).
      const key = `${type}:${clean}`;
      const now = Date.now();
      if (key === lastToastKey && now - lastToastAt < 4000) return;
      lastToastKey = key;
      lastToastAt = now;

      toastEl.classList.remove('bg-success', 'bg-danger', 'bg-warning', 'text-dark');
      if (type === 'warning') toastEl.classList.add('bg-warning', 'text-dark');
      else toastEl.classList.add(type === 'success' ? 'bg-success' : 'bg-danger');
      toastMessage.textContent = clean;

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

  // ——— Incomes (external IMAP mail) ———

  let incomingItems = [];
  let selectedIncomingId = null;
  let incomesRouteState = null;

  function applyIncomesRouteWarnings(route) {
    incomesRouteState = route || null;
    const box = document.getElementById('incomes-route-warnings');
    const wsSel = document.getElementById('incomes-distribute-workspace');
    const folderSel = document.getElementById('incomes-distribute-folder');
    const wsReq = document.getElementById('incomes-ws-required');
    const folderReq = document.getElementById('incomes-folder-required');
    const messages = [];

    wsSel?.classList.remove('incomes-select-missing');
    folderSel?.classList.remove('incomes-select-missing');
    wsReq?.classList.add('d-none');
    folderReq?.classList.add('d-none');

    if (route?.needs_workspace_select) {
      messages.push(`Workspace <strong>${escapeHtml(route.parsed_workspace)}</strong> not found — select one below.`);
      wsSel?.classList.add('incomes-select-missing');
      wsReq?.classList.remove('d-none');
    }
    if (route?.needs_folder_select) {
      messages.push(`Folder <strong>${escapeHtml(route.parsed_folder)}</strong> not found — select one below.`);
      folderSel?.classList.add('incomes-select-missing');
      folderReq?.classList.remove('d-none');
    }

    if (!box) return;
    if (!messages.length) {
      box.classList.add('d-none');
      box.innerHTML = '';
      return;
    }
    box.classList.remove('d-none');
    box.innerHTML = messages.join('<br>');
  }

  function clearIncomesRouteWarnings() {
    applyIncomesRouteWarnings(null);
  }

  function populateIncomesWorkspaceSelect(selectedId) {
    syncIncomesWorkspaceSelect(selectedId);
  }

  async function loadIncomesFolderOptions(wsId, selectedFolderId = null) {
    const folderSel = document.getElementById('incomes-distribute-folder');
    if (!folderSel || !wsId) return;
    folderSel.innerHTML = '<option value="">— workspace root —</option>';
    try {
      const tree = await api(`api/workspaces/${wsId}/tree/`);
      const nodes = Array.isArray(tree) ? tree : [];
      const folders = nodes.filter(n => n.type === 'folder' || n.data?.is_folder);
      const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
      function depth(id) {
        let d = 0;
        let cur = byId[id];
        while (cur && cur.parent && cur.parent !== '#') {
          d += 1;
          cur = byId[cur.parent];
        }
        return d;
      }
      folders
        .sort((a, b) => a.text.localeCompare(b.text))
        .forEach(f => {
          const opt = document.createElement('option');
          opt.value = f.id;
          opt.textContent = `${'  '.repeat(depth(f.id))}${f.text}`;
          folderSel.appendChild(opt);
        });
      const pick = selectedFolderId ?? incomesRouteState?.folder_id;
      if (pick && [...folderSel.options].some(o => o.value === String(pick))) {
        folderSel.value = String(pick);
      }
      if (incomesRouteState?.needs_folder_select && folderSel.value) {
        folderSel.classList.remove('incomes-select-missing');
      }
    } catch (e) {
      console.warn('incomes folder list', e);
    }
  }

  function showIncomesList() {
    document.getElementById('incomes-list')?.classList.remove('d-none');
    document.getElementById('incomes-detail')?.classList.add('d-none');
    selectedIncomingId = null;
    clearIncomesRouteWarnings();
  }

  async function showIncomingDetail(item) {
    selectedIncomingId = item.id;
    document.getElementById('incomes-list')?.classList.add('d-none');
    const detail = document.getElementById('incomes-detail');
    detail?.classList.remove('d-none');
    const meta = document.getElementById('incomes-detail-meta');
    if (meta) {
      meta.textContent = `${item.sender_email || 'unknown sender'} · ${new Date(item.received_at).toLocaleString()}`;
    }
    const route = document.getElementById('incomes-detail-route');
    if (route) {
      route.innerHTML = item.route_hint
        ? `Route: <code>${escapeHtml(item.route_hint)}</code>`
        : '<span class="text-muted">No NotesPro route in subject</span>';
    }
    const attachBox = document.getElementById('incomes-attachments');
    if (attachBox) {
      const emlHref = item.eml_url || apiUrl(`api/incoming/${item.id}/eml/`);
      const pdfHref = item.pdf_url || apiUrl(`api/incoming/${item.id}/pdf/`);
      const buttons = [];
      if (emlHref) {
        buttons.push(`<a href="${escapeHtml(emlHref)}" class="btn btn-sm btn-outline-light" download>Open .eml</a>`);
      }
      if (pdfHref) {
        buttons.push(`<a href="${escapeHtml(pdfHref)}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline-light">Open PDF</a>`);
      }
      if (buttons.length) {
        attachBox.classList.remove('d-none');
        attachBox.innerHTML = `<div class="d-flex flex-wrap gap-1">${buttons.join('')}</div>`;
      } else {
        attachBox.classList.add('d-none');
        attachBox.innerHTML = '';
      }
    }
    const body = document.getElementById('incomes-detail-body');
    if (body) body.textContent = item.body || '(empty body)';
    const titleInput = document.getElementById('incomes-distribute-title');
    if (titleInput) titleInput.value = item.parsed_page || item.subject || '';
    populateIncomesWorkspaceSelect(null);
    clearIncomesRouteWarnings();

    try {
      const resolved = await api(`api/incoming/${item.id}/resolve-route/`);
      applyIncomesRouteWarnings(resolved);
      if (resolved.workspace_id) {
        populateIncomesWorkspaceSelect(resolved.workspace_id);
        await loadIncomesFolderOptions(resolved.workspace_id, resolved.folder_id);
      } else {
        const wsSel = document.getElementById('incomes-distribute-workspace');
        if (wsSel?.value) await loadIncomesFolderOptions(wsSel.value);
      }
    } catch (e) {
      console.warn('incoming resolve-route', e);
      const wsSel = document.getElementById('incomes-distribute-workspace');
      if (wsSel?.value) await loadIncomesFolderOptions(wsSel.value);
    }
  }

  function renderIncomesList() {
    const list = document.getElementById('incomes-list');
    const badge = document.getElementById('incomes-badge');
    if (!list) return;
    const count = incomingItems.length;
    if (badge) {
      badge.textContent = String(count);
      badge.classList.toggle('d-none', count === 0);
    }
    if (!count) {
      list.innerHTML = '<p class="small text-muted mb-0">No pending mail.</p>';
      return;
    }
    list.innerHTML = '';
    incomingItems.forEach(item => {
      const row = document.createElement('div');
      row.className = 'income-item';
      row.innerHTML = `
        <div class="income-item-subject">${escapeHtml(item.subject)}</div>
        <div class="income-item-meta">${escapeHtml(item.sender_email || '')}${item.route_hint ? ' · ' + escapeHtml(item.parsed_workspace || '') : ''}</div>
      `;
      row.addEventListener('click', () => showIncomingDetail(item));
      list.appendChild(row);
    });
  }

  async function loadIncomingList() {
    try {
      const data = await api('api/incoming/?status=pending');
      incomingItems = data.items || [];
      renderIncomesList();
      if (selectedIncomingId) {
        const item = incomingItems.find(i => i.id === selectedIncomingId);
        if (item) showIncomingDetail(item);
        else showIncomesList();
      }
    } catch (e) {
      console.warn('incoming list', e);
    }
  }

  function initIncomes() {
    document.getElementById('incomes-fetch-btn')?.addEventListener('click', async () => {
      try {
        const data = await api('api/incoming/fetch/', 'POST', {});
        const f = data.fetch || {};
        let msg = `${f.imported || 0} imported, ${f.skipped || 0} skipped.`;
        const reasons = f.skip_reasons || [];
        const dup = reasons.filter(r => r.reason === 'already_imported').length;
        const noUser = reasons.filter(r => r.reason === 'no_recipient').length;
        const noMarker = reasons.filter(r => r.reason === 'no_notespro_marker').length;
        if (dup) msg += ` ${dup} already in Incomes.`;
        if (noUser) msg += ` ${noUser} had no matching user.`;
        if (noMarker) msg += ` ${noMarker} without NotesPro: line.`;
        if ((f.imported || 0) === 0 && dup && (data.pending_count || 0) > 0) {
          msg += ' Check the Incomes panel.';
        }
        showToast(`Fetched: ${msg}`, (f.imported || 0) > 0 ? 'success' : 'warning', 7000);
        await loadIncomingList();
      } catch (err) {
        showToast(err.message || 'Could not fetch mail.', 'danger', 6000);
      }
    });

    document.getElementById('incomes-back-btn')?.addEventListener('click', showIncomesList);

    document.getElementById('incomes-distribute-workspace')?.addEventListener('change', async (e) => {
      if (incomesRouteState?.needs_workspace_select && e.target.value) {
        incomesRouteState = { ...incomesRouteState, needs_workspace_select: false };
        applyIncomesRouteWarnings(incomesRouteState);
      }
      document.getElementById('incomes-distribute-workspace')?.classList.remove('incomes-select-missing');
      await loadIncomesFolderOptions(e.target.value);
      if (selectedIncomingId) {
        try {
          const resolved = await api(`api/incoming/${selectedIncomingId}/resolve-route/`);
          const wsId = e.target.value;
          const folderHint = resolved.parsed_folder;
          if (folderHint && wsId) {
            const tree = await api(`api/workspaces/${wsId}/tree/`);
            const nodes = Array.isArray(tree) ? tree : [];
            const match = nodes.find(n =>
              (n.type === 'folder' || n.data?.is_folder)
              && n.text.toLowerCase() === folderHint.split('/').pop().trim().toLowerCase()
            );
            if (match) {
              const folderSel = document.getElementById('incomes-distribute-folder');
              if (folderSel) folderSel.value = match.id;
              folderSel?.classList.remove('incomes-select-missing');
            }
          }
        } catch (err) {
          console.warn('incoming folder re-match', err);
        }
      }
    });

    document.getElementById('incomes-distribute-folder')?.addEventListener('change', (e) => {
      if (incomesRouteState?.needs_folder_select && e.target.value) {
        incomesRouteState = { ...incomesRouteState, needs_folder_select: false };
        applyIncomesRouteWarnings(incomesRouteState);
      }
      document.getElementById('incomes-distribute-folder')?.classList.remove('incomes-select-missing');
    });

    document.getElementById('incomes-dismiss-btn')?.addEventListener('click', async () => {
      if (!selectedIncomingId) return;
      try {
        await api(`api/incoming/${selectedIncomingId}/dismiss/`, 'POST', {});
        showToast('Dismissed.', 'success');
        showIncomesList();
        await loadIncomingList();
      } catch (err) {
        showToast(err.message || 'Dismiss failed.', 'danger');
      }
    });

    document.getElementById('incomes-distribute-btn')?.addEventListener('click', async () => {
      if (!selectedIncomingId) return;
      const wsId = document.getElementById('incomes-distribute-workspace')?.value;
      const parentId = document.getElementById('incomes-distribute-folder')?.value || null;
      const title = document.getElementById('incomes-distribute-title')?.value.trim();
      if (!wsId) {
        showToast('Choose a workspace.', 'danger');
        return;
      }
      if (incomesRouteState?.needs_workspace_select) {
        showToast(`Workspace "${incomesRouteState.parsed_workspace}" not found — select a workspace.`, 'warning', 6000);
        document.getElementById('incomes-distribute-workspace')?.classList.add('incomes-select-missing');
        return;
      }
      if (incomesRouteState?.needs_folder_select && !parentId) {
        showToast(`Folder "${incomesRouteState.parsed_folder}" not found — select a folder.`, 'warning', 6000);
        document.getElementById('incomes-distribute-folder')?.classList.add('incomes-select-missing');
        return;
      }
      try {
        const result = await api(`api/incoming/${selectedIncomingId}/distribute/`, 'POST', {
          workspace_id: parseInt(wsId, 10),
          parent_id: parentId || null,
          title: title || undefined,
        });
        showToast('Distributed to workspace.', 'success');
        if (result.page?.id) {
          syncWorkspaceIdFromDom();
          const wsSelect = document.getElementById('workspace-select');
          if (wsSelect) wsSelect.value = String(wsId);
          await loadTree(result.page.id);
          await loadPage(result.page.id);
        }
        showIncomesList();
        await loadIncomingList();
      } catch (err) {
        showToast(err.message || 'Distribute failed.', 'danger', 6000);
      }
    });

    loadIncomingList();
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
        loadDmConversations({ quiet: true });
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
      loadDmConversations({ quiet: true });
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
    else loadDmConversations({ quiet: true });
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
        const msg = sanitizeApiErrorMessage(e.message || 'Could not load group chat.', e.status);
        box.innerHTML = `<p class="small text-danger px-2 py-3">${escapeHtml(msg)}</p>`;
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

  async function loadDmConversations({ quiet = false } = {}) {
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
      console.warn('dm conversations load', e);
      if (!quiet) showToast(e.message || 'Could not load private chats.', 'danger');
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
    loadDmConversations({ quiet: true });
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
        .then(() => loadDmConversations({ quiet: true }))
        .catch(e => console.warn('private chat init', e));
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
        await loadWorkspaceMembers(workspaceId);
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
