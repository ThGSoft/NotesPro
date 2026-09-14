/**
 * NotesPro ```photocube```, ```photobook```, and ```carousel``` blocks — paste/drop photos.
 */
(function (root, factory) {
  const api = factory();
  root.NotesProPhotocube = api.cube;
  root.NotesProPhotobook = api.book;
  root.NotesProPhotocarousel = api.carousel;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];

  function isPhotoviewMobile() {
    return document.body.classList.contains('mobile-layout')
      || (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 768px)').matches);
  }

  function isPhotoviewMonitorFullscreen(el) {
    const fs = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
    return !!el && (fs === el || el.classList.contains('game-block--monitor-fullscreen'));
  }
  const CUBE_FACES = [
    { key: 'front', label: 'Front' },
    { key: 'back', label: 'Back' },
    { key: 'right', label: 'Right' },
    { key: 'left', label: 'Left' },
    { key: 'top', label: 'Top' },
    { key: 'bottom', label: 'Bottom' },
  ];

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

  function extractYoutubeId(raw) {
    const text = String(raw || '');
    const match = text.match(
      /(?:youtube(?:-nocookie)?\.com\/(?:embed\/|shorts\/|live\/|watch\?(?:[^"'<\s]*?[?&])?v=)|youtu\.be\/)([A-Za-z0-9_-]{11})/i,
    );
    return match ? match[1] : '';
  }

  function youtubeThumbSrc(id) {
    return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  }

  function parsePhotos(source) {
    if (typeof window !== 'undefined' && window.NotesProGallery?.parsePhotos) {
      return window.NotesProGallery.parsePhotos(source) || [];
    }
    const photos = [];
    const re = /!\[(.*?)\]\((.*?)\)/g;
    let match;
    const text = String(source || '');
    while ((match = re.exec(text)) !== null) {
      const src = match[2].trim();
      if (!src) continue;
      photos.push({ src, label: (match[1] || '').trim(), kind: 'image' });
    }
    return photos;
  }

  function formatPhotoBody(photos) {
    if (typeof window !== 'undefined' && window.NotesProGallery?.formatGalleryBody) {
      return window.NotesProGallery.formatGalleryBody(photos);
    }
    return (photos || []).map((p, i) => `![${p.label || `Photo ${i + 1}`}](${p.src})`).join('\n');
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

  function resolveFullscreen(cfg) {
    const raw = String(cfg.fullscreen ?? cfg.full ?? '1').trim().toLowerCase();
    if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'compact') return false;
    return true;
  }

  function resolveSpin(cfg) {
    if (!Object.prototype.hasOwnProperty.call(cfg, 'spin')) return true;
    const raw = String(cfg.spin ?? '').trim().toLowerCase();
    return raw === '' || raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
  }

  function quatMul(a, b) {
    return {
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    };
  }

  function quatFromAxisAngle(x, y, z, angle) {
    const len = Math.hypot(x, y, z) || 1;
    const h = angle / 2;
    const s = Math.sin(h);
    return {
      x: (x / len) * s,
      y: (y / len) * s,
      z: (z / len) * s,
      w: Math.cos(h),
    };
  }

  function quatToRotate3d(q) {
    const w = Math.max(-1, Math.min(1, q.w));
    const angle = 2 * Math.acos(w);
    const s = Math.sqrt(Math.max(0, 1 - w * w));
    if (s < 1e-6 || angle < 1e-6) return 'rotate3d(0, 1, 0, 0deg)';
    return `rotate3d(${q.x / s}, ${q.y / s}, ${q.z / s}, ${angle}rad)`;
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

  function photoHref(photo) {
    if (!photo) return '';
    const id = photo.youtubeId || extractYoutubeId(photo.src);
    if (photo.kind === 'youtube' || id) return youtubeThumbSrc(id);
    return resolveMediaHref(photo.src);
  }

  function renderMedia(photo, extraClass = '') {
    if (!photo) {
      return `<div class="photoview-empty-face">Add a photo</div>`;
    }
    const href = photoHref(photo);
    const alt = escapeHtml(photo.label || 'Photo');
    const cls = extraClass ? ` class="${extraClass}"` : '';
    if (photo.kind === 'video') {
      return `<video${cls} src="${escapeHtml(href)}" muted playsinline loop autoplay draggable="false"></video>`;
    }
    return `<img${cls} src="${escapeHtml(href)}" alt="${alt}" draggable="false">`;
  }

  function renderPasteZone(label) {
    const mobile = isPhotoviewMobile();
    const text = label || (mobile
      ? 'Tap to add a photo, or paste'
      : 'Paste your photo here (Ctrl+V)');
    return `<div class="gallery-paste-zone photoview-paste-zone" tabindex="0" role="button" aria-label="${escapeHtml(text)}">`
      + `<span class="gallery-paste-icon" aria-hidden="true">📷</span>`
      + `<span class="gallery-paste-label">${escapeHtml(text)}</span>`
      + `</div>`;
  }

  function renderFullscreenButton() {
    return window.NotesProGameFullscreen?.renderButton?.() || '';
  }

  function bindFullscreenButton(el) {
    window.NotesProGameFullscreen?.bind?.(el);
  }

  function setStatus(el, message) {
    const status = el.querySelector('.photoview-status');
    if (status) status.textContent = message || '';
  }

  function armPasteTarget(el) {
    document.querySelectorAll('.photoview-block--paste-armed').forEach((node) => {
      if (node !== el) node.classList.remove('photoview-block--paste-armed');
    });
    el.classList.add('photoview-block--paste-armed');
    focusPasteCatcher(el);
  }

  function pickImageFiles({ multiple = true } = {}) {
    return new Promise((resolve) => {
      let settled = false;
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = !!multiple;
      input.className = 'visually-hidden-file-input';
      input.tabIndex = -1;
      input.setAttribute('aria-hidden', 'true');

      const finish = (files) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('focus', onWindowFocus);
        input.remove();
        resolve(files);
      };
      const onWindowFocus = () => {
        window.setTimeout(() => finish([]), 700);
      };

      input.addEventListener('change', () => finish([...(input.files || [])]));
      input.addEventListener('cancel', () => finish([]));
      document.body.appendChild(input);
      window.addEventListener('focus', onWindowFocus);
      try {
        input.click();
      } catch (_) {
        finish([]);
      }
    });
  }

  function focusPasteCatcher(el) {
    if (!isPhotoviewMobile()) {
      try { el.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
      return;
    }
    let catcher = el.querySelector('.photoview-paste-catcher');
    if (!catcher) {
      catcher = document.createElement('div');
      catcher.className = 'photoview-paste-catcher';
      catcher.contentEditable = 'true';
      catcher.setAttribute('role', 'textbox');
      catcher.setAttribute('aria-label', 'Paste photo');
      catcher.setAttribute('inputmode', 'none');
      catcher.setAttribute('enterkeyhint', 'done');
      catcher.spellcheck = false;
      catcher.addEventListener('beforeinput', (e) => {
        const type = String(e.inputType || '');
        if (!type.includes('Paste') && !type.includes('Drop')) e.preventDefault();
      });
      catcher.addEventListener('input', () => { catcher.textContent = ''; });
      el.appendChild(catcher);
    }
    try { catcher.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
  }

  function shellClasses(kind, style, spec, editable, fullscreen) {
    const themeClass = style.theme ? ` photoview-block--${style.theme}` : '';
    const customClass = (style.colorCss || style.bgCss) ? ' photoview-block--custom' : '';
    const fullClass = fullscreen ? ' photoview-block--fullscreen' : '';
    const draftClass = spec.draft ? ' photoview-block--draft' : '';
    const editClass = editable ? ' photoview-block--editable' : '';
    return `photoview-block ${kind}-block${themeClass}${customClass}${fullClass}${draftClass}${editClass}`;
  }

  function styleAttr(style) {
    const vars = [];
    if (style.colorCss) vars.push(`--photoview-accent:${style.colorCss}`);
    if (style.bgCss) vars.push(`--photoview-bg:${style.bgCss}`);
    return vars.length ? ` style="${vars.map(v => escapeHtml(v)).join(';')}"` : '';
  }

  function renderChrome(spec, kindLabel) {
    if (!spec?.title) return '';
    return [
      `<div class="photoview-header">`,
      `<div class="photoview-title">${escapeHtml(spec.title)}</div>`,
      `<div class="photoview-meta">${spec.draft ? 'paste photos' : `${kindLabel} · ${spec.photos.length} photo${spec.photos.length === 1 ? '' : 's'}`}</div>`,
      `</div>`,
    ].join('');
  }

  function bindPasteDrop(el, spec, options) {
    if (typeof options.onPasteImage !== 'function' && typeof options.onPasteYoutube !== 'function') return;

    async function handlePasteFiles(files) {
      const imageFiles = [...files].filter(f => f && String(f.type || '').startsWith('image/'));
      if (!imageFiles.length) return false;
      el.classList.add('photoview-block--uploading');
      setStatus(el, 'Uploading…');
      try {
        for (const file of imageFiles) {
          await options.onPasteImage(file, spec);
        }
      } finally {
        el.classList.remove('photoview-block--uploading');
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
        el.classList.remove('photoview-block--paste-armed');
        setStatus(el, 'Added YouTube still.');
        void options.onPasteYoutube(ytId, spec);
        return;
      }
      const items = [...(e.clipboardData?.items || [])];
      let files = items
        .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
        .map(item => item.getAsFile())
        .filter(Boolean);
      if (!files.length) {
        files = [...(e.clipboardData?.files || [])].filter(f => String(f.type || '').startsWith('image/'));
      }
      if (!files.length) return;
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('photoview-block--paste-armed');
      void handlePasteFiles(files);
    }, true);

    el.addEventListener('dragover', (e) => {
      if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
      e.preventDefault();
      el.classList.add('photoview-block--drop');
    });
    el.addEventListener('dragleave', () => el.classList.remove('photoview-block--drop'));
    el.addEventListener('drop', (e) => {
      el.classList.remove('photoview-block--drop');
      const files = [...(e.dataTransfer?.files || [])].filter(f => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      e.stopPropagation();
      void handlePasteFiles(files);
    });

    el.addEventListener('click', (e) => {
      const pickHit = e.target.closest('[data-action="add-photo"], .gallery-paste-zone, .photoview-paste-zone');
      if (!pickHit || e.target.closest('.game-fullscreen-btn')) return;
      const openPicker = isPhotoviewMobile() || pickHit.matches('[data-action="add-photo"]');
      armPasteTarget(el);
      setStatus(el, isPhotoviewMobile()
        ? 'Choose a photo, or paste here.'
        : 'Paste an image (Ctrl+V), or choose a file.');
      if (!openPicker) return;
      e.preventDefault();
      void pickImageFiles().then((files) => {
        if (files.length) return handlePasteFiles(files);
        focusPasteCatcher(el);
      });
    });
  }

  /* ---------- Photo cube ---------- */

  function buildCubeSpec(source, cfg) {
    const title = String(cfg.title || 'Photo cube').trim() || 'Photo cube';
    const photos = parsePhotos(source);
    return {
      title,
      photos,
      draft: !photos.length,
      spin: resolveSpin(cfg),
    };
  }

  function renderCubeFaces(photos, offset) {
    const n = photos.length;
    return CUBE_FACES.map((face, i) => {
      const photo = n ? photos[(offset + i) % n] : null;
      return `<div class="photocube-face photocube-face--${face.key}" data-face="${face.key}">`
        + renderMedia(photo)
        + `<span class="photocube-face-label">${escapeHtml(face.label)}</span>`
        + `</div>`;
    }).join('');
  }

  function renderCubeBody(spec, editable) {
    const mobile = isPhotoviewMobile();
    if (spec.draft) {
      return renderPasteZone(editable
        ? (mobile
          ? 'Tap to add a photo, or paste'
          : 'Paste a photo (Ctrl+V) or drop files onto the cube')
        : 'Add photos in markdown.');
    }
    const addBtn = editable
      ? `<button type="button" class="btn btn-sm btn-outline-secondary" data-action="add-photo">Add photo</button>`
      : '';
    const moreBtn = spec.photos.length > 6
      ? `<button type="button" class="btn btn-sm btn-outline-light" data-action="cube-shift">Next faces</button>`
      : '';
    return [
      `<div class="photocube-stage">`,
      `<div class="photocube-scene" tabindex="0" aria-label="Photo cube — drag to rotate">`,
      `<div class="photocube-cube">`,
      renderCubeFaces(spec.photos, 0),
      `</div>`,
      `</div>`,
      `<p class="photocube-hint">${mobile
        ? 'Drag to turn · tap Add photo to upload or paste'
        : 'Drag to turn the cube · photos wrap around all six faces'}</p>`,
      `<div class="photoview-toolbar">`,
      `<button type="button" class="btn btn-sm btn-outline-light" data-action="cube-spin" aria-pressed="${spec.spin ? 'true' : 'false'}">${spec.spin ? 'Pause spin' : 'Spin'}</button>`,
      moreBtn,
      addBtn,
      `</div>`,
      `</div>`,
    ].join('');
  }

  function renderCubeBlock(source, fenceAttrs, options = {}) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const style = resolveStyle(cfg);
    const spec = buildCubeSpec(source, cfg);
    const index = Number.isFinite(options.photocubeIndex) ? options.photocubeIndex : 0;
    const editable = options.editable !== false;
    const fullscreen = resolveFullscreen(cfg);
    const chrome = fullscreen ? '' : renderChrome(spec, 'cube');
    return [
      `<div class="${shellClasses('photocube', style, spec, editable, fullscreen)}"${styleAttr(style)}`,
      ` data-photocube-index="${index}"`,
      ` data-photocube-spec="${escapeHtml(encodeSpec(spec))}" tabindex="0">`,
      renderFullscreenButton(),
      chrome,
      renderCubeBody(spec, editable),
      `<div class="photoview-status"></div>`,
      `</div>`,
    ].join('');
  }

  function hydrateCube(el, options = {}) {
    if (!el || el.dataset.photocubeHydrated === '1') return;
    const spec = decodeSpec(el.dataset.photocubeSpec);
    if (!spec) return;
    el.dataset.photocubeHydrated = '1';
    bindFullscreenButton(el);

    const cube = el.querySelector('.photocube-cube');
    const scene = el.querySelector('.photocube-scene');
    let offset = 0;
    let q = quatFromAxisAngle(1, 0.35, 0, (-18 * Math.PI) / 180);
    q = quatMul(quatFromAxisAngle(0, 1, 0, (28 * Math.PI) / 180), q);
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let spinning = !!spec.spin;
    let lastTs = 0;
    let raf = 0;
    const reduceMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) spinning = false;

    function fitCube() {
      if (!scene) return;
      const w = scene.clientWidth || 0;
      const h = scene.clientHeight || 0;
      const visW = window.visualViewport?.width || window.innerWidth || w;
      const visH = window.visualViewport?.height || window.innerHeight || h;
      if (isPhotoviewMobile()) {
        const full = isPhotoviewMonitorFullscreen(el);
        const capW = Math.min(w > 40 ? w : visW, visW - (full ? 20 : 28));
        const capH = full
          ? Math.min(h > 80 ? h : visH, visH - 96)
          : Math.min(visH * 0.32, h > 80 ? h : visH * 0.32);
        const maxFace = full ? 280 : 168;
        const size = Math.max(108, Math.min(maxFace, Math.floor(Math.min(capW, capH) / 1.55)));
        scene.style.setProperty('--photocube-size', `${size}px`);
        return;
      }
      if (w < 80 || h < 80) return;
      const size = Math.max(180, Math.floor(Math.min(w, h) * 0.78));
      scene.style.setProperty('--photocube-size', `${size}px`);
    }

    function applyRotation() {
      if (!cube) return;
      cube.style.transform = quatToRotate3d(q);
    }

    function paintFaces() {
      if (!cube || !spec.photos?.length) return;
      cube.innerHTML = renderCubeFaces(spec.photos, offset);
    }

    function syncSpinButton() {
      const btn = el.querySelector('[data-action="cube-spin"]');
      if (!btn) return;
      btn.setAttribute('aria-pressed', spinning ? 'true' : 'false');
      btn.textContent = spinning ? 'Pause spin' : 'Spin';
    }

    function tick(ts) {
      if (!el.isConnected) return;
      if (spinning && !dragging && cube) {
        const dt = lastTs ? Math.min(40, ts - lastTs) : 16;
        q = quatMul(quatFromAxisAngle(0, 1, 0, dt * 0.00048), q);
        applyRotation();
      }
      lastTs = ts;
      raf = requestAnimationFrame(tick);
    }

    if (cube) {
      applyRotation();
      fitCube();
      raf = requestAnimationFrame(tick);
      const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => fitCube()) : null;
      if (ro && scene) ro.observe(scene);
      const onFs = () => requestAnimationFrame(fitCube);
      el.addEventListener('notespro:monitor-fullscreen', onFs);
      window.addEventListener('resize', fitCube);
      const disconnectObs = new MutationObserver(() => {
        if (!el.isConnected) {
          cancelAnimationFrame(raf);
          ro?.disconnect();
          window.removeEventListener('resize', fitCube);
          el.removeEventListener('notespro:monitor-fullscreen', onFs);
          disconnectObs.disconnect();
        }
      });
      disconnectObs.observe(document.body, { childList: true, subtree: true });
    }

    if (scene) {
      scene.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button !== 0) return;
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        try { scene.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      });
      scene.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dx = e.movementX || (e.clientX - lastX);
        const dy = e.movementY || (e.clientY - lastY);
        lastX = e.clientX;
        lastY = e.clientY;
        const mag = Math.hypot(dx, dy);
        if (mag < 0.2) return;
        // Screen drag vector (dx, dy): rotate around the perpendicular axis so the cube follows the gesture.
        q = quatMul(quatFromAxisAngle(-dy, dx, 0, mag * 0.008), q);
        applyRotation();
      });
      const endDrag = () => { dragging = false; };
      scene.addEventListener('pointerup', endDrag);
      scene.addEventListener('pointercancel', endDrag);
      scene.addEventListener('lostpointercapture', endDrag);
    }

    el.addEventListener('click', (e) => {
      if (e.target.closest('.game-fullscreen-btn')) return;
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'cube-spin') {
        spinning = !spinning;
        syncSpinButton();
        return;
      }
      if (action === 'cube-shift' && spec.photos?.length) {
        offset = (offset + 1) % spec.photos.length;
        paintFaces();
        setStatus(el, `Faces shifted · showing set from photo ${offset + 1}`);
        return;
      }
      if (action === 'add-photo') {
        setStatus(el, isPhotoviewMobile()
          ? 'Choose a photo, or paste here.'
          : 'Paste an image (Ctrl+V) or drop a file onto the cube.');
        armPasteTarget(el);
        return;
      }
    });

    bindPasteDrop(el, spec, options);
  }

  /* ---------- Photo book ---------- */

  function buildBookSpec(source, cfg) {
    const title = String(cfg.title || '').trim();
    const photos = parsePhotos(source);
    return {
      title,
      photos,
      draft: !photos.length,
    };
  }

  function spreadCount(photos) {
    return Math.max(1, Math.ceil((photos || []).length / 2));
  }

  function photosForSpread(photos, spread) {
    const left = photos[spread * 2] || null;
    const right = photos[spread * 2 + 1] || null;
    return { left, right };
  }

  function renderBookPage(photo, side, pageNo, total) {
    const caption = photo?.label ? escapeHtml(photo.label) : '';
    return [
      `<div class="photobook-page photobook-page--${side}" data-side="${side}">`,
      `<div class="photobook-page-inner">`,
      renderMedia(photo, 'photobook-page-media'),
      caption ? `<div class="photobook-caption">${caption}</div>` : '',
      `</div>`,
      `<span class="photobook-folio">${pageNo} / ${total}</span>`,
      `</div>`,
    ].join('');
  }

  function renderBookSpread(photos, spread) {
    const { left, right } = photosForSpread(photos, spread);
    const total = photos.length;
    const leftNo = spread * 2 + 1;
    const rightNo = Math.min(total, spread * 2 + 2);
    return [
      `<div class="photobook-spread" data-spread="${spread}">`,
      renderBookPage(left, 'left', leftNo, total),
      `<div class="photobook-gutter" aria-hidden="true"></div>`,
      renderBookPage(right, 'right', right ? rightNo : leftNo, total),
      `</div>`,
    ].join('');
  }

  function renderBookBody(spec, editable) {
    if (spec.draft) {
      return renderPasteZone(editable
        ? 'Paste a photo (Ctrl+V) or drop files onto the book'
        : 'Add photos in markdown.');
    }
    const coverPhoto = spec.photos[0];
    const addBtn = editable
      ? `<button type="button" class="btn btn-sm btn-outline-secondary" data-action="add-photo">Add photo</button>`
      : '';
    return [
      `<div class="photobook-stage">`,
      `<div class="photobook-viewport">`,
      `<div class="photobook-book is-closed" tabindex="0" aria-label="Photo book">`,
      `<div class="photobook-cover">`,
      `<div class="photobook-cover-front">`,
      `<div class="photobook-cover-inset">${renderMedia(coverPhoto)}</div>`,
      spec.title ? `<div class="photobook-cover-title">${escapeHtml(spec.title)}</div>` : '',
      `<div class="photobook-cover-meta">${spec.photos.length} photo${spec.photos.length === 1 ? '' : 's'}</div>`,
      `<button type="button" class="btn btn-sm btn-light" data-action="book-open">Open book</button>`,
      `</div>`,
      `</div>`,
      `<div class="photobook-open">`,
      renderBookSpread(spec.photos, 0),
      `</div>`,
      `</div>`,
      `</div>`,
      `<div class="photoview-toolbar">`,
      `<button type="button" class="btn btn-sm btn-outline-light" data-action="book-prev">◀ Prev</button>`,
      `<span class="photobook-progress" data-role="book-progress">Cover</span>`,
      `<button type="button" class="btn btn-sm btn-outline-light" data-action="book-next">Next ▶</button>`,
      addBtn,
      `</div>`,
      `<p class="photobook-hint">Click left to go back · click right to turn forward</p>`,
      `</div>`,
    ].join('');
  }

  function renderBookBlock(source, fenceAttrs, options = {}) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const style = resolveStyle(cfg);
    const spec = buildBookSpec(source, cfg);
    const index = Number.isFinite(options.photobookIndex) ? options.photobookIndex : 0;
    const editable = options.editable !== false;
    const fullscreen = resolveFullscreen(cfg);
    const chrome = (fullscreen || spec.draft || !spec.title) ? '' : renderChrome(spec, 'book');
    return [
      `<div class="${shellClasses('photobook', style, spec, editable, fullscreen)}"${styleAttr(style)}`,
      ` data-photobook-index="${index}"`,
      ` data-photobook-spec="${escapeHtml(encodeSpec(spec))}" tabindex="0">`,
      renderFullscreenButton(),
      chrome,
      renderBookBody(spec, editable),
      `<div class="photoview-status"></div>`,
      `</div>`,
    ].join('');
  }

  function hydrateBook(el, options = {}) {
    if (!el || el.dataset.photobookHydrated === '1') return;
    const spec = decodeSpec(el.dataset.photobookSpec);
    if (!spec) return;
    el.dataset.photobookHydrated = '1';
    bindFullscreenButton(el);
    if (!spec.photos?.length) {
      bindPasteDrop(el, spec, options);
      return;
    }

    const book = el.querySelector('.photobook-book');
    const viewport = el.querySelector('.photobook-viewport');
    const openWrap = el.querySelector('.photobook-open');
    const progress = el.querySelector('[data-role="book-progress"]');
    const totalSpreads = spreadCount(spec.photos);
    let open = false;
    let spread = 0;
    let flipping = false;
    let swipeX = null;
    let swiped = false;
    let ignoreClick = false;

    function paintSpread() {
      if (!openWrap) return;
      openWrap.innerHTML = renderBookSpread(spec.photos, spread);
    }

    function syncProgress() {
      if (!progress) return;
      if (!open) {
        progress.textContent = 'Cover';
        return;
      }
      progress.textContent = `${spread + 1} / ${totalSpreads}`;
    }

    function fitBook() {
      if (!book) return;
      const visW = window.visualViewport?.width || window.innerWidth || 360;
      const visH = window.visualViewport?.height || window.innerHeight || 640;
      const boxW = viewport?.clientWidth || book.parentElement?.clientWidth || visW;
      const boxH = viewport?.clientHeight || 0;
      const mobile = isPhotoviewMobile();
      let maxW;
      let maxH;
      if (mobile) {
        const full = isPhotoviewMonitorFullscreen(el);
        maxW = Math.min(boxW > 40 ? boxW : visW, visW - 24) * (full ? 0.96 : 0.94);
        const share = full ? 0.86 : 0.42;
        maxH = Math.min(boxH > 80 ? boxH : visH * share, visH * share);
      } else {
        if (boxW < 80 || boxH < 80) return;
        maxW = boxW * 0.98;
        maxH = boxH * 0.98;
      }
      const openNow = book.classList.contains('is-open');
      const ratio = openNow ? (mobile ? 1.22 : 1.42) : 0.72;
      let bw;
      let bh;
      if (maxW / maxH > ratio) {
        bh = maxH;
        bw = bh * ratio;
      } else {
        bw = maxW;
        bh = bw / ratio;
      }
      const widthPx = `${Math.max(mobile ? 132 : 120, Math.floor(bw))}px`;
      const heightPx = `${Math.max(mobile ? 150 : 160, Math.floor(bh))}px`;
      book.style.setProperty('--photobook-w', widthPx);
      book.style.setProperty('--photobook-h', heightPx);
      book.style.width = widthPx;
      book.style.height = heightPx;
    }

    function setOpen(next) {
      open = next;
      book?.classList.toggle('is-closed', !open);
      book?.classList.toggle('is-open', open);
      syncProgress();
      requestAnimationFrame(fitBook);
    }

    function go(delta) {
      if (flipping) return;
      if (!open) {
        if (delta > 0) setOpen(true);
        return;
      }
      const next = spread + delta;
      if (next < 0) {
        setOpen(false);
        return;
      }
      if (next >= totalSpreads) return;
      flipping = true;
      const flippingPage = openWrap?.querySelector(delta > 0 ? '.photobook-page--right' : '.photobook-page--left');
      flippingPage?.classList.add(delta > 0 ? 'is-flipping-forward' : 'is-flipping-back');
      const finish = () => {
        spread = next;
        paintSpread();
        syncProgress();
        flipping = false;
      };
      window.setTimeout(finish, 520);
    }

    function turnFromEvent(e) {
      if (e.button === 2) {
        go(1);
        return;
      }
      const rect = book.getBoundingClientRect();
      const x = e.clientX - rect.left;
      if (!open) {
        setOpen(true);
        return;
      }
      go(x < rect.width / 2 ? -1 : 1);
    }

    el.addEventListener('click', (e) => {
      if (ignoreClick || swiped) {
        ignoreClick = false;
        swiped = false;
        return;
      }
      if (e.target.closest('.game-fullscreen-btn')) return;
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'book-open') {
        setOpen(true);
        return;
      }
      if (action === 'book-next') {
        go(1);
        return;
      }
      if (action === 'book-prev') {
        go(-1);
        return;
      }
      if (action === 'add-photo') {
        setStatus(el, 'Paste an image (Ctrl+V) or drop a file onto the book.');
        armPasteTarget(el);
        return;
      }
    });

    book?.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        go(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        go(-1);
      }
    });

    book?.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    book?.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.photoview-toolbar, .game-fullscreen-btn')) return;
      if (e.target.closest('[data-action]') && e.target.closest('.photoview-toolbar')) return;
      swipeX = e.clientX;
      swiped = false;
      try { book.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    });
    book?.addEventListener('pointerup', (e) => {
      if (swipeX == null) return;
      if (e.target.closest('.photoview-toolbar, .game-fullscreen-btn')) {
        swipeX = null;
        return;
      }
      const dx = e.clientX - swipeX;
      swipeX = null;
      if (Math.abs(dx) >= 40) {
        swiped = true;
        ignoreClick = true;
        go(dx < 0 ? 1 : -1);
        return;
      }
      ignoreClick = true;
      turnFromEvent(e);
    });

    syncProgress();
    fitBook();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => fitBook()) : null;
    if (ro && viewport) ro.observe(viewport);
    const onFs = () => requestAnimationFrame(fitBook);
    el.addEventListener('notespro:monitor-fullscreen', onFs);
    window.addEventListener('resize', fitBook);
    const disconnectObs = new MutationObserver(() => {
      if (!el.isConnected) {
        ro?.disconnect();
        window.removeEventListener('resize', fitBook);
        el.removeEventListener('notespro:monitor-fullscreen', onFs);
        disconnectObs.disconnect();
      }
    });
    disconnectObs.observe(document.body, { childList: true, subtree: true });
    bindPasteDrop(el, spec, options);
  }

  /* ---------- Photo carousel (ThGCube-style 3D wheel) ---------- */

  const TAU = Math.PI * 2;

  function resolveAutoplay(cfg) {
    const hasDemo = Object.prototype.hasOwnProperty.call(cfg, 'demo');
    const hasAuto = Object.prototype.hasOwnProperty.call(cfg, 'auto')
      || Object.prototype.hasOwnProperty.call(cfg, 'autoplay');
    if (!hasDemo && !hasAuto) return true;
    const raw = String(cfg.demo ?? cfg.auto ?? cfg.autoplay ?? '').trim().toLowerCase();
    if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
    return true;
  }

  function resolveInterval(cfg) {
    const n = parseInt(cfg.interval || cfg.ms || cfg.delay, 10);
    if (!Number.isFinite(n)) return 4500;
    return Math.max(1800, Math.min(20000, n));
  }

  function resolveAxis(cfg) {
    const raw = String(cfg.axis || cfg.wheel || cfg.orient || '').trim().toLowerCase();
    if (raw === 'v' || raw === 'vertical' || raw === 'y' || raw === 'wheelv' || raw === 'vert') return 'v';
    return 'h';
  }

  function buildCarouselSpec(source, cfg) {
    const title = String(cfg.title || 'Photo carousel').trim() || 'Photo carousel';
    const photos = parsePhotos(source);
    return {
      title,
      photos,
      draft: !photos.length,
      autoplay: resolveAutoplay(cfg),
      interval: resolveInterval(cfg),
      axis: resolveAxis(cfg),
    };
  }

  function renderCarouselCards(photos) {
    if (!photos.length) return '';
    return photos.map((photo, i) => (
      `<div class="carousel-card" data-index="${i}" style="--carousel-i:${i}" aria-hidden="${i === 0 ? 'false' : 'true'}">`
      + renderMedia(photo, 'carousel-media')
      + `</div>`
    )).join('');
  }

  function renderCarouselDots(n, active) {
    if (n < 2) return '';
    const items = [];
    for (let i = 0; i < n; i += 1) {
      items.push(
        `<button type="button" class="carousel-dot${i === active ? ' is-active' : ''}" data-index="${i}" tabindex="-1" aria-label="Photo ${i + 1}"></button>`,
      );
    }
    return `<div class="carousel-dots" role="tablist">${items.join('')}</div>`;
  }

  function renderCarouselBody(spec, editable) {
    if (spec.draft) {
      return renderPasteZone(editable
        ? 'Paste photos (Ctrl+V) or drop files onto the carousel'
        : 'Add photos in markdown.');
    }
    const addBtn = editable
      ? `<button type="button" class="btn btn-sm btn-outline-secondary" data-action="add-photo">Add photo</button>`
      : '';
    const n = spec.photos.length;
    const first = spec.photos[0];
    const axis = spec.axis === 'v' ? 'v' : 'h';
    const mobile = isPhotoviewMobile();
    return [
      `<div class="carousel-stage">`,
      `<div class="carousel-viewport">`,
      `<div class="carousel-scene carousel-scene--${axis}" tabindex="0" aria-label="Photo carousel — A/D turn, wheel tilts the camera">`,
      `<div class="carousel-ring">`,
      renderCarouselCards(spec.photos),
      `</div>`,
      `<div class="carousel-hud">`,
      n > 1 ? `<button type="button" class="carousel-nav carousel-nav--prev" data-action="carousel-prev" aria-label="Previous">‹</button>` : '',
      n > 1 ? `<button type="button" class="carousel-nav carousel-nav--next" data-action="carousel-next" aria-label="Next">›</button>` : '',
      `<div class="carousel-caption">${escapeHtml(first?.label || '')}</div>`,
      renderCarouselDots(n, 0),
      `</div>`,
      `</div>`,
      `</div>`,
      `<p class="carousel-hint">${n > 1
        ? (mobile
          ? 'Drag sideways to spin · tap a photo to open it'
          : 'A/D or drag to turn · W/S or mouse wheel tilt the camera · click a photo to open it')
        : 'Click the photo to open it'}</p>`,
      `<div class="photoview-toolbar">`,
      n > 1 ? `<button type="button" class="btn btn-sm btn-outline-light" data-action="carousel-play" aria-pressed="${spec.autoplay ? 'true' : 'false'}">${spec.autoplay ? 'Pause' : 'Play'}</button>` : '',
      n > 1 ? `<button type="button" class="btn btn-sm btn-outline-light" data-action="carousel-axis" aria-pressed="${axis === 'v' ? 'true' : 'false'}">${axis === 'v' ? 'Wheel V' : 'Wheel H'}</button>` : '',
      addBtn,
      `</div>`,
      `</div>`,
    ].join('');
  }

  function renderCarouselBlock(source, fenceAttrs, options = {}) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const style = resolveStyle(cfg);
    const spec = buildCarouselSpec(source, cfg);
    const index = Number.isFinite(options.carouselIndex) ? options.carouselIndex : 0;
    const editable = options.editable !== false;
    const fullscreen = resolveFullscreen(cfg);
    const chrome = fullscreen ? '' : renderChrome(spec, 'carousel');
    return [
      `<div class="${shellClasses('carousel', style, spec, editable, fullscreen)}"${styleAttr(style)}`,
      ` data-carousel-index="${index}"`,
      ` data-carousel-spec="${escapeHtml(encodeSpec(spec))}" tabindex="0">`,
      renderFullscreenButton(),
      chrome,
      renderCarouselBody(spec, editable),
      `<div class="photoview-status"></div>`,
      `</div>`,
    ].join('');
  }

  function hydrateCarousel(el, options = {}) {
    if (!el || el.dataset.carouselHydrated === '1') return;
    const spec = decodeSpec(el.dataset.carouselSpec);
    if (!spec) return;
    el.dataset.carouselHydrated = '1';
    bindFullscreenButton(el);
    bindPasteDrop(el, spec, options);

    const scene = el.querySelector('.carousel-scene');
    const viewport = el.querySelector('.carousel-viewport');
    const ring = el.querySelector('.carousel-ring');
    const caption = el.querySelector('.carousel-caption');
    const playBtn = el.querySelector('[data-action="carousel-play"]');
    const axisBtn = el.querySelector('[data-action="carousel-axis"]');
    const n = spec.photos.length;
    let axis = spec.axis === 'v' ? 'v' : 'h';
    let phi = 0;
    let camTilt = axis === 'v' ? 18 : -22;
    let spinDir = 1;
    let spinning = n > 1 && !!spec.autoplay;
    const reduceMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) spinning = false;
    let dragging = false;
    let hovered = false;
    let lastX = 0;
    let lastY = 0;
    let dragDist = 0;
    let lastTs = 0;
    let raf = 0;
    let radiusPx = 220;
    const held = { a: false, d: false };

    function stepAngle() {
      return n > 0 ? TAU / n : TAU;
    }

    function frontIndex() {
      if (n < 1) return 0;
      const wrapped = ((phi % TAU) + TAU) % TAU;
      return Math.round(wrapped / stepAngle()) % n;
    }

    function wrapDelta(target, current) {
      let delta = target - current;
      if (delta > Math.PI) delta -= TAU;
      if (delta < -Math.PI) delta += TAU;
      return delta;
    }

    function setAxis(next) {
      axis = next === 'v' ? 'v' : 'h';
      camTilt = axis === 'v' ? 18 : -22;
      scene?.classList.toggle('carousel-scene--v', axis === 'v');
      scene?.classList.toggle('carousel-scene--h', axis !== 'v');
      if (axisBtn) {
        axisBtn.setAttribute('aria-pressed', axis === 'v' ? 'true' : 'false');
        axisBtn.textContent = axis === 'v' ? 'Wheel V' : 'Wheel H';
      }
      fitCarousel();
      applyRing();
      paintChrome();
    }

    function fitCarousel() {
      if (!scene) return;
      const box = viewport || scene;
      const w = box.clientWidth || 0;
      const h = box.clientHeight || 0;
      const visW = window.visualViewport?.width || window.innerWidth || w;
      const visH = window.visualViewport?.height || window.innerHeight || h;
      const full = isPhotoviewMonitorFullscreen(el);
      const mobile = isPhotoviewMobile();
      const boxW = w > 40 ? w : visW;
      const boxH = h > 80 ? h : (mobile ? visH * 0.32 : visH * 0.5);
      const cardW = Math.max(96, Math.min(mobile ? 150 : 270, Math.floor(boxW * (mobile ? 0.4 : 0.26))));
      const cardH = Math.max(70, Math.min(mobile ? 108 : 196, Math.floor(cardW * 0.7)));
      const count = Math.max(n, 1);
      const packed = count < 2 ? 0 : (cardW / 2) / Math.tan(Math.PI / count);
      if (axis === 'v') {
        const cap = boxH * (full ? 0.4 : mobile ? 0.32 : 0.36);
        radiusPx = count < 2 ? 0 : Math.max(packed * 1.02, Math.min(cap, packed * 1.35));
      } else {
        const cap = Math.min(boxW * (full ? 0.3 : mobile ? 0.3 : 0.27), boxH * 0.32);
        radiusPx = count < 2 ? 0 : Math.max(packed * 1.05, Math.min(cap, packed * 1.45));
      }
      scene.style.setProperty('--carousel-card-w', `${cardW}px`);
      scene.style.setProperty('--carousel-card-h', `${cardH}px`);
      scene.style.setProperty('--carousel-radius', `${radiusPx}px`);
      scene.style.setProperty('--carousel-step', `${360 / count}deg`);
      applyRing();
    }

    function applyRing() {
      if (!ring) return;
      const deg = (phi * 180) / Math.PI;
      ring.style.transform = axis === 'v'
        ? `rotateY(${camTilt}deg) rotateX(${-deg}deg)`
        : `translateY(-6%) rotateX(${camTilt}deg) rotateY(${-deg}deg)`;
      const step = stepAngle();
      el.querySelectorAll('.carousel-card').forEach((card, i) => {
        const ang = i * step;
        const rel = ((ang - phi) % TAU + TAU) % TAU;
        const facing = Math.cos(rel);
        card.style.zIndex = String(Math.round(40 + facing * 40));
        card.style.filter = `brightness(${(0.48 + Math.max(0, facing) * 0.52).toFixed(3)})`;
      });
    }

    function paintChrome() {
      const index = frontIndex();
      el.querySelectorAll('.carousel-card').forEach((card, i) => {
        card.setAttribute('aria-hidden', i === index ? 'false' : 'true');
        card.classList.toggle('is-front', i === index);
      });
      el.querySelectorAll('.carousel-dot').forEach((dot, i) => {
        dot.classList.toggle('is-active', i === index);
      });
      if (caption) caption.textContent = spec.photos[index]?.label || '';
      if (playBtn) {
        playBtn.setAttribute('aria-pressed', spinning ? 'true' : 'false');
        playBtn.textContent = spinning ? 'Pause' : 'Play';
      }
    }

    function snapTo(next) {
      if (n < 1) return;
      const index = ((next % n) + n) % n;
      const current = ((phi % TAU) + TAU) % TAU;
      phi += wrapDelta(index * stepAngle(), current);
      applyRing();
      paintChrome();
    }

    function setPlaying(on) {
      spinning = n > 1 && !!on;
      paintChrome();
    }

    function openFrontPhoto() {
      const photos = spec.photos;
      if (!photos.length) return;
      const index = frontIndex();
      const resume = spinning;
      setPlaying(false);
      const open = window.NotesProGallery?.openLightbox;
      if (typeof open === 'function') {
        open(photos, index, {
          onClose: () => { if (resume) setPlaying(true); },
        });
        return;
      }
      const href = photoHref(photos[index]);
      if (href) window.open(href, '_blank', 'noopener');
    }

    function keysActive() {
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return false;
      return hovered || el.contains(ae) || ae === scene;
    }

    function tick(ts) {
      if (!el.isConnected) return;
      const dt = lastTs ? Math.min(40, ts - lastTs) : 16;
      lastTs = ts;
      let turned = false;
      if (n > 1 && !dragging) {
        const yaw = 1.85 * (dt / 1000);
        if (held.a) {
          phi -= yaw;
          spinDir = -1;
          turned = true;
        }
        if (held.d) {
          phi += yaw;
          spinDir = 1;
          turned = true;
        }
      }
      if (turned) {
        setPlaying(false);
        applyRing();
        paintChrome();
      } else if (spinning && !dragging && n > 1) {
        const omega = stepAngle() / (spec.interval || 4500);
        phi += spinDir * omega * dt;
        applyRing();
        paintChrome();
      }
      raf = requestAnimationFrame(tick);
    }

    el.addEventListener('click', (e) => {
      if (e.target.closest('.game-fullscreen-btn')) return;
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'carousel-prev') {
        setPlaying(false);
        snapTo(frontIndex() - 1);
        return;
      }
      if (action === 'carousel-next') {
        setPlaying(false);
        snapTo(frontIndex() + 1);
        return;
      }
      if (action === 'carousel-play') {
        setPlaying(!spinning);
        return;
      }
      if (action === 'carousel-axis') {
        setAxis(axis === 'v' ? 'h' : 'v');
        return;
      }
      if (action === 'add-photo') {
        setStatus(el, isPhotoviewMobile()
          ? 'Choose a photo, or paste here.'
          : 'Paste an image (Ctrl+V) or drop a file onto the carousel.');
        armPasteTarget(el);
      }
    });

    el.querySelectorAll('.carousel-dot').forEach((dot) => {
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        const i = parseInt(dot.dataset.index, 10);
        if (!Number.isFinite(i)) return;
        setPlaying(false);
        snapTo(i);
      });
    });

    function nudgeTilt(delta) {
      if (axis === 'v') {
        camTilt = Math.max(-8, Math.min(42, camTilt + delta));
      } else {
        camTilt = Math.max(-52, Math.min(-6, camTilt + delta));
      }
      applyRing();
    }

    function onKey(e) {
      if (!keysActive()) return;
      const key = e.key;
      const code = e.code;
      if (key === 'w' || key === 'W') {
        e.preventDefault();
        nudgeTilt(-5);
        return;
      }
      if (key === 's' || key === 'S') {
        e.preventDefault();
        nudgeTilt(5);
        return;
      }
      if (key === 'a' || key === 'A' || code === 'KeyA') {
        e.preventDefault();
        held.a = true;
        if (!e.repeat && n > 1) {
          setPlaying(false);
          phi -= 0.22;
          spinDir = -1;
          applyRing();
          paintChrome();
        }
        return;
      }
      if (key === 'd' || key === 'D' || code === 'KeyD') {
        e.preventDefault();
        held.d = true;
        if (!e.repeat && n > 1) {
          setPlaying(false);
          phi += 0.22;
          spinDir = 1;
          applyRing();
          paintChrome();
        }
        return;
      }
      if (key === 'ArrowLeft' || (axis === 'v' && key === 'ArrowUp')) {
        e.preventDefault();
        setPlaying(false);
        snapTo(frontIndex() - 1);
        return;
      }
      if (key === 'ArrowRight' || (axis === 'v' && key === 'ArrowDown')) {
        e.preventDefault();
        setPlaying(false);
        snapTo(frontIndex() + 1);
        return;
      }
      if (key === ' ') {
        e.preventDefault();
        setPlaying(!spinning);
      }
    }

    function onKeyUp(e) {
      const key = e.key;
      const code = e.code;
      if (key === 'a' || key === 'A' || code === 'KeyA') held.a = false;
      if (key === 'd' || key === 'D' || code === 'KeyD') held.d = false;
    }

    function onWheel(e) {
      e.preventDefault();
      const delta = e.deltaY;
      if (!delta) return;
      const step = Math.sign(delta) * Math.min(10, Math.max(2.8, Math.abs(delta) * 0.035));
      nudgeTilt(step);
    }

    if (scene) {
      scene.addEventListener('pointerenter', () => { hovered = true; });
      scene.addEventListener('pointerleave', () => { hovered = false; });
      scene.addEventListener('wheel', onWheel, { passive: false });
      scene.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.carousel-nav, .carousel-dot, .photoview-toolbar, .game-fullscreen-btn')) return;
        scene.focus({ preventScroll: true });
        if (e.button != null && e.button !== 0) return;
        dragging = true;
        dragDist = 0;
        lastX = e.clientX;
        lastY = e.clientY;
        try { scene.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      });
      scene.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dx = e.movementX || (e.clientX - lastX);
        const dy = e.movementY || (e.clientY - lastY);
        lastX = e.clientX;
        lastY = e.clientY;
        const primary = axis === 'v' ? dy : dx;
        dragDist += Math.hypot(dx, dy);
        if (Math.abs(primary) < 0.2) return;
        phi -= primary * 0.008;
        if (Math.abs(primary) > 0.6) spinDir = primary < 0 ? 1 : -1;
        applyRing();
        paintChrome();
      });
      const endDrag = (e) => {
        if (!dragging) return;
        dragging = false;
        if (dragDist > 8 && spinning) return;
        if (e?.type === 'pointerup' && dragDist < 8) openFrontPhoto();
      };
      scene.addEventListener('pointerup', endDrag);
      scene.addEventListener('pointercancel', () => { dragging = false; });
      scene.addEventListener('lostpointercapture', () => { dragging = false; });
    }

    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    setAxis(axis);
    fitCarousel();
    applyRing();
    paintChrome();
    raf = requestAnimationFrame(tick);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => fitCarousel()) : null;
    if (ro) ro.observe(viewport || scene);
    const onFs = () => requestAnimationFrame(fitCarousel);
    el.addEventListener('notespro:monitor-fullscreen', onFs);
    window.addEventListener('resize', fitCarousel);

    const disconnectObs = new MutationObserver(() => {
      if (!el.isConnected) {
        cancelAnimationFrame(raf);
        ro?.disconnect();
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKeyUp);
        scene?.removeEventListener('wheel', onWheel);
        window.removeEventListener('resize', fitCarousel);
        el.removeEventListener('notespro:monitor-fullscreen', onFs);
        disconnectObs.disconnect();
      }
    });
    disconnectObs.observe(document.body, { childList: true, subtree: true });
  }

  const shared = {
    parseFenceAttrs,
    parsePhotos,
    formatPhotoBody,
    buildFenceAttrsString,
    extractYoutubeId,
    pickImageFiles,
    decodeSpec,
  };

  return {
    cube: {
      ...shared,
      buildSpec: buildCubeSpec,
      renderBlock: renderCubeBlock,
      hydrateBlock: hydrateCube,
      hydrate(root) {
        (root || document).querySelectorAll('.photocube-block[data-photocube-spec]').forEach(hydrateCube);
      },
    },
    book: {
      ...shared,
      buildSpec: buildBookSpec,
      renderBlock: renderBookBlock,
      hydrateBlock: hydrateBook,
      hydrate(root) {
        (root || document).querySelectorAll('.photobook-block[data-photobook-spec]').forEach(hydrateBook);
      },
    },
    carousel: {
      ...shared,
      buildSpec: buildCarouselSpec,
      renderBlock: renderCarouselBlock,
      hydrateBlock: hydrateCarousel,
      hydrate(root) {
        (root || document).querySelectorAll('.carousel-block[data-carousel-spec]').forEach(hydrateCarousel);
      },
    },
  };
}));
