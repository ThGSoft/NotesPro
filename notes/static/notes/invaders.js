/**
 * NotesPro ```invaders``` / ```spaceinvaders``` block — classic Space Invaders.
 * Free vanilla JS implementation for NotesPro (no third-party game engine).
 */
(function (root, factory) {
  const api = factory();
  root.NotesProInvaders = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];
  const VW = 448;
  const VH = 520;
  const COLS = 11;
  const ROWS = 5;
  const ALIEN_W = 24;
  const ALIEN_H = 16;
  const STEP_X = 32;
  const STEP_Y = 24;
  const PTS = [10, 20, 30];
  const UFO_PTS = [50, 100, 150, 300];
  const BUNKER = [
    '....########....',
    '..############..',
    '.##############.',
    '################',
    '################',
    '################',
    '######....######',
    '#####......#####',
    '####........####',
    '####........####',
  ];
  const SPRITES = [
    [
      ['00100000100', '00010001000', '00111111100', '01101110110', '11111111111', '10111111101', '10100000101', '00011011000'],
      ['00100000100', '10100000101', '10111111101', '11101110111', '11111111111', '00111111100', '00100000100', '01000000010'],
    ],
    [
      ['01000000010', '00100000100', '01111111110', '11011111011', '11111111111', '01111111110', '00100000100', '01000000010'],
      ['01000000010', '00100000100', '01111111110', '11011111011', '11111111111', '00110101100', '01000000010', '00100000100'],
    ],
    [
      ['0001111000', '0111111110', '1111111111', '1100110011', '1111111111', '0011001100', '0110011010', '1000000001'],
      ['0001111000', '0111111110', '1111111111', '1100110011', '1111111111', '0011001100', '0100110010', '0010000100'],
    ],
  ];
  const SHIP = ['00000100000', '00001110000', '00011111000', '01111111110', '11111111111', '11111111111'];
  const COLORS = ['#4ade80', '#22d3ee', '#f472b6'];

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function parseFenceAttrs(attrs) {
    const config = {};
    String(attrs || '').split(';').forEach((pair) => {
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

  function renderBlock(source, fenceAttrs, options = {}) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const style = resolveStyle(cfg);
    const title = String(cfg.title || 'Space Invaders').trim() || 'Space Invaders';
    const invadersIndex = Number.isFinite(options.invadersIndex) ? options.invadersIndex : 0;
    const fullscreen = resolveFullscreen(cfg);
    const themeClass = style.theme ? ` invaders-block--${style.theme}` : '';
    const customClass = (style.colorCss || style.bgCss) ? ' invaders-block--custom' : '';
    const fullClass = fullscreen ? ' invaders-block--fullscreen' : '';
    const styleVars = [];
    if (style.colorCss) styleVars.push(`--invaders-accent:${style.colorCss}`);
    if (style.bgCss) styleVars.push(`--invaders-bg:${style.bgCss}`);
    const styleAttr = styleVars.length
      ? ` style="${styleVars.map((v) => escapeHtml(v)).join(';')}"`
      : '';
    const chrome = fullscreen ? '' : [
      `<div class="invaders-block-header">`,
      `<div class="invaders-block-title">${escapeHtml(title)}</div>`,
      `<div class="invaders-block-meta">waves · shields · UFO</div>`,
      `</div>`,
      `<p class="invaders-block-hint">← → / A D move · Space / ↑ fire · P pause · R restart</p>`,
    ].join('');
    return [
      `<div class="invaders-block${themeClass}${customClass}${fullClass}"${styleAttr}`
      + ` data-invaders-index="${invadersIndex}" tabindex="0">`,
      renderFullscreenButton(),
      chrome,
      `<div class="invaders-stage">`,
      `<canvas class="invaders-canvas" width="${VW}" height="${VH}" aria-label="${escapeHtml(title)}"></canvas>`,
      `</div>`,
      `<div class="invaders-pad" aria-label="Space Invaders controls">`,
      `<button type="button" class="invaders-pad__btn invaders-pad__btn--left" data-act="left" tabindex="-1">◀</button>`,
      `<button type="button" class="invaders-pad__btn invaders-pad__btn--fire" data-act="fire" tabindex="-1">Fire</button>`,
      `<button type="button" class="invaders-pad__btn invaders-pad__btn--right" data-act="right" tabindex="-1">▶</button>`,
      `</div>`,
      `<div class="invaders-status" aria-live="polite">Click to play</div>`,
      `</div>`,
    ].join('');
  }

  function makeBunker(x, y) {
    const cells = BUNKER.map((row) => row.split('').map((ch) => ch === '#'));
    return { x, y, cells, cw: 3, ch: 3 };
  }

  function createGame(el) {
    const canvas = el.querySelector('.invaders-canvas');
    const status = el.querySelector('.invaders-status');
    const pad = el.querySelector('.invaders-pad');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const stars = Array.from({ length: 48 }, () => ({
      x: Math.random() * VW,
      y: Math.random() * VH,
      s: Math.random() * 1.4 + 0.4,
    }));
    const state = {
      player: { x: VW / 2 - 13, y: VH - 42, w: 26, h: 14, cooldown: 0, alive: true },
      bullets: [],
      aliens: [],
      ox: 24,
      oy: 64,
      dir: 1,
      stepAcc: 0,
      stepMs: 640,
      anim: 0,
      ufo: null,
      ufoTimer: 16000,
      shields: [],
      score: 0,
      lives: 3,
      wave: 1,
      over: false,
      reported: false,
      paused: false,
      started: false,
      freeze: 0,
      visible: true,
      raf: 0,
      running: true,
      last: 0,
      keys: { left: false, right: false, fire: false },
    };

    function setStatus(text) {
      if (status) status.textContent = text;
    }

    function reportScore() {
      if (state.reported || state.score <= 0) return;
      state.reported = true;
      const hs = window.NotesProHighscores;
      const improved = hs?.isNewRecord?.('invaders', state.score);
      hs?.submit?.('invaders', state.score, { wave: state.wave, lives: state.lives });
      const suffix = hs?.statusSuffix?.('invaders', state.score) || '';
      setStatus((improved ? 'New high score · ' : '') + `Game over · ${state.score} pts · R restart${suffix}`);
    }

    function living() {
      return state.aliens.filter((a) => a.alive);
    }

    function alienBox(a) {
      return {
        x: state.ox + a.c * STEP_X,
        y: state.oy + a.r * STEP_Y,
        w: ALIEN_W,
        h: ALIEN_H,
      };
    }

    function spawnWave() {
      state.aliens = [];
      for (let r = 0; r < ROWS; r += 1) {
        const type = r === 0 ? 2 : (r < 3 ? 1 : 0);
        for (let c = 0; c < COLS; c += 1) {
          state.aliens.push({ c, r, type, alive: true });
        }
      }
      state.ox = 24;
      state.oy = 56 + Math.min(96, (state.wave - 1) * 14);
      state.dir = 1;
      state.stepMs = Math.max(220, 680 - (state.wave - 1) * 48);
      state.stepAcc = 0;
      state.bullets = state.bullets.filter((b) => b.from === 'player');
      state.ufo = null;
      state.ufoTimer = 12000 + Math.random() * 8000;
    }

    function resetShields() {
      const y = VH - 118;
      const gap = 96;
      const start = 48;
      state.shields = [0, 1, 2, 3].map((i) => makeBunker(start + i * gap, y));
    }

    function hitRect(ax, ay, aw, ah, bx, by, bw, bh) {
      return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
    }

    function destroyShieldAt(px, py, radius) {
      let hit = false;
      state.shields.forEach((b) => {
        b.cells.forEach((row, ry) => {
          row.forEach((on, rx) => {
            if (!on) return;
            const x = b.x + rx * b.cw;
            const y = b.y + ry * b.ch;
            const cx = x + b.cw / 2;
            const cy = y + b.ch / 2;
            if (Math.abs(cx - px) <= radius && Math.abs(cy - py) <= radius) {
              b.cells[ry][rx] = false;
              hit = true;
            }
          });
        });
      });
      return hit;
    }

    function playerFire() {
      if (!state.player.alive || state.player.cooldown > 0) return;
      if (state.bullets.some((b) => b.from === 'player')) return;
      state.bullets.push({
        x: state.player.x + state.player.w / 2 - 1,
        y: state.player.y - 8,
        w: 2,
        h: 10,
        vy: -420,
        from: 'player',
      });
      state.player.cooldown = 180;
    }

    function alienShoot() {
      const live = living();
      if (!live.length) return;
      if (state.bullets.filter((b) => b.from === 'alien').length >= 3) return;
      const cols = {};
      live.forEach((a) => {
        const box = alienBox(a);
        if (!cols[a.c] || box.y > cols[a.c].y) cols[a.c] = { a, y: box.y, x: box.x };
      });
      const shooters = Object.values(cols);
      const pick = shooters[Math.floor(Math.random() * shooters.length)];
      if (!pick) return;
      state.bullets.push({
        x: pick.x + ALIEN_W / 2 - 1.5,
        y: pick.y + ALIEN_H,
        w: 3,
        h: 9,
        vy: 160 + state.wave * 12,
        from: 'alien',
      });
    }

    function killPlayer() {
      if (!state.player.alive) return;
      state.player.alive = false;
      state.freeze = 900;
      state.lives -= 1;
      state.bullets = [];
      if (state.lives <= 0) {
        state.over = true;
        reportScore();
      }
    }

    function loseGround() {
      state.over = true;
      state.lives = 0;
      reportScore();
    }

    function nextWave() {
      state.wave += 1;
      state.score += 250 * state.wave;
      spawnWave();
      resetShields();
    }

    function restart() {
      state.score = 0;
      state.lives = 3;
      state.wave = 1;
      state.over = false;
      state.reported = false;
      state.paused = false;
      state.started = true;
      state.freeze = 0;
      state.player.alive = true;
      state.player.x = VW / 2 - 13;
      spawnWave();
      resetShields();
      setStatus(`Score ${state.score} · Wave ${state.wave}${window.NotesProHighscores?.statusSuffix?.('invaders', 0) || ''}`);
    }

    function drawSprite(rows, ox, oy, scale, color) {
      ctx.fillStyle = color;
      rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x += 1) {
          if (row[x] === '1') ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
        }
      });
    }

    function draw() {
      const sx = canvas.width / VW;
      const sy = canvas.height / VH;
      ctx.setTransform(sx, 0, 0, sy, 0, 0);
      ctx.fillStyle = '#05060d';
      ctx.fillRect(0, 0, VW, VH);
      ctx.fillStyle = '#e2e8f0';
      stars.forEach((st) => {
        ctx.globalAlpha = 0.25 + st.s * 0.4;
        ctx.fillRect(st.x, st.y, st.s, st.s);
      });
      ctx.globalAlpha = 1;

      ctx.fillStyle = '#94a3b8';
      ctx.font = '700 13px ui-monospace, Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`SCORE ${String(state.score).padStart(6, '0')}`, 12, 22);
      ctx.textAlign = 'center';
      ctx.fillText(`WAVE ${state.wave}`, VW / 2, 22);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#fde047';
      ctx.fillText(window.NotesProHighscores?.hudLine?.('invaders', state.score) || 'HI 000000', VW - 12, 22);

      ctx.fillStyle = '#4ade80';
      for (let i = 0; i < state.lives; i += 1) {
        drawSprite(SHIP, 12 + i * 28, VH - 18, 2, '#4ade80');
      }

      state.shields.forEach((b) => {
        ctx.fillStyle = '#4ade80';
        b.cells.forEach((row, ry) => {
          row.forEach((on, rx) => {
            if (!on) return;
            ctx.fillRect(b.x + rx * b.cw, b.y + ry * b.ch, b.cw, b.ch);
          });
        });
      });

      living().forEach((a) => {
        const box = alienBox(a);
        const spr = SPRITES[a.type][state.anim];
        const scale = 2;
        const ox = box.x + (ALIEN_W - spr[0].length * scale) / 2;
        const oy = box.y;
        drawSprite(spr, ox, oy, scale, COLORS[a.type]);
      });

      if (state.ufo) {
        ctx.fillStyle = '#f87171';
        ctx.fillRect(state.ufo.x, 34, 28, 10);
        ctx.fillRect(state.ufo.x + 4, 32, 20, 14);
        ctx.fillStyle = '#fecaca';
        ctx.fillRect(state.ufo.x + 8, 36, 4, 4);
        ctx.fillRect(state.ufo.x + 16, 36, 4, 4);
      }

      if (state.player.alive) {
        drawSprite(SHIP, state.player.x, state.player.y, 2, '#e2e8f0');
      } else if (!state.over) {
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(state.player.x + 4, state.player.y + 2, 18, 10);
      }

      state.bullets.forEach((b) => {
        ctx.fillStyle = b.from === 'player' ? '#f8fafc' : '#fb7185';
        ctx.fillRect(b.x, b.y, b.w, b.h);
      });

      ctx.fillStyle = '#22c55e';
      ctx.fillRect(0, VH - 22, VW, 2);

      if (state.paused && !state.over) {
        ctx.fillStyle = 'rgba(5, 6, 13, 0.55)';
        ctx.fillRect(0, 0, VW, VH);
        ctx.fillStyle = '#f8fafc';
        ctx.font = '700 28px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('PAUSED', VW / 2, VH / 2);
      }
      if (state.over) {
        ctx.fillStyle = 'rgba(5, 6, 13, 0.62)';
        ctx.fillRect(0, 0, VW, VH);
        ctx.fillStyle = '#f8fafc';
        ctx.font = '700 22px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('GAME OVER', VW / 2, VH / 2 - 48);
        window.NotesProHighscores?.drawBoard?.(ctx, {
          game: 'invaders',
          x: VW / 2,
          y: VH / 2 - 16,
          currentScore: state.score,
          maxRows: 5,
          color: '#e2e8f0',
        });
      }
      if (!state.started && !state.over) {
        ctx.fillStyle = 'rgba(5, 6, 13, 0.35)';
        ctx.fillRect(0, 0, VW, VH);
        ctx.fillStyle = '#e2e8f0';
        ctx.font = '700 18px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('CLICK TO PLAY', VW / 2, VH / 2);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    function tick(now) {
      if (!state.running) return;
      state.raf = requestAnimationFrame(tick);
      if (!state.visible) return;
      const dt = Math.min(40, now - (state.last || now));
      state.last = now;
      if (state.started && !state.paused && !state.over) {
        if (state.freeze > 0) {
          state.freeze -= dt;
          if (state.freeze <= 0 && state.lives > 0) {
            state.player.alive = true;
            state.player.x = VW / 2 - 13;
            state.bullets = [];
          }
        } else {
          const speed = 210;
          if (state.keys.left) state.player.x -= speed * dt / 1000;
          if (state.keys.right) state.player.x += speed * dt / 1000;
          state.player.x = Math.max(8, Math.min(VW - state.player.w - 8, state.player.x));
          state.player.cooldown = Math.max(0, state.player.cooldown - dt);
          if (state.keys.fire) playerFire();

          const liveCount = living().length;
          const pace = liveCount ? Math.max(90, state.stepMs * (liveCount / (COLS * ROWS))) : state.stepMs;
          state.stepAcc += dt;
          if (state.stepAcc >= pace) {
            state.stepAcc = 0;
            state.anim = state.anim ? 0 : 1;
            const live = living();
            if (!live.length) {
              nextWave();
            } else {
              let minX = 9999;
              let maxX = 0;
              let maxY = 0;
              live.forEach((a) => {
                const box = alienBox(a);
                minX = Math.min(minX, box.x);
                maxX = Math.max(maxX, box.x + box.w);
                maxY = Math.max(maxY, box.y + box.h);
              });
              if (minX + state.dir * 12 < 6 || maxX + state.dir * 12 > VW - 6) {
                state.oy += 16;
                state.dir *= -1;
                if (maxY + 16 >= state.player.y) loseGround();
              } else {
                state.ox += state.dir * 12;
              }
              if (Math.random() < 0.42) alienShoot();
              live.forEach((a) => {
                const box = alienBox(a);
                destroyShieldAt(box.x + box.w / 2, box.y + box.h, 10);
                if (box.y + box.h >= state.player.y) loseGround();
              });
            }
          }

          state.ufoTimer -= dt;
          if (!state.ufo && state.ufoTimer <= 0 && living().length) {
            const left = Math.random() < 0.5;
            state.ufo = {
              x: left ? -32 : VW + 4,
              vx: left ? 90 : -90,
              pts: UFO_PTS[Math.floor(Math.random() * UFO_PTS.length)],
            };
            state.ufoTimer = 14000 + Math.random() * 10000;
          }
          if (state.ufo) {
            state.ufo.x += state.ufo.vx * dt / 1000;
            if (state.ufo.x < -40 || state.ufo.x > VW + 20) state.ufo = null;
          }

          state.bullets.forEach((b) => {
            b.y += b.vy * dt / 1000;
          });
          state.bullets = state.bullets.filter((b) => {
            if (b.y < 20 || b.y > VH - 24) return false;
            if (destroyShieldAt(b.x + b.w / 2, b.y + b.h / 2, b.from === 'player' ? 4 : 5)) return false;
            if (b.from === 'player') {
              if (state.ufo && hitRect(b.x, b.y, b.w, b.h, state.ufo.x, 32, 28, 14)) {
                state.score += state.ufo.pts;
                state.ufo = null;
                return false;
              }
              for (const a of state.aliens) {
                if (!a.alive) continue;
                const box = alienBox(a);
                if (hitRect(b.x, b.y, b.w, b.h, box.x, box.y, box.w, box.h)) {
                  a.alive = false;
                  state.score += PTS[a.type] || 10;
                  return false;
                }
              }
            } else if (state.player.alive && hitRect(b.x, b.y, b.w, b.h, state.player.x, state.player.y, state.player.w, state.player.h)) {
              killPlayer();
              return false;
            }
            return true;
          });
          if (state.aliens.length && !living().length) nextWave();
        }
        setStatus(`Score ${state.score} · Wave ${state.wave} · Lives ${state.lives}${window.NotesProHighscores?.statusSuffix?.('invaders', state.score) || ''}`);
      }
      draw();
    }

    function fitCanvas() {
      const stage = el.querySelector('.invaders-stage');
      const maxW = Math.max(280, stage?.clientWidth || VW);
      const maxH = Math.max(320, stage?.clientHeight || VH);
      const scale = Math.max(0.55, Math.min(maxW / VW, maxH / VH));
      canvas.width = Math.round(VW * scale);
      canvas.height = Math.round(VH * scale);
    }

    function startIfNeeded() {
      if (!state.started) restart();
    }

    function onKeyDown(event) {
      const tag = String(event.target?.tagName || '');
      if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return;
      const k = event.key;
      if (k === 'r' || k === 'R') {
        event.preventDefault();
        restart();
        return;
      }
      if (k === 'p' || k === 'P') {
        event.preventDefault();
        startIfNeeded();
        if (!state.over) state.paused = !state.paused;
        setStatus(state.paused ? 'Paused' : `Score ${state.score} · Wave ${state.wave}`);
        return;
      }
      startIfNeeded();
      if (state.over || state.paused) return;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') {
        event.preventDefault();
        state.keys.left = true;
      } else if (k === 'ArrowRight' || k === 'd' || k === 'D') {
        event.preventDefault();
        state.keys.right = true;
      } else if (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W') {
        event.preventDefault();
        state.keys.fire = true;
        playerFire();
      }
    }

    function onKeyUp(event) {
      const k = event.key;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') state.keys.left = false;
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') state.keys.right = false;
      else if (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W') state.keys.fire = false;
    }

    function syncPad() {
      if (!pad) return;
      const mobile = parentIsMobile();
      el.classList.toggle('invaders-block--mobile', mobile);
      pad.classList.toggle('is-visible', mobile);
    }

    function bindPad() {
      if (!pad) return;
      pad.querySelectorAll('[data-act]').forEach((btn) => {
        const act = btn.getAttribute('data-act');
        const down = (event) => {
          event.preventDefault();
          el.focus({ preventScroll: true });
          startIfNeeded();
          try { btn.setPointerCapture(event.pointerId); } catch (_) { /* ignore */ }
          if (act === 'left') state.keys.left = true;
          else if (act === 'right') state.keys.right = true;
          else if (act === 'fire') {
            state.keys.fire = true;
            playerFire();
          }
        };
        const up = (event) => {
          event.preventDefault();
          if (act === 'left') state.keys.left = false;
          if (act === 'right') state.keys.right = false;
          if (act === 'fire') state.keys.fire = false;
        };
        btn.addEventListener('pointerdown', down);
        btn.addEventListener('pointerup', up);
        btn.addEventListener('pointercancel', up);
        btn.addEventListener('lostpointercapture', up);
        btn.addEventListener('contextmenu', (event) => event.preventDefault());
      });
    }

    function onPointerDown(event) {
      if (event.target.closest?.('.invaders-pad')) return;
      el.focus({ preventScroll: true });
      if (!state.started || state.over) restart();
    }

    fitCanvas();
    syncPad();
    bindPad();
    draw();
    el.addEventListener('keydown', onKeyDown);
    el.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('pointerdown', onPointerDown);
    const onResize = () => {
      fitCanvas();
      syncPad();
      draw();
    };
    window.addEventListener('resize', onResize);
    const io = new IntersectionObserver((entries) => {
      state.visible = entries.some((e) => e.isIntersecting);
    }, { threshold: 0.05 });
    io.observe(el);
    state.raf = requestAnimationFrame(tick);

    return {
      destroy() {
        state.running = false;
        cancelAnimationFrame(state.raf);
        el.removeEventListener('keydown', onKeyDown);
        el.removeEventListener('keyup', onKeyUp);
        canvas.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('resize', onResize);
        io.disconnect();
      },
    };
  }

  function hydrateBlock(el) {
    if (!el) return;
    bindFullscreenButton(el);
    if (el._invadersGame?.destroy) el._invadersGame.destroy();
    el._invadersGame = createGame(el);
  }

  function hydrate(root) {
    (root || document).querySelectorAll('.invaders-block[data-invaders-index]').forEach(hydrateBlock);
  }

  return {
    parseFenceAttrs,
    renderBlock,
    hydrateBlock,
    hydrate,
  };
}));
