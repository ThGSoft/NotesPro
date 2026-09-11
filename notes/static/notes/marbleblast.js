/**
 * NotesPro ```marbleblast``` block — marble rolling platformer
 * inspired by Marble Blast Ultra (original courses, not a copy of MBU assets).
 */
(function (root, factory) {
  const api = factory();
  root.NotesProMarbleblast = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];
  const MARBLE_R = 0.42;
  const GRAVITY = -28;
  const ACCEL = 34;
  const AIR_ACCEL = 12;
  const FRICTION = 6.2;
  const AIR_DRAG = 0.35;
  const MAX_SPEED = 16;
  const JUMP = 9.4;
  const REST = 0.22;

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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

  function resolveFullscreen(cfg) {
    const raw = String(cfg.fullscreen ?? cfg.full ?? '1').trim().toLowerCase();
    if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'compact') return false;
    return true;
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

  function plat(x, y, z, w, h, d, color, kind) {
    return { x, y, z, w, h, d, color: color || 0x3b82f6, kind: kind || 'solid' };
  }

  function COURSES() {
    return [
      {
        name: 'Beginner Park',
        start: { x: 0, y: 1.2, z: 0 },
        platforms: [
          plat(0, 0, 0, 10, 0.7, 10, 0x2563eb),
          plat(9, 0.5, 0, 6, 0.6, 4, 0x0ea5e9),
          plat(16, 1.1, 0, 6, 0.6, 4, 0x22c55e),
          plat(23, 1.6, 2, 5, 0.6, 5, 0xa3e635),
          plat(23, 1.6, -6, 4, 0.6, 4, 0xf59e0b),
          plat(30, 2.2, -6, 8, 0.7, 6, 0xf97316),
        ],
        gems: [
          { x: 9, y: 1.4, z: 0 },
          { x: 16, y: 2.0, z: 0 },
          { x: 23, y: 2.5, z: -6 },
        ],
        pads: [{ x: 23, y: 2.0, z: 2, kind: 'bounce' }],
        finish: { x: 32, y: 2.7, z: -6 },
      },
      {
        name: 'Sky Ramps',
        start: { x: 0, y: 1.3, z: 0 },
        platforms: [
          plat(0, 0, 0, 8, 0.7, 8, 0x7c3aed),
          plat(8, 1.2, 4, 7, 0.55, 2.4, 0x6366f1),
          plat(14, 2.4, 8, 6, 0.55, 2.4, 0x8b5cf6),
          plat(20, 3.4, 4, 5, 0.55, 5, 0xc084fc),
          plat(20, 3.4, -4, 3.2, 0.55, 8, 0x22d3ee),
          plat(20, 4.6, -12, 6, 0.7, 6, 0x38bdf8),
          plat(28, 5.4, -12, 7, 0.6, 3, 0x4ade80),
        ],
        gems: [
          { x: 8, y: 2.1, z: 4 },
          { x: 14, y: 3.3, z: 8 },
          { x: 20, y: 4.3, z: 0 },
          { x: 20, y: 5.5, z: -12 },
        ],
        pads: [
          { x: 20, y: 3.8, z: 4, kind: 'bounce' },
          { x: 20, y: 3.8, z: -8, kind: 'speed' },
        ],
        finish: { x: 30, y: 5.85, z: -12 },
      },
      {
        name: 'Helix Drop',
        start: { x: 0, y: 8.2, z: 0 },
        platforms: [
          plat(0, 7, 0, 6, 0.6, 6, 0x0f766e),
          plat(7, 6.2, 3, 5, 0.5, 3, 0x14b8a6),
          plat(12, 5.2, -1, 5, 0.5, 3, 0x2dd4bf),
          plat(7, 4.1, -6, 5, 0.5, 3, 0xfbbf24),
          plat(0, 3.0, -4, 5, 0.5, 4, 0xf97316),
          plat(-6, 2.0, 0, 5, 0.5, 4, 0xef4444),
          plat(0, 1.0, 5, 8, 0.7, 6, 0xdc2626),
          plat(10, 1.0, 5, 6, 0.6, 3, 0x7c3aed),
        ],
        gems: [
          { x: 7, y: 7.0, z: 3 },
          { x: 12, y: 6.0, z: -1 },
          { x: 7, y: 4.9, z: -6 },
          { x: -6, y: 2.8, z: 0 },
          { x: 0, y: 1.9, z: 5 },
        ],
        pads: [
          { x: 0, y: 3.4, z: -4, kind: 'bounce' },
          { x: 0, y: 1.45, z: 5, kind: 'speed' },
        ],
        finish: { x: 12, y: 1.45, z: 5 },
      },
    ];
  }

  function formatTime(ms) {
    const t = Math.max(0, Number(ms) || 0);
    const m = Math.floor(t / 60000);
    const s = Math.floor((t % 60000) / 1000);
    const d = Math.floor((t % 1000) / 100);
    return `${m}:${String(s).padStart(2, '0')}.${d}`;
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function renderBlock(source, fenceAttrs, options = {}) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const style = resolveStyle(cfg);
    const title = String(cfg.title || 'Marble blast').trim() || 'Marble blast';
    const marbleIndex = Number.isFinite(options.marbleblastIndex) ? options.marbleblastIndex : 0;
    const fullscreen = resolveFullscreen(cfg);
    const themeClass = style.theme ? ` marbleblast-block--${style.theme}` : '';
    const customClass = (style.colorCss || style.bgCss) ? ' marbleblast-block--custom' : '';
    const fullClass = fullscreen ? ' marbleblast-block--fullscreen' : '';
    const styleVars = [];
    if (style.colorCss) styleVars.push(`--marbleblast-accent:${style.colorCss}`);
    if (style.bgCss) styleVars.push(`--marbleblast-bg:${style.bgCss}`);
    const styleAttr = styleVars.length
      ? ` style="${styleVars.map((v) => escapeHtml(v)).join(';')}"`
      : '';
    const chrome = fullscreen ? '' : [
      `<div class="marbleblast-block-header">`,
      `<div class="marbleblast-block-title">${escapeHtml(title)}</div>`,
      `<div class="marbleblast-block-meta">roll · collect gems · hit the finish pad</div>`,
      `</div>`,
      `<p class="marbleblast-block-hint">WASD / arrows roll · Space jump · drag to look · R restart · [ ] course</p>`,
    ].join('');
    return [
      `<div class="marbleblast-block${themeClass}${customClass}${fullClass}"${styleAttr}`,
      ` data-marbleblast-index="${marbleIndex}"`,
      ` data-marbleblast-course="${escapeHtml(String(cfg.course || ''))}" tabindex="0">`,
      renderFullscreenButton(),
      chrome,
      `<div class="marbleblast-stage">`,
      `<canvas class="marbleblast-canvas" aria-label="${escapeHtml(title)}"></canvas>`,
      `<div class="marbleblast-hud">`,
      `<span data-role="mb-time">0:00.0</span>`,
      `<span data-role="mb-gems"></span>`,
      `<span data-role="mb-course"></span>`,
      `</div>`,
      `</div>`,
      `<div class="marbleblast-toolbar">`,
      `<button type="button" class="btn btn-sm btn-outline-light" data-act="restart">Restart</button>`,
      `<button type="button" class="btn btn-sm btn-outline-light" data-act="prev">Prev course</button>`,
      `<button type="button" class="btn btn-sm btn-outline-light" data-act="next">Next course</button>`,
      `</div>`,
      `<div class="marbleblast-pad" aria-label="Marble controls">`,
      `<button type="button" class="marbleblast-pad__btn marbleblast-pad__btn--w" data-key="KeyW" tabindex="-1">W</button>`,
      `<button type="button" class="marbleblast-pad__btn marbleblast-pad__btn--a" data-key="KeyA" tabindex="-1">A</button>`,
      `<button type="button" class="marbleblast-pad__btn marbleblast-pad__btn--s" data-key="KeyS" tabindex="-1">S</button>`,
      `<button type="button" class="marbleblast-pad__btn marbleblast-pad__btn--d" data-key="KeyD" tabindex="-1">D</button>`,
      `<button type="button" class="marbleblast-pad__btn marbleblast-pad__btn--jump" data-key="Space" tabindex="-1">Jump</button>`,
      `</div>`,
      `<div class="marbleblast-status" aria-live="polite">Click to roll</div>`,
      `</div>`,
    ].join('');
  }

  function collideSphereBox(px, py, pz, r, box) {
    const minx = box.x - box.w / 2;
    const maxx = box.x + box.w / 2;
    const miny = box.y;
    const maxy = box.y + box.h;
    const minz = box.z - box.d / 2;
    const maxz = box.z + box.d / 2;
    const cx = clamp(px, minx, maxx);
    const cy = clamp(py, miny, maxy);
    const cz = clamp(pz, minz, maxz);
    let dx = px - cx;
    let dy = py - cy;
    let dz = pz - cz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > r * r && d2 > 1e-8) return null;
    if (d2 < 1e-8) {
      const left = px - minx;
      const right = maxx - px;
      const down = py - miny;
      const up = maxy - py;
      const back = pz - minz;
      const fwd = maxz - pz;
      const m = Math.min(left, right, down, up, back, fwd);
      if (m === up) return { nx: 0, ny: 1, nz: 0, pen: r + 0.02 };
      if (m === down) return { nx: 0, ny: -1, nz: 0, pen: r + 0.02 };
      if (m === left) return { nx: -1, ny: 0, nz: 0, pen: r + 0.02 };
      if (m === right) return { nx: 1, ny: 0, nz: 0, pen: r + 0.02 };
      if (m === back) return { nx: 0, ny: 0, nz: -1, pen: r + 0.02 };
      return { nx: 0, ny: 0, nz: 1, pen: r + 0.02 };
    }
    const d = Math.sqrt(d2);
    return { nx: dx / d, ny: dy / d, nz: dz / d, pen: r - d };
  }

  function createGame(el, cfg) {
    const THREE = window.THREE;
    const viewport = el.querySelector('.marbleblast-stage');
    const canvas = el.querySelector('.marbleblast-canvas');
    const status = el.querySelector('.marbleblast-status');
    const timeEl = el.querySelector('[data-role="mb-time"]');
    const gemsEl = el.querySelector('[data-role="mb-gems"]');
    const courseEl = el.querySelector('[data-role="mb-course"]');
    const pad = el.querySelector('.marbleblast-pad');
    if (!viewport || !canvas) return null;

    const courses = COURSES();
    let courseIndex = Math.max(0, Math.min(courses.length - 1, parseInt(cfg.course, 10) - 1 || 0));
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x7dd3fc);
    scene.fog = new THREE.Fog(0x7dd3fc, 28, 90);
    const camera = new THREE.PerspectiveCamera(62, 1, 0.08, 160);
    scene.add(new THREE.HemisphereLight(0xf0f9ff, 0x334155, 0.95));
    const sun = new THREE.DirectionalLight(0xfff7ed, 1.15);
    sun.position.set(12, 22, 8);
    scene.add(sun);

    const marbleMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      metalness: 0.72,
      roughness: 0.18,
      emissive: 0x334155,
      emissiveIntensity: 0.08,
    });
    const marble = new THREE.Mesh(new THREE.SphereGeometry(MARBLE_R, 28, 20), marbleMat);
    scene.add(marble);
    const stripe = new THREE.Mesh(
      new THREE.TorusGeometry(MARBLE_R * 0.82, 0.045, 8, 28),
      new THREE.MeshStandardMaterial({ color: 0x0ea5e9, metalness: 0.4, roughness: 0.3 }),
    );
    marble.add(stripe);

    const world = { platforms: [], gems: [], pads: [], finish: null, solids: [] };
    const keys = Object.create(null);
    const body = {
      x: 0, y: 2, z: 0,
      vx: 0, vy: 0, vz: 0,
      grounded: false,
      spin: 0,
    };
    const run = {
      startedAt: 0,
      elapsed: 0,
      running: false,
      won: false,
      reported: false,
      gems: 0,
      gemNeed: 0,
      falls: 0,
    };
    let camYaw = 0.4;
    let camPitch = 0.42;
    let destroyed = false;
    let raf = 0;
    let last = performance.now();
    let drag = null;
    let jumpQueued = false;

    function setStatus(text) {
      if (status) status.textContent = text || '';
    }

    function paintHud() {
      const elapsed = run.running ? performance.now() - run.startedAt : run.elapsed;
      if (timeEl) timeEl.textContent = formatTime(elapsed);
      if (gemsEl) gemsEl.textContent = `Gems ${run.gems}/${run.gemNeed}`;
      if (courseEl) courseEl.textContent = courses[courseIndex].name;
    }

    function clearWorld() {
      world.solids.forEach((m) => {
        scene.remove(m);
        m.geometry?.dispose?.();
        if (Array.isArray(m.material)) m.material.forEach((x) => x.dispose?.());
        else m.material?.dispose?.();
      });
      world.solids.length = 0;
      world.platforms = [];
      world.gems = [];
      world.pads = [];
      world.finish = null;
    }

    function addBoxMesh(box) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(box.w, box.h, box.d),
        new THREE.MeshStandardMaterial({
          color: box.color,
          roughness: 0.55,
          metalness: 0.12,
        }),
      );
      mesh.position.set(box.x, box.y + box.h / 2, box.z);
      scene.add(mesh);
      world.solids.push(mesh);
      return mesh;
    }

    function loadCourse(index) {
      courseIndex = ((index % courses.length) + courses.length) % courses.length;
      const course = courses[courseIndex];
      clearWorld();
      world.platforms = course.platforms.slice();
      world.platforms.forEach(addBoxMesh);
      world.gems = (course.gems || []).map((g) => {
        const mesh = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.32, 0),
          new THREE.MeshStandardMaterial({
            color: 0x22d3ee,
            emissive: 0x0891b2,
            emissiveIntensity: 0.7,
            metalness: 0.3,
            roughness: 0.25,
          }),
        );
        mesh.position.set(g.x, g.y, g.z);
        scene.add(mesh);
        world.solids.push(mesh);
        return { ...g, mesh, taken: false };
      });
      world.pads = (course.pads || []).map((p) => {
        const mesh = new THREE.Mesh(
          new THREE.CylinderGeometry(0.7, 0.7, 0.16, 20),
          new THREE.MeshStandardMaterial({
            color: p.kind === 'speed' ? 0xf97316 : 0x4ade80,
            emissive: p.kind === 'speed' ? 0x9a3412 : 0x166534,
            emissiveIntensity: 0.55,
          }),
        );
        mesh.position.set(p.x, p.y, p.z);
        scene.add(mesh);
        world.solids.push(mesh);
        return { ...p, mesh };
      });
      const fin = new THREE.Mesh(
        new THREE.CylinderGeometry(1.05, 1.05, 0.18, 24),
        new THREE.MeshStandardMaterial({
          color: 0xfacc15,
          emissive: 0x854d0e,
          emissiveIntensity: 0.7,
        }),
      );
      fin.position.set(course.finish.x, course.finish.y, course.finish.z);
      scene.add(fin);
      world.solids.push(fin);
      world.finish = course.finish;
      run.gemNeed = world.gems.length;
      run.gems = 0;
      run.falls = 0;
      run.won = false;
      run.reported = false;
      run.running = false;
      run.startedAt = 0;
      run.elapsed = 0;
      spawn();
      paintHud();
      setStatus(`${course.name} · collect ${run.gemNeed} gems, then roll onto the gold pad`);
    }

    function spawn() {
      const s = courses[courseIndex].start;
      body.x = s.x;
      body.y = s.y;
      body.z = s.z;
      body.vx = 0;
      body.vy = 0;
      body.vz = 0;
      body.grounded = false;
      marble.position.set(body.x, body.y, body.z);
    }

    function startTimer() {
      if (run.won || run.running) return;
      run.running = true;
      run.startedAt = performance.now();
    }

    function win() {
      if (run.won) return;
      run.won = true;
      run.running = false;
      run.elapsed = performance.now() - (run.startedAt || performance.now());
      const ms = Math.floor(run.elapsed);
      const score = Math.max(100, 1_000_000 - ms - run.falls * 4000 + run.gems * 2500);
      if (!run.reported) {
        run.reported = true;
        window.NotesProHighscores?.submit?.('marbleblast', score, {
          time: Math.floor(ms / 1000),
          gems: run.gems,
          course: courseIndex + 1,
          falls: run.falls,
        });
      }
      paintHud();
      setStatus(`Finish ${formatTime(run.elapsed)} · ${score} pts · Next course or R retry`);
    }

    function respawn() {
      run.falls += 1;
      spawn();
      setStatus(`OOB · falls ${run.falls} · keep rolling`);
    }

    function resize() {
      const w = viewport.clientWidth || 720;
      const h = viewport.clientHeight || 420;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    }

    function step(dt) {
      const yaw = camYaw;
      const fwdX = Math.sin(yaw);
      const fwdZ = Math.cos(yaw);
      const rightX = Math.cos(yaw);
      const rightZ = -Math.sin(yaw);
      let ax = 0;
      let az = 0;
      if (keys.KeyW || keys.ArrowUp) {
        ax += fwdX;
        az += fwdZ;
      }
      if (keys.KeyS || keys.ArrowDown) {
        ax -= fwdX;
        az -= fwdZ;
      }
      if (keys.KeyA || keys.ArrowLeft) {
        ax -= rightX;
        az -= rightZ;
      }
      if (keys.KeyD || keys.ArrowRight) {
        ax += rightX;
        az += rightZ;
      }
      const accel = body.grounded ? ACCEL : AIR_ACCEL;
      if (ax || az) {
        startTimer();
        const len = Math.hypot(ax, az) || 1;
        body.vx += (ax / len) * accel * dt;
        body.vz += (az / len) * accel * dt;
      }
      body.vy += GRAVITY * dt;
      const speed = Math.hypot(body.vx, body.vz);
      if (speed > MAX_SPEED) {
        body.vx *= MAX_SPEED / speed;
        body.vz *= MAX_SPEED / speed;
      }
      const drag = body.grounded ? FRICTION : AIR_DRAG;
      const damp = Math.max(0, 1 - drag * dt);
      if (!ax && !az) {
        body.vx *= damp;
        body.vz *= damp;
      } else {
        body.vx *= Math.max(0.82, damp);
        body.vz *= Math.max(0.82, damp);
      }

      if (jumpQueued && body.grounded) {
        startTimer();
        body.vy = JUMP;
        body.grounded = false;
      }
      jumpQueued = false;

      body.x += body.vx * dt;
      body.y += body.vy * dt;
      body.z += body.vz * dt;
      body.grounded = false;

      for (let n = 0; n < 3; n += 1) {
        world.platforms.forEach((box) => {
          const hit = collideSphereBox(body.x, body.y, body.z, MARBLE_R, box);
          if (!hit) return;
          body.x += hit.nx * hit.pen;
          body.y += hit.ny * hit.pen;
          body.z += hit.nz * hit.pen;
          const vn = body.vx * hit.nx + body.vy * hit.ny + body.vz * hit.nz;
          if (vn < 0) {
            body.vx -= (1 + REST) * vn * hit.nx;
            body.vy -= (1 + REST) * vn * hit.ny;
            body.vz -= (1 + REST) * vn * hit.nz;
          }
          if (hit.ny > 0.45) {
            body.grounded = true;
            if (body.vy < 0) body.vy = 0;
          }
        });
      }

      world.pads.forEach((p) => {
        const dx = body.x - p.x;
        const dz = body.z - p.z;
        if (dx * dx + dz * dz > 0.85 * 0.85) return;
        if (Math.abs(body.y - p.y) > 0.7) return;
        if (p.kind === 'bounce') body.vy = Math.max(body.vy, 13.5);
        if (p.kind === 'speed') {
          const sp = Math.hypot(body.vx, body.vz) || 1;
          body.vx = (body.vx / sp) * 22;
          body.vz = (body.vz / sp) * 22;
        }
      });

      world.gems.forEach((g) => {
        if (g.taken) return;
        const dx = body.x - g.x;
        const dy = body.y - g.y;
        const dz = body.z - g.z;
        if (dx * dx + dy * dy + dz * dz < 0.7 * 0.7) {
          g.taken = true;
          g.mesh.visible = false;
          run.gems += 1;
          paintHud();
        }
      });

      if (world.finish && run.gems >= run.gemNeed && !run.won) {
        const dx = body.x - world.finish.x;
        const dz = body.z - world.finish.z;
        if (dx * dx + dz * dz < 1.15 * 1.15 && Math.abs(body.y - world.finish.y) < 1.1) {
          win();
        }
      }

      if (body.y < -6) respawn();

      marble.position.set(body.x, body.y, body.z);
      const v = Math.hypot(body.vx, body.vz);
      body.spin += v * dt * 2.4;
      marble.rotation.z = -body.spin;
      marble.rotation.x = body.spin * 0.35;
      world.gems.forEach((g) => {
        if (g.taken) return;
        g.mesh.rotation.y += dt * 2.2;
        g.mesh.position.y = g.y + Math.sin(performance.now() / 280 + g.x) * 0.08;
      });
    }

    function placeCamera() {
      const dist = 6.4;
      const height = 2.8;
      const cx = body.x - Math.sin(camYaw) * dist * Math.cos(camPitch);
      const cz = body.z - Math.cos(camYaw) * dist * Math.cos(camPitch);
      const cy = body.y + height + Math.sin(camPitch) * 2.2;
      camera.position.set(cx, cy, cz);
      camera.lookAt(body.x, body.y + 0.3, body.z);
    }

    function tick(now) {
      if (destroyed) return;
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      if (!run.won) step(dt);
      else paintHud();
      if (run.running) paintHud();
      placeCamera();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    }

    function onKeyDown(e) {
      if (!el.contains(document.activeElement) && document.activeElement !== el) return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      keys[e.code] = true;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
      if (e.code === 'Space') jumpQueued = true;
      if (e.code === 'KeyR') loadCourse(courseIndex);
      if (e.code === 'BracketLeft' || e.code === 'Comma') loadCourse(courseIndex - 1);
      if (e.code === 'BracketRight' || e.code === 'Period') loadCourse(courseIndex + 1);
    }
    function onKeyUp(e) {
      keys[e.code] = false;
    }

    function onPointerDown(e) {
      el.focus({ preventScroll: true });
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    }
    function onPointerMove(e) {
      if (!drag || e.pointerId !== drag.id) return;
      camYaw -= (e.clientX - drag.x) * 0.006;
      camPitch = clamp(camPitch + (e.clientY - drag.y) * 0.004, -0.15, 0.9);
      drag.x = e.clientX;
      drag.y = e.clientY;
    }
    function onPointerUp(e) {
      if (drag && e.pointerId === drag.id) drag = null;
    }

    function syncPad() {
      if (!pad) return;
      const mobile = document.body.classList.contains('mobile-layout')
        || (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 768px)').matches);
      pad.classList.toggle('is-visible', mobile);
    }

    function bindPad() {
      if (!pad) return () => {};
      const held = new Map();
      const setKey = (code, down, btn) => {
        if (!code) return;
        keys[code] = !!down;
        btn?.classList.toggle('is-active', !!down);
        if (down && code === 'Space') jumpQueued = true;
      };
      const onDown = (event) => {
        const btn = event.currentTarget;
        const code = btn.getAttribute('data-key');
        event.preventDefault();
        try { btn.setPointerCapture(event.pointerId); } catch (_) { /* ignore */ }
        held.set(event.pointerId, { code, btn });
        setKey(code, true, btn);
      };
      const onUp = (event) => {
        const rec = held.get(event.pointerId);
        if (!rec) return;
        held.delete(event.pointerId);
        setKey(rec.code, false, rec.btn);
      };
      pad.querySelectorAll('[data-key]').forEach((btn) => {
        btn.addEventListener('pointerdown', onDown);
        btn.addEventListener('pointerup', onUp);
        btn.addEventListener('pointercancel', onUp);
      });
      return () => {
        pad.querySelectorAll('[data-key]').forEach((btn) => {
          btn.removeEventListener('pointerdown', onDown);
          btn.removeEventListener('pointerup', onUp);
          btn.removeEventListener('pointercancel', onUp);
        });
      };
    }

    const unbindPad = bindPad();
    el.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'restart') loadCourse(courseIndex);
      if (act === 'prev') loadCourse(courseIndex - 1);
      if (act === 'next') loadCourse(courseIndex + 1);
      if (act) el.focus({ preventScroll: true });
    });
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    const onResize = () => {
      resize();
      syncPad();
    };
    window.addEventListener('resize', onResize);
    el.addEventListener('notespro:monitor-fullscreen', () => requestAnimationFrame(resize));
    resize();
    syncPad();
    loadCourse(courseIndex);
    raf = requestAnimationFrame(tick);

    return {
      destroy() {
        destroyed = true;
        cancelAnimationFrame(raf);
        unbindPad();
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerUp);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('resize', onResize);
        clearWorld();
        renderer.dispose();
      },
    };
  }

  function hydrateBlock(el) {
    if (!el || el.dataset.marbleblastHydrated === '1') return;
    const cfg = parseFenceAttrs(el.dataset.marbleblastCourse ? `course=${el.dataset.marbleblastCourse}` : '');
    el.dataset.marbleblastHydrated = '1';
    bindFullscreenButton(el);
    whenThreeReady(
      () => {
        if (!el.isConnected) return;
        if (el._marbleGame?.destroy) el._marbleGame.destroy();
        el._marbleGame = createGame(el, cfg);
      },
      () => {
        const status = el.querySelector('.marbleblast-status');
        if (status) status.textContent = 'Three.js not loaded — marble blast unavailable.';
      },
    );
  }

  function hydrate(root) {
    (root || document).querySelectorAll('.marbleblast-block[data-marbleblast-index]').forEach((el) => {
      hydrateBlock(el);
    });
  }

  return {
    parseFenceAttrs,
    renderBlock,
    hydrateBlock,
    hydrate,
  };
}));
