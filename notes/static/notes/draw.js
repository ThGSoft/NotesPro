/**
 * NotesPro ```draw``` block — touch drawing pad.
 * Pen, eraser, and straight-line tools. Size, ink, and paper are saved on the fence.
 */
(function (root, factory) {
  const api = factory();
  root.NotesProDraw = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];
  const W = 960;
  const H = 540;
  const DEFAULT_PEN = '#1e293b';
  const DEFAULT_BG = '#fffef8';
  const DEFAULT_SIZE = 8;
  const MIN_SIZE = 1;
  const MAX_SIZE = 32;

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

  function expandHex(raw, fallback) {
    const value = String(raw || '').trim();
    const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
    if (!match) return fallback;
    const hex = match[1];
    if (hex.length === 3) {
      return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`.toLowerCase();
    }
    return `#${hex.toLowerCase()}`;
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

  function resolvePen(cfg) {
    return expandHex(cfg.pen || cfg.ink, DEFAULT_PEN);
  }

  function resolveBg(cfg) {
    return expandHex(cfg.bg || cfg.paper, DEFAULT_BG);
  }

  function clampSize(raw) {
    const value = Number(raw);
    if (!Number.isFinite(value)) return DEFAULT_SIZE;
    return Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(value)));
  }

  function resolveSize(cfg) {
    return clampSize(cfg.size || cfg.width || cfg.thick);
  }

  function buildFenceAttrsString(cfg) {
    const parts = [];
    if (resolveFullscreen(cfg)) parts.push('fullscreen');
    parts.push(`pen=${resolvePen(cfg)}`);
    parts.push(`bg=${resolveBg(cfg)}`);
    parts.push(`size=${resolveSize(cfg)}`);
    const title = String(cfg.title || '').trim().replace(/[;{}]/g, '');
    if (title) parts.push(`title=${title}`);
    const col = String(cfg.col || cfg.color || '').trim().replace(/[;{}]/g, '');
    if (col) parts.push(`col=${col}`);
    const bk = String(cfg.bkcol || cfg.bgcol || '').trim().replace(/[;{}]/g, '');
    if (bk) parts.push(`bkcol=${bk}`);
    return parts.join(';');
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  function parseStrokes(text) {
    const strokes = [];
    String(text || '').split(/\r?\n/).forEach((line) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) return;
      const erase = parts[0].toLowerCase() === 'erase';
      const color = erase ? 'erase' : expandHex(parts[0], '');
      const width = Number(parts[1]);
      if (!color || !Number.isFinite(width)) return;
      const points = [];
      parts.slice(2).forEach((pair) => {
        const bits = pair.split(',');
        const x = Number(bits[0]);
        const y = Number(bits[1]);
        if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
      });
      if (!points.length) return;
      strokes.push({
        color,
        erase,
        width: Math.max(1, Math.min(48, width)),
        points,
      });
    });
    return strokes;
  }

  function isErase(stroke) {
    return !!(stroke && (stroke.erase || stroke.color === 'erase'));
  }

  function strokeInk(stroke, bg) {
    return isErase(stroke) ? bg : stroke.color;
  }

  function serializeStrokes(strokes) {
    return strokes.map((stroke) => {
      const pts = stroke.points.map((p) => `${round1(p.x)},${round1(p.y)}`).join(' ');
      const ink = isErase(stroke) ? 'erase' : stroke.color;
      return `${ink} ${round1(stroke.width)} ${pts}`;
    }).join('\n');
  }

  function paint(ctx, strokes, bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    strokes.forEach((stroke) => drawStroke(ctx, stroke, bg));
  }

  function drawStroke(ctx, stroke, bg) {
    const pts = stroke.points;
    if (!pts.length) return;
    const ink = strokeInk(stroke, bg);
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, Math.max(1, stroke.width / 2), 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  function drawRulerGuide(ctx, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy);
    if (len < 12) return;
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1;
    const step = 40;
    for (let d = 0; d <= len; d += step) {
      const major = Math.round(d / step) % 5 === 0;
      const tick = major ? 16 : 8;
      const x = start.x + ux * d;
      const y = start.y + uy * d;
      ctx.beginPath();
      ctx.moveTo(x - px * tick, y - py * tick);
      ctx.lineTo(x + px * tick, y + py * tick);
      ctx.stroke();
    }
    ctx.restore();
  }

  function renderBlock(source, fenceAttrs, options = {}) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const style = resolveStyle(cfg);
    const title = String(cfg.title || 'Drawing').trim() || 'Drawing';
    const pen = resolvePen(cfg);
    const bg = resolveBg(cfg);
    const size = resolveSize(cfg);
    const drawIndex = Number.isFinite(options.drawIndex) ? options.drawIndex : 0;
    const fullscreen = resolveFullscreen(cfg);
    const themeClass = style.theme ? ` draw-block--${style.theme}` : '';
    const customClass = (style.colorCss || style.bgCss) ? ' draw-block--custom' : '';
    const fullClass = fullscreen ? ' draw-block--fullscreen' : '';
    const styleVars = [];
    if (style.colorCss) styleVars.push(`--draw-accent:${style.colorCss}`);
    if (style.bgCss) styleVars.push(`--draw-chrome:${style.bgCss}`);
    const styleAttr = styleVars.length ? ` style="${styleVars.map((v) => escapeHtml(v)).join(';')}"` : '';
    const chrome = fullscreen ? '' : [
      '<div class="draw-block-header">',
      `<div class="draw-block-title">${escapeHtml(title)}</div>`,
      '</div>',
    ].join('');
    return [
      `<div class="draw-block${themeClass}${customClass}${fullClass}"${styleAttr}`,
      ` data-draw-index="${drawIndex}"`,
      ` data-draw-pen="${pen}"`,
      ` data-draw-bg="${bg}"`,
      ` data-draw-size="${size}" tabindex="0">`,
      window.NotesProGameFullscreen?.renderButton?.() || '',
      chrome,
      '<div class="draw-toolbar" role="toolbar" aria-label="Drawing tools">',
      '<button type="button" class="btn btn-sm btn-outline-light is-active" data-action="tool" data-tool="pen" aria-pressed="true">Pen</button>',
      '<button type="button" class="btn btn-sm btn-outline-light" data-action="tool" data-tool="erase" aria-pressed="false">Eraser</button>',
      '<button type="button" class="btn btn-sm btn-outline-light" data-action="tool" data-tool="line" aria-pressed="false" title="Straight line">Ruler</button>',
      '<label class="draw-field">Size',
      `<input type="range" data-draw-size min="${MIN_SIZE}" max="${MAX_SIZE}" step="1" value="${size}" aria-label="Line thickness">`,
      `<span class="draw-size-label" data-draw-size-label>${size}</span>`,
      '</label>',
      '<label class="draw-field">Ink',
      `<input type="color" data-draw-pen value="${pen}" aria-label="Pen color">`,
      '</label>',
      '<label class="draw-field">Paper',
      `<input type="color" data-draw-bg value="${bg}" aria-label="Background color">`,
      '</label>',
      '<button type="button" class="btn btn-sm btn-outline-light" data-action="undo">Undo</button>',
      '<button type="button" class="btn btn-sm btn-outline-light" data-action="clear">Clear</button>',
      '</div>',
      '<div class="draw-stage">',
      `<canvas class="draw-canvas" width="${W}" height="${H}" aria-label="${escapeHtml(title)}"></canvas>`,
      '</div>',
      '<p class="draw-hint">Pen draws, Eraser rubs out, Ruler draws a straight line. Size sets the thickness.</p>',
      `<pre class="draw-store" hidden>${escapeHtml(String(source || '').trim())}</pre>`,
      '</div>',
    ].join('');
  }

  function localPoint(event, canvas) {
    const rect = canvas.getBoundingClientRect();
    const width = rect.width || W;
    const height = rect.height || H;
    return {
      x: Math.max(0, Math.min(W, ((event.clientX - rect.left) / width) * W)),
      y: Math.max(0, Math.min(H, ((event.clientY - rect.top) / height) * H)),
    };
  }

  function hydrateBlock(el, options = {}) {
    if (!el || el.dataset.drawHydrated === '1') return;
    el.dataset.drawHydrated = '1';
    window.NotesProGameFullscreen?.bind?.(el);
    const canvas = el.querySelector('.draw-canvas');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const editable = options.editable !== false;
    let tool = 'pen';
    let pen = expandHex(el.dataset.drawPen, DEFAULT_PEN);
    let bg = expandHex(el.dataset.drawBg, DEFAULT_BG);
    let width = clampSize(el.dataset.drawSize);
    let strokes = parseStrokes(el.querySelector('.draw-store')?.textContent || '');
    let lineDraft = null;
    const active = new Map();

    const penInput = el.querySelector('input[data-draw-pen]');
    const bgInput = el.querySelector('input[data-draw-bg]');
    const sizeInput = el.querySelector('input[data-draw-size]');
    const sizeLabel = el.querySelector('[data-draw-size-label]');
    if (sizeInput) width = clampSize(sizeInput.value);
    if (!editable) {
      el.querySelectorAll('input, button[data-action]').forEach((node) => {
        node.disabled = true;
      });
    }

    function applyTool() {
      el.querySelectorAll('[data-tool]').forEach((btn) => {
        const on = btn.dataset.tool === tool;
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      canvas.classList.toggle('draw-canvas--erase', tool === 'erase');
      canvas.classList.toggle('draw-canvas--line', tool === 'line');
    }

    function redraw() {
      paint(ctx, strokes, bg);
      if (!lineDraft) return;
      drawStroke(ctx, {
        color: lineDraft.color,
        width: lineDraft.width,
        points: [lineDraft.start, lineDraft.end],
      }, bg);
      drawRulerGuide(ctx, lineDraft.start, lineDraft.end);
    }

    function persist() {
      options.onPersist?.({ pen, bg, size: width, strokes: serializeStrokes(strokes) });
    }

    applyTool();
    redraw();

    canvas.addEventListener('pointerdown', (event) => {
      if (!editable || event.button > 0) return;
      event.preventDefault();
      const point = localPoint(event, canvas);
      if (tool === 'line') {
        if (lineDraft) return;
        lineDraft = { pointerId: event.pointerId, color: pen, width, start: point, end: point };
      } else {
        const erase = tool === 'erase';
        const stroke = { color: erase ? 'erase' : pen, erase, width, points: [point] };
        strokes.push(stroke);
        active.set(event.pointerId, stroke);
        drawStroke(ctx, stroke, bg);
      }
      try { canvas.setPointerCapture(event.pointerId); } catch (err) { /* synthetic events */ }
    });

    canvas.addEventListener('pointermove', (event) => {
      if (lineDraft && lineDraft.pointerId === event.pointerId) {
        event.preventDefault();
        lineDraft.end = localPoint(event, canvas);
        redraw();
        return;
      }
      const stroke = active.get(event.pointerId);
      if (!stroke) return;
      event.preventDefault();
      const point = localPoint(event, canvas);
      const prev = stroke.points[stroke.points.length - 1];
      if (Math.hypot(point.x - prev.x, point.y - prev.y) < 1.2) return;
      stroke.points.push(point);
      const ink = strokeInk(stroke, bg);
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = ink;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    });

    function endPointer(event) {
      if (lineDraft && lineDraft.pointerId === event.pointerId) {
        const draft = lineDraft;
        lineDraft = null;
        const a = draft.start;
        const b = draft.end;
        const pts = Math.hypot(b.x - a.x, b.y - a.y) < 1.2 ? [a] : [a, b];
        strokes.push({ color: draft.color, erase: false, width: draft.width, points: pts });
        redraw();
        persist();
        return;
      }
      if (!active.has(event.pointerId)) return;
      active.delete(event.pointerId);
      if (active.size === 0) persist();
    }
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);

    penInput?.addEventListener('input', () => {
      pen = expandHex(penInput.value, pen);
      el.dataset.drawPen = pen;
      persist();
    });
    bgInput?.addEventListener('input', () => {
      bg = expandHex(bgInput.value, bg);
      el.dataset.drawBg = bg;
      redraw();
      persist();
    });
    sizeInput?.addEventListener('input', () => {
      width = clampSize(sizeInput.value);
      el.dataset.drawSize = String(width);
      if (sizeLabel) sizeLabel.textContent = String(width);
      if (!active.size && !lineDraft) persist();
    });

    el.addEventListener('click', (event) => {
      const node = event.target.closest('[data-action]');
      const action = node?.dataset.action;
      if (!editable || !action || active.size || lineDraft) return;
      if (action === 'tool') {
        const next = node.dataset.tool;
        if (next !== 'pen' && next !== 'erase' && next !== 'line') return;
        tool = next;
        applyTool();
      } else if (action === 'undo') {
        strokes.pop();
        redraw();
        persist();
      } else if (action === 'clear') {
        strokes = [];
        redraw();
        persist();
      }
    });

    el.addEventListener('notespro:monitor-fullscreen', () => {
      window.requestAnimationFrame(redraw);
    });
  }

  function hydrate(root) {
    (root || document).querySelectorAll('.draw-block[data-draw-index]').forEach((el) => hydrateBlock(el));
  }

  function selfTest() {
    const fails = [];
    function check(name, ok) {
      if (!ok) fails.push(name);
    }
    const parsed = parseStrokes('#112233 6 10,20 30,40\n#ff0000 4 1,2');
    check('parses two strokes', parsed.length === 2 && parsed[0].points.length === 2 && parsed[1].points[0].x === 1);
    check('roundtrip', serializeStrokes(parsed).indexOf('10,20') > -1 && serializeStrokes(parsed).indexOf('#112233') === 0);
    check('ignores junk', parseStrokes('hello\n').length === 0);
    const erased = parseStrokes('erase 10 1,2 3,4');
    check('parses eraser', erased.length === 1 && erased[0].erase && erased[0].width === 10 && erased[0].points.length === 2);
    check('eraser roundtrip', serializeStrokes(erased) === 'erase 10 1,2 3,4');
    const html = renderBlock('#1e293b 8 10,10 80,10', 'fullscreen;pen=#ff0000;bg=#00ff00;size=14');
    check('canvas', html.indexOf('draw-canvas') > 0);
    check('pen input', html.indexOf('value="#ff0000"') > 0);
    check('paper input', html.indexOf('value="#00ff00"') > 0);
    check('size slider', html.indexOf('data-draw-size') > 0 && html.indexOf('value="14"') > 0);
    check('eraser tool', html.indexOf('data-tool="erase"') > 0);
    check('line tool', html.indexOf('data-tool="line"') > 0);
    check('stores strokes', html.indexOf('10,10') > 0);
    const attrs = buildFenceAttrsString(parseFenceAttrs('pen=#abc;bg=#fffef8;title=Sketch;size=14'));
    check('attrs keep colors', attrs.indexOf('pen=#aabbcc') > -1 && attrs.indexOf('bg=#fffef8') > -1 && attrs.indexOf('size=14') > -1);
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      paint(ctx, [{ color: '#ff0000', width: 12, points: [{ x: 40, y: 40 }] }], '#ffffff');
      const ink = ctx.getImageData(40, 40, 1, 1).data;
      const paper = ctx.getImageData(4, 4, 1, 1).data;
      check('dot uses pen color', ink[0] > 200 && ink[1] < 40);
      check('paper stays background', paper[0] > 240 && paper[1] > 240 && paper[2] > 240);
      paint(ctx, [
        { color: '#ff0000', width: 20, points: [{ x: 40, y: 40 }] },
        { color: 'erase', erase: true, width: 24, points: [{ x: 40, y: 40 }] },
      ], '#ffffff');
      const rubbed = ctx.getImageData(40, 40, 1, 1).data;
      check('eraser restores paper', rubbed[0] > 240 && rubbed[1] > 240 && rubbed[2] > 240);
    }
    return fails;
  }

  return {
    parseFenceAttrs,
    buildFenceAttrsString,
    parseStrokes,
    serializeStrokes,
    renderBlock,
    hydrateBlock,
    hydrate,
    selfTest,
  };
}));
