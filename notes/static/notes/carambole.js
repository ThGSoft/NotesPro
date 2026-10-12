/**
 * NotesPro ```carambole``` block — three-ball carom billiards.
 * Libre: the cue ball must touch both other balls.
 * 3-cushion: it must also meet three rails before the second ball.
 */
(function (root, factory) {
  const api = factory();
  root.NotesProCarambole = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];
  const RAIL = 28;
  const PW = 640;
  const PH = 320;
  const VW = PW + RAIL * 2;
  const VH = PH + RAIL * 2;
  const R = 12.5;
  const FRICTION = 150;
  const REST_RAIL = 0.86;
  const REST_BALL = 0.98;
  const MAX_SPEED = 980;
  const STOP = 8;
  const COLORS = { W: '#f8fafc', Y: '#facc15', R: '#ef4444' };

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

  function resolveDifficulty(cfg) {
    const raw = String(cfg.difficulty || cfg.diff || 'medium').toLowerCase();
    if (raw === 'easy' || raw === 'hard') return raw;
    return 'medium';
  }

  function resolveMode(cfg) {
    const raw = String(cfg.mode || 'cpu').toLowerCase();
    return raw === 'hotseat' || raw === '2p' || raw === 'pvp' ? 'hotseat' : 'cpu';
  }

  function resolveVariant(cfg) {
    const raw = String(cfg.variant || cfg.rules || 'libre').toLowerCase();
    if (raw === 'cushion' || raw === '3cushion' || raw === '3band' || raw === 'three' || raw === 'bandes') return 'cushion';
    return 'libre';
  }

  function resolveTarget(cfg) {
    const n = parseInt(cfg.target || cfg.to || '5', 10);
    if (!Number.isFinite(n)) return 5;
    return Math.max(1, Math.min(21, n));
  }

  function opening() {
    return [
      { id: 'W', x: PW * 0.25, y: PH * 0.68, vx: 0, vy: 0 },
      { id: 'Y', x: PW * 0.50, y: PH * 0.50, vx: 0, vy: 0 },
      { id: 'R', x: PW * 0.75, y: PH * 0.50, vx: 0, vy: 0 },
    ];
  }

  function cloneBalls(balls) {
    return balls.map((b) => ({ id: b.id, x: b.x, y: b.y, vx: b.vx, vy: b.vy }));
  }

  function ballById(balls, id) {
    return balls.find((b) => b.id === id);
  }

  function speed(ball) {
    return Math.hypot(ball.vx, ball.vy);
  }

  function stopped(balls) {
    return balls.every((b) => speed(b) < STOP);
  }

  function freshTrack() {
    return { hits: {}, cushions: 0, done: false };
  }

  function objectIds(cueId) {
    return ['W', 'Y', 'R'].filter((id) => id !== (cueId || 'W'));
  }

  function cueBallId(mode, shooter) {
    return mode === 'cpu' ? 'W' : shooter;
  }

  function isCarom(track, variant, cueId) {
    const need = objectIds(cueId || 'W');
    if (!track || !track.hits || !need.every((id) => track.hits[id])) return false;
    if (variant === 'cushion') return track.cushions >= 3;
    return true;
  }

  function clampInside(ball) {
    if (ball.x < R) ball.x = R;
    if (ball.x > PW - R) ball.x = PW - R;
    if (ball.y < R) ball.y = R;
    if (ball.y > PH - R) ball.y = PH - R;
  }

  function bounceRails(ball, cueId, track) {
    let hit = 0;
    if (ball.x < R) {
      ball.x = R;
      if (ball.vx < 0) {
        ball.vx = -ball.vx * REST_RAIL;
        hit += 1;
      }
    } else if (ball.x > PW - R) {
      ball.x = PW - R;
      if (ball.vx > 0) {
        ball.vx = -ball.vx * REST_RAIL;
        hit += 1;
      }
    }
    if (ball.y < R) {
      ball.y = R;
      if (ball.vy < 0) {
        ball.vy = -ball.vy * REST_RAIL;
        hit += 1;
      }
    } else if (ball.y > PH - R) {
      ball.y = PH - R;
      if (ball.vy > 0) {
        ball.vy = -ball.vy * REST_RAIL;
        hit += 1;
      }
    }
    if (hit && ball.id === cueId && track && !track.done) track.cushions += hit;
  }

  function applyFriction(ball, dt) {
    const sp = speed(ball);
    if (sp < STOP) {
      ball.vx = 0;
      ball.vy = 0;
      return;
    }
    const next = Math.max(0, sp - FRICTION * dt);
    const scale = next / sp;
    ball.vx *= scale;
    ball.vy *= scale;
    if (next < STOP) {
      ball.vx = 0;
      ball.vy = 0;
    }
  }

  function collidePair(a, b) {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let dist = Math.hypot(dx, dy);
    const min = R * 2;
    if (dist >= min) return false;
    if (dist < 1e-6) {
      dx = 1;
      dy = 0;
      dist = 1;
    }
    const nx = dx / dist;
    const ny = dy / dist;
    const overlap = min - Math.min(dist, min);
    a.x -= nx * overlap * 0.5;
    a.y -= ny * overlap * 0.5;
    b.x += nx * overlap * 0.5;
    b.y += ny * overlap * 0.5;
    const approach = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
    if (approach <= 0) return false;
    const impulse = ((1 + REST_BALL) * approach) / 2;
    a.vx -= impulse * nx;
    a.vy -= impulse * ny;
    b.vx += impulse * nx;
    b.vy += impulse * ny;
    return true;
  }

  function step(balls, dt, cueId, track) {
    const slices = 4;
    const h = dt / slices;
    for (let s = 0; s < slices; s += 1) {
      balls.forEach((ball) => {
        ball.x += ball.vx * h;
        ball.y += ball.vy * h;
        bounceRails(ball, cueId, track);
        applyFriction(ball, h);
      });
      for (let i = 0; i < balls.length; i += 1) {
        for (let j = i + 1; j < balls.length; j += 1) {
          const a = balls[i];
          const b = balls[j];
          if (!collidePair(a, b)) continue;
          const other = a.id === cueId ? b : b.id === cueId ? a : null;
          if (other && track && !track.hits[other.id]) {
            track.hits[other.id] = true;
            if (objectIds(cueId).every((id) => track.hits[id])) track.done = true;
          }
        }
      }
      balls.forEach(clampInside);
    }
  }

  function shootResult(balls, cueId, vx, vy, variant) {
    const sim = cloneBalls(balls);
    const cue = ballById(sim, cueId);
    const sp = Math.hypot(vx, vy) || 1;
    const scale = Math.min(1, MAX_SPEED / sp);
    cue.vx = vx * scale;
    cue.vy = vy * scale;
    const track = freshTrack();
    for (let i = 0; i < 720; i += 1) {
      step(sim, 1 / 60, cueId, track);
      if (isCarom(track, variant, cueId) || stopped(sim)) break;
    }
    return { balls: sim, track, scored: isCarom(track, variant, cueId) };
  }

  function cpuShot(balls, cueId, variant, difficulty) {
    const cue = ballById(balls, cueId);
    const targets = balls.filter((b) => b.id !== cueId);
    const speeds = difficulty === 'easy' ? [460, 720] : difficulty === 'hard' ? [380, 560, 760, 920] : [440, 660, 860];
    const samples = [];
    targets.forEach((target) => {
      const base = Math.atan2(target.y - cue.y, target.x - cue.x);
      const spread = difficulty === 'easy' ? 0.28 : difficulty === 'hard' ? 0.62 : 0.42;
      const steps = difficulty === 'easy' ? 5 : difficulty === 'hard' ? 9 : 7;
      for (let i = 0; i < steps; i += 1) {
        const ang = base + ((i / (steps - 1)) - 0.5) * spread;
        speeds.forEach((sp) => samples.push({ vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp }));
      }
      if (difficulty !== 'easy') {
        [
          { x: target.x, y: -target.y },
          { x: target.x, y: 2 * PH - target.y },
          { x: -target.x, y: target.y },
          { x: 2 * PW - target.x, y: target.y },
        ].forEach((ghost) => {
          const ang = Math.atan2(ghost.y - cue.y, ghost.x - cue.x);
          speeds.slice(0, difficulty === 'hard' ? 4 : 2).forEach((sp) => {
            samples.push({ vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp });
          });
        });
      }
    });
    let best = { vx: 520, vy: 40 };
    let bestScore = -1;
    samples.forEach((shot) => {
      const res = shootResult(balls, cueId, shot.vx, shot.vy, variant);
      let score = 0;
      if (res.scored) score = 1000 - Math.hypot(shot.vx, shot.vy) * 0.05;
      else {
        objectIds(cueId).forEach((id) => {
          if (res.track.hits[id]) score += 24;
        });
        if (variant === 'cushion') score += Math.min(res.track.cushions, 3) * 10;
      }
      if (score > bestScore) {
        bestScore = score;
        best = shot;
      }
    });
    if (difficulty !== 'hard') {
      const jitter = difficulty === 'easy' ? 0.14 : 0.06;
      const ang = Math.atan2(best.vy, best.vx) + (Math.random() - 0.5) * jitter;
      const sp = Math.hypot(best.vx, best.vy);
      best = { vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp };
    }
    return best;
  }

  function resultPoints(difficulty, variant, caroms) {
    const mult = difficulty === 'hard' ? 3 : difficulty === 'easy' ? 1 : 2;
    const stake = variant === 'cushion' ? 2 : 1;
    return Math.max(150, 2200 * mult * stake + caroms * 90);
  }

  function renderBlock(source, fenceAttrs, options = {}) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const style = resolveStyle(cfg);
    const title = String(cfg.title || 'Carambole').trim() || 'Carambole';
    const mode = resolveMode(cfg);
    const difficulty = resolveDifficulty(cfg);
    const variant = resolveVariant(cfg);
    const target = resolveTarget(cfg);
    const gameIndex = Number.isFinite(options.caramboleIndex) ? options.caramboleIndex : 0;
    const fullscreen = resolveFullscreen(cfg);
    const themeClass = style.theme ? ` carambole-block--${style.theme}` : '';
    const customClass = (style.colorCss || style.bgCss) ? ' carambole-block--custom' : '';
    const fullClass = fullscreen ? ' carambole-block--fullscreen' : '';
    const styleVars = [];
    if (style.colorCss) styleVars.push(`--carambole-accent:${style.colorCss}`);
    if (style.bgCss) styleVars.push(`--carambole-bg:${style.bgCss}`);
    const styleAttr = styleVars.length ? ` style="${styleVars.map((v) => escapeHtml(v)).join(';')}"` : '';
    const meta = `${variant === 'cushion' ? '3-cushion' : 'libre'} · ${mode === 'cpu' ? `vs CPU · ${difficulty}` : '2 players'}`;
    const chrome = fullscreen ? '' : [
      `<div class="carambole-block-header">`,
      `<div class="carambole-block-title">${escapeHtml(title)}</div>`,
      `<div class="carambole-block-meta">${escapeHtml(meta)}</div>`,
      `</div>`,
    ].join('');
    return [
      `<div class="carambole-block${themeClass}${customClass}${fullClass}"${styleAttr}`,
      ` data-carambole-index="${gameIndex}"`,
      ` data-carambole-mode="${mode}"`,
      ` data-carambole-difficulty="${difficulty}"`,
      ` data-carambole-variant="${variant}"`,
      ` data-carambole-target="${target}" tabindex="0">`,
      window.NotesProGameFullscreen?.renderButton?.() || '',
      chrome,
      `<div class="carambole-play-area">`,
      `<div class="carambole-toolbar" role="toolbar" aria-label="Carambole options">`,
      `<button type="button" class="carambole-chip${mode === 'cpu' ? ' is-active' : ''}" data-mode="cpu">CPU</button>`,
      `<button type="button" class="carambole-chip${mode === 'hotseat' ? ' is-active' : ''}" data-mode="hotseat">2 players</button>`,
      `<span class="carambole-toolbar-gap" aria-hidden="true"></span>`,
      `<button type="button" class="carambole-chip${variant === 'libre' ? ' is-active' : ''}" data-variant="libre">Libre</button>`,
      `<button type="button" class="carambole-chip${variant === 'cushion' ? ' is-active' : ''}" data-variant="cushion">3-cushion</button>`,
      `<span class="carambole-toolbar-gap" aria-hidden="true"></span>`,
      `<button type="button" class="carambole-chip carambole-chip--diff${difficulty === 'easy' ? ' is-active' : ''}" data-diff="easy">Easy</button>`,
      `<button type="button" class="carambole-chip carambole-chip--diff${difficulty === 'medium' ? ' is-active' : ''}" data-diff="medium">Med</button>`,
      `<button type="button" class="carambole-chip carambole-chip--diff${difficulty === 'hard' ? ' is-active' : ''}" data-diff="hard">Hard</button>`,
      `</div>`,
      `<div class="carambole-score" aria-live="polite">`,
      `<span data-score="w">White 0</span><span data-target>to ${target}</span><span data-score="y">Yellow 0</span>`,
      `</div>`,
      `<div class="carambole-stage">`,
      `<canvas class="carambole-canvas" width="${VW}" height="${VH}" aria-label="${escapeHtml(title)}"></canvas>`,
      `</div>`,
      `<p class="carambole-hint">Drag back from the cue ball, then release to shoot.</p>`,
      `<div class="carambole-actions">`,
      `<button type="button" class="btn btn-sm btn-outline-light" data-action="new">New game</button>`,
      `</div>`,
      `</div>`,
      `<div class="carambole-status" aria-live="polite"></div>`,
      `</div>`,
    ].join('');
  }

  function setStatus(el, text, kind) {
    const status = el.querySelector('.carambole-status');
    if (!status) return;
    status.textContent = text || '';
    status.className = 'carambole-status' + (kind ? ` carambole-status--${kind}` : '');
  }

  function diamond(ctx, x, y) {
    ctx.beginPath();
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x + 3.2, y);
    ctx.lineTo(x, y + 4);
    ctx.lineTo(x - 3.2, y);
    ctx.closePath();
    ctx.fill();
  }

  function drawTable(ctx) {
    const wood = ctx.createLinearGradient(0, 0, 0, VH);
    wood.addColorStop(0, '#a56b3c');
    wood.addColorStop(0.5, '#6b3e1e');
    wood.addColorStop(1, '#3f2412');
    ctx.fillStyle = wood;
    ctx.fillRect(0, 0, VW, VH);
    const cloth = ctx.createLinearGradient(RAIL, RAIL, RAIL, RAIL + PH);
    cloth.addColorStop(0, '#15944a');
    cloth.addColorStop(1, '#0c6b34');
    ctx.fillStyle = cloth;
    ctx.fillRect(RAIL, RAIL, PW, PH);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.lineWidth = 3;
    ctx.strokeRect(RAIL + 1.5, RAIL + 1.5, PW - 3, PH - 3);
    ctx.fillStyle = '#f6e7c1';
    for (let i = 1; i <= 7; i += 1) {
      const x = RAIL + (PW * i) / 8;
      diamond(ctx, x, RAIL * 0.5);
      diamond(ctx, x, VH - RAIL * 0.5);
    }
    for (let i = 1; i <= 3; i += 1) {
      const y = RAIL + (PH * i) / 4;
      diamond(ctx, RAIL * 0.5, y);
      diamond(ctx, VW - RAIL * 0.5, y);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(RAIL + PW * 0.25, RAIL + 8);
    ctx.lineTo(RAIL + PW * 0.25, RAIL + PH - 8);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    [0.25, 0.5, 0.75].forEach((t) => {
      ctx.beginPath();
      ctx.arc(RAIL + PW * t, RAIL + PH * 0.5, 2.6, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawBall(ctx, ball, cue) {
    const x = RAIL + ball.x;
    const y = RAIL + ball.y;
    if (cue) {
      ctx.beginPath();
      ctx.arc(x, y, R + 4, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(254, 240, 138, 0.95)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    const g = ctx.createRadialGradient(x - R * 0.35, y - R * 0.4, 1.5, x, y, R);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.42, COLORS[ball.id] || '#fff');
    g.addColorStop(1, ball.id === 'W' ? '#cbd5e1' : ball.id === 'Y' ? '#a16207' : '#7f1d1d');
    ctx.beginPath();
    ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.stroke();
  }

  function drawAim(ctx, cue, pointer) {
    const dx = cue.x - pointer.x;
    const dy = cue.y - pointer.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const power = Math.min(MAX_SPEED, Math.max(0, (len - R * 1.5) * 6.2));
    const x = RAIL + cue.x;
    const y = RAIL + cue.y;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.setLineDash([5, 6]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + ux * (R + 2), y + uy * (R + 2));
    ctx.lineTo(x + ux * (R + 16 + power * 0.11), y + uy * (R + 16 + power * 0.11));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = '#f3d2a4';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - ux * (R + 8), y - uy * (R + 8));
    ctx.lineTo(x - ux * (R + 78 + power * 0.03), y - uy * (R + 78 + power * 0.03));
    ctx.stroke();
    ctx.restore();
    return power;
  }

  function paint(ctx, balls, shooter, aim) {
    drawTable(ctx);
    if (aim) {
      const cue = ballById(balls, shooter);
      if (cue) drawAim(ctx, cue, aim);
    }
    balls.forEach((ball) => drawBall(ctx, ball, ball.id === shooter));
  }

  function toPlayfield(event, canvas) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * sx - RAIL,
      y: (event.clientY - rect.top) * sy - RAIL,
    };
  }

  function hydrateBlock(el) {
    if (!el || el.dataset.caramboleHydrated === '1') return;
    el.dataset.caramboleHydrated = '1';
    window.NotesProGameFullscreen?.bind?.(el);
    const canvas = el.querySelector('.carambole-canvas');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let mode = el.dataset.caramboleMode === 'hotseat' ? 'hotseat' : 'cpu';
    let difficulty = resolveDifficulty({ difficulty: el.dataset.caramboleDifficulty });
    let variant = el.dataset.caramboleVariant === 'cushion' ? 'cushion' : 'libre';
    const target = resolveTarget({ target: el.dataset.caramboleTarget });
    let balls = opening();
    let shooter = 'W';
    let scoreW = 0;
    let scoreY = 0;
    let phase = 'aim';
    let track = freshTrack();
    let aim = null;
    let dragging = false;
    let cpuTimer = null;
    let scoredThis = false;
    let raf = 0;
    let last = 0;

    function sideName(id) {
      if (mode === 'cpu') return id === 'W' ? 'You' : 'CPU';
      return id === 'W' ? 'White' : 'Yellow';
    }

    function syncChrome(text, kind) {
      el.querySelectorAll('[data-mode]').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.mode === mode);
      });
      el.querySelectorAll('[data-variant]').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.variant === variant);
      });
      el.querySelectorAll('[data-diff]').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.diff === difficulty);
        btn.hidden = mode !== 'cpu';
      });
      const wEl = el.querySelector('[data-score="w"]');
      const yEl = el.querySelector('[data-score="y"]');
      if (wEl) wEl.textContent = `${mode === 'cpu' ? 'You' : 'White'} ${scoreW}`;
      if (yEl) yEl.textContent = `${mode === 'cpu' ? 'CPU' : 'Yellow'} ${scoreY}`;
      const meta = el.querySelector('.carambole-block-meta');
      if (meta) {
        meta.textContent = `${variant === 'cushion' ? '3-cushion' : 'libre'} · ${mode === 'cpu' ? `vs CPU · ${difficulty}` : '2 players'}`;
      }
      if (text != null) setStatus(el, text, kind);
    }

    function aimHelp() {
      const rule = variant === 'cushion'
        ? 'Touch both balls, with 3 rails before the second.'
        : 'Touch both balls in one shot.';
      if (phase === 'over') return;
      if (mode === 'cpu' && shooter === 'Y') {
        syncChrome('CPU is lining up a shot…', '');
        return;
      }
      syncChrome(`${sideName(shooter)} to shoot. ${rule}`, '');
    }

    function reportWin() {
      const points = resultPoints(difficulty, variant, scoreW);
      window.NotesProHighscores?.submit?.('carambole', points, {
        won: true,
        level: difficulty === 'hard' ? 3 : difficulty === 'easy' ? 1 : 2,
      });
    }

    function finishShot() {
      const scored = isCarom(track, variant, cueBallId(mode, shooter));
      const cushionNote = variant === 'cushion' ? ` · ${track.cushions} cushion${track.cushions === 1 ? '' : 's'}` : '';
      if (scored) {
        if (shooter === 'W') scoreW += 1;
        else scoreY += 1;
        if (scoreW >= target || scoreY >= target) {
          phase = 'over';
          const winner = scoreW >= target ? 'W' : 'Y';
          const youWon = mode === 'cpu' && winner === 'W';
          if (youWon) reportWin();
          syncChrome(`${sideName(winner)} wins ${Math.max(scoreW, scoreY)}–${Math.min(scoreW, scoreY)}.`, youWon || winner === 'W' ? 'success' : 'warn');
          return;
        }
        syncChrome(`Carom${cushionNote}. ${sideName(shooter)} shoots again.`, 'success');
      } else {
        shooter = shooter === 'W' ? 'Y' : 'W';
        syncChrome(`Miss${cushionNote}. ${sideName(shooter)} to shoot.`, 'info');
      }
      phase = 'aim';
      track = freshTrack();
      scoredThis = false;
      scheduleCpu();
    }

    function beginShot(vx, vy) {
      if (phase !== 'aim') return;
      const cue = ballById(balls, cueBallId(mode, shooter));
      const sp = Math.hypot(vx, vy);
      if (!cue || sp < 90) return;
      const scale = Math.min(1, MAX_SPEED / sp);
      cue.vx = vx * scale;
      cue.vy = vy * scale;
      track = freshTrack();
      phase = 'rolling';
      aim = null;
      dragging = false;
      syncChrome(variant === 'cushion' ? 'Rolling…' : 'Rolling…', '');
    }

    function scheduleCpu() {
      clearTimeout(cpuTimer);
      if (mode !== 'cpu' || shooter !== 'Y' || phase !== 'aim') return;
      cpuTimer = setTimeout(() => {
        if (!el.isConnected || phase !== 'aim' || shooter !== 'Y') return;
        const cue = ballById(balls, 'W');
        const shot = cpuShot(balls, 'W', variant, difficulty);
        const sp = Math.hypot(shot.vx, shot.vy) || 1;
        const pull = 78;
        aim = cue
          ? { x: cue.x - (shot.vx / sp) * pull, y: cue.y - (shot.vy / sp) * pull }
          : null;
        cpuTimer = setTimeout(() => {
          if (!el.isConnected || phase !== 'aim' || shooter !== 'Y') return;
          beginShot(shot.vx, shot.vy);
        }, 420);
      }, 480);
    }

    function newGame() {
      clearTimeout(cpuTimer);
      balls = opening();
      shooter = 'W';
      scoreW = 0;
      scoreY = 0;
      phase = 'aim';
      track = freshTrack();
      aim = null;
      dragging = false;
      aimHelp();
    }

    function frame(now) {
      if (!el.isConnected) return;
      const dt = Math.min(0.034, last ? (now - last) / 1000 : 0.016);
      last = now;
      if (phase === 'rolling') {
        const rollingCue = cueBallId(mode, shooter);
        step(balls, dt, rollingCue, track);
        if (!scoredThis && isCarom(track, variant, rollingCue)) scoredThis = true;
        if (stopped(balls)) finishShot();
        else if (variant === 'cushion') {
          const hit = Object.keys(track.hits).length;
          syncChrome(`Cushions ${track.cushions} · balls hit ${hit}`, '');
        }
      }
      const cueId = cueBallId(mode, shooter);
      let shownAim = null;
      const humanTurn = mode === 'hotseat' || shooter === 'W';
      if (phase === 'aim' && humanTurn) {
        const cue = ballById(balls, cueId);
        shownAim = aim || (cue ? { x: cue.x - 72, y: cue.y } : null);
      } else if (phase === 'aim' && aim) {
        shownAim = aim;
      }
      paint(ctx, balls, cueId, shownAim);
      raf = window.requestAnimationFrame(frame);
    }

    canvas.addEventListener('pointerdown', (event) => {
      if (phase !== 'aim') return;
      if (mode === 'cpu' && shooter !== 'W') return;
      dragging = true;
      aim = toPlayfield(event, canvas);
      canvas.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!dragging || phase !== 'aim') return;
      aim = toPlayfield(event, canvas);
    });
    function release(event) {
      if (!dragging) return;
      dragging = false;
      const pointer = toPlayfield(event, canvas);
      const cue = ballById(balls, cueBallId(mode, shooter));
      if (!cue || phase !== 'aim') {
        aim = null;
        return;
      }
      const dx = cue.x - pointer.x;
      const dy = cue.y - pointer.y;
      const len = Math.hypot(dx, dy) || 1;
      const power = Math.min(MAX_SPEED, Math.max(0, (len - R * 1.5) * 6.2));
      aim = null;
      if (power < 90) return;
      beginShot((dx / len) * power, (dy / len) * power);
    }
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', () => {
      dragging = false;
      aim = null;
    });

    el.addEventListener('click', (event) => {
      const modeBtn = event.target.closest('[data-mode]');
      const variantBtn = event.target.closest('[data-variant]');
      const diffBtn = event.target.closest('[data-diff]');
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (modeBtn) {
        mode = modeBtn.dataset.mode === 'hotseat' ? 'hotseat' : 'cpu';
        newGame();
        return;
      }
      if (variantBtn) {
        variant = variantBtn.dataset.variant === 'cushion' ? 'cushion' : 'libre';
        newGame();
        return;
      }
      if (diffBtn) {
        difficulty = resolveDifficulty({ difficulty: diffBtn.dataset.diff });
        newGame();
        return;
      }
      if (action === 'new') newGame();
    });

    aimHelp();
    raf = window.requestAnimationFrame(frame);
    el.addEventListener('notespro:monitor-fullscreen', () => {
      window.requestAnimationFrame(() => paint(ctx, balls, shooter, aim));
    });
    return () => {
      window.cancelAnimationFrame(raf);
      clearTimeout(cpuTimer);
    };
  }

  function hydrate(root) {
    (root || document).querySelectorAll('.carambole-block[data-carambole-index]').forEach((el) => hydrateBlock(el));
  }

  function selfTest() {
    const fails = [];
    function check(name, ok) {
      if (!ok) fails.push(name);
    }
    const head = [
      { id: 'W', x: 80, y: 160, vx: 640, vy: 0 },
      { id: 'Y', x: 120, y: 160, vx: 0, vy: 0 },
      { id: 'R', x: 520, y: 40, vx: 0, vy: 0 },
    ];
    const headTrack = freshTrack();
    let transferred = false;
    for (let i = 0; i < 40 && !transferred; i += 1) {
      step(head, 1 / 60, 'W', headTrack);
      const yellow = ballById(head, 'Y');
      const white = ballById(head, 'W');
      if (yellow.vx > 280 && white.vx < 160) transferred = true;
    }
    check('head-on transfers speed', transferred);
    check('balls stay on the table', head.every((b) => b.x >= R - 0.1 && b.x <= PW - R + 0.1 && b.y >= R - 0.1 && b.y <= PH - R + 0.1));

    const bank = shootResult([
      { id: 'W', x: 80, y: 160, vx: 0, vy: 0 },
      { id: 'Y', x: 500, y: 160, vx: 0, vy: 0 },
      { id: 'R', x: 520, y: 40, vx: 0, vy: 0 },
    ], 'W', -700, 0, 'libre');
    check('rail counts a cushion', bank.track.cushions >= 1);

    const carom = shootResult([
      { id: 'W', x: 90, y: 160, vx: 0, vy: 0 },
      { id: 'Y', x: 150, y: 146, vx: 0, vy: 0 },
      { id: 'R', x: 168, y: 178, vx: 0, vy: 0 },
    ], 'W', 760, 0, 'libre');
    check('libre carom hits both', carom.scored && carom.track.hits.Y && carom.track.hits.R);
    check('opening is not a carom', !isCarom(freshTrack(), 'libre'));
    check('two cushions is not enough', !isCarom({ hits: { Y: true, R: true }, cushions: 2 }, 'cushion'));
    check('three cushions score', isCarom({ hits: { Y: true, R: true }, cushions: 3 }, 'cushion'));
    check('render', renderBlock('', 'fullscreen;mode=cpu;variant=libre').indexOf('carambole-canvas') > 0);
    check('hard win outscores easy', resultPoints('hard', 'cushion', 5) > resultPoints('easy', 'libre', 5));
    const live = opening();
    const x0 = live[0].x;
    shootResult(live, 'W', 400, 20, 'libre');
    check('simulate leaves the live balls', live[0].x === x0 && live[0].vx === 0);
    check('cpu shoots the white ball', cueBallId('cpu', 'Y') === 'W' && cueBallId('cpu', 'W') === 'W');
    check('two players keep their own ball', cueBallId('hotseat', 'Y') === 'Y');
    const cpuRack = opening();
    const cpuShotVec = cpuShot(cpuRack, cueBallId('cpu', 'Y'), 'libre', 'hard');
    const wBefore = cpuRack[0].x;
    const yBefore = cpuRack[1].x;
    cpuRack[0].vx = cpuShotVec.vx;
    cpuRack[0].vy = cpuShotVec.vy;
    step(cpuRack, 1 / 60, 'W', freshTrack());
    check('cpu tick moves white', Math.hypot(cpuRack[0].x - wBefore, cpuRack[0].y - opening()[0].y) > 2);
    check('cpu tick leaves yellow', Math.abs(cpuRack[1].x - yBefore) < 0.5 && cpuRack[1].vx === 0);
    return fails;
  }

  return {
    parseFenceAttrs,
    renderBlock,
    hydrateBlock,
    hydrate,
    selfTest,
    shootResult,
    isCarom,
    opening,
    cueBallId,
    cpuShot,
  };
}));
