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

  function mediaKind(src) {
    return isVideoSrc(src) ? 'video' : 'image';
  }

  function parsePhotos(source) {
    const photos = [];
    const seen = new Set();
    const text = String(source || '');
    const mdImg = /!\[(.*?)\]\((.*?)\)/g;
    let match;
    while ((match = mdImg.exec(text)) !== null) {
      const src = match[2].trim();
      if (!src || seen.has(src)) continue;
      seen.add(src);
      photos.push({ src, label: (match[1] || '').trim(), kind: mediaKind(src) });
    }
    if (photos.length) return photos;
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
      if (!src || seen.has(src) || /\s/.test(src) && !/^https?:\/\//i.test(src) && !src.startsWith('media/')) return;
      const kind = mediaKind(src);
      const looksMedia = kind === 'video'
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
      const alt = p.label || (p.kind === 'video' ? `Video ${i + 1}` : `Photo ${i + 1}`);
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
    const src = escapeHtml(resolveMediaHref(photo.src));
    const kind = photo.kind === 'video' ? 'video' : 'image';
    const label = escapeHtml(photo.label || (kind === 'video' ? `Video ${index + 1}` : `Photo ${index + 1}`));
    const media = kind === 'video'
      ? `<video src="${src}" muted playsinline loop preload="metadata" draggable="false"></video>`
        + `<span class="gallery-thumb-badge" aria-hidden="true">▶</span>`
      : `<img src="${src}" alt="${label}" loading="lazy" draggable="false">`;
    return [
      `<button type="button" class="gallery-thumb${kind === 'video' ? ' gallery-thumb--video' : ''}" data-gallery-index="${index}" aria-label="${label}">`,
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
      `<div class="gallery-walk-overlay">`,
      `<p class="gallery-walk-hint">Click to look &amp; unlock sound · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk · wheel zoom · <kbd>Space</kbd> open · <kbd>Esc</kbd> release</p>`,
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
        ? 'Paste a photo (Ctrl+V) or add image/video URLs in markdown'
        : 'Add photos or videos in markdown.');
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

  function createWalkGallery(el, photos, options = {}) {
    const THREE = window.THREE;
    const viewport = el.querySelector('.gallery-walk-viewport');
    const canvas = el.querySelector('.gallery-walk-canvas');
    const captionEl = el.querySelector('.gallery-walk-caption');
    const demoBtn = el.querySelector('[data-action="walk-demo"]');
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

    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0xfff4e6, 0.85);
    key.position.set(2, 6, 4);
    scene.add(key);

    const spacing = 3.4;
    const hallLen = Math.max(10, photos.length * spacing + 6);
    const hallHalfW = 2.4;
    const wallH = 3.2;

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

    function fitPlaneToAspect(mesh, frameMesh, aspect) {
      const h = 1.35;
      const w = Math.min(2.1, h * Math.max(0.2, aspect || 1));
      mesh.geometry.dispose();
      mesh.geometry = new THREE.PlaneGeometry(w, h);
      frameMesh.geometry.dispose();
      frameMesh.geometry = new THREE.PlaneGeometry(w + 0.12, h + 0.12);
    }

    function tryPlayVideo(video) {
      if (!video) return;
      const p = video.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }

    function unlockAudio() {
      audioUnlocked = true;
      frames.forEach((f) => {
        if (!f.video) return;
        f.video.muted = false;
        tryPlayVideo(f.video);
      });
      updateVideoAudio();
    }

    function updateVideoAudio() {
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      frames.forEach((f) => {
        if (!f.video) return;
        const silent = lightboxMute || !audioUnlocked;
        f.video.muted = silent;
        if (silent) {
          f.video.volume = 0;
          if (f.video.paused) tryPlayVideo(f.video);
          return;
        }
        const to = f.mesh.position.clone().sub(camera.position);
        const dist = to.length();
        const align = dist > 0.001 ? to.normalize().dot(dir) : 1;
        // Full volume near the frame (~1.1m), silent beyond ~11m
        let vol = 1 - (dist - 1.1) / 9.5;
        vol = Math.max(0, Math.min(1, vol));
        if (align < 0) vol *= 0.12;
        else vol *= 0.2 + 0.8 * Math.max(0, align);
        f.video.volume = vol;
        if (f.video.paused) tryPlayVideo(f.video);
      });
    }

    function setLightboxMute(on) {
      lightboxMute = !!on;
      updateVideoAudio();
    }

    photos.forEach((photo, i) => {
      const side = i % 2 === 0 ? -1 : 1;
      const z = 2.5 + Math.floor(i / 2) * spacing + (i % 2) * (spacing * 0.35);
      const kind = photo.kind === 'video' || isVideoSrc(photo.src) ? 'video' : 'image';

      const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a2118, roughness: 0.6 });
      const frame = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 1.55), frameMat);
      frame.position.set(side * (hallHalfW - 0.04), 1.55, z);
      frame.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      scene.add(frame);

      const mat = new THREE.MeshBasicMaterial({ color: 0x222222 });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), mat);
      mesh.position.set(side * (hallHalfW - 0.08), 1.55, z);
      mesh.rotation.y = frame.rotation.y;
      scene.add(mesh);

      const url = resolveMediaHref(photo.src);
      const entry = { mesh, frame, photo, z, index: i, side, kind, video: null, texture: null };

      if (kind === 'video') {
        const video = document.createElement('video');
        video.src = url;
        video.crossOrigin = 'anonymous';
        video.loop = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.muted = true;
        video.volume = 0;
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        const onMeta = () => {
          if (video.videoWidth && video.videoHeight) {
            fitPlaneToAspect(mesh, frame, video.videoWidth / video.videoHeight);
          }
        };
        video.addEventListener('loadedmetadata', onMeta);
        const tex = new THREE.VideoTexture(video);
        tex.colorSpace = THREE.SRGBColorSpace;
        mat.map = tex;
        mat.color.set(0xffffff);
        mat.needsUpdate = true;
        entry.video = video;
        entry.texture = tex;
        tryPlayVideo(video);
      } else {
        loader.load(url, (t) => {
          t.colorSpace = THREE.SRGBColorSpace;
          mat.map = t;
          mat.color.set(0xffffff);
          mat.needsUpdate = true;
          entry.texture = t;
          const img = t.image;
          if (img && img.width && img.height) {
            fitPlaneToAspect(mesh, frame, img.width / img.height);
          }
        });
      }

      const spot = new THREE.SpotLight(0xffffff, 2.2, 8, Math.PI / 7, 0.4, 1);
      spot.position.set(side * 0.4, wallH - 0.2, z);
      spot.target = mesh;
      scene.add(spot);
      scene.add(spot.target);

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

    function buildTourWaypoints() {
      const nearWall = hallHalfW - 0.62;
      const pts = [{ x: 0, z: 0.7, yaw: 0, pitch: 0, hold: 0.5, fov: FOV_DEFAULT, travel: 1.1 }];
      frames.forEach((f) => {
        const side = f.side || (f.mesh.position.x >= 0 ? 1 : -1);
        const lookYaw = side > 0 ? Math.PI / 2 : -Math.PI / 2;
        const dwell = f.kind === 'video' ? 3.2 : 2.4;
        pts.push({
          x: side * 0.25,
          z: Math.max(0.5, f.z - 0.95),
          yaw: lookYaw * 0.35,
          pitch: -0.04,
          hold: 0.12,
          fov: 62,
          travel: 1.25,
        });
        pts.push({
          x: side * nearWall,
          z: f.z,
          yaw: lookYaw,
          pitch: -0.06,
          hold: dwell,
          fov: 36,
          travel: 1.35,
        });
        pts.push({
          x: side * 0.35,
          z: f.z + 0.7,
          yaw: 0,
          pitch: 0,
          hold: 0.1,
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
        const to = f.mesh.position.clone().sub(camera.position);
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
        const base = frame.photo.label || (frame.kind === 'video' ? 'Video' : 'Photo');
        captionEl.textContent = frame.kind === 'video' ? `${base} · sound nearby` : base;
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

      camera.position.x = Math.max(-hallHalfW + 0.32, Math.min(hallHalfW - 0.32, camera.position.x));
      camera.position.z = Math.max(0.4, Math.min(hallLen - 0.5, camera.position.z));
      camera.position.y = 1.6;
      camera.rotation.order = 'YXZ';
      camera.rotation.y = yaw;
      camera.rotation.x = pitch;

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
    if (root) return root;
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
    if (!video) return;
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.hidden = true;
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
    const caption = root.querySelector('.gallery-lightbox-caption');
    const counter = root.querySelector('.gallery-lightbox-counter');
    const href = resolveMediaHref(photo.src);
    const isVideo = photo.kind === 'video' || isVideoSrc(photo.src);
    if (isVideo) {
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
      img.hidden = false;
      img.src = href;
      img.alt = photo.label || `Photo ${lightboxState.index + 1}`;
    }
    caption.textContent = photo.label || '';
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
        setStatus(el, 'Paste an image (Ctrl+V) or drop a file onto the gallery.');
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

    if (typeof options.onPasteImage !== 'function') return;

    async function handlePasteFiles(files) {
      const imageFiles = [...files].filter(f => f && String(f.type || '').startsWith('image/'));
      if (!imageFiles.length) return;
      el.classList.add('gallery-block--uploading');
      setStatus(el, 'Uploading…');
      try {
        for (const file of imageFiles) {
          await options.onPasteImage(file, spec);
        }
      } finally {
        el.classList.remove('gallery-block--uploading');
      }
    }

    el.addEventListener('paste', (e) => {
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
