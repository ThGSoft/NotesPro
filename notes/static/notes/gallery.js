/**
 * NotesPro ```gallery``` block — walk-in 3D photo corridor + paste-your-own pictures.
 */
(function (root, factory) {
  const api = factory();
  root.NotesProGallery = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];
  const MODES = new Set(['walk', 'grid']);

  function isGalleryMobile() {
    return document.body.classList.contains('mobile-layout')
      || (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 768px)').matches);
  }

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function photoDisplayTitle(photo, index) {
    const raw = String(photo?.label || '').trim();
    if (raw) return raw;
    if (photo?.kind === 'youtube' || extractYoutubeId(photo?.src)) return 'YouTube';
    if (photo?.kind === 'video' || isVideoSrc(photo?.src)) return `Video ${index + 1}`;
    if (photo?.kind === 'audio' || isAudioSrc(photo?.src)) return `Audio ${index + 1}`;
    return `Photo ${index + 1}`;
  }

  function absoluteMediaUrl(src) {
    const href = resolveMediaHref(src);
    try {
      return new URL(href, window.location.href).href;
    } catch (_) {
      return href;
    }
  }

  function jsonForScript(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c');
  }

  function drawTitlePlaqueCanvas(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 128;
    const g = canvas.getContext('2d');
    if (!g) return canvas;
    g.fillStyle = '#1c1814';
    g.fillRect(0, 0, 768, 128);
    g.strokeStyle = '#c9a227';
    g.lineWidth = 5;
    g.strokeRect(6, 6, 756, 116);
    g.fillStyle = '#f4ead6';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let label = String(text || '').trim() || 'Photo';
    let size = 42;
    g.font = `600 ${size}px "Segoe UI", system-ui, sans-serif`;
    while (size > 22 && g.measureText(label).width > 700) {
      size -= 2;
      g.font = `600 ${size}px "Segoe UI", system-ui, sans-serif`;
    }
    if (g.measureText(label).width > 700) {
      while (label.length > 4 && g.measureText(`${label}…`).width > 700) label = label.slice(0, -1);
      label += '…';
    }
    g.fillText(label, 384, 66);
    return canvas;
  }

  function makeTitlePlaqueMesh(THREE, text, width) {
    const tex = new THREE.CanvasTexture(drawTitlePlaqueCanvas(text));
    tex.colorSpace = THREE.SRGBColorSpace;
    const pw = Math.max(0.7, (width || 1.4) * 0.92);
    const ph = 0.2;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(pw, ph),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true }),
    );
    mesh.position.set(0, -(1.4 / 2) - 0.16 - ph / 2, 0.05);
    return mesh;
  }

  function layoutTitlePlaque(plaque, width, height) {
    if (!plaque) return;
    const pw = Math.max(0.7, width * 0.92);
    const ph = 0.2;
    plaque.geometry.dispose();
    plaque.geometry = new THREE.PlaneGeometry(pw, ph);
    plaque.position.set(0, -(height / 2) - 0.16 - ph / 2, 0.05);
  }

  function drawEndWallTitleCanvas(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 768;
    const g = canvas.getContext('2d');
    if (!g) return canvas;
    g.fillStyle = '#1c1814';
    g.fillRect(0, 0, 2048, 768);
    g.strokeStyle = '#c9a227';
    g.lineWidth = 24;
    g.strokeRect(20, 20, 2008, 728);
    g.strokeStyle = '#f4ead6';
    g.lineWidth = 6;
    g.strokeRect(48, 48, 1952, 672);
    g.fillStyle = '#f4ead6';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let label = String(text || '').trim() || 'Gallery';
    let size = 240;
    g.font = `700 ${size}px Georgia, "Times New Roman", serif`;
    while (size > 64 && g.measureText(label).width > 1860) {
      size -= 6;
      g.font = `700 ${size}px Georgia, "Times New Roman", serif`;
    }
    if (g.measureText(label).width > 1860) {
      while (label.length > 4 && g.measureText(`${label}…`).width > 1860) label = label.slice(0, -1);
      label += '…';
    }
    g.fillText(label, 1024, 384);
    return canvas;
  }

  function photoWallZ(index, spacing) {
    return 2.5 + Math.floor(index / 2) * spacing + (index % 2) * (spacing * 0.35);
  }

  function hallLengthForPhotos(count, spacing) {
    const lastZ = photoWallZ(Math.max(0, count - 1), spacing);
    // Frames sit in the YZ plane (width along the hall). Cap the corridor
    // just past the last picture so there is room to view the end-wall title.
    return lastZ + 1.05 + 1.4;
  }

  function makeHallTitleMesh(THREE, text, hallHalfW, wallH, z, rotY) {
    const tex = new THREE.CanvasTexture(drawEndWallTitleCanvas(text));
    tex.colorSpace = THREE.SRGBColorSpace;
    const w = Math.min(4.35, hallHalfW * 2 - 0.3);
    const h = w * (768 / 2048);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex }),
    );
    mesh.position.set(0, wallH * 0.58, z);
    mesh.rotation.y = rotY || 0;
    return mesh;
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

  function isVideoSrc(src) {
    return /\.(mp4|webm|ogg|ogv|mov|m4v)(\?|#|$)/i.test(String(src || ''));
  }

  function isAudioSrc(src) {
    return /\.(mp3|wav|m4a|aac|flac|oga|opus)(\?|#|$)/i.test(String(src || ''));
  }

  function extractYoutubeId(raw) {
    const text = String(raw || '');
    const match = text.match(
      /(?:youtube(?:-nocookie)?\.com\/(?:embed\/|shorts\/|live\/|watch\?(?:[^"'<\s]*?[?&])?v=)|youtu\.be\/)([A-Za-z0-9_-]{11})/i,
    );
    return match ? match[1] : '';
  }

  function youtubeEmbedSrc(id, extra = '') {
    const params = extra ? `&${extra.replace(/^&/, '')}` : '';
    return `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1&playsinline=1${params}`;
  }

  function youtubeThumbSrc(id) {
    return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  }

  function mediaKind(src) {
    if (extractYoutubeId(src)) return 'youtube';
    if (isVideoSrc(src)) return 'video';
    if (isAudioSrc(src)) return 'audio';
    return 'image';
  }

  function makeAudioPlate(label) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const g = canvas.getContext('2d');
    if (!g) return canvas;
    const bg = g.createLinearGradient(0, 0, 0, 512);
    bg.addColorStop(0, '#1e1b4b');
    bg.addColorStop(1, '#0f172a');
    g.fillStyle = bg;
    g.fillRect(0, 0, 512, 512);
    g.fillStyle = '#fbbf24';
    g.font = '200px serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('♪', 256, 230);
    g.fillStyle = '#e2e8f0';
    g.font = '28px sans-serif';
    g.fillText(String(label || 'Audio').slice(0, 28), 256, 400);
    return canvas;
  }

  function parsePhotos(source) {
    const photos = [];
    const seen = new Set();
    const text = String(source || '');
    const hits = [];

    function remember(key, item, index) {
      if (!key || seen.has(key)) return;
      seen.add(key);
      hits.push({ index, ...item });
    }

    const iframeRe = /<iframe\b[\s\S]*?<\/iframe>|<iframe\b[^>]*>/gi;
    let match;
    while ((match = iframeRe.exec(text)) !== null) {
      const tag = match[0];
      const srcMatch = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
      const titleMatch = tag.match(/\btitle\s*=\s*["']([^"']*)["']/i);
      const id = extractYoutubeId(srcMatch?.[1] || tag);
      if (!id) continue;
      const title = String(titleMatch?.[1] || '').replace(/\s*YouTube video player\s*/i, '').trim();
      remember(`yt:${id}`, {
        src: youtubeEmbedSrc(id),
        label: title,
        kind: 'youtube',
        youtubeId: id,
      }, match.index);
    }

    const mdImg = /!\[(.*?)\]\((.*?)\)/g;
    while ((match = mdImg.exec(text)) !== null) {
      const src = match[2].trim();
      const id = extractYoutubeId(src);
      if (id) {
        remember(`yt:${id}`, {
          src: youtubeEmbedSrc(id),
          label: (match[1] || '').trim(),
          kind: 'youtube',
          youtubeId: id,
        }, match.index);
        continue;
      }
      if (!src) continue;
      remember(src, { src, label: (match[1] || '').trim(), kind: mediaKind(src) }, match.index);
    }

    const urlRe = /https?:\/\/(?:www\.)?(?:youtube(?:-nocookie)?\.com\/(?:embed\/|shorts\/|live\/|watch\?[^ \n<"']*v=)|youtu\.be\/)[A-Za-z0-9_-]{11}[^\s<"')]*/gi;
    while ((match = urlRe.exec(text)) !== null) {
      const id = extractYoutubeId(match[0]);
      if (!id) continue;
      remember(`yt:${id}`, {
        src: youtubeEmbedSrc(id),
        label: '',
        kind: 'youtube',
        youtubeId: id,
      }, match.index);
    }

    if (hits.length) {
      hits.sort((a, b) => a.index - b.index);
      hits.forEach(({ index, ...item }) => photos.push(item));
      return photos;
    }

    text.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      let src = '';
      let label = '';
      if (trimmed.includes('|')) {
        const parts = trimmed.split('|');
        src = parts[0].trim();
        label = parts.slice(1).join('|').trim();
      } else {
        src = trimmed.replace(/^[-*]\s+/, '').trim();
      }
      const ytId = extractYoutubeId(src);
      if (ytId) {
        remember(`yt:${ytId}`, {
          src: youtubeEmbedSrc(ytId),
          label,
          kind: 'youtube',
          youtubeId: ytId,
        }, 0);
        photos.push({ src: youtubeEmbedSrc(ytId), label, kind: 'youtube', youtubeId: ytId });
        return;
      }
      if (!src || seen.has(src) || /\s/.test(src) && !/^https?:\/\//i.test(src) && !src.startsWith('media/')) return;
      const kind = mediaKind(src);
      const looksMedia = kind === 'video' || kind === 'audio'
        || /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(src)
        || /^https?:\/\//i.test(src)
        || src.startsWith('media/');
      if (!looksMedia) return;
      seen.add(src);
      photos.push({ src, label, kind });
    });
    return photos;
  }

  function formatGalleryBody(photos) {
    return (photos || []).map((p, i) => {
      if (p.kind === 'youtube' || extractYoutubeId(p.src)) {
        const id = p.youtubeId || extractYoutubeId(p.src);
        const alt = p.label || 'YouTube';
        return `![${alt}](https://www.youtube.com/embed/${id})`;
      }
      const alt = p.label || (p.kind === 'video' ? `Video ${i + 1}` : p.kind === 'audio' ? `Audio ${i + 1}` : `Photo ${i + 1}`);
      return `![${alt}](${p.src})`;
    }).join('\n');
  }

  function buildFenceAttrsString(cfg, extra = {}) {
    const merged = { ...cfg, ...extra };
    const parts = [];
    Object.entries(merged).forEach(([key, value]) => {
      if (value == null || value === '') return;
      parts.push(`${key}=${value}`);
    });
    return parts.join(';');
  }

  function resolveCols(cfg) {
    const n = parseInt(cfg.cols || cfg.columns || '3', 10);
    if (!Number.isFinite(n)) return 3;
    return Math.max(1, Math.min(6, n));
  }

  function resolveMode(cfg) {
    const raw = String(cfg.mode || 'walk').trim().toLowerCase();
    return MODES.has(raw) ? raw : 'walk';
  }

  function resolveFullscreen(cfg) {
    const raw = String(cfg.fullscreen ?? cfg.full ?? '1').trim().toLowerCase();
    if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'compact') return false;
    return true;
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

  const DEMO_SOURCE = [
    '![Mountain lake](https://picsum.photos/id/1015/960/720)',
    '![Flower video](https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4)',
    '![Forest path](https://picsum.photos/id/1018/960/720)',
    '![YouTube](https://www.youtube.com/embed/N9jBlg-GUYM)',
    '![Coast](https://picsum.photos/id/1016/960/720)',
    '![Valley](https://picsum.photos/id/1043/960/720)',
    '![Bridge](https://picsum.photos/id/1036/960/720)',
  ].join('\n');

  function resolveDemo(cfg) {
    if (!Object.prototype.hasOwnProperty.call(cfg, 'demo')) return true;
    const raw = String(cfg.demo ?? '').trim().toLowerCase();
    if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
    return raw === '' || raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
  }

  function resolveNamedTitle(cfg, keys, fallback) {
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(cfg, key)) continue;
      return String(cfg[key] ?? '').trim();
    }
    return fallback;
  }

  function buildSpec(source, cfg) {
    const title = String(cfg.title || 'Gallery').trim() || 'Gallery';
    const frontTitle = resolveNamedTitle(cfg, ['front', 'fronttitle', 'titlefront'], title);
    const backTitle = resolveNamedTitle(cfg, ['back', 'backtitle', 'titleback'], title);
    const photos = parsePhotos(source);
    const demo = resolveDemo(cfg);
    return {
      title,
      frontTitle,
      backTitle,
      cols: resolveCols(cfg),
      mode: resolveMode(cfg),
      demo,
      photos: photos.length ? photos : (demo ? parsePhotos(DEMO_SOURCE) : photos),
      draft: !photos.length,
    };
  }

  function renderPasteZone(label) {
    return `<div class="gallery-paste-zone" tabindex="0" role="button" aria-label="Paste photo">`
      + `<span class="gallery-paste-icon" aria-hidden="true">📷</span>`
      + `<span class="gallery-paste-label">${escapeHtml(label || 'Paste your photo here (Ctrl+V)')}</span>`
      + `</div>`;
  }

  function renderFullscreenButton() {
    return window.NotesProGameFullscreen?.renderButton?.() || '';
  }

  function bindFullscreenButton(el) {
    window.NotesProGameFullscreen?.bind?.(el);
  }

  function renderThumb(photo, index) {
    const ytId = photo.youtubeId || extractYoutubeId(photo.src);
    const kind = ytId ? 'youtube' : (photo.kind === 'video' || photo.kind === 'audio' ? photo.kind : 'image');
    const src = escapeHtml(kind === 'youtube' ? youtubeThumbSrc(ytId) : resolveMediaHref(photo.src));
    const label = escapeHtml(photoDisplayTitle(photo, index));
    let media;
    if (kind === 'video') {
      media = `<video src="${src}" muted playsinline loop preload="metadata" draggable="false"></video>`
        + `<span class="gallery-thumb-badge" aria-hidden="true">▶</span>`;
    } else if (kind === 'audio') {
      media = `<span class="gallery-audio-plate" aria-hidden="true">♪</span>`
        + `<span class="gallery-thumb-badge" aria-hidden="true">♪</span>`;
    } else if (kind === 'youtube') {
      media = `<img src="${src}" alt="${label}" loading="lazy" draggable="false">`
        + `<span class="gallery-thumb-badge gallery-thumb-badge--yt" aria-hidden="true">▶</span>`;
    } else {
      media = `<img src="${src}" alt="${label}" loading="lazy" draggable="false">`;
    }
    return [
      `<button type="button" class="gallery-thumb${kind === 'video' || kind === 'youtube' || kind === 'audio' ? ' gallery-thumb--video' : ''}" data-gallery-index="${index}" aria-label="${label}">`,
      `<span class="gallery-frame">`,
      media,
      `</span>`,
      `<span class="gallery-caption">${label}</span>`,
      `</button>`,
    ].join('');
  }

  function renderGrid(spec, editable) {
    return [
      `<div class="gallery-grid" role="list">`,
      spec.photos.map((p, i) => renderThumb(p, i)).join(''),
      editable
        ? `<button type="button" class="gallery-thumb gallery-thumb--add" data-action="add-photo" aria-label="Add photo">`
          + `<span class="gallery-add-icon" aria-hidden="true">+</span>`
          + `<span class="gallery-add-label">Add photo</span>`
          + `</button>`
        : '',
      `</div>`,
    ].join('');
  }

  function renderWalkShell(spec, editable) {
    return [
      `<div class="gallery-walk">`,
      `<div class="gallery-walk-viewport" tabindex="0" aria-label="Walk-in photo gallery">`,
      `<canvas class="gallery-walk-canvas"></canvas>`,
      `<div class="gallery-walk-css3d" aria-hidden="true"><div class="gallery-walk-css3d-cam"></div></div>`,
      `<div class="gallery-walk-overlay">`,
      `<p class="gallery-walk-hint gallery-walk-hint--desktop">Click a picture to open · click empty space to look · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk · wheel zoom · <kbd>Space</kbd> open</p>`,
      `<p class="gallery-walk-hint gallery-walk-hint--mobile">${spec.demo
        ? 'WASD pad walk · +/− zoom · tap a picture to open'
        : 'WASD pad walk · +/− zoom · tap a picture to open · drag to look'}</p>`,
      `<div class="gallery-walk-caption" aria-live="polite"></div>`,
      `</div>`,
      `<div class="gallery-walk-pad" aria-label="WASD walk pad">`,
      `<button type="button" class="gallery-walk-pad__btn gallery-walk-pad__btn--w" data-key="KeyW" tabindex="-1" aria-label="Forward">W</button>`,
      `<button type="button" class="gallery-walk-pad__btn gallery-walk-pad__btn--a" data-key="KeyA" tabindex="-1" aria-label="Left">A</button>`,
      `<button type="button" class="gallery-walk-pad__btn gallery-walk-pad__btn--s" data-key="KeyS" tabindex="-1" aria-label="Back">S</button>`,
      `<button type="button" class="gallery-walk-pad__btn gallery-walk-pad__btn--d" data-key="KeyD" tabindex="-1" aria-label="Right">D</button>`,
      `<button type="button" class="gallery-walk-pad__btn gallery-walk-pad__btn--in" data-zoom="in" tabindex="-1" aria-label="Zoom in">+</button>`,
      `<button type="button" class="gallery-walk-pad__btn gallery-walk-pad__btn--out" data-zoom="out" tabindex="-1" aria-label="Zoom out">−</button>`,
      `</div>`,
      `</div>`,
      `<div class="gallery-walk-toolbar">`,
      `<button type="button" class="btn btn-sm btn-outline-light" data-action="walk-focus">Enter gallery</button>`,
      `<button type="button" class="btn btn-sm btn-outline-light" data-action="walk-demo" aria-pressed="false">Demo tour</button>`,
      `<button type="button" class="btn btn-sm btn-outline-light" data-action="export-html" title="Download a ZIP with HTML tour and images (no WASD)">HTML tour</button>`,
      editable
        ? `<button type="button" class="btn btn-sm btn-outline-secondary" data-action="add-photo">Add photo</button>`
        : '',
      `<button type="button" class="btn btn-sm btn-outline-secondary" data-action="toggle-grid">Thumbnails</button>`,
      `</div>`,
      `<div class="gallery-grid gallery-grid--compact d-none" role="list">`,
      spec.photos.map((p, i) => renderThumb(p, i)).join(''),
      `</div>`,
      `</div>`,
    ].join('');
  }

  function renderBlock(source, fenceAttrs, options = {}) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const style = resolveStyle(cfg);
    const spec = buildSpec(source, cfg);
    const galleryIndex = Number.isFinite(options.galleryIndex) ? options.galleryIndex : 0;
    const editable = options.editable !== false;
    const fullscreen = resolveFullscreen(cfg);
    const themeClass = style.theme ? ` gallery-block--${style.theme}` : '';
    const customClass = (style.colorCss || style.bgCss) ? ' gallery-block--custom' : '';
    const fullClass = fullscreen ? ' gallery-block--fullscreen' : '';
    const styleVars = [];
    if (style.colorCss) styleVars.push(`--gallery-accent:${style.colorCss}`);
    if (style.bgCss) styleVars.push(`--gallery-bg:${style.bgCss}`);
    styleVars.push(`--gallery-cols:${spec.cols}`);
    const styleAttr = styleVars.length
      ? ` style="${styleVars.map(v => escapeHtml(v)).join(';')}"`
      : '';
    const encoded = encodeSpec(spec);
    const chrome = fullscreen ? '' : [
      `<div class="gallery-block-header">`,
      `<div class="gallery-block-title">${escapeHtml(spec.title)}</div>`,
      `<div class="gallery-block-meta">${spec.draft ? 'paste photos / videos' : `${spec.mode} · ${spec.photos.length} item${spec.photos.length === 1 ? '' : 's'}`}</div>`,
      `</div>`,
    ].join('');

    let body;
    const canWalk = spec.mode !== 'grid' && spec.photos.length;
    if (!spec.photos.length) {
      body = renderPasteZone(editable
        ? 'Paste a photo (Ctrl+V) or add image / video / YouTube URLs in markdown'
        : 'Add photos, videos, or YouTube embeds in markdown.');
    } else if (spec.mode === 'grid') {
      body = renderGrid(spec, editable);
    } else {
      body = renderWalkShell(spec, editable);
    }

    return [
      `<div class="gallery-block${themeClass}${customClass}${fullClass}${editable ? ' gallery-block--editable' : ''}${spec.draft ? ' gallery-block--draft' : ''}${canWalk ? ' gallery-block--walk' : ''}${spec.demo ? ' gallery-block--demo' : ''}"${styleAttr}`,
      ` data-gallery-index="${galleryIndex}"`,
      ` data-gallery-spec="${escapeHtml(encoded)}" tabindex="0">`,
      renderFullscreenButton(),
      chrome,
      body,
      `<div class="gallery-status" aria-live="polite"></div>`,
      `</div>`,
    ].join('');
  }

  function setStatus(el, text) {
    const status = el.querySelector('.gallery-status');
    if (!status) return;
    status.textContent = text || '';
  }

  function threeReady() {
    return typeof window.THREE !== 'undefined';
  }

  function whenThreeReady(onReady, onMissing) {
    if (threeReady()) {
      onReady();
      return;
    }
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('notespro-three-ready', onEvent);
      if (ok && threeReady()) onReady();
      else onMissing();
    };
    const onEvent = () => finish(true);
    window.addEventListener('notespro-three-ready', onEvent);
    if (threeReady()) {
      finish(true);
      return;
    }
    window.setTimeout(() => finish(threeReady()), 8000);
  }

  function createEmbeddedWallFrame(THREE, w, h) {
    const depth = 0.14;
    const group = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a3728, roughness: 0.58, metalness: 0.05 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.34, metalness: 0.58 });
    const matBoard = new THREE.MeshStandardMaterial({ color: 0xf7f3ea, roughness: 0.98 });
    const parts = {
      outer: new THREE.Mesh(new THREE.BoxGeometry(w + 0.24, h + 0.24, depth), wood),
      lip: new THREE.Mesh(new THREE.BoxGeometry(w + 0.14, h + 0.14, depth * 0.55), gold),
      mat: new THREE.Mesh(new THREE.BoxGeometry(w + 0.05, h + 0.05, depth * 0.22), matBoard),
    };
    // Opening flush at z=0; frame depth recessed into the wall (-Z).
    parts.outer.position.z = -depth / 2;
    parts.lip.position.z = -depth * 0.28;
    parts.mat.position.z = -depth * 0.14;
    group.add(parts.outer, parts.lip, parts.mat);
    return { group, parts, depth };
  }

  function resizeEmbeddedWallFrame(parts, depth, w, h) {
    parts.outer.geometry.dispose();
    parts.outer.geometry = new THREE.BoxGeometry(w + 0.24, h + 0.24, depth);
    parts.lip.geometry.dispose();
    parts.lip.geometry = new THREE.BoxGeometry(w + 0.14, h + 0.14, depth * 0.55);
    parts.mat.geometry.dispose();
    parts.mat.geometry = new THREE.BoxGeometry(w + 0.05, h + 0.05, depth * 0.22);
  }

  const YT_CSS_W = 480;
  const YT_CSS_H = 270;

  function ytCommand(iframe, func, args = []) {
    try {
      iframe?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
    } catch (_) { /* ignore */ }
  }

  function createWalkGallery(el, photos, options = {}) {
    const THREE = window.THREE;
    const viewport = el.querySelector('.gallery-walk-viewport');
    const canvas = el.querySelector('.gallery-walk-canvas');
    const captionEl = el.querySelector('.gallery-walk-caption');
    const mobileHintEl = el.querySelector('.gallery-walk-hint--mobile');
    const demoBtn = el.querySelector('[data-action="walk-demo"]');
    const cssRoot = el.querySelector('.gallery-walk-css3d');
    const cssCam = el.querySelector('.gallery-walk-css3d-cam');
    const pad = el.querySelector('.gallery-walk-pad');
    if (!viewport || !canvas || !photos.length) return null;

    const FOV_MIN = 32;
    const FOV_MAX = 100;
    const FOV_DEFAULT = 70;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1e);

    const camera = new THREE.PerspectiveCamera(FOV_DEFAULT, 1, 0.1, 80);
    camera.position.set(0, 1.6, 0.5);
    // Three.js cameras look down -Z at rotation.y = 0; the hall runs +Z.
    // yaw 0 = face down the corridor. Add π so look matches walk.
    const YAW_LOOK = Math.PI;

    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0xfff4e6, 0.85);
    key.position.set(2, 6, 4);
    scene.add(key);

    const spacing = 3.4;
    const hallLen = hallLengthForPhotos(photos.length, spacing);
    const hallHalfW = 2.4;
    const wallH = 3.2;
    const WALL_PAD = 0.88;
    const LOOK_FOV = 50;
    scene.fog = new THREE.Fog(0x1a1a1e, hallLen * 0.55, hallLen + 8);

    const floorMat = new THREE.MeshStandardMaterial({ color: 0x3a342c, roughness: 0.85, metalness: 0.05 });
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xe8e2d6, roughness: 0.92 });
    const ceilMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 1 });

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(hallHalfW * 2, hallLen), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, hallLen / 2);
    scene.add(floor);

    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(hallHalfW * 2, hallLen), ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, wallH, hallLen / 2);
    scene.add(ceil);

    const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(hallLen, wallH), wallMat);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.set(-hallHalfW, wallH / 2, hallLen / 2);
    scene.add(leftWall);

    const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(hallLen, wallH), wallMat);
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.position.set(hallHalfW, wallH / 2, hallLen / 2);
    scene.add(rightWall);

    const startWall = new THREE.Mesh(new THREE.PlaneGeometry(hallHalfW * 2, wallH), wallMat);
    startWall.position.set(0, wallH / 2, 0);
    scene.add(startWall);

    const endWall = new THREE.Mesh(new THREE.PlaneGeometry(hallHalfW * 2, wallH), wallMat);
    endWall.rotation.y = Math.PI;
    endWall.position.set(0, wallH / 2, hallLen);
    scene.add(endWall);
    const fallbackTitle = String(options.title || 'Gallery').trim() || 'Gallery';
    const frontTitle = String(options.frontTitle ?? fallbackTitle).trim();
    const backTitle = String(options.backTitle ?? fallbackTitle).trim();
    if (frontTitle) scene.add(makeHallTitleMesh(THREE, frontTitle, hallHalfW, wallH, 0.05, 0));
    if (backTitle) scene.add(makeHallTitleMesh(THREE, backTitle, hallHalfW, wallH, hallLen - 0.05, Math.PI));

    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    const frames = [];
    let audioUnlocked = false;
    let lightboxMute = false;

    function fitPlaneToAspect(mesh, frameGroup, frameParts, frameDepth, aspect, entry) {
      const h = 1.35;
      const w = Math.min(2.1, h * Math.max(0.2, aspect || 1));
      mesh.geometry.dispose();
      mesh.geometry = new THREE.PlaneGeometry(w, h);
      mesh.position.z = 0.04;
      resizeEmbeddedWallFrame(frameParts, frameDepth, w, h);
      if (entry?.ytObj) {
        entry.ytObj.position.copy(mesh.position);
        entry.ytObj.position.z += 0.03;
        entry.ytObj.scale.set(w / YT_CSS_W, h / YT_CSS_H, 1);
      }
      if (entry?.plaque) layoutTitlePlaque(entry.plaque, w, h);
    }

    function tryPlayVideo(video) {
      if (!video || typeof video.play !== 'function') return;
      const p = video.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }

    function applyAudioPlate(mesh, mat, entry, label) {
      const plate = makeAudioPlate(label);
      const tex = new THREE.CanvasTexture(plate);
      tex.colorSpace = THREE.SRGBColorSpace;
      mat.map = tex;
      mat.color.set(0xffffff);
      mat.needsUpdate = true;
      entry.texture = tex;
      entry.kind = 'audio';
      fitPlaneToAspect(mesh, entry.frameGroup, entry.frameParts, entry.frameDepth, 1, entry);
    }

    function mountFileMedia(entry, url, asAudio) {
      const { mesh, frameGroup, frameParts, frameDepth, photo } = entry;
      const mat = mesh.material;
      if (asAudio) applyAudioPlate(mesh, mat, entry, photo.label);
      const el = document.createElement(asAudio ? 'audio' : 'video');
      el.src = url;
      el.crossOrigin = 'anonymous';
      el.loop = true;
      el.preload = 'auto';
      el.muted = true;
      el.volume = 0;
      if (!asAudio) {
        el.playsInline = true;
        el.setAttribute('playsinline', '');
        el.setAttribute('webkit-playsinline', '');
      }
      el.addEventListener('loadedmetadata', () => {
        const hasPicture = !asAudio && el.videoWidth && el.videoHeight;
        if (hasPicture) {
          fitPlaneToAspect(mesh, frameGroup, frameParts, frameDepth, el.videoWidth / el.videoHeight, entry);
        } else if (!asAudio) {
          applyAudioPlate(mesh, mat, entry, photo.label);
        }
      });
      el.addEventListener('error', () => {
        applyAudioPlate(mesh, mat, entry, photo.label);
      });
      if (!asAudio) {
        const tex = new THREE.VideoTexture(el);
        tex.colorSpace = THREE.SRGBColorSpace;
        mat.map = tex;
        mat.color.set(0xffffff);
        mat.needsUpdate = true;
        entry.texture = tex;
      }
      entry.video = el;
      tryPlayVideo(el);
    }

    function unlockAudio() {
      audioUnlocked = true;
      frames.forEach((f) => {
        if (f.video) tryPlayVideo(f.video);
        if (f.iframe) ytCommand(f.iframe, 'playVideo');
      });
      updateVideoAudio();
    }

    function audioScore(frame, dir) {
      if (!frame.video && !frame.iframe) return 0;
      const world = new THREE.Vector3();
      frame.mesh.getWorldPosition(world);
      const to = world.sub(camera.position);
      const dist = to.length();
      const align = dist > 0.001 ? to.normalize().dot(dir) : 1;
      if (dist > 6.5 || align < 0.2) return 0;
      let vol = 1 - (dist - 1.05) / 5.2;
      vol = Math.max(0, Math.min(1, vol));
      vol *= 0.15 + 0.85 * Math.max(0, align);
      return vol;
    }

    function setFrameAudio(frame, vol) {
      const silent = vol <= 0.001;
      if (frame.video) {
        frame.video.muted = silent;
        frame.video.volume = silent ? 0 : vol;
        if (frame.video.paused) tryPlayVideo(frame.video);
      }
      if (frame.iframe) {
        const key = silent ? 'mute' : `vol:${Math.round(vol * 20)}`;
        if (frame._audioKey === key) return;
        frame._audioKey = key;
        if (silent) {
          ytCommand(frame.iframe, 'mute');
          ytCommand(frame.iframe, 'setVolume', [0]);
        } else {
          ytCommand(frame.iframe, 'unMute');
          ytCommand(frame.iframe, 'setVolume', [Math.round(vol * 100)]);
          ytCommand(frame.iframe, 'playVideo');
        }
      }
    }

    function updateVideoAudio() {
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      let best = null;
      let bestScore = 0;
      frames.forEach((f) => {
        const score = audioScore(f, dir);
        if (score > bestScore) {
          bestScore = score;
          best = f;
        }
      });
      const exclusive = !lightboxMute && audioUnlocked && best && bestScore > 0.08;
      frames.forEach((f) => {
        const vol = exclusive && f === best ? bestScore : 0;
        setFrameAudio(f, lightboxMute || !audioUnlocked ? 0 : vol);
      });
    }

    function setLightboxMute(on) {
      lightboxMute = !!on;
      if (cssRoot) cssRoot.hidden = !!on;
      updateVideoAudio();
    }

    function updateCss3d() {
      if (!cssRoot || !cssCam) return;
      const width = viewport.clientWidth || 640;
      const height = viewport.clientHeight || 420;
      cssRoot.style.perspective = 'none';
      cssCam.style.width = `${width}px`;
      cssCam.style.height = `${height}px`;
      cssCam.style.transform = 'none';
      const corner = new THREE.Vector3();
      const look = new THREE.Vector3();
      const world = new THREE.Vector3();
      camera.getWorldDirection(look);
      frames.forEach((f) => {
        if (!f.ytEl || !f.mesh) return;
        f.mesh.getWorldPosition(world);
        const to = world.clone().sub(camera.position);
        const dist = to.length();
        const align = dist > 0.001 ? to.normalize().dot(look) : 0;
        const facing = align > 0.45 && dist < 5.4 && dist > 0.45;
        const geom = f.mesh.geometry?.parameters;
        const hw = (geom?.width || 1.4) * 0.5;
        const hh = (geom?.height || 1.4) * 0.5;
        const locals = [
          [-hw, hh, 0],
          [hw, hh, 0],
          [hw, -hh, 0],
          [-hw, -hh, 0],
        ];
        const pts = [];
        let hidden = !facing;
        for (let i = 0; !hidden && i < 4; i += 1) {
          corner.set(locals[i][0], locals[i][1], locals[i][2]);
          f.mesh.localToWorld(corner);
          corner.project(camera);
          if (corner.z > 1 || corner.z < -1) {
            hidden = true;
            break;
          }
          pts.push({
            x: (corner.x * 0.5 + 0.5) * width,
            y: (-corner.y * 0.5 + 0.5) * height,
          });
        }
        if (hidden || pts.length !== 4) {
          f.ytEl.style.display = 'none';
          f._videoVisible = false;
          return;
        }
        const xs = pts.map(p => p.x);
        const ys = pts.map(p => p.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const bw = maxX - minX;
        const bh = maxY - minY;
        const canVideo = bw >= 96 && bh >= 54 && bw < width * 0.96 && bh < height * 0.96;
        if (!canVideo) {
          f.ytEl.style.display = 'none';
          f._videoVisible = false;
          return;
        }
        f._videoVisible = true;
        f.ytEl.style.display = 'block';
        f.ytEl.style.width = `${Math.round(bw)}px`;
        f.ytEl.style.height = `${Math.round(bh)}px`;
        f.ytEl.style.transformOrigin = '0 0';
        f.ytEl.style.transform = `translate(${Math.round(minX)}px, ${Math.round(minY)}px)`;
      });
    }

    photos.forEach((photo, i) => {
      const side = i % 2 === 0 ? -1 : 1;
      const z = photoWallZ(i, spacing);
      const ytId = photo.youtubeId || extractYoutubeId(photo.src);
      const kind = ytId ? 'youtube'
        : (photo.kind === 'audio' || isAudioSrc(photo.src) ? 'audio'
          : (photo.kind === 'video' || isVideoSrc(photo.src) ? 'video' : 'image'));

      const embedded = createEmbeddedWallFrame(THREE, 1.4, 1.4);
      const { group: frameGroup, parts: frameParts, depth: frameDepth } = embedded;
      frameGroup.position.set(side * (hallHalfW - 0.04), 1.55, z);
      frameGroup.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      scene.add(frameGroup);

      const mat = new THREE.MeshBasicMaterial({ color: 0x222222, side: THREE.FrontSide });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), mat);
      mesh.position.z = 0.04;
      frameGroup.add(mesh);

      const spotTarget = new THREE.Object3D();
      spotTarget.position.copy(mesh.position);
      frameGroup.add(spotTarget);

      const url = resolveMediaHref(photo.src);
      const entry = {
        mesh, frameGroup, frameParts, frameDepth, photo, z, index: i, side, kind,
        video: null, texture: null, youtubeId: ytId, iframe: null, ytObj: null, ytEl: null,
        plaque: null,
      };
      const plaque = makeTitlePlaqueMesh(THREE, photoDisplayTitle(photo, i), 1.4);
      frameGroup.add(plaque);
      entry.plaque = plaque;

      if (kind === 'video' || kind === 'audio') {
        mountFileMedia(entry, url, kind === 'audio');
      } else {
        const texUrl = kind === 'youtube' ? youtubeThumbSrc(ytId) : url;
        const onTex = (t) => {
          t.colorSpace = THREE.SRGBColorSpace;
          mat.map = t;
          mat.color.set(0xffffff);
          mat.needsUpdate = true;
          entry.texture = t;
          const img = t.image;
          const aspect = kind === 'youtube' ? 16 / 9 : (img && img.width && img.height ? img.width / img.height : 1);
          fitPlaneToAspect(mesh, frameGroup, frameParts, frameDepth, aspect, entry);
          spotTarget.position.copy(mesh.position);
        };
        loader.load(texUrl, onTex, undefined, () => {
          if (kind === 'youtube') fitPlaneToAspect(mesh, frameGroup, frameParts, frameDepth, 16 / 9, entry);
        });
      }

      if (kind === 'youtube' && cssCam) {
        fitPlaneToAspect(mesh, frameGroup, frameParts, frameDepth, 16 / 9, entry);
        const ytObj = new THREE.Object3D();
        ytObj.position.copy(mesh.position);
        ytObj.position.z += 0.03;
        const geom = mesh.geometry.parameters;
        ytObj.scale.set((geom.width || 1.4) / YT_CSS_W, (geom.height || 1.4) / YT_CSS_H, 1);
        frameGroup.add(ytObj);

        const iframe = document.createElement('iframe');
        iframe.className = 'gallery-walk-yt';
        iframe.width = String(YT_CSS_W);
        iframe.height = String(YT_CSS_H);
        iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
        iframe.setAttribute('allowfullscreen', '');
        iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
        iframe.title = photo.label || 'YouTube';
        iframe.src = youtubeEmbedSrc(ytId, 'autoplay=1&mute=1&controls=0&loop=1&playlist=' + encodeURIComponent(ytId) + '&enablejsapi=1&iv_load_policy=3');
        iframe.addEventListener('load', () => {
          try {
            iframe.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: ytId }), '*');
          } catch (_) { /* ignore */ }
          ytCommand(iframe, 'playVideo');
          ytCommand(iframe, 'mute');
        });
        cssCam.appendChild(iframe);
        entry.ytObj = ytObj;
        entry.iframe = iframe;
        entry.ytEl = iframe;
      }

      const spot = new THREE.SpotLight(0xffffff, 2.2, 8, Math.PI / 7, 0.4, 1);
      spot.position.set(side * (hallHalfW - 0.55), wallH - 0.35, z);
      spot.target = spotTarget;
      scene.add(spot);

      frames.push(entry);
    });

    const keys = Object.create(null);
    let yaw = 0;
    let pitch = 0;
    let fov = FOV_DEFAULT;
    let locked = false;
    let raf = 0;
    let last = performance.now();
    let destroyed = false;
    let tour = null;
    let approach = null;

    function setFov(next) {
      fov = Math.max(FOV_MIN, Math.min(FOV_MAX, next));
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    function nudgeZoom(dir) {
      setFov(fov + (dir < 0 ? 4.5 : -4.5));
    }

    function syncDemoButton() {
      if (!demoBtn) return;
      const on = !!(tour && tour.active);
      demoBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      demoBtn.textContent = on ? 'Stop tour' : 'Demo tour';
      demoBtn.classList.toggle('active', on);
    }

    function easeInOut(t) {
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }

    function clampHall(x, z) {
      return {
        x: Math.max(-hallHalfW + WALL_PAD, Math.min(hallHalfW - WALL_PAD, x)),
        z: Math.max(0.45, Math.min(hallLen - 0.5, z)),
      };
    }

    function poseInFrontOf(frame, dist) {
      const origin = new THREE.Vector3();
      frame.mesh.getWorldPosition(origin);
      const inward = new THREE.Vector3();
      frame.mesh.getWorldDirection(inward);
      inward.y = 0;
      if (inward.lengthSq() < 1e-6) inward.set(-Math.sign(origin.x || 1), 0, 0);
      else inward.normalize();
      if (origin.x * inward.x > 0.01) inward.negate();
      const pos = origin.clone().addScaledVector(inward, Math.max(WALL_PAD + 0.15, dist));
      const clamped = clampHall(pos.x, origin.z);
      const lookYaw = Math.atan2(origin.x - clamped.x, origin.z - clamped.z);
      return { x: clamped.x, z: clamped.z, yaw: lookYaw };
    }

    function distToFitFrame(frame, fovDeg, fill) {
      const geom = frame.mesh.geometry?.parameters;
      const w = Math.max(0.7, geom?.width || 1.4);
      const h = Math.max(0.7, geom?.height || 1.4);
      const aspect = Math.max(0.5, camera.aspect || 1.6);
      const vFov = THREE.MathUtils.degToRad(fovDeg);
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
      const distH = h / (fill * 2 * Math.tan(vFov / 2));
      const distW = w / (fill * 2 * Math.tan(hFov / 2));
      const dist = Math.max(distH, distW);
      const maxDist = Math.max(WALL_PAD + 0.2, hallHalfW - 0.35);
      return Math.max(WALL_PAD + 0.25, Math.min(maxDist, dist));
    }

    function buildTourWaypoints() {
      const pts = [
        { x: 0, z: 0.7, yaw: Math.PI, pitch: 0, hold: 2.2, fov: 78, travel: 0.7 },
        { x: 0, z: 0.7, yaw: 0, pitch: 0, hold: 1.6, fov: FOV_DEFAULT, travel: 1.0 },
      ];
      frames.forEach((f) => {
        const fill = (f.kind === 'video' || f.kind === 'youtube' || f.kind === 'audio') ? 0.82 : 0.72;
        const close = distToFitFrame(f, LOOK_FOV, fill);
        const front = poseInFrontOf(f, close);
        const dwell = (f.kind === 'video' || f.kind === 'youtube' || f.kind === 'audio') ? 5.2 : 2.8;
        pts.push({
          x: 0,
          z: front.z,
          yaw: front.yaw * 0.22,
          pitch: 0,
          hold: 0.12,
          fov: 58,
          travel: 0.95,
        });
        pts.push({
          x: front.x,
          z: front.z,
          yaw: front.yaw,
          pitch: 0,
          hold: dwell,
          fov: LOOK_FOV,
          travel: 1.25,
        });
        pts.push({
          x: 0,
          z: front.z,
          yaw: 0,
          pitch: 0,
          hold: 0.14,
          fov: FOV_DEFAULT,
          travel: 0.95,
        });
      });
      pts.push({
        x: 0,
        z: Math.max(1, hallLen - 1.2),
        yaw: 0,
        pitch: 0,
        hold: 0.8,
        fov: 78,
        travel: 1.5,
      });
      pts.push({
        x: 0,
        z: Math.max(1, hallLen - 1.2),
        yaw: Math.PI,
        pitch: 0,
        hold: 0.35,
        fov: FOV_DEFAULT,
        travel: 0.7,
      });
      pts.push({
        x: 0,
        z: 0.7,
        yaw: Math.PI,
        pitch: 0,
        hold: 0.35,
        fov: FOV_DEFAULT,
        travel: 2.2,
      });
      pts.push({
        x: 0,
        z: 0.7,
        yaw: 0,
        pitch: 0,
        hold: 0.45,
        fov: FOV_DEFAULT,
        travel: 0.7,
      });
      return pts;
    }

    function stopTour() {
      if (tour) tour.active = false;
      tour = null;
      syncDemoButton();
    }

    function startTour() {
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      approach = null;
      unlockAudio();
      const waypoints = buildTourWaypoints();
      tour = {
        active: true,
        waypoints,
        index: 0,
        phase: 'travel',
        t: 0,
        from: {
          x: camera.position.x,
          z: camera.position.z,
          yaw,
          pitch,
          fov,
        },
      };
      syncDemoButton();
    }

    function toggleTour() {
      if (tour?.active) stopTour();
      else startTour();
    }

    function resize() {
      const w = viewport.clientWidth || 640;
      const h = viewport.clientHeight || 420;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    }

    function nearestFrame() {
      let best = null;
      let bestDist = Infinity;
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      frames.forEach((f) => {
        const world = new THREE.Vector3();
        f.mesh.getWorldPosition(world);
        const to = world.sub(camera.position);
        const dist = to.length();
        const align = to.normalize().dot(dir);
        if (align > 0.55 && dist < bestDist && dist < 6) {
          bestDist = dist;
          best = f;
        }
      });
      return best;
    }

    function nearestCaption() {
      const frame = nearestFrame();
      if (captionEl) {
        if (!frame) {
          captionEl.textContent = '';
          return;
        }
        const base = photoDisplayTitle(frame.photo, frame.index);
        if (frame.kind === 'youtube') {
          captionEl.textContent = frame._videoVisible ? `${base} · video` : `${base} · sound`;
        } else if (frame.kind === 'video' || frame.kind === 'audio') {
          captionEl.textContent = `${base} · ${frame.kind === 'audio' ? 'sound' : 'video'}`;
        } else {
          captionEl.textContent = base;
        }
      }
    }

    function openFramePhoto(frame) {
      if (!frame) return;
      stopTour();
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      openLightbox(photos, frame.index, {
        onOpen: () => setLightboxMute(true),
        onClose: () => setLightboxMute(false),
      });
    }

    function openNearestPhoto() {
      openFramePhoto(nearestFrame());
    }

    function lerpAngle(a, b, t) {
      let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (d < -Math.PI) d += Math.PI * 2;
      return a + d * t;
    }

    function advanceTour(dt) {
      if (!tour?.active) return;
      const wp = tour.waypoints[tour.index];
      if (!wp) {
        stopTour();
        return;
      }

      if (tour.phase === 'travel') {
        tour.t += dt;
        const dur = Math.max(0.35, wp.travel || 1.2);
        const u = easeInOut(Math.min(1, tour.t / dur));
        camera.position.x = tour.from.x + (wp.x - tour.from.x) * u;
        camera.position.z = tour.from.z + (wp.z - tour.from.z) * u;
        yaw = lerpAngle(tour.from.yaw, wp.yaw, u);
        pitch = tour.from.pitch + (wp.pitch - tour.from.pitch) * u;
        setFov(tour.from.fov + (wp.fov - tour.from.fov) * u);
        if (u >= 1) {
          tour.phase = 'hold';
          tour.t = 0;
          camera.position.x = wp.x;
          camera.position.z = wp.z;
          yaw = wp.yaw;
          pitch = wp.pitch;
          setFov(wp.fov);
        }
        return;
      }

      tour.t += dt;
      if (tour.t < (wp.hold || 0.2)) return;
      tour.index += 1;
      if (tour.index >= tour.waypoints.length) {
        tour.index = 0;
      }
      tour.phase = 'travel';
      tour.t = 0;
      tour.from = {
        x: camera.position.x,
        z: camera.position.z,
        yaw,
        pitch,
        fov,
      };
    }

    function distAlongNormal(frame) {
      const origin = new THREE.Vector3();
      frame.mesh.getWorldPosition(origin);
      const normal = new THREE.Vector3();
      frame.mesh.getWorldDirection(normal);
      if (origin.x * normal.x > 0.01) normal.negate();
      return Math.abs(camera.position.clone().sub(origin).dot(normal));
    }

    function frameAtClient(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return null;
      const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
      const objects = [];
      frames.forEach((f) => {
        if (f.mesh) objects.push(f.mesh);
        if (f.frameGroup) objects.push(f.frameGroup);
      });
      if (!objects.length) return null;
      const raycaster = new THREE.Raycaster();
      const samples = [[0, 0], [-0.07, 0], [0.07, 0], [0, -0.09], [0, 0.09]];
      for (let s = 0; s < samples.length; s += 1) {
        raycaster.setFromCamera(new THREE.Vector2(ndcX + samples[s][0], ndcY + samples[s][1]), camera);
        const hits = raycaster.intersectObjects(objects, true);
        if (!hits.length) continue;
        let obj = hits[0].object;
        while (obj) {
          const found = frames.find((f) => f.mesh === obj || f.frameGroup === obj);
          if (found) return found;
          obj = obj.parent;
        }
      }
      return null;
    }

    function stepCloserToFrame(frame) {
      if (!frame?.mesh) return;
      if (tour?.active) stopTour();
      const world = new THREE.Vector3();
      frame.mesh.getWorldPosition(world);
      const from = {
        x: camera.position.x,
        z: camera.position.z,
        yaw,
        pitch,
        fov,
      };
      const toward = new THREE.Vector3(world.x - from.x, 0, world.z - from.z);
      const planar = toward.length();
      const minKeep = Math.max(WALL_PAD + 0.18, distToFitFrame(frame, LOOK_FOV, 0.78));
      const along = distAlongNormal(frame);
      const room = Math.max(0, Math.min(planar, along) - minKeep);
      const step = Math.min(0.7, room);
      if (step < 0.06) {
        setFov(fov - 6);
        return;
      }
      toward.normalize().multiplyScalar(step);
      const clamped = clampHall(from.x + toward.x, from.z + toward.z);
      const lookYaw = Math.atan2(world.x - clamped.x, world.z - clamped.z);
      approach = {
        from,
        to: {
          x: clamped.x,
          z: clamped.z,
          yaw: lookYaw,
          pitch: -0.02,
          fov: Math.max(LOOK_FOV, fov - 5),
        },
        t: 0,
        dur: 0.36,
      };
    }

    function advanceApproach(dt) {
      if (!approach) return false;
      approach.t += dt;
      const u = easeInOut(Math.min(1, approach.t / approach.dur));
      camera.position.x = approach.from.x + (approach.to.x - approach.from.x) * u;
      camera.position.z = approach.from.z + (approach.to.z - approach.from.z) * u;
      yaw = lerpAngle(approach.from.yaw, approach.to.yaw, u);
      pitch = approach.from.pitch + (approach.to.pitch - approach.from.pitch) * u;
      setFov(approach.from.fov + (approach.to.fov - approach.from.fov) * u);
      if (u >= 1) approach = null;
      return true;
    }

    function tick(now) {
      if (destroyed) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (advanceApproach(dt)) {
        /* stepping toward a tapped photo */
      } else if (tour?.active) {
        advanceTour(dt);
      } else {
        const speed = (keys.ShiftLeft || keys.ShiftRight ? 4.2 : 2.4) * dt;
        const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
        const move = new THREE.Vector3();
        if (keys.KeyW || keys.ArrowUp) move.add(forward);
        if (keys.KeyS || keys.ArrowDown) move.sub(forward);
        if (keys.KeyA || keys.ArrowLeft) move.add(right);
        if (keys.KeyD || keys.ArrowRight) move.sub(right);
        if (move.lengthSq() > 0) {
          move.normalize().multiplyScalar(speed);
          camera.position.add(move);
        }
      }

      camera.position.x = Math.max(-hallHalfW + WALL_PAD, Math.min(hallHalfW - WALL_PAD, camera.position.x));
      camera.position.z = Math.max(0.4, Math.min(hallLen - 0.5, camera.position.z));
      camera.position.y = 1.6;
      camera.rotation.order = 'YXZ';
      camera.rotation.y = yaw + YAW_LOOK;
      camera.rotation.x = pitch;

      updateCss3d();
      updateVideoAudio();
      nearestCaption();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    }

    function onKeyDown(e) {
      if (!el.contains(document.activeElement) && document.pointerLockElement !== canvas && !locked) return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      keys[e.code] = true;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        if (tour?.active) stopTour();
        e.preventDefault();
      }
      if (['Equal', 'NumpadAdd', 'Minus', 'NumpadSubtract'].includes(e.code)) {
        if (tour?.active) stopTour();
        e.preventDefault();
        if (!e.repeat) nudgeZoom(e.code === 'Minus' || e.code === 'NumpadSubtract' ? -1 : 1);
      }
      if (e.code === 'Space') {
        e.preventDefault();
        const lbOpen = document.getElementById('notespro-gallery-lightbox');
        if (lbOpen && !lbOpen.hidden) return;
        if (!e.repeat) openNearestPhoto();
      }
      if (e.code === 'Escape' && document.pointerLockElement === canvas) {
        document.exitPointerLock();
      }
    }
    function onKeyUp(e) {
      keys[e.code] = false;
    }

    function onMouseMove(e) {
      if (document.pointerLockElement !== canvas) return;
      if (tour?.active) stopTour();
      yaw -= e.movementX * 0.0022;
      pitch -= e.movementY * 0.0022;
      pitch = Math.max(-1.2, Math.min(1.2, pitch));
    }

    function onWheel(e) {
      e.preventDefault();
      const delta = e.deltaY;
      // scroll up (negative) → closer (narrower FOV); scroll down → wider
      setFov(fov + (delta > 0 ? 4.5 : -4.5));
    }

    function requestLook() {
      if (ignoreNextLookClick) {
        ignoreNextLookClick = false;
        return;
      }
      enterGallery({ startDemo: false, stopTourIfActive: true, lockPointer: !isGalleryMobile() });
    }

    let entered = false;
    let ignoreNextLookClick = false;

    function enterGallery({ startDemo = false, stopTourIfActive = false, lockPointer = false } = {}) {
      if (stopTourIfActive && tour?.active) stopTour();
      unlockAudio();
      viewport.focus({ preventScroll: true });
      if (lockPointer) canvas.requestPointerLock?.();
      if (startDemo && options.demo && !tour?.active) startTour();
      entered = true;
      if (isGalleryMobile() && mobileHintEl) {
        mobileHintEl.textContent = 'WASD pad walk · +/− zoom · tap a picture to open · drag to look';
      }
    }

    let dragLook = null;
    const TAP_MOVE_PX = 16;
    function onPointerDownLook(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (isGalleryMobile() && !entered) {
        enterGallery({ startDemo: !!options.demo, stopTourIfActive: false, lockPointer: false });
        ignoreNextLookClick = true;
        return;
      }
      if (tour?.active) stopTour();
      unlockAudio();
      viewport.focus({ preventScroll: true });
      if (document.pointerLockElement === canvas) return;
      dragLook = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        sx: e.clientX,
        sy: e.clientY,
        dist: 0,
      };
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    }
    function onPointerMoveLook(e) {
      if (!dragLook || e.pointerId !== dragLook.id) return;
      if (document.pointerLockElement === canvas) return;
      const dx = e.clientX - dragLook.x;
      const dy = e.clientY - dragLook.y;
      dragLook.x = e.clientX;
      dragLook.y = e.clientY;
      dragLook.dist += Math.hypot(dx, dy);
      if (dragLook.dist > TAP_MOVE_PX && approach) approach = null;
      yaw -= dx * 0.0045;
      pitch -= dy * 0.0045;
      pitch = Math.max(-1.2, Math.min(1.2, pitch));
    }
    function onPointerUpLook(e) {
      if (!dragLook || e.pointerId !== dragLook.id) return;
      const wasTap = dragLook.dist < TAP_MOVE_PX;
      const sx = dragLook.sx;
      const sy = dragLook.sy;
      dragLook = null;
      if (!wasTap) return;
      const frame = frameAtClient(sx, sy);
      if (frame) {
        ignoreNextLookClick = true;
        openFramePhoto(frame);
      }
    }
    function onPointerCancelLook(e) {
      if (!dragLook || e.pointerId !== dragLook.id) return;
      dragLook = null;
    }

    function onLockChange() {
      locked = document.pointerLockElement === canvas;
      viewport.classList.toggle('gallery-walk-viewport--locked', locked);
    }

    function syncPad() {
      if (!pad) return;
      const mobile = isGalleryMobile();
      el.classList.toggle('gallery-block--mobile', mobile);
      pad.classList.toggle('is-visible', mobile);
    }

    function bindPad() {
      if (!pad) return () => {};
      const held = new Map();
      let zoomTimer = 0;
      const setKey = (code, down, btn) => {
        if (!code) return;
        keys[code] = !!down;
        btn?.classList.toggle('is-active', !!down);
        if (down) {
          enterGallery({ startDemo: false, stopTourIfActive: true, lockPointer: false });
        }
      };
      const stopZoomRepeat = () => {
        if (zoomTimer) {
          clearInterval(zoomTimer);
          zoomTimer = 0;
        }
      };
      const startZoom = (dir, btn) => {
        enterGallery({ startDemo: false, stopTourIfActive: true, lockPointer: false });
        nudgeZoom(dir);
        btn?.classList.add('is-active');
        stopZoomRepeat();
        zoomTimer = window.setInterval(() => nudgeZoom(dir), 140);
      };
      const onDown = (event) => {
        const btn = event.currentTarget;
        const code = btn.getAttribute('data-key');
        const zoom = btn.getAttribute('data-zoom');
        if (!code && !zoom) return;
        event.preventDefault();
        event.stopPropagation();
        try { btn.setPointerCapture(event.pointerId); } catch (_) { /* ignore */ }
        if (zoom) {
          held.set(event.pointerId, { zoom, btn });
          startZoom(zoom === 'in' ? 1 : -1, btn);
          return;
        }
        held.set(event.pointerId, { code, btn });
        setKey(code, true, btn);
      };
      const onUp = (event) => {
        const rec = held.get(event.pointerId);
        if (!rec) return;
        held.delete(event.pointerId);
        if (rec.zoom) {
          stopZoomRepeat();
          rec.btn?.classList.remove('is-active');
          return;
        }
        setKey(rec.code, false, rec.btn);
      };
      const onContext = (event) => event.preventDefault();
      pad.querySelectorAll('[data-key], [data-zoom]').forEach((btn) => {
        btn.addEventListener('pointerdown', onDown);
        btn.addEventListener('pointerup', onUp);
        btn.addEventListener('pointercancel', onUp);
        btn.addEventListener('lostpointercapture', onUp);
        btn.addEventListener('contextmenu', onContext);
      });
      return () => {
        pad.querySelectorAll('[data-key], [data-zoom]').forEach((btn) => {
          btn.removeEventListener('pointerdown', onDown);
          btn.removeEventListener('pointerup', onUp);
          btn.removeEventListener('pointercancel', onUp);
          btn.removeEventListener('lostpointercapture', onUp);
          btn.removeEventListener('contextmenu', onContext);
        });
        stopZoomRepeat();
        held.forEach((rec) => {
          if (rec.zoom) rec.btn?.classList.remove('is-active');
          else setKey(rec.code, false, rec.btn);
        });
        held.clear();
      };
    }

    const unbindPad = bindPad();
    const onWinResize = () => {
      resize();
      syncPad();
    };

    canvas.addEventListener('click', requestLook);
    canvas.addEventListener('pointerdown', onPointerDownLook);
    canvas.addEventListener('pointermove', onPointerMoveLook);
    canvas.addEventListener('pointerup', onPointerUpLook);
    canvas.addEventListener('pointercancel', onPointerCancelLook);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    viewport.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('mousemove', onMouseMove);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('resize', onWinResize);

    el.addEventListener('notespro:monitor-fullscreen', () => {
      requestAnimationFrame(() => {
        resize();
        syncPad();
      });
    });

    resize();
    syncPad();
    raf = requestAnimationFrame(tick);
    syncDemoButton();
    if (options.demo) {
      requestAnimationFrame(() => startTour());
    }

    return {
      focus: requestLook,
      toggleTour,
      startTour,
      stopTour,
      unlockAudio,
      setLightboxMute,
      destroy() {
        destroyed = true;
        stopTour();
        cancelAnimationFrame(raf);
        if (document.pointerLockElement === canvas) document.exitPointerLock();
        canvas.removeEventListener('click', requestLook);
        canvas.removeEventListener('pointerdown', onPointerDownLook);
        canvas.removeEventListener('pointermove', onPointerMoveLook);
        canvas.removeEventListener('pointerup', onPointerUpLook);
        canvas.removeEventListener('pointercancel', onPointerCancelLook);
        canvas.removeEventListener('wheel', onWheel);
        viewport.removeEventListener('wheel', onWheel);
        document.removeEventListener('pointerlockchange', onLockChange);
        document.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('resize', onWinResize);
        unbindPad();
        frames.forEach((f) => {
          if (f.video) {
            f.video.pause();
            f.video.removeAttribute('src');
            f.video.load();
          }
          if (f.iframe) {
            f.iframe.src = 'about:blank';
            f.iframe.remove();
          }
          f.texture?.dispose?.();
        });
        renderer.dispose();
        scene.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose?.());
            else obj.material.dispose?.();
          }
        });
      },
    };
  }

  function ensureLightbox() {
    let root = document.getElementById('notespro-gallery-lightbox');
    if (root) {
      if (!root.querySelector('.gallery-lightbox-yt')) {
        const iframe = document.createElement('iframe');
        iframe.className = 'gallery-lightbox-yt';
        iframe.hidden = true;
        iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
        iframe.setAttribute('allowfullscreen', '');
        iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
        iframe.title = 'YouTube video player';
        root.querySelector('.gallery-lightbox-frame')?.appendChild(iframe);
      }
      return root;
    }
    root = document.createElement('div');
    root.id = 'notespro-gallery-lightbox';
    root.className = 'gallery-lightbox';
    root.hidden = true;
    root.innerHTML = [
      `<div class="gallery-lightbox-backdrop" data-action="close"></div>`,
      `<div class="gallery-lightbox-stage" role="dialog" aria-modal="true" aria-label="Media viewer">`,
      `<button type="button" class="gallery-lightbox-close" data-action="close" aria-label="Close">×</button>`,
      `<button type="button" class="gallery-lightbox-nav gallery-lightbox-prev" data-action="prev" aria-label="Previous">‹</button>`,
      `<figure class="gallery-lightbox-figure">`,
      `<div class="gallery-lightbox-frame">`,
      `<img class="gallery-lightbox-img" alt="">`,
      `<video class="gallery-lightbox-video" controls playsinline loop hidden></video>`,
      `<iframe class="gallery-lightbox-yt" hidden allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" title="YouTube video player"></iframe>`,
      `</div>`,
      `<figcaption class="gallery-lightbox-caption"></figcaption>`,
      `</figure>`,
      `<button type="button" class="gallery-lightbox-nav gallery-lightbox-next" data-action="next" aria-label="Next">›</button>`,
      `<div class="gallery-lightbox-counter" aria-live="polite"></div>`,
      `</div>`,
    ].join('');
    document.body.appendChild(root);

    root.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (!action) return;
      if (action === 'close') {
        if (Date.now() - lightboxOpenedAt < 500) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        closeLightbox();
      }
      if (action === 'prev') stepLightbox(-1);
      if (action === 'next') stepLightbox(1);
    });

    document.addEventListener('keydown', (e) => {
      if (root.hidden) return;
      if (document.pointerLockElement) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeLightbox();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepLightbox(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepLightbox(1);
      }
    });

    return root;
  }

  let lightboxState = { photos: [], index: 0, onClose: null };
  let lightboxOpenedAt = 0;

  function stopLightboxVideo() {
    const root = document.getElementById('notespro-gallery-lightbox');
    const video = root?.querySelector('.gallery-lightbox-video');
    const yt = root?.querySelector('.gallery-lightbox-yt');
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.hidden = true;
    }
    if (yt) {
      yt.hidden = true;
      yt.removeAttribute('src');
    }
  }

  function renderLightbox() {
    const root = ensureLightbox();
    const photo = lightboxState.photos[lightboxState.index];
    if (!photo) {
      closeLightbox();
      return;
    }
    const img = root.querySelector('.gallery-lightbox-img');
    const video = root.querySelector('.gallery-lightbox-video');
    const yt = root.querySelector('.gallery-lightbox-yt');
    const caption = root.querySelector('.gallery-lightbox-caption');
    const counter = root.querySelector('.gallery-lightbox-counter');
    const href = resolveMediaHref(photo.src);
    const ytId = photo.youtubeId || extractYoutubeId(photo.src);
    const isVideo = photo.kind === 'video' || photo.kind === 'audio' || isVideoSrc(photo.src) || isAudioSrc(photo.src);
    if (ytId) {
      stopLightboxVideo();
      img.hidden = true;
      img.removeAttribute('src');
      video.hidden = true;
      yt.hidden = false;
      yt.src = youtubeEmbedSrc(ytId, 'autoplay=1');
    } else if (isVideo) {
      if (yt) {
        yt.hidden = true;
        yt.removeAttribute('src');
      }
      img.hidden = true;
      img.removeAttribute('src');
      video.hidden = false;
      video.pause();
      video.src = href;
      video.muted = false;
      video.volume = 1;
      video.play().catch(() => {
        video.muted = true;
        video.play().catch(() => {});
      });
    } else {
      stopLightboxVideo();
      video.hidden = true;
      if (yt) yt.hidden = true;
      img.hidden = false;
      img.src = href;
      img.alt = photo.label || `Photo ${lightboxState.index + 1}`;
    }
    caption.textContent = photo.label || (ytId ? 'YouTube' : '');
    counter.textContent = `${lightboxState.index + 1} / ${lightboxState.photos.length}`;
    root.querySelector('.gallery-lightbox-prev').disabled = lightboxState.photos.length < 2;
    root.querySelector('.gallery-lightbox-next').disabled = lightboxState.photos.length < 2;
  }

  function openLightbox(photos, index, hooks = {}) {
    if (!photos?.length) return;
    if (typeof lightboxState.onClose === 'function') {
      try { lightboxState.onClose(); } catch (_) { /* ignore */ }
    }
    lightboxState = {
      photos: photos.slice(),
      index: Math.max(0, Math.min(index, photos.length - 1)),
      onClose: typeof hooks.onClose === 'function' ? hooks.onClose : null,
    };
    lightboxOpenedAt = Date.now();
    const root = ensureLightbox();
    root.hidden = false;
    document.body.classList.add('gallery-lightbox-open');
    if (typeof hooks.onOpen === 'function') hooks.onOpen();
    renderLightbox();
    root.querySelector('.gallery-lightbox-close')?.focus({ preventScroll: true });
  }

  function closeLightbox() {
    const root = document.getElementById('notespro-gallery-lightbox');
    if (!root) return;
    stopLightboxVideo();
    root.hidden = true;
    document.body.classList.remove('gallery-lightbox-open');
    if (typeof lightboxState.onClose === 'function') {
      const cb = lightboxState.onClose;
      lightboxState.onClose = null;
      try { cb(); } catch (_) { /* ignore */ }
    }
  }

  function stepLightbox(delta) {
    const n = lightboxState.photos.length;
    if (n < 2) return;
    lightboxState.index = (lightboxState.index + delta + n) % n;
    renderLightbox();
  }

  function hydrateBlock(el, options = {}) {
    if (!el || el.dataset.galleryHydrated === '1') return;
    const spec = decodeSpec(el.dataset.gallerySpec);
    if (!spec) return;
    el.dataset.galleryHydrated = '1';
    bindFullscreenButton(el);

    let walk = null;
    if (spec.mode === 'walk' && spec.photos?.length) {
      const startWalk = () => {
        if (!el.isConnected) return;
        if (!threeReady()) {
          setStatus(el, 'Three.js not loaded — walk mode unavailable.');
          return;
        }
        walk = createWalkGallery(el, spec.photos, {
          demo: !!spec.demo,
          title: spec.title,
          frontTitle: spec.frontTitle,
          backTitle: spec.backTitle,
        });
      };
      whenThreeReady(startWalk, startWalk);
      const disconnectObs = new MutationObserver(() => {
        if (!el.isConnected) {
          walk?.destroy();
          disconnectObs.disconnect();
        }
      });
      disconnectObs.observe(document.body, { childList: true, subtree: true });
    }

    el.addEventListener('click', (e) => {
      if (e.target.closest('.game-fullscreen-btn')) return;
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'walk-focus') {
        walk?.focus();
        return;
      }
      if (action === 'walk-demo') {
        walk?.unlockAudio?.();
        walk?.toggleTour();
        return;
      }
      if (action === 'export-html') {
        void downloadStandaloneTour(spec, el);
        return;
      }
      if (action === 'toggle-grid') {
        const grid = el.querySelector('.gallery-grid--compact');
        grid?.classList.toggle('d-none');
        return;
      }
      if (action === 'add-photo') {
        setStatus(el, 'Paste an image, a YouTube link/iframe (Ctrl+V), or drop a file onto the gallery.');
        el.focus({ preventScroll: true });
        return;
      }
      const thumb = e.target.closest('.gallery-thumb:not(.gallery-thumb--add)');
      if (thumb && spec.photos?.length) {
        const idx = parseInt(thumb.dataset.galleryIndex, 10) || 0;
        openLightbox(spec.photos, idx, {
          onOpen: () => walk?.setLightboxMute?.(true),
          onClose: () => walk?.setLightboxMute?.(false),
        });
      }
      const pasteZone = e.target.closest('.gallery-paste-zone');
      if (pasteZone) pasteZone.focus();
    });

    if (typeof options.onPasteImage !== 'function' && typeof options.onPasteYoutube !== 'function') return;

    async function handlePasteFiles(files) {
      const imageFiles = [...files].filter(f => f && String(f.type || '').startsWith('image/'));
      if (!imageFiles.length) return false;
      el.classList.add('gallery-block--uploading');
      setStatus(el, 'Uploading…');
      try {
        for (const file of imageFiles) {
          await options.onPasteImage(file, spec);
        }
      } finally {
        el.classList.remove('gallery-block--uploading');
      }
      return true;
    }

    el.addEventListener('paste', (e) => {
      const html = e.clipboardData?.getData('text/html') || '';
      const text = e.clipboardData?.getData('text/plain') || html;
      const ytId = extractYoutubeId(text) || extractYoutubeId(html);
      if (ytId && typeof options.onPasteYoutube === 'function') {
        e.preventDefault();
        e.stopPropagation();
        setStatus(el, 'Added YouTube clip.');
        void options.onPasteYoutube(ytId, spec);
        return;
      }
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

    el.addEventListener('dragover', (e) => {
      if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
      e.preventDefault();
      el.classList.add('gallery-block--drop');
    });
    el.addEventListener('dragleave', () => el.classList.remove('gallery-block--drop'));
    el.addEventListener('drop', (e) => {
      el.classList.remove('gallery-block--drop');
      const files = [...(e.dataTransfer?.files || [])].filter(f => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      e.stopPropagation();
      void handlePasteFiles(files);
    });

    el.addEventListener('click', (e) => {
      const pickHit = e.target.closest('[data-action="add-photo"], .gallery-paste-zone');
      if (!pickHit) return;
      const mobile = document.body.classList.contains('mobile-layout')
        || (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 768px)').matches);
      const openPicker = mobile || pickHit.matches('[data-action="add-photo"]');
      try { el.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
      if (!openPicker) return;
      const pick = window.NotesProPhotocube?.pickImageFiles;
      if (typeof pick !== 'function') return;
      e.preventDefault();
      void pick().then((files) => {
        if (files.length) return handlePasteFiles(files);
      });
    });
  }

  function slugifyTitle(title) {
    return String(title || 'gallery').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'gallery';
  }

  function downloadTextFile(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function standaloneTourModuleSource() {
    return [
      '(function (THREE) {',
      '  const spec = JSON.parse(document.getElementById("tour-data").textContent);',
      '  const photos = spec.photos || [];',
      '  const canvas = document.getElementById("tour-canvas");',
      '  const demoBtn = document.getElementById("tour-toggle");',
      '  const captionEl = document.getElementById("tour-caption");',
      '  if (!THREE || !canvas || !photos.length) {',
      '    if (captionEl) captionEl.textContent = "Could not load Three.js.";',
      '    return;',
      '  }',
      '  photos.forEach(function (p) {',
      '    if (p.texSrc) return;',
      '    if (p.dataUrl) {',
      '      try {',
      '        const parts = String(p.dataUrl).split(",");',
      '        const mime = (/data:([^;]+)/.exec(parts[0]) || [])[1] || "image/png";',
      '        const bin = atob(parts[1] || "");',
      '        const bytes = new Uint8Array(bin.length);',
      '        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);',
      '        p.texSrc = URL.createObjectURL(new Blob([bytes], { type: mime }));',
      '      } catch (err) { p.texSrc = p.dataUrl; }',
      '    } else {',
      '      p.texSrc = p.src;',
      '    }',
      '  });',
      '  const YAW_LOOK = Math.PI;',
      '  const FOV_DEFAULT = 70;',
      '  const LOOK_FOV = 50;',
      '  const WALL_PAD = 0.88;',
      '  const spacing = 3.4;',
      '  const hallHalfW = 2.4;',
      '  const wallH = 3.2;',
      '  function photoZ(i) { return 2.5 + Math.floor(i / 2) * spacing + (i % 2) * (spacing * 0.35); }',
      '  const hallLen = photoZ(Math.max(0, photos.length - 1)) + 1.05 + 1.4;',
      '  const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });',
      '  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));',
      '  renderer.outputColorSpace = THREE.SRGBColorSpace;',
      '  const scene = new THREE.Scene();',
      '  scene.background = new THREE.Color(0x1a1a1e);',
      '  scene.fog = new THREE.Fog(0x1a1a1e, hallLen * 0.55, hallLen + 8);',
      '  const camera = new THREE.PerspectiveCamera(FOV_DEFAULT, 1, 0.1, 80);',
      '  camera.position.set(0, 1.6, 0.5);',
      '  scene.add(new THREE.AmbientLight(0xffffff, 0.55));',
      '  const key = new THREE.DirectionalLight(0xfff4e6, 0.85);',
      '  key.position.set(2, 6, 4);',
      '  scene.add(key);',
      '  const floorMat = new THREE.MeshStandardMaterial({ color: 0x3a342c, roughness: 0.85, metalness: 0.05 });',
      '  const wallMat = new THREE.MeshStandardMaterial({ color: 0xe8e2d6, roughness: 0.92 });',
      '  const ceilMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 1 });',
      '  const floor = new THREE.Mesh(new THREE.PlaneGeometry(hallHalfW * 2, hallLen), floorMat);',
      '  floor.rotation.x = -Math.PI / 2;',
      '  floor.position.set(0, 0, hallLen / 2);',
      '  scene.add(floor);',
      '  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(hallHalfW * 2, hallLen), ceilMat);',
      '  ceil.rotation.x = Math.PI / 2;',
      '  ceil.position.set(0, wallH, hallLen / 2);',
      '  scene.add(ceil);',
      '  const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(hallLen, wallH), wallMat);',
      '  leftWall.rotation.y = Math.PI / 2;',
      '  leftWall.position.set(-hallHalfW, wallH / 2, hallLen / 2);',
      '  scene.add(leftWall);',
      '  const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(hallLen, wallH), wallMat);',
      '  rightWall.rotation.y = -Math.PI / 2;',
      '  rightWall.position.set(hallHalfW, wallH / 2, hallLen / 2);',
      '  scene.add(rightWall);',
      '  const startWall = new THREE.Mesh(new THREE.PlaneGeometry(hallHalfW * 2, wallH), wallMat);',
      '  startWall.position.set(0, wallH / 2, 0);',
      '  scene.add(startWall);',
      '  const endWall = new THREE.Mesh(new THREE.PlaneGeometry(hallHalfW * 2, wallH), wallMat);',
      '  endWall.rotation.y = Math.PI;',
      '  endWall.position.set(0, wallH / 2, hallLen);',
      '  scene.add(endWall);',
      '  (function addHallTitles() {',
      '    const fallback = String(spec.title || "Gallery").trim() || "Gallery";',
      '    const frontTitle = String(spec.frontTitle == null ? fallback : spec.frontTitle).trim();',
      '    const backTitle = String(spec.backTitle == null ? fallback : spec.backTitle).trim();',
      '    function makeTitle(text, z, rotY) {',
      '      if (!text) return;',
      '      const c = document.createElement("canvas");',
      '      c.width = 2048; c.height = 768;',
      '      const g = c.getContext("2d");',
      '      g.fillStyle = "#1c1814"; g.fillRect(0, 0, 2048, 768);',
      '      g.strokeStyle = "#c9a227"; g.lineWidth = 24; g.strokeRect(20, 20, 2008, 728);',
      '      g.strokeStyle = "#f4ead6"; g.lineWidth = 6; g.strokeRect(48, 48, 1952, 672);',
      '      g.fillStyle = "#f4ead6"; g.textAlign = "center"; g.textBaseline = "middle";',
      '      let label = text; let size = 240;',
      '      g.font = "700 " + size + "px Georgia, Times New Roman, serif";',
      '      while (size > 64 && g.measureText(label).width > 1860) { size -= 6; g.font = "700 " + size + "px Georgia, Times New Roman, serif"; }',
      '      if (g.measureText(label).width > 1860) { while (label.length > 4 && g.measureText(label + "…").width > 1860) label = label.slice(0, -1); label += "…"; }',
      '      g.fillText(label, 1024, 384);',
      '      const tex = new THREE.CanvasTexture(c);',
      '      tex.colorSpace = THREE.SRGBColorSpace;',
      '      const w = Math.min(4.35, hallHalfW * 2 - 0.3);',
      '      const h = w * (768 / 2048);',
      '      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));',
      '      mesh.position.set(0, wallH * 0.58, z);',
      '      mesh.rotation.y = rotY;',
      '      scene.add(mesh);',
      '    }',
      '    makeTitle(frontTitle, 0.05, 0);',
      '    makeTitle(backTitle, hallLen - 0.05, Math.PI);',
      '  })();',
      '  function makePlaque(text, width) {',
      '    const c = document.createElement("canvas");',
      '    c.width = 768; c.height = 128;',
      '    const g = c.getContext("2d");',
      '    g.fillStyle = "#1c1814"; g.fillRect(0, 0, 768, 128);',
      '    g.strokeStyle = "#c9a227"; g.lineWidth = 5; g.strokeRect(6, 6, 756, 116);',
      '    g.fillStyle = "#f4ead6"; g.textAlign = "center"; g.textBaseline = "middle";',
      '    let label = String(text || "Photo");',
      '    let size = 42;',
      '    g.font = "600 " + size + "px Segoe UI, system-ui, sans-serif";',
      '    while (size > 22 && g.measureText(label).width > 700) { size -= 2; g.font = "600 " + size + "px Segoe UI, system-ui, sans-serif"; }',
      '    if (g.measureText(label).width > 700) { while (label.length > 4 && g.measureText(label + "…").width > 700) label = label.slice(0, -1); label += "…"; }',
      '    g.fillText(label, 384, 66);',
      '    const tex = new THREE.CanvasTexture(c);',
      '    tex.colorSpace = THREE.SRGBColorSpace;',
      '    const pw = Math.max(0.7, width * 0.92);',
      '    const ph = 0.2;',
      '    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));',
      '    mesh.position.set(0, -(1.35 / 2) - 0.16 - ph / 2, 0.05);',
      '    return mesh;',
      '  }',
      '  function layoutPlaque(plaque, w, h) {',
      '    if (!plaque) return;',
      '    const pw = Math.max(0.7, w * 0.92); const ph = 0.2;',
      '    plaque.geometry.dispose();',
      '    plaque.geometry = new THREE.PlaneGeometry(pw, ph);',
      '    plaque.position.set(0, -(h / 2) - 0.16 - ph / 2, 0.05);',
      '  }',
      '  function makeFrame(w, h) {',
      '    const depth = 0.14;',
      '    const group = new THREE.Group();',
      '    const wood = new THREE.MeshStandardMaterial({ color: 0x4a3728, roughness: 0.58, metalness: 0.05 });',
      '    const gold = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.34, metalness: 0.58 });',
      '    const matBoard = new THREE.MeshStandardMaterial({ color: 0xf7f3ea, roughness: 0.98 });',
      '    const outer = new THREE.Mesh(new THREE.BoxGeometry(w + 0.24, h + 0.24, depth), wood);',
      '    const lip = new THREE.Mesh(new THREE.BoxGeometry(w + 0.14, h + 0.14, depth * 0.55), gold);',
      '    const mat = new THREE.Mesh(new THREE.BoxGeometry(w + 0.05, h + 0.05, depth * 0.22), matBoard);',
      '    outer.position.z = -depth / 2; lip.position.z = -depth * 0.28; mat.position.z = -depth * 0.14;',
      '    group.add(outer, lip, mat);',
      '    return { group: group, outer: outer, lip: lip, mat: mat, depth: depth };',
      '  }',
      '  function resizeFrame(fr, w, h) {',
      '    fr.outer.geometry.dispose(); fr.outer.geometry = new THREE.BoxGeometry(w + 0.24, h + 0.24, fr.depth);',
      '    fr.lip.geometry.dispose(); fr.lip.geometry = new THREE.BoxGeometry(w + 0.14, h + 0.14, fr.depth * 0.55);',
      '    fr.mat.geometry.dispose(); fr.mat.geometry = new THREE.BoxGeometry(w + 0.05, h + 0.05, fr.depth * 0.22);',
      '  }',
      '  function loadTex(url, onOk, onErr) {',
      '    const img = new Image();',
      '    if (/^https?:/i.test(url)) img.crossOrigin = "anonymous";',
      '    img.onload = function () {',
      '      const t = new THREE.Texture(img);',
      '      t.colorSpace = THREE.SRGBColorSpace;',
      '      t.needsUpdate = true;',
      '      onOk(t);',
      '    };',
      '    img.onerror = function () { if (onErr) onErr(); };',
      '    img.src = url;',
      '  }',
      '  const frames = [];',
      '  photos.forEach(function (photo, i) {',
      '    const side = i % 2 === 0 ? -1 : 1;',
      '    const z = photoZ(i);',
      '    const kind = photo.kind || "image";',
      '    const fr = makeFrame(1.4, 1.4);',
      '    fr.group.position.set(side * (hallHalfW - 0.04), 1.55, z);',
      '    fr.group.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;',
      '    scene.add(fr.group);',
      '    const mat = new THREE.MeshBasicMaterial({ color: 0x222222, side: THREE.FrontSide });',
      '    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), mat);',
      '    mesh.position.z = 0.04;',
      '    fr.group.add(mesh);',
      '    const plaque = makePlaque(photo.label || ("Photo " + (i + 1)), 1.4);',
      '    fr.group.add(plaque);',
      '    const entry = { mesh: mesh, group: fr.group, kind: kind, z: z, photo: photo, plaque: plaque, index: i };',
      '    function fit(aspect) {',
      '      const h = 1.35;',
      '      const w = Math.min(2.1, h * Math.max(0.2, aspect || 1));',
      '      mesh.geometry.dispose();',
      '      mesh.geometry = new THREE.PlaneGeometry(w, h);',
      '      resizeFrame(fr, w, h);',
      '      layoutPlaque(plaque, w, h);',
      '    }',
      '    if (kind === "video") {',
      '      const el = document.createElement("video");',
      '      el.src = photo.texSrc || photo.src;',
      '      if (/^https?:/i.test(el.src)) el.crossOrigin = "anonymous";',
      '      el.loop = true; el.muted = true; el.playsInline = true;',
      '      el.addEventListener("loadedmetadata", function () {',
      '        if (el.videoWidth && el.videoHeight) fit(el.videoWidth / el.videoHeight);',
      '      });',
      '      const tex = new THREE.VideoTexture(el);',
      '      tex.colorSpace = THREE.SRGBColorSpace;',
      '      mat.map = tex; mat.color.set(0xffffff); mat.needsUpdate = true;',
      '      entry.video = el;',
      '      el.play && el.play().catch(function () {});',
      '    } else {',
      '      loadTex(photo.texSrc || photo.dataUrl || photo.src, function (t) {',
      '        t.colorSpace = THREE.SRGBColorSpace;',
      '        mat.map = t; mat.color.set(0xffffff); mat.needsUpdate = true;',
      '        const img = t.image;',
      '        const aspect = kind === "youtube" ? 16 / 9 : (img && img.width && img.height ? img.width / img.height : 1);',
      '        fit(aspect);',
      '      }, function () { if (kind === "youtube") fit(16 / 9); });',
      '    }',
      '    frames.push(entry);',
      '  });',
      '  let yaw = 0, pitch = 0, fov = FOV_DEFAULT, tour = null, last = performance.now();',
      '  function setFov(v) { fov = v; camera.fov = v; camera.updateProjectionMatrix(); }',
      '  function clampHall(x, z) {',
      '    return { x: Math.max(-hallHalfW + WALL_PAD, Math.min(hallHalfW - WALL_PAD, x)), z: Math.max(0.45, Math.min(hallLen - 0.5, z)) };',
      '  }',
      '  function poseInFrontOf(frame, dist) {',
      '    const origin = new THREE.Vector3();',
      '    frame.mesh.getWorldPosition(origin);',
      '    const inward = new THREE.Vector3();',
      '    frame.mesh.getWorldDirection(inward);',
      '    inward.y = 0;',
      '    if (inward.lengthSq() < 1e-6) inward.set(-Math.sign(origin.x || 1), 0, 0); else inward.normalize();',
      '    if (origin.x * inward.x > 0.01) inward.negate();',
      '    const pos = origin.clone().addScaledVector(inward, Math.max(WALL_PAD + 0.15, dist));',
      '    const clamped = clampHall(pos.x, origin.z);',
      '    const lookYaw = Math.atan2(origin.x - clamped.x, origin.z - clamped.z);',
      '    return { x: clamped.x, z: clamped.z, yaw: lookYaw };',
      '  }',
      '  function distToFit(frame, fovDeg, fill) {',
      '    const geom = frame.mesh.geometry && frame.mesh.geometry.parameters;',
      '    const w = Math.max(0.7, (geom && geom.width) || 1.4);',
      '    const h = Math.max(0.7, (geom && geom.height) || 1.4);',
      '    const aspect = Math.max(0.5, camera.aspect || 1.6);',
      '    const vFov = THREE.MathUtils.degToRad(fovDeg);',
      '    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);',
      '    const dist = Math.max(h / (fill * 2 * Math.tan(vFov / 2)), w / (fill * 2 * Math.tan(hFov / 2)));',
      '    const maxDist = Math.max(WALL_PAD + 0.2, hallHalfW - 0.35);',
      '    return Math.max(WALL_PAD + 0.25, Math.min(maxDist, dist));',
      '  }',
      '  function buildWaypoints() {',
      '    const pts = [',
      '      { x: 0, z: 0.7, yaw: Math.PI, pitch: 0, hold: 2.2, fov: 78, travel: 0.7 },',
      '      { x: 0, z: 0.7, yaw: 0, pitch: 0, hold: 1.6, fov: FOV_DEFAULT, travel: 1.0 },',
      '    ];',
      '    frames.forEach(function (f) {',
      '      const fill = (f.kind === "video" || f.kind === "youtube" || f.kind === "audio") ? 0.82 : 0.72;',
      '      const front = poseInFrontOf(f, distToFit(f, LOOK_FOV, fill));',
      '      const dwell = (f.kind === "video" || f.kind === "youtube" || f.kind === "audio") ? 5.2 : 2.8;',
      '      pts.push({ x: 0, z: front.z, yaw: front.yaw * 0.22, pitch: 0, hold: 0.12, fov: 58, travel: 0.95 });',
      '      pts.push({ x: front.x, z: front.z, yaw: front.yaw, pitch: 0, hold: dwell, fov: LOOK_FOV, travel: 1.25 });',
      '      pts.push({ x: 0, z: front.z, yaw: 0, pitch: 0, hold: 0.14, fov: FOV_DEFAULT, travel: 0.95 });',
      '    });',
      '    pts.push({ x: 0, z: Math.max(1, hallLen - 1.2), yaw: 0, pitch: 0, hold: 0.8, fov: 78, travel: 1.5 });',
      '    pts.push({ x: 0, z: Math.max(1, hallLen - 1.2), yaw: Math.PI, pitch: 0, hold: 0.35, fov: FOV_DEFAULT, travel: 0.7 });',
      '    pts.push({ x: 0, z: 0.7, yaw: Math.PI, pitch: 0, hold: 0.35, fov: FOV_DEFAULT, travel: 2.2 });',
      '    pts.push({ x: 0, z: 0.7, yaw: 0, pitch: 0, hold: 0.45, fov: FOV_DEFAULT, travel: 0.7 });',
      '    return pts;',
      '  }',
      '  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }',
      '  function lerpAngle(a, b, t) {',
      '    let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;',
      '    if (d < -Math.PI) d += Math.PI * 2;',
      '    return a + d * t;',
      '  }',
      '  function syncBtn() {',
      '    if (!demoBtn) return;',
      '    const on = !!(tour && tour.active);',
      '    demoBtn.textContent = on ? "Stop tour" : "Demo tour";',
      '    demoBtn.setAttribute("aria-pressed", on ? "true" : "false");',
      '  }',
      '  function stopTour() { if (tour) tour.active = false; tour = null; syncBtn(); }',
      '  function startTour() {',
      '    const waypoints = buildWaypoints();',
      '    tour = { active: true, waypoints: waypoints, index: 0, phase: "travel", t: 0, from: { x: camera.position.x, z: camera.position.z, yaw: yaw, pitch: pitch, fov: fov } };',
      '    syncBtn();',
      '  }',
      '  function advanceTour(dt) {',
      '    if (!tour || !tour.active) return;',
      '    const wp = tour.waypoints[tour.index];',
      '    if (!wp) { stopTour(); return; }',
      '    if (tour.phase === "travel") {',
      '      tour.t += dt;',
      '      const dur = Math.max(0.35, wp.travel || 1.2);',
      '      const u = easeInOut(Math.min(1, tour.t / dur));',
      '      camera.position.x = tour.from.x + (wp.x - tour.from.x) * u;',
      '      camera.position.z = tour.from.z + (wp.z - tour.from.z) * u;',
      '      yaw = lerpAngle(tour.from.yaw, wp.yaw, u);',
      '      pitch = tour.from.pitch + (wp.pitch - tour.from.pitch) * u;',
      '      setFov(tour.from.fov + (wp.fov - tour.from.fov) * u);',
      '      if (u >= 1) { tour.phase = "hold"; tour.t = 0; camera.position.x = wp.x; camera.position.z = wp.z; yaw = wp.yaw; pitch = wp.pitch; setFov(wp.fov); }',
      '      return;',
      '    }',
      '    tour.t += dt;',
      '    if (tour.t < (wp.hold || 0.2)) return;',
      '    tour.index += 1;',
      '    if (tour.index >= tour.waypoints.length) tour.index = 0;',
      '    tour.phase = "travel";',
      '    tour.t = 0;',
      '    tour.from = { x: camera.position.x, z: camera.position.z, yaw: yaw, pitch: pitch, fov: fov };',
      '  }',
      '  function frameAtClient(clientX, clientY) {',
      '    const rect = canvas.getBoundingClientRect();',
      '    if (rect.width < 1 || rect.height < 1) return null;',
      '    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;',
      '    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;',
      '    const objects = [];',
      '    frames.forEach(function (f) { if (f.mesh) objects.push(f.mesh); if (f.group) objects.push(f.group); });',
      '    if (!objects.length) return null;',
      '    const raycaster = new THREE.Raycaster();',
      '    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);',
      '    const hits = raycaster.intersectObjects(objects, true);',
      '    if (!hits.length) return null;',
      '    let obj = hits[0].object;',
      '    while (obj) {',
      '      const found = frames.find(function (f) { return f.mesh === obj || f.group === obj; });',
      '      if (found) return found;',
      '      obj = obj.parent;',
      '    }',
      '    return null;',
      '  }',
      '  const lb = document.getElementById("tour-lightbox");',
      '  const lbImg = document.getElementById("tour-lightbox-img");',
      '  const lbVid = document.getElementById("tour-lightbox-video");',
      '  const lbCap = document.getElementById("tour-lightbox-cap");',
      '  function closeLightbox() {',
      '    if (!lb) return;',
      '    lb.classList.remove("open");',
      '    lb.hidden = true;',
      '    if (lbVid) { lbVid.pause(); lbVid.removeAttribute("src"); lbVid.load(); }',
      '  }',
      '  function openFramePhoto(frame) {',
      '    if (!frame || !lb) return;',
      '    stopTour();',
      '    const photo = frame.photo || {};',
      '    const isVid = (frame.kind === "video") || (photo.kind === "video");',
      '    const mediaSrc = photo.texSrc || photo.dataUrl || photo.src;',
      '    if (lbImg) { lbImg.hidden = !!isVid; if (!isVid) { lbImg.src = mediaSrc; lbImg.alt = photo.label || ""; } }',
      '    if (lbVid) {',
      '      lbVid.hidden = !isVid;',
      '      if (isVid) { lbVid.src = mediaSrc; lbVid.play && lbVid.play().catch(function () {}); }',
      '    }',
      '    if (lbCap) lbCap.textContent = photo.label || "";',
      '    lb.hidden = false;',
      '    lb.classList.add("open");',
      '  }',
      '  function nearestFrame() {',
      '    let best = null, bestD = 1e9;',
      '    frames.forEach(function (f) {',
      '      const o = new THREE.Vector3(); f.mesh.getWorldPosition(o);',
      '      const d = camera.position.distanceTo(o);',
      '      if (d < bestD) { bestD = d; best = f; }',
      '    });',
      '    return best && bestD < 4.2 ? best : null;',
      '  }',
      '  function nearestCaption() {',
      '    if (!captionEl) return;',
      '    let best = null, bestD = 1e9;',
      '    frames.forEach(function (f) {',
      '      const o = new THREE.Vector3(); f.mesh.getWorldPosition(o);',
      '      const d = camera.position.distanceTo(o);',
      '      if (d < bestD) { bestD = d; best = f; }',
      '    });',
      '    captionEl.textContent = best && bestD < 4.2 ? (best.photo.label || "") : "";',
      '  }',
      '  function resize() {',
      '    const w = Math.max(1, canvas.clientWidth || window.innerWidth);',
      '    const h = Math.max(1, canvas.clientHeight || window.innerHeight);',
      '    renderer.setSize(w, h, false);',
      '    camera.aspect = w / h;',
      '    camera.updateProjectionMatrix();',
      '  }',
      '  function tick(now) {',
      '    const dt = Math.min(0.05, (now - last) / 1000);',
      '    last = now;',
      '    advanceTour(dt);',
      '    camera.rotation.order = "YXZ";',
      '    camera.rotation.y = yaw + YAW_LOOK;',
      '    camera.rotation.x = pitch;',
      '    nearestCaption();',
      '    renderer.render(scene, camera);',
      '    requestAnimationFrame(tick);',
      '  }',
      '  demoBtn && demoBtn.addEventListener("click", function () {',
      '    frames.forEach(function (f) { if (f.video && f.video.play) f.video.play().catch(function () {}); });',
      '    if (tour && tour.active) stopTour(); else startTour();',
      '  });',
      '  let tap = null;',
      '  canvas.addEventListener("pointerdown", function (e) {',
      '    if (e.button && e.button !== 0) return;',
      '    tap = { x: e.clientX, y: e.clientY, dist: 0 };',
      '  });',
      '  canvas.addEventListener("pointermove", function (e) {',
      '    if (!tap) return;',
      '    tap.dist += Math.hypot(e.clientX - tap.x, e.clientY - tap.y);',
      '    tap.x = e.clientX; tap.y = e.clientY;',
      '  });',
      '  canvas.addEventListener("pointerup", function (e) {',
      '    if (!tap) return;',
      '    const wasTap = tap.dist < 16;',
      '    const x = e.clientX, y = e.clientY;',
      '    tap = null;',
      '    if (!wasTap) return;',
      '    const frame = frameAtClient(x, y);',
      '    if (frame) openFramePhoto(frame);',
      '  });',
      '  lb && lb.addEventListener("click", function (e) {',
      '    if (e.target === lb || (e.target && e.target.id === "tour-lightbox-close")) closeLightbox();',
      '  });',
      '  window.addEventListener("keydown", function (e) {',
      '    if (e.code === "Escape" && lb && lb.classList.contains("open")) { e.preventDefault(); closeLightbox(); return; }',
      '    if (e.code === "Space") { e.preventDefault(); if (!e.repeat) openFramePhoto(nearestFrame()); }',
      '  });',
      '  window.addEventListener("resize", resize);',
      '  resize();',
      '  requestAnimationFrame(tick);',
      '  requestAnimationFrame(startTour);',
      '})',
    ].join('\n');
  }

  function tourPhotoKind(photo) {
    if (photo?.kind === 'youtube' || extractYoutubeId(photo?.src)) return 'youtube';
    if (photo?.kind === 'video' || isVideoSrc(photo?.src)) return 'video';
    if (photo?.kind === 'audio' || isAudioSrc(photo?.src)) return 'audio';
    return 'image';
  }

  function tourLocalRef(path) {
    const raw = String(path || '').replace(/\\/g, '/');
    if (!raw || /^([a-z]+:)?\/\//i.test(raw) || /^data:/i.test(raw) || raw.startsWith('./')) return raw;
    return `./${raw.replace(/^\//, '')}`;
  }

  function bytesToBase64(bytes) {
    const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    const parts = [];
    const size = 0x8000;
    for (let i = 0; i < buf.length; i += size) {
      parts.push(String.fromCharCode.apply(null, buf.subarray(i, Math.min(i + size, buf.length))));
    }
    return btoa(parts.join(''));
  }

  function mimeFromExt(ext, fallback) {
    const e = String(ext || '').toLowerCase();
    if (e === 'png') return 'image/png';
    if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
    if (e === 'webp') return 'image/webp';
    if (e === 'gif') return 'image/gif';
    if (e === 'mp4') return 'video/mp4';
    if (e === 'webm') return 'video/webm';
    const type = String(fallback || '').split(';')[0].trim();
    return type || 'image/jpeg';
  }

  function bytesToDataUrl(buf, mime) {
    return `data:${mimeFromExt('', mime)};base64,${bytesToBase64(buf)}`;
  }

  async function imageBytesToTexDataUrl(buf, mime) {
    const blob = new Blob([buf], { type: mimeFromExt('', mime) });
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('tex image'));
        el.src = url;
      });
      const maxEdge = 1600;
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height, 1));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas');
      ctx.drawImage(img, 0, 0, w, h);
      return canvas.toDataURL('image/jpeg', 0.82);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function buildStandaloneTourHtml(spec, photos, options = {}) {
    const list = (photos || (spec.photos || []).map((p, i) => ({
      src: absoluteMediaUrl(p.src),
      label: photoDisplayTitle(p, i),
      kind: tourPhotoKind(p),
      youtubeId: p.youtubeId || extractYoutubeId(p.src) || '',
      dataUrl: p.dataUrl || '',
    }))).map((p) => ({
      ...p,
      src: tourLocalRef(p.src),
    }));
    const title = escapeHtml(spec.title || 'Gallery');
    const fallbackTitle = spec.title || 'Gallery';
    const payload = jsonForScript({
      title: fallbackTitle,
      frontTitle: spec.frontTitle != null ? spec.frontTitle : fallbackTitle,
      backTitle: spec.backTitle != null ? spec.backTitle : fallbackTitle,
      photos: list,
    });
    const threeB64 = options.threeB64 || '';
    const cdnThree = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js';
    const boot = [
      '(async function () {',
      '  const captionEl = document.getElementById("tour-caption");',
      '  let THREE;',
      '  try {',
      threeB64
        ? [
          `    const b64 = ${JSON.stringify(threeB64)};`,
          '    const bin = atob(b64);',
          '    const bytes = new Uint8Array(bin.length);',
          '    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);',
          '    THREE = await import(URL.createObjectURL(new Blob([bytes], { type: "text/javascript" })));',
        ].join('\n')
        : `    THREE = await import(${JSON.stringify(cdnThree)});`,
      '  } catch (err) {',
      `    try { THREE = await import(${JSON.stringify(cdnThree)}); }`,
      '    catch (err2) { if (captionEl) captionEl.textContent = "Could not load Three.js."; return; }',
      '  }',
      `  (${standaloneTourModuleSource()})(THREE);`,
      '})();',
    ].join('\n');
    return [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      `<title>${title} — Demo tour</title>`,
      '<style>',
      'html,body{margin:0;height:100%;background:#12121a;color:#e2e8f0;font:14px/1.4 system-ui,sans-serif;overflow:hidden}',
      '.bar{position:fixed;left:0;right:0;top:0;z-index:2;display:flex;align-items:center;gap:12px;padding:10px 14px;background:linear-gradient(180deg,rgba(15,23,42,.88),rgba(15,23,42,0));}',
      '.bar h1{margin:0;font-size:16px;font-weight:650}',
      '.bar .hint{opacity:.75;font-size:12px}',
      '.bar button{margin-left:auto;border:1px solid #64748b;background:#1e293b;color:#f8fafc;border-radius:999px;padding:6px 14px;cursor:pointer}',
      '#tour-canvas{position:absolute;inset:0;width:100%;height:100%;display:block}',
      '#tour-caption{position:fixed;left:14px;bottom:14px;z-index:2;font-weight:650;text-shadow:0 1px 8px #000}',
      '#tour-lightbox{display:none;position:fixed;inset:0;z-index:10;align-items:center;justify-content:center;background:rgba(7,10,18,.92);padding:24px}',
      '#tour-lightbox.open{display:flex}',
      '#tour-lightbox img,#tour-lightbox video{max-width:min(96vw,1400px);max-height:86vh;object-fit:contain;border-radius:8px;box-shadow:0 12px 40px #000}',
      '#tour-lightbox-close{position:absolute;top:12px;right:14px;border:0;background:#1e293b;color:#fff;width:40px;height:40px;border-radius:999px;font-size:24px;cursor:pointer}',
      '#tour-lightbox-cap{position:absolute;left:16px;bottom:14px;font-weight:650;text-shadow:0 1px 8px #000}',
      '</style>',
      '</head>',
      '<body>',
      `<div class="bar"><h1>${title}</h1><span class="hint">Click a picture to open · Demo tour · unzip and open index.html</span><button type="button" id="tour-toggle" aria-pressed="true">Stop tour</button></div>`,
      '<canvas id="tour-canvas"></canvas>',
      '<div id="tour-caption"></div>',
      '<div id="tour-lightbox" hidden><button type="button" id="tour-lightbox-close" aria-label="Close">×</button><img id="tour-lightbox-img" alt=""><video id="tour-lightbox-video" controls playsinline hidden></video><div id="tour-lightbox-cap"></div></div>',
      `<script type="application/json" id="tour-data">${payload}</script>`,
      '<script type="module">',
      boot,
      '</script>',
      '</body>',
      '</html>',
    ].join('\n');
  }

  function crc32Bytes(bytes) {
    let table = crc32Bytes._t;
    if (!table) {
      table = new Uint32Array(256);
      for (let i = 0; i < 256; i += 1) {
        let c = i;
        for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[i] = c >>> 0;
      }
      crc32Bytes._t = table;
    }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i += 1) crc = table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function zipU16(n) {
    return new Uint8Array([n & 255, (n >>> 8) & 255]);
  }

  function zipU32(n) {
    return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
  }

  function concatBytes(parts) {
    const len = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(len);
    let offset = 0;
    parts.forEach((part) => {
      out.set(part, offset);
      offset += part.length;
    });
    return out;
  }

  function zipStoreFiles(files) {
    const encoder = new TextEncoder();
    const locals = [];
    const centrals = [];
    let offset = 0;
    files.forEach((file) => {
      const name = encoder.encode(String(file.name || 'file').replace(/\\/g, '/'));
      const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data || []);
      const crc = crc32Bytes(data);
      const local = concatBytes([
        zipU32(0x04034b50), zipU16(20), zipU16(0), zipU16(0),
        zipU16(0), zipU16(0), zipU32(crc), zipU32(data.length), zipU32(data.length),
        zipU16(name.length), zipU16(0), name, data,
      ]);
      const central = concatBytes([
        zipU32(0x02014b50), zipU16(20), zipU16(20), zipU16(0), zipU16(0),
        zipU16(0), zipU16(0), zipU32(crc), zipU32(data.length), zipU32(data.length),
        zipU16(name.length), zipU16(0), zipU16(0), zipU16(0), zipU16(0),
        zipU32(0), zipU32(offset), name,
      ]);
      locals.push(local);
      centrals.push(central);
      offset += local.length;
    });
    const centralBuf = concatBytes(centrals);
    const eocd = concatBytes([
      zipU32(0x06054b50), zipU16(0), zipU16(0),
      zipU16(files.length), zipU16(files.length),
      zipU32(centralBuf.length), zipU32(offset), zipU16(0),
    ]);
    return concatBytes([...locals, centralBuf, eocd]);
  }

  function extFromMedia(url, kind, mime) {
    const path = String(url || '').split('?')[0];
    const match = path.match(/\.([a-z0-9]{2,5})$/i);
    if (match) return match[1].toLowerCase();
    const type = String(mime || '').toLowerCase();
    if (type.includes('png')) return 'png';
    if (type.includes('webp')) return 'webp';
    if (type.includes('gif')) return 'gif';
    if (type.includes('jpeg')) return 'jpg';
    if (type.includes('mp4')) return 'mp4';
    if (type.includes('webm')) return 'webm';
    if (type.includes('mpeg') || type.includes('mp3')) return 'mp3';
    if (kind === 'video') return 'mp4';
    if (kind === 'audio') return 'mp3';
    return 'jpg';
  }

  async function fetchMediaBytes(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    const type = res.headers.get('content-type') || '';
    return { buf, type };
  }

  async function packTourPhotos(spec, onProgress) {
    const used = new Set();
    const zipFiles = [];
    const photos = [];
    const list = spec.photos || [];
    for (let i = 0; i < list.length; i += 1) {
      const p = list[i];
      const kind = tourPhotoKind(p);
      const label = photoDisplayTitle(p, i);
      const ytId = p.youtubeId || extractYoutubeId(p.src) || '';
      const remote = kind === 'youtube' && ytId ? youtubeThumbSrc(ytId) : absoluteMediaUrl(p.src);
      onProgress?.(i + 1, list.length);
      let packed = {
        src: remote,
        label,
        kind,
        youtubeId: ytId,
      };
      if (remote && !/^data:/i.test(remote)) {
        try {
          const { buf, type } = await fetchMediaBytes(remote);
          const ext = extFromMedia(remote, kind === 'youtube' ? 'image' : kind, type);
          const base = `${String(i + 1).padStart(2, '0')}-${slugifyTitle(label) || `photo-${i + 1}`}`;
          let name = `${base}.${ext}`;
          let n = 2;
          while (used.has(name)) {
            name = `${base}-${n}.${ext}`;
            n += 1;
          }
          used.add(name);
          zipFiles.push({ name: `images/${name}`, data: buf });
          const mime = mimeFromExt(ext, type);
          let dataUrl = '';
          if (kind !== 'video' && kind !== 'audio') {
            try {
              dataUrl = await imageBytesToTexDataUrl(buf, mime);
            } catch (_) { /* file:// textures need dataUrl; HTTP still uses ./images */ }
          }
          packed = {
            src: `./images/${name}`,
            dataUrl,
            label,
            kind: kind === 'youtube' ? 'image' : kind,
            youtubeId: kind === 'youtube' ? '' : ytId,
          };
        } catch (_) { /* keep remote URL */ }
      }
      photos.push(packed);
    }
    return { photos, zipFiles };
  }

  async function downloadStandaloneTour(spec, el) {
    if (el?.dataset?.galleryZipping === '1') return;
    if (el) el.dataset.galleryZipping = '1';
    const total = (spec.photos || []).length;
    setStatus(el, total ? `Packing images… 0/${total}` : 'Packing ZIP…');
    try {
      const packed = await packTourPhotos(spec, (n, max) => {
        setStatus(el, `Packing images… ${n}/${max}`);
      });
      setStatus(el, 'Packing Three.js…');
      const zipFiles = [...packed.zipFiles];
      let threeB64 = '';
      try {
        const three = await fetchMediaBytes('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js');
        threeB64 = bytesToBase64(three.buf);
      } catch (_) { /* CDN module fallback in HTML */ }
      const html = buildStandaloneTourHtml(spec, packed.photos, { threeB64 });
      const htmlBytes = new TextEncoder().encode(html);
      const zip = zipStoreFiles([
        { name: 'index.html', data: htmlBytes },
        ...zipFiles,
      ]);
      const blob = new Blob([zip], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${slugifyTitle(spec.title)}-demotour.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      const imgCount = packed.zipFiles.length;
      setStatus(el, `Downloaded ZIP · ${imgCount} image${imgCount === 1 ? '' : 's'} + HTML.`);
    } catch (err) {
      setStatus(el, err?.message ? `ZIP failed: ${err.message}` : 'Could not build ZIP.');
    } finally {
      if (el) delete el.dataset.galleryZipping;
    }
  }

  function hydrate(root) {
    (root || document).querySelectorAll('.gallery-block[data-gallery-spec]').forEach(hydrateBlock);
  }

  return {
    parseFenceAttrs,
    parsePhotos,
    formatGalleryBody,
    buildFenceAttrsString,
    buildSpec,
    decodeSpec,
    renderBlock,
    hydrate,
    hydrateBlock,
    openLightbox,
    closeLightbox,
    extractYoutubeId,
  };
}));
