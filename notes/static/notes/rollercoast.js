/**
 * NotesPro ```rollercoast``` block — themed 3D roller coaster ride with your own images.
 * Modes: jungle | dune | snow | alps
 */
(function (root, factory) {
  const api = factory();
  root.NotesProRollercoast = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];
  const MODES = {
    jungle: {
      label: 'Jungle',
      sky: 0x87b8a8,
      fog: 0x6a9a7a,
      fogNear: 12,
      fogFar: 55,
      ground: 0x2f5a28,
      groundAccent: 0x1e3d1a,
      rail: 0x5c4030,
      tie: 0x3a2a1a,
      trunk: 0x4a3020,
      canopy: 0x1f6b2e,
      canopy2: 0x3d8f3a,
    },
    dune: {
      label: 'Dune',
      sky: 0xc9e4f7,
      fog: 0xe8d5a8,
      fogNear: 18,
      fogFar: 70,
      ground: 0xd2b48c,
      groundAccent: 0xc4a574,
      rail: 0x6b5b4a,
      tie: 0x8a7355,
      trunk: 0x8b6914,
      canopy: 0xc2a35a,
      canopy2: 0xa88840,
    },
    snow: {
      label: 'Snow',
      sky: 0xb8cce0,
      fog: 0xd8e4f0,
      fogNear: 14,
      fogFar: 60,
      ground: 0xeef4fa,
      groundAccent: 0xd0dce8,
      rail: 0x4a5568,
      tie: 0x2d3748,
      trunk: 0x3f2f1f,
      canopy: 0x1a4a32,
      canopy2: 0x246040,
    },
    alps: {
      label: 'Alps',
      sky: 0x7eb6d9,
      fog: 0xc5d8e8,
      fogNear: 16,
      fogFar: 75,
      ground: 0x6b7a6e,
      groundAccent: 0xe8eef5,
      rail: 0x3d4450,
      tie: 0x2a3038,
      trunk: 0x3a2a18,
      canopy: 0x1a4530,
      canopy2: 0x2a5a40,
      rock: 0x7a7f88,
      rock2: 0x9aa0a8,
      snowcap: 0xf4f7fb,
    },
  };

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function parseFenceAttrs(attrs) {
    const config = {};
    let raw = String(attrs || '').trim();
    // Support unbraced "mode jungle" / "mode=jungle title=Ride"
    if (raw && !raw.includes('=') && !raw.includes(';')) {
      const parts = raw.split(/\s+/).filter(Boolean);
      if (parts[0] && MODES[parts[0].toLowerCase()]) {
        config.mode = parts[0].toLowerCase();
        raw = parts.slice(1).join(' ');
      } else if (parts[0]?.toLowerCase() === 'mode' && parts[1]) {
        config.mode = parts[1].toLowerCase();
        raw = parts.slice(2).join(' ');
      }
    }
    raw.split(/[;\s]+/).forEach(pair => {
      const trimmed = pair.trim();
      if (!trimmed) return;
      const eq = trimmed.indexOf('=');
      if (eq < 0) {
        if (MODES[trimmed.toLowerCase()]) config.mode = trimmed.toLowerCase();
        else config[trimmed.toLowerCase()] = '';
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

  function resolveMode(cfg) {
    const raw = String(cfg.mode || cfg.theme || cfg.env || 'jungle').trim().toLowerCase();
    if (MODES[raw]) return raw;
    if (raw === 'desert' || raw === 'sand') return 'dune';
    if (raw === 'alpine' || raw === 'mountain' || raw === 'mountains') return 'alps';
    if (raw === 'winter' || raw === 'ice') return 'snow';
    return 'jungle';
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
    const mode = resolveMode(cfg);
    const photos = parsePhotos(source);
    return {
      title: String(cfg.title || `${MODES[mode].label} coaster`).trim() || 'Roller coaster',
      mode,
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
    const status = el.querySelector('.rollercoast-status');
    if (!status) return;
    status.textContent = text || '';
  }

  function renderBlock(source, fenceAttrs, options = {}) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const style = resolveStyle(cfg);
    const spec = buildSpec(source, cfg);
    const rideIndex = Number.isFinite(options.rideIndex) ? options.rideIndex : 0;
    const editable = options.editable !== false;
    const fullscreen = resolveFullscreen(cfg);
    const themeClass = style.theme ? ` rollercoast-block--${style.theme}` : '';
    const customClass = (style.colorCss || style.bgCss) ? ' rollercoast-block--custom' : '';
    const fullClass = fullscreen ? ' rollercoast-block--fullscreen' : '';
    const modeClass = ` rollercoast-block--${spec.mode}`;
    const styleVars = [];
    if (style.colorCss) styleVars.push(`--rollercoast-accent:${style.colorCss}`);
    if (style.bgCss) styleVars.push(`--rollercoast-bg:${style.bgCss}`);
    const styleAttr = styleVars.length
      ? ` style="${styleVars.map(v => escapeHtml(v)).join(';')}"`
      : '';
    const encoded = encodeSpec(spec);
    const chrome = fullscreen ? '' : [
      `<div class="rollercoast-block-header">`,
      `<div class="rollercoast-block-title">${escapeHtml(spec.title)}</div>`,
      `<div class="rollercoast-block-meta">${spec.mode}${spec.draft ? ' · add photos' : ` · ${spec.photos.length} image${spec.photos.length === 1 ? '' : 's'}`}</div>`,
      `</div>`,
    ].join('');

    const body = [
      `<div class="rollercoast-ride">`,
      `<div class="rollercoast-viewport" tabindex="0" aria-label="Roller coaster ride">`,
      `<canvas class="rollercoast-canvas"></canvas>`,
      `<div class="rollercoast-overlay">`,
      `<p class="rollercoast-hint">${spec.draft
        ? 'Paste your photos to hang them along the track'
        : 'Auto-ride · track obstacles · paste more photos · ⛶ fullscreen'}</p>`,
      `<div class="rollercoast-warn" aria-live="assertive" hidden></div>`,
      `<div class="rollercoast-caption" aria-live="polite"></div>`,
      `</div>`,
      `</div>`,
      `<div class="rollercoast-toolbar">`,
      `<button type="button" class="btn btn-sm btn-outline-light" data-action="toggle-ride" aria-pressed="true">Pause</button>`,
      `<button type="button" class="btn btn-sm btn-outline-secondary" data-action="boost">Boost</button>`,
      editable
        ? `<button type="button" class="btn btn-sm btn-outline-secondary" data-action="add-photo">Add photo</button>`
        : '',
      `</div>`,
      `</div>`,
    ].join('');

    return [
      `<div class="rollercoast-block${themeClass}${customClass}${fullClass}${modeClass}${editable ? ' rollercoast-block--editable' : ''}${spec.draft ? ' rollercoast-block--draft' : ''}"${styleAttr}`,
      ` data-rollercoast-index="${rideIndex}"`,
      ` data-rollercoast-spec="${escapeHtml(encoded)}" tabindex="0">`,
      renderFullscreenButton(),
      chrome,
      body,
      `<div class="rollercoast-status" aria-live="polite"></div>`,
      `</div>`,
    ].join('');
  }

  function buildTrackCurve(THREE, mode) {
    const pts = [];
    const segs = 72;
    for (let i = 0; i <= segs; i += 1) {
      const t = (i / segs) * Math.PI * 2;
      const radius = 16 + Math.sin(t * 2) * 4.2 + Math.cos(t * 3) * 1.6;
      const x = Math.cos(t) * radius;
      const z = Math.sin(t) * radius * 0.88;
      let y = 2.6
        + Math.sin(t * 2) * 4.4
        + Math.cos(t * 3) * 1.9
        + Math.sin(t) * 1.4;
      if (mode === 'dune') y = 2.0 + Math.sin(t * 2) * 2.8 + Math.cos(t) * 1.3;
      if (mode === 'snow') y = 3.2 + Math.sin(t * 2.2) * 4.8 + Math.cos(t * 1.5) * 1.7;
      if (mode === 'alps') y = 4.0 + Math.sin(t * 2.4) * 5.8 + Math.cos(t * 1.3) * 2.4 + Math.sin(t * 5) * 0.7;
      if (t < 1.35) y += (1.35 - t) * 3.2;
      // Small dip / valley
      if (t > 3.4 && t < 4.2) y -= Math.sin((t - 3.4) / 0.8 * Math.PI) * 1.8;
      pts.push(new THREE.Vector3(x, Math.max(1.1, y), z));
    }
    return new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.42);
  }

  function addTerrain(THREE, scene, palette, mode) {
    const geo = new THREE.PlaneGeometry(120, 120, 96, 96);
    const pos = geo.attributes.position;
    const colors = [];
    const cGround = new THREE.Color(palette.ground);
    const cAccent = new THREE.Color(palette.groundAccent);
    const cRock = new THREE.Color(palette.rock || palette.groundAccent);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      let h = Math.sin(x * 0.15) * Math.cos(y * 0.13) * 1.6
        + Math.sin(x * 0.06 + y * 0.08) * 2.6
        + Math.sin(x * 0.31) * Math.cos(y * 0.28) * 0.35;
      if (mode === 'dune') {
        h = Math.sin(x * 0.1) * 3.4 + Math.cos(y * 0.08) * 2.8 + Math.sin((x + y) * 0.045) * 1.8;
      }
      if (mode === 'snow') {
        h = Math.abs(Math.sin(x * 0.07) * Math.cos(y * 0.07)) * 5.2
          + Math.sin(x * 0.18) * 0.7;
      }
      if (mode === 'alps') {
        const ridge = Math.abs(Math.sin(x * 0.048) * Math.cos(y * 0.044));
        h = ridge * 12
          + Math.sin(x * 0.12) * 1.5
          + Math.cos(y * 0.11) * 1.3
          + Math.max(0, ridge - 0.5) * 8;
      }
      if (mode === 'jungle') {
        h += Math.sin(x * 0.38) * Math.cos(y * 0.33) * 0.55;
      }
      pos.setZ(i, h);
      const blend = Math.max(0, Math.min(1, (h + 1.5) / 10));
      if (mode === 'alps' && h > 7) tmp.copy(cRock).lerp(cAccent, Math.min(1, (h - 7) / 6));
      else tmp.copy(cGround).lerp(cAccent, blend * 0.55 + Math.random() * 0.08);
      colors.push(tmp.r, tmp.g, tmp.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: (mode === 'snow' || mode === 'alps') ? 0.92 : 0.88,
      metalness: 0.02,
      flatShading: mode === 'dune',
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -0.55;
    scene.add(mesh);
  }

  function nearestTrackSample(THREE, curve, x, z, samples = 96) {
    let min = Infinity;
    let bestT = 0;
    let best = null;
    for (let i = 0; i <= samples; i += 1) {
      const t = i / samples;
      const p = curve.getPointAt(t);
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < min) {
        min = d;
        bestT = t;
        best = p;
      }
    }
    return { dist: min, t: bestT, point: best };
  }

  function clearOfTrack(THREE, curve, pos, minClear) {
    const hit = nearestTrackSample(THREE, curve, pos.x, pos.z);
    if (!hit.point || hit.dist >= minClear) return pos;
    const away = new THREE.Vector3(pos.x - hit.point.x, 0, pos.z - hit.point.z);
    if (away.lengthSq() < 1e-8) {
      const tangent = curve.getTangentAt(hit.t);
      away.set(-tangent.z, 0, tangent.x);
    }
    away.normalize().multiplyScalar(minClear - hit.dist + 0.35);
    pos.x += away.x;
    pos.z += away.z;
    return pos;
  }

  function tagObstacle(mesh, radius, kind, onTrack) {
    mesh.userData.isObstacle = true;
    mesh.userData.obstacleRadius = radius;
    mesh.userData.obstacleKind = kind || 'obstacle';
    if (onTrack) mesh.userData.onTrack = true;
    return mesh;
  }

  function trackSideVector(tangent) {
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x);
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
    return side.normalize();
  }

  function pushObstacle(obstacles, mesh, radius, kind, onTrack) {
    tagObstacle(mesh, radius, kind, onTrack);
    obstacles.push(mesh);
    return mesh;
  }

  function addTrackObstacles(THREE, scene, curve, palette, mode, obstacles) {
    const count = mode === 'jungle' ? 16 : mode === 'alps' ? 14 : 12;
    const postMat = new THREE.MeshStandardMaterial({ color: palette.tie, roughness: 0.88, metalness: 0.12 });
    const railMat = new THREE.MeshStandardMaterial({ color: palette.rail, metalness: 0.7, roughness: 0.32 });
    const warnMat = new THREE.MeshStandardMaterial({
      color: mode === 'dune' ? 0xf59e0b : 0xfbbf24,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.35,
      roughness: 0.55,
    });
    const debrisMat = new THREE.MeshStandardMaterial({
      color: mode === 'snow' || mode === 'alps' ? palette.rock || 0x7a7f88 : palette.trunk,
      roughness: 0.95,
      flatShading: true,
    });

    for (let i = 0; i < count; i += 1) {
      const t = ((i * 0.061) + 0.04 + (i % 5) * 0.007) % 1;
      const pos = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t).normalize();
      const side = trackSideVector(tangent);
      const kindRoll = i % 4;

      if (kindRoll === 0) {
        const gauge = 0.62;
        const postH = 2.35 + (i % 3) * 0.25;
        [-gauge, gauge].forEach((g) => {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, postH, 7), postMat);
          post.position.copy(pos).add(side.clone().multiplyScalar(g));
          post.position.y += postH / 2 - 0.35;
          scene.add(post);
          pushObstacle(obstacles, post, 0.55, 'gate', true);
        });
        const bar = new THREE.Mesh(new THREE.BoxGeometry(gauge * 2 + 0.18, 0.14, 0.14), railMat);
        bar.position.copy(pos);
        bar.position.y += postH - 0.45;
        bar.lookAt(pos.clone().add(tangent));
        scene.add(bar);
        pushObstacle(obstacles, bar, 0.75, 'gate', true);
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(gauge * 2 + 0.08, 0.55, 0.05), warnMat);
        stripe.position.copy(bar.position);
        stripe.position.y -= 0.42;
        stripe.lookAt(pos.clone().add(tangent));
        scene.add(stripe);
        pushObstacle(obstacles, stripe, 0.65, 'gate', true);
      } else if (kindRoll === 1) {
        const rock = new THREE.Mesh(
          new THREE.DodecahedronGeometry(0.42 + (i % 4) * 0.12, 0),
          debrisMat,
        );
        rock.position.copy(pos);
        rock.position.y += 0.28;
        rock.rotation.set(i * 0.7, i * 1.1, i * 0.4);
        scene.add(rock);
        pushObstacle(obstacles, rock, 0.72, 'debris', true);
        if (i % 2 === 0) {
          const rock2 = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.32, 0.48), debrisMat);
          rock2.position.copy(pos).add(side.clone().multiplyScalar(0.22));
          rock2.position.y += 0.22;
          rock2.rotation.y = i * 0.5;
          scene.add(rock2);
          pushObstacle(obstacles, rock2, 0.58, 'debris', true);
        }
      } else if (kindRoll === 2) {
        const crate = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.62, 0.78), postMat);
        crate.position.copy(pos);
        crate.position.y += 0.34;
        crate.lookAt(pos.clone().add(tangent));
        scene.add(crate);
        pushObstacle(obstacles, crate, 0.82, 'barrier', true);
        const plank = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.12, 0.18), warnMat);
        plank.position.copy(crate.position);
        plank.position.y += 0.38;
        plank.lookAt(pos.clone().add(tangent));
        scene.add(plank);
        pushObstacle(obstacles, plank, 0.55, 'barrier', true);
      } else {
        const beam = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.16, 0.16), railMat);
        beam.position.copy(pos);
        beam.position.y += 0.52 + (i % 2) * 0.18;
        beam.lookAt(pos.clone().add(tangent));
        scene.add(beam);
        pushObstacle(obstacles, beam, 0.68, 'rail block', true);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.55, 6), warnMat);
        cone.position.copy(pos).add(tangent.clone().multiplyScalar(0.55));
        cone.position.y += 0.3;
        scene.add(cone);
        pushObstacle(obstacles, cone, 0.45, 'rail block', true);
      }
    }
  }

  function addScenery(THREE, scene, palette, mode, curve, obstacles) {
    const count = mode === 'jungle' ? 95 : mode === 'alps' ? 70 : mode === 'snow' ? 55 : 36;
    for (let i = 0; i < count; i += 1) {
      const t = (i + Math.random() * 0.4) / count;
      const p = curve.getPointAt(t % 1);
      const side = i % 2 === 0 ? 1 : -1;
      const tangent = curve.getTangentAt(t % 1).normalize();
      const sideVec = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const dist = 6.5 + Math.random() * 16;
      const pos = clearOfTrack(
        THREE,
        curve,
        p.clone().add(sideVec.clone().multiplyScalar(side * dist)),
        mode === 'jungle' ? 5.2 : 4.8,
      );
      pos.y = 0;

      if (mode === 'jungle') {
        const trunkH = 3.2 + Math.random() * 5.5;
        const trunk = new THREE.Mesh(
          new THREE.CylinderGeometry(0.16, 0.28, trunkH, 7),
          new THREE.MeshStandardMaterial({ color: palette.trunk, roughness: 1 }),
        );
        trunk.position.set(pos.x, trunkH / 2, pos.z);
        trunk.rotation.z = (Math.random() - 0.5) * 0.12;
        tagObstacle(trunk, 1.1, 'tree', false);
        scene.add(trunk);
        obstacles.push(trunk);
        for (let c = 0; c < 3; c += 1) {
          const canopy = new THREE.Mesh(
            new THREE.SphereGeometry(1.4 + Math.random() * 1.8, 9, 7),
            new THREE.MeshStandardMaterial({
              color: Math.random() > 0.5 ? palette.canopy : palette.canopy2,
              roughness: 0.82,
            }),
          );
          canopy.position.set(
            pos.x + (Math.random() - 0.5) * 1.4,
            trunkH + 0.4 + c * 0.55,
            pos.z + (Math.random() - 0.5) * 1.4,
          );
          canopy.scale.set(1, 0.7 + Math.random() * 0.2, 1);
          tagObstacle(canopy, 2.0, 'canopy', false);
          scene.add(canopy);
          obstacles.push(canopy);
        }
      } else if (mode === 'dune') {
        const rock = new THREE.Mesh(
          new THREE.DodecahedronGeometry(0.7 + Math.random() * 1.8, 0),
          new THREE.MeshStandardMaterial({ color: palette.canopy, roughness: 1, flatShading: true }),
        );
        rock.position.set(pos.x, 0.55 + Math.random() * 0.6, pos.z);
        rock.rotation.set(Math.random(), Math.random(), Math.random());
        tagObstacle(rock, 1.6, 'rock', false);
        scene.add(rock);
        obstacles.push(rock);
        if (Math.random() > 0.5) {
          const cactus = new THREE.Mesh(
            new THREE.CylinderGeometry(0.14, 0.18, 1.8 + Math.random() * 1.2, 7),
            new THREE.MeshStandardMaterial({ color: 0x3d7a45, roughness: 0.8 }),
          );
          cactus.position.set(pos.x + 1.4, 1.0, pos.z + 0.5);
          tagObstacle(cactus, 0.7, 'cactus', false);
          scene.add(cactus);
          obstacles.push(cactus);
        }
      } else if (mode === 'alps') {
        if (i % 2 === 0) {
          const peakH = 9 + Math.random() * 14;
          const peak = new THREE.Mesh(
            new THREE.ConeGeometry(3.2 + Math.random() * 3.5, peakH, 6),
            new THREE.MeshStandardMaterial({
              color: Math.random() > 0.4 ? palette.rock : palette.rock2,
              roughness: 0.93,
              flatShading: true,
            }),
          );
          const far = sideVec.clone().multiplyScalar(side * (18 + Math.random() * 24));
          const peakPos = clearOfTrack(
            THREE,
            curve,
            new THREE.Vector3(p.x + far.x, 0, p.z + far.z),
            10,
          );
          peak.position.set(peakPos.x, peakH * 0.32, peakPos.z);
          tagObstacle(peak, 4.5, 'peak', false);
          scene.add(peak);
          obstacles.push(peak);
          const cap = new THREE.Mesh(
            new THREE.ConeGeometry(1.6 + Math.random() * 1.2, peakH * 0.32, 6),
            new THREE.MeshStandardMaterial({ color: palette.snowcap, roughness: 0.97 }),
          );
          cap.position.set(peak.position.x, peak.position.y + peakH * 0.4, peak.position.z);
          scene.add(cap);
        }
        const pineH = 3.0 + Math.random() * 3.5;
        const trunk = new THREE.Mesh(
          new THREE.CylinderGeometry(0.1, 0.16, pineH * 0.34, 6),
          new THREE.MeshStandardMaterial({ color: palette.trunk, roughness: 1 }),
        );
        trunk.position.set(pos.x, pineH * 0.15, pos.z);
        tagObstacle(trunk, 0.9, 'pine', false);
        scene.add(trunk);
        obstacles.push(trunk);
        for (let k = 0; k < 4; k += 1) {
          const cone = new THREE.Mesh(
            new THREE.ConeGeometry(1.2 - k * 0.2, 1.35, 8),
            new THREE.MeshStandardMaterial({
              color: k % 2 ? palette.canopy : palette.canopy2,
              roughness: 0.88,
            }),
          );
          cone.position.set(pos.x, pineH * 0.3 + k * 0.7, pos.z);
          tagObstacle(cone, 1.3, 'pine', false);
          scene.add(cone);
          obstacles.push(cone);
        }
        if (Math.random() > 0.55) {
          const boulder = new THREE.Mesh(
            new THREE.DodecahedronGeometry(0.55 + Math.random() * 1.0, 0),
            new THREE.MeshStandardMaterial({ color: palette.rock, roughness: 1, flatShading: true }),
          );
          boulder.position.set(pos.x + 1.3, 0.4, pos.z - 0.7);
          tagObstacle(boulder, 1.1, 'rock', false);
          scene.add(boulder);
          obstacles.push(boulder);
        }
      } else {
        const pineH = 3.2 + Math.random() * 3.8;
        const trunk = new THREE.Mesh(
          new THREE.CylinderGeometry(0.12, 0.2, pineH * 0.35, 6),
          new THREE.MeshStandardMaterial({ color: palette.trunk, roughness: 1 }),
        );
        trunk.position.set(pos.x, pineH * 0.16, pos.z);
        tagObstacle(trunk, 0.95, 'pine', false);
        scene.add(trunk);
        obstacles.push(trunk);
        for (let k = 0; k < 4; k += 1) {
          const cone = new THREE.Mesh(
            new THREE.ConeGeometry(1.35 - k * 0.22, 1.5, 8),
            new THREE.MeshStandardMaterial({
              color: k % 2 ? palette.canopy : palette.canopy2,
              roughness: 0.88,
            }),
          );
          cone.position.set(pos.x, pineH * 0.34 + k * 0.75, pos.z);
          tagObstacle(cone, 1.4, 'pine', false);
          scene.add(cone);
          obstacles.push(cone);
        }
      }
    }
  }

  function addRails(THREE, scene, curve, palette) {
    const segments = 280;
    const frames = curve.computeFrenetFrames(segments, true);
    const left = [];
    const right = [];
    const gauge = 0.42;
    for (let i = 0; i <= segments; i += 1) {
      const t = i / segments;
      const p = curve.getPointAt(t);
      const n = frames.normals[i];
      const b = frames.binormals[i];
      // Prefer horizontal-ish binormal for rail spacing
      let side = new THREE.Vector3().copy(b);
      if (Math.abs(side.y) > 0.85) side.copy(n);
      side.y *= 0.25;
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      side.normalize().multiplyScalar(gauge);
      left.push(p.clone().add(side));
      right.push(p.clone().sub(side));
    }
    const leftCurve = new THREE.CatmullRomCurve3(left, true);
    const rightCurve = new THREE.CatmullRomCurve3(right, true);
    const railMat = new THREE.MeshStandardMaterial({
      color: palette.rail,
      metalness: 0.72,
      roughness: 0.28,
    });
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(leftCurve, segments, 0.055, 8, true), railMat));
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(rightCurve, segments, 0.055, 8, true), railMat));

    const tieMat = new THREE.MeshStandardMaterial({ color: palette.tie, roughness: 0.88, metalness: 0.05 });
    const postMat = new THREE.MeshStandardMaterial({ color: palette.tie, roughness: 0.9, metalness: 0.15 });
    for (let i = 0; i < 110; i += 1) {
      const t = i / 110;
      const p = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t);
      const tie = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.09, 0.22), tieMat);
      tie.position.copy(p);
      tie.lookAt(p.clone().add(tangent));
      scene.add(tie);

      if (i % 3 === 0 && p.y > 2.2) {
        const postH = p.y + 0.2;
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, postH, 6), postMat);
        post.position.set(p.x, postH / 2 - 0.4, p.z);
        scene.add(post);
        const brace = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 1.1), postMat);
        brace.position.set(p.x, Math.max(0.6, p.y * 0.45), p.z);
        brace.lookAt(p.x + tangent.x, brace.position.y, p.z + tangent.z);
        scene.add(brace);
      }
    }
  }

  function createCart(THREE, palette) {
    const train = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xb91c1c, metalness: 0.35, roughness: 0.4 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.75 });
    const chromeMat = new THREE.MeshStandardMaterial({ color: palette.rail, metalness: 0.8, roughness: 0.25 });
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111827, metalness: 0.5, roughness: 0.4 });

    [-0.95, 0, 0.95].forEach((zOff, idx) => {
      const car = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.42, 0.95), bodyMat);
      body.position.set(0, 0.42, 0);
      car.add(body);
      const nose = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.28, 0.35), bodyMat);
      nose.position.set(0, 0.38, 0.55);
      car.add(nose);
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.22, 0.45), darkMat);
      seat.position.set(0, 0.62, -0.08);
      car.add(seat);
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.88, 10), chromeMat);
      bar.rotation.z = Math.PI / 2;
      bar.position.set(0, 0.78, 0.28);
      car.add(bar);
      [[-0.38, -0.32], [0.38, -0.32], [-0.38, 0.32], [0.38, 0.32]].forEach(([x, z]) => {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 10), wheelMat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, 0.14, z);
        car.add(wheel);
      });
      if (idx === 0) {
        const lamp = new THREE.Mesh(
          new THREE.SphereGeometry(0.08, 10, 8),
          new THREE.MeshStandardMaterial({ color: 0xfde68a, emissive: 0xfbbf24, emissiveIntensity: 0.8 }),
        );
        lamp.position.set(0, 0.45, 0.78);
        car.add(lamp);
      }
      car.position.z = zOff;
      train.add(car);
    });
    return train;
  }

  function modeFogDensity(mode) {
    if (mode === 'jungle') return 0.022;
    if (mode === 'dune') return 0.014;
    if (mode === 'alps') return 0.012;
    if (mode === 'snow') return 0.016;
    return 0.018;
  }

  function createRide(el, spec) {
    const THREE = window.THREE;
    const viewport = el.querySelector('.rollercoast-viewport');
    const canvas = el.querySelector('.rollercoast-canvas');
    const captionEl = el.querySelector('.rollercoast-caption');
    const warnEl = el.querySelector('.rollercoast-warn');
    const rideBtn = el.querySelector('[data-action="toggle-ride"]');
    if (!viewport || !canvas) return null;

    const palette = MODES[spec.mode] || MODES.jungle;
    const photos = spec.photos || [];
    const obstacles = [];

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(palette.sky);
    scene.fog = new THREE.FogExp2(palette.fog, modeFogDensity(spec.mode));

    const camera = new THREE.PerspectiveCamera(72, 1, 0.08, 200);
    const hemi = new THREE.HemisphereLight(palette.sky, palette.ground, 0.55);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1d6, 1.35);
    sun.position.set(28, 42, 14);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xb9d4ff, 0.4);
    fill.position.set(-18, 16, -12);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.25);
    rim.position.set(0, 8, -20);
    scene.add(rim);

    const curve = buildTrackCurve(THREE, spec.mode);
    const trackFrames = curve.computeFrenetFrames(240, true);
    addTerrain(THREE, scene, palette, spec.mode);
    addScenery(THREE, scene, palette, spec.mode, curve, obstacles);
    addTrackObstacles(THREE, scene, curve, palette, spec.mode, obstacles);
    addRails(THREE, scene, curve, palette);

    const cart = createCart(THREE, palette);
    scene.add(cart);

    const raycaster = new THREE.Raycaster();
    raycaster.far = 22;
    const obstacleProbe = new THREE.Vector3();
    const obstacleDir = new THREE.Vector3();
    const trackObstacles = obstacles;
    let bankBias = 0;
    let speedFactor = 1;
    let lastWarnKind = '';

    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    const billboards = [];
    const mediaNodes = [];

    function fitBillboard(mesh, frame, matte, aspect) {
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
      const radius = Math.sqrt(w * w + h * h) * 0.42;
      mesh.userData.obstacleRadius = radius;
      frame.userData.obstacleRadius = radius;
    }

    photos.forEach((photo, i) => {
      const t = ((i + 0.35) / Math.max(1, photos.length)) % 1;
      const p = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t).normalize();
      const side = i % 2 === 0 ? 1 : -1;
      const sideVec = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const offset = 5.2 + (i % 3) * 0.55;
      const pos = clearOfTrack(
        THREE,
        curve,
        p.clone().add(sideVec.clone().multiplyScalar(side * offset)),
        5.8,
      );
      pos.y = 2.6 + Math.sin(i * 1.7) * 0.45;

      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(4.8, 4.8, 0.16),
        new THREE.MeshStandardMaterial({ color: 0x2c2118, roughness: 0.72, metalness: 0.08 }),
      );
      frame.position.copy(pos);
      frame.lookAt(p.x, pos.y, p.z);
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
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.14, poleH, 8),
        new THREE.MeshStandardMaterial({ color: palette.tie, roughness: 0.9, metalness: 0.1 }),
      );
      pole.position.set(pos.x, poleH / 2, pos.z);
      scene.add(pole);

      const arm = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.12, 1.1),
        new THREE.MeshStandardMaterial({ color: palette.rail, metalness: 0.5, roughness: 0.4 }),
      );
      arm.position.copy(pos);
      arm.position.y -= 0.15;
      arm.lookAt(p.x, arm.position.y, p.z);
      scene.add(arm);

      const spot = new THREE.SpotLight(0xfff5e6, 2.8, 14, Math.PI / 5, 0.45, 1);
      spot.position.copy(pos).add(new THREE.Vector3(0, 2.2, 0)).add(sideVec.clone().multiplyScalar(-side * 0.8));
      spot.target = mesh;
      scene.add(spot);
      scene.add(spot.target);

      const url = resolveMediaHref(photo.src);
      const kind = photo.kind === 'video' || isVideoSrc(photo.src) ? 'video' : 'image';
      const entry = { mesh, photo, kind, video: null, texture: null, t };

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
            fitBillboard(mesh, frame, matte, video.videoWidth / video.videoHeight);
          }
        });
        const tex = new THREE.VideoTexture(video);
        tex.colorSpace = THREE.SRGBColorSpace;
        mat.map = tex;
        mat.color.set(0xffffff);
        mat.emissive.set(0x222222);
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
          mat.needsUpdate = true;
          entry.texture = tex;
          const img = tex.image;
          if (img?.width && img?.height) fitBillboard(mesh, frame, matte, img.width / img.height);
        });
      }
      billboards.push(entry);
    });

    function detectObstacles(pos, tangent, up, binormal) {
      obstacleDir.copy(tangent).normalize();
      let closest = null;
      const probes = [
        pos,
        pos.clone().add(binormal.clone().multiplyScalar(0.35)),
        pos.clone().add(binormal.clone().multiplyScalar(-0.35)),
      ];
      for (let p = 0; p < probes.length; p += 1) {
        obstacleProbe.copy(probes[p]).add(up.clone().multiplyScalar(0.55));
        raycaster.set(obstacleProbe, obstacleDir);
        const hits = raycaster.intersectObjects(trackObstacles, false);
        for (let i = 0; i < hits.length; i += 1) {
          const h = hits[i];
          if (!h.object?.userData?.isObstacle || !h.object.userData.onTrack) continue;
          const pad = h.object.userData.obstacleRadius || 0.8;
          if (h.distance <= raycaster.far + pad && (!closest || h.distance < closest.distance)) {
            closest = h;
          }
        }
      }

      // Side proximity for scenery hugging the track (not photo boards)
      let sideThreat = 0;
      let sideSign = 0;
      let nearKind = '';
      for (let i = 0; i < trackObstacles.length; i += 1) {
        const obj = trackObstacles[i];
        if (obj.userData.onTrack) continue;
        const radius = obj.userData.obstacleRadius || 1;
        const to = obj.position.clone().sub(pos);
        const ahead = to.dot(tangent);
        if (ahead < -0.5 || ahead > 10) continue;
        const lateral = Math.abs(to.dot(binormal));
        if (lateral > radius + 2.4) continue;
        const d = obj.position.distanceTo(pos);
        if (d > radius + 5.5) continue;
        const clearance = d - radius;
        if (clearance < 2.4) {
          const threat = 1 - Math.max(0, clearance) / 2.4;
          if (threat > sideThreat) {
            sideThreat = threat;
            sideSign = to.dot(binormal) >= 0 ? -1 : 1;
            nearKind = obj.userData.obstacleKind || 'obstacle';
          }
        }
      }

      let brake = 1;
      let warn = '';
      if (closest) {
        const dist = closest.distance;
        const kind = closest.object.userData.obstacleKind || 'obstacle';
        if (dist < 4.0) {
          brake = 0.18;
          warn = `Track blocked — ${kind} (${dist.toFixed(1)}m)`;
        } else if (dist < 8) {
          brake = 0.42;
          warn = `Slowing — ${kind} on rails`;
        } else if (dist < 14) {
          brake = 0.68;
          warn = `Caution — ${kind} ahead`;
        }
        const lateral = closest.point.clone().sub(pos).dot(binormal);
        bankBias += ((lateral >= 0 ? -1 : 1) * (1 - Math.min(1, dist / 14)) - bankBias) * 0.18;
      } else if (sideThreat > 0.2) {
        brake = Math.min(brake, 1 - sideThreat * 0.45);
        bankBias += (sideSign * sideThreat - bankBias) * 0.18;
        warn = `Near track — ${nearKind || 'obstacle'}`;
      } else {
        bankBias *= 0.9;
      }

      speedFactor += (brake - speedFactor) * 0.2;
      if (warnEl) {
        if (warn) {
          warnEl.hidden = false;
          if (warn !== lastWarnKind) warnEl.textContent = warn;
          lastWarnKind = warn;
          el.classList.add('rollercoast-block--obstacle');
        } else {
          warnEl.hidden = true;
          warnEl.textContent = '';
          lastWarnKind = '';
          el.classList.remove('rollercoast-block--obstacle');
        }
      }
      return { speedFactor, bankBias, warn };
    }

    let riding = spec.demo !== false;
    let progress = 0;
    let speed = 0.032;
    let boostUntil = 0;
    let raf = 0;
    let last = performance.now();
    let destroyed = false;

    function syncRideButton() {
      if (!rideBtn) return;
      rideBtn.textContent = riding ? 'Pause' : 'Ride';
      rideBtn.setAttribute('aria-pressed', riding ? 'true' : 'false');
      rideBtn.classList.toggle('active', riding);
    }

    function resize() {
      const w = viewport.clientWidth || 640;
      const h = viewport.clientHeight || 420;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    }

    function placeOnTrack(u) {
      const t = ((u % 1) + 1) % 1;
      const pos = curve.getPointAt(t);
      const look = curve.getPointAt((t + 0.012) % 1);
      const tangent = curve.getTangentAt(t).normalize();
      const idx = Math.min(trackFrames.normals.length - 1, Math.floor(t * trackFrames.normals.length));
      const normal = trackFrames.normals[idx];
      const binormal = trackFrames.binormals[idx];

      cart.position.copy(pos);
      const up = new THREE.Vector3(0, 1, 0).lerp(normal, 0.35).normalize();
      cart.up.copy(up);
      cart.lookAt(look);

      detectObstacles(pos, tangent, up, binormal);

      const back = tangent.clone().multiplyScalar(-3.6);
      const camPos = pos.clone()
        .add(back)
        .add(up.clone().multiplyScalar(1.85))
        .add(binormal.clone().multiplyScalar(0.15 + bankBias * 0.55));
      camera.position.lerp(camPos, riding ? 0.22 : 0.45);
      const camLook = pos.clone()
        .add(tangent.clone().multiplyScalar(6.5))
        .add(up.clone().multiplyScalar(0.7))
        .add(binormal.clone().multiplyScalar(bankBias * 0.35));
      camera.up.copy(up);
      camera.lookAt(camLook);

      let nearest = null;
      let best = Infinity;
      billboards.forEach((b) => {
        const d = b.mesh.position.distanceTo(pos);
        if (d < best && d < 12) {
          best = d;
          nearest = b;
        }
      });
      if (captionEl && !lastWarnKind) {
        captionEl.textContent = nearest
          ? (nearest.photo.label || (nearest.kind === 'video' ? 'Video' : 'Photo'))
          : `${palette.label} · lap ${Math.floor(progress) + 1}`;
      } else if (captionEl && lastWarnKind) {
        captionEl.textContent = nearest
          ? (nearest.photo.label || (nearest.kind === 'video' ? 'Video' : 'Photo'))
          : '';
      }
    }

    function tick(now) {
      if (destroyed) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (riding) {
        const boosted = now < boostUntil;
        const v = speed * (boosted ? 2.4 : 1) * Math.max(0.18, speedFactor);
        progress += v * dt;
        placeOnTrack(progress);
      } else {
        placeOnTrack(progress);
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    }

    function toggleRide() {
      riding = !riding;
      syncRideButton();
    }

    function boost() {
      boostUntil = performance.now() + 2200;
      if (!riding) {
        riding = true;
        syncRideButton();
      }
    }

    window.addEventListener('resize', resize);
    el.addEventListener('notespro:monitor-fullscreen', () => {
      requestAnimationFrame(resize);
    });

    resize();
    placeOnTrack(0);
    syncRideButton();
    raf = requestAnimationFrame(tick);
    if (!photos.length) {
      setStatus(el, 'Paste photos (Ctrl+V) to place them along the track.');
    }

    return {
      toggleRide,
      boost,
      destroy() {
        destroyed = true;
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', resize);
        mediaNodes.forEach((video) => {
          video.pause();
          video.removeAttribute('src');
          video.load();
        });
        billboards.forEach((b) => b.texture?.dispose?.());
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
    if (!el || el.dataset.rollercoastHydrated === '1') return;
    const spec = decodeSpec(el.dataset.rollercoastSpec);
    if (!spec) return;
    el.dataset.rollercoastHydrated = '1';
    bindFullscreenButton(el);

    let ride = null;
    if (threeReady()) {
      ride = createRide(el, spec);
    } else {
      setStatus(el, 'Three.js not loaded — roller coaster unavailable.');
    }

    const disconnectObs = new MutationObserver(() => {
      if (!el.isConnected) {
        ride?.destroy();
        disconnectObs.disconnect();
      }
    });
    disconnectObs.observe(document.body, { childList: true, subtree: true });

    el.addEventListener('click', (e) => {
      if (e.target.closest('.game-fullscreen-btn')) return;
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'toggle-ride') {
        ride?.toggleRide();
        return;
      }
      if (action === 'boost') {
        ride?.boost();
        return;
      }
      if (action === 'add-photo') {
        setStatus(el, 'Paste an image (Ctrl+V) or drop a file onto the ride.');
        el.focus({ preventScroll: true });
      }
    });

    if (typeof options.onPasteImage !== 'function') return;

    async function handlePasteFiles(files) {
      const imageFiles = [...files].filter(f => f && String(f.type || '').startsWith('image/'));
      if (!imageFiles.length) return;
      el.classList.add('rollercoast-block--uploading');
      setStatus(el, 'Uploading…');
      try {
        for (const file of imageFiles) {
          await options.onPasteImage(file, spec);
        }
      } finally {
        el.classList.remove('rollercoast-block--uploading');
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
      el.classList.add('rollercoast-block--drop');
    });
    el.addEventListener('dragleave', () => el.classList.remove('rollercoast-block--drop'));
    el.addEventListener('drop', (e) => {
      el.classList.remove('rollercoast-block--drop');
      const files = [...(e.dataTransfer?.files || [])].filter(f => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      e.stopPropagation();
      void handlePasteFiles(files);
    });
  }

  function hydrate(root) {
    (root || document).querySelectorAll('.rollercoast-block[data-rollercoast-spec]').forEach(hydrateBlock);
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
    MODES: Object.keys(MODES),
  };
}));
