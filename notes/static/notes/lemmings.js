/**
 * NotesPro ```lemmings``` block — Lemmings-style puzzle in preview.
 */
(function (root, factory) {
  const api = factory();
  root.NotesProLemmings = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];
  const TILE = 8;
  const COLS = 80;
  const ROWS = 36;
  const VIEW_W = COLS * TILE;
  const VIEW_H = ROWS * TILE;
  const WALK = 28;
  const FALL = 70;
  const FLOAT = 28;
  const SPLAT = 78;
  const LEM_W = 6;
  const LEM_H = 10;
  const SKILLS = [
    { id: 'blocker', label: 'Block', key: '1' },
    { id: 'builder', label: 'Build', key: '2' },
    { id: 'basher', label: 'Bash', key: '3' },
    { id: 'digger', label: 'Dig', key: '4' },
    { id: 'floater', label: 'Float', key: '5' },
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

  function buildLevel() {
    const g = Array.from({ length: ROWS }, () => Array(COLS).fill(' '));
    const set = (x, y, c) => {
      if (x >= 0 && x < COLS && y >= 0 && y < ROWS) g[y][x] = c;
    };
    const fill = (x0, x1, y0, y1, c) => {
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) set(x, y, c);
      }
    };
    fill(0, COLS - 1, ROWS - 2, ROWS - 1, '#');
    fill(0, 1, 0, ROWS - 1, '#');
    fill(COLS - 2, COLS - 1, 0, ROWS - 1, '#');
    fill(4, 32, 16, 20, '=');
    fill(4, 32, 21, 22, '#');
    fill(40, 76, 16, 20, '=');
    fill(40, 76, 21, 22, '#');
    fill(55, 59, 8, 16, '=');
    fill(55, 59, 8, 8, '#');
    return {
      grid: g,
      hatch: { x: 12 * TILE, y: 10 * TILE },
      exit: { x: 68 * TILE, y: 14 * TILE },
      out: 20,
      need: 10,
      time: 180,
      stock: { blocker: 3, builder: 5, basher: 3, digger: 3, floater: 3 },
    };
  }

  function renderBlock(source, fenceAttrs, options = {}) {
    void source;
    const cfg = parseFenceAttrs(fenceAttrs);
    const style = resolveStyle(cfg);
    const fullscreen = resolveFullscreen(cfg);
    const lemmingsIndex = Number.isFinite(options.lemmingsIndex) ? options.lemmingsIndex : 0;
    const themeClass = style.theme ? ` lemmings-block--${style.theme}` : '';
    const customClass = (style.colorCss || style.bgCss) ? ' lemmings-block--custom' : '';
    const fullClass = fullscreen ? ' lemmings-block--fullscreen' : '';
    const styleVars = [];
    if (style.colorCss) styleVars.push(`--lemmings-accent:${style.colorCss}`);
    if (style.bgCss) styleVars.push(`--lemmings-bg:${style.bgCss}`);
    const styleAttr = styleVars.length
      ? ` style="${styleVars.map(v => escapeHtml(v)).join(';')}"`
      : '';
    const title = String(cfg.title || 'Lemmings').trim() || 'Lemmings';
    const chrome = fullscreen ? '' : [
      `<div class="lemmings-block-header">`,
      `<div class="lemmings-block-title">${escapeHtml(title)}</div>`,
      `<div class="lemmings-block-meta">Fun 1 · Just a gap</div>`,
      `</div>`,
      `<p class="lemmings-block-hint">Pick a skill, click a lemming · 1–5 skills · Space pause · R restart · Save 10 of 20</p>`,
    ].join('');
    const skillBtns = SKILLS.map((s) => (
      `<button type="button" class="lemmings-skill" data-skill="${s.id}" tabindex="-1">`
      + `<span class="lemmings-skill__key">${s.key}</span>`
      + `<span class="lemmings-skill__name">${s.label}</span>`
      + `<span class="lemmings-skill__n" data-count="${s.id}">0</span>`
      + `</button>`
    )).join('');

    return [
      `<div class="lemmings-block${themeClass}${customClass}${fullClass}"${styleAttr}`,
      ` data-lemmings-index="${lemmingsIndex}"`,
      ` data-lemmings-spec="{}" tabindex="0">`,
      renderFullscreenButton(),
      chrome,
      `<div class="lemmings-stage">`,
      `<canvas class="lemmings-canvas" width="${VIEW_W}" height="${VIEW_H}" aria-label="${escapeHtml(title)}"></canvas>`,
      `</div>`,
      `<div class="lemmings-skills" aria-label="Lemmings skills">`,
      skillBtns,
      `<button type="button" class="lemmings-skill lemmings-skill--ctrl" data-action="pause" tabindex="-1">Pause</button>`,
      `<button type="button" class="lemmings-skill lemmings-skill--ctrl" data-action="nuke" tabindex="-1">Nuke</button>`,
      `</div>`,
      `<div class="lemmings-status" aria-live="polite"></div>`,
      `</div>`,
    ].join('');
  }

  function createGame(el) {
    const canvas = el.querySelector('.lemmings-canvas');
    const status = el.querySelector('.lemmings-status');
    const skillBar = el.querySelector('.lemmings-skills');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const state = {
      grid: null,
      hatch: null,
      exit: null,
      lems: [],
      spawned: 0,
      out: 20,
      need: 10,
      saved: 0,
      dead: 0,
      stock: {},
      skill: 'builder',
      hover: -1,
      spawnT: 0,
      time: 180,
      paused: false,
      started: true,
      over: false,
      won: false,
      nuke: false,
      message: '',
      anim: 0,
      raf: 0,
      last: 0,
      running: true,
      visible: true,
    };

    function solid(tx, ty) {
      if (ty < 0) return false;
      if (tx < 0 || tx >= COLS || ty >= ROWS) return true;
      const c = state.grid[ty][tx];
      return c === '=' || c === '#';
    }

    function steel(tx, ty) {
      if (ty < 0 || tx < 0 || tx >= COLS || ty >= ROWS) return true;
      return state.grid[ty][tx] === '#';
    }

    function setTile(tx, ty, c) {
      if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return;
      if (state.grid[ty][tx] === '#') return;
      state.grid[ty][tx] = c;
    }

    function groundAt(x, y) {
      return solid(Math.floor(x / TILE), Math.floor(y / TILE));
    }

    function spawnLem() {
      state.lems.push({
        x: state.hatch.x + 5,
        y: state.hatch.y + 8,
        dir: 1,
        state: 'fall',
        fall: 0,
        floater: false,
        jobT: 0,
        builds: 0,
        explode: 0,
        dead: false,
        saved: false,
        frame: 0,
      });
      state.spawned += 1;
    }

    function resetLevel() {
      const level = buildLevel();
      state.grid = level.grid;
      state.hatch = level.hatch;
      state.exit = level.exit;
      state.out = level.out;
      state.need = level.need;
      state.time = level.time;
      state.stock = Object.assign({}, level.stock);
      state.lems = [];
      state.spawned = 0;
      state.saved = 0;
      state.dead = 0;
      state.spawnT = 0.4;
      state.paused = false;
      state.over = false;
      state.won = false;
      state.nuke = false;
      state.message = '';
      state.hover = -1;
      syncSkillUi();
      setStatus(`Save ${state.need} of ${state.out}`);
    }

    function setStatus(text) {
      if (status) status.textContent = text || '';
    }

    function syncSkillUi() {
      if (!skillBar) return;
      skillBar.querySelectorAll('.lemmings-skill').forEach((btn) => {
        const id = btn.getAttribute('data-skill');
        btn.classList.toggle('is-active', id === state.skill);
        const n = btn.querySelector('[data-count]');
        if (n && id) n.textContent = String(state.stock[id] ?? 0);
      });
      const pauseBtn = skillBar.querySelector('[data-action="pause"]');
      if (pauseBtn) pauseBtn.textContent = state.paused ? 'Resume' : 'Pause';
    }

    function assignSkill(lem, skill) {
      if (!lem || lem.dead || lem.saved || lem.state === 'exit') return false;
      if (skill === 'floater') {
        if (lem.floater) return false;
        if ((state.stock.floater || 0) <= 0) return false;
        state.stock.floater -= 1;
        lem.floater = true;
        return true;
      }
      if ((state.stock[skill] || 0) <= 0) return false;
      if (skill === 'blocker' && lem.state === 'block') return false;
      state.stock[skill] -= 1;
      if (skill === 'blocker') {
        lem.state = 'block';
        lem.jobT = 0;
      } else if (skill === 'builder') {
        lem.state = 'build';
        lem.builds = 12;
        lem.jobT = 0;
      } else if (skill === 'basher') {
        lem.state = 'bash';
        lem.jobT = 2.8;
      } else if (skill === 'digger') {
        lem.state = 'dig';
        lem.jobT = 3.2;
      }
      return true;
    }

    function pickLem(px, py) {
      let best = -1;
      let bestD = 14;
      for (let i = 0; i < state.lems.length; i += 1) {
        const lem = state.lems[i];
        if (lem.dead || lem.saved) continue;
        const cx = lem.x + LEM_W / 2;
        const cy = lem.y + LEM_H / 2;
        const d = Math.hypot(px - cx, py - cy);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    }

    function blockers() {
      return state.lems.filter(l => !l.dead && !l.saved && l.state === 'block');
    }

    function stepWalk(lem, dt) {
      const feetY = lem.y + LEM_H + 1;
      if (!groundAt(lem.x + LEM_W / 2, feetY)) {
        lem.state = 'fall';
        lem.fall = 0;
        return;
      }
      const aheadX = lem.dir > 0 ? lem.x + LEM_W + 1 : lem.x - 1;
      const chestY = lem.y + LEM_H * 0.45;
      if (groundAt(aheadX, chestY)) {
        lem.dir *= -1;
        return;
      }
      for (const b of blockers()) {
        if (b === lem) continue;
        if (Math.abs((lem.x + LEM_W / 2) - (b.x + LEM_W / 2)) < 7
          && Math.abs(lem.y - b.y) < 8) {
          const goingInto = (lem.dir > 0 && lem.x < b.x) || (lem.dir < 0 && lem.x > b.x);
          if (goingInto) {
            lem.dir *= -1;
            return;
          }
        }
      }
      lem.x += lem.dir * WALK * dt;
    }

    function stepFall(lem, dt) {
      const spd = lem.floater ? FLOAT : FALL;
      lem.y += spd * dt;
      lem.fall += spd * dt;
      const feetY = lem.y + LEM_H + 1;
      if (groundAt(lem.x + LEM_W / 2, feetY)) {
        while (groundAt(lem.x + LEM_W / 2, lem.y + LEM_H)) lem.y -= 1;
        if (!lem.floater && lem.fall > SPLAT) {
          lem.dead = true;
          lem.state = 'splat';
          state.dead += 1;
        } else {
          lem.state = 'walk';
          lem.fall = 0;
        }
      }
    }

    function stepBuild(lem, dt) {
      lem.jobT += dt;
      if (lem.jobT < 0.26) return;
      lem.jobT = 0;
      const tx = Math.floor((lem.x + (lem.dir > 0 ? LEM_W + 2 : -2)) / TILE);
      const ty = Math.floor((lem.y + LEM_H - 2) / TILE);
      if (steel(tx, ty)) {
        lem.state = 'walk';
        return;
      }
      setTile(tx, ty, '=');
      lem.x += lem.dir * 6;
      lem.y -= 4;
      lem.builds -= 1;
      if (lem.builds <= 0) lem.state = 'walk';
    }

    function stepBash(lem, dt) {
      lem.jobT -= dt;
      const tx = Math.floor((lem.x + (lem.dir > 0 ? LEM_W + 3 : -3)) / TILE);
      const mid = Math.floor((lem.y + LEM_H * 0.5) / TILE);
      let dug = false;
      for (let dy = -1; dy <= 1; dy += 1) {
        if (!steel(tx, mid + dy) && solid(tx, mid + dy)) {
          setTile(tx, mid + dy, ' ');
          dug = true;
        }
      }
      if (dug) lem.x += lem.dir * 10 * dt;
      else lem.x += lem.dir * WALK * dt;
      if (!dug && !groundAt(lem.x + (lem.dir > 0 ? LEM_W + 4 : -4), lem.y + LEM_H * 0.5)) {
        lem.state = 'walk';
      }
      if (lem.jobT <= 0) lem.state = 'walk';
      if (!groundAt(lem.x + LEM_W / 2, lem.y + LEM_H + 1)) {
        lem.state = 'fall';
        lem.fall = 0;
      }
    }

    function stepDig(lem, dt) {
      lem.jobT -= dt;
      const tx = Math.floor((lem.x + LEM_W / 2) / TILE);
      const ty = Math.floor((lem.y + LEM_H + 2) / TILE);
      if (steel(tx, ty) || !solid(tx, ty)) {
        lem.state = 'walk';
        return;
      }
      setTile(tx, ty, ' ');
      setTile(tx - 1, ty, ' ');
      setTile(tx + 1, ty, ' ');
      lem.y += 18 * dt;
      if (lem.jobT <= 0) lem.state = 'walk';
    }

    function explode(lem) {
      const cx = Math.floor((lem.x + LEM_W / 2) / TILE);
      const cy = Math.floor((lem.y + LEM_H / 2) / TILE);
      for (let y = cy - 2; y <= cy + 2; y += 1) {
        for (let x = cx - 2; x <= cx + 2; x += 1) {
          if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= 6) setTile(x, y, ' ');
        }
      }
      lem.dead = true;
      lem.state = 'splat';
      state.dead += 1;
    }

    function tryExit(lem) {
      const dx = (lem.x + LEM_W / 2) - (state.exit.x + 12);
      const dy = (lem.y + LEM_H) - (state.exit.y + 16);
      if (Math.abs(dx) < 10 && Math.abs(dy) < 12 && lem.state !== 'fall') {
        lem.saved = true;
        lem.state = 'exit';
        state.saved += 1;
      }
    }

    function tick(dt) {
      if (state.paused || state.over) return;
      state.anim += dt;
      state.time = Math.max(0, state.time - dt);
      if (state.spawned < state.out) {
        state.spawnT -= dt;
        if (state.spawnT <= 0) {
          spawnLem();
          state.spawnT = 0.55;
        }
      }
      state.lems.forEach((lem) => {
        if (lem.dead || lem.saved) return;
        if (state.nuke && lem.explode <= 0) lem.explode = 5;
        if (lem.explode > 0) {
          lem.explode -= dt * 2.4;
          if (lem.explode <= 0) {
            explode(lem);
            return;
          }
        }
        lem.frame += dt * 8;
        if (lem.state === 'fall') stepFall(lem, dt);
        else if (lem.state === 'block') { /* stand */ }
        else if (lem.state === 'build') stepBuild(lem, dt);
        else if (lem.state === 'bash') stepBash(lem, dt);
        else if (lem.state === 'dig') stepDig(lem, dt);
        else stepWalk(lem, dt);
        if (lem.x < TILE * 2) { lem.x = TILE * 2; lem.dir = 1; }
        if (lem.x > VIEW_W - TILE * 2 - LEM_W) { lem.x = VIEW_W - TILE * 2 - LEM_W; lem.dir = -1; }
        if (lem.y > VIEW_H) {
          lem.dead = true;
          lem.state = 'splat';
          state.dead += 1;
          return;
        }
        tryExit(lem);
      });

      const remaining = state.out - state.saved - state.dead;
      const inPlay = state.lems.some(l => !l.dead && !l.saved);
      if (state.saved >= state.need && !inPlay && state.spawned >= state.out) {
        state.won = true;
        state.over = true;
        state.message = 'OH YES!';
        setStatus(`Saved ${state.saved} of ${state.out}`);
      } else if (state.time <= 0 || (state.saved + remaining < state.need && !inPlay && state.spawned >= state.out)) {
        state.over = true;
        state.message = 'OH NO!';
        setStatus(`Saved ${state.saved} · need ${state.need}`);
      } else {
        setStatus(`Out ${state.spawned}/${state.out} · In ${state.saved} · Dead ${state.dead} · ${Math.ceil(state.time)}s`);
      }
    }

    function drawTerrain() {
      const sky = ctx.createLinearGradient(0, 0, 0, VIEW_H);
      sky.addColorStop(0, '#5aa0d6');
      sky.addColorStop(1, '#9fd0ef');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      for (let y = 0; y < ROWS; y += 1) {
        for (let x = 0; x < COLS; x += 1) {
          const c = state.grid[y][x];
          if (c === ' ') continue;
          const px = x * TILE;
          const py = y * TILE;
          if (c === '=') {
            ctx.fillStyle = '#8b5a2b';
            ctx.fillRect(px, py, TILE, TILE);
            ctx.fillStyle = '#6d4018';
            ctx.fillRect(px, py + TILE - 2, TILE, 2);
            ctx.fillStyle = '#a36a34';
            ctx.fillRect(px + 1, py + 1, 3, 2);
          } else {
            ctx.fillStyle = '#7a7f88';
            ctx.fillRect(px, py, TILE, TILE);
            ctx.strokeStyle = '#4d5158';
            ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
          }
        }
      }
    }

    function drawHatch() {
      const { x, y } = state.hatch;
      ctx.fillStyle = '#4a2c0a';
      ctx.fillRect(x, y, 18, 6);
      ctx.fillStyle = '#2c1a06';
      ctx.fillRect(x + 2, y + 6, 14, 4);
    }

    function drawExit() {
      const { x, y } = state.exit;
      ctx.fillStyle = '#2d6a4f';
      ctx.fillRect(x, y, 24, 20);
      ctx.fillStyle = '#081c15';
      ctx.beginPath();
      ctx.arc(x + 12, y + 20, 10, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = '#95d5b2';
      ctx.fillRect(x + 2, y, 20, 3);
    }

    function drawLem(lem, i) {
      if (lem.saved) return;
      const px = Math.round(lem.x);
      const py = Math.round(lem.y);
      ctx.save();
      ctx.translate(px + LEM_W / 2, py);
      ctx.scale(lem.dir, 1);
      if (lem.dead) {
        ctx.fillStyle = '#222';
        ctx.fillRect(-3, 6, 6, 3);
        ctx.restore();
        return;
      }
      if (i === state.hover) {
        ctx.strokeStyle = '#fff';
        ctx.strokeRect(-5, -1, 10, LEM_H + 2);
      }
      ctx.fillStyle = '#3d8c40';
      ctx.fillRect(-3, 0, 6, 3);
      ctx.fillStyle = '#f0d0b0';
      ctx.fillRect(-2, 3, 4, 3);
      ctx.fillStyle = lem.state === 'block' ? '#c1121f' : '#1d4e89';
      ctx.fillRect(-3, 6, 6, 4);
      if (lem.floater && lem.state === 'fall') {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(0, -2, 5, Math.PI, 0);
        ctx.fill();
      }
      if (lem.explode > 0) {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 8px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(Math.ceil(lem.explode)), 0, -4);
      }
      ctx.restore();
    }

    function drawHud() {
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(0, 0, VIEW_W, 16);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px ui-monospace, Consolas, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`IN ${state.saved}/${state.need}`, 8, 12);
      ctx.fillText(`OUT ${state.spawned}/${state.out}`, 90, 12);
      ctx.textAlign = 'right';
      ctx.fillText(`${Math.ceil(state.time)}s`, VIEW_W - 8, 12);
      if (state.message) {
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(0, VIEW_H / 2 - 22, VIEW_W, 44);
        ctx.fillStyle = state.won ? '#b7efc5' : '#ffb3c1';
        ctx.font = 'bold 20px ui-monospace, Consolas, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(state.message, VIEW_W / 2, VIEW_H / 2 + 6);
      }
    }

    function draw() {
      drawTerrain();
      drawExit();
      drawHatch();
      state.lems.forEach(drawLem);
      drawHud();
    }

    function fitCanvas() {
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      canvas.width = Math.round(VIEW_W * dpr);
      canvas.height = Math.round(VIEW_H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
    }

    function loop(now) {
      if (!state.running) return;
      if (!state.last) {
        state.last = now;
        if (state.visible) draw();
        state.raf = requestAnimationFrame(loop);
        return;
      }
      const dt = Math.min(0.033, (now - state.last) / 1000);
      state.last = now;
      if (state.visible) {
        tick(dt);
        draw();
      }
      state.raf = requestAnimationFrame(loop);
    }

    function canvasPoint(event) {
      const r = canvas.getBoundingClientRect();
      return {
        x: (event.clientX - r.left) * (VIEW_W / r.width),
        y: (event.clientY - r.top) * (VIEW_H / r.height),
      };
    }

    function onPointerMove(event) {
      const p = canvasPoint(event);
      state.hover = pickLem(p.x, p.y);
    }

    function onPointerDown(event) {
      if (event.target.closest?.('.lemmings-skills')) return;
      el.focus({ preventScroll: true });
      if (state.over) {
        resetLevel();
        return;
      }
      const p = canvasPoint(event);
      const i = pickLem(p.x, p.y);
      if (i >= 0) {
        assignSkill(state.lems[i], state.skill);
        syncSkillUi();
      }
    }

    function onKey(event) {
      const k = event.key;
      if (k === 'r' || k === 'R') {
        event.preventDefault();
        resetLevel();
        return;
      }
      if (k === ' ' || k === 'p' || k === 'P') {
        event.preventDefault();
        if (!state.over) state.paused = !state.paused;
        syncSkillUi();
        return;
      }
      const skill = SKILLS.find(s => s.key === k);
      if (skill) {
        event.preventDefault();
        state.skill = skill.id;
        syncSkillUi();
      }
    }

    if (skillBar) {
      skillBar.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-skill], [data-action]');
        if (!btn) return;
        event.preventDefault();
        el.focus({ preventScroll: true });
        const skill = btn.getAttribute('data-skill');
        const act = btn.getAttribute('data-action');
        if (skill) {
          state.skill = skill;
          syncSkillUi();
        } else if (act === 'pause' && !state.over) {
          state.paused = !state.paused;
          syncSkillUi();
        } else if (act === 'nuke' && !state.over) {
          state.nuke = true;
        }
      });
    }

    resetLevel();
    fitCanvas();
    bindFullscreenButton(el);
    el.addEventListener('keydown', onKey);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    const onResize = () => fitCanvas();
    window.addEventListener('resize', onResize);
    const io = new IntersectionObserver((entries) => {
      state.visible = entries.some(e => e.isIntersecting);
    }, { threshold: 0.05 });
    io.observe(el);
    state.raf = requestAnimationFrame(loop);

    return {
      destroy() {
        state.running = false;
        cancelAnimationFrame(state.raf);
        el.removeEventListener('keydown', onKey);
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('resize', onResize);
        io.disconnect();
      },
    };
  }

  function hydrateBlock(el) {
    if (!el) return;
    if (el._lemmingsGame?.destroy) el._lemmingsGame.destroy();
    el._lemmingsGame = createGame(el);
  }

  function hydrate(root) {
    (root || document).querySelectorAll('.lemmings-block[data-lemmings-spec]').forEach(hydrateBlock);
  }

  return {
    parseFenceAttrs,
    renderBlock,
    hydrate,
    hydrateBlock,
  };
}));
