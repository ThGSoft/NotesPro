/**
 * NotesPro ```puzzle``` block — jigsaw via jqJigsawPuzzle.js
 */
(function (root, factory) {
  const api = factory();
  root.NotesProPuzzle = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];
  const PIECE_SIZES = new Set(['small', 'normal', 'big']);
  const DIFFICULTIES = new Set(['easy', 'medium', 'hard']);
  const DIFFICULTY_PIECES = {
    easy: 'big',
    medium: 'normal',
    hard: 'small',
  };

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

  function resolveMediaHref(href) {
    if (!href) return '';
    if (/^https?:\/\//i.test(href) || /^data:/i.test(href)) return href;
    const appBase = (typeof window !== 'undefined' && window.APP_BASE) ? String(window.APP_BASE).replace(/\/$/, '') : '';
    let path = String(href).replace(/\\/g, '/');
    if (/^media\//i.test(path)) {
      return appBase ? `${appBase}/${path}` : `/${path}`;
    }
    if (path.startsWith('/')) {
      return appBase && !path.startsWith(`${appBase}/`) ? `${appBase}${path}` : path;
    }
    return appBase ? `${appBase}/${path}` : `/${path}`;
  }

  function encodeSpec(spec) {
    try {
      return btoa(unescape(encodeURIComponent(JSON.stringify(spec))));
    } catch (_) {
      return '';
    }
  }

  function decodeSpec(raw) {
    try {
      return JSON.parse(decodeURIComponent(escape(atob(raw))));
    } catch (_) {
      return null;
    }
  }

  function parseImagePieces(source) {
    const pieces = [];
    const seen = new Set();
    const text = String(source || '');
    const mdImg = /!\[(.*?)\]\((.*?)\)/g;
    let match;
    while ((match = mdImg.exec(text)) !== null) {
      const src = match[2].trim();
      if (!src || seen.has(src)) continue;
      seen.add(src);
      pieces.push({ src, label: (match[1] || '').trim() });
    }
    if (pieces.length) return pieces;
    text.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      let src = '';
      if (trimmed.includes('|')) src = trimmed.split('|')[0].trim();
      else src = trimmed.replace(/^[-*]\s+/, '').trim();
      if (!src || seen.has(src)) return;
      seen.add(src);
      pieces.push({ src, label: '' });
    });
    return pieces;
  }

  function resolveImage(source, cfg) {
    const fromAttr = String(cfg.image || cfg.src || cfg.url || '').trim();
    if (fromAttr) return fromAttr;
    const pieces = parseImagePieces(source);
    return pieces[0]?.src || '';
  }

  function resolveDifficulty(cfg) {
    const raw = String(cfg.difficulty || cfg.level || 'medium').trim().toLowerCase();
    return DIFFICULTIES.has(raw) ? raw : 'medium';
  }

  function resolvePiecesSize(cfg) {
    const explicit = String(cfg.size || cfg.pieces || cfg.piecesize || '').trim().toLowerCase();
    if (PIECE_SIZES.has(explicit)) return explicit;
    return DIFFICULTY_PIECES[resolveDifficulty(cfg)] || 'normal';
  }

  function buildSpec(source, cfg) {
    const title = String(cfg.title || 'Jigsaw').trim() || 'Jigsaw';
    const image = resolveImage(source, cfg);
    const difficulty = resolveDifficulty(cfg);
    const piecesSize = resolvePiecesSize(cfg);
    const borderWidth = Math.max(0, Math.min(20, parseInt(cfg.border || cfg.borderwidth, 10) || 5));
    const state = parseStateFromBody(source) || parseStateString(cfg.state || '');
    return {
      mode: 'jigsaw',
      title,
      image,
      difficulty,
      piecesSize,
      borderWidth,
      state,
      draft: !image,
    };
  }

  function encodeStatePayload(payload) {
    try {
      const json = JSON.stringify(payload);
      return btoa(unescape(encodeURIComponent(json)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
    } catch (_) {
      return '';
    }
  }

  function parseStateString(raw) {
    const text = String(raw || '').trim();
    if (!text) return null;
    try {
      const padded = text.replace(/-/g, '+').replace(/_/g, '/');
      const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
      const json = decodeURIComponent(escape(atob(padded + pad)));
      const data = JSON.parse(json);
      if (!data || !Array.isArray(data.pos)) return null;
      return data;
    } catch (_) {
      return null;
    }
  }

  function parseStateFromBody(source) {
    const lines = String(source || '').split(/\r?\n/);
    let meta = null;
    const pieceLines = [];
    let inPieces = false;
    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const metaMatch = trimmed.match(/^#pieces\s+(\d+)x(\d+)\s+(\w+)(?:\s+(done))?$/i);
      if (metaMatch) {
        inPieces = true;
        meta = {
          w: parseInt(metaMatch[1], 10),
          h: parseInt(metaMatch[2], 10),
          size: metaMatch[3].toLowerCase(),
          done: !!metaMatch[4],
        };
        return;
      }
      if (!inPieces) return;
      if (trimmed.startsWith('#')) {
        inPieces = false;
        return;
      }
      const pieceMatch = trimmed.match(/^(\d+)x(\d+)\s+(-?\d+)\s+(-?\d+)(?:\s+(\d{4}))?$/);
      if (pieceMatch) {
        pieceLines.push({
          r: parseInt(pieceMatch[1], 10),
          c: parseInt(pieceMatch[2], 10),
          left: parseInt(pieceMatch[3], 10),
          top: parseInt(pieceMatch[4], 10),
          type: pieceMatch[5] || '1111',
        });
      }
    });
    if (!meta || !pieceLines.length) return null;
    let rows = 0;
    let cols = 0;
    pieceLines.forEach(p => {
      rows = Math.max(rows, p.r + 1);
      cols = Math.max(cols, p.c + 1);
    });
    if (rows * cols !== pieceLines.length) return null;
    const pos = new Array(rows * cols);
    const types = Array.from({ length: rows }, () => new Array(cols));
    pieceLines.forEach(p => {
      pos[p.r * cols + p.c] = [p.left, p.top];
      types[p.r][p.c] = p.type;
    });
    if (pos.some(p => !p)) return null;
    return {
      v: 2,
      size: meta.size,
      w: meta.w,
      h: meta.h,
      rows,
      cols,
      types,
      pos,
      done: meta.done ? 1 : 0,
    };
  }

  function formatStateBody(payload) {
    if (!payload || !Array.isArray(payload.pos) || !payload.rows || !payload.cols) return '';
    const lines = [
      `#pieces ${payload.w}x${payload.h} ${payload.size || 'normal'}${payload.done ? ' done' : ''}`,
    ];
    for (let r = 0; r < payload.rows; r += 1) {
      for (let c = 0; c < payload.cols; c += 1) {
        const pair = payload.pos[r * payload.cols + c];
        const type = payload.types?.[r]?.[c] || '1111';
        lines.push(`${r}x${c} ${pair[0]} ${pair[1]} ${type}`);
      }
    }
    return lines.join('\n');
  }

  function collectPieceState(jigsaw) {
    if (!jigsaw) return null;
    const pieces = [...jigsaw.querySelectorAll('div.piece')];
    if (!pieces.length) return null;
    const frame = jigsaw.querySelector('div.puzzle') || jigsaw;
    const w = Math.round(frame.clientWidth || frame.offsetWidth || 0);
    const h = Math.round(frame.clientHeight || frame.offsetHeight || 0);
    if (w <= 0 || h <= 0) return null;

    const byKey = new Map();
    let rows = 0;
    let cols = 0;
    pieces.forEach(piece => {
      const match = String(piece.id || '').match(/_piece_(\d+)x(\d+)$/);
      if (!match) return;
      const r = parseInt(match[1], 10);
      const c = parseInt(match[2], 10);
      rows = Math.max(rows, r + 1);
      cols = Math.max(cols, c + 1);
      const typeClass = [...piece.classList].find(cls => /^piece_\d{4}$/.test(cls));
      byKey.set(`${r}x${c}`, {
        left: parseFloat(piece.style.left) || 0,
        top: parseFloat(piece.style.top) || 0,
        type: typeClass ? typeClass.slice('piece_'.length) : null,
      });
    });
    if (!rows || !cols || byKey.size !== rows * cols) return null;

    const pos = [];
    const types = [];
    for (let r = 0; r < rows; r += 1) {
      const typeRow = [];
      for (let c = 0; c < cols; c += 1) {
        const item = byKey.get(`${r}x${c}`);
        pos.push([Math.round(item.left), Math.round(item.top)]);
        typeRow.push(item.type || '1111');
      }
      types.push(typeRow);
    }

    const sizeClass = [...pieces[0].classList].find(cls => cls === 'small' || cls === 'normal' || cls === 'big') || 'normal';
    return {
      v: 2,
      size: sizeClass,
      w,
      h,
      rows,
      cols,
      types,
      pos,
      done: jigsaw.classList.contains('resolved') ? 1 : 0,
    };
  }

  function serializeState(jigsaw) {
    return collectPieceState(jigsaw);
  }

  function applyPieceState(jigsaw, state) {
    if (!jigsaw || !state || !Array.isArray(state.pos)) return false;
    const pieces = [...jigsaw.querySelectorAll('div.piece')];
    if (!pieces.length) return false;
    if (state.rows && state.cols && pieces.length !== state.rows * state.cols) return false;
    if (state.pos.length !== pieces.length) return false;
    const frame = jigsaw.querySelector('div.puzzle') || jigsaw;
    const curW = frame.clientWidth || frame.offsetWidth || state.w || 1;
    const curH = frame.clientHeight || frame.offsetHeight || state.h || 1;
    const scaleX = state.w ? (curW / state.w) : 1;
    const scaleY = state.h ? (curH / state.h) : 1;
    let located = 0;
    const total = pieces.length;

    pieces.forEach(piece => {
      const match = String(piece.id || '').match(/_piece_(\d+)x(\d+)$/);
      if (!match) return;
      const r = parseInt(match[1], 10);
      const c = parseInt(match[2], 10);
      const cols = state.cols || Math.round(Math.sqrt(state.pos.length)) || 1;
      const idx = r * cols + c;
      const saved = state.pos[idx];
      if (!saved) return;
      const left = Math.round(saved[0] * scaleX);
      const top = Math.round(saved[1] * scaleY);
      piece.style.left = `${left}px`;
      piece.style.top = `${top}px`;

      const posX = parseInt(piece.getAttribute('data-posX'), 10);
      const posY = parseInt(piece.getAttribute('data-posY'), 10);
      if (Number.isFinite(posX) && Number.isFinite(posY)
          && Math.abs(left - posX) < 2 && Math.abs(top - posY) < 2) {
        piece.style.left = `${posX}px`;
        piece.style.top = `${posY}px`;
        located += 1;
      }
    });

    const $jigsaw = window.jQuery?.(jigsaw);
    if ($jigsaw) {
      $jigsaw.data('pieces-located', located);
      $jigsaw.data('pieces-number', total);
    }
    if (located >= total || state.done) {
      jigsaw.classList.add('resolved');
    } else {
      jigsaw.classList.remove('resolved');
    }
    return true;
  }

  function formatPuzzleBody(image, label, statePayload) {
    const parts = [];
    if (image) {
      const alt = label || 'Jigsaw image';
      parts.push(`![${alt}](${image})`);
    }
    const stateBody = formatStateBody(statePayload);
    if (stateBody) {
      if (parts.length) parts.push('');
      parts.push(stateBody);
    }
    return parts.join('\n');
  }

  function buildFenceAttrsString(cfg, extra = {}) {
    const merged = { ...cfg, ...extra };
    const parts = [];
    Object.entries(merged).forEach(([key, value]) => {
      if (value == null || value === '') return;
      // Piece layout lives in the fence body (#pieces), not attrs.
      if (key === 'draft' || key === 'mode' || key === 'state') return;
      parts.push(`${key}=${value}`);
    });
    return parts.join(';');
  }

  function buildJqOptions(spec, hooks = {}) {
    const options = {
      piecesSize: spec.piecesSize || 'normal',
      borderWidth: spec.borderWidth != null ? spec.borderWidth : 5,
    };
    if (spec.shuffleLimits) {
      options.shuffle = spec.shuffleLimits;
    }
    if (spec.state?.pos?.length) {
      options.skipShuffle = true;
      if (spec.state.types
          && (!spec.state.size || spec.state.size === (spec.piecesSize || 'normal'))) {
        options.pieceTypes = spec.state.types;
      }
    }
    if (typeof hooks.onReady === 'function') options.onReady = hooks.onReady;
    if (typeof hooks.onShuffle === 'function') options.onShuffle = hooks.onShuffle;
    if (typeof hooks.onPieceStop === 'function') options.onPieceStop = hooks.onPieceStop;
    return options;
  }

  function resolveFullscreen(cfg) {
    const raw = String(cfg.fullscreen ?? cfg.full ?? '1').trim().toLowerCase();
    if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'compact') return false;
    return true;
  }

  function syncPuzzlePanelSize(el) {
    const mount = el.querySelector('.puzzle-jq-mount');
    const jigsaw = mount?.querySelector('.jigsaw');
    if (!mount || !jigsaw) return;
    if (el.classList.contains('puzzle-block--fullscreen')) {
      mount.style.width = '100%';
      el.style.width = '';
      el.style.maxWidth = '';
      return;
    }
    const rect = jigsaw.getBoundingClientRect();
    const w = Math.ceil(rect.width);
    if (w > 0) {
      mount.style.width = `${w}px`;
      el.style.width = `${w + 32}px`;
      el.style.maxWidth = '100%';
    }
  }

  function renderPasteZone(label) {
    return `<div class="puzzle-paste-zone" tabindex="0" role="button" aria-label="Paste image">`
      + `<span class="puzzle-paste-icon" aria-hidden="true">🧩</span>`
      + `<span class="puzzle-paste-label">${escapeHtml(label || 'Paste image here (Ctrl+V)')}</span>`
      + `</div>`;
  }

  function renderFullscreenButton() {
    return window.NotesProGameFullscreen?.renderButton?.() || '';
  }

  function bindFullscreenButton(el) {
    window.NotesProGameFullscreen?.bind?.(el);
  }

  function renderBlock(source, fenceAttrs, options = {}) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const style = resolveStyle(cfg);
    const spec = buildSpec(source, cfg);
    const puzzleIndex = Number.isFinite(options.puzzleIndex) ? options.puzzleIndex : 0;
    const editable = options.editable !== false;
    const fullscreen = resolveFullscreen(cfg);
    const themeClass = style.theme ? ` puzzle-block--${style.theme}` : '';
    const customClass = (style.colorCss || style.bgCss) ? ' puzzle-block--custom' : '';
    const fullClass = fullscreen ? ' puzzle-block--fullscreen' : '';
    const styleVars = [];
    if (style.colorCss) styleVars.push(`--puzzle-accent:${style.colorCss}`);
    if (style.bgCss) styleVars.push(`--puzzle-bg:${style.bgCss}`);
    const styleAttr = styleVars.length
      ? ` style="${styleVars.map(v => escapeHtml(v)).join(';')}"`
      : '';
    const encoded = encodeSpec(spec);
    const modeLabel = spec.draft
      ? `${spec.difficulty} · paste image`
      : `${spec.difficulty} · drag to solve`;
    const board = spec.draft
      ? renderPasteZone('Paste an image to create a jigsaw (Ctrl+V)')
      : `<div class="puzzle-jq-mount" data-puzzle-mount="${puzzleIndex}"></div>`;
    const hint = spec.draft
      ? (editable ? 'Paste one image — jqJigsawPuzzle will cut it into interlocking pieces.' : 'Add an image in markdown or paste when editing.')
      : 'Drag pieces into place. Snapping happens when a piece is near its slot.';
    const actions = spec.draft ? '' : [
      `<div class="puzzle-actions">`,
      `<button type="button" class="btn btn-sm btn-outline-light puzzle-action" data-action="check">Check</button>`,
      `<button type="button" class="btn btn-sm btn-outline-secondary puzzle-action" data-action="reset">Reset</button>`,
      `</div>`,
    ].join('');
    const chrome = fullscreen ? '' : [
      `<div class="puzzle-block-header">`,
      `<div class="puzzle-block-title">${escapeHtml(spec.title)}</div>`,
      `<div class="puzzle-block-meta">${escapeHtml(modeLabel)}</div>`,
      `</div>`,
      `<p class="puzzle-block-hint">${escapeHtml(hint)}</p>`,
    ].join('');
    return [
      `<div class="puzzle-block${themeClass}${customClass}${fullClass}${editable ? ' puzzle-block--editable' : ''}${spec.draft ? ' puzzle-block--draft' : ''}"${styleAttr}`,
      ` data-puzzle-index="${puzzleIndex}"`,
      ` data-puzzle-spec="${escapeHtml(encoded)}" tabindex="0">`,
      renderFullscreenButton(),
      chrome,
      `<div class="puzzle-play-area">`,
      board,
      actions,
      `</div>`,
      `<div class="puzzle-status" aria-live="polite"></div>`,
      `</div>`,
    ].join('');
  }

  function setStatus(el, text, kind) {
    const status = el.querySelector('.puzzle-status');
    if (!status) return;
    status.textContent = text || '';
    status.className = 'puzzle-status' + (kind ? ` puzzle-status--${kind}` : '');
  }

  function getJigsawRoot(el) {
    return el.querySelector('.puzzle-jq-mount .jigsaw');
  }

  function jqReady() {
    return typeof window.jQuery !== 'undefined'
      && typeof window.jQuery.fn !== 'undefined'
      && typeof window.jQuery.fn.draggable === 'function'
      && typeof window.jqJigsawPuzzle !== 'undefined';
  }

  function destroyJqPuzzle(mount) {
    if (!mount) return;
    mount.querySelectorAll('.jigsaw').forEach(node => node.remove());
    mount.querySelectorAll('img').forEach(node => node.remove());
    mount.innerHTML = '';
  }

  function initJqPuzzle(el, spec, hooks = {}, attempt = 0) {
    const mount = el.querySelector('.puzzle-jq-mount');
    if (!mount || !spec.image) return;
    if (!jqReady()) {
      setStatus(el, 'Jigsaw engine not loaded (jQuery UI + jqJigsawPuzzle.js).', 'warn');
      return;
    }
    const parentW = el.parentElement?.clientWidth || 0;
    if (parentW <= 0 && attempt < 12) {
      window.requestAnimationFrame(() => initJqPuzzle(el, spec, hooks, attempt + 1));
      return;
    }
    destroyJqPuzzle(mount);
    const imageUrl = resolveMediaHref(spec.image);
    const options = buildJqOptions(spec, {
      onReady: (piecesContainer) => {
        const jigsaw = piecesContainer?.[0] || getJigsawRoot(el);
        if (!jigsaw) return;
        jigsaw.classList.add('jigsaw--embedded');
        const menu = jigsaw.querySelector('.menu');
        if (menu) menu.setAttribute('aria-hidden', 'true');
        if (spec.state) {
          const restored = applyPieceState(jigsaw, spec.state);
          if (!restored && typeof window.jqJigsawPuzzle?.shufflePieces === 'function') {
            window.jqJigsawPuzzle.shufflePieces(jigsaw);
            const $jigsaw = window.jQuery?.(jigsaw);
            if ($jigsaw) $jigsaw.data('pieces-located', 0);
            jigsaw.classList.remove('resolved');
          } else if (jigsaw.classList.contains('resolved')) {
            setStatus(el, 'Complete!', 'success');
          }
        }
        syncPuzzlePanelSize(el);
        if (typeof hooks.onReady === 'function') hooks.onReady(jigsaw);
      },
      onShuffle: () => {
        if (typeof hooks.onShuffle === 'function') hooks.onShuffle();
      },
      onPieceStop: () => {
        if (typeof hooks.onPieceStop === 'function') hooks.onPieceStop();
      },
    });
    window.jqJigsawPuzzle.createPuzzleFromURL(mount, imageUrl, options);
    setStatus(el, '');
  }

  function resetJqPuzzle(el, hooks = {}) {
    const jigsaw = getJigsawRoot(el);
    if (!jigsaw) return;
    const shuffleBtn = jigsaw.querySelector('a.button[id$="_shuffle"]');
    if (shuffleBtn) {
      shuffleBtn.click();
      setStatus(el, '');
      if (typeof hooks.onReset === 'function') hooks.onReset();
      return;
    }
    if (typeof window.jqJigsawPuzzle?.shufflePieces === 'function') {
      window.jqJigsawPuzzle.shufflePieces(jigsaw);
      jigsaw.classList.remove('resolved', 'highlight');
      const $jigsaw = window.jQuery?.(jigsaw);
      if ($jigsaw) $jigsaw.data('pieces-located', 0);
      setStatus(el, '');
      if (typeof hooks.onReset === 'function') hooks.onReset();
    }
  }

  function checkJqPuzzle(el) {
    const jigsaw = getJigsawRoot(el);
    if (!jigsaw) {
      setStatus(el, 'Puzzle not ready yet.', 'info');
      return;
    }
    if (jigsaw.classList.contains('resolved')) {
      setStatus(el, 'Complete!', 'success');
      return;
    }
    const $jigsaw = window.jQuery?.(jigsaw);
    const placed = parseInt($jigsaw?.data('pieces-located'), 10);
    const totalPieces = parseInt($jigsaw?.data('pieces-number'), 10);
    if (Number.isFinite(totalPieces) && Number.isFinite(placed)) {
      const left = Math.max(0, totalPieces - placed);
      if (left) {
        setStatus(el, `${left} piece${left === 1 ? '' : 's'} still to place.`, 'info');
        return;
      }
    }
    setStatus(el, 'Not complete yet — keep placing pieces.', 'warn');
  }

  function hydrateBlock(el, options = {}) {
    if (!el || el.dataset.puzzleHydrated === '1') return;
    const spec = decodeSpec(el.dataset.puzzleSpec);
    if (!spec) return;
    el.dataset.puzzleHydrated = '1';
    bindFullscreenButton(el);
    el.addEventListener('notespro:monitor-fullscreen', () => {
      window.requestAnimationFrame(() => syncPuzzlePanelSize(el));
    });

    let persistTimer = null;
    function schedulePersist(clear) {
      if (typeof options.onPersist !== 'function') return;
      clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        if (clear) {
          options.onPersist({ clearState: true });
          return;
        }
        const jigsaw = getJigsawRoot(el);
        const payload = serializeState(jigsaw);
        if (!payload) return;
        options.onPersist({ statePayload: payload });
      }, 300);
    }

    function wirePersistence(jigsaw) {
      if (!jigsaw) return;
      const observer = new MutationObserver(() => {
        if (jigsaw.classList.contains('resolved')) {
          setStatus(el, 'Complete!', 'success');
          schedulePersist(false);
        }
      });
      observer.observe(jigsaw, { attributes: true, attributeFilter: ['class'] });
    }

    if (!spec.draft) {
      const start = () => initJqPuzzle(el, spec, {
        onReady: wirePersistence,
        onShuffle: () => schedulePersist(true),
        onPieceStop: () => schedulePersist(false),
      });
      if (jqReady()) {
        start();
      } else {
        const retry = () => {
          if (!el.isConnected) return;
          if (jqReady()) start();
          else window.setTimeout(retry, 120);
        };
        retry();
      }
    }

    el.addEventListener('click', e => {
      const pasteZone = e.target.closest('.puzzle-paste-zone');
      if (pasteZone) {
        pasteZone.focus();
        return;
      }
      const btn = e.target.closest('[data-action]');
      if (!btn || !el.contains(btn)) return;
      if (btn.dataset.action === 'check') checkJqPuzzle(el);
      if (btn.dataset.action === 'reset') {
        resetJqPuzzle(el, { onReset: () => schedulePersist(true) });
      }
    });

    if (typeof options.onPasteImage !== 'function') return;

    async function handlePasteFiles(files) {
      const imageFiles = [...files].filter(f => f && String(f.type || '').startsWith('image/'));
      if (!imageFiles.length) return;
      el.classList.add('puzzle-block--uploading');
      try {
        await options.onPasteImage(imageFiles[0], spec);
      } finally {
        el.classList.remove('puzzle-block--uploading');
      }
    }

    el.addEventListener('paste', e => {
      const items = [...(e.clipboardData?.items || [])];
      const files = items
        .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
        .map(item => item.getAsFile())
        .filter(Boolean);
      if (!files.length) return;
      e.preventDefault();
      e.stopPropagation();
      void handlePasteFiles(files);
    });

    el.querySelectorAll('.puzzle-paste-zone').forEach(zone => {
      zone.addEventListener('dragover', e => {
        e.preventDefault();
        zone.classList.add('puzzle-paste-zone--hover');
      });
      zone.addEventListener('dragleave', () => {
        zone.classList.remove('puzzle-paste-zone--hover');
      });
      zone.addEventListener('drop', e => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.remove('puzzle-paste-zone--hover');
        void handlePasteFiles([...(e.dataTransfer?.files || [])].filter(f => f.type.startsWith('image/')));
      });
    });
  }

  function hydrate(root) {
    (root || document).querySelectorAll('.puzzle-block[data-puzzle-spec]').forEach(hydrateBlock);
  }

  return {
    parseFenceAttrs,
    parseImagePieces,
    parseStateString,
    parseStateFromBody,
    formatStateBody,
    serializeState,
    buildSpec,
    decodeSpec,
    formatPuzzleBody,
    buildFenceAttrsString,
    resolveImage,
    renderBlock,
    hydrate,
    hydrateBlock,
  };
}));
