/**
 * NotesPro ```labyrinth``` / ```photo-labyrinth``` / ```maze``` block —
 * first-person photo maze with a Demo tour.
 */
(function (root, factory) {
  const api = factory();
  root.NotesProLabyrinth = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];
  const CELL = 3.6;
  const WALL_H = 3.05;
  const WALL_T = 0.22;
  const EYE_Y = 1.55;
  const PLAYER_R = 0.38;
  const FOV_DEFAULT = 72;
  const FOV_LOOK = 52;
  const YAW_LOOK = Math.PI;

  function isLabyrinthMobile() {
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
    if (!Object.prototype.hasOwnProperty.call(cfg, 'demo')) return false;
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

  function mazeSize(photoCount) {
    if (photoCount <= 0) return { cols: 5, rows: 5 };
    if (photoCount <= 4) return { cols: 6, rows: 5 };
    if (photoCount <= 8) return { cols: 7, rows: 6 };
    return { cols: 8, rows: 7 };
  }

  function hashSeed(text) {
    let h = 2166136261;
    const s = String(text || 'labyrinth');
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(a) {
    return function rng() {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function generateMaze(cols, rows, seed) {
    const rng = mulberry32(seed || 1);
    const cells = [];
    for (let z = 0; z < rows; z += 1) {
      cells[z] = [];
      for (let x = 0; x < cols; x += 1) {
        cells[z][x] = { n: true, s: true, e: true, w: true, visited: false };
      }
    }
    const stack = [{ x: 0, z: 0 }];
    cells[0][0].visited = true;
    while (stack.length) {
      const cur = stack[stack.length - 1];
      const neighbors = [];
      if (cur.z > 0 && !cells[cur.z - 1][cur.x].visited) neighbors.push({ x: cur.x, z: cur.z - 1, dir: 'n' });
      if (cur.z < rows - 1 && !cells[cur.z + 1][cur.x].visited) neighbors.push({ x: cur.x, z: cur.z + 1, dir: 's' });
      if (cur.x < cols - 1 && !cells[cur.z][cur.x + 1].visited) neighbors.push({ x: cur.x + 1, z: cur.z, dir: 'e' });
      if (cur.x > 0 && !cells[cur.z][cur.x - 1].visited) neighbors.push({ x: cur.x - 1, z: cur.z, dir: 'w' });
      if (!neighbors.length) {
        stack.pop();
        continue;
      }
      const next = neighbors[Math.floor(rng() * neighbors.length)];
      if (next.dir === 'n') {
        cells[cur.z][cur.x].n = false;
        cells[next.z][next.x].s = false;
      } else if (next.dir === 's') {
        cells[cur.z][cur.x].s = false;
        cells[next.z][next.x].n = false;
      } else if (next.dir === 'e') {
        cells[cur.z][cur.x].e = false;
        cells[next.z][next.x].w = false;
      } else {
        cells[cur.z][cur.x].w = false;
        cells[next.z][next.x].e = false;
      }
      cells[next.z][next.x].visited = true;
      stack.push(next);
    }
    cells[0][0].w = false;
    cells[rows - 1][cols - 1].e = false;
    return { cols, rows, cells };
  }

  function cellCenter(cx, cz) {
    return { x: (cx + 0.5) * CELL, z: (cz + 0.5) * CELL };
  }

  function openNeighbors(maze, cx, cz) {
    const cell = maze.cells[cz]?.[cx];
    if (!cell) return [];
    const out = [];
    if (!cell.n && cz > 0) out.push({ x: cx, z: cz - 1 });
    if (!cell.s && cz < maze.rows - 1) out.push({ x: cx, z: cz + 1 });
    if (!cell.e && cx < maze.cols - 1) out.push({ x: cx + 1, z: cz });
    if (!cell.w && cx > 0) out.push({ x: cx - 1, z: cz });
    return out;
  }

  function solvePath(maze) {
    const start = { x: 0, z: 0 };
    const goal = { x: maze.cols - 1, z: maze.rows - 1 };
    const key = (p) => `${p.x},${p.z}`;
    const prev = new Map();
    const q = [start];
    prev.set(key(start), null);
    while (q.length) {
      const cur = q.shift();
      if (cur.x === goal.x && cur.z === goal.z) break;
      openNeighbors(maze, cur.x, cur.z).forEach((nb) => {
        const k = key(nb);
        if (prev.has(k)) return;
        prev.set(k, cur);
        q.push(nb);
      });
    }
    const path = [];
    let cur = goal;
    if (!prev.has(key(goal))) return [start];
    while (cur) {
      path.push(cur);
      cur = prev.get(key(cur));
    }
    path.reverse();
    return path;
  }

  function buildSpec(source, cfg) {
    const photos = parsePhotos(source);
    return {
      title: String(cfg.title || 'Photo labyrinth').trim() || 'Photo labyrinth',
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
    const status = el.querySelector('.labyrinth-status');
    if (!status) return;
    status.textContent = text || '';
  }

  function renderBlock(source, fenceAttrs, options = {}) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const style = resolveStyle(cfg);
    const spec = buildSpec(source, cfg);
    const labyrinthIndex = Number.isFinite(options.labyrinthIndex) ? options.labyrinthIndex : 0;
    const editable = options.editable !== false;
    const fullscreen = resolveFullscreen(cfg);
    const themeClass = style.theme ? ` labyrinth-block--${style.theme}` : '';
    const customClass = (style.colorCss || style.bgCss) ? ' labyrinth-block--custom' : '';
    const fullClass = fullscreen ? ' labyrinth-block--fullscreen' : '';
    const styleVars = [];
    if (style.colorCss) styleVars.push(`--labyrinth-accent:${style.colorCss}`);
    if (style.bgCss) styleVars.push(`--labyrinth-bg:${style.bgCss}`);
    const styleAttr = styleVars.length
      ? ` style="${styleVars.map(v => escapeHtml(v)).join(';')}"`
      : '';
    const encoded = encodeSpec(spec);
    const chrome = fullscreen ? '' : [
      `<div class="labyrinth-block-header">`,
      `<div class="labyrinth-block-title">${escapeHtml(spec.title)}</div>`,
      `<div class="labyrinth-block-meta">${spec.draft
        ? 'paste photos onto the walls'
        : `maze · ${spec.photos.length} photo${spec.photos.length === 1 ? '' : 's'} on the walls`}</div>`,
      `</div>`,
    ].join('');

    const body = [
      `<div class="labyrinth-walk">`,
      `<div class="labyrinth-viewport" tabindex="0" aria-label="Photo labyrinth">`,
      `<canvas class="labyrinth-canvas"></canvas>`,
      `<div class="labyrinth-overlay">`,
      `<p class="labyrinth-hint labyrinth-hint--desktop">${spec.draft
        ? 'Paste photos (Ctrl+V) — they cover the maze walls · click to look · W A S D walk'
        : 'Click to look · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk · Demo tour auto-walks the maze'}</p>`,
      `<p class="labyrinth-hint labyrinth-hint--mobile">${spec.demo
        ? 'Tap Demo tour — or tap the maze to look around'
        : 'Drag to look · tap Demo tour to auto-walk'}</p>`,
      `<div class="labyrinth-caption" aria-live="polite"></div>`,
      `</div>`,
      `</div>`,
      `<div class="labyrinth-toolbar">`,
      `<button type="button" class="btn btn-sm btn-outline-light" data-action="walk-focus">Enter labyrinth</button>`,
      `<button type="button" class="btn btn-sm btn-outline-light" data-action="walk-demo" aria-pressed="false">Demo tour</button>`,
      `<button type="button" class="btn btn-sm btn-outline-secondary" data-action="reset-maze">Reset</button>`,
      editable
        ? `<button type="button" class="btn btn-sm btn-outline-secondary" data-action="add-photo">Add photo</button>`
        : '',
      `</div>`,
      `</div>`,
    ].join('');

    return [
      `<div class="labyrinth-block${themeClass}${customClass}${fullClass}${editable ? ' labyrinth-block--editable' : ''}${spec.draft ? ' labyrinth-block--draft' : ''}${spec.demo ? ' labyrinth-block--demo' : ''}"${styleAttr}`,
      ` data-labyrinth-index="${labyrinthIndex}"`,
      ` data-labyrinth-spec="${escapeHtml(encoded)}" tabindex="0">`,
      renderFullscreenButton(),
      chrome,
      body,
      `<div class="labyrinth-status" aria-live="polite"></div>`,
      `</div>`,
    ].join('');
  }

  function makePlaceholderCanvas(variant) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const g = canvas.getContext('2d');
    if (!g) return canvas;
    const dark = variant % 2 === 0;
    const bg = g.createLinearGradient(0, 0, 0, 256);
    bg.addColorStop(0, dark ? '#3b2a1c' : '#4a3624');
    bg.addColorStop(1, dark ? '#2a1c12' : '#3a2818');
    g.fillStyle = bg;
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(20, 12, 6, 0.45)';
    g.lineWidth = 3;
    for (let y = 0; y < 256; y += 32) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(256, y);
      g.stroke();
      const shift = (y / 32) % 2 === 0 ? 0 : 32;
      for (let x = shift; x < 256; x += 64) {
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x, y + 32);
        g.stroke();
      }
    }
    g.fillStyle = 'rgba(180, 140, 70, 0.12)';
    for (let i = 0; i < 18; i += 1) {
      g.fillRect((i * 73) % 240, (i * 47) % 240, 22, 10);
    }
    return canvas;
  }

  function makeFloorCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const g = canvas.getContext('2d');
    if (!g) return canvas;
    g.fillStyle = '#1f1710';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(90, 70, 40, 0.35)';
    g.lineWidth = 2;
    for (let i = 0; i <= 8; i += 1) {
      g.beginPath();
      g.moveTo(i * 32, 0);
      g.lineTo(i * 32, 256);
      g.stroke();
      g.beginPath();
      g.moveTo(0, i * 32);
      g.lineTo(256, i * 32);
      g.stroke();
    }
    return canvas;
  }

  function collectWallSpecs(maze) {
    const specs = [];
    function add(x0, z0, x1, z1, inward) {
      const midX = (x0 + x1) / 2;
      const midZ = (z0 + z1) / 2;
      const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
      const len = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
      specs.push({
        x0, z0, x1, z1,
        midX, midZ,
        alongX,
        len: Math.max(CELL - WALL_T * 0.15, len),
        inward,
      });
    }
    for (let z = 0; z < maze.rows; z += 1) {
      for (let x = 0; x < maze.cols; x += 1) {
        const cell = maze.cells[z][x];
        if (cell.n) add(x * CELL, z * CELL, (x + 1) * CELL, z * CELL, { x: 0, z: 1 });
        if (cell.w) add(x * CELL, z * CELL, x * CELL, (z + 1) * CELL, { x: 1, z: 0 });
        if (z === maze.rows - 1 && cell.s) {
          add(x * CELL, (z + 1) * CELL, (x + 1) * CELL, (z + 1) * CELL, { x: 0, z: -1 });
        }
        if (x === maze.cols - 1 && cell.e) {
          add((x + 1) * CELL, z * CELL, (x + 1) * CELL, (z + 1) * CELL, { x: -1, z: 0 });
        }
      }
    }
    return specs;
  }

  function createWalkLabyrinth(el, spec) {
    const THREE = window.THREE;
    const viewport = el.querySelector('.labyrinth-viewport');
    const canvas = el.querySelector('.labyrinth-canvas');
    const captionEl = el.querySelector('.labyrinth-caption');
    const mobileHintEl = el.querySelector('.labyrinth-hint--mobile');
    const demoBtn = el.querySelector('[data-action="walk-demo"]');
    if (!viewport || !canvas) return null;

    const photos = spec.photos || [];
    const size = mazeSize(photos.length);
    const seed = hashSeed(photos.map(p => p.src).join('|') || spec.title || 'labyrinth');
    const maze = generateMaze(size.cols, size.rows, seed);
    const wallSpecs = collectWallSpecs(maze);
    const solution = solvePath(maze);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x120e0a);
    scene.fog = new THREE.Fog(0x120e0a, 10, 34);

    const camera = new THREE.PerspectiveCamera(FOV_DEFAULT, 1, 0.08, 80);
    const start = cellCenter(0, 0);
    camera.position.set(start.x, EYE_Y, start.z);

    scene.add(new THREE.AmbientLight(0xfff1d6, 0.42));
    const hemi = new THREE.HemisphereLight(0xffe6c2, 0x1a120c, 0.55);
    scene.add(hemi);
    const torch = new THREE.SpotLight(0xfff3d0, 2.4, 16, Math.PI / 5.5, 0.45, 1);
    torch.position.set(0, 0.12, 0.08);
    const torchTarget = new THREE.Object3D();
    torchTarget.position.set(0, -0.05, -6);
    camera.add(torch);
    camera.add(torchTarget);
    torch.target = torchTarget;
    scene.add(camera);

    const floorTex = new THREE.CanvasTexture(makeFloorCanvas());
    floorTex.colorSpace = THREE.SRGBColorSpace;
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(maze.cols * 2, maze.rows * 2);
    const worldW = maze.cols * CELL;
    const worldD = maze.rows * CELL;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(worldW + 2, worldD + 2),
      new THREE.MeshStandardMaterial({ map: floorTex, color: 0xffffff, roughness: 0.95, metalness: 0.02 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(worldW / 2, 0, worldD / 2);
    scene.add(floor);

    const ceil = new THREE.Mesh(
      new THREE.PlaneGeometry(worldW + 2, worldD + 2),
      new THREE.MeshStandardMaterial({ color: 0x1a140f, roughness: 1, metalness: 0 }),
    );
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(worldW / 2, WALL_H, worldD / 2);
    scene.add(ceil);

    const placeholderCanvases = [makePlaceholderCanvas(0), makePlaceholderCanvas(1)];
    const placeholderTex = placeholderCanvases.map((c) => {
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    });

    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    const mediaNodes = [];
    const colliders = [];
    const wallEntries = [];

    wallSpecs.forEach((ws, i) => {
      const photo = photos.length ? photos[i % photos.length] : null;
      const geom = ws.alongX
        ? new THREE.BoxGeometry(ws.len, WALL_H, WALL_T)
        : new THREE.BoxGeometry(WALL_T, WALL_H, ws.len);
      const mat = new THREE.MeshStandardMaterial({
        map: placeholderTex[i % placeholderTex.length],
        color: 0xffffff,
        roughness: 0.72,
        metalness: 0.04,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(ws.midX, WALL_H / 2, ws.midZ);
      scene.add(mesh);

      const hx = ws.alongX ? ws.len / 2 : WALL_T / 2;
      const hz = ws.alongX ? WALL_T / 2 : ws.len / 2;
      colliders.push({
        minX: ws.midX - hx,
        maxX: ws.midX + hx,
        minZ: ws.midZ - hz,
        maxZ: ws.midZ + hz,
      });

      const entry = {
        mesh,
        mat,
        photo,
        ws,
        kind: photo?.kind === 'video' || (photo && isVideoSrc(photo.src)) ? 'video' : 'image',
        video: null,
        texture: null,
        index: i,
      };
      wallEntries.push(entry);

      if (!photo) return;
      const url = resolveMediaHref(photo.src);
      if (entry.kind === 'video') {
        const video = document.createElement('video');
        video.src = url;
        video.crossOrigin = 'anonymous';
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        const tex = new THREE.VideoTexture(video);
        tex.colorSpace = THREE.SRGBColorSpace;
        mat.map = tex;
        mat.needsUpdate = true;
        entry.video = video;
        entry.texture = tex;
        video.play().catch(() => {});
        mediaNodes.push(video);
        return;
      }
      loader.load(url, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        mat.map = tex;
        mat.needsUpdate = true;
        entry.texture = tex;
      }, undefined, () => {});
    });

    const exitPos = cellCenter(maze.cols - 1, maze.rows - 1);
    const exitGlow = new THREE.PointLight(0xfbbf24, 1.15, 7);
    exitGlow.position.set(exitPos.x, 1.4, exitPos.z);
    scene.add(exitGlow);
    const exitMark = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.22, 0.12, 16),
      new THREE.MeshStandardMaterial({
        color: 0xfbbf24,
        emissive: 0xf59e0b,
        emissiveIntensity: 0.85,
        roughness: 0.4,
      }),
    );
    exitMark.position.set(exitPos.x, 0.08, exitPos.z);
    scene.add(exitMark);

    const keys = Object.create(null);
    let yaw = 0;
    if (solution.length >= 2) {
      const a = cellCenter(solution[0].x, solution[0].z);
      const b = cellCenter(solution[1].x, solution[1].z);
      yaw = Math.atan2(b.x - a.x, b.z - a.z);
    }
    const startYaw = yaw;
    let pitch = 0;
    let fov = FOV_DEFAULT;
    let locked = false;
    let raf = 0;
    let last = performance.now();
    let destroyed = false;
    let tour = null;
    let entered = false;
    let ignoreNextLookClick = false;

    function setFov(next) {
      fov = Math.max(42, Math.min(95, next));
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

    function lerpAngle(a, b, t) {
      let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (d < -Math.PI) d += Math.PI * 2;
      return a + d * t;
    }

    function yawToward(fromX, fromZ, toX, toZ) {
      return Math.atan2(toX - fromX, toZ - fromZ);
    }

    function resolveCollision(x, z) {
      let px = x;
      let pz = z;
      for (let n = 0; n < 3; n += 1) {
        colliders.forEach((w) => {
          const nx = Math.max(w.minX, Math.min(px, w.maxX));
          const nz = Math.max(w.minZ, Math.min(pz, w.maxZ));
          const dx = px - nx;
          const dz = pz - nz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= PLAYER_R * PLAYER_R) return;
          const d = Math.sqrt(d2) || 0.0001;
          const push = (PLAYER_R - d) / d;
          px += dx * push;
          pz += dz * push;
        });
      }
      px = Math.max(PLAYER_R, Math.min(worldW - PLAYER_R, px));
      pz = Math.max(PLAYER_R, Math.min(worldD - PLAYER_R, pz));
      return { x: px, z: pz };
    }

    function nearestPhotoWall() {
      let best = null;
      let bestDist = Infinity;
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      wallEntries.forEach((entry) => {
        if (!entry.photo) return;
        const to = new THREE.Vector3(entry.ws.midX - camera.position.x, 0, entry.ws.midZ - camera.position.z);
        const dist = to.length();
        if (dist > 4.2) return;
        const align = to.normalize().dot(new THREE.Vector3(dir.x, 0, dir.z).normalize());
        if (align > 0.35 && dist < bestDist) {
          bestDist = dist;
          best = entry;
        }
      });
      return best;
    }

    function nearestCaption() {
      if (!captionEl) return;
      const near = nearestPhotoWall();
      if (near?.photo) {
        captionEl.textContent = near.photo.label
          || (near.kind === 'video' ? 'Video' : 'Photo');
        return;
      }
      const dx = camera.position.x - exitPos.x;
      const dz = camera.position.z - exitPos.z;
      if (dx * dx + dz * dz < 2.4) {
        captionEl.textContent = 'Exit';
        return;
      }
      if (!photos.length) {
        captionEl.textContent = 'Empty maze — paste photos for the walls';
        return;
      }
      captionEl.textContent = '';
    }

    function photoLookAtCell(cx, cz) {
      const c = cellCenter(cx, cz);
      let best = null;
      let bestD = Infinity;
      wallEntries.forEach((entry) => {
        if (!entry.photo) return;
        const dx = entry.ws.midX - c.x;
        const dz = entry.ws.midZ - c.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD && d2 < (CELL * 0.85) * (CELL * 0.85)) {
          bestD = d2;
          best = entry;
        }
      });
      return best;
    }

    function buildTourWaypoints() {
      const pts = [];
      const path = solution.slice();
      const seenPhotos = new Set();
      if (path.length < 2) {
        const c = cellCenter(0, 0);
        pts.push({ x: c.x, z: c.z, yaw: startYaw, pitch: 0, hold: 0.6, fov: FOV_DEFAULT, travel: 0.8 });
        return pts;
      }
      path.forEach((cell, i) => {
        const pos = cellCenter(cell.x, cell.z);
        const next = path[i + 1];
        const prev = path[i - 1];
        const look = next
          ? yawToward(pos.x, pos.z, cellCenter(next.x, next.z).x, cellCenter(next.x, next.z).z)
          : (prev
            ? yawToward(cellCenter(prev.x, prev.z).x, cellCenter(prev.x, prev.z).z, pos.x, pos.z)
            : startYaw);
        pts.push({
          x: pos.x,
          z: pos.z,
          yaw: look,
          pitch: 0,
          hold: i === 0 ? 0.45 : 0.12,
          fov: FOV_DEFAULT,
          travel: i === 0 ? 0.9 : 0.72,
        });
        const photoWall = photoLookAtCell(cell.x, cell.z);
        const photoKey = photoWall?.photo?.src;
        if (photoWall && photoKey && !seenPhotos.has(photoKey) && i > 0) {
          seenPhotos.add(photoKey);
          const lookYaw = yawToward(pos.x, pos.z, photoWall.ws.midX, photoWall.ws.midZ);
          pts.push({
            x: pos.x,
            z: pos.z,
            yaw: lookYaw,
            pitch: -0.04,
            hold: photoWall.kind === 'video' ? 3.4 : 1.7,
            fov: FOV_LOOK,
            travel: 0.55,
          });
          pts.push({
            x: pos.x,
            z: pos.z,
            yaw: look,
            pitch: 0,
            hold: 0.12,
            fov: FOV_DEFAULT,
            travel: 0.4,
          });
        }
      });
      const end = cellCenter(maze.cols - 1, maze.rows - 1);
      pts.push({ x: end.x, z: end.z, yaw: Math.PI / 2, pitch: -0.08, hold: 1.1, fov: 62, travel: 0.7 });
      pts.push({ x: end.x, z: end.z, yaw: Math.PI, pitch: 0, hold: 0.35, fov: FOV_DEFAULT, travel: 0.55 });
      const back = path.slice().reverse();
      back.forEach((cell, i) => {
        if (i === 0) return;
        const pos = cellCenter(cell.x, cell.z);
        const next = back[i + 1];
        const look = next
          ? yawToward(pos.x, pos.z, cellCenter(next.x, next.z).x, cellCenter(next.x, next.z).z)
          : Math.PI;
        pts.push({
          x: pos.x,
          z: pos.z,
          yaw: look,
          pitch: 0,
          hold: 0.08,
          fov: FOV_DEFAULT,
          travel: 0.62,
        });
      });
      const home = cellCenter(0, 0);
      pts.push({ x: home.x, z: home.z, yaw: startYaw, pitch: 0, hold: 0.7, fov: FOV_DEFAULT, travel: 0.8 });
      return pts;
    }

    function stopTour() {
      if (tour) tour.active = false;
      tour = null;
      syncDemoButton();
    }

    function startTour() {
      if (document.pointerLockElement === canvas) document.exitPointerLock();
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
      if (captionEl && !photos.length) {
        captionEl.textContent = 'Demo tour · paste photos to texture the walls';
      }
    }

    function toggleTour() {
      if (tour?.active) stopTour();
      else startTour();
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
        const dur = Math.max(0.28, wp.travel || 0.8);
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
      if (tour.t < (wp.hold || 0.15)) return;
      tour.index += 1;
      if (tour.index >= tour.waypoints.length) tour.index = 0;
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

    function resetPose() {
      stopTour();
      const home = cellCenter(0, 0);
      camera.position.set(home.x, EYE_Y, home.z);
      yaw = startYaw;
      pitch = 0;
      setFov(FOV_DEFAULT);
      if (captionEl) captionEl.textContent = photos.length ? '' : 'Empty maze — paste photos for the walls';
    }

    function resize() {
      const w = viewport.clientWidth || 640;
      const h = viewport.clientHeight || 420;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    }

    function tick(now) {
      if (destroyed) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (tour?.active) {
        advanceTour(dt);
      } else {
        const speed = (keys.ShiftLeft || keys.ShiftRight ? 4.4 : 2.55) * dt;
        const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
        const move = new THREE.Vector3();
        if (keys.KeyW || keys.ArrowUp) move.add(forward);
        if (keys.KeyS || keys.ArrowDown) move.sub(forward);
        if (keys.KeyA || keys.ArrowLeft) move.sub(right);
        if (keys.KeyD || keys.ArrowRight) move.add(right);
        if (move.lengthSq() > 0) {
          move.normalize().multiplyScalar(speed);
          const next = resolveCollision(camera.position.x + move.x, camera.position.z + move.z);
          camera.position.x = next.x;
          camera.position.z = next.z;
        }
      }

      camera.position.y = EYE_Y;
      camera.rotation.order = 'YXZ';
      camera.rotation.y = yaw + YAW_LOOK;
      camera.rotation.x = pitch;
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
      pitch = Math.max(-1.15, Math.min(1.15, pitch));
    }

    function onWheel(e) {
      e.preventDefault();
      setFov(fov + (e.deltaY > 0 ? 4.5 : -4.5));
    }

    function enterMaze({ startDemo = false, stopTourIfActive = false, lockPointer = false } = {}) {
      if (stopTourIfActive && tour?.active) stopTour();
      viewport.focus({ preventScroll: true });
      if (lockPointer) canvas.requestPointerLock?.();
      if (startDemo && spec.demo && !tour?.active) startTour();
      entered = true;
      if (isLabyrinthMobile() && mobileHintEl) {
        mobileHintEl.textContent = 'Drag to look · Demo tour auto-walks';
      }
    }

    function requestLook() {
      if (ignoreNextLookClick) {
        ignoreNextLookClick = false;
        return;
      }
      enterMaze({ startDemo: false, stopTourIfActive: true, lockPointer: !isLabyrinthMobile() });
    }

    let dragLook = null;
    function onPointerDownLook(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (isLabyrinthMobile() && !entered) {
        enterMaze({ startDemo: !!spec.demo, stopTourIfActive: false, lockPointer: false });
        ignoreNextLookClick = true;
        return;
      }
      if (tour?.active) stopTour();
      viewport.focus({ preventScroll: true });
      if (document.pointerLockElement === canvas) return;
      dragLook = { id: e.pointerId, x: e.clientX, y: e.clientY, dist: 0 };
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
      yaw -= dx * 0.0045;
      pitch -= dy * 0.0045;
      pitch = Math.max(-1.15, Math.min(1.15, pitch));
    }
    function onPointerUpLook(e) {
      if (!dragLook || e.pointerId !== dragLook.id) return;
      dragLook = null;
    }
    function onPointerCancelLook(e) {
      if (!dragLook || e.pointerId !== dragLook.id) return;
      dragLook = null;
    }

    function onLockChange() {
      locked = document.pointerLockElement === canvas;
      viewport.classList.toggle('labyrinth-viewport--locked', locked);
    }

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
    window.addEventListener('resize', resize);
    el.addEventListener('notespro:monitor-fullscreen', () => {
      requestAnimationFrame(resize);
    });

    resize();
    raf = requestAnimationFrame(tick);
    syncDemoButton();
    if (spec.demo) {
      requestAnimationFrame(() => startTour());
    } else if (!photos.length) {
      setStatus(el, 'Paste photos (Ctrl+V) — they become the maze walls.');
    }

    return {
      focus: requestLook,
      toggleTour,
      startTour,
      stopTour,
      reset: resetPose,
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
    if (!el || el.dataset.labyrinthHydrated === '1') return;
    const spec = decodeSpec(el.dataset.labyrinthSpec);
    if (!spec) return;
    el.dataset.labyrinthHydrated = '1';
    bindFullscreenButton(el);

    let walk = null;
    if (threeReady()) {
      walk = createWalkLabyrinth(el, spec);
    } else {
      setStatus(el, 'Three.js not loaded — labyrinth unavailable.');
    }

    const disconnectObs = new MutationObserver(() => {
      if (!el.isConnected) {
        walk?.destroy();
        disconnectObs.disconnect();
      }
    });
    disconnectObs.observe(document.body, { childList: true, subtree: true });

    el.addEventListener('click', (e) => {
      if (e.target.closest('.game-fullscreen-btn')) return;
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'walk-focus') {
        walk?.focus();
        return;
      }
      if (action === 'walk-demo') {
        walk?.toggleTour();
        return;
      }
      if (action === 'reset-maze') {
        walk?.reset();
        return;
      }
      if (action === 'add-photo') {
        setStatus(el, 'Paste an image (Ctrl+V) or drop a file onto the maze.');
        el.focus({ preventScroll: true });
      }
    });

    if (typeof options.onPasteImage !== 'function') return;

    async function handlePasteFiles(files) {
      const imageFiles = [...files].filter(f => f && String(f.type || '').startsWith('image/'));
      if (!imageFiles.length) return;
      el.classList.add('labyrinth-block--uploading');
      setStatus(el, 'Uploading…');
      try {
        for (const file of imageFiles) {
          await options.onPasteImage(file, spec);
        }
      } finally {
        el.classList.remove('labyrinth-block--uploading');
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
      el.classList.add('labyrinth-block--drop');
    });
    el.addEventListener('dragleave', () => el.classList.remove('labyrinth-block--drop'));
    el.addEventListener('drop', (e) => {
      el.classList.remove('labyrinth-block--drop');
      const files = [...(e.dataTransfer?.files || [])].filter(f => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      e.stopPropagation();
      void handlePasteFiles(files);
    });
  }

  function hydrate(root) {
    (root || document).querySelectorAll('.labyrinth-block[data-labyrinth-spec]').forEach(hydrateBlock);
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
