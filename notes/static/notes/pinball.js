/**
 * NotesPro ```pinball``` block — 3D Pinball Space Cadet (WebAssembly port).
 * @see https://github.com/lrusso/3DPinballSpaceCadet
 * @see https://github.com/alula/SpaceCadetPinball
 */
(function (root, factory) {
  const api = factory();
  root.NotesProPinball = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];
  const DEFAULT_EMBED = '/static/notes/vendor/space-cadet/embed.html';

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function parseFenceAttrs(attrs) {
    const config = {};
    String(attrs || '').split(';').forEach(pair => {
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
    const bgCss = sanitizeColor(cfg.bkcol || cfg.bgcol || cfg.bg || '');
    return { theme, colorCss, bgCss };
  }

  function resolveEmbedUrl(cfg) {
    const custom = String(cfg.src || cfg.url || '').trim();
    if (custom && /^https?:\/\//i.test(custom)) return custom;
    const script = document.querySelector('script[src*="pinball.js"]');
    if (script?.src) {
      return script.src.replace(/\/pinball\.js(\?.*)?$/i, '/vendor/space-cadet/embed.html');
    }
    return DEFAULT_EMBED;
  }

  function resolveFullscreen(cfg) {
    const raw = String(cfg.fullscreen ?? cfg.full ?? '1').trim().toLowerCase();
    if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'compact') return false;
    return true;
  }

  function renderFullscreenButton() {
    return window.NotesProGameFullscreen?.renderButton?.() || '';
  }

  function bindFullscreenButton(el) {
    window.NotesProGameFullscreen?.bind?.(el);
  }

  function buildSpec(cfg) {
    return {
      embedUrl: resolveEmbedUrl(cfg),
    };
  }

  function renderBlock(source, fenceAttrs, options = {}) {
    void source;
    const cfg = parseFenceAttrs(fenceAttrs);
    const style = resolveStyle(cfg);
    const spec = buildSpec(cfg);
    const pinballIndex = Number.isFinite(options.pinballIndex) ? options.pinballIndex : 0;
    const fullscreen = resolveFullscreen(cfg);
    const themeClass = style.theme ? ` pinball-block--${style.theme}` : '';
    const customClass = (style.colorCss || style.bgCss) ? ' pinball-block--custom' : '';
    const fullClass = fullscreen ? ' pinball-block--fullscreen' : '';
    const styleVars = [];
    if (style.colorCss) styleVars.push(`--pinball-accent:${style.colorCss}`);
    if (style.bgCss) styleVars.push(`--pinball-bg:${style.bgCss}`);
    const styleAttr = styleVars.length
      ? ` style="${styleVars.map(v => escapeHtml(v)).join(';')}"`
      : '';
    const specJson = escapeHtml(JSON.stringify({ embedUrl: spec.embedUrl }));
    const embedSrc = escapeHtml(spec.embedUrl);
    const title = String(cfg.title || '3D Pinball Space Cadet').trim() || '3D Pinball Space Cadet';
    const chrome = fullscreen ? '' : [
      `<div class="pinball-block-header">`,
      `<div class="pinball-block-title">${escapeHtml(title)}</div>`,
      `<div class="pinball-block-meta">3D Pinball Space Cadet</div>`,
      `</div>`,
      `<p class="pinball-block-hint">Click the table to focus · Z / ← left flipper · C / → right flipper · Space launch · R restart · T sound</p>`,
    ].join('');

    return [
      `<div class="pinball-block${themeClass}${customClass}${fullClass}"${styleAttr}`,
      ` data-pinball-index="${pinballIndex}"`,
      ` data-pinball-spec="${specJson}" tabindex="0">`,
      renderFullscreenButton(),
      chrome,
      `<div class="pinball-frame-wrap">`,
      `<iframe class="pinball-frame" src="${embedSrc}" title="${escapeHtml(title)}" loading="lazy" allow="autoplay; fullscreen" tabindex="0"></iframe>`,
      `</div>`,
      `<div class="pinball-status" aria-live="polite"></div>`,
      `</div>`,
    ].join('');
  }

  function setStatus(el, text) {
    const status = el.querySelector('.pinball-status');
    if (!status) return;
    status.textContent = text || '';
  }

  function hydrateBlock(el) {
    if (!el || el.dataset.pinballHydrated === '1') return;

    const frame = el.querySelector('.pinball-frame');
    if (!frame) return;

    el.dataset.pinballHydrated = '1';
    bindFullscreenButton(el);

    let spec;
    try {
      spec = JSON.parse(el.dataset.pinballSpec || '{}');
    } catch (_) {
      spec = {};
    }

    if (spec.embedUrl && !frame.getAttribute('src')) {
      frame.setAttribute('src', spec.embedUrl);
    }

    frame.addEventListener('load', () => setStatus(el, ''));
    frame.addEventListener('error', () => setStatus(el, 'Failed to load Space Cadet. Check your network connection.'));

    el.addEventListener('click', (e) => {
      if (e.target.closest('.game-fullscreen-btn')) return;
      if (e.target.closest('.pinball-frame-wrap')) {
        frame.focus({ preventScroll: true });
      }
    });

    el.addEventListener('notespro:monitor-fullscreen', (e) => {
      if (e.detail?.active) frame.focus({ preventScroll: true });
    });
  }

  function hydrate(root) {
    (root || document).querySelectorAll('.pinball-block[data-pinball-spec]').forEach(hydrateBlock);
  }

  return {
    parseFenceAttrs,
    renderBlock,
    hydrate,
    hydrateBlock,
  };
}));
