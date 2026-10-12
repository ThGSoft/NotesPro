/**
 * NotesPro ```draw``` block — touch drawing pad.
 * Pen, eraser, straight-line, and text tools. Size, ink, and paper are saved on the fence.
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

  function fontSize(size) {
    return Math.max(12, Math.min(96, 8 + clampSize(size) * 2));
  }

  function clampAngle(raw) {
    const value = Number(raw);
    if (!Number.isFinite(value)) return 0;
    const step = Math.round(value / 45) * 45;
    return ((step % 360) + 360) % 360;
  }

  function parseStrokes(text) {
    const strokes = [];
    String(text || '').split(/\r?\n/).forEach((line) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) return;
      if (parts[0].toLowerCase() === 'text') {
        if (parts.length < 5) return;
        const color = expandHex(parts[1], '');
        const size = Number(parts[2]);
        const bits = parts[3].split(',');
        const x = Number(bits[0]);
        const y = Number(bits[1]);
        const label = parts.slice(4).join(' ').replace(/[`{}]/g, '').trim();
        if (!color || !label || !Number.isFinite(size) || !Number.isFinite(x) || !Number.isFinite(y)) return;
        strokes.push({
          kind: 'text',
          color,
          erase: false,
          width: Math.max(8, Math.min(128, size)),
          angle: clampAngle(bits[2]),
          points: [{ x, y }],
          text: label,
        });
        return;
      }
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
      if (stroke.kind === 'text') {
        const point = stroke.points[0] || { x: 0, y: 0 };
        const label = String(stroke.text || '').replace(/[\r\n`{}]+/g, ' ').trim();
        const angle = clampAngle(stroke.angle);
        const at = angle ? `${round1(point.x)},${round1(point.y)},${angle}` : `${round1(point.x)},${round1(point.y)}`;
        return `text ${stroke.color} ${round1(stroke.width)} ${at} ${label}`;
      }
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
    if (stroke.kind === 'text') {
      const angle = clampAngle(stroke.angle);
      ctx.save();
      ctx.font = `600 ${stroke.width}px system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      ctx.translate(pts[0].x, pts[0].y);
      if (angle) ctx.rotate(angle * Math.PI / 180);
      ctx.fillText(stroke.text, 0, 0);
      ctx.restore();
      return;
    }
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
      '<div class="draw-toolbar">',
      '<button type="button" class="btn btn-sm btn-outline-light draw-tools-btn" data-action="tools" aria-expanded="false" aria-haspopup="true" title="Drawing tools">Tools</button>',
      '<div class="draw-tools-pop" role="toolbar" aria-label="Drawing tools" hidden>',
      '<button type="button" class="btn btn-sm btn-outline-light is-active" data-action="tool" data-tool="pen" aria-pressed="true">Pen</button>',
      '<button type="button" class="btn btn-sm btn-outline-light" data-action="tool" data-tool="erase" aria-pressed="false">Eraser</button>',
      '<button type="button" class="btn btn-sm btn-outline-light" data-action="tool" data-tool="line" aria-pressed="false" title="Straight line">Ruler</button>',
      '<button type="button" class="btn btn-sm btn-outline-light" data-action="tool" data-tool="text" aria-pressed="false" title="Place text">Text</button>',
      '<label class="draw-field">Angle',
      '<select data-draw-angle aria-label="Text angle">',
      '<option value="0">0°</option>',
      '<option value="45">45°</option>',
      '<option value="90">90°</option>',
      '<option value="135">135°</option>',
      '<option value="180">180°</option>',
      '<option value="225">225°</option>',
      '<option value="270">270°</option>',
      '<option value="315">315°</option>',
      '</select>',
      '</label>',
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
      '</div>',
      '<div class="draw-stage">',
      `<canvas class="draw-canvas" width="${W}" height="${H}" aria-label="${escapeHtml(title)}"></canvas>`,
      '</div>',
      '<p class="draw-hint">Pen draws, Eraser rubs out, Ruler draws a straight line, Text places a label. Drag the text box to move it. Angle turns the label in steps of 45°. Size sets the thickness or the text size.</p>',
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
    const stage = el.querySelector('.draw-stage');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !stage) return;
    const textPop = document.createElement('div');
    textPop.className = 'draw-text-pop';
    textPop.hidden = true;
    const textGrip = document.createElement('button');
    textGrip.type = 'button';
    textGrip.className = 'draw-text-move';
    textGrip.setAttribute('aria-label', 'Move text');
    textGrip.title = 'Drag to move';
    textGrip.textContent = '⋮⋮';
    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.className = 'draw-text-input';
    textInput.maxLength = 120;
    textInput.setAttribute('aria-label', 'Drawing text');
    textInput.placeholder = 'Text';
    textInput.autocomplete = 'off';
    textPop.append(textGrip, textInput);
    el.appendChild(textPop);
    let textAt = null;
    let textGen = 0;
    let textHold = false;
    let textDrag = null;
    const editable = options.editable !== false;
    let tool = 'pen';
    let textAngle = 0;
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
    const angleInput = el.querySelector('select[data-draw-angle]');
    if (sizeInput) width = clampSize(sizeInput.value);
    if (!editable) {
      el.querySelectorAll('input, button[data-action]').forEach((node) => {
        node.disabled = true;
      });
    }

    const toolsPop = el.querySelector('.draw-tools-pop');
    const toolsBtn = el.querySelector('[data-action="tools"]');

    function setToolsOpen(open) {
      if (!toolsPop || !toolsBtn) return;
      toolsPop.hidden = !open;
      toolsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      toolsBtn.classList.toggle('is-active', open);
    }

    function applyTool() {
      el.querySelectorAll('[data-tool]').forEach((btn) => {
        const on = btn.dataset.tool === tool;
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      canvas.classList.toggle('draw-canvas--erase', tool === 'erase');
      canvas.classList.toggle('draw-canvas--line', tool === 'line');
      canvas.classList.toggle('draw-canvas--text', tool === 'text');
    }

    function placeTextBox(point) {
      const canvasRect = canvas.getBoundingClientRect();
      const hostRect = el.getBoundingClientRect();
      const scaleX = (canvasRect.width || W) / W;
      const scaleY = (canvasRect.height || H) / H;
      const fontPx = Math.max(16, Math.min(72, fontSize(width) * Math.min(scaleX, scaleY)));
      textInput.style.fontSize = `${fontPx}px`;
      textInput.style.color = pen;
      textInput.style.background = bg;
      textInput.style.borderColor = pen;
      textPop.style.color = pen;
      const boxW = Math.min(280, Math.max(160, hostRect.width - 8));
      textPop.style.width = `${boxW}px`;
      const boxH = textPop.offsetHeight || (fontPx + 18);
      let left = (canvasRect.left - hostRect.left) + point.x * scaleX;
      let top = (canvasRect.top - hostRect.top) + point.y * scaleY;
      left = Math.max(4, Math.min(left, hostRect.width - boxW - 4));
      top = Math.max(4, Math.min(top, hostRect.height - boxH - 4));
      textPop.style.left = `${left}px`;
      textPop.style.top = `${top}px`;
      textAt = {
        x: Math.max(0, Math.min(W, (left - (canvasRect.left - hostRect.left)) / scaleX)),
        y: Math.max(0, Math.min(H, (top - (canvasRect.top - hostRect.top)) / scaleY)),
      };
      stage.scrollLeft = 0;
      stage.scrollTop = 0;
    }

    function hideTextField() {
      textHold = false;
      textDrag = null;
      textPop.hidden = true;
      textAt = null;
      el.classList.remove('draw-block--texting');
    }

    function commitText() {
      if (textPop.hidden) return;
      const value = textInput.value.replace(/[\r\n`{}]+/g, ' ').trim();
      const point = textAt;
      hideTextField();
      if (!value || !point) return;
      strokes.push({
        kind: 'text',
        color: pen,
        erase: false,
        width: fontSize(width),
        angle: textAngle,
        points: [point],
        text: value,
      });
      redraw();
      persist();
    }

    function openText(point) {
      textGen += 1;
      if (!textPop.hidden) commitText();
      textAt = point;
      textInput.value = '';
      textPop.hidden = false;
      el.classList.add('draw-block--texting');
      placeTextBox(point);
      textHold = true;
      textInput.focus({ preventScroll: true });
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
      setToolsOpen(false);
      const point = localPoint(event, canvas);
      if (tool === 'text') {
        if (event.pointerType !== 'touch') event.preventDefault();
        event.stopPropagation();
        openText(point);
        return;
      }
      event.preventDefault();
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
    textInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitText();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        textGen += 1;
        textInput.value = '';
        hideTextField();
      }
    });
    textGrip.addEventListener('pointerdown', (event) => {
      if (event.button > 0 || textPop.hidden) return;
      event.preventDefault();
      event.stopPropagation();
      const hostRect = el.getBoundingClientRect();
      textDrag = {
        pointerId: event.pointerId,
        dx: event.clientX - hostRect.left - textPop.offsetLeft,
        dy: event.clientY - hostRect.top - textPop.offsetTop,
      };
      textHold = true;
      try { textGrip.setPointerCapture(event.pointerId); } catch (err) { /* synthetic events */ }
    });
    textGrip.addEventListener('pointermove', (event) => {
      if (!textDrag || textDrag.pointerId !== event.pointerId) return;
      event.preventDefault();
      const hostRect = el.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      const scaleX = (canvasRect.width || W) / W;
      const scaleY = (canvasRect.height || H) / H;
      const left = event.clientX - hostRect.left - textDrag.dx;
      const top = event.clientY - hostRect.top - textDrag.dy;
      placeTextBox({
        x: (left - (canvasRect.left - hostRect.left)) / scaleX,
        y: (top - (canvasRect.top - hostRect.top)) / scaleY,
      });
    });
    function endTextDrag(event) {
      if (!textDrag || textDrag.pointerId !== event.pointerId) return;
      textDrag = null;
      textHold = false;
      textInput.focus({ preventScroll: true });
    }
    textGrip.addEventListener('pointerup', endTextDrag);
    textGrip.addEventListener('pointercancel', endTextDrag);
    textInput.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
    });
    textInput.addEventListener('blur', () => {
      const gen = textGen;
      window.setTimeout(() => {
        if (gen !== textGen || textPop.hidden) return;
        const active = document.activeElement;
        if (active === textInput) return;
        if (textDrag || textHold || (active && el.contains(active))) {
          textInput.focus({ preventScroll: true });
          return;
        }
        commitText();
      }, 30);
    });
    window.addEventListener('pointerup', () => {
      if (!textHold) return;
      window.setTimeout(() => {
        textHold = false;
        if (!textPop.hidden && document.activeElement !== textInput) {
          textInput.focus({ preventScroll: true });
        }
      }, 0);
    });
    window.addEventListener('pointercancel', () => {
      textHold = false;
    });

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
      if (!textPop.hidden && textAt) placeTextBox(textAt);
      if (!active.size && !lineDraft) persist();
    });
    angleInput?.addEventListener('change', () => {
      textAngle = clampAngle(angleInput.value);
      if (!textPop.hidden && textAt) placeTextBox(textAt);
    });

    el.addEventListener('click', (event) => {
      const node = event.target.closest('[data-action]');
      const action = node?.dataset.action;
      if (!editable || !action || active.size || lineDraft) return;
      if (action === 'tools') {
        setToolsOpen(toolsPop.hidden);
        return;
      }
      if (action === 'tool') {
        const next = node.dataset.tool;
        if (next !== 'pen' && next !== 'erase' && next !== 'line' && next !== 'text') return;
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

    document.addEventListener('pointerdown', (event) => {
      if (!toolsPop || toolsPop.hidden) return;
      if (el.contains(event.target)) return;
      setToolsOpen(false);
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
    check('text tool', html.indexOf('data-tool="text"') > 0);
    check('text angles', html.indexOf('data-draw-angle') > 0 && html.indexOf('>45°</option>') > 0 && html.indexOf('>90°</option>') > 0);
    check('tools popup starts closed', html.indexOf('data-action="tools"') > 0 && html.indexOf('draw-tools-pop') > 0 && html.indexOf('hidden>') > 0);
    const label = parseStrokes('text #112233 28 12,34 Hello pad');
    check('parses text', label.length === 1 && label[0].kind === 'text' && label[0].text === 'Hello pad' && label[0].points[0].x === 12);
    check('text roundtrip', serializeStrokes(label) === 'text #112233 28 12,34 Hello pad');
    const turned = parseStrokes('text #112233 28 12,34,90 Hello pad');
    check('parses text angle', turned.length === 1 && turned[0].angle === 90 && turned[0].text === 'Hello pad');
    check('angle roundtrip', serializeStrokes(turned) === 'text #112233 28 12,34,90 Hello pad');
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
      paint(ctx, [{ kind: 'text', color: '#ff0000', width: 48, points: [{ x: 8, y: 8 }], text: 'M' }], '#ffffff');
      const glyphs = ctx.getImageData(0, 0, 80, 70).data;
      let reds = 0;
      for (let i = 0; i < glyphs.length; i += 4) {
        if (glyphs[i] > 200 && glyphs[i + 1] < 40) reds += 1;
      }
      check('text paints ink', reds > 8);
      paint(ctx, [{ kind: 'text', color: '#ff0000', width: 48, angle: 90, points: [{ x: 200, y: 40 }], text: 'M' }], '#ffffff');
      const down = ctx.getImageData(190, 55, 20, 40).data;
      let downReds = 0;
      for (let i = 0; i < down.length; i += 4) {
        if (down[i] > 200 && down[i + 1] < 40) downReds += 1;
      }
      const aside = ctx.getImageData(230, 40, 30, 16).data;
      let asideReds = 0;
      for (let i = 0; i < aside.length; i += 4) {
        if (aside[i] > 200 && aside[i + 1] < 40) asideReds += 1;
      }
      check('text angle paints downward', downReds > 8 && asideReds === 0);
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
