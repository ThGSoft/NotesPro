/**
 * NotesPro ```mario``` block — Super Mario–style side scroller in preview.
 */
(function (root, factory) {
  const api = factory();
  root.NotesProMario = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];
  const TILE = 16;
  const VIEW_W = 320;
  const VIEW_H = 240;
  const HUD = 0;
  const GRAVITY = 2050;
  const JUMP_VY = -430;
  const JUMP_HOLD = 0.18;
  const ACCEL = 1400;
  const FRICTION = 1600;
  const MAX_WALK = 155;
  const GOOMBA_SPD = 32;
  const COYOTE = 0.09;
  const JUMP_BUF = 0.12;

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

  function parentIsMobile() {
    try {
      return document.body.classList.contains('mobile-layout')
        || window.matchMedia('(max-width: 768px)').matches;
    } catch (_) {
      return false;
    }
  }

  function buildLevel() {
    const W = 210;
    const H = 15;
    const rows = Array.from({ length: H }, () => Array(W).fill(' '));
    const set = (x, y, c) => {
      if (x >= 0 && x < W && y >= 0 && y < H) rows[y][x] = c;
    };
    const fill = (x0, x1, y, c) => {
      for (let x = x0; x <= x1; x += 1) set(x, y, c);
    };

    for (let x = 0; x < W; x += 1) {
      set(x, 13, '=');
      set(x, 14, '#');
    }
    [[40, 44], [76, 82], [118, 124], [158, 164]].forEach(([a, b]) => {
      fill(a, b, 13, ' ');
      fill(a, b, 14, ' ');
    });

    const pipe = (x, h) => {
      for (let y = 13 - h; y < 13; y += 1) {
        set(x, y, 'P');
        set(x + 1, y, 'P');
      }
    };
    pipe(16, 2);
    pipe(28, 3);
    pipe(68, 2);
    pipe(102, 4);
    pipe(140, 2);
    pipe(176, 3);

    const run = (x, y, pattern) => {
      [...pattern].forEach((c, i) => {
        if (c !== '.') set(x + i, y, c);
      });
    };
    run(10, 9, '?');
    run(22, 9, 'B?B');
    run(48, 8, '??');
    run(54, 5, 'B?B?B');
    run(88, 9, '?B?');
    run(108, 7, 'BBB');
    run(130, 9, 'C.C.C');
    run(146, 8, 'B?B');
    run(168, 6, '?????');

    fill(50, 54, 10, 'C');
    fill(90, 93, 11, 'C');
    fill(132, 136, 6, 'C');

    [12, 24, 36, 52, 64, 86, 96, 112, 134, 150, 172].forEach((x) => set(x, 12, 'G'));

    const stairs = (x, n) => {
      for (let i = 0; i < n; i += 1) {
        for (let y = 0; y <= i; y += 1) set(x + i, 12 - y, 'H');
      }
    };
    stairs(186, 6);
    fill(192, 208, 12, 'H');
    fill(192, 208, 11, 'H');
    set(204, 4, 'F');
    for (let y = 5; y <= 10; y += 1) set(204, y, '|');

    return { cols: W, rows: H, grid: rows.map((r) => r.slice()) };
  }

  function isSolid(cell) {
    return cell === '#' || cell === '=' || cell === 'B' || cell === '?' || cell === 'P' || cell === 'H';
  }

  function renderBlock(source, fenceAttrs, options = {}) {
    void source;
    const cfg = parseFenceAttrs(fenceAttrs);
    const style = resolveStyle(cfg);
    const fullscreen = resolveFullscreen(cfg);
    const marioIndex = Number.isFinite(options.marioIndex) ? options.marioIndex : 0;
    const themeClass = style.theme ? ` mario-block--${style.theme}` : '';
    const customClass = (style.colorCss || style.bgCss) ? ' mario-block--custom' : '';
    const fullClass = fullscreen ? ' mario-block--fullscreen' : '';
    const styleVars = [];
    if (style.colorCss) styleVars.push(`--mario-accent:${style.colorCss}`);
    if (style.bgCss) styleVars.push(`--mario-bg:${style.bgCss}`);
    const styleAttr = styleVars.length
      ? ` style="${styleVars.map(v => escapeHtml(v)).join(';')}"`
      : '';
    const title = String(cfg.title || 'Super Mario').trim() || 'Super Mario';
    const chrome = fullscreen ? '' : [
      `<div class="mario-block-header">`,
      `<div class="mario-block-title">${escapeHtml(title)}</div>`,
      `<div class="mario-block-meta">World 1-1</div>`,
      `</div>`,
      `<p class="mario-block-hint">Click the stage · Arrows / AD run · Space / W / ↑ jump · R restart · On phones, use the buttons</p>`,
    ].join('');

    return [
      `<div class="mario-block${themeClass}${customClass}${fullClass}"${styleAttr}`,
      ` data-mario-index="${marioIndex}"`,
      ` data-mario-spec="{}" tabindex="0">`,
      renderFullscreenButton(),
      chrome,
      `<div class="mario-stage">`,
      `<canvas class="mario-canvas" width="${VIEW_W}" height="${VIEW_H}" aria-label="${escapeHtml(title)}"></canvas>`,
      `</div>`,
      `<div class="mario-pad" aria-label="Mario controls">`,
      `<button type="button" class="mario-pad__btn mario-pad__btn--left" data-act="left" tabindex="-1" aria-label="Left">◀</button>`,
      `<button type="button" class="mario-pad__btn mario-pad__btn--jump" data-act="jump" tabindex="-1" aria-label="Jump">Jump</button>`,
      `<button type="button" class="mario-pad__btn mario-pad__btn--right" data-act="right" tabindex="-1" aria-label="Right">▶</button>`,
      `</div>`,
      `<div class="mario-status" aria-live="polite"></div>`,
      `</div>`,
    ].join('');
  }

  function createGame(el) {
    const canvas = el.querySelector('.mario-canvas');
    const status = el.querySelector('.mario-status');
    const pad = el.querySelector('.mario-pad');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const keys = { left: false, right: false, jump: false };
    const state = {
      level: null,
      player: null,
      enemies: [],
      coins: [],
      bumps: [],
      camX: 0,
      score: 0,
      coinsGot: 0,
      lives: 3,
      time: 400,
      paused: false,
      started: false,
      over: false,
      won: false,
      message: 'READY!',
      freeze: 0.4,
      invuln: 0,
      anim: 0,
      raf: 0,
      last: 0,
      running: true,
      visible: true,
      jumpHeld: 0,
      coyote: 0,
      jumpBuf: 0,
    };

    function tile(tx, ty) {
      const grid = state.level.grid;
      if (ty < 0 || ty >= grid.length || tx < 0 || tx >= grid[0].length) return '#';
      return grid[ty][tx];
    }

    function setTile(tx, ty, c) {
      if (ty < 0 || ty >= state.level.grid.length || tx < 0 || tx >= state.level.grid[0].length) return;
      state.level.grid[ty][tx] = c;
    }

    function spawnPlayer(x, y) {
      return {
        x,
        y,
        w: 12,
        h: 15,
        vx: 0,
        vy: 0,
        face: 1,
        grounded: false,
        dead: 0,
      };
    }

    function parseActors() {
      state.enemies = [];
      state.coins = [];
      const grid = state.level.grid;
      for (let y = 0; y < grid.length; y += 1) {
        for (let x = 0; x < grid[y].length; x += 1) {
          const c = grid[y][x];
          if (c === 'G') {
            grid[y][x] = ' ';
            state.enemies.push({
              x: x * TILE + 1,
              y: y * TILE + 2,
              w: 14,
              h: 14,
              vx: -GOOMBA_SPD,
              dead: 0,
              squash: 0,
            });
          } else if (c === 'C') {
            grid[y][x] = ' ';
            state.coins.push({ x: x * TILE + 4, y: y * TILE + 3, w: 8, h: 10, taken: false, pop: 0 });
          }
        }
      }
    }

    function resetLevel(full) {
      state.level = buildLevel();
      parseActors();
      state.player = spawnPlayer(3 * TILE, 11 * TILE);
      state.camX = 0;
      state.message = 'READY!';
      state.freeze = full ? 0.35 : 0.9;
      state.invuln = full ? 0 : 1.2;
      state.won = false;
      if (full) {
        state.score = 0;
        state.coinsGot = 0;
        state.lives = 3;
        state.time = 400;
        state.over = false;
      } else {
        state.time = 400;
      }
    }

    function restartGame() {
      state.paused = false;
      state.started = true;
      state.over = false;
      state.won = false;
      resetLevel(true);
      setStatus('');
    }

    function setStatus(text) {
      if (status) status.textContent = text || '';
    }

    function killPlayer() {
      if (state.invuln > 0 || state.player.dead || state.won) return;
      state.lives -= 1;
      state.player.dead = 1.2;
      state.player.vy = -280;
      state.player.vx = 0;
      if (state.lives <= 0) {
        state.over = true;
        state.message = 'GAME OVER';
        setStatus('Game over · R or tap to restart');
      }
    }

    function overlaps(a, b) {
      return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    }

    function resolveAxis(body, axis) {
      const left = Math.floor(body.x / TILE);
      const right = Math.floor((body.x + body.w - 0.001) / TILE);
      const top = Math.floor(body.y / TILE);
      const bot = Math.floor((body.y + body.h - 0.001) / TILE);
      let hitHead = null;
      for (let ty = top; ty <= bot; ty += 1) {
        for (let tx = left; tx <= right; tx += 1) {
          const cell = tile(tx, ty);
          if (!isSolid(cell)) continue;
          const tileL = tx * TILE;
          const tileT = ty * TILE;
          if (axis === 'x') {
            if (body.vx > 0) body.x = tileL - body.w;
            else if (body.vx < 0) body.x = tileL + TILE;
            body.vx = 0;
          } else {
            if (body.vy > 0) {
              body.y = tileT - body.h;
              body.vy = 0;
              body.grounded = true;
            } else if (body.vy < 0) {
              body.y = tileT + TILE;
              body.vy = 0;
              hitHead = { tx, ty, cell };
            }
          }
        }
      }
      return hitHead;
    }

    function bumpBlock(tx, ty, cell) {
      state.bumps.push({ tx, ty, t: 0.18 });
      if (cell === '?') {
        setTile(tx, ty, 'H');
        state.score += 200;
        state.coinsGot += 1;
        state.coins.push({
          x: tx * TILE + 4,
          y: ty * TILE - 12,
          w: 8,
          h: 10,
          taken: false,
          pop: 0.35,
        });
      }
    }

    function tryJump() {
      if (state.player.dead || state.over || state.won) return;
      if (state.coyote > 0 || state.player.grounded) {
        state.player.vy = JUMP_VY;
        state.player.grounded = false;
        state.coyote = 0;
        state.jumpBuf = 0;
        state.jumpHeld = JUMP_HOLD;
      } else {
        state.jumpBuf = JUMP_BUF;
      }
    }

    function movePlayer(dt) {
      const p = state.player;
      if (p.dead > 0) {
        p.dead -= dt;
        p.vy += GRAVITY * dt;
        p.y += p.vy * dt;
        if (p.dead <= 0 && !state.over) {
          resetLevel(false);
        }
        return;
      }

      const wish = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      if (wish) p.face = wish;
      if (wish !== 0) {
        p.vx += wish * ACCEL * dt;
        if (p.vx > MAX_WALK) p.vx = MAX_WALK;
        if (p.vx < -MAX_WALK) p.vx = -MAX_WALK;
      } else {
        const fr = FRICTION * dt;
        if (Math.abs(p.vx) <= fr) p.vx = 0;
        else p.vx -= Math.sign(p.vx) * fr;
      }

      if (p.grounded) state.coyote = COYOTE;
      else state.coyote = Math.max(0, state.coyote - dt);
      state.jumpBuf = Math.max(0, state.jumpBuf - dt);
      if (state.jumpBuf > 0 && (p.grounded || state.coyote > 0)) tryJump();

      if (keys.jump && state.jumpHeld > 0 && p.vy < 0) {
        state.jumpHeld -= dt;
        p.vy += -420 * dt;
      } else {
        state.jumpHeld = 0;
      }
      if (!keys.jump) state.jumpHeld = 0;

      p.vy += GRAVITY * dt;
      if (p.vy > 520) p.vy = 520;

      p.grounded = false;
      p.x += p.vx * dt;
      resolveAxis(p, 'x');
      p.y += p.vy * dt;
      const head = resolveAxis(p, 'y');
      if (head) bumpBlock(head.tx, head.ty, head.cell);

      const maxX = (state.level.cols - 1) * TILE;
      if (p.x < 0) { p.x = 0; p.vx = 0; }
      if (p.x > maxX) p.x = maxX;
      if (p.y > (state.level.rows + 2) * TILE) killPlayer();
    }

    function moveEnemies(dt) {
      state.enemies.forEach((g) => {
        if (g.squash > 0) {
          g.squash -= dt;
          return;
        }
        if (g.dead) return;
        g.x += g.vx * dt;
        const ahead = g.vx > 0
          ? Math.floor((g.x + g.w) / TILE)
          : Math.floor(g.x / TILE);
        const foot = Math.floor((g.y + g.h + 1) / TILE);
        const mid = Math.floor((g.y + g.h * 0.5) / TILE);
        if (isSolid(tile(ahead, mid)) || !isSolid(tile(ahead, foot))) g.vx *= -1;
        g.y = Math.floor(g.y / TILE) * TILE + 2;
      });
    }

    function collectCoins() {
      const p = state.player;
      state.coins.forEach((c) => {
        if (c.taken) return;
        if (c.pop > 0) return;
        if (overlaps(p, c)) {
          c.taken = true;
          state.score += 200;
          state.coinsGot += 1;
        }
      });
    }

    function stompEnemies() {
      const p = state.player;
      if (p.dead) return;
      state.enemies.forEach((g) => {
        if (g.dead || g.squash > 0) return;
        if (!overlaps(p, g)) return;
        const fromAbove = p.vy > 40 && (p.y + p.h) - g.y < 10;
        if (fromAbove) {
          g.squash = 0.45;
          g.dead = true;
          g.vx = 0;
          p.vy = JUMP_VY * 0.55;
          state.score += 100;
        } else {
          killPlayer();
        }
      });
    }

    function checkFlag() {
      const p = state.player;
      const tx = Math.floor((p.x + p.w * 0.5) / TILE);
      const ty = Math.floor((p.y + p.h * 0.5) / TILE);
      const near = tile(tx, ty) === 'F' || tile(tx, ty) === '|'
        || tile(tx + 1, ty) === 'F' || tile(tx + 1, ty) === '|';
      if (near) {
        state.won = true;
        state.message = 'WORLD CLEAR';
        state.score += Math.floor(state.time) * 10;
        setStatus('You win · R to play again');
      }
    }

    function tick(dt) {
      if (!state.started || state.paused) return;
      state.anim += dt;
      if (state.freeze > 0) {
        state.freeze -= dt;
        if (state.freeze <= 0) {
          state.freeze = 0;
          if (state.message === 'READY!') state.message = '';
        }
        return;
      }
      if (state.over || state.won) return;
      state.invuln = Math.max(0, state.invuln - dt);
      state.time = Math.max(0, state.time - dt);
      if (state.time <= 0 && !state.player.dead) killPlayer();
      state.bumps.forEach((b) => { b.t -= dt; });
      state.bumps = state.bumps.filter((b) => b.t > 0);
      state.coins.forEach((c) => {
        if (c.pop > 0) {
          c.pop -= dt;
          c.y -= 40 * dt;
          if (c.pop <= 0) c.taken = true;
        }
      });
      movePlayer(dt);
      moveEnemies(dt);
      if (!state.player.dead) {
        collectCoins();
        stompEnemies();
        checkFlag();
      }
      const target = state.player.x - VIEW_W * 0.38;
      const maxCam = Math.max(0, state.level.cols * TILE - VIEW_W);
      const desired = Math.max(0, Math.min(maxCam, target));
      const follow = 1 - Math.exp(-8 * dt);
      state.camX += (desired - state.camX) * follow;
      if (state.camX < 0) state.camX = 0;
      if (state.camX > maxCam) state.camX = maxCam;
    }

    function bumpOffset(tx, ty) {
      const b = state.bumps.find((n) => n.tx === tx && n.ty === ty);
      return b ? Math.sin((1 - b.t / 0.18) * Math.PI) * -4 : 0;
    }

    function drawSky() {
      const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
      g.addColorStop(0, '#5c94fc');
      g.addColorStop(1, '#b8d4ff');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.fillStyle = '#7ec850';
      for (let i = 0; i < 8; i += 1) {
        const hx = ((i * 70) - state.camX * 0.25) % (VIEW_W + 80) - 40;
        ctx.beginPath();
        ctx.ellipse(hx, VIEW_H - 28, 46, 18, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function drawTile(cell, px, py) {
      if (cell === ' ' || cell === 'G' || cell === 'C') return;
      if (cell === '=') {
        ctx.fillStyle = '#c84c0c';
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = '#5cb800';
        ctx.fillRect(px, py, TILE, 4);
        ctx.fillStyle = '#8b3a0a';
        ctx.fillRect(px + 1, py + 6, 5, 4);
        ctx.fillRect(px + 9, py + 10, 5, 4);
      } else if (cell === '#') {
        ctx.fillStyle = '#c84c0c';
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = '#8b3a0a';
        ctx.fillRect(px + 1, py + 2, 6, 5);
        ctx.fillRect(px + 9, py + 8, 5, 5);
      } else if (cell === 'B') {
        ctx.fillStyle = '#c84c0c';
        ctx.fillRect(px, py, TILE, TILE);
        ctx.strokeStyle = '#5a2208';
        ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
        ctx.beginPath();
        ctx.moveTo(px + TILE / 2, py);
        ctx.lineTo(px + TILE / 2, py + TILE);
        ctx.moveTo(px, py + TILE / 2);
        ctx.lineTo(px + TILE, py + TILE / 2);
        ctx.stroke();
      } else if (cell === '?') {
        ctx.fillStyle = '#fcbc18';
        ctx.fillRect(px, py, TILE, TILE);
        ctx.strokeStyle = '#a86a00';
        ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
        ctx.fillStyle = '#fff6c8';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('?', px + TILE / 2, py + 12);
      } else if (cell === 'H') {
        ctx.fillStyle = '#c84c0c';
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = '#e8a060';
        ctx.fillRect(px + 3, py + 3, 10, 10);
      } else if (cell === 'P') {
        ctx.fillStyle = '#30b030';
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = '#228b22';
        ctx.fillRect(px, py, 3, TILE);
        ctx.fillStyle = '#46e046';
        ctx.fillRect(px + TILE - 3, py, 3, TILE);
      } else if (cell === 'F') {
        ctx.fillStyle = '#f8f8f8';
        ctx.fillRect(px + 6, py, 3, TILE);
        ctx.fillStyle = '#e52521';
        ctx.beginPath();
        ctx.moveTo(px + 9, py + 1);
        ctx.lineTo(px + 16, py + 6);
        ctx.lineTo(px + 9, py + 11);
        ctx.fill();
      } else if (cell === '|') {
        ctx.fillStyle = '#f8f8f8';
        ctx.fillRect(px + 6, py, 3, TILE);
      }
    }

    function drawWorld() {
      const x0 = Math.max(0, Math.floor(state.camX / TILE) - 1);
      const x1 = Math.min(state.level.cols - 1, Math.ceil((state.camX + VIEW_W) / TILE) + 1);
      for (let y = 0; y < state.level.rows; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const cell = tile(x, y);
          const px = Math.round(x * TILE - state.camX);
          const py = y * TILE + bumpOffset(x, y);
          drawTile(cell, px, py);
        }
      }
    }

    function drawCoin(c) {
      if (c.taken && c.pop <= 0) return;
      const px = c.x - state.camX;
      const squish = 0.55 + Math.abs(Math.sin(state.anim * 8)) * 0.45;
      ctx.fillStyle = '#fcbc18';
      ctx.beginPath();
      ctx.ellipse(px + 4, c.y + 5, 3.5 * squish, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff3a0';
      ctx.fillRect(px + 3, c.y + 3, 2, 5);
    }

    function drawGoomba(g) {
      if (g.squash < 0) return;
      const px = g.x - state.camX;
      const py = g.y + (g.squash > 0 ? 6 : 0);
      const h = g.squash > 0 ? 8 : 14;
      ctx.fillStyle = '#8b4513';
      ctx.beginPath();
      ctx.ellipse(px + 7, py + h * 0.45, 7, h * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5a2d0c';
      ctx.fillRect(px + 1, py + h - 4, 12, 4);
      if (g.squash <= 0) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(px + 3, py + 3, 3, 3);
        ctx.fillRect(px + 8, py + 3, 3, 3);
        ctx.fillStyle = '#111';
        ctx.fillRect(px + 4, py + 4, 2, 2);
        ctx.fillRect(px + 9, py + 4, 2, 2);
      }
    }

    function drawPlayer() {
      const p = state.player;
      if (state.invuln > 0 && Math.floor(state.anim * 16) % 2 === 0) return;
      const px = Math.round(p.x - state.camX);
      const py = Math.round(p.y);
      const walk = p.grounded && Math.abs(p.vx) > 20;
      const frame = walk ? Math.floor(state.anim * 10) % 2 : 0;
      ctx.save();
      ctx.translate(px + p.w / 2, py);
      ctx.scale(p.face, 1);
      ctx.fillStyle = '#e52521';
      ctx.fillRect(-6, 0, 12, 5);
      ctx.fillStyle = '#f4c2a0';
      ctx.fillRect(-5, 5, 10, 5);
      ctx.fillStyle = '#3b5dc9';
      ctx.fillRect(-5, 10, 10, 4);
      ctx.fillStyle = '#6b3a1f';
      ctx.fillRect(-5, 13, 4, 3 + frame);
      ctx.fillRect(1, 13, 4, 3 + (1 - frame));
      ctx.restore();
    }

    function drawHud() {
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(0, 0, VIEW_W, 18);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 9px ui-monospace, Consolas, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`MARIO`, 8, 12);
      ctx.fillText(String(state.score).padStart(6, '0'), 42, 12);
      ctx.fillText(`●x${String(state.coinsGot).padStart(2, '0')}`, 108, 12);
      ctx.fillText(`WORLD 1-1`, 168, 12);
      ctx.textAlign = 'right';
      ctx.fillText(`TIME ${Math.ceil(state.time)}`, VIEW_W - 8, 12);
    }

    function drawOverlay() {
      if (!state.message && state.started && !state.paused) return;
      const text = state.paused ? 'PAUSED' : (state.message || 'READY!');
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, 96, VIEW_W, 48);
      ctx.fillStyle = text === 'GAME OVER' ? '#ff6b6b' : '#fff';
      ctx.font = 'bold 16px ui-monospace, Consolas, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(text, VIEW_W / 2, 122);
      if (!state.started || state.over || state.won) {
        ctx.fillStyle = '#d6e4ff';
        ctx.font = '10px sans-serif';
        ctx.fillText(state.over || state.won ? 'Press R or tap to play again' : 'Click, then run and jump', VIEW_W / 2, 138);
      }
    }

    function draw() {
      drawSky();
      ctx.save();
      drawWorld();
      state.coins.forEach(drawCoin);
      state.enemies.forEach(drawGoomba);
      drawPlayer();
      ctx.restore();
      drawHud();
      drawOverlay();
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

    function setAct(act, down) {
      if (act === 'left') keys.left = down;
      else if (act === 'right') keys.right = down;
      else if (act === 'jump') {
        const was = keys.jump;
        keys.jump = down;
        if (down && !was) {
          state.started = true;
          if (state.paused) state.paused = false;
          if (state.over || state.won) restartGame();
          else tryJump();
        }
      }
    }

    function onKeyDown(event) {
      const k = event.key;
      if (k === 'r' || k === 'R') {
        event.preventDefault();
        restartGame();
        return;
      }
      if (k === 'p' || k === 'P') {
        event.preventDefault();
        if (!state.over && !state.won) {
          state.started = true;
          state.paused = !state.paused;
          state.message = state.paused ? 'PAUSED' : '';
        }
        return;
      }
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') {
        event.preventDefault();
        keys.left = true;
        state.started = true;
      } else if (k === 'ArrowRight' || k === 'd' || k === 'D') {
        event.preventDefault();
        keys.right = true;
        state.started = true;
      } else if (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W') {
        event.preventDefault();
        setAct('jump', true);
      }
    }

    function onKeyUp(event) {
      const k = event.key;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = false;
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = false;
      else if (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W') keys.jump = false;
    }

    function syncPad() {
      if (!pad) return;
      const mobile = parentIsMobile();
      el.classList.toggle('mario-block--mobile', mobile);
      pad.classList.toggle('is-visible', mobile);
    }

    function bindPad() {
      if (!pad) return;
      pad.querySelectorAll('[data-act]').forEach((btn) => {
        const act = btn.getAttribute('data-act');
        const down = (event) => {
          event.preventDefault();
          el.focus({ preventScroll: true });
          try { btn.setPointerCapture(event.pointerId); } catch (_) { /* ignore */ }
          setAct(act, true);
        };
        const up = (event) => {
          event.preventDefault();
          setAct(act, false);
        };
        btn.addEventListener('pointerdown', down);
        btn.addEventListener('pointerup', up);
        btn.addEventListener('pointercancel', up);
        btn.addEventListener('lostpointercapture', () => setAct(act, false));
        btn.addEventListener('contextmenu', (event) => event.preventDefault());
      });
    }

    function onPointerDown(event) {
      if (event.target.closest?.('.mario-pad')) return;
      el.focus({ preventScroll: true });
      state.started = true;
      if (state.over || state.won) restartGame();
    }

    resetLevel(true);
    fitCanvas();
    syncPad();
    bindPad();
    el.addEventListener('keydown', onKeyDown);
    el.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('pointerdown', onPointerDown);
    const onResize = () => {
      fitCanvas();
      syncPad();
    };
    window.addEventListener('resize', onResize);
    const io = new IntersectionObserver((entries) => {
      state.visible = entries.some((e) => e.isIntersecting);
    }, { threshold: 0.05 });
    io.observe(el);
    bindFullscreenButton(el);
    state.raf = requestAnimationFrame(loop);

    return {
      destroy() {
        state.running = false;
        cancelAnimationFrame(state.raf);
        el.removeEventListener('keydown', onKeyDown);
        el.removeEventListener('keyup', onKeyUp);
        canvas.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('resize', onResize);
        io.disconnect();
        keys.left = keys.right = keys.jump = false;
      },
    };
  }

  function hydrateBlock(el) {
    if (!el) return;
    if (el._marioGame?.destroy) el._marioGame.destroy();
    el._marioGame = createGame(el);
  }

  function hydrate(root) {
    (root || document).querySelectorAll('.mario-block[data-mario-spec]').forEach(hydrateBlock);
  }

  return {
    parseFenceAttrs,
    renderBlock,
    hydrate,
    hydrateBlock,
  };
}));
