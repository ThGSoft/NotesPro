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

  function resolveDemo(cfg) {
    if (!Object.prototype.hasOwnProperty.call(cfg, 'demo')) return false;
    const raw = String(cfg.demo ?? '').trim().toLowerCase();
    return raw === '' || raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
  }

  function buildSpec(source, cfg) {
    const title = String(cfg.title || 'Gallery').trim() || 'Gallery';
    const photos = parsePhotos(source);
    return {
      title,
      cols: resolveCols(cfg),
      mode: resolveMode(cfg),
      demo: resolveDemo(cfg),
      photos,
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
    const label = escapeHtml(photo.label || (kind === 'youtube' ? 'YouTube' : kind === 'video' ? `Video ${index + 1}` : kind === 'audio' ? `Audio ${index + 1}` : `Photo ${index + 1}`));
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
      photo.label ? `<span class="gallery-caption">${label}</span>` : '',
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
      `<p class="gallery-walk-hint">Click to look &amp; unlock sound · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk · wheel zoom · <kbd>Space</kbd> open · framed pictures on the walls</p>`,
      `<div class="gallery-walk-caption" aria-live="polite"></div>`,
      `</div>`,
      `</div>`,
      `<div class="gallery-walk-toolbar">`,
      `<button type="button" class="btn btn-sm btn-outline-light" data-action="walk-focus">Enter gallery</button>`,
      `<button type="button" class="btn btn-sm btn-outline-light" data-action="walk-demo" aria-pressed="false">Demo tour</button>`,
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
    if (spec.draft) {
      body = renderPasteZone(editable
        ? 'Paste a photo (Ctrl+V) or add image / video / YouTube URLs in markdown'
        : 'Add photos, videos, or YouTube embeds in markdown.');
    } else if (spec.mode === 'grid') {
      body = renderGrid(spec, editable);
    } else {
      body = renderWalkShell(spec, editable);
    }

    return [
      `<div class="gallery-block${themeClass}${customClass}${fullClass}${editable ? ' gallery-block--editable' : ''}${spec.draft ? ' gallery-block--draft' : ''}${spec.mode === 'walk' && !spec.draft ? ' gallery-block--walk' : ''}"${styleAttr}`,
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
    const demoBtn = el.querySelector('[data-action="walk-demo"]');
    const cssRoot = el.querySelector('.gallery-walk-css3d');
    const cssCam = el.querySelector('.gallery-walk-css3d-cam');
    if (!viewport || !canvas || !photos.length) return null;

    const FOV_MIN = 32;
    const FOV_MAX = 100;
    const FOV_DEFAULT = 70;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1e);
    scene.fog = new THREE.Fog(0x1a1a1e, 8, 42);

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
    const hallLen = Math.max(10, photos.length * spacing + 6);
    const hallHalfW = 2.4;
    const wallH = 3.2;
    const WALL_PAD = 0.88;
    const LOOK_FOV = 50;

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

    const endWall = new THREE.Mesh(new THREE.PlaneGeometry(hallHalfW * 2, wallH), wallMat);
    endWall.position.set(0, wallH / 2, hallLen);
    scene.add(endWall);

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
      const z = 2.5 + Math.floor(i / 2) * spacing + (i % 2) * (spacing * 0.35);
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
      };

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

    function setFov(next) {
      fov = Math.max(FOV_MIN, Math.min(FOV_MAX, next));
      camera.fov = fov;
      camera.updateProjectionMatrix();
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
      const normal = new THREE.Vector3();
      frame.mesh.getWorldDirection(normal);
      if (origin.x * normal.x > 0.01) normal.negate();
      const pos = origin.clone().addScaledVector(normal, Math.max(WALL_PAD + 0.15, dist));
      const lookYaw = origin.x >= 0 ? -Math.PI / 2 : Math.PI / 2;
      const clamped = clampHall(pos.x, pos.z);
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
      const pts = [{ x: 0, z: 0.7, yaw: 0, pitch: 0, hold: 0.5, fov: FOV_DEFAULT, travel: 1.1 }];
      frames.forEach((f) => {
        const fill = (f.kind === 'video' || f.kind === 'youtube' || f.kind === 'audio') ? 0.78 : 0.68;
        const close = distToFitFrame(f, LOOK_FOV, fill);
        const approach = poseInFrontOf(f, close + 0.85);
        const front = poseInFrontOf(f, close);
        const dwell = (f.kind === 'video' || f.kind === 'youtube' || f.kind === 'audio') ? 5.2 : 2.6;
        pts.push({
          x: approach.x,
          z: approach.z,
          yaw: approach.yaw * 0.35,
          pitch: -0.02,
          hold: 0.12,
          fov: 58,
          travel: 1.2,
        });
        pts.push({
          x: front.x,
          z: front.z,
          yaw: front.yaw,
          pitch: -0.02,
          hold: dwell,
          fov: LOOK_FOV,
          travel: 1.35,
        });
        pts.push({
          x: front.x,
          z: front.z,
          yaw: 0,
          pitch: 0,
          hold: 0.28,
          fov: FOV_DEFAULT,
          travel: 0.65,
        });
        pts.push({
          x: 0,
          z: Math.max(0.7, f.z + 0.85),
          yaw: 0,
          pitch: 0,
          hold: 0.12,
          fov: FOV_DEFAULT,
          travel: 0.9,
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
        const base = frame.photo.label
          || (frame.kind === 'youtube' ? 'YouTube' : frame.kind === 'video' ? 'Video' : frame.kind === 'audio' ? 'Audio' : 'Photo');
        if (frame.kind === 'youtube') {
          captionEl.textContent = frame._videoVisible ? `${base} · video` : `${base} · sound`;
        } else if (frame.kind === 'video' || frame.kind === 'audio') {
          captionEl.textContent = `${base} · ${frame.kind === 'audio' ? 'sound' : 'video'}`;
        } else {
          captionEl.textContent = base;
        }
      }
    }

    function openNearestPhoto() {
      const frame = nearestFrame();
      if (!frame) return;
      stopTour();
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      openLightbox(photos, frame.index, {
        onOpen: () => setLightboxMute(true),
        onClose: () => setLightboxMute(false),
      });
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

    function tick(now) {
      if (destroyed) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (tour?.active) {
        advanceTour(dt);
      } else {
        const speed = (keys.ShiftLeft || keys.ShiftRight ? 4.2 : 2.4) * dt;
        const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
        const move = new THREE.Vector3();
        if (keys.KeyW || keys.ArrowUp) move.add(forward);
        if (keys.KeyS || keys.ArrowDown) move.sub(forward);
        if (keys.KeyA || keys.ArrowLeft) move.sub(right);
        if (keys.KeyD || keys.ArrowRight) move.add(right);
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
      if (e.code === 'Space') {
        e.preventDefault();
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
      if (tour?.active) stopTour();
      unlockAudio();
      viewport.focus({ preventScroll: true });
      canvas.requestPointerLock?.();
    }

    function onLockChange() {
      locked = document.pointerLockElement === canvas;
      viewport.classList.toggle('gallery-walk-viewport--locked', locked);
    }

    canvas.addEventListener('click', requestLook);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    viewport.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('mousemove', onMouseMove);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('resize', resize);

    el.addEventListener('notespro:monitor-fullscreen', () => {
      requestAnimationFrame(resize);
    });

    resize();
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
        canvas.removeEventListener('wheel', onWheel);
        viewport.removeEventListener('wheel', onWheel);
        document.removeEventListener('pointerlockchange', onLockChange);
        document.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('resize', resize);
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
      if (action === 'close') closeLightbox();
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
        if (!threeReady()) {
          setStatus(el, 'Three.js not loaded — walk mode unavailable.');
          return;
        }
        walk = createWalkGallery(el, spec.photos, { demo: !!spec.demo });
      };
      startWalk();
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
  };
}));
