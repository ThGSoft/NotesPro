/**
 * NotesPro ```draw``` block — touch drawing pad.
 * Pen, fill, eraser, straight-line, rectangle, move, and text tools. Size, ink, and paper are saved on the fence.
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
  const MIN_H = 180;
  const MAX_H = 2160;
  const STEP_H = 90;
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

  function clampHeight(raw) {
    if (raw == null || String(raw).trim() === '') return H;
    const value = Number(raw);
    if (!Number.isFinite(value)) return H;
    const stepped = Math.round(value / STEP_H) * STEP_H;
    return Math.max(MIN_H, Math.min(MAX_H, stepped));
  }

  function resolveHeight(cfg) {
    const raw = cfg.height ?? cfg.h;
    if (raw == null || String(raw).trim() === '') return H;
    return clampHeight(raw);
  }

  function resolveFreeze(cfg) {
    if (!Object.prototype.hasOwnProperty.call(cfg, 'freeze') && !Object.prototype.hasOwnProperty.call(cfg, 'frozen')) return false;
    const raw = String(cfg.freeze ?? cfg.frozen ?? '').trim().toLowerCase();
    if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
    return true;
  }

  function buildFenceAttrsString(cfg) {
    const parts = [];
    if (resolveFullscreen(cfg)) parts.push('fullscreen');
    parts.push(`pen=${resolvePen(cfg)}`);
    parts.push(`bg=${resolveBg(cfg)}`);
    parts.push(`size=${resolveSize(cfg)}`);
    parts.push(`height=${resolveHeight(cfg)}`);
    if (resolveFreeze(cfg)) parts.push('freeze');
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
      if (parts[0].toLowerCase() === 'fill') {
        const color = expandHex(parts[1], '');
        const spans = [];
        parts.slice(2).forEach((token) => {
          const row = /^(\d+):(.+)$/.exec(token);
          if (!row) return;
          const y = Number(row[1]);
          row[2].split(',').forEach((range) => {
            const bits = range.split('-');
            const x0 = Number(bits[0]);
            const x1 = Number(bits.length > 1 ? bits[1] : bits[0]);
            if (!Number.isFinite(y) || !Number.isFinite(x0) || !Number.isFinite(x1)) return;
            spans.push({ y, x0: Math.min(x0, x1), x1: Math.max(x0, x1) });
          });
        });
        if (!color || !spans.length) return;
        strokes.push({ kind: 'fill', color, erase: false, spans });
        return;
      }
      if (parts[0].toLowerCase() === 'rect') {
        if (parts.length < 4) return;
        const color = expandHex(parts[1], '');
        const size = Number(parts[2]);
        const points = [];
        parts.slice(3, 5).forEach((pair) => {
          const bits = pair.split(',');
          const x = Number(bits[0]);
          const y = Number(bits[1]);
          if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
        });
        if (!color || points.length < 2 || !Number.isFinite(size)) return;
        strokes.push({
          kind: 'rect',
          color,
          erase: false,
          width: Math.max(1, Math.min(48, size)),
          points,
        });
        return;
      }
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
      if (stroke.kind === 'fill') {
        const rows = new Map();
        (stroke.spans || []).forEach((span) => {
          const y = Math.max(0, Math.min(MAX_H - 1, Math.round(span.y)));
          const x0 = Math.max(0, Math.min(W - 1, Math.round(Math.min(span.x0, span.x1))));
          const x1 = Math.max(0, Math.min(W - 1, Math.round(Math.max(span.x0, span.x1))));
          const list = rows.get(y) || [];
          list.push(x0 === x1 ? String(x0) : `${x0}-${x1}`);
          rows.set(y, list);
        });
        const body = [...rows.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([y, ranges]) => `${y}:${ranges.join(',')}`)
          .join(' ');
        return body ? `fill ${stroke.color} ${body}` : '';
      }
      if (stroke.kind === 'rect') {
        const a = stroke.points[0] || { x: 0, y: 0 };
        const b = stroke.points[1] || a;
        return `rect ${stroke.color} ${round1(stroke.width)} ${round1(a.x)},${round1(a.y)} ${round1(b.x)},${round1(b.y)}`;
      }
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
    const w = ctx.canvas.width || W;
    const h = ctx.canvas.height || H;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    strokes.forEach((stroke) => drawStroke(ctx, stroke, bg));
  }

  function hexToRgb(hex) {
    const value = expandHex(hex, '');
    if (!value) return null;
    return {
      r: parseInt(value.slice(1, 3), 16),
      g: parseInt(value.slice(3, 5), 16),
      b: parseInt(value.slice(5, 7), 16),
    };
  }

  function sameColor(data, offset, rgb, tolerance) {
    return Math.abs(data[offset] - rgb.r) <= tolerance
      && Math.abs(data[offset + 1] - rgb.g) <= tolerance
      && Math.abs(data[offset + 2] - rgb.b) <= tolerance;
  }

  function floodSpans(image, x, y, fill, tolerance) {
    const width = image.width;
    const height = image.height;
    const data = image.data;
    const sx = Math.max(0, Math.min(width - 1, Math.floor(x)));
    const sy = Math.max(0, Math.min(height - 1, Math.floor(y)));
    const seedOffset = (sy * width + sx) * 4;
    const seed = { r: data[seedOffset], g: data[seedOffset + 1], b: data[seedOffset + 2] };
    if (!fill || sameColor(data, seedOffset, fill, tolerance)) return [];
    const visited = new Uint8Array(width * height);
    const spans = [];
    const stack = [sx, sy];
    while (stack.length) {
      const cy = stack.pop();
      let cx = stack.pop();
      let index = cy * width + cx;
      while (cx > 0 && !visited[index - 1] && sameColor(data, (index - 1) * 4, seed, tolerance)) {
        cx -= 1;
        index -= 1;
      }
      const x0 = cx;
      let above = false;
      let below = false;
      while (cx < width && !visited[index] && sameColor(data, index * 4, seed, tolerance)) {
        visited[index] = 1;
        if (cy > 0) {
          const up = index - width;
          const open = !visited[up] && sameColor(data, up * 4, seed, tolerance);
          if (open && !above) {
            stack.push(cx, cy - 1);
            above = true;
          } else if (!open) above = false;
        }
        if (cy < height - 1) {
          const down = index + width;
          const open = !visited[down] && sameColor(data, down * 4, seed, tolerance);
          if (open && !below) {
            stack.push(cx, cy + 1);
            below = true;
          } else if (!open) below = false;
        }
        cx += 1;
        index += 1;
      }
      if (cx > x0) spans.push({ y: cy, x0, x1: cx - 1 });
    }
    return spans;
  }

  function drawFillSpans(ctx, stroke) {
    const spans = stroke.spans || [];
    if (!spans.length) return;
    const sheetW = ctx.canvas.width || W;
    const sheetH = ctx.canvas.height || H;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = stroke.color;
    ctx.beginPath();
    spans.forEach((span) => {
      const y = span.y;
      if (y < 0 || y >= sheetH) return;
      const x0 = Math.max(0, Math.min(sheetW - 1, Math.min(span.x0, span.x1)));
      const x1 = Math.max(0, Math.min(sheetW - 1, Math.max(span.x0, span.x1)));
      ctx.rect(x0, y, x1 - x0 + 1, 1);
    });
    ctx.fill();
    ctx.restore();
  }

  function rectBounds(a, b) {
    const x0 = Math.min(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    return { x: x0, y: y0, w: Math.max(a.x, b.x) - x0, h: Math.max(a.y, b.y) - y0 };
  }

  function hitRect(point, stroke) {
    const pts = stroke?.points || [];
    if (pts.length < 2) return false;
    const box = rectBounds(pts[0], pts[1]);
    const pad = Math.max(12, Number(stroke.width) || 0);
    return point.x >= box.x - pad && point.x <= box.x + box.w + pad
      && point.y >= box.y - pad && point.y <= box.y + box.h + pad;
  }

  function cloneStroke(stroke) {
    const next = {
      kind: stroke.kind,
      color: stroke.color,
      erase: stroke.erase,
      width: stroke.width,
      angle: stroke.angle,
      text: stroke.text,
    };
    if (stroke.points) next.points = stroke.points.map((p) => ({ x: p.x, y: p.y }));
    if (stroke.spans) next.spans = stroke.spans.map((span) => ({ y: span.y, x0: span.x0, x1: span.x1 }));
    return next;
  }

  function contentBounds(list) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const add = (x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    };
    list.forEach((stroke) => {
      (stroke.points || []).forEach((p) => add(p.x, p.y));
      (stroke.spans || []).forEach((span) => {
        add(Math.min(span.x0, span.x1), span.y);
        add(Math.max(span.x0, span.x1), span.y);
      });
    });
    if (!Number.isFinite(minX)) return null;
    return { x: minX, y: minY, w: Math.max(0, maxX - minX), h: Math.max(0, maxY - minY) };
  }

  function translateStrokes(list, dx, dy) {
    return list.map((stroke) => {
      const next = cloneStroke(stroke);
      if (next.points) next.points = next.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      if (next.spans) next.spans = next.spans.map((span) => ({ y: span.y + dy, x0: span.x0 + dx, x1: span.x1 + dx }));
      return next;
    });
  }

  function moveContent(list, dx, dy, sheetW, sheetH) {
    const bounds = contentBounds(list);
    if (!bounds) return list.map(cloneStroke);
    let ndx = dx;
    let ndy = dy;
    if (bounds.w <= sheetW) {
      const x = bounds.x + ndx;
      if (x < 0) ndx -= x;
      else if (x + bounds.w > sheetW) ndx -= x + bounds.w - sheetW;
    }
    if (bounds.h <= sheetH) {
      const y = bounds.y + ndy;
      if (y < 0) ndy -= y;
      else if (y + bounds.h > sheetH) ndy -= y + bounds.h - sheetH;
    }
    return translateStrokes(list, ndx, ndy);
  }

  function moveRectPoints(points, origin, point, sheetW, sheetH) {
    let dx = point.x - origin.x;
    let dy = point.y - origin.y;
    const moved = points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    const box = rectBounds(moved[0], moved[1] || moved[0]);
    if (box.w <= sheetW) {
      if (box.x < 0) dx -= box.x;
      else if (box.x + box.w > sheetW) dx -= box.x + box.w - sheetW;
    }
    if (box.h <= sheetH) {
      if (box.y < 0) dy -= box.y;
      else if (box.y + box.h > sheetH) dy -= box.y + box.h - sheetH;
    }
    return points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  }

  function drawRectShape(ctx, stroke) {
    const pts = stroke.points || [];
    if (pts.length < 2) return;
    const box = rectBounds(pts[0], pts[1]);
    if (box.w < 0.5 && box.h < 0.5) return;
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineJoin = 'miter';
    ctx.strokeRect(box.x, box.y, box.w, box.h);
  }

  function drawRectGuide(ctx, stroke) {
    const pts = stroke.points || [];
    if (pts.length < 2) return;
    const box = rectBounds(pts[0], pts[1]);
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1;
    ctx.strokeRect(box.x - 4, box.y - 4, box.w + 8, box.h + 8);
    ctx.restore();
  }

  function drawStroke(ctx, stroke, bg) {
    if (stroke.kind === 'fill') {
      drawFillSpans(ctx, stroke);
      return;
    }
    if (stroke.kind === 'rect') {
      drawRectShape(ctx, stroke);
      return;
    }
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
    const sheetH = resolveHeight(cfg);
    const frozen = resolveFreeze(cfg);
    const drawIndex = Number.isFinite(options.drawIndex) ? options.drawIndex : 0;
    const fullscreen = resolveFullscreen(cfg);
    const themeClass = style.theme ? ` draw-block--${style.theme}` : '';
    const customClass = (style.colorCss || style.bgCss) ? ' draw-block--custom' : '';
    const fullClass = fullscreen ? ' draw-block--fullscreen' : '';
    const frozenClass = frozen ? ' draw-block--frozen' : '';
    const styleVars = [`--draw-sheet-h:${sheetH}`];
    if (style.colorCss) styleVars.push(`--draw-accent:${style.colorCss}`);
    if (style.bgCss) styleVars.push(`--draw-chrome:${style.bgCss}`);
    const preview = !!options.preview;
    const modeClass = preview ? ' draw-block--preview' : '';
    const styleAttr = styleVars.length ? ` style="${styleVars.map((v) => escapeHtml(v)).join(';')}"` : '';
    if (preview) {
      return [
        `<div class="draw-block${themeClass}${customClass}${fullClass}${frozenClass}${modeClass}"${styleAttr}`,
        ` data-draw-index="${drawIndex}"`,
        ` data-draw-mode="preview"`,
        ` data-draw-pen="${pen}"`,
        ` data-draw-bg="${bg}"`,
        ` data-draw-size="${size}"`,
        ` data-draw-height="${sheetH}"`,
        ` data-draw-freeze="${frozen ? '1' : '0'}">`,
        '<div class="draw-stage">',
        `<img class="draw-png" alt="${escapeHtml(title)}" title="Click to edit">`,
        '</div>',
        `<pre class="draw-store" hidden>${escapeHtml(String(source || '').trim())}</pre>`,
        '</div>',
      ].join('');
    }
    const chrome = fullscreen ? '' : [
      '<div class="draw-block-header">',
      `<div class="draw-block-title">${escapeHtml(title)}</div>`,
      '</div>',
    ].join('');
    return [
      `<div class="draw-block${themeClass}${customClass}${fullClass}${frozenClass}"${styleAttr}`,
      ` data-draw-index="${drawIndex}"`,
      ` data-draw-mode="edit"`,
      ` data-draw-pen="${pen}"`,
      ` data-draw-bg="${bg}"`,
      ` data-draw-size="${size}"`,
      ` data-draw-height="${sheetH}"`,
      ` data-draw-freeze="${frozen ? '1' : '0'}" tabindex="0">`,
      window.NotesProGameFullscreen?.renderButton?.() || '',
      chrome,
      '<div class="draw-toolbar">',
      '<button type="button" class="btn btn-sm btn-outline-light draw-tools-btn" data-action="tools" aria-expanded="false" aria-haspopup="true" title="Drawing tools">Tools</button>',
      `<button type="button" class="btn btn-sm btn-outline-light${frozen ? ' is-active' : ''}" data-action="freeze" aria-pressed="${frozen ? 'true' : 'false'}" title="${frozen ? 'Unfreeze the drawing' : 'Freeze the drawing'}">Freeze</button>`,
      '<button type="button" class="btn btn-sm btn-outline-light" data-action="shorter" title="Reduce height" aria-label="Reduce height">−</button>',
      '<span class="draw-height-label">Height</span>',
      '<button type="button" class="btn btn-sm btn-outline-light" data-action="taller" title="Increase height" aria-label="Increase height">+</button>',
      '<button type="button" class="btn btn-sm btn-outline-light" data-action="keep" title="Keep this drawing and start a new one">Keep</button>',
      '<button type="button" class="btn btn-sm btn-outline-light" data-action="undo" title="Drop the last stroke">Undo</button>',
      '<button type="button" class="btn btn-sm btn-outline-light" data-action="clear" title="Wipe the sheet">Clear</button>',
      '<div class="draw-tools-pop" role="toolbar" aria-label="Drawing tools" hidden>',
      '<button type="button" class="btn btn-sm btn-outline-light is-active" data-action="tool" data-tool="pen" aria-pressed="true">Pen</button>',
      '<button type="button" class="btn btn-sm btn-outline-light" data-action="tool" data-tool="fill" aria-pressed="false" title="Fill a closed area">Fill</button>',
      '<button type="button" class="btn btn-sm btn-outline-light" data-action="tool" data-tool="erase" aria-pressed="false">Eraser</button>',
      '<button type="button" class="btn btn-sm btn-outline-light" data-action="tool" data-tool="line" aria-pressed="false" title="Straight line">Ruler</button>',
      '<button type="button" class="btn btn-sm btn-outline-light" data-action="tool" data-tool="rect" aria-pressed="false" title="Press and drag to size the rectangle, then drag it to move">Rectangle</button>',
      '<button type="button" class="btn btn-sm btn-outline-light" data-action="tool" data-tool="move" aria-pressed="false" title="Drag to move the drawing">Move</button>',
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
      '</div>',
      '</div>',
      '<div class="draw-stage">',
      `<canvas class="draw-canvas" width="${W}" height="${sheetH}" aria-label="${escapeHtml(title)}"></canvas>`,
      '</div>',
      '<p class="draw-hint">Freeze locks the sheet. Height − and + shorten or lengthen the paper. Keep saves this drawing and asks to start a new one. Undo drops the last stroke. Clear wipes the sheet. Pen draws, Fill paints a closed area, Eraser rubs out, Ruler draws a straight line, Rectangle sizes a box while held and then lets you drag it, Move drags everything on the sheet, Text places a label.</p>',
      `<pre class="draw-store" hidden>${escapeHtml(String(source || '').trim())}</pre>`,
      '</div>',
    ].join('');
  }

  function localPoint(event, canvas) {
    const rect = canvas.getBoundingClientRect();
    const sheetW = canvas.width || W;
    const sheetH = canvas.height || H;
    const width = rect.width || sheetW;
    const height = rect.height || sheetH;
    return {
      x: Math.max(0, Math.min(sheetW, ((event.clientX - rect.left) / width) * sheetW)),
      y: Math.max(0, Math.min(sheetH, ((event.clientY - rect.top) / height) * sheetH)),
    };
  }

  function showDrawingPng(el) {
    const img = el.querySelector('.draw-png');
    if (!img || typeof document === 'undefined') return;
    const sheetH = clampHeight(el.dataset.drawHeight);
    const bg = expandHex(el.dataset.drawBg, DEFAULT_BG);
    const strokes = parseStrokes(el.querySelector('.draw-store')?.textContent || '');
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = sheetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    paint(ctx, strokes, bg);
    img.src = canvas.toDataURL('image/png');
  }

  function hydrateBlock(el, options = {}) {
    if (!el || el.dataset.drawHydrated === '1') return;
    el.dataset.drawHydrated = '1';
    if (el.dataset.drawMode === 'preview' || options.preview) {
      showDrawingPng(el);
      return;
    }
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
    let sheetH = clampHeight(el.dataset.drawHeight);
    let frozen = el.dataset.drawFreeze === '1';
    let strokes = parseStrokes(el.querySelector('.draw-store')?.textContent || '');
    let lineDraft = null;
    let rectDraft = null;
    let rectDrag = null;
    let rectLive = null;
    let contentDrag = null;
    let contentUndo = null;
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
      canvas.classList.toggle('draw-canvas--fill', tool === 'fill');
      canvas.classList.toggle('draw-canvas--erase', tool === 'erase');
      canvas.classList.toggle('draw-canvas--line', tool === 'line');
      canvas.classList.toggle('draw-canvas--rect', tool === 'rect');
      if (tool !== 'rect') canvas.classList.remove('draw-canvas--rect-move');
      canvas.classList.toggle('draw-canvas--move', tool === 'move');
      canvas.classList.toggle('draw-canvas--text', tool === 'text');
    }

    function placeTextBox(point) {
      const canvasRect = canvas.getBoundingClientRect();
      const hostRect = el.getBoundingClientRect();
      const scaleX = (canvasRect.width || canvas.width || W) / (canvas.width || W);
      const scaleY = (canvasRect.height || canvas.height || H) / (canvas.height || H);
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
        x: Math.max(0, Math.min(canvas.width || W, (left - (canvasRect.left - hostRect.left)) / scaleX)),
        y: Math.max(0, Math.min(canvas.height || H, (top - (canvasRect.top - hostRect.top)) / scaleY)),
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
      contentUndo = null;
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
      if (lineDraft) {
        drawStroke(ctx, {
          color: lineDraft.color,
          width: lineDraft.width,
          points: [lineDraft.start, lineDraft.end],
        }, bg);
        drawRulerGuide(ctx, lineDraft.start, lineDraft.end);
      }
      if (rectDraft) {
        drawRectShape(ctx, {
          kind: 'rect',
          color: rectDraft.color,
          width: rectDraft.width,
          points: [rectDraft.start, rectDraft.end],
        });
      } else if (tool === 'rect' && strokes[rectLive]?.kind === 'rect') {
        drawRectGuide(ctx, strokes[rectLive]);
      }
    }

    function persist() {
      options.onPersist?.({
        pen,
        bg,
        size: width,
        height: sheetH,
        freeze: frozen,
        strokes: serializeStrokes(strokes),
      });
    }

    function syncHeightButtons() {
      const shorter = el.querySelector('[data-action="shorter"]');
      const taller = el.querySelector('[data-action="taller"]');
      if (shorter) shorter.disabled = !editable || sheetH <= MIN_H;
      if (taller) taller.disabled = !editable || sheetH >= MAX_H;
    }

    function applyFreeze() {
      el.classList.toggle('draw-block--frozen', frozen);
      el.dataset.drawFreeze = frozen ? '1' : '0';
      const btn = el.querySelector('[data-action="freeze"]');
      if (btn) {
        btn.classList.toggle('is-active', frozen);
        btn.setAttribute('aria-pressed', frozen ? 'true' : 'false');
        btn.title = frozen ? 'Unfreeze the drawing' : 'Freeze the drawing';
      }
      el.querySelectorAll('.draw-tools-pop input, .draw-tools-pop button, .draw-tools-pop select, [data-action="undo"], [data-action="clear"]').forEach((node) => {
        node.disabled = !editable || frozen;
      });
      if (frozen) {
        setToolsOpen(false);
        rectDraft = null;
        rectDrag = null;
        rectLive = null;
        contentDrag = null;
        canvas.classList.remove('draw-canvas--rect-move');
        if (!textPop.hidden) hideTextField();
        redraw();
      }
    }

    function applySheetHeight(next) {
      sheetH = clampHeight(next);
      if (canvas.height !== sheetH) canvas.height = sheetH;
      el.dataset.drawHeight = String(sheetH);
      el.style.setProperty('--draw-sheet-h', String(sheetH));
      syncHeightButtons();
      redraw();
      if (!textPop.hidden && textAt) placeTextBox(textAt);
      persist();
    }

    applyTool();
    applyFreeze();
    syncHeightButtons();
    redraw();

    canvas.addEventListener('pointerdown', (event) => {
      if (!editable || frozen || event.button > 0) return;
      setToolsOpen(false);
      const point = localPoint(event, canvas);
      if (tool === 'text') {
        if (event.pointerType !== 'touch') event.preventDefault();
        event.stopPropagation();
        openText(point);
        return;
      }
      if (tool === 'fill') {
        event.preventDefault();
        event.stopPropagation();
        const rgb = hexToRgb(pen);
        if (!rgb) return;
        redraw();
        const spans = floodSpans(ctx.getImageData(0, 0, canvas.width, canvas.height), point.x, point.y, rgb, 32);
        if (!spans.length) return;
        contentUndo = null;
        strokes.push({ kind: 'fill', color: pen, erase: false, spans });
        redraw();
        persist();
        return;
      }
      event.preventDefault();
      if (tool === 'line') {
        if (lineDraft) return;
        lineDraft = { pointerId: event.pointerId, color: pen, width, start: point, end: point };
      } else if (tool === 'rect') {
        if (rectDraft || rectDrag) return;
        const live = strokes[rectLive];
        if (live?.kind === 'rect' && hitRect(point, live)) {
          rectDrag = {
            pointerId: event.pointerId,
            origin: point,
            points: live.points.map((p) => ({ x: p.x, y: p.y })),
          };
        } else {
          rectLive = null;
          rectDraft = { pointerId: event.pointerId, color: pen, width, start: point, end: point };
          redraw();
        }
      } else if (tool === 'move') {
        if (!strokes.length || contentDrag) return;
        contentDrag = {
          pointerId: event.pointerId,
          origin: point,
          base: strokes.map(cloneStroke),
        };
      } else {
        const erase = tool === 'erase';
        contentUndo = null;
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
      if (rectDraft && rectDraft.pointerId === event.pointerId) {
        event.preventDefault();
        rectDraft.end = localPoint(event, canvas);
        redraw();
        return;
      }
      if (rectDrag && rectDrag.pointerId === event.pointerId) {
        event.preventDefault();
        const stroke = strokes[rectLive];
        if (stroke?.kind === 'rect') {
          stroke.points = moveRectPoints(rectDrag.points, rectDrag.origin, localPoint(event, canvas), canvas.width || W, canvas.height || H);
          redraw();
        }
        return;
      }
      if (contentDrag && contentDrag.pointerId === event.pointerId) {
        event.preventDefault();
        const point = localPoint(event, canvas);
        strokes = moveContent(
          contentDrag.base,
          point.x - contentDrag.origin.x,
          point.y - contentDrag.origin.y,
          canvas.width || W,
          canvas.height || H,
        );
        redraw();
        return;
      }
      if (tool === 'rect' && strokes[rectLive]?.kind === 'rect') {
        canvas.classList.toggle('draw-canvas--rect-move', hitRect(localPoint(event, canvas), strokes[rectLive]));
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
        contentUndo = null;
        strokes.push({ color: draft.color, erase: false, width: draft.width, points: pts });
        redraw();
        persist();
        return;
      }
      if (rectDraft && rectDraft.pointerId === event.pointerId) {
        const draft = rectDraft;
        rectDraft = null;
        const box = rectBounds(draft.start, draft.end);
        if (box.w >= 2 || box.h >= 2) {
          contentUndo = null;
          strokes.push({
            kind: 'rect',
            color: draft.color,
            erase: false,
            width: draft.width,
            points: [draft.start, draft.end],
          });
          rectLive = strokes.length - 1;
          persist();
        }
        redraw();
        return;
      }
      if (rectDrag && rectDrag.pointerId === event.pointerId) {
        rectDrag = null;
        redraw();
        persist();
        return;
      }
      if (contentDrag && contentDrag.pointerId === event.pointerId) {
        const base = contentDrag.base;
        const changed = serializeStrokes(strokes) !== serializeStrokes(base);
        contentDrag = null;
        if (changed) contentUndo = base;
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
      const scaleX = (canvasRect.width || canvas.width || W) / (canvas.width || W);
      const scaleY = (canvasRect.height || canvas.height || H) / (canvas.height || H);
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
      if (frozen) return;
      pen = expandHex(penInput.value, pen);
      el.dataset.drawPen = pen;
      persist();
    });
    bgInput?.addEventListener('input', () => {
      if (frozen) return;
      bg = expandHex(bgInput.value, bg);
      el.dataset.drawBg = bg;
      redraw();
      persist();
    });
    sizeInput?.addEventListener('input', () => {
      if (frozen) return;
      width = clampSize(sizeInput.value);
      el.dataset.drawSize = String(width);
      if (sizeLabel) sizeLabel.textContent = String(width);
      if (!textPop.hidden && textAt) placeTextBox(textAt);
      if (!active.size && !lineDraft && !rectDraft && !rectDrag && !contentDrag) persist();
    });
    angleInput?.addEventListener('change', () => {
      textAngle = clampAngle(angleInput.value);
      if (!textPop.hidden && textAt) placeTextBox(textAt);
    });

    el.addEventListener('click', (event) => {
      const node = event.target.closest('[data-action]');
      const action = node?.dataset.action;
      if (!editable || !action || active.size || lineDraft || rectDraft || rectDrag || contentDrag) return;
      if (action === 'freeze') {
        frozen = !frozen;
        applyFreeze();
        persist();
        return;
      }
      if (action === 'keep') {
        persist();
        if (typeof options.onNewDraw !== 'function') return;
        if (!window.confirm('Start a new drawing?')) return;
        options.onNewDraw();
        return;
      }
      if (action === 'shorter' || action === 'taller') {
        applySheetHeight(sheetH + (action === 'taller' ? STEP_H : -STEP_H));
        return;
      }
      if (frozen) return;
      if (action === 'tools') {
        setToolsOpen(toolsPop.hidden);
        return;
      }
      if (action === 'tool') {
        const next = node.dataset.tool;
        if (next !== 'pen' && next !== 'erase' && next !== 'line' && next !== 'text' && next !== 'fill' && next !== 'rect' && next !== 'move') return;
        tool = next;
        if (tool !== 'rect') rectLive = null;
        applyTool();
        redraw();
        setToolsOpen(false);
      } else if (action === 'undo') {
        if (contentUndo) {
          strokes = contentUndo;
          contentUndo = null;
          rectLive = null;
          redraw();
          persist();
          return;
        }
        if (rectLive === strokes.length - 1) rectLive = null;
        strokes.pop();
        redraw();
        persist();
      } else if (action === 'clear') {
        strokes = [];
        rectLive = null;
        contentUndo = null;
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
    check('edit mode', html.indexOf('data-draw-mode="edit"') > 0 && html.indexOf('draw-png') < 0);
    const previewHtml = renderBlock('#ff0000 8 10,10 80,10', 'height=720;bg=#00ff00;title=Sketch', { preview: true });
    check('preview png', previewHtml.indexOf('draw-block--preview') > 0 && previewHtml.indexOf('class="draw-png"') > 0 && previewHtml.indexOf('data-draw-mode="preview"') > 0);
    check('preview hides tools', previewHtml.indexOf('draw-toolbar') < 0 && previewHtml.indexOf('draw-hint') < 0 && previewHtml.indexOf('draw-canvas') < 0);
    check('preview keeps sheet height', previewHtml.indexOf('--draw-sheet-h:720') > 0 && previewHtml.indexOf('data-draw-height="720"') > 0);
    if (typeof document !== 'undefined') {
      const host = document.createElement('div');
      host.innerHTML = previewHtml;
      const block = host.querySelector('.draw-block');
      hydrateBlock(block);
      const img = block.querySelector('.draw-png');
      check('preview raster', !!img && img.src.indexOf('data:image/png') === 0 && img.src.length > 100);
    }
    check('pen input', html.indexOf('value="#ff0000"') > 0);
    check('paper input', html.indexOf('value="#00ff00"') > 0);
    check('size slider', html.indexOf('data-draw-size') > 0 && html.indexOf('value="14"') > 0);
    check('fill tool', html.indexOf('data-tool="fill"') > 0);
    check('eraser tool', html.indexOf('data-tool="erase"') > 0);
    const bucket = [{
      kind: 'fill',
      color: '#ff0000',
      spans: [{ y: 2, x0: 1, x1: 4 }, { y: 2, x0: 8, x1: 9 }, { y: 3, x0: 1, x1: 4 }],
    }];
    check('fill roundtrip', serializeStrokes(bucket) === 'fill #ff0000 2:1-4,8-9 3:1-4');
    const parsedFill = parseStrokes(serializeStrokes(bucket));
    check('parses fill', parsedFill.length === 1 && parsedFill[0].kind === 'fill' && parsedFill[0].spans.length === 3 && parsedFill[0].spans[1].x0 === 8);
    check('line tool', html.indexOf('data-tool="line"') > 0);
    check('rectangle tool', html.indexOf('data-tool="rect"') > 0);
    const box = parseStrokes('rect #112233 8 10,20 80,40');
    check('parses rectangle', box.length === 1 && box[0].kind === 'rect' && box[0].width === 8 && box[0].points[1].x === 80 && box[0].points[1].y === 40);
    check('rectangle roundtrip', serializeStrokes(box) === 'rect #112233 8 10,20 80,40');
    const nudged = moveRectPoints([{ x: 10, y: 10 }, { x: 40, y: 30 }], { x: 0, y: 0 }, { x: 15, y: 8 }, W, H);
    check('moves a rectangle', nudged[0].x === 25 && nudged[0].y === 18 && nudged[1].x === 55 && nudged[1].y === 38);
    const parked = moveRectPoints([{ x: 10, y: 10 }, { x: 40, y: 30 }], { x: 0, y: 0 }, { x: -100, y: 0 }, W, H);
    check('rectangle stays on the sheet', parked[0].x === 0 && parked[0].y === 10 && parked[1].x === 30);
    check('move tool', html.indexOf('data-tool="move"') > 0);
    const shifted = moveContent([
      { color: '#112233', width: 4, points: [{ x: 10, y: 20 }, { x: 30, y: 40 }] },
      { kind: 'fill', color: '#ff0000', spans: [{ y: 5, x0: 1, x1: 4 }] },
    ], 15, 8, W, H);
    check('moves drawing content', shifted[0].points[0].x === 25 && shifted[0].points[0].y === 28 && shifted[0].points[1].x === 45 && shifted[1].spans[0].y === 13 && shifted[1].spans[0].x0 === 16 && shifted[1].spans[0].x1 === 19);
    const held = moveContent([
      { color: '#112233', width: 4, points: [{ x: 10, y: 20 }, { x: 30, y: 40 }] },
    ], -100, 0, W, H);
    check('drawing stays on the sheet', held[0].points[0].x === 0 && held[0].points[1].x === 20 && held[0].points[0].y === 20);
    check('text tool', html.indexOf('data-tool="text"') > 0);
    check('text angles', html.indexOf('data-draw-angle') > 0 && html.indexOf('>45°</option>') > 0 && html.indexOf('>90°</option>') > 0);
    check('tools popup starts closed', html.indexOf('data-action="tools"') > 0 && html.indexOf('draw-tools-pop') > 0 && html.indexOf('hidden>') > 0);
    check('freeze button', html.indexOf('data-action="freeze"') > 0 && html.indexOf('draw-block--frozen') < 0);
    check('height buttons', html.indexOf('data-action="shorter"') > 0 && html.indexOf('data-action="taller"') > 0 && html.indexOf('height="540"') > 0);
    check('keep button', html.indexOf('data-action="keep"') > 0);
    const toolbar = html.slice(html.indexOf('draw-toolbar'), html.indexOf('draw-tools-pop'));
    check('undo and clear beside keep', toolbar.indexOf('data-action="keep"') > 0 && toolbar.indexOf('data-action="undo"') > 0 && toolbar.indexOf('data-action="clear"') > 0);
    const locked = renderBlock('', 'freeze;height=720');
    check('frozen sheet', locked.indexOf('draw-block--frozen') > 0 && locked.indexOf('aria-pressed="true"') > 0 && locked.indexOf('height="720"') > 0);
    const tall = buildFenceAttrsString(parseFenceAttrs('height=2300;freeze'));
    check('height cap and freeze', tall.indexOf('height=2160') > -1 && tall.indexOf('freeze') > -1);
    const thawed = buildFenceAttrsString(parseFenceAttrs('height=40;freeze=0'));
    check('height floor and thaw', thawed.indexOf('height=180') > -1 && thawed.indexOf('freeze') < 0);
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
      paint(ctx, [{ kind: 'rect', color: '#ff0000', width: 4, points: [{ x: 20, y: 20 }, { x: 120, y: 100 }] }], '#ffffff');
      const edge = ctx.getImageData(20, 60, 1, 1).data;
      const inside = ctx.getImageData(70, 60, 1, 1).data;
      check('rectangle strokes the border', edge[0] > 180 && edge[1] < 80 && inside[0] > 240 && inside[1] > 240 && inside[2] > 240);
      paint(ctx, [], '#ffffff');
      const same = floodSpans(ctx.getImageData(0, 0, W, H), 4, 4, hexToRgb('#ffffff'), 32);
      check('fill skips same color', same.length === 0);
      const open = floodSpans(ctx.getImageData(0, 0, W, H), 8, 8, hexToRgb('#ff0000'), 32);
      check('fill covers paper', open.length === H && open.every((span) => span.x0 === 0 && span.x1 === W - 1));
      paint(ctx, [{ kind: 'fill', color: '#ff0000', spans: open }], '#ffffff');
      const poured = ctx.getImageData(8, 8, 1, 1).data;
      check('fill paints ink', poured[0] > 200 && poured[1] < 40);
      paint(ctx, [{ color: '#000000', width: 24, points: [{ x: 0, y: 270 }, { x: W - 1, y: 270 }] }], '#ffffff');
      const blocked = floodSpans(ctx.getImageData(0, 0, W, H), 20, 20, hexToRgb('#0000ff'), 32);
      check('fill stops at a line', blocked.length > 10 && blocked.every((span) => span.y < 290));
      paint(ctx, [
        { color: '#000000', width: 24, points: [{ x: 0, y: 270 }, { x: W - 1, y: 270 }] },
        { kind: 'fill', color: '#0000ff', spans: blocked },
      ], '#ffffff');
      const above = ctx.getImageData(20, 20, 1, 1).data;
      const below = ctx.getImageData(20, 400, 1, 1).data;
      check('fill stays above the line', above[2] > 200 && above[0] < 40 && below[0] > 240 && below[2] > 240);
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
      canvas.height = 720;
      paint(ctx, [{ color: '#ff0000', width: 12, points: [{ x: 40, y: 600 }] }], '#ffffff');
      const low = ctx.getImageData(40, 600, 1, 1).data;
      check('taller sheet keeps ink', low[0] > 200 && low[1] < 40);
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
