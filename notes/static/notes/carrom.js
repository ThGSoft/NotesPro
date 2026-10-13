/**
 * NotesPro ```carrom``` block — square board, corner pockets, striker.
 * Pocket your colour. Cover the red queen with one of yours before the last coin.
 */
(function (root, factory) {
  const api = factory();
  root.NotesProCarrom = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];
  const BOARD = 520;
  const FRAME = 22;
  const VW = BOARD + FRAME * 2;
  const VH = VW;
  const COIN_R = 11;
  const STRIKER_R = 16;
  const POCKET_R = 22;
  const MOUTH = 32;
  const BASE_IN = 68;
  const BASE_MIN = 86;
  const BASE_MAX = BOARD - 86;
  const BASE_WHITE = BOARD - BASE_IN;
  const BASE_BLACK = BASE_IN;
  const FRICTION = 240;
  const REST_RAIL = 0.62;
  const REST_HIT = 0.94;
  const MAX_SPEED = 920;
  const STOP = 10;
  const COLORS = { W: '#f8fafc', B: '#1e293b', Q: '#dc2626', S: '#f5e6c8' };

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

  function resolveSize(cfg) {
    const raw = String(cfg.size || cfg.width || 'medium').trim().toLowerCase();
    if (raw === 's' || raw === 'small' || raw === 'sm') return { key: 'small', css: '380px', token: 'small' };
    if (raw === 'l' || raw === 'large' || raw === 'lg') return { key: 'large', css: '860px', token: 'large' };
    if (raw === 'm' || raw === 'medium' || raw === 'md' || raw === '') return { key: 'medium', css: '560px', token: 'medium' };
    const pct = raw.match(/^(\d{1,3})%$/);
    if (pct) {
      const n = clamp(parseInt(pct[1], 10), 30, 100);
      return { key: 'custom', css: `${n}vw`, token: `${n}%` };
    }
    const px = parseInt(raw, 10);
    if (Number.isFinite(px) && /^\d/.test(raw)) {
      const n = clamp(px, 280, 1400);
      return { key: 'custom', css: `${n}px`, token: String(n) };
    }
    return { key: 'medium', css: '560px', token: 'medium' };
  }

  function fenceToken(value) {
    return String(value || '').trim().replace(/[;{}]/g, '');
  }

  function buildFenceAttrsString(cfg) {
    const parts = [];
    if (resolveFullscreen(cfg)) parts.push('fullscreen');
    parts.push(`mode=${resolveMode(cfg)}`);
    parts.push(`difficulty=${resolveDifficulty(cfg)}`);
    parts.push(`size=${resolveSize(cfg).token}`);
    const title = fenceToken(cfg.title);
    if (title) parts.push(`title=${title}`);
    const col = fenceToken(cfg.col || cfg.color);
    if (col) parts.push(`col=${col}`);
    const bk = fenceToken(cfg.bkcol || cfg.bgcol || cfg.bg);
    if (bk) parts.push(`bkcol=${bk}`);
    return parts.join(';');
  }

  function other(player) {
    return player === 'W' ? 'B' : 'W';
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function speed(body) {
    return Math.hypot(body.vx, body.vy);
  }

  function cloneBody(body) {
    return {
      id: body.id,
      color: body.color,
      x: body.x,
      y: body.y,
      vx: body.vx,
      vy: body.vy,
      r: body.r,
      mass: body.mass,
      pocketed: !!body.pocketed,
    };
  }

  function openingCoins() {
    const cx = BOARD / 2;
    const cy = BOARD / 2;
    const coins = [];
    function add(color, x, y) {
      coins.push({
        id: color === 'Q' ? 'Q' : `${color}${coins.length}`,
        color,
        x,
        y,
        vx: 0,
        vy: 0,
        r: COIN_R,
        mass: color === 'Q' ? 1.05 : 1,
        pocketed: false,
      });
    }
    add('Q', cx, cy);
    for (let i = 0; i < 6; i += 1) {
      const a = -Math.PI / 2 + (i * Math.PI) / 3;
      add(i % 2 === 0 ? 'W' : 'B', cx + Math.cos(a) * 30, cy + Math.sin(a) * 30);
    }
    for (let i = 0; i < 12; i += 1) {
      const a = (i * Math.PI) / 6 + Math.PI / 12;
      add(i % 2 === 0 ? 'B' : 'W', cx + Math.cos(a) * 56, cy + Math.sin(a) * 56);
    }
    return coins;
  }

  function makeStriker(player, x) {
    return {
      id: 'S',
      color: 'S',
      x: clamp(x, BASE_MIN, BASE_MAX),
      y: player === 'W' ? BASE_WHITE : BASE_BLACK,
      vx: 0,
      vy: 0,
      r: STRIKER_R,
      mass: 1.75,
      pocketed: false,
    };
  }

  function stopped(bodies) {
    return bodies.every((body) => body.pocketed || speed(body) < STOP);
  }

  function tryPocket(ball) {
    const holes = [[0, 0], [BOARD, 0], [0, BOARD], [BOARD, BOARD]];
    for (let i = 0; i < holes.length; i += 1) {
      const d = Math.hypot(ball.x - holes[i][0], ball.y - holes[i][1]);
      if (d < POCKET_R && (speed(ball) > 12 || d < ball.r * 0.85)) {
        ball.pocketed = true;
        ball.vx = 0;
        ball.vy = 0;
        return true;
      }
    }
    return false;
  }

  function inMouth(ball, axis) {
    if (axis === 'x') return ball.y < MOUTH || ball.y > BOARD - MOUTH;
    return ball.x < MOUTH || ball.x > BOARD - MOUTH;
  }

  function bounce(ball) {
    if (ball.x < ball.r && !inMouth(ball, 'x')) {
      ball.x = ball.r;
      if (ball.vx < 0) ball.vx = -ball.vx * REST_RAIL;
    } else if (ball.x > BOARD - ball.r && !inMouth(ball, 'x')) {
      ball.x = BOARD - ball.r;
      if (ball.vx > 0) ball.vx = -ball.vx * REST_RAIL;
    }
    if (ball.y < ball.r && !inMouth(ball, 'y')) {
      ball.y = ball.r;
      if (ball.vy < 0) ball.vy = -ball.vy * REST_RAIL;
    } else if (ball.y > BOARD - ball.r && !inMouth(ball, 'y')) {
      ball.y = BOARD - ball.r;
      if (ball.vy > 0) ball.vy = -ball.vy * REST_RAIL;
    }
    if (ball.x < -ball.r || ball.y < -ball.r || ball.x > BOARD + ball.r || ball.y > BOARD + ball.r) {
      ball.pocketed = true;
      ball.vx = 0;
      ball.vy = 0;
    }
  }

  function collide(a, b) {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let dist = Math.hypot(dx, dy);
    const min = a.r + b.r;
    if (dist >= min) return false;
    if (dist < 1e-6) {
      dx = 1;
      dy = 0;
      dist = 1;
    }
    const nx = dx / dist;
    const ny = dy / dist;
    const overlap = min - dist;
    const share = 1 / (a.mass + b.mass);
    a.x -= nx * overlap * b.mass * share;
    a.y -= ny * overlap * b.mass * share;
    b.x += nx * overlap * a.mass * share;
    b.y += ny * overlap * a.mass * share;
    const approach = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
    if (approach <= 0) return true;
    const impulse = ((1 + REST_HIT) * approach) / ((1 / a.mass) + (1 / b.mass));
    a.vx -= (impulse / a.mass) * nx;
    a.vy -= (impulse / a.mass) * ny;
    b.vx += (impulse / b.mass) * nx;
    b.vy += (impulse / b.mass) * ny;
    return true;
  }

  function friction(ball, dt) {
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

  function step(bodies, dt) {
    const slices = 3;
    const h = dt / slices;
    for (let s = 0; s < slices; s += 1) {
      bodies.forEach((body) => {
        if (body.pocketed) return;
        body.x += body.vx * h;
        body.y += body.vy * h;
      });
      for (let i = 0; i < bodies.length; i += 1) {
        const a = bodies[i];
        if (a.pocketed) continue;
        if (tryPocket(a)) continue;
        bounce(a);
        if (a.pocketed) continue;
        for (let j = i + 1; j < bodies.length; j += 1) {
          const b = bodies[j];
          if (!b.pocketed) collide(a, b);
        }
      }
      bodies.forEach((body) => {
        if (!body.pocketed) friction(body, h);
      });
    }
  }

  function simulate(coins, striker, maxTime) {
    const bodies = coins.filter((coin) => !coin.pocketed).map(cloneBody);
    bodies.push(cloneBody(striker));
    let t = 0;
    const dt = 1 / 60;
    while (t < maxTime && !stopped(bodies)) {
      step(bodies, dt);
      t += dt;
    }
    const sunk = bodies.filter((body) => body.pocketed && body.id !== 'S').map((body) => body.color);
    const foul = !!bodies.find((body) => body.id === 'S' && body.pocketed);
    return { sunk, foul, bodies };
  }

  function applyRules(state) {
    const player = state.player;
    const opp = other(player);
    const pocket = { W: state.pocketW, B: state.pocketB };
    let queen = state.queen;
    const returned = [];
    const sunkOwn = state.sunk.filter((color) => color === player).length;
    const sunkOpp = state.sunk.filter((color) => color === opp).length;
    const sunkQueen = state.sunk.includes('Q');

    if (state.foul) {
      for (let i = 0; i < sunkOwn; i += 1) returned.push(player);
      for (let i = 0; i < sunkOpp; i += 1) returned.push(opp);
      if ((sunkQueen || queen === 'pending') && queen !== 'covered') {
        queen = 'board';
        returned.push('Q');
      }
      if (pocket[player] > 0) {
        pocket[player] -= 1;
        returned.push(player);
      }
      return {
        pocketW: pocket.W,
        pocketB: pocket.B,
        queen,
        player: opp,
        returned,
        continueTurn: false,
        winner: '',
        kind: 'warn',
        text: 'Foul — the striker dropped in.',
      };
    }

    const maxFor = (color) => (queen === 'covered' ? 9 : 8) - pocket[color];
    const keepOwn = Math.max(0, Math.min(sunkOwn, maxFor(player)));
    const keepOpp = Math.max(0, Math.min(sunkOpp, maxFor(opp)));
    pocket[player] += keepOwn;
    pocket[opp] += keepOpp;
    for (let i = 0; i < sunkOwn - keepOwn; i += 1) returned.push(player);
    for (let i = 0; i < sunkOpp - keepOpp; i += 1) returned.push(opp);

    let coveredNow = false;
    if (queen !== 'covered' && (sunkQueen || queen === 'pending') && keepOwn > 0) {
      queen = 'covered';
      coveredNow = true;
    } else if (sunkQueen && queen !== 'covered') {
      queen = 'pending';
    }

    const continueTurn = keepOwn > 0 || (queen === 'pending' && sunkQueen);
    if (!continueTurn && queen === 'pending') {
      queen = 'board';
      returned.push('Q');
    }

    let winner = '';
    if (pocket[player] >= 9 && queen === 'covered') winner = player;
    else if (pocket[opp] >= 9 && queen === 'covered') winner = opp;

    let text = 'Miss.';
    let kind = 'info';
    if (winner) {
      text = winner === player ? 'You cleared the board.' : 'Board cleared.';
      kind = 'success';
    } else if (sunkOwn > keepOwn) {
      text = 'Cover the queen before the last coin.';
      kind = 'warn';
    } else if (coveredNow) {
      text = 'Queen covered.';
      kind = 'success';
    } else if (keepOwn > 0) {
      text = 'Pocketed.';
      kind = 'success';
    } else if (queen === 'pending' && sunkQueen) {
      text = 'Queen is out. Cover it with one of yours.';
      kind = 'warn';
    } else if (keepOpp > 0) {
      text = 'That coin counts for the other side.';
      kind = 'info';
    }

    return {
      pocketW: pocket.W,
      pocketB: pocket.B,
      queen,
      player: winner ? player : (continueTurn ? player : opp),
      returned,
      continueTurn: winner ? false : continueTurn,
      winner,
      kind: winner ? 'success' : kind,
      text,
    };
  }

  function freeSpot(coins, striker, r) {
    const spots = [[BOARD / 2, BOARD / 2]];
    for (let ring = 1; ring <= 7; ring += 1) {
      const rad = 22 * ring;
      const count = 6 + ring;
      for (let i = 0; i < count; i += 1) {
        const a = (i / count) * Math.PI * 2;
        spots.push([BOARD / 2 + Math.cos(a) * rad, BOARD / 2 + Math.sin(a) * rad]);
      }
    }
    for (let i = 0; i < spots.length; i += 1) {
      const x = spots[i][0];
      const y = spots[i][1];
      if (x < r + 36 || y < r + 36 || x > BOARD - r - 36 || y > BOARD - r - 36) continue;
      const hitCoin = coins.some((coin) => !coin.pocketed && Math.hypot(coin.x - x, coin.y - y) < coin.r + r + 2);
      const hitStriker = striker && !striker.pocketed && Math.hypot(striker.x - x, striker.y - y) < striker.r + r + 2;
      if (!hitCoin && !hitStriker) return { x, y };
    }
    return { x: BOARD / 2, y: BOARD / 2 + 40 };
  }

  function resultPoints(difficulty, oppLeft) {
    const mult = difficulty === 'hard' ? 3 : difficulty === 'easy' ? 1 : 2;
    return 700 * mult + oppLeft * 140;
  }

  function cpuShot(coins, player, difficulty) {
    const samples = difficulty === 'hard' ? 28 : difficulty === 'easy' ? 8 : 16;
    const base = player === 'W' ? -Math.PI / 2 : Math.PI / 2;
    let best = null;
    let bestScore = -1e9;
    for (let i = 0; i < samples; i += 1) {
      const x = BASE_MIN + Math.random() * (BASE_MAX - BASE_MIN);
      const ang = base + (Math.random() - 0.5) * Math.PI * 0.86;
      const sp = 320 + Math.random() * 520;
      const striker = makeStriker(player, x);
      striker.vx = Math.cos(ang) * sp;
      striker.vy = Math.sin(ang) * sp;
      const res = simulate(coins, striker, 2.2);
      const own = res.sunk.filter((color) => color === player).length;
      const opp = res.sunk.filter((color) => color === other(player)).length;
      const queen = res.sunk.includes('Q') ? 1 : 0;
      let score = own * 140 + queen * 80 - opp * 12 - (res.foul ? 280 : 0);
      if (own === 0 && queen === 0 && !res.foul) score -= 20;
      if (score > bestScore) {
        bestScore = score;
        best = { x, vx: striker.vx, vy: striker.vy };
      }
    }
    if (!best) {
      const striker = makeStriker(player, BOARD / 2);
      return { x: striker.x, vx: 0, vy: player === 'W' ? -480 : 480 };
    }
    if (difficulty !== 'hard') {
      const jitter = difficulty === 'easy' ? 0.18 : 0.07;
      const ang = Math.atan2(best.vy, best.vx) + (Math.random() - 0.5) * jitter;
      const sp = Math.hypot(best.vx, best.vy);
      best = { x: best.x, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp };
    }
    return best;
  }

  function renderBlock(source, fenceAttrs, options = {}) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const style = resolveStyle(cfg);
    const title = String(cfg.title || 'Carrom').trim() || 'Carrom';
    const mode = resolveMode(cfg);
    const difficulty = resolveDifficulty(cfg);
    const gameIndex = Number.isFinite(options.carromIndex) ? options.carromIndex : 0;
    const fullscreen = resolveFullscreen(cfg);
    const size = resolveSize(cfg);
    const themeClass = style.theme ? ` carrom-block--${style.theme}` : '';
    const customClass = (style.colorCss || style.bgCss) ? ' carrom-block--custom' : '';
    const fullClass = fullscreen ? ' carrom-block--fullscreen' : '';
    const styleVars = [`--carrom-size:${size.css}`];
    if (style.colorCss) styleVars.push(`--carrom-accent:${style.colorCss}`);
    if (style.bgCss) styleVars.push(`--carrom-bg:${style.bgCss}`);
    const styleAttr = styleVars.length ? ` style="${styleVars.map((part) => escapeHtml(part)).join(';')}"` : '';
    const meta = mode === 'cpu' ? `vs CPU · ${difficulty}` : '2 players';
    const chrome = fullscreen ? '' : [
      `<div class="carrom-block-header">`,
      `<div class="carrom-block-title">${escapeHtml(title)}</div>`,
      `<div class="carrom-block-meta">${escapeHtml(meta)}</div>`,
      `</div>`,
    ].join('');
    return [
      `<div class="carrom-block${themeClass}${customClass}${fullClass}"${styleAttr}`,
      ` data-carrom-index="${gameIndex}"`,
      ` data-carrom-mode="${mode}"`,
      ` data-carrom-difficulty="${difficulty}"`,
      ` data-carrom-size="${escapeHtml(size.token)}" tabindex="0">`,
      (typeof window !== 'undefined' ? window.NotesProGameFullscreen?.renderButton?.() : '') || '',
      chrome,
      `<div class="carrom-play-area">`,
      `<div class="carrom-toolbar" role="toolbar" aria-label="Carrom options">`,
      `<button type="button" class="carrom-chip${mode === 'cpu' ? ' is-active' : ''}" data-mode="cpu">CPU</button>`,
      `<button type="button" class="carrom-chip${mode === 'hotseat' ? ' is-active' : ''}" data-mode="hotseat">2 players</button>`,
      `<span class="carrom-toolbar-gap" aria-hidden="true"></span>`,
      `<button type="button" class="carrom-chip carrom-chip--diff${difficulty === 'easy' ? ' is-active' : ''}" data-diff="easy">Easy</button>`,
      `<button type="button" class="carrom-chip carrom-chip--diff${difficulty === 'medium' ? ' is-active' : ''}" data-diff="medium">Med</button>`,
      `<button type="button" class="carrom-chip carrom-chip--diff${difficulty === 'hard' ? ' is-active' : ''}" data-diff="hard">Hard</button>`,
      `<span class="carrom-toolbar-gap" aria-hidden="true"></span>`,
      `<button type="button" class="carrom-chip${size.key === 'small' ? ' is-active' : ''}" data-size="small" title="Small board">Small</button>`,
      `<button type="button" class="carrom-chip${size.key === 'medium' ? ' is-active' : ''}" data-size="medium" title="Medium board">Medium</button>`,
      `<button type="button" class="carrom-chip${size.key === 'large' ? ' is-active' : ''}" data-size="large" title="Large board">Large</button>`,
      `</div>`,
      `<div class="carrom-score" aria-live="polite">`,
      `<span data-score="w">White 0</span><span data-queen>Queen on the board</span><span data-score="b">Black 0</span>`,
      `</div>`,
      `<div class="carrom-stage">`,
      `<canvas class="carrom-canvas" width="${VW}" height="${VH}" aria-label="${escapeHtml(title)}"></canvas>`,
      `</div>`,
      `<p class="carrom-hint">Slide the striker on your line, pull back, and release.</p>`,
      `<div class="carrom-actions">`,
      `<button type="button" class="btn btn-sm btn-outline-light" data-action="new">New game</button>`,
      `</div>`,
      `</div>`,
      `<div class="carrom-status" aria-live="polite"></div>`,
      `</div>`,
    ].join('');
  }

  function setStatus(el, text, kind) {
    const status = el.querySelector('.carrom-status');
    if (!status) return;
    status.textContent = text || '';
    status.className = 'carrom-status' + (kind ? ` carrom-status--${kind}` : '');
  }

  function drawBoard(ctx) {
    const wood = ctx.createLinearGradient(0, 0, VW, VH);
    wood.addColorStop(0, '#8a5a32');
    wood.addColorStop(0.5, '#5c3317');
    wood.addColorStop(1, '#3b1d0c');
    ctx.fillStyle = wood;
    ctx.fillRect(0, 0, VW, VH);
    const dust = ctx.createRadialGradient(FRAME + BOARD / 2, FRAME + BOARD * 0.42, 40, FRAME + BOARD / 2, FRAME + BOARD / 2, BOARD * 0.72);
    dust.addColorStop(0, '#f3d7a1');
    dust.addColorStop(1, '#d7a15a');
    ctx.fillStyle = dust;
    ctx.fillRect(FRAME, FRAME, BOARD, BOARD);
    ctx.strokeStyle = 'rgba(92, 45, 12, 0.45)';
    ctx.lineWidth = 2;
    ctx.strokeRect(FRAME + 1, FRAME + 1, BOARD - 2, BOARD - 2);
    ctx.beginPath();
    ctx.arc(FRAME + BOARD / 2, FRAME + BOARD / 2, 74, 0, Math.PI * 2);
    ctx.stroke();
    [[BASE_BLACK], [BASE_WHITE]].forEach((row) => {
      const y = FRAME + row[0];
      ctx.beginPath();
      ctx.moveTo(FRAME + BASE_MIN, y);
      ctx.lineTo(FRAME + BASE_MAX, y);
      ctx.stroke();
      [BASE_MIN - 10, BASE_MAX + 10].forEach((x) => {
        ctx.beginPath();
        ctx.arc(FRAME + x, y, 18, 0, Math.PI * 2);
        ctx.stroke();
      });
    });
    [[0, 0], [BOARD, 0], [0, BOARD], [BOARD, BOARD]].forEach((hole) => {
      const x = FRAME + hole[0];
      const y = FRAME + hole[1];
      const g = ctx.createRadialGradient(x, y, 2, x, y, 18);
      g.addColorStop(0, '#1c1917');
      g.addColorStop(1, '#7f1d1d');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#f6e7c1';
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }

  function drawCoin(ctx, coin, highlight) {
    const x = FRAME + coin.x;
    const y = FRAME + coin.y;
    if (highlight) {
      ctx.beginPath();
      ctx.arc(x, y, coin.r + 4, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(254, 240, 138, 0.95)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    const g = ctx.createRadialGradient(x - coin.r * 0.35, y - coin.r * 0.4, 1, x, y, coin.r);
    const base = COLORS[coin.color] || '#fff';
    g.addColorStop(0, '#fff');
    g.addColorStop(0.45, base);
    g.addColorStop(1, coin.color === 'W' ? '#cbd5e1' : coin.color === 'B' ? '#020617' : coin.color === 'Q' ? '#7f1d1d' : '#a16207');
    ctx.beginPath();
    ctx.arc(x, y, coin.r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = coin.color === 'S' ? 3 : 1;
    ctx.strokeStyle = coin.color === 'S' ? '#92400e' : 'rgba(0,0,0,0.45)';
    ctx.stroke();
    if (coin.color === 'Q') {
      ctx.beginPath();
      ctx.arc(x, y, coin.r * 0.38, 0, Math.PI * 2);
      ctx.strokeStyle = '#fde68a';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  function drawAim(ctx, striker, pointer) {
    const dx = striker.x - pointer.x;
    const dy = striker.y - pointer.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const power = Math.min(MAX_SPEED, Math.max(0, (len - striker.r) * 5.4));
    const x = FRAME + striker.x;
    const y = FRAME + striker.y;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.setLineDash([5, 6]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + ux * (striker.r + 2), y + uy * (striker.r + 2));
    ctx.lineTo(x + ux * (striker.r + 18 + power * 0.1), y + uy * (striker.r + 18 + power * 0.1));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = '#3f2a1a';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - ux * (striker.r + 6), y - uy * (striker.r + 6));
    ctx.lineTo(x - ux * (striker.r + 70), y - uy * (striker.r + 70));
    ctx.stroke();
    ctx.restore();
    return power;
  }

  function paint(ctx, coins, striker, aim, player) {
    drawBoard(ctx);
    coins.forEach((coin) => {
      if (!coin.pocketed) drawCoin(ctx, coin, false);
    });
    if (striker && !striker.pocketed) {
      if (aim) drawAim(ctx, striker, aim);
      drawCoin(ctx, striker, true);
    }
    if (!aim && striker && !striker.pocketed) {
      ctx.save();
      ctx.fillStyle = player === 'W' ? 'rgba(255,255,255,0.85)' : 'rgba(15,23,42,0.8)';
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(player === 'W' ? 'WHITE' : 'BLACK', FRAME + striker.x, FRAME + striker.y - striker.r - 8);
      ctx.restore();
    }
  }

  function toBoard(event, canvas) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * sx - FRAME,
      y: (event.clientY - rect.top) * sy - FRAME,
    };
  }

  function queenLabel(queen) {
    if (queen === 'covered') return 'Queen covered';
    if (queen === 'pending') return 'Queen to cover';
    return 'Queen on the board';
  }

  function hydrateBlock(el, options = {}) {
    if (!el || el.dataset.carromHydrated === '1') return;
    el.dataset.carromHydrated = '1';
    window.NotesProGameFullscreen?.bind?.(el);
    const canvas = el.querySelector('.carrom-canvas');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let mode = el.dataset.carromMode === 'hotseat' ? 'hotseat' : 'cpu';
    let difficulty = resolveDifficulty({ difficulty: el.dataset.carromDifficulty });
    let size = resolveSize({ size: el.dataset.carromSize });
    let coins = openingCoins();
    let player = 'W';
    let pocketW = 0;
    let pocketB = 0;
    let queen = 'board';
    let strikerX = BOARD / 2;
    let striker = makeStriker('W', strikerX);
    let phase = 'aim';
    let aim = null;
    let dragging = false;
    let cpuTimer = null;
    let raf = 0;
    let last = 0;

    function sideName(id) {
      if (mode === 'cpu') return id === 'W' ? 'You' : 'CPU';
      return id === 'W' ? 'White' : 'Black';
    }

    function syncChrome(text, kind) {
      el.querySelectorAll('[data-mode]').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.mode === mode);
      });
      el.querySelectorAll('[data-diff]').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.diff === difficulty);
        btn.hidden = mode !== 'cpu';
      });
      el.querySelectorAll('[data-size]').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.size === size.key);
      });
      const wEl = el.querySelector('[data-score="w"]');
      const bEl = el.querySelector('[data-score="b"]');
      const qEl = el.querySelector('[data-queen]');
      if (wEl) wEl.textContent = `${mode === 'cpu' ? 'You' : 'White'} ${pocketW}`;
      if (bEl) bEl.textContent = `${mode === 'cpu' ? 'CPU' : 'Black'} ${pocketB}`;
      if (qEl) qEl.textContent = queenLabel(queen);
      const meta = el.querySelector('.carrom-block-meta');
      if (meta) meta.textContent = mode === 'cpu' ? `vs CPU · ${difficulty}` : '2 players';
      if (text != null) setStatus(el, text, kind);
    }

    function aimHelp() {
      if (phase === 'over') return;
      if (mode === 'cpu' && player === 'B') {
        syncChrome('CPU is lining up a shot…', '');
        return;
      }
      const cover = queen === 'pending' ? ' Cover the queen.' : '';
      syncChrome(`${sideName(player)} to shoot.${cover}`, '');
    }

    function putBack(colors) {
      colors.forEach((color) => {
        if (color === 'Q' && coins.some((coin) => coin.color === 'Q' && !coin.pocketed)) return;
        const spot = freeSpot(coins, striker, COIN_R);
        coins.push({
          id: color === 'Q' ? 'Q' : `${color}${coins.length}-${Math.floor(Math.random() * 999)}`,
          color,
          x: spot.x,
          y: spot.y,
          vx: 0,
          vy: 0,
          r: COIN_R,
          mass: color === 'Q' ? 1.05 : 1,
          pocketed: false,
        });
      });
    }

    function placeStriker(color) {
      striker = makeStriker(color, strikerX);
      const crowd = coins.some((coin) => !coin.pocketed && Math.hypot(coin.x - striker.x, coin.y - striker.y) < coin.r + striker.r + 1);
      if (crowd) striker.x = clamp(striker.x + 28, BASE_MIN, BASE_MAX);
    }

    function finishShot() {
      const sunk = coins.filter((coin) => coin.pocketed).map((coin) => coin.color);
      coins = coins.filter((coin) => !coin.pocketed);
      const ruled = applyRules({
        player,
        pocketW,
        pocketB,
        queen,
        sunk,
        foul: !!striker.pocketed,
      });
      pocketW = ruled.pocketW;
      pocketB = ruled.pocketB;
      queen = ruled.queen;
      putBack(ruled.returned.filter((color, index, list) => color !== 'Q' || list.indexOf('Q') === index));
      if (ruled.winner) {
        phase = 'over';
        const youWon = mode === 'cpu' && ruled.winner === 'W';
        if (youWon) {
          const oppLeft = 9 - pocketB;
          window.NotesProHighscores?.submit?.('carrom', resultPoints(difficulty, oppLeft), {
            won: true,
            level: difficulty === 'hard' ? 3 : difficulty === 'easy' ? 1 : 2,
          });
        }
        syncChrome(`${sideName(ruled.winner)} wins.`, youWon || ruled.winner === 'W' ? 'success' : 'warn');
        return;
      }
      player = ruled.player;
      placeStriker(player);
      phase = 'aim';
      const follow = ruled.continueTurn ? ' Shoot again.' : ` ${sideName(player)} to shoot.`;
      syncChrome(`${ruled.text}${ruled.winner ? '' : follow}`, ruled.kind);
      scheduleCpu();
    }

    function beginShot(vx, vy) {
      if (phase !== 'aim') return;
      const sp = Math.hypot(vx, vy);
      if (sp < 80) return;
      const scale = Math.min(1, MAX_SPEED / sp);
      striker.vx = vx * scale;
      striker.vy = vy * scale;
      const forward = player === 'W' ? -striker.vy : striker.vy;
      if (forward < 30) {
        striker.vx = 0;
        striker.vy = 0;
        return;
      }
      phase = 'rolling';
      aim = null;
      dragging = false;
      syncChrome('Rolling…', '');
    }

    function scheduleCpu() {
      clearTimeout(cpuTimer);
      if (mode !== 'cpu' || player !== 'B' || phase !== 'aim') return;
      cpuTimer = setTimeout(() => {
        if (!el.isConnected || phase !== 'aim' || player !== 'B') return;
        const shot = cpuShot(coins, 'B', difficulty);
        strikerX = shot.x;
        placeStriker('B');
        const sp = Math.hypot(shot.vx, shot.vy) || 1;
        aim = {
          x: striker.x - (shot.vx / sp) * 70,
          y: striker.y - (shot.vy / sp) * 70,
        };
        cpuTimer = setTimeout(() => {
          if (!el.isConnected || phase !== 'aim' || player !== 'B') return;
          beginShot(shot.vx, shot.vy);
        }, 380);
      }, 420);
    }

    function newGame() {
      clearTimeout(cpuTimer);
      coins = openingCoins();
      player = 'W';
      pocketW = 0;
      pocketB = 0;
      queen = 'board';
      strikerX = BOARD / 2;
      placeStriker('W');
      phase = 'aim';
      aim = null;
      dragging = false;
      aimHelp();
    }

    function frame(now) {
      if (!el.isConnected) return;
      const dt = Math.min(0.034, last ? (now - last) / 1000 : 0.016);
      last = now;
      if (phase === 'rolling') {
        const bodies = coins.filter((coin) => !coin.pocketed);
        bodies.push(striker);
        step(bodies, dt);
        if (stopped(bodies)) finishShot();
      }
      const human = mode === 'hotseat' || player === 'W';
      let shown = null;
      if (phase === 'aim' && human && aim) shown = aim;
      else if (phase === 'aim' && aim) shown = aim;
      paint(ctx, coins, striker, shown, player);
      raf = window.requestAnimationFrame(frame);
    }

    canvas.addEventListener('pointerdown', (event) => {
      if (phase !== 'aim') return;
      if (mode === 'cpu' && player !== 'W') return;
      dragging = true;
      aim = toBoard(event, canvas);
      const along = Math.abs(aim.x - striker.x);
      const back = player === 'W' ? (aim.y - striker.y) : (striker.y - aim.y);
      if (back < 18 && along < 80) {
        striker.x = clamp(aim.x, BASE_MIN, BASE_MAX);
        strikerX = striker.x;
        aim = null;
      }
      canvas.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!dragging || phase !== 'aim') return;
      const pointer = toBoard(event, canvas);
      const back = player === 'W' ? (pointer.y - striker.y) : (striker.y - pointer.y);
      if (back < 14) {
        striker.x = clamp(pointer.x, BASE_MIN, BASE_MAX);
        strikerX = striker.x;
        aim = null;
        return;
      }
      aim = pointer;
    });
    function release(event) {
      if (!dragging) return;
      dragging = false;
      const pointer = toBoard(event, canvas);
      if (phase !== 'aim') {
        aim = null;
        return;
      }
      const dx = striker.x - pointer.x;
      const dy = striker.y - pointer.y;
      const len = Math.hypot(dx, dy) || 1;
      const power = Math.min(MAX_SPEED, Math.max(0, (len - striker.r) * 5.4));
      aim = null;
      if (power < 80) return;
      beginShot((dx / len) * power, (dy / len) * power);
    }
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', () => {
      dragging = false;
      aim = null;
    });

    function applySize(next) {
      size = next;
      el.dataset.carromSize = next.token;
      el.style.setProperty('--carrom-size', next.css);
      syncChrome(null, null);
      const index = parseInt(el.dataset.carromIndex, 10);
      options.onPersist?.(index, { size: next.token });
    }

    el.addEventListener('click', (event) => {
      const modeBtn = event.target.closest('[data-mode]');
      const diffBtn = event.target.closest('[data-diff]');
      const sizeBtn = event.target.closest('[data-size]');
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (sizeBtn) {
        applySize(resolveSize({ size: sizeBtn.dataset.size }));
        return;
      }
      if (modeBtn) {
        mode = modeBtn.dataset.mode === 'hotseat' ? 'hotseat' : 'cpu';
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
    return () => {
      window.cancelAnimationFrame(raf);
      clearTimeout(cpuTimer);
    };
  }

  function hydrate(root, options) {
    (root || document).querySelectorAll('.carrom-block[data-carrom-index]').forEach((el) => hydrateBlock(el, options || {}));
  }

  function selfTest() {
    const fails = [];
    function check(name, ok) {
      if (!ok) fails.push(name);
    }
    const rack = openingCoins();
    check('nine white', rack.filter((coin) => coin.color === 'W').length === 9);
    check('nine black', rack.filter((coin) => coin.color === 'B').length === 9);
    check('one queen', rack.filter((coin) => coin.color === 'Q').length === 1);
    const spread = rack.every((coin, i) => rack.every((otherCoin, j) => i === j || Math.hypot(coin.x - otherCoin.x, coin.y - otherCoin.y) > coin.r + otherCoin.r - 0.2));
    check('opening coins do not overlap', spread);

    const headCoin = { id: 'W1', color: 'W', x: 140, y: 260, vx: 0, vy: 0, r: COIN_R, mass: 1, pocketed: false };
    const headStriker = makeStriker('W', 140);
    headStriker.y = 260;
    headStriker.x = 140 - STRIKER_R - COIN_R - 1;
    headStriker.vx = 640;
    const beforeX = headCoin.x;
    const bodies = [headCoin, headStriker];
    for (let i = 0; i < 30; i += 1) step(bodies, 1 / 60);
    check('striker moves a coin', headCoin.x > beforeX + 8);

    const sink = { id: 'W1', color: 'W', x: 16, y: 16, vx: -180, vy: -180, r: COIN_R, mass: 1, pocketed: false };
    for (let i = 0; i < 20 && !sink.pocketed; i += 1) step([sink], 1 / 60);
    check('corner pockets a coin', sink.pocketed);

    const rail = { id: 'B1', color: 'B', x: 30, y: 260, vx: -280, vy: 0, r: COIN_R, mass: 1, pocketed: false };
    for (let i = 0; i < 12 && rail.vx < 0; i += 1) step([rail], 1 / 60);
    check('side rail sends the coin back', rail.vx > 0 && !rail.pocketed);

    const miss = applyRules({ player: 'W', pocketW: 0, pocketB: 0, queen: 'board', sunk: [], foul: false });
    check('a miss changes sides', miss.player === 'B' && !miss.continueTurn);
    const again = applyRules({ player: 'W', pocketW: 0, pocketB: 0, queen: 'board', sunk: ['W'], foul: false });
    check('own coin shoots again', again.continueTurn && again.pocketW === 1 && again.player === 'W');
    const pending = applyRules({ player: 'W', pocketW: 0, pocketB: 0, queen: 'board', sunk: ['Q'], foul: false });
    check('queen waits for a cover', pending.queen === 'pending' && pending.continueTurn);
    const uncovered = applyRules({ player: 'W', pocketW: 0, pocketB: 0, queen: 'pending', sunk: [], foul: false });
    check('uncovered queen returns', uncovered.queen === 'board' && uncovered.returned.includes('Q') && uncovered.player === 'B');
    const covered = applyRules({ player: 'W', pocketW: 2, pocketB: 0, queen: 'pending', sunk: ['W'], foul: false });
    check('own coin covers the queen', covered.queen === 'covered' && covered.pocketW === 3);
    const early = applyRules({ player: 'W', pocketW: 8, pocketB: 0, queen: 'board', sunk: ['W'], foul: false });
    check('last coin waits for the queen', early.pocketW === 8 && early.returned.includes('W') && !early.continueTurn);
    const foul = applyRules({ player: 'W', pocketW: 2, pocketB: 0, queen: 'board', sunk: ['W'], foul: true });
    check('striker foul gives a coin back', foul.pocketW === 1 && foul.player === 'B' && foul.returned.includes('W'));

    const live = openingCoins();
    const x0 = live[0].x;
    simulate(live, makeStriker('W', BOARD / 2), 0.2);
    check('simulate leaves the live coins', live[0].x === x0 && live[0].vx === 0);
    check('render', renderBlock('', 'fullscreen;mode=cpu').indexOf('carrom-canvas') > 0);
    check('small board', resolveSize({ size: 'small' }).css === '380px');
    check('pixel board', resolveSize({ size: '700' }).css === '700px');
    check('percent board', resolveSize({ size: '80%' }).css === '80vw');
    const sized = renderBlock('', 'size=large');
    check('large board markup', sized.indexOf('--carrom-size:860px') > -1 && sized.indexOf('data-size="large"') > -1);
    check('size stays in the fence', buildFenceAttrsString(parseFenceAttrs('fullscreen;mode=cpu;difficulty=hard;size=small')).indexOf('size=small') > -1);
    check('hard win outscores easy', resultPoints('hard', 4) > resultPoints('easy', 4));
    return fails;
  }

  return {
    parseFenceAttrs,
    resolveSize,
    buildFenceAttrsString,
    renderBlock,
    hydrateBlock,
    hydrate,
    selfTest,
    openingCoins,
    applyRules,
    simulate,
    makeStriker,
  };
}));
