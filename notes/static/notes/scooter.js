/**
 * NotesPro ```scooter``` / ```autoscooter``` block — bumper-car rink with your images on other cars.
 */
(function (root, factory) {
  const api = factory();
  root.NotesProScooter = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];
  const CAR_COLORS = [0x2563eb, 0xdc2626, 0x16a34a, 0xd97706, 0x7c3aed, 0x0891b2, 0xdb2777, 0x65a30d];
  const ARENA_R = 11.5;
  const CAR_R = 0.95;

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function parseFenceAttrs(attrs) {
    const config = {};
    String(attrs || '').split(/[;\s]+/).forEach(pair => {
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
      if (!src || seen.has(src)) return;
      if (/\s/.test(src) && !/^https?:\/\//i.test(src) && !src.startsWith('media/')) return;
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

  function resolveFullscreen(cfg) {
    const raw = String(cfg.fullscreen ?? cfg.full ?? '1').trim().toLowerCase();
    if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'compact') return false;
    return true;
  }

  function resolveDemo(cfg) {
    if (!Object.prototype.hasOwnProperty.call(cfg, 'demo')) return true;
    const raw = String(cfg.demo ?? '').trim().toLowerCase();
    return raw === '' || raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
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

  function buildSpec(source, cfg) {
    const photos = parsePhotos(source);
    return {
      title: String(cfg.title || 'Auto scooter').trim() || 'Auto scooter',
      demo: resolveDemo(cfg),
      photos,
      draft: !photos.length,
    };
  }

  function renderFullscreenButton() {
    return window.NotesProGameFullscreen?.renderButton?.() || '';
  }

  function bindFullscreenButton(el) {
    window.NotesProGameFullscreen?.bind?.(el);
  }

  function threeReady() {
    return typeof window.THREE !== 'undefined';
  }

  function setStatus(el, text) {
    const status = el.querySelector('.scooter-status');
    if (!status) return;
    status.textContent = text || '';
  }

  function renderBlock(source, fenceAttrs, options = {}) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const style = resolveStyle(cfg);
    const spec = buildSpec(source, cfg);
    const scooterIndex = Number.isFinite(options.scooterIndex) ? options.scooterIndex : 0;
    const editable = options.editable !== false;
    const fullscreen = resolveFullscreen(cfg);
    const themeClass = style.theme ? ` scooter-block--${style.theme}` : '';
    const customClass = (style.colorCss || style.bgCss) ? ' scooter-block--custom' : '';
    const fullClass = fullscreen ? ' scooter-block--fullscreen' : '';
    const styleVars = [];
    if (style.colorCss) styleVars.push(`--scooter-accent:${style.colorCss}`);
    if (style.bgCss) styleVars.push(`--scooter-bg:${style.bgCss}`);
    const styleAttr = styleVars.length
      ? ` style="${styleVars.map(v => escapeHtml(v)).join(';')}"`
      : '';
    const encoded = encodeSpec(spec);
    const chrome = fullscreen ? '' : [
      `<div class="scooter-block-header">`,
      `<div class="scooter-block-title">${escapeHtml(spec.title)}</div>`,
      `<div class="scooter-block-meta">${spec.draft ? 'add photos for other cars' : `${spec.photos.length} car image${spec.photos.length === 1 ? '' : 's'}`}</div>`,
      `</div>`,
    ].join('');

    const body = [
      `<div class="scooter-ride">`,
      `<div class="scooter-viewport" tabindex="0" aria-label="Auto scooter rink">`,
      `<canvas class="scooter-canvas"></canvas>`,
      `<div class="scooter-overlay">`,
      `<p class="scooter-hint">${spec.draft
        ? 'Paste photos — each becomes another bumper car'
        : 'WASD drive · C / View camera · bump cars · click to focus'}</p>`,
      `<div class="scooter-caption" aria-live="polite"></div>`,
      `</div>`,
      `</div>`,
      `<div class="scooter-toolbar">`,
      `<button type="button" class="btn btn-sm btn-outline-light" data-action="focus-rink">Drive</button>`,
      `<button type="button" class="btn btn-sm btn-outline-secondary" data-action="cycle-camera">View: Ego</button>`,
      `<button type="button" class="btn btn-sm btn-outline-secondary" data-action="reset-rink">Reset</button>`,
      editable
        ? `<button type="button" class="btn btn-sm btn-outline-secondary" data-action="add-photo">Add photo</button>`
        : '',
      `</div>`,
      `</div>`,
    ].join('');

    return [
      `<div class="scooter-block${themeClass}${customClass}${fullClass}${editable ? ' scooter-block--editable' : ''}${spec.draft ? ' scooter-block--draft' : ''}"${styleAttr}`,
      ` data-scooter-index="${scooterIndex}"`,
      ` data-scooter-spec="${escapeHtml(encoded)}" tabindex="0">`,
      renderFullscreenButton(),
      chrome,
      body,
      `<div class="scooter-status" aria-live="polite"></div>`,
      `</div>`,
    ].join('');
  }

  function createCarMesh(THREE, options = {}) {
    const group = new THREE.Group();
    const color = options.color ?? 0x2563eb;
    const isPlayer = !!options.isPlayer;

    const bodyMat = new THREE.MeshStandardMaterial({
      color,
      metalness: 0.55,
      roughness: 0.32,
    });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.82, metalness: 0.08 });
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xd5dce4, metalness: 0.92, roughness: 0.16 });
    const rubberMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.88, metalness: 0.04 });
    const vinylMat = new THREE.MeshStandardMaterial({ color: 0x2a2118, roughness: 0.7, metalness: 0.05 });

    const dishPts = [
      new THREE.Vector2(0, 0.1),
      new THREE.Vector2(0.78, 0.1),
      new THREE.Vector2(0.9, 0.16),
      new THREE.Vector2(0.86, 0.34),
      new THREE.Vector2(0.62, 0.44),
      new THREE.Vector2(0.22, 0.4),
      new THREE.Vector2(0, 0.38),
    ];
    const hull = new THREE.Mesh(new THREE.LatheGeometry(dishPts, 28), bodyMat);
    group.add(hull);

    const bumper = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.155, 12, 36), rubberMat);
    bumper.rotation.x = Math.PI / 2;
    bumper.position.y = 0.22;
    group.add(bumper);
    const bumperLip = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.05, 8, 36), chromeMat);
    bumperLip.rotation.x = Math.PI / 2;
    bumperLip.position.y = 0.32;
    group.add(bumperLip);

    const floor = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.05, 20), vinylMat);
    floor.position.y = 0.28;
    group.add(floor);

    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.22, 0.42), vinylMat);
    seat.position.set(0, 0.48, -0.12);
    group.add(seat);
    const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.32, 0.08), vinylMat);
    backrest.position.set(0, 0.62, -0.3);
    group.add(backrest);

    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.025, 8, 16), chromeMat);
    wheel.position.set(0, 0.58, 0.28);
    wheel.rotation.x = 0.55;
    group.add(wheel);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.28, 8), chromeMat);
    column.position.set(0, 0.42, 0.22);
    group.add(column);

    if (isPlayer) {
      const torso = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.12, 0.22, 6, 10),
        new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.7 }),
      );
      torso.position.set(0, 0.72, -0.08);
      group.add(torso);
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 12, 10),
        new THREE.MeshStandardMaterial({ color: 0xf1c7a3, roughness: 0.65 }),
      );
      head.position.set(0, 0.98, -0.08);
      group.add(head);
    }

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.04, 2.85, 8), chromeMat);
    pole.position.set(0.08, 1.62, 0);
    pole.rotation.z = 0.08;
    group.add(pole);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.12), chromeMat);
    shoe.position.set(0.22, 3.08, 0);
    group.add(shoe);
    const spark = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 8, 8),
      new THREE.MeshStandardMaterial({
        color: isPlayer ? 0xfbbf24 : 0xf87171,
        emissive: isPlayer ? 0xf59e0b : 0xef4444,
        emissiveIntensity: 0.85,
      }),
    );
    spark.position.set(0.22, 3.16, 0);
    group.add(spark);

    const wheels = [];
    const wheelGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.12, 14);
    const hubGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.13, 10);
    [[-0.52, 0.42], [0.52, 0.42], [-0.52, -0.42], [0.52, -0.42]].forEach(([x, z]) => {
      const spinner = new THREE.Group();
      const w = new THREE.Mesh(wheelGeo, darkMat);
      w.rotation.z = Math.PI / 2;
      spinner.add(w);
      const hub = new THREE.Mesh(hubGeo, chromeMat);
      hub.rotation.z = Math.PI / 2;
      spinner.add(hub);
      spinner.position.set(x, 0.16, z);
      group.add(spinner);
      wheels.push(spinner);
    });

    if (isPlayer) {
      const badge = new THREE.Mesh(
        new THREE.BoxGeometry(0.32, 0.1, 0.06),
        new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xf59e0b, emissiveIntensity: 0.45 }),
      );
      badge.position.set(0, 0.38, 0.82);
      group.add(badge);
    }

    group.userData.wheels = wheels;
    group.userData.hull = hull;
    return group;
  }

  function attachPhotoToCar(THREE, car, photo, loader, renderer, mediaNodes) {
    if (!photo?.src) return null;
    const url = resolveMediaHref(photo.src);
    const kind = photo.kind === 'video' || isVideoSrc(photo.src) ? 'video' : 'image';

    // Large upright board on the rear of the scooter (faces outward, -Z).
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(1.7, 1.25, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.75 }),
    );
    frame.position.set(0, 0.82, -0.62);
    car.add(frame);

    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 1.1), mat);
    plane.rotation.y = Math.PI;
    plane.position.set(0, 0.82, -0.67);
    car.add(plane);

    // Side plate so the image stays visible while circling.
    const sideMat = mat.clone();
    const sidePlane = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.7), sideMat);
    sidePlane.position.set(0.98, 0.85, 0);
    sidePlane.rotation.y = Math.PI / 2;
    car.add(sidePlane);
    const sideFrame = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.8, 1.3),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.75 }),
    );
    sideFrame.position.set(0.94, 0.85, 0);
    car.add(sideFrame);

    function applyTexture(tex) {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy?.() || 4);
      mat.map = tex;
      mat.needsUpdate = true;
      sideMat.map = tex;
      sideMat.needsUpdate = true;
      const img = tex.image;
      if (img?.width && img?.height) {
        const aspect = img.width / Math.max(1, img.height);
        const h = 1.1;
        const w = Math.min(1.7, h * aspect);
        plane.geometry.dispose();
        plane.geometry = new THREE.PlaneGeometry(w, h);
        frame.geometry.dispose();
        frame.geometry = new THREE.BoxGeometry(w + 0.14, h + 0.14, 0.08);
        const sh = 0.7;
        const sw = Math.min(1.25, sh * aspect);
        sidePlane.geometry.dispose();
        sidePlane.geometry = new THREE.PlaneGeometry(sw, sh);
      }
    }

    if (kind === 'video') {
      const video = document.createElement('video');
      video.src = url;
      video.crossOrigin = 'anonymous';
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      const tex = new THREE.VideoTexture(video);
      applyTexture(tex);
      video.play().catch(() => {});
      mediaNodes.push(video);
      return { plane, sidePlane, texture: tex, video, photo, kind };
    }

    loader.load(
      url,
      (tex) => applyTexture(tex),
      undefined,
      () => {
        const img = new Image();
        img.onload = () => {
          const tex = new THREE.Texture(img);
          tex.needsUpdate = true;
          applyTexture(tex);
        };
        img.onerror = () => {
          mat.color.set(0x64748b);
          sideMat.color.set(0x64748b);
        };
        img.src = url;
      },
    );
    return { plane, sidePlane, texture: null, video: null, photo, kind };
  }

  function createRink(el, spec) {
    const THREE = window.THREE;
    const viewport = el.querySelector('.scooter-viewport');
    const canvas = el.querySelector('.scooter-canvas');
    const captionEl = el.querySelector('.scooter-caption');
    const camBtn = el.querySelector('[data-action="cycle-camera"]');
    if (!viewport || !canvas) return null;

    const photos = spec.photos || [];
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x14081c);
    scene.fog = new THREE.Fog(0x14081c, 22, 48);

    const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 80);
    camera.position.set(0, 14, 13);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.HemisphereLight(0xffe4b5, 0x3b1d4a, 0.45));
    const sun = new THREE.DirectionalLight(0xffd9a0, 0.85);
    sun.position.set(6, 16, 8);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0x7dd3fc, 0.28);
    fill.position.set(-10, 8, -6);
    scene.add(fill);
    [[-7, 3.4, -6, 0xff6b6b], [7, 3.4, -6, 0x60a5fa], [-7, 3.4, 6, 0xfbbf24], [7, 3.4, 6, 0xc084fc]].forEach(([x, y, z, col]) => {
      const lamp = new THREE.PointLight(col, 1.15, 16, 2);
      lamp.position.set(x, y, z);
      scene.add(lamp);
    });

    const floorCanvas = document.createElement('canvas');
    floorCanvas.width = 512;
    floorCanvas.height = 512;
    const fctx = floorCanvas.getContext('2d');
    fctx.fillStyle = '#3a2a1c';
    fctx.fillRect(0, 0, 512, 512);
    for (let y = 0; y < 512; y += 22) {
      fctx.fillStyle = y % 44 === 0 ? '#4a3726' : '#3f2f1f';
      fctx.fillRect(0, y, 512, 20);
      fctx.strokeStyle = 'rgba(0,0,0,0.22)';
      fctx.beginPath();
      fctx.moveTo(0, y);
      fctx.lineTo(512, y);
      fctx.stroke();
      for (let x = (y % 44 === 0 ? 0 : 128); x < 512; x += 256) {
        fctx.strokeStyle = 'rgba(0,0,0,0.18)';
        fctx.beginPath();
        fctx.moveTo(x, y);
        fctx.lineTo(x, y + 22);
        fctx.stroke();
      }
    }
    fctx.strokeStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i < 28; i += 1) {
      fctx.beginPath();
      fctx.arc(Math.random() * 512, Math.random() * 512, 12 + Math.random() * 70, 0, Math.PI * 2);
      fctx.stroke();
    }
    const floorTex = new THREE.CanvasTexture(floorCanvas);
    floorTex.wrapS = THREE.RepeatWrapping;
    floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(5, 5);
    floorTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy?.() || 4);
    floorTex.colorSpace = THREE.SRGBColorSpace;

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(ARENA_R + 0.5, 72),
      new THREE.MeshStandardMaterial({
        map: floorTex,
        color: 0xffffff,
        roughness: 0.42,
        metalness: 0.08,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(ARENA_R, 0.28, 12, 72),
      new THREE.MeshStandardMaterial({ color: 0xf5c518, metalness: 0.25, roughness: 0.45, emissive: 0x854d0e, emissiveIntensity: 0.12 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.32;
    scene.add(ring);

    const padMat = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.55, side: THREE.DoubleSide });
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(ARENA_R + 0.18, ARENA_R + 0.18, 1.05, 72, 1, true),
      padMat,
    );
    wall.position.y = 0.55;
    scene.add(wall);
    const wallTop = new THREE.Mesh(
      new THREE.TorusGeometry(ARENA_R + 0.18, 0.1, 8, 64),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 }),
    );
    wallTop.rotation.x = Math.PI / 2;
    wallTop.position.y = 1.08;
    scene.add(wallTop);

    for (let i = 0; i < 16; i += 1) {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.95, 0.08),
        new THREE.MeshStandardMaterial({ color: i % 2 ? 0xf8fafc : 0x1e293b, roughness: 0.5 }),
      );
      const a = (i / 16) * Math.PI * 2;
      stripe.position.set(Math.cos(a) * (ARENA_R + 0.12), 0.55, Math.sin(a) * (ARENA_R + 0.12));
      stripe.lookAt(0, 0.55, 0);
      scene.add(stripe);
    }

    for (let i = 0; i < 3; i += 1) {
      const mark = new THREE.Mesh(
        new THREE.RingGeometry(3 + i * 2.8, 3.1 + i * 2.8, 48),
        new THREE.MeshBasicMaterial({ color: 0xf5c518, transparent: true, opacity: 0.22, side: THREE.DoubleSide }),
      );
      mark.rotation.x = -Math.PI / 2;
      mark.position.y = 0.03;
      scene.add(mark);
    }

    const wireMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.85, roughness: 0.22 });
    const gridY = 3.22;
    for (let i = -7; i <= 7; i += 1) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(ARENA_R * 2.2, 0.035, 0.035), wireMat);
      bar.position.set(0, gridY, i * 1.55);
      scene.add(bar);
      const cross = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, ARENA_R * 2.2), wireMat);
      cross.position.set(i * 1.55, gridY, 0);
      scene.add(cross);
    }

    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    const mediaNodes = [];
    const cars = [];

    function spawnPose(i, total) {
      const ang = (i / Math.max(1, total)) * Math.PI * 2 + 0.4;
      const rad = 3.5 + (i % 3) * 1.6;
      return {
        x: Math.cos(ang) * rad,
        z: Math.sin(ang) * rad,
        yaw: ang + Math.PI,
      };
    }

    // Player car
    const playerMesh = createCarMesh(THREE, { color: 0xf8fafc, isPlayer: true });
    scene.add(playerMesh);
    const player = {
      mesh: playerMesh,
      x: 0,
      z: 4.2,
      yaw: Math.PI,
      vx: 0,
      vz: 0,
      spin: 0,
      hop: 0,
      hopVel: 0,
      speed: 0,
      steer: 0,
      isPlayer: true,
      photo: null,
      label: 'You',
      bumpFlash: 0,
    };
    cars.push(player);

    // NPC cars from photos (at least a few colorful empties if no photos)
    const npcCount = Math.max(photos.length, photos.length ? photos.length : 4);
    const npcPhotos = photos.length
      ? photos
      : Array.from({ length: 4 }, (_, i) => ({ src: '', label: `Car ${i + 1}`, kind: 'image' }));

    for (let i = 0; i < npcCount; i += 1) {
      const photo = npcPhotos[i % npcPhotos.length];
      const pose = spawnPose(i + 1, npcCount + 1);
      const mesh = createCarMesh(THREE, { color: CAR_COLORS[i % CAR_COLORS.length], isPlayer: false });
      scene.add(mesh);
      const deco = photo?.src ? attachPhotoToCar(THREE, mesh, photo, loader, renderer, mediaNodes) : null;
      cars.push({
        mesh,
        x: pose.x,
        z: pose.z,
        yaw: pose.yaw,
        vx: 0,
        vz: 0,
        spin: 0,
        hop: 0,
        hopVel: 0,
        speed: 0,
        steer: 0,
        isPlayer: false,
        photo: photo?.src ? photo : null,
        label: photo?.label || `Car ${i + 1}`,
        deco,
        aiTimer: Math.random() * 2,
        aiSteer: (Math.random() - 0.5) * 0.8,
        aiThrottle: 0.55 + Math.random() * 0.35,
        bumpFlash: 0,
      });
    }

    const keys = Object.create(null);
    let raf = 0;
    let last = performance.now();
    let destroyed = false;
    let bumps = 0;
    let camMode = 'ego';
    const CAM_MODES = ['ego', 'chase', 'top'];
    let camSnap = true;

    function camLabel() {
      if (camMode === 'ego') return 'View: Ego';
      if (camMode === 'top') return 'View: Top';
      return 'View: Chase';
    }

    function syncCamButton() {
      if (!camBtn) return;
      camBtn.textContent = camLabel();
    }

    function cycleCamera() {
      camMode = CAM_MODES[(CAM_MODES.indexOf(camMode) + 1) % CAM_MODES.length];
      camSnap = true;
      player.mesh.visible = camMode !== 'ego';
      syncCamButton();
      viewport.focus({ preventScroll: true });
    }

    function resize() {
      const w = viewport.clientWidth || 640;
      const h = viewport.clientHeight || 420;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    }

    function clampArena(car) {
      const d = Math.hypot(car.x, car.z);
      const max = ARENA_R - CAR_R - 0.2;
      if (d > max) {
        const nx = car.x / d;
        const nz = car.z / d;
        car.x = nx * max;
        car.z = nz * max;
        const vn = car.vx * nx + car.vz * nz;
        if (vn > 0) {
          car.vx -= 1.85 * vn * nx;
          car.vz -= 1.85 * vn * nz;
          const tx = -nz;
          const tz = nx;
          car.spin += (car.vx * tx + car.vz * tz) * 0.22;
          car.hopVel = Math.max(car.hopVel, 1.6);
          car.bumpFlash = Math.max(car.bumpFlash, 0.22);
        }
      }
    }

    function resolveCollisions() {
      for (let i = 0; i < cars.length; i += 1) {
        for (let j = i + 1; j < cars.length; j += 1) {
          const a = cars[i];
          const b = cars[j];
          const dx = b.x - a.x;
          const dz = b.z - a.z;
          const dist = Math.hypot(dx, dz) || 0.0001;
          const min = CAR_R * 2;
          if (dist >= min) continue;
          const nx = dx / dist;
          const nz = dz / dist;
          const overlap = min - dist;
          a.x -= nx * overlap * 0.5;
          a.z -= nz * overlap * 0.5;
          b.x += nx * overlap * 0.5;
          b.z += nz * overlap * 0.5;

          const avn = a.vx * nx + a.vz * nz;
          const bvn = b.vx * nx + b.vz * nz;
          const rel = avn - bvn;
          const impulse = rel * 0.92;
          a.vx -= impulse * nx;
          a.vz -= impulse * nz;
          b.vx += impulse * nx;
          b.vz += impulse * nz;
          const tx = -nz;
          const tz = nx;
          a.spin -= (a.vx * tx + a.vz * tz) * 0.28;
          b.spin += (b.vx * tx + b.vz * tz) * 0.28;
          const hit = Math.min(2.4, Math.abs(rel) * 0.35 + 0.8);
          a.hopVel = Math.max(a.hopVel, hit);
          b.hopVel = Math.max(b.hopVel, hit);
          a.bumpFlash = 0.4;
          b.bumpFlash = 0.4;
          if (a.isPlayer || b.isPlayer) {
            bumps += 1;
            const other = a.isPlayer ? b : a;
            if (captionEl) {
              captionEl.textContent = other.photo
                ? `Bump! ${other.label || 'Photo car'}`
                : `Bump! ${other.label}`;
            }
          }
        }
      }
    }

    function updateAi(car, dt) {
      car.aiTimer -= dt;
      if (car.aiTimer <= 0) {
        car.aiTimer = 0.8 + Math.random() * 1.8;
        car.aiSteer = (Math.random() - 0.5) * 1.6;
        car.aiThrottle = 0.45 + Math.random() * 0.5;
        const d = Math.hypot(car.x, car.z);
        if (d > ARENA_R * 0.72) {
          const toCenter = Math.atan2(-car.x, -car.z);
          let diff = toCenter - car.yaw;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          car.aiSteer = Math.max(-1.2, Math.min(1.2, diff * 1.4));
          car.aiThrottle = 0.7;
        }
      }
      car.steer = car.aiSteer;
      const spd = Math.hypot(car.vx, car.vz);
      car.yaw += car.aiSteer * dt * (1.1 + Math.min(1.2, spd * 0.15));
      const accel = car.aiThrottle * 8.5;
      car.vx += Math.sin(car.yaw) * accel * dt;
      car.vz += Math.cos(car.yaw) * accel * dt;
    }

    function updatePlayer(dt) {
      let steer = 0;
      let throttle = 0;
      if (keys.KeyA || keys.ArrowLeft) steer += 1;
      if (keys.KeyD || keys.ArrowRight) steer -= 1;
      if (keys.KeyW || keys.ArrowUp) throttle += 1;
      if (keys.KeyS || keys.ArrowDown) throttle -= 0.7;
      player.steer = steer;
      const spd = Math.hypot(player.vx, player.vz);
      player.yaw += steer * dt * (1.35 + Math.min(1.5, spd * 0.16));
      const accel = throttle * 11;
      player.vx += Math.sin(player.yaw) * accel * dt;
      player.vz += Math.cos(player.yaw) * accel * dt;
    }

    function limitSpeed(car) {
      const spd = Math.hypot(car.vx, car.vz);
      const max = 10.5;
      if (spd > max) {
        car.vx *= max / spd;
        car.vz *= max / spd;
      }
    }

    function syncMeshes(dt) {
      cars.forEach((car) => {
        const spd = Math.hypot(car.vx, car.vz);
        car.mesh.position.set(car.x, car.hop, car.z);
        car.mesh.rotation.y = car.yaw;
        const lean = -(car.steer || 0) * 0.12 + car.spin * 0.05;
        car.mesh.rotation.z = Math.max(-0.28, Math.min(0.28, lean));
        car.mesh.rotation.x = Math.max(-0.12, Math.min(0.12, car.hopVel * 0.04));
        if (car.bumpFlash > 0) {
          car.mesh.scale.setScalar(1 + car.bumpFlash * 0.06);
        } else {
          car.mesh.scale.setScalar(1);
        }
        const wheels = car.mesh.userData.wheels || [];
        wheels.forEach((w) => {
          w.rotation.x += spd * dt * 2.4;
        });
      });
    }

    function updateCamera(dt) {
      const shake = player.bumpFlash > 0 ? (Math.random() - 0.5) * player.bumpFlash * 0.35 : 0;
      const lerpAmt = camSnap ? 1 : (1 - Math.pow(0.0012, dt));
      player.mesh.visible = camMode !== 'ego';

      if (camMode === 'top') {
        const target = new THREE.Vector3(player.x + shake, 17, player.z + 0.01 + shake);
        camera.position.lerp(target, camSnap ? 1 : 1 - Math.pow(0.001, dt));
        camera.up.set(0, 1, 0);
        camera.lookAt(player.x, 0, player.z);
        camera.fov = 58;
        camera.updateProjectionMatrix();
        camSnap = false;
        return;
      }

      if (camMode === 'ego') {
        const egoPos = new THREE.Vector3(
          player.x + Math.sin(player.yaw) * 0.22 + shake * 0.4,
          0.88 + player.hop,
          player.z + Math.cos(player.yaw) * 0.22 + shake * 0.4,
        );
        camera.position.lerp(egoPos, lerpAmt);
        camera.up.set(0, 1, 0);
        camera.lookAt(
          player.x + Math.sin(player.yaw) * 8,
          0.45 + player.hop,
          player.z + Math.cos(player.yaw) * 8,
        );
        camera.fov = 72;
        camera.updateProjectionMatrix();
        camSnap = false;
        return;
      }

      const back = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
      const desired = new THREE.Vector3(player.x, 0, player.z)
        .add(back.multiplyScalar(5.4))
        .add(new THREE.Vector3(shake, 3.15 + player.hop * 0.4, shake));
      camera.position.lerp(desired, lerpAmt);
      camera.up.set(0, 1, 0);
      camera.lookAt(
        player.x + Math.sin(player.yaw) * 3.2,
        0.55 + player.hop,
        player.z + Math.cos(player.yaw) * 3.2,
      );
      camera.fov = 58;
      camera.updateProjectionMatrix();
      camSnap = false;
    }

    function tick(now) {
      if (destroyed) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      updatePlayer(dt);
      cars.forEach((car) => {
        if (!car.isPlayer) updateAi(car, dt);
        car.vx *= Math.pow(0.34, dt);
        car.vz *= Math.pow(0.34, dt);
        car.spin *= Math.pow(0.18, dt);
        car.yaw += car.spin * dt;
        limitSpeed(car);
        car.hopVel -= 22 * dt;
        car.hop += car.hopVel * dt;
        if (car.hop < 0) {
          car.hop = 0;
          if (car.hopVel < 0) car.hopVel *= -0.22;
          if (Math.abs(car.hopVel) < 0.45) car.hopVel = 0;
        }
        car.x += car.vx * dt;
        car.z += car.vz * dt;
        clampArena(car);
        if (car.bumpFlash > 0) car.bumpFlash = Math.max(0, car.bumpFlash - dt);
      });
      resolveCollisions();
      cars.forEach(clampArena);
      syncMeshes(dt);
      updateCamera(dt);

      if (captionEl && !cars.some(c => c.bumpFlash > 0.05)) {
        captionEl.textContent = `Bumps ${bumps} · ${photos.length} photo car${photos.length === 1 ? '' : 's'}`;
      }

      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    }

    function onKeyDown(e) {
      if (!el.contains(document.activeElement) && document.activeElement !== viewport) return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      keys[e.code] = true;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
      if (e.code === 'KeyC' && !e.repeat) {
        cycleCamera();
      }
    }
    function onKeyUp(e) {
      keys[e.code] = false;
    }

    function focusRink() {
      viewport.focus({ preventScroll: true });
    }

    function resetRink() {
      bumps = 0;
      player.x = 0;
      player.z = 4.2;
      player.yaw = Math.PI;
      player.vx = 0;
      player.vz = 0;
      player.spin = 0;
      player.hop = 0;
      player.hopVel = 0;
      player.steer = 0;
      let npcI = 0;
      cars.forEach((car) => {
        if (car.isPlayer) return;
        const pose = spawnPose(npcI + 1, cars.length);
        car.x = pose.x;
        car.z = pose.z;
        car.yaw = pose.yaw;
        car.vx = 0;
        car.vz = 0;
        car.spin = 0;
        car.hop = 0;
        car.hopVel = 0;
        car.steer = 0;
        npcI += 1;
      });
      if (captionEl) captionEl.textContent = 'Ready';
    }

    canvas.addEventListener('click', focusRink);
    viewport.addEventListener('click', focusRink);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('resize', resize);
    el.addEventListener('notespro:monitor-fullscreen', () => {
      requestAnimationFrame(resize);
    });

    resize();
    syncMeshes(0);
    syncCamButton();
    raf = requestAnimationFrame(tick);
    if (!photos.length) {
      setStatus(el, 'Paste photos (Ctrl+V) — each one becomes another scooter.');
    } else if (spec.demo) {
      focusRink();
    }

    return {
      focus: focusRink,
      reset: resetRink,
      cycleCamera,
      destroy() {
        destroyed = true;
        cancelAnimationFrame(raf);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('resize', resize);
        mediaNodes.forEach((video) => {
          video.pause();
          video.removeAttribute('src');
          video.load();
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

  function hydrateBlock(el, options = {}) {
    if (!el || el.dataset.scooterHydrated === '1') return;
    const spec = decodeSpec(el.dataset.scooterSpec);
    if (!spec) return;
    el.dataset.scooterHydrated = '1';
    bindFullscreenButton(el);

    let rink = null;
    if (threeReady()) {
      rink = createRink(el, spec);
    } else {
      setStatus(el, 'Three.js not loaded — scooter rink unavailable.');
    }

    const disconnectObs = new MutationObserver(() => {
      if (!el.isConnected) {
        rink?.destroy();
        disconnectObs.disconnect();
      }
    });
    disconnectObs.observe(document.body, { childList: true, subtree: true });

    el.addEventListener('click', (e) => {
      if (e.target.closest('.game-fullscreen-btn')) return;
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'focus-rink') {
        rink?.focus();
        return;
      }
      if (action === 'cycle-camera') {
        rink?.cycleCamera();
        rink?.focus();
        return;
      }
      if (action === 'reset-rink') {
        rink?.reset();
        return;
      }
      if (action === 'add-photo') {
        setStatus(el, 'Paste an image (Ctrl+V) or drop a file onto the rink.');
        el.focus({ preventScroll: true });
      }
    });

    if (typeof options.onPasteImage !== 'function') return;

    async function handlePasteFiles(files) {
      const imageFiles = [...files].filter(f => f && String(f.type || '').startsWith('image/'));
      if (!imageFiles.length) return;
      el.classList.add('scooter-block--uploading');
      setStatus(el, 'Uploading…');
      try {
        for (const file of imageFiles) {
          await options.onPasteImage(file, spec);
        }
      } finally {
        el.classList.remove('scooter-block--uploading');
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
      el.classList.add('scooter-block--drop');
    });
    el.addEventListener('dragleave', () => el.classList.remove('scooter-block--drop'));
    el.addEventListener('drop', (e) => {
      el.classList.remove('scooter-block--drop');
      const files = [...(e.dataTransfer?.files || [])].filter(f => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      e.stopPropagation();
      void handlePasteFiles(files);
    });
  }

  function hydrate(root) {
    (root || document).querySelectorAll('.scooter-block[data-scooter-spec]').forEach(hydrateBlock);
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
  };
}));
