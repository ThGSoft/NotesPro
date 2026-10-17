/**
 * NotesPro ```drawio``` block — diagrams.net (draw.io) editor.
 * The diagram XML is stored in the fence. The editor is the self-hosted
 * diagrams.net web app (vendor/drawio) and autosaves back into the note.
 */
(function (root, factory) {
  const api = factory();
  root.NotesProDrawio = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];
  const UI = ['dark', 'atlas', 'min', 'kennedy', 'sketch'];
  const DEFAULT_UI = 'dark';
  const DEFAULT_H = 640;
  const MIN_H = 320;
  const MAX_H = 1600;
  const MAX_XML = 1500000;
  const FENCE_BREAK = '`\u200b`\u200b`';
  const frames = new Set();
  const pngCache = new Map();
  let listening = false;

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fenceRe() {
    return /```(?:drawio|draw\.io|diagrams\.net)(?:\{([^}]*)\})?[ \t]*(?:\r?\n([\s\S]*?))?```/gi;
  }

  function parseFenceAttrs(attrs) {
    const config = {};
    String(attrs || '').split(/[;\s]+/).forEach((pair) => {
      const trimmed = pair.trim();
      if (!trimmed) return;
      const eq = trimmed.indexOf('=');
      if (eq < 0) {
        config[trimmed.toLowerCase()] = '';
        return;
      }
      config[trimmed.slice(0, eq).trim().toLowerCase()] = trimmed.slice(eq + 1).trim().replace(/,\s*$/, '');
    });
    return config;
  }

  function sanitizeColor(raw) {
    const value = String(raw || '').trim();
    if (!value) return '';
    if (/^#[0-9a-f]{3,8}$/i.test(value)) return value;
    if (/^(rgb|hsl)a?\([^)]+\)$/i.test(value)) return value;
    if (/^[a-z]{3,20}$/i.test(value)) return value;
    return '';
  }

  function resolveStyle(cfg) {
    const colRaw = String(cfg.col || cfg.color || '').trim();
    const lower = colRaw.toLowerCase();
    let theme = '';
    let colorCss = '';
    if (THEMES.includes(lower)) theme = lower;
    else if (colRaw) colorCss = sanitizeColor(colRaw);
    const bgCss = sanitizeColor(cfg.bkcol || cfg.bgcol || '');
    return { theme, colorCss, bgCss };
  }

  function resolveFullscreen(cfg) {
    const raw = String(cfg.fullscreen ?? cfg.full ?? '1').trim().toLowerCase();
    if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'compact') return false;
    return true;
  }

  function resolveUi(cfg) {
    const raw = String(cfg.ui || cfg.theme || '').trim().toLowerCase();
    return UI.includes(raw) ? raw : DEFAULT_UI;
  }

  function resolveLibs(cfg) {
    const raw = String(cfg.libs ?? cfg.libraries ?? '1').trim().toLowerCase();
    return !(raw === '0' || raw === 'false' || raw === 'no' || raw === 'off');
  }

  function resolveHeight(cfg) {
    const raw = cfg.height ?? cfg.h;
    if (raw == null || String(raw).trim() === '') return DEFAULT_H;
    const value = Number(raw);
    if (!Number.isFinite(value)) return DEFAULT_H;
    return Math.max(MIN_H, Math.min(MAX_H, Math.round(value)));
  }

  function resolveTitle(cfg) {
    return String(cfg.title || 'Diagram').trim() || 'Diagram';
  }

  function buildFenceAttrsString(cfg) {
    const parts = [];
    if (resolveFullscreen(cfg)) parts.push('fullscreen');
    parts.push(`ui=${resolveUi(cfg)}`);
    parts.push(`height=${resolveHeight(cfg)}`);
    if (!resolveLibs(cfg)) parts.push('libs=0');
    const title = String(cfg.title || '').trim().replace(/[;{}]/g, '');
    if (title) parts.push(`title=${title}`);
    const col = String(cfg.col || cfg.color || '').trim().replace(/[;{}]/g, '');
    if (col) parts.push(`col=${col}`);
    const bk = String(cfg.bkcol || cfg.bgcol || '').trim().replace(/[;{}]/g, '');
    if (bk) parts.push(`bkcol=${bk}`);
    return parts.join(';');
  }

  function blankXml() {
    return [
      '<mxfile host="NotesPro" agent="NotesPro">',
      '  <diagram id="page-1" name="Page-1">',
      '    <mxGraphModel dx="1024" dy="640" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">',
      '      <root>',
      '        <mxCell id="0"/>',
      '        <mxCell id="1" parent="0"/>',
      '      </root>',
      '    </mxGraphModel>',
      '  </diagram>',
      '</mxfile>',
    ].join('\n');
  }

  function encodeFenceBody(xml) {
    return String(xml || '').replace(/```/g, FENCE_BREAK).trim();
  }

  function bytesToBase64(text) {
    const raw = String(text || '');
    if (typeof Buffer !== 'undefined') return Buffer.from(raw, 'utf8').toString('base64');
    const bytes = new TextEncoder().encode(raw);
    let binary = '';
    bytes.forEach((b) => { binary += String.fromCharCode(b); });
    return btoa(binary);
  }

  function base64ToBytes(encoded) {
    const text = String(encoded || '').trim();
    if (!text) return '';
    if (text.charAt(0) === '<') return text;
    const raw = text.replace(/\s+/g, '');
    try {
      if (typeof Buffer !== 'undefined') return Buffer.from(raw, 'base64').toString('utf8');
      const binary = atob(raw);
      const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch (err) {
      return '';
    }
  }

  function normalizeDiagramXml(xml) {
    return String(xml || '').replace(/<diagram\b([^>]*)>([\s\S]*?)<\/diagram>/gi, (match, attrs, body) => {
      if (String(body || '').includes('<')) return match;
      return `<diagram${attrs}>${String(body || '').replace(/\s+/g, '')}</diagram>`;
    });
  }

  function decodeFenceBody(text) {
    return String(text || '').split(FENCE_BREAK).join('```').trim();
  }

  function embedBase() {
    const prefix = (typeof window !== 'undefined' && window.APP_BASE)
      ? String(window.APP_BASE).replace(/\/$/, '')
      : '';
    return `${prefix}/drawio/index.html`;
  }

  function embedUrl(cfg, editable) {
    const ui = resolveUi(cfg);
    const params = [
      ['embed', '1'],
      ['proto', 'json'],
      ['spin', '1'],
      ['ui', ui],
      ['saveAndExit', '0'],
      ['noExitBtn', '1'],
      ['noSaveBtn', editable ? '0' : '1'],
      ['libraries', resolveLibs(cfg) ? '1' : '0'],
      ['offline', '1'],
      ['pwa', '0'],
      ['local', '1'],
      ['gapi', '0'],
      ['db', '0'],
      ['od', '0'],
      ['gh', '0'],
      ['gl', '0'],
      ['tr', '0'],
    ];
    if (resolveLibs(cfg)) params.push(['libs', 'general;uml;flowchart;basic']);
    if (ui === 'dark') params.push(['dark', '1']);
    const qs = params.map(([key, value]) => (
      `${encodeURIComponent(key)}=${encodeURIComponent(value).replace(/%3B/gi, ';')}`
    )).join('&');
    return `${embedBase()}?${qs}`;
  }

  function isAllowedOrigin(origin) {
    return typeof location !== 'undefined' && origin === location.origin;
  }

  function readFence(markdown, index) {
    let idx = 0;
    let found = null;
    String(markdown || '').replace(fenceRe(), (match, fenceAttrs, content = '') => {
      if (idx === index) {
        found = {
          attrs: fenceAttrs || '',
          xml: decodeFenceBody(content),
        };
      }
      idx += 1;
      return match;
    });
    return found;
  }

  function rewriteFence(markdown, index, payload) {
    let idx = 0;
    return String(markdown || '').replace(fenceRe(), (match, fenceAttrs, content = '') => {
      const thisIndex = idx;
      idx += 1;
      if (thisIndex !== index) return match;
      const cfg = parseFenceAttrs(fenceAttrs || '');
      if (payload?.title != null) cfg.title = payload.title;
      if (payload?.ui) cfg.ui = payload.ui;
      if (payload?.height != null && payload.height !== '') cfg.height = String(payload.height);
      const attrs = buildFenceAttrsString(cfg);
      const body = payload && Object.prototype.hasOwnProperty.call(payload, 'xml')
        ? encodeFenceBody(payload.xml)
        : encodeFenceBody(decodeFenceBody(content));
      const fence = attrs ? `drawio{${attrs}}` : 'drawio';
      return `\`\`\`${fence}\n${body}\n\`\`\``;
    });
  }

  function renderBlock(source, fenceAttrs, options = {}) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const style = resolveStyle(cfg);
    const title = resolveTitle(cfg);
    const height = resolveHeight(cfg);
    const ui = resolveUi(cfg);
    const drawioIndex = Number.isFinite(options.drawioIndex) ? options.drawioIndex : 0;
    const fullscreen = resolveFullscreen(cfg);
    const themeClass = style.theme ? ` drawio-block--${style.theme}` : '';
    const customClass = (style.colorCss || style.bgCss) ? ' drawio-block--custom' : '';
    const fullClass = fullscreen ? ' drawio-block--fullscreen' : '';
    const styleVars = [`--drawio-h:${height}px`];
    if (style.colorCss) styleVars.push(`--drawio-accent:${style.colorCss}`);
    if (style.bgCss) styleVars.push(`--drawio-chrome:${style.bgCss}`);
    const preview = !!options.preview;
    const modeClass = preview ? ' drawio-block--preview' : '';
    const fullscreenBtn = preview ? '' : (globalThis.NotesProGameFullscreen?.renderButton?.() || '');
    const xml = bytesToBase64(decodeFenceBody(source || ''));
    const stage = preview
      ? [
        '<p class="drawio-status" data-drawio-status>Rendering…</p>',
        `<img class="drawio-png" alt="${escapeHtml(title)}" title="Click to edit">`,
        '<iframe class="drawio-frame drawio-frame--export" title="" tabindex="-1" aria-hidden="true"></iframe>',
      ].join('')
      : `<iframe class="drawio-frame" title="${escapeHtml(title)}" allow="clipboard-read; clipboard-write" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    const header = preview ? '' : [
      '<div class="drawio-header">',
      `<div class="drawio-title">${escapeHtml(title)}</div>`,
      '<div class="drawio-status" data-drawio-status>Opening…</div>',
      '</div>',
    ].join('');
    return [
      `<div class="drawio-block${themeClass}${customClass}${fullClass}${modeClass}" style="${styleVars.map((v) => escapeHtml(v)).join(';')}"`,
      ` data-drawio-index="${drawioIndex}"`,
      ` data-drawio-mode="${preview ? 'preview' : 'edit'}"`,
      ` data-drawio-ui="${escapeHtml(ui)}"`,
      ` data-drawio-libs="${resolveLibs(cfg) ? '1' : '0'}"`,
      ` data-drawio-title="${escapeHtml(title)}">`,
      fullscreenBtn,
      header,
      '<div class="drawio-stage">',
      stage,
      '</div>',
      `<textarea class="drawio-store" hidden readonly>${xml}</textarea>`,
      '</div>',
    ].join('');
  }

  function sweepFrames() {
    frames.forEach((entry) => {
      if (!entry.frame.isConnected) {
        clearTimeout(entry.timer);
        clearTimeout(entry.openTimer);
        if (entry.watch) entry.watch.disconnect();
        frames.delete(entry);
      }
    });
  }

  function ensureListener() {
    if (listening || typeof window === 'undefined') return;
    listening = true;
    window.addEventListener('message', (event) => {
      frames.forEach((entry) => {
        if (!entry.frame.isConnected) {
          clearTimeout(entry.timer);
          clearTimeout(entry.openTimer);
          if (entry.watch) entry.watch.disconnect();
          frames.delete(entry);
          return;
        }
        if (event.source !== entry.frame.contentWindow) return;
        if (!isAllowedOrigin(event.origin)) return;
        entry.onMessage(event);
      });
    });
  }

  function parseMessage(data) {
    if (!data) return null;
    if (typeof data === 'string') {
      try { return JSON.parse(data); } catch (err) { return null; }
    }
    if (typeof data === 'object') return data;
    return null;
  }

  function downloadExport(msg, title) {
    const format = String(msg.format || 'xml').toLowerCase();
    const ext = format === 'xmlsvg' ? 'svg' : format.replace(/[^a-z0-9]+/g, '') || 'xml';
    const filename = `${String(title || 'diagram').replace(/[^\w.-]+/g, '_') || 'diagram'}.${ext}`;
    const data = msg.data == null ? '' : String(msg.data);
    const link = document.createElement('a');
    link.download = filename;
    if (data.startsWith('data:')) {
      link.href = data;
      link.click();
      return;
    }
    const type = ext === 'png' ? 'image/png' : ext === 'svg' ? 'image/svg+xml' : 'text/xml';
    const blob = new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function blockIsVisible(node) {
    if (!node || !node.isConnected) return false;
    let cur = node;
    while (cur && cur !== document.documentElement) {
      const style = getComputedStyle(cur);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      cur = cur.parentElement;
    }
    return true;
  }

  function showDiagramPng(el, frame, dataUrl) {
    const img = el.querySelector('.drawio-png');
    if (img && dataUrl) img.src = dataUrl;
    const statusEl = el.querySelector('[data-drawio-status]');
    if (statusEl) statusEl.textContent = '';
    if (frame?.isConnected) frame.remove();
  }

  function hydratePreview(el, frame, store) {
    ensureListener();
    sweepFrames();
    const stored = base64ToBytes(store.value || store.textContent || '');
    const xml = normalizeDiagramXml(stored || blankXml());
    const cached = pngCache.get(xml);
    if (cached) {
      showDiagramPng(el, frame, cached);
      return;
    }
    const cfg = {
      ui: el.dataset.drawioUi || DEFAULT_UI,
      libs: '0',
    };
    const statusEl = el.querySelector('[data-drawio-status]');
    let loaded = false;
    let exported = false;
    const entry = { frame, timer: 0, openTimer: 0, onMessage: () => {} };

    function post(message) {
      if (!frame.contentWindow) return;
      frame.contentWindow.postMessage(JSON.stringify(message), '*');
    }

    function loadDiagram() {
      if (loaded) return;
      loaded = true;
      post({ action: 'load', xml, autosave: 0 });
    }

    entry.onMessage = (event) => {
      if (event.data === 'ready') {
        loadDiagram();
        return;
      }
      const msg = parseMessage(event.data);
      if (!msg || !msg.event) return;
      if (msg.event === 'configure') {
        post({ action: 'configure', config: {} });
      } else if (msg.event === 'init') {
        loadDiagram();
      } else if (msg.event === 'load') {
        post({
          action: 'export',
          format: 'png',
          scale: 2,
          border: 8,
          background: '#ffffff',
        });
      } else if (msg.event === 'export') {
        const data = String(msg.data || '');
        if (!data.startsWith('data:image/')) return;
        exported = true;
        pngCache.set(xml, data);
        showDiagramPng(el, frame, data);
      }
    };

    frames.add(entry);

    let started = false;
    function openExport() {
      if (started || !el.isConnected || exported) return;
      if (!blockIsVisible(el)) return;
      started = true;
      if (entry.watch) entry.watch.disconnect();
      frame.src = embedUrl(cfg, false);
      entry.openTimer = setTimeout(() => {
        if (!exported && frame.isConnected && statusEl) statusEl.textContent = 'Could not render the diagram.';
      }, 30000);
    }

    if (typeof ResizeObserver !== 'undefined') {
      entry.watch = new ResizeObserver(openExport);
      entry.watch.observe(el);
    }
    openExport();
    if (!started) entry.openTimer = setTimeout(openExport, 400);
  }

  function hydrateBlock(el, options = {}) {
    if (!el || el.dataset.drawioBound === '1') return;
    const frame = el.querySelector('.drawio-frame');
    const store = el.querySelector('.drawio-store');
    if (!frame || !store) return;
    el.dataset.drawioBound = '1';
    if (el.dataset.drawioMode === 'preview' || options.preview) {
      hydratePreview(el, frame, store);
      return;
    }
    globalThis.NotesProGameFullscreen?.bind?.(el);
    ensureListener();
    sweepFrames();

    const editable = !!options.editable && typeof options.onPersist === 'function';
    const cfg = {
      ui: el.dataset.drawioUi || DEFAULT_UI,
      libs: el.dataset.drawioLibs === '0' ? '0' : '1',
    };
    const title = el.dataset.drawioTitle || 'Diagram';
    const statusEl = el.querySelector('[data-drawio-status]');
    const stored = normalizeDiagramXml(base64ToBytes(store.value || store.textContent || '') || blankXml());
    let lastXml = stored;
    let loaded = false;
    const entry = { frame, timer: 0, openTimer: 0, onMessage: () => {} };

    function setStatus(text) {
      if (statusEl) statusEl.textContent = text || '';
    }

    function post(message) {
      if (!frame.contentWindow) return;
      frame.contentWindow.postMessage(JSON.stringify(message), '*');
    }

    function loadDiagram() {
      if (loaded) return;
      loaded = true;
      clearTimeout(entry.openTimer);
      setStatus(editable ? '' : 'View only');
      post({
        action: 'load',
        xml: stored || blankXml(),
        autosave: editable ? 1 : 0,
      });
    }

    function acceptXml(xml) {
      const next = String(xml || '');
      if (!editable) {
        post({ action: 'status', message: 'View only', modified: false });
        return;
      }
      if (next.length > MAX_XML) {
        setStatus('Too large to save');
        post({ action: 'status', message: 'Too large to save', modified: true });
        return;
      }
      if (next.trim() === lastXml.trim()) {
        setStatus('Saved');
        post({ action: 'status', message: 'Saved', modified: false });
        return;
      }
      setStatus('Saving…');
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        lastXml = next;
        store.value = next;
        setStatus('Saved');
        post({ action: 'status', message: 'Saved', modified: false });
        options.onPersist({ xml: next });
      }, 400);
    }

    entry.onMessage = (event) => {
      if (event.data === 'ready') {
        loadDiagram();
        return;
      }
      const msg = parseMessage(event.data);
      if (!msg || !msg.event) return;
      if (msg.event === 'configure') {
        post({
          action: 'configure',
          config: resolveLibs(cfg) ? { defaultLibraries: 'general;uml;flowchart;basic' } : {},
        });
      } else if (msg.event === 'init') {
        loadDiagram();
      } else if (msg.event === 'save' || msg.event === 'autosave') {
        acceptXml(msg.xml);
      } else if (msg.event === 'export') {
        downloadExport(msg, title);
      } else if (msg.event === 'prompt') {
        post({ action: 'prompt', value: msg.defaultValue != null ? msg.defaultValue : '' });
      }
    };

    frames.add(entry);

    let started = false;
    function openEditor() {
      if (started || !el.isConnected) return;
      if (!blockIsVisible(el)) return;
      started = true;
      if (entry.watch) entry.watch.disconnect();
      frame.src = embedUrl(cfg, editable);
      entry.openTimer = setTimeout(() => {
        if (!loaded && frame.isConnected) setStatus('Draw.io did not open.');
      }, 30000);
    }

    if (typeof ResizeObserver !== 'undefined') {
      entry.watch = new ResizeObserver(openEditor);
      entry.watch.observe(el);
    }
    openEditor();
    if (!started) {
      entry.openTimer = setTimeout(openEditor, 400);
    }
  }

  function hydrate(root) {
    sweepFrames();
    (root || document).querySelectorAll('.drawio-block[data-drawio-index]').forEach((el) => hydrateBlock(el));
  }

  function selfTest() {
    const fails = [];
    function check(name, ok) {
      if (!ok) fails.push(name);
    }
    const blank = blankXml();
    check('blank xml', blank.includes('<mxfile') && blank.includes('<mxCell id="0"/>') && blank.includes('</mxfile>'));
    const html = renderBlock('<mxfile>Hi</mxfile>', 'title=Flow;ui=min;fullscreen=0;height=480', { drawioIndex: 2 });
    check('index', html.includes('data-drawio-index="2"'));
    check('title', html.includes('>Flow</div>'));
    check('frame', html.includes('class="drawio-frame"'));
    check('edit mode', html.includes('data-drawio-mode="edit"') && !html.includes('drawio-png'));
    const previewHtml = renderBlock('<mxfile>Hi</mxfile>', 'title=Flow', { preview: true });
    check('preview png', previewHtml.includes('drawio-block--preview') && previewHtml.includes('class="drawio-png"') && previewHtml.includes('data-drawio-mode="preview"'));
    check('preview hides editor chrome', !previewHtml.includes('drawio-header') && previewHtml.includes('drawio-frame--export'));
    check('ui', html.includes('data-drawio-ui="min"'));
    check('card mode', !html.includes('drawio-block--fullscreen'));
    check('stores xml', html.includes(bytesToBase64('<mxfile>Hi</mxfile>')) && !html.includes('\n'));
    check('height', html.includes('--drawio-h:480px'));
    const full = renderBlock('', '');
    check('fullscreen default', full.includes('drawio-block--fullscreen') && full.includes('data-drawio-ui="dark"'));
    const attrs = buildFenceAttrsString(parseFenceAttrs('height=10;ui=nope;fullscreen=0;libs=0;title=Map'));
    check('height floor', attrs.includes('height=320'));
    check('ui fallback', attrs.includes('ui=dark'));
    check('compact', !attrs.split(';').includes('fullscreen'));
    check('libs off', attrs.includes('libs=0'));
    check('title kept', attrs.includes('title=Map'));
    const tall = buildFenceAttrsString(parseFenceAttrs('height=9999'));
    check('height cap', tall.includes('height=1600') && tall.includes('fullscreen'));
    const url = embedUrl(parseFenceAttrs('ui=sketch;libs=0'), true);
    check('embed url', url.includes('/drawio/index.html?') && url.includes('embed=1') && url.includes('proto=json') && url.includes('offline=1') && url.includes('pwa=0') && !url.includes('diagrams.net'));
    check('save button', url.includes('noSaveBtn=0') && url.includes('ui=sketch') && url.includes('libraries=0') && url.includes('local=1') && !/[?&]libs=/.test(url));
    const locked = embedUrl(parseFenceAttrs(''), false);
    check('view only url', locked.includes('noSaveBtn=1') && locked.includes('dark=1'));
    const xml = '<mxfile>a```b</mxfile>';
    const encoded = encodeFenceBody(xml);
    check('hides fence break', !encoded.includes('```') && decodeFenceBody(encoded) === xml);
    const rewritten = rewriteFence('```drawio{title=Flow;ui=sketch}\n\n```', 0, { xml: '<mxfile>one</mxfile>' });
    check('rewrite keeps title', rewritten.includes('title=Flow') && rewritten.includes('ui=sketch'));
    check('rewrite stores xml', readFence(rewritten, 0)?.xml === '<mxfile>one</mxfile>');
    const pair = [
      '```drawio',
      '<mxfile>one</mxfile>',
      '```',
      '```diagrams.net{title=Second}',
      '<mxfile>two</mxfile>',
      '```',
    ].join('\n');
    const updated = rewriteFence(pair, 1, { xml: '<mxfile>TWO</mxfile>' });
    check('first block stays', readFence(updated, 0)?.xml === '<mxfile>one</mxfile>');
    check('second block updates', readFence(updated, 1)?.xml === '<mxfile>TWO</mxfile>');
    check('alias becomes drawio', updated.includes('```drawio{'));
    const escaped = rewriteFence('```draw.io\n\n```', 0, { xml });
    check('roundtrip backticks', readFence(escaped, 0)?.xml === xml);
    check('raw xml skips base64', base64ToBytes('<mxfile> a </mxfile>') === '<mxfile> a </mxfile>');
    check('bad base64 is empty', base64ToBytes('!!!!') === '');
    check('diagram payload is one line', normalizeDiagramXml('<mxfile><diagram id="d">\nabc\ndef\n</diagram></mxfile>') === '<mxfile><diagram id="d">abcdef</diagram></mxfile>');
    const nested = '<mxfile><diagram id="d"><mxGraphModel>\n<root></root>\n</mxGraphModel></diagram></mxfile>';
    check('nested model stays', normalizeDiagramXml(nested) === nested);
    return fails;
  }

  return {
    parseFenceAttrs,
    buildFenceAttrsString,
    blankXml,
    encodeFenceBody,
    decodeFenceBody,
    bytesToBase64,
    base64ToBytes,
    embedUrl,
    readFence,
    rewriteFence,
    renderBlock,
    hydrateBlock,
    hydrate,
    selfTest,
  };
}));

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  const fails = module.exports.selfTest();
  if (fails.length) {
    console.error(`drawio self-test failed (${fails.length}):`);
    fails.forEach((f) => console.error(' -', f));
    process.exit(1);
  }
  console.log('drawio self-test ok');
}
