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
        : 'WASD / arrows drive · bump photo cars · click to focus'}</p>`,
      `<div class="scooter-caption" aria-live="polite"></div>`,
      `</div>`,
      `</div>`,
      `<div class="scooter-toolbar">`,
      `<button type="button" class="btn btn-sm btn-outline-light" data-action="focus-rink">Drive</button>`,
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
      metalness: 0.35,
      roughness: 0.45,
    });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.7, metalness: 0.2 });
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.85, roughness: 0.25 });

    const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.98, 0.42, 20), bodyMat);
    hull.position.y = 0.32;
    group.add(hull);

    const bumper = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.12, 10, 28), chromeMat);
    bumper.rotation.x = Math.PI / 2;
    bumper.position.y = 0.28;
    group.add(bumper);

    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.28, 0.5), darkMat);
    seat.position.set(0, 0.62, -0.05);
    group.add(seat);

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.6, 8), chromeMat);
    pole.position.set(0, 1.35, 0);
    group.add(pole);
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 10, 8),
      new THREE.MeshStandardMaterial({
        color: isPlayer ? 0xfbbf24 : 0xf87171,
        emissive: isPlayer ? 0xf59e0b : 0xef4444,
        emissiveIntensity: 0.7,
      }),
    );
    tip.position.set(0, 2.15, 0);
    group.add(tip);

    const wheelGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.16, 12);
    [[-0.55, 0.55], [0.55, 0.55], [-0.55, -0.55], [0.55, -0.55]].forEach(([x, z]) => {
      const wheel = new THREE.Mesh(wheelGeo, darkMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.18, z);
      group.add(wheel);
    });

    if (isPlayer) {
      const badge = new THREE.Mesh(
        new THREE.BoxGeometry(0.35, 0.12, 0.08),
        new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xf59e0b, emissiveIntensity: 0.4 }),
      );
      badge.position.set(0, 0.55, 0.85);
      group.add(badge);
    }

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
    frame.position.set(0, 1.05, -0.55);
    car.add(frame);

    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 1.1), mat);
    // PlaneGeometry faces +Z by default; rotate so the image faces out the back.
    plane.rotation.y = Math.PI;
    plane.position.set(0, 1.05, -0.6);
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
    if (!viewport || !canvas) return null;

    const photos = spec.photos || [];
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a2332);
    scene.fog = new THREE.Fog(0x1a2332, 18, 42);

    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 80);
    camera.position.set(0, 16, 14);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.HemisphereLight(0xdbeafe, 0x334155, 0.7));
    const sun = new THREE.DirectionalLight(0xfff4e5, 1.15);
    sun.position.set(8, 18, 6);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0x93c5fd, 0.35);
    fill.position.set(-10, 8, -6);
    scene.add(fill);

    // Floor
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(ARENA_R + 0.4, 64),
      new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.92, metalness: 0.05 }),
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(ARENA_R, 0.22, 12, 64),
      new THREE.MeshStandardMaterial({ color: 0xf97316, metalness: 0.4, roughness: 0.4, emissive: 0x9a3412, emissiveIntensity: 0.15 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.25;
    scene.add(ring);

    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(ARENA_R + 0.15, ARENA_R + 0.15, 0.85, 64, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.75, side: THREE.DoubleSide }),
    );
    wall.position.y = 0.45;
    scene.add(wall);

    // Lane markings
    for (let i = 0; i < 3; i += 1) {
      const mark = new THREE.Mesh(
        new THREE.RingGeometry(3 + i * 2.8, 3.08 + i * 2.8, 48),
        new THREE.MeshBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
      );
      mark.rotation.x = -Math.PI / 2;
      mark.position.y = 0.02;
      scene.add(mark);
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
      speed: 0,
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
        speed: 0,
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
    let camMode = 'chase'; // chase | top

    function resize() {
      const w = viewport.clientWidth || 640;
      const h = viewport.clientHeight || 420;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    }

    function clampArena(car) {
      const d = Math.hypot(car.x, car.z);
      const max = ARENA_R - CAR_R - 0.15;
      if (d > max) {
        const nx = car.x / d;
        const nz = car.z / d;
        car.x = nx * max;
        car.z = nz * max;
        // Bounce inward
        const vn = car.vx * nx + car.vz * nz;
        if (vn > 0) {
          car.vx -= 1.7 * vn * nx;
          car.vz -= 1.7 * vn * nz;
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
          const impulse = (avn - bvn) * 0.85;
          a.vx -= impulse * nx;
          a.vz -= impulse * nz;
          b.vx += impulse * nx;
          b.vz += impulse * nz;
          a.bumpFlash = 0.35;
          b.bumpFlash = 0.35;
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
        // Bias toward center if near wall
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
      car.yaw += car.aiSteer * dt * 1.4;
      const accel = car.aiThrottle * 9.5;
      car.vx += Math.sin(car.yaw) * accel * dt;
      car.vz += Math.cos(car.yaw) * accel * dt;
    }

    function updatePlayer(dt) {
      let steer = 0;
      let throttle = 0;
      if (keys.KeyA || keys.ArrowLeft) steer += 1;
      if (keys.KeyD || keys.ArrowRight) steer -= 1;
      if (keys.KeyW || keys.ArrowUp) throttle += 1;
      if (keys.KeyS || keys.ArrowDown) throttle -= 0.65;
      player.yaw += steer * dt * 2.2;
      const accel = throttle * 12;
      player.vx += Math.sin(player.yaw) * accel * dt;
      player.vz += Math.cos(player.yaw) * accel * dt;
    }

    function syncMeshes() {
      cars.forEach((car) => {
        car.mesh.position.set(car.x, 0, car.z);
        car.mesh.rotation.y = car.yaw;
        if (car.bumpFlash > 0) {
          car.mesh.scale.setScalar(1 + car.bumpFlash * 0.12);
        } else {
          car.mesh.scale.setScalar(1);
        }
      });
    }

    function updateCamera(dt) {
      if (camMode === 'top') {
        const target = new THREE.Vector3(player.x, 18, player.z + 0.01);
        camera.position.lerp(target, 1 - Math.pow(0.001, dt));
        camera.up.set(0, 1, 0);
        camera.lookAt(player.x, 0, player.z);
        return;
      }
      const back = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
      const desired = new THREE.Vector3(player.x, 0, player.z)
        .add(back.multiplyScalar(6.2))
        .add(new THREE.Vector3(0, 4.2, 0));
      camera.position.lerp(desired, 1 - Math.pow(0.0008, dt));
      camera.up.set(0, 1, 0);
      camera.lookAt(
        player.x + Math.sin(player.yaw) * 3,
        0.8,
        player.z + Math.cos(player.yaw) * 3,
      );
    }

    function tick(now) {
      if (destroyed) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      updatePlayer(dt);
      cars.forEach((car) => {
        if (!car.isPlayer) updateAi(car, dt);
        // Drag
        car.vx *= Math.pow(0.08, dt);
        car.vz *= Math.pow(0.08, dt);
        car.x += car.vx * dt;
        car.z += car.vz * dt;
        clampArena(car);
        if (car.bumpFlash > 0) car.bumpFlash = Math.max(0, car.bumpFlash - dt);
      });
      resolveCollisions();
      cars.forEach(clampArena);
      syncMeshes();
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
        camMode = camMode === 'chase' ? 'top' : 'chase';
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
      let npcI = 0;
      cars.forEach((car) => {
        if (car.isPlayer) return;
        const pose = spawnPose(npcI + 1, cars.length);
        car.x = pose.x;
        car.z = pose.z;
        car.yaw = pose.yaw;
        car.vx = 0;
        car.vz = 0;
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
    syncMeshes();
    raf = requestAnimationFrame(tick);
    if (!photos.length) {
      setStatus(el, 'Paste photos (Ctrl+V) — each one becomes another scooter.');
    } else if (spec.demo) {
      focusRink();
    }

    return {
      focus: focusRink,
      reset: resetRink,
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
