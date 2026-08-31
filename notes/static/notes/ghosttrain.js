/**
 * NotesPro ```ghosttrain``` block — haunted train yard with your images on ghost trains.
 */
(function (root, factory) {
  const api = factory();
  root.NotesProGhosttrain = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];
  const TRAIN_COLORS = [0x6d28d9, 0x0891b2, 0x65a30d, 0xc026d3, 0x0d9488, 0x7c3aed, 0x0369a1, 0x4ade80];
  const ARENA_R = 13.5;

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
      title: String(cfg.title || 'Ghost train').trim() || 'Ghost train',
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
    const status = el.querySelector('.ghosttrain-status');
    if (!status) return;
    status.textContent = text || '';
  }

  function renderBlock(source, fenceAttrs, options = {}) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const style = resolveStyle(cfg);
    const spec = buildSpec(source, cfg);
    const ghosttrainIndex = Number.isFinite(options.ghosttrainIndex) ? options.ghosttrainIndex : 0;
    const editable = options.editable !== false;
    const fullscreen = resolveFullscreen(cfg);
    const themeClass = style.theme ? ` ghosttrain-block--${style.theme}` : '';
    const customClass = (style.colorCss || style.bgCss) ? ' ghosttrain-block--custom' : '';
    const fullClass = fullscreen ? ' ghosttrain-block--fullscreen' : '';
    const styleVars = [];
    if (style.colorCss) styleVars.push(`--ghosttrain-accent:${style.colorCss}`);
    if (style.bgCss) styleVars.push(`--ghosttrain-bg:${style.bgCss}`);
    const styleAttr = styleVars.length
      ? ` style="${styleVars.map(v => escapeHtml(v)).join(';')}"`
      : '';
    const encoded = encodeSpec(spec);
    const chrome = fullscreen ? '' : [
      `<div class="ghosttrain-block-header">`,
      `<div class="ghosttrain-block-title">${escapeHtml(spec.title)}</div>`,
      `<div class="ghosttrain-block-meta">${spec.draft ? 'add photos along the track' : `convoy · ${spec.photos.length} photo${spec.photos.length === 1 ? '' : 's'} on the way`}</div>`,
      `</div>`,
    ].join('');

    const body = [
      `<div class="ghosttrain-ride">`,
      `<div class="ghosttrain-viewport" tabindex="0" aria-label="Ghost train yard">`,
      `<canvas class="ghosttrain-canvas"></canvas>`,
      `<div class="ghosttrain-overlay">`,
      `<p class="ghosttrain-hint">${spec.draft
        ? 'Paste photos — they appear lit along the dark rails'
        : 'Ego view · auto ride · Boo! at photos · C view · Pause to stop'}</p>`,
      `<div class="ghosttrain-caption" aria-live="polite"></div>`,
      `</div>`,
      `</div>`,
      `<div class="ghosttrain-toolbar">`,
      `<button type="button" class="btn btn-sm btn-outline-light" data-action="toggle-ride" aria-pressed="true">Pause</button>`,
      `<button type="button" class="btn btn-sm btn-outline-secondary" data-action="reset-yard">Reset</button>`,
      editable
        ? `<button type="button" class="btn btn-sm btn-outline-secondary" data-action="add-photo">Add photo</button>`
        : '',
      `</div>`,
      `</div>`,
    ].join('');

    return [
      `<div class="ghosttrain-block${themeClass}${customClass}${fullClass}${editable ? ' ghosttrain-block--editable' : ''}${spec.draft ? ' ghosttrain-block--draft' : ''}"${styleAttr}`,
      ` data-ghosttrain-index="${ghosttrainIndex}"`,
      ` data-ghosttrain-spec="${escapeHtml(encoded)}" tabindex="0">`,
      renderFullscreenButton(),
      chrome,
      body,
      `<div class="ghosttrain-status" aria-live="polite"></div>`,
      `</div>`,
    ].join('');
  }

  function trackSideVector(tangent) {
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x);
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
    return side.normalize();
  }

  function placeTrainOnTrack(mesh, trackCurve, t) {
    const u = ((t % 1) + 1) % 1;
    const pos = trackCurve.getPointAt(u);
    const look = trackCurve.getPointAt((u + 0.004) % 1);
    mesh.position.copy(pos);
    mesh.position.y = 0;
    mesh.lookAt(look.x, pos.y, look.z);
  }

  function trackDelta(a, b) {
    let d = b - a;
    while (d > 0.5) d -= 1;
    while (d < -0.5) d += 1;
    return d;
  }

  function addPhotosAlongTrack(THREE, scene, trackCurve, photos, loader, renderer, mediaNodes) {
    const tieMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.9, metalness: 0.08 });
    const railMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.55, roughness: 0.38 });
    const entries = [];

    function fitBillboard(frame, mesh, matte, aspect) {
      const h = 4.4;
      const w = Math.min(7.2, h * Math.max(0.45, aspect || 1.35));
      mesh.geometry.dispose();
      mesh.geometry = new THREE.PlaneGeometry(w, h);
      frame.geometry.dispose();
      frame.geometry = new THREE.BoxGeometry(w + 0.28, h + 0.28, 0.16);
      if (matte) {
        matte.geometry.dispose();
        matte.geometry = new THREE.PlaneGeometry(w + 0.08, h + 0.08);
      }
      return { w, h };
    }

    photos.forEach((photo, i) => {
      const t = ((i + 0.35) / Math.max(1, photos.length)) % 1;
      const p = trackCurve.getPointAt(t);
      const tangent = trackCurve.getTangentAt(t).normalize();
      const sideVec = trackSideVector(tangent);
      const tAhead = trackCurve.getTangentAt((t + 0.015) % 1).normalize();
      const turnSign = Math.sign(tangent.x * tAhead.z - tangent.z * tAhead.x) || 1;
      const side = i % 2 === 0 ? turnSign : -turnSign;
      const offset = 3.8 + (i % 3) * 0.35;
      const pos = p.clone().add(sideVec.clone().multiplyScalar(side * offset));
      pos.y = 2.05 + Math.sin(i * 1.7) * 0.25;

      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(4.8, 4.8, 0.16),
        new THREE.MeshStandardMaterial({ color: 0x2c2118, roughness: 0.72, metalness: 0.08 }),
      );
      frame.position.copy(pos);
      const faceTrain = p.clone().add(tangent.clone().multiplyScalar(-0.6));
      faceTrain.y = pos.y;
      frame.lookAt(faceTrain);
      scene.add(frame);

      const matte = new THREE.Mesh(
        new THREE.PlaneGeometry(4.5, 4.5),
        new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 1 }),
      );
      matte.position.copy(pos);
      matte.quaternion.copy(frame.quaternion);
      matte.translateZ(0.09);
      scene.add(matte);

      const mat = new THREE.MeshStandardMaterial({
        color: 0x222222,
        roughness: 0.55,
        metalness: 0.05,
        emissive: 0x111111,
        emissiveIntensity: 0.15,
        side: THREE.FrontSide,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 4.3), mat);
      mesh.position.copy(pos);
      mesh.quaternion.copy(frame.quaternion);
      mesh.translateZ(0.12);
      scene.add(mesh);

      const poleH = Math.max(1.2, pos.y);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, poleH, 8), tieMat);
      pole.position.set(pos.x, poleH / 2, pos.z);
      scene.add(pole);

      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.1), railMat);
      arm.position.copy(pos);
      arm.position.y -= 0.15;
      arm.lookAt(p.x, arm.position.y, p.z);
      scene.add(arm);

      const spot = new THREE.SpotLight(0xfff5e6, 0.35, 16, Math.PI / 5, 0.42, 1);
      spot.position.copy(pos).add(new THREE.Vector3(0, 2.4, 0)).add(sideVec.clone().multiplyScalar(-side * 0.85));
      spot.target = mesh;
      scene.add(spot);
      scene.add(spot.target);

      const rim = new THREE.PointLight(0xffe8c8, 0.2, 6);
      rim.position.copy(pos).add(new THREE.Vector3(0, 0.4, 0));
      scene.add(rim);

      const url = resolveMediaHref(photo.src);
      const kind = photo.kind === 'video' || isVideoSrc(photo.src) ? 'video' : 'image';
      const entry = {
        mesh,
        frame,
        matte,
        spot,
        rim,
        photo,
        kind,
        t,
        index: i,
        video: null,
        texture: null,
        baseSpot: 3.2,
        baseRim: 0.55,
      };

      if (kind === 'video') {
        const video = document.createElement('video');
        video.src = url;
        video.crossOrigin = 'anonymous';
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.addEventListener('loadedmetadata', () => {
          if (video.videoWidth && video.videoHeight) {
            fitBillboard(frame, mesh, matte, video.videoWidth / video.videoHeight);
          }
        });
        const tex = new THREE.VideoTexture(video);
        tex.colorSpace = THREE.SRGBColorSpace;
        mat.map = tex;
        mat.color.set(0xffffff);
        mat.emissive.set(0x222222);
        mat.emissiveIntensity = 0.22;
        mat.needsUpdate = true;
        entry.video = video;
        entry.texture = tex;
        video.play().catch(() => {});
        mediaNodes.push(video);
      } else {
        loader.load(url, (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy?.() || 4);
          mat.map = tex;
          mat.color.set(0xffffff);
          mat.emissive.set(0x1a1a1a);
          mat.emissiveIntensity = 0.2;
          mat.needsUpdate = true;
          entry.texture = tex;
          const img = tex.image;
          if (img?.width && img?.height) fitBillboard(frame, mesh, matte, img.width / img.height);
        });
      }
      entries.push(entry);
    });
    return entries;
  }

  function trackAhead(fromT, targetT) {
    let d = ((targetT - fromT) % 1 + 1) % 1;
    if (d > 0.5) d -= 1;
    return d;
  }

  function updateTracksideLighting(tracksidePhotos, convoyHeadT, trackCurve, camera) {
    const head = trackCurve.getPointAt(((convoyHeadT % 1) + 1) % 1);
    const viewDir = new THREE.Vector3();
    if (camera) camera.getWorldDirection(viewDir);
    tracksidePhotos.forEach((entry) => {
      const photoPos = entry.mesh.position;
      const along = Math.abs(trackDelta(convoyHeadT, entry.t));
      const ahead = trackAhead(convoyHeadT, entry.t);
      const dist3d = photoPos.distanceTo(head);
      const nearTrack = ahead > 0 && ahead < 0.2 ? Math.max(0, 1 - ahead / 0.2) : Math.max(0, 1 - along / 0.14);
      const nearSpace = Math.max(0, 1 - (dist3d - 2) / 16);
      let inView = 0.35;
      if (camera) {
        const to = photoPos.clone().sub(camera.position);
        const dist = to.length();
        inView = dist > 0.001 ? Math.max(0, to.normalize().dot(viewDir)) : 0;
      }
      const glow = Math.max(nearTrack * 0.9, nearSpace * 0.5) * (0.35 + inView * 0.65);
      const spotMul = 0.08 + glow * 0.92;
      const rimMul = 0.05 + glow * 0.95;
      entry.spot.intensity = entry.baseSpot * spotMul;
      entry.rim.intensity = entry.baseRim * rimMul;
      if (entry.mesh.material?.emissiveIntensity != null) {
        entry.mesh.material.emissiveIntensity = 0.08 + glow * 0.42;
      }
    });
  }

  function createTrainMesh(THREE, options = {}) {
    const group = new THREE.Group();
    const color = options.color ?? 0x6d28d9;
    const isPlayer = !!options.isPlayer;

    const ghostMat = new THREE.MeshStandardMaterial({
      color,
      metalness: 0.25,
      roughness: 0.55,
      emissive: color,
      emissiveIntensity: isPlayer ? 0.35 : 0.22,
      transparent: true,
      opacity: 0.92,
    });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.8, metalness: 0.15 });
    const glowMat = new THREE.MeshStandardMaterial({
      color: isPlayer ? 0xa7f3d0 : 0xc4b5fd,
      emissive: isPlayer ? 0x34d399 : 0x8b5cf6,
      emissiveIntensity: 0.85,
      transparent: true,
      opacity: 0.88,
    });

    const boiler = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 1.05, 14), ghostMat);
    boiler.rotation.z = Math.PI / 2;
    boiler.position.set(0.15, 0.55, 0);
    group.add(boiler);

    const cab = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.72, 0.95), ghostMat);
    cab.position.set(-0.55, 0.62, 0);
    group.add(cab);

    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.75, 10), darkMat);
    stack.position.set(0.45, 1.05, 0);
    group.add(stack);
    const steam = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), glowMat);
    steam.position.set(0.45, 1.45, 0);
    group.add(steam);

    const cowcatcher = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.55, 3), darkMat);
    cowcatcher.rotation.z = -Math.PI / 2;
    cowcatcher.rotation.y = Math.PI;
    cowcatcher.position.set(1.05, 0.28, 0);
    group.add(cowcatcher);

    const car = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.58, 0.92), ghostMat);
    car.position.set(-1.35, 0.48, 0);
    group.add(car);

    const lantern = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 10, 8),
      new THREE.MeshStandardMaterial({
        color: isPlayer ? 0xfbbf24 : 0xf472b6,
        emissive: isPlayer ? 0xf59e0b : 0xdb2777,
        emissiveIntensity: 1.1,
      }),
    );
    lantern.position.set(-0.55, 1.05, 0.42);
    group.add(lantern);

    [[-0.35, 0.55], [0.35, 0.55], [-0.35, -0.55], [0.35, -0.55], [-1.35, 0.45], [-1.35, -0.45]].forEach(([x, z]) => {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 12), darkMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.2, z);
      group.add(wheel);
    });

    if (isPlayer) {
      const badge = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, 0.14, 0.08),
        new THREE.MeshStandardMaterial({ color: 0xa7f3d0, emissive: 0x34d399, emissiveIntensity: 0.6 }),
      );
      badge.position.set(0.1, 0.95, 0.55);
      group.add(badge);
    }

    return group;
  }

  function buildTrackCurve(THREE) {
    const pts = [];
    const segments = 72;
    for (let i = 0; i < segments; i += 1) {
      const t = (i / segments) * Math.PI * 2;
      const x = Math.cos(t) * (ARENA_R - 1.2);
      const z = Math.sin(t) * (ARENA_R - 2.4);
      pts.push(new THREE.Vector3(x, 0.05, z));
    }
    return new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.35);
  }

  function addSpookyYard(THREE, scene, trackCurve) {
    scene.background = new THREE.Color(0x0a0c14);
    scene.fog = new THREE.FogExp2(0x0e1018, 0.028);

    scene.add(new THREE.AmbientLight(0x334155, 0.12));
    scene.add(new THREE.HemisphereLight(0x64748b, 0x1e293b, 0.28));
    const moon = new THREE.DirectionalLight(0x94a3b8, 0.22);
    moon.position.set(-14, 24, 10);
    scene.add(moon);
    const fill = new THREE.DirectionalLight(0x475569, 0.12);
    fill.position.set(8, 10, -6);
    scene.add(fill);

    const moonMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.4, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xd8d0ff }),
    );
    moonMesh.position.set(-20, 18, -14);
    scene.add(moonMesh);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(ARENA_R + 2.5, 64),
      new THREE.MeshStandardMaterial({ color: 0x1a2332, roughness: 0.94, metalness: 0.02 }),
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    const railMat = new THREE.MeshStandardMaterial({
      color: 0x9aa8b8,
      metalness: 0.72,
      roughness: 0.28,
      emissive: 0x1e293b,
      emissiveIntensity: 0.12,
    });
    const tieMat = new THREE.MeshStandardMaterial({
      color: 0x4b5563,
      roughness: 0.82,
      emissive: 0x0f172a,
      emissiveIntensity: 0.06,
    });
    const segments = 120;
    const frames = trackCurve.computeFrenetFrames(segments, true);
    const left = [];
    const right = [];
    const gauge = 0.55;
    for (let i = 0; i <= segments; i += 1) {
      const t = i / segments;
      const p = trackCurve.getPointAt(t);
      const b = frames.binormals[i];
      let side = new THREE.Vector3().copy(b);
      side.y = 0;
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      side.normalize().multiplyScalar(gauge);
      left.push(p.clone().add(side));
      right.push(p.clone().sub(side));
    }
    const leftCurve = new THREE.CatmullRomCurve3(left, true);
    const rightCurve = new THREE.CatmullRomCurve3(right, true);
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(leftCurve, segments, 0.055, 8, true), railMat));
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(rightCurve, segments, 0.055, 8, true), railMat));
    for (let i = 0; i < 80; i += 1) {
      const t = i / 80;
      const p = trackCurve.getPointAt(t);
      const tangent = trackCurve.getTangentAt(t);
      const tie = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.08, 0.2), tieMat);
      tie.position.copy(p);
      tie.position.y = 0.02;
      tie.lookAt(p.clone().add(tangent));
      scene.add(tie);
    }

    for (let i = 0; i < 18; i += 1) {
      const ang = (i / 18) * Math.PI * 2 + 0.2;
      const rad = ARENA_R + 0.4 + (i % 3) * 0.3;
      const stone = new THREE.Mesh(
        new THREE.BoxGeometry(0.55 + (i % 2) * 0.2, 0.75 + (i % 4) * 0.15, 0.35),
        new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.98 }),
      );
      stone.position.set(Math.cos(ang) * rad, 0.35, Math.sin(ang) * rad);
      stone.rotation.y = ang;
      scene.add(stone);
    }
  }

  function createYard(el, spec) {
    const THREE = window.THREE;
    const viewport = el.querySelector('.ghosttrain-viewport');
    const canvas = el.querySelector('.ghosttrain-canvas');
    const captionEl = el.querySelector('.ghosttrain-caption');
    const rideBtn = el.querySelector('[data-action="toggle-ride"]');
    if (!viewport || !canvas) return null;

    const photos = spec.photos || [];
    const TRAIN_SPACING = 0.034;
    const CONVOY_CARS = Math.max(4, Math.min(8, 3 + (photos.length ? Math.ceil(photos.length / 2) : 2)));
    const AUTO_SPEED = 0.044;
    const BOO_LINES = ['Boo!', 'Boo…', 'Boooo!', '👻 Boo!'];

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.22;

    const scene = new THREE.Scene();
    const trackCurve = buildTrackCurve(THREE);
    const trackFrames = trackCurve.computeFrenetFrames(240, true);
    addSpookyYard(THREE, scene, trackCurve);

    const camera = new THREE.PerspectiveCamera(78, 1, 0.08, 120);

    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    const mediaNodes = [];
    const tracksidePhotos = photos.length
      ? addPhotosAlongTrack(THREE, scene, trackCurve, photos, loader, renderer, mediaNodes)
      : [];

    const trains = [];
    for (let i = 0; i < CONVOY_CARS; i += 1) {
      const mesh = createTrainMesh(THREE, {
        color: i === 0 ? 0x5eead4 : TRAIN_COLORS[(i - 1) % TRAIN_COLORS.length],
        isPlayer: i === 0,
      });
      scene.add(mesh);
      trains.push({
        mesh,
        index: i,
        isPlayer: i === 0,
        label: i === 0 ? 'Lead engine' : `Car ${i}`,
        bumpFlash: 0,
      });
    }

    const headLight = new THREE.SpotLight(0xfff4e0, 3.4, 34, Math.PI / 5.2, 0.46, 1);
    headLight.position.set(0, 1.65, 0.35);
    const headTarget = new THREE.Object3D();
    headTarget.position.set(0, 0.35, -6);
    trains[0].mesh.add(headLight);
    trains[0].mesh.add(headTarget);
    headLight.target = headTarget;

    const cabGlow = new THREE.PointLight(0xfff0d4, 0.55, 7);
    cabGlow.position.set(0, 1.0, 0.55);
    trains[0].mesh.add(cabGlow);

    const railGlow = new THREE.PointLight(0xc7d2e0, 0.35, 5);
    railGlow.position.set(0, 0.25, 1.2);
    trains[0].mesh.add(railGlow);

    let convoyHeadT = 0;
    let riding = spec.demo !== false;
    let raf = 0;
    let last = performance.now();
    let destroyed = false;
    let camMode = 'ego';
    const CAM_MODES = ['ego', 'chase', 'top'];
    let nearestPhotoIndex = -1;
    let lastBooIndex = -1;
    let booCooldown = 0;
    let audioCtx = null;

    function syncRideButton() {
      if (!rideBtn) return;
      rideBtn.textContent = riding ? 'Pause' : 'Ride';
      rideBtn.setAttribute('aria-pressed', riding ? 'true' : 'false');
      rideBtn.classList.toggle('active', riding);
    }

    function unlockAudio() {
      if (audioCtx) return;
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (_) { /* ignore */ }
    }

    function playBoo() {
      unlockAudio();
      if (!audioCtx) return;
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      try {
        const t0 = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(195, t0);
        osc.frequency.exponentialRampToValueAtTime(88, t0 + 0.38);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.11, t0 + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.48);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.5);
      } catch (_) { /* ignore */ }
    }

    function triggerBoo(entry) {
      if (!entry || entry.index === lastBooIndex || booCooldown > 0) return;
      lastBooIndex = entry.index;
      booCooldown = 0.55;
      const label = entry.photo.label || (entry.kind === 'video' ? 'Video' : 'Photo');
      const line = BOO_LINES[entry.index % BOO_LINES.length];
      if (captionEl) captionEl.textContent = `${line} ${label}`;
      playBoo();
      trains.forEach((train) => { train.bumpFlash = 0.22; });
    }

    function resize() {
      const w = viewport.clientWidth || 640;
      const h = viewport.clientHeight || 420;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    }

    function syncConvoy() {
      trains.forEach((train, i) => {
        placeTrainOnTrack(train.mesh, trackCurve, convoyHeadT - i * TRAIN_SPACING);
        if (train.bumpFlash > 0) {
          train.mesh.scale.setScalar(1 + train.bumpFlash * 0.08);
        } else {
          train.mesh.scale.setScalar(1);
        }
      });
    }

    function nearestTracksidePhoto() {
      let best = null;
      let bestDist = Infinity;
      tracksidePhotos.forEach((entry) => {
        const d = Math.abs(trackDelta(convoyHeadT, entry.t));
        if (d < bestDist) {
          bestDist = d;
          best = entry;
        }
      });
      return bestDist < 0.08 ? best : null;
    }

    function updateConvoy(dt) {
      if (!riding) return;
      convoyHeadT = (convoyHeadT + AUTO_SPEED * dt) % 1;
    }

    function syncTrainVisibility() {
      trains.forEach((train, i) => {
        train.mesh.visible = !(camMode === 'ego' && i === 0);
      });
    }

    function upcomingPhotoLookBlend(fromT, up, baseLook) {
      let best = null;
      let bestScore = 0;
      tracksidePhotos.forEach((entry) => {
        const ahead = trackAhead(fromT, entry.t);
        if (ahead <= 0.004 || ahead > 0.24) return;
        const score = 1 / (ahead + 0.018);
        if (score > bestScore) {
          bestScore = score;
          best = entry;
        }
      });
      if (!best) return baseLook;
      const target = best.mesh.position.clone().add(up.clone().multiplyScalar(0.15));
      const blend = Math.min(0.78, 0.22 + bestScore * 0.012);
      return baseLook.clone().lerp(target, blend);
    }

    function updateCamera(dt) {
      const t = ((convoyHeadT % 1) + 1) % 1;
      const pos = trackCurve.getPointAt(t);
      const tangent = trackCurve.getTangentAt(t).normalize();
      const lookPt = trackCurve.getPointAt((t + 0.018) % 1);
      const idx = Math.min(trackFrames.normals.length - 1, Math.floor(t * trackFrames.normals.length));
      const normal = trackFrames.normals[idx];
      const up = new THREE.Vector3(0, 1, 0).lerp(normal, 0.28).normalize();
      const baseLook = lookPt.clone().add(up.clone().multiplyScalar(0.45));
      const lookTarget = upcomingPhotoLookBlend(t, up, baseLook);

      if (camMode === 'top') {
        camera.position.lerp(new THREE.Vector3(pos.x, 22, pos.z), 1 - Math.pow(0.001, dt));
        camera.up.set(0, 1, 0);
        camera.lookAt(pos.x, 0, pos.z);
        syncTrainVisibility();
        return;
      }

      if (camMode === 'ego') {
        const egoPos = pos.clone()
          .add(up.clone().multiplyScalar(1.28))
          .add(tangent.clone().multiplyScalar(0.42));
        camera.position.lerp(egoPos, riding ? 0.32 : 0.55);
        camera.up.copy(up);
        camera.lookAt(lookTarget);
        syncTrainVisibility();
        return;
      }

      const back = new THREE.Vector3(-tangent.x, 0, -tangent.z).normalize();
      const desired = pos.clone()
        .add(back.multiplyScalar(8.5))
        .add(up.clone().multiplyScalar(4.8));
      camera.position.lerp(desired, 1 - Math.pow(0.0008, dt));
      camera.up.set(0, 1, 0);
      camera.lookAt(lookTarget);
      syncTrainVisibility();
    }

    function tick(now) {
      if (destroyed) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      updateConvoy(dt);
      if (booCooldown > 0) booCooldown = Math.max(0, booCooldown - dt);
      trains.forEach((train) => {
        if (train.bumpFlash > 0) train.bumpFlash = Math.max(0, train.bumpFlash - dt);
      });
      syncConvoy();
      updateTracksideLighting(tracksidePhotos, convoyHeadT, trackCurve, camera);
      updateCamera(dt);

      const near = nearestTracksidePhoto();
      if (near) {
        nearestPhotoIndex = near.index;
        triggerBoo(near);
      } else if (nearestPhotoIndex >= 0) {
        nearestPhotoIndex = -1;
        lastBooIndex = -1;
        if (captionEl && riding) {
          captionEl.textContent = photos.length
            ? '…'
            : `${CONVOY_CARS} cars in line`;
        }
      } else if (captionEl && !captionEl.textContent && riding) {
        captionEl.textContent = photos.length
          ? `${CONVOY_CARS} cars in line · auto ride`
          : `${CONVOY_CARS} cars in line`;
      }

      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    }

    function onKeyDown(e) {
      if (!el.contains(document.activeElement) && document.activeElement !== viewport) return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      if (e.code === 'KeyC' && !e.repeat) {
        const i = CAM_MODES.indexOf(camMode);
        camMode = CAM_MODES[(i + 1) % CAM_MODES.length];
        syncTrainVisibility();
      }
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        unlockAudio();
        if (!riding) riding = true;
        syncRideButton();
        playBoo();
        if (captionEl) captionEl.textContent = BOO_LINES[Math.floor(Math.random() * BOO_LINES.length)];
      }
    }

    function toggleRide() {
      riding = !riding;
      syncRideButton();
      unlockAudio();
      if (riding && captionEl && !captionEl.textContent) {
        captionEl.textContent = photos.length ? `${CONVOY_CARS} cars in line · auto ride` : `${CONVOY_CARS} cars in line`;
      }
    }

    function resetYard() {
      convoyHeadT = 0;
      riding = true;
      nearestPhotoIndex = -1;
      lastBooIndex = -1;
      booCooldown = 0;
      syncRideButton();
      if (captionEl) {
        captionEl.textContent = photos.length
          ? `${CONVOY_CARS} cars in line · auto ride`
          : `${CONVOY_CARS} cars in line`;
      }
    }

    function focusYard() {
      viewport.focus({ preventScroll: true });
      unlockAudio();
    }

    canvas.addEventListener('click', focusYard);
    viewport.addEventListener('click', focusYard);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', resize);
    el.addEventListener('notespro:monitor-fullscreen', () => {
      requestAnimationFrame(resize);
    });

    resize();
    syncConvoy();
    syncRideButton();
    syncTrainVisibility();
    raf = requestAnimationFrame(tick);
    if (!photos.length) {
      setStatus(el, 'Paste photos (Ctrl+V) — the train auto-rides and boos at each one.');
    } else if (spec.demo) {
      focusYard();
    }

    return {
      focus: focusYard,
      reset: resetYard,
      toggleRide,
      destroy() {
        destroyed = true;
        cancelAnimationFrame(raf);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('resize', resize);
        audioCtx?.close?.();
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
    if (!el || el.dataset.ghosttrainHydrated === '1') return;
    const spec = decodeSpec(el.dataset.ghosttrainSpec);
    if (!spec) return;
    el.dataset.ghosttrainHydrated = '1';
    bindFullscreenButton(el);

    let yard = null;
    if (threeReady()) {
      yard = createYard(el, spec);
    } else {
      setStatus(el, 'Three.js not loaded — ghost train yard unavailable.');
    }

    const disconnectObs = new MutationObserver(() => {
      if (!el.isConnected) {
        yard?.destroy();
        disconnectObs.disconnect();
      }
    });
    disconnectObs.observe(document.body, { childList: true, subtree: true });

    el.addEventListener('click', (e) => {
      if (e.target.closest('.game-fullscreen-btn')) return;
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'focus-yard') {
        yard?.focus();
        return;
      }
      if (action === 'toggle-ride') {
        yard?.toggleRide?.();
        return;
      }
      if (action === 'reset-yard') {
        yard?.reset();
        return;
      }
      if (action === 'add-photo') {
        setStatus(el, 'Paste an image (Ctrl+V) or drop a file onto the yard.');
        el.focus({ preventScroll: true });
      }
    });

    if (typeof options.onPasteImage !== 'function') return;

    async function handlePasteFiles(files) {
      const imageFiles = [...files].filter(f => f && String(f.type || '').startsWith('image/'));
      if (!imageFiles.length) return;
      el.classList.add('ghosttrain-block--uploading');
      setStatus(el, 'Uploading…');
      try {
        for (const file of imageFiles) {
          await options.onPasteImage(file, spec);
        }
      } finally {
        el.classList.remove('ghosttrain-block--uploading');
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
      el.classList.add('ghosttrain-block--drop');
    });
    el.addEventListener('dragleave', () => el.classList.remove('ghosttrain-block--drop'));
    el.addEventListener('drop', (e) => {
      el.classList.remove('ghosttrain-block--drop');
      const files = [...(e.dataTransfer?.files || [])].filter(f => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      e.stopPropagation();
      void handlePasteFiles(files);
    });
  }

  function hydrate(root) {
    (root || document).querySelectorAll('.ghosttrain-block[data-ghosttrain-spec]').forEach(hydrateBlock);
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
