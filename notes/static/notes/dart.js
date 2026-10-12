/**
 * NotesPro ```dart``` block — 501 / 301 on a clock dartboard.
 * Pull back from the dart like a cue: direction is the aim, length is the strength.
 * Finish on a double. Against the CPU, a win posts a workspace high score.
 */
(function (root, factory) {
  const api = factory();
  root.NotesProDart = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];
  const NUMBERS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
  const VW = 640;
  const VH = 720;
  const CX = 320;
  const CY = 286;
  const BR = 198;
  const R_INNER_BULL = 6.35 / 170;
  const R_OUTER_BULL = 15.9 / 170;
  const R_TRIPLE_IN = 99 / 170;
  const R_TRIPLE_OUT = 107 / 170;
  const R_DOUBLE_IN = 162 / 170;
  const R_TRIPLE_MID = (99 + 107) / 2 / 170;
  const R_DOUBLE_MID = (162 + 170) / 2 / 170;
  const R_SINGLE_MID = 0.36;
  const FLY_MS = 280;
  const HAND_Y = Math.round(CY + BR * 1.34);
  const MIN_PULL = 22;
  const POWER_SPAN = 170;

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
    const raw = String(cfg.variant || cfg.start || cfg.game || '501').toLowerCase();
    if (raw === '301' || raw === 'short') return '301';
    return '501';
  }

  function startScore(variant) {
    return variant === '301' ? 301 : 501;
  }

  function scoreAt(nx, ny) {
    const dist = Math.hypot(nx, ny);
    if (dist > 1) return { points: 0, mult: 0, number: 0, name: 'Miss' };
    if (dist <= R_INNER_BULL) return { points: 50, mult: 2, number: 25, name: 'D-Bull' };
    if (dist <= R_OUTER_BULL) return { points: 25, mult: 1, number: 25, name: 'Bull' };
    let ang = Math.atan2(nx, -ny);
    if (ang < 0) ang += Math.PI * 2;
    const seg = Math.floor((ang + Math.PI / 20) / (Math.PI / 10)) % 20;
    const number = NUMBERS[seg];
    let mult = 1;
    if (dist >= R_DOUBLE_IN) mult = 2;
    else if (dist >= R_TRIPLE_IN && dist <= R_TRIPLE_OUT) mult = 3;
    const prefix = mult === 2 ? 'D' : mult === 3 ? 'T' : 'S';
    return { points: number * mult, mult, number, name: `${prefix}${number}` };
  }

  function applyDart(remaining, hit) {
    const points = Number(hit && hit.points) || 0;
    const mult = Number(hit && hit.mult) || 0;
    if (points <= 0) return { remaining, bust: false, won: false, scored: 0 };
    const next = remaining - points;
    if (next < 0 || next === 1) return { remaining, bust: true, won: false, scored: 0 };
    if (next === 0) {
      if (mult !== 2) return { remaining, bust: true, won: false, scored: 0 };
      return { remaining: 0, bust: false, won: true, scored: points };
    }
    return { remaining: next, bust: false, won: false, scored: points };
  }

  function aimNumber(number, ring) {
    const index = NUMBERS.indexOf(number);
    const ang = (index < 0 ? 0 : index) * (Math.PI / 10);
    const radius = ring === 't' ? R_TRIPLE_MID : ring === 'd' ? R_DOUBLE_MID : R_SINGLE_MID;
    return { nx: Math.sin(ang) * radius, ny: -Math.cos(ang) * radius };
  }

  function preferredAim(remaining) {
    const left = Math.max(0, Math.floor(Number(remaining) || 0));
    if (left === 50) return { nx: 0, ny: 0 };
    if (left <= 40 && left % 2 === 0 && left >= 2) return aimNumber(left / 2, 'd');
    if (left - 60 > 1) return aimNumber(20, 't');
    const need = left - 40;
    if (need >= 1 && need <= 20) return aimNumber(need, 's');
    if (need >= 2 && need <= 40 && need % 2 === 0) return aimNumber(need / 2, 'd');
    if (need >= 3 && need <= 60 && need % 3 === 0 && need / 3 <= 20) return aimNumber(need / 3, 't');
    if (left % 2 === 1 && left > 2) {
      for (let n = Math.min(20, left - 2); n >= 1; n -= 1) {
        const next = left - n;
        if (next > 1 && next % 2 === 0) return aimNumber(n, 's');
      }
    }
    return aimNumber(20, 's');
  }

  function handPoint() {
    return { x: CX, y: HAND_Y };
  }

  function landingFromPull(pointer) {
    const hand = handPoint();
    const dx = hand.x - pointer.x;
    const dy = hand.y - pointer.y;
    const len = Math.hypot(dx, dy);
    if (len < MIN_PULL) return null;
    const ux = dx / len;
    const uy = dy / len;
    if (uy >= -0.2) return null;
    const power = Math.max(0, Math.min(1, (len - MIN_PULL) / POWER_SPAN));
    const tCenter = (CX - hand.x) * ux + (CY - hand.y) * uy;
    const along = (power - 0.5) * 2 * BR;
    const x = hand.x + ux * tCenter + ux * along;
    const y = hand.y + uy * tCenter + uy * along;
    return {
      nx: (x - CX) / BR,
      ny: (y - CY) / BR,
      power,
      ux,
      uy,
    };
  }

  function pullForLanding(nx, ny) {
    const hand = handPoint();
    const lx = CX + nx * BR;
    const ly = CY + ny * BR;
    const dx = lx - hand.x;
    const dy = ly - hand.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;
    const tCenter = (CX - hand.x) * ux + (CY - hand.y) * uy;
    const power = Math.max(0, Math.min(1, 0.5 + (dist - tCenter) / (2 * BR)));
    const len = MIN_PULL + power * POWER_SPAN;
    return {
      x: hand.x - ux * len,
      y: hand.y - uy * len,
      power,
    };
  }

  function scatterLanding(nx, ny, power, rng) {
    const rand = typeof rng === 'function' ? rng : Math.random;
    const spread = 0.03 + 0.055 * Math.max(0, Math.min(1, Number(power) || 0));
    const ang = rand() * Math.PI * 2;
    const dist = rand() * spread;
    return {
      nx: nx + Math.cos(ang) * dist,
      ny: ny + Math.sin(ang) * dist,
    };
  }

  function cpuLanding(remaining, difficulty, rng) {
    const aim = preferredAim(remaining);
    const rand = typeof rng === 'function' ? rng : Math.random;
    const pull = pullForLanding(aim.nx, aim.ny);
    const jitter = difficulty === 'hard' ? 0.16 : difficulty === 'easy' ? 0.045 : 0.09;
    const hand = handPoint();
    const dx = hand.x - pull.x;
    const dy = hand.y - pull.y;
    const ang = Math.atan2(dy, dx) + (rand() - 0.5) * jitter;
    const len = Math.hypot(dx, dy) * (1 + (rand() - 0.5) * jitter);
    const shot = landingFromPull({
      x: hand.x - Math.cos(ang) * len,
      y: hand.y - Math.sin(ang) * len,
    });
    return shot ? { nx: shot.nx, ny: shot.ny } : { nx: aim.nx, ny: aim.ny };
  }

  function resultPoints(difficulty, start, dartsUsed) {
    const mult = difficulty === 'hard' ? 3 : difficulty === 'easy' ? 1 : 2;
    const base = start >= 501 ? 9000 : 5000;
    const used = Math.max(1, Math.floor(Number(dartsUsed) || 1));
    return Math.max(150, base * mult - used * 50 * mult);
  }

  function renderBlock(source, fenceAttrs, options = {}) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const style = resolveStyle(cfg);
    const title = String(cfg.title || 'Darts').trim() || 'Darts';
    const mode = resolveMode(cfg);
    const difficulty = resolveDifficulty(cfg);
    const variant = resolveVariant(cfg);
    const gameIndex = Number.isFinite(options.dartIndex) ? options.dartIndex : 0;
    const fullscreen = resolveFullscreen(cfg);
    const themeClass = style.theme ? ` dart-block--${style.theme}` : '';
    const customClass = (style.colorCss || style.bgCss) ? ' dart-block--custom' : '';
    const fullClass = fullscreen ? ' dart-block--fullscreen' : '';
    const styleVars = [];
    if (style.colorCss) styleVars.push(`--dart-accent:${style.colorCss}`);
    if (style.bgCss) styleVars.push(`--dart-bg:${style.bgCss}`);
    const styleAttr = styleVars.length ? ` style="${styleVars.map((v) => escapeHtml(v)).join(';')}"` : '';
    const meta = `${variant} · ${mode === 'cpu' ? `vs CPU · ${difficulty}` : '2 players'}`;
    const opening = startScore(variant);
    const chrome = fullscreen ? '' : [
      '<div class="dart-block-header">',
      `<div class="dart-block-title">${escapeHtml(title)}</div>`,
      `<div class="dart-block-meta">${escapeHtml(meta)}</div>`,
      '</div>',
    ].join('');
    return [
      `<div class="dart-block${themeClass}${customClass}${fullClass}"${styleAttr}`,
      ` data-dart-index="${gameIndex}"`,
      ` data-dart-mode="${mode}"`,
      ` data-dart-difficulty="${difficulty}"`,
      ` data-dart-variant="${variant}" tabindex="0">`,
      window.NotesProGameFullscreen?.renderButton?.() || '',
      chrome,
      '<div class="dart-play-area">',
      '<div class="dart-toolbar" role="toolbar" aria-label="Darts options">',
      `<button type="button" class="dart-chip${mode === 'cpu' ? ' is-active' : ''}" data-mode="cpu">CPU</button>`,
      `<button type="button" class="dart-chip${mode === 'hotseat' ? ' is-active' : ''}" data-mode="hotseat">2 players</button>`,
      '<span class="dart-toolbar-gap" aria-hidden="true"></span>',
      `<button type="button" class="dart-chip${variant === '501' ? ' is-active' : ''}" data-variant="501">501</button>`,
      `<button type="button" class="dart-chip${variant === '301' ? ' is-active' : ''}" data-variant="301">301</button>`,
      '<span class="dart-toolbar-gap" aria-hidden="true"></span>',
      `<button type="button" class="dart-chip dart-chip--diff${difficulty === 'easy' ? ' is-active' : ''}" data-diff="easy">Easy</button>`,
      `<button type="button" class="dart-chip dart-chip--diff${difficulty === 'medium' ? ' is-active' : ''}" data-diff="medium">Med</button>`,
      `<button type="button" class="dart-chip dart-chip--diff${difficulty === 'hard' ? ' is-active' : ''}" data-diff="hard">Hard</button>`,
      '</div>',
      '<div class="dart-score" aria-live="polite">',
      `<span data-score="you">You ${opening}</span><span data-darts>Dart 1/3</span><span data-score="opp">CPU ${opening}</span>`,
      '</div>',
      '<div class="dart-stage">',
      `<canvas class="dart-canvas" width="${VW}" height="${VH}" aria-label="${escapeHtml(title)}"></canvas>`,
      '</div>',
      '<p class="dart-hint">The cue starts by the 3. Pull it back to throw harder, then release. The dart can land off the mark. Finish on a double.</p>',
      '<div class="dart-actions">',
      '<button type="button" class="btn btn-sm btn-outline-light" data-action="new">New game</button>',
      '</div>',
      '</div>',
      '<div class="dart-status" aria-live="polite"></div>',
      '</div>',
    ].join('');
  }

  function setStatus(el, text, kind) {
    const status = el.querySelector('.dart-status');
    if (!status) return;
    status.textContent = text || '';
    status.className = 'dart-status' + (kind ? ` dart-status--${kind}` : '');
  }

  function fillRing(ctx, i, r0, r1, color) {
    const a0 = -Math.PI / 2 + (i - 0.5) * (Math.PI / 10);
    const a1 = a0 + Math.PI / 10;
    ctx.beginPath();
    ctx.arc(CX, CY, r1, a0, a1, false);
    ctx.arc(CX, CY, Math.max(0.5, r0), a1, a0, true);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawBoard(ctx) {
    ctx.fillStyle = '#0c0a09';
    ctx.fillRect(0, 0, VW, VH);
    ctx.beginPath();
    ctx.arc(CX, CY, BR * 1.28, 0, Math.PI * 2);
    ctx.fillStyle = '#1c1917';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(CX, CY, BR * 1.08, 0, Math.PI * 2);
    ctx.fillStyle = '#111827';
    ctx.fill();
    for (let i = 0; i < 20; i += 1) {
      const dark = i % 2 === 0;
      fillRing(ctx, i, R_OUTER_BULL * BR, BR, dark ? '#171717' : '#f3e6c8');
      fillRing(ctx, i, R_TRIPLE_IN * BR, R_TRIPLE_OUT * BR, dark ? '#dc2626' : '#16a34a');
      fillRing(ctx, i, R_DOUBLE_IN * BR, BR, dark ? '#dc2626' : '#16a34a');
    }
    ctx.beginPath();
    ctx.arc(CX, CY, R_OUTER_BULL * BR, 0, Math.PI * 2);
    ctx.fillStyle = '#16a34a';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(CX, CY, R_INNER_BULL * BR, 0, Math.PI * 2);
    ctx.fillStyle = '#dc2626';
    ctx.fill();
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.55)';
    ctx.lineWidth = 1;
    [R_INNER_BULL, R_OUTER_BULL, R_TRIPLE_IN, R_TRIPLE_OUT, R_DOUBLE_IN, 1].forEach((r) => {
      ctx.beginPath();
      ctx.arc(CX, CY, r * BR, 0, Math.PI * 2);
      ctx.stroke();
    });
    for (let i = 0; i < 20; i += 1) {
      const a = -Math.PI / 2 + (i - 0.5) * (Math.PI / 10);
      ctx.beginPath();
      ctx.moveTo(CX + Math.cos(a) * R_OUTER_BULL * BR, CY + Math.sin(a) * R_OUTER_BULL * BR);
      ctx.lineTo(CX + Math.cos(a) * BR, CY + Math.sin(a) * BR);
      ctx.stroke();
    }
    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < 20; i += 1) {
      const a = -Math.PI / 2 + i * (Math.PI / 10);
      ctx.fillText(String(NUMBERS[i]), CX + Math.cos(a) * BR * 1.16, CY + Math.sin(a) * BR * 1.16);
    }
  }

  function drawDartAt(ctx, x, y, angle, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.strokeStyle = '#e7e5e4';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-16, 0);
    ctx.lineTo(7, 0);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(2, -3.2);
    ctx.lineTo(2, 3.2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(-18, -4, 5, 8);
    ctx.restore();
  }

  function drawCue(ctx, pointer) {
    const hand = handPoint();
    const dx = hand.x - pointer.x;
    const dy = hand.y - pointer.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const shot = landingFromPull(pointer);
    const power = shot ? shot.power : 0;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#f3d2a4';
    ctx.lineWidth = 4 + power * 3;
    ctx.beginPath();
    ctx.moveTo(hand.x - ux * 16, hand.y - uy * 16);
    ctx.lineTo(pointer.x, pointer.y);
    ctx.stroke();
    ctx.fillStyle = '#b45309';
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, 4, 0, Math.PI * 2);
    ctx.fill();
    if (shot) {
      const lx = CX + shot.nx * BR;
      const ly = CY + shot.ny * BR;
      ctx.setLineDash([5, 6]);
      ctx.strokeStyle = 'rgba(255,255,255,0.78)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(hand.x + ux * 14, hand.y + uy * 14);
      ctx.lineTo(lx, ly);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(250, 204, 21, 0.95)';
      ctx.beginPath();
      ctx.arc(lx, ly, 4 + power * 4, 0, Math.PI * 2);
      ctx.fill();
      const barX = hand.x + 16;
      const barH = 46;
      const barY = hand.y + 10;
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(barX, barY, 7, barH);
      ctx.fillStyle = '#f97316';
      ctx.fillRect(barX, barY + barH * (1 - power), 7, barH * power);
    }
    ctx.restore();
  }

  function hydrateBlock(el) {
    if (!el || el.dataset.dartHydrated === '1') return;
    el.dataset.dartHydrated = '1';
    window.NotesProGameFullscreen?.bind?.(el);
    const canvas = el.querySelector('.dart-canvas');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let mode = el.dataset.dartMode === 'hotseat' ? 'hotseat' : 'cpu';
    let difficulty = resolveDifficulty({ difficulty: el.dataset.dartDifficulty });
    let variant = el.dataset.dartVariant === '301' ? '301' : '501';
    let you = startScore(variant);
    let opp = startScore(variant);
    let turn = 'you';
    let darts = 0;
    let visitStart = you;
    let dartsUsed = 0;
    let phase = 'aim';
    let sticks = [];
    let fly = null;
    let dragging = false;
    let aimPointer = null;
    let cpuTimer = null;
    let raf = 0;

    function sideName(side) {
      if (mode === 'cpu') return side === 'you' ? 'You' : 'CPU';
      return side === 'you' ? 'P1' : 'P2';
    }

    function remainingOf(side) {
      return side === 'you' ? you : opp;
    }

    function humanTurn() {
      return phase === 'aim' && (mode === 'hotseat' || turn === 'you');
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
      });
      const youEl = el.querySelector('[data-score="you"]');
      const oppEl = el.querySelector('[data-score="opp"]');
      const dartEl = el.querySelector('[data-darts]');
      if (youEl) youEl.textContent = `${sideName('you')} ${you}`;
      if (oppEl) oppEl.textContent = `${sideName('opp')} ${opp}`;
      if (dartEl) dartEl.textContent = phase === 'over' ? 'Checkout' : `Dart ${Math.min(3, darts + 1)}/3`;
      const meta = el.querySelector('.dart-block-meta');
      if (meta) {
        meta.textContent = `${variant} · ${mode === 'cpu' ? `vs CPU · ${difficulty}` : '2 players'}`;
      }
      if (text != null) setStatus(el, text, kind);
    }

    function restPull() {
      return pullForLanding(0, R_DOUBLE_MID);
    }

    function reportWin() {
      const points = resultPoints(difficulty, startScore(variant), dartsUsed);
      window.NotesProHighscores?.submit?.('dart', points, {
        won: true,
        level: difficulty === 'hard' ? 3 : difficulty === 'easy' ? 1 : 2,
        moves: dartsUsed,
      });
    }

    function switchTurn() {
      sticks = [];
      darts = 0;
      turn = turn === 'you' ? 'opp' : 'you';
      visitStart = remainingOf(turn);
      phase = 'aim';
      scheduleCpu();
    }

    function resolveFly() {
      const shot = fly;
      fly = null;
      if (!shot) return;
      sticks.push({ nx: shot.nx, ny: shot.ny, side: shot.side });
      if (shot.side === 'you') dartsUsed += 1;
      const applied = applyDart(remainingOf(shot.side), shot.hit);
      darts += 1;
      if (shot.side === 'you') you = applied.bust ? visitStart : applied.remaining;
      else opp = applied.bust ? visitStart : applied.remaining;
      const label = shot.hit.points ? `${shot.hit.name} · ${shot.hit.points}` : 'Miss';
      if (applied.won) {
        phase = 'over';
        const youWon = shot.side === 'you';
        if (youWon && mode === 'cpu') reportWin();
        syncChrome(`${shot.hit.name}. ${sideName(shot.side)} checks out.`, youWon || (mode === 'hotseat' && shot.side === 'you') ? 'success' : 'warn');
        return;
      }
      if (applied.bust) {
        sticks = [];
        darts = 0;
        turn = shot.side === 'you' ? 'opp' : 'you';
        visitStart = remainingOf(turn);
        phase = 'aim';
        syncChrome(`${label} busts. ${sideName(turn)} to throw.`, 'warn');
        scheduleCpu();
        return;
      }
      if (darts >= 3) {
        switchTurn();
        syncChrome(`${label}. ${sideName(turn)} to throw.`, 'info');
        return;
      }
      phase = 'aim';
      syncChrome(`${label}. ${sideName(shot.side)}, dart ${darts + 1} of 3.`, shot.hit.points ? 'success' : 'info');
      scheduleCpu();
    }

    function beginThrow(nx, ny, side, power) {
      if (phase !== 'aim') return;
      phase = 'fly';
      dragging = false;
      aimPointer = null;
      const strength = Number.isFinite(power) ? Math.max(0, Math.min(1, power)) : Math.max(0, Math.min(1, 0.5 - ny / 2));
      fly = {
        nx,
        ny,
        side,
        power: strength,
        hit: scoreAt(nx, ny),
        t0: (typeof performance !== 'undefined' ? performance.now() : Date.now()),
        ms: 500 - strength * 320,
      };
      syncChrome('In flight…', '');
    }

    function scheduleCpu() {
      clearTimeout(cpuTimer);
      aimPointer = null;
      if (mode !== 'cpu' || turn !== 'opp' || phase !== 'aim') return;
      cpuTimer = setTimeout(() => {
        if (!el.isConnected || phase !== 'aim' || turn !== 'opp') return;
        const spot = cpuLanding(opp, difficulty);
        aimPointer = pullForLanding(spot.nx, spot.ny);
        cpuTimer = setTimeout(() => {
          if (!el.isConnected || phase !== 'aim' || turn !== 'opp') return;
          beginThrow(spot.nx, spot.ny, 'opp', pullForLanding(spot.nx, spot.ny).power);
        }, 420);
      }, 480);
    }

    function newGame() {
      clearTimeout(cpuTimer);
      const opening = startScore(variant);
      you = opening;
      opp = opening;
      turn = 'you';
      darts = 0;
      visitStart = opening;
      dartsUsed = 0;
      phase = 'aim';
      sticks = [];
      fly = null;
      dragging = false;
      aimPointer = null;
      syncChrome(`${sideName('you')} to throw. Pull back from the dart.`, '');
    }

    function paint(now) {
      drawBoard(ctx);
      sticks.forEach((stick) => {
        const x = CX + stick.nx * BR;
        const y = CY + stick.ny * BR;
        const angle = Math.atan2(-stick.ny, -stick.nx);
        drawDartAt(ctx, x, y, angle, stick.side === 'you' ? '#f87171' : '#38bdf8');
      });
      if (fly) {
        const elapsed = now - fly.t0;
        const u = Math.min(1, elapsed / (fly.ms || FLY_MS));
        const e = 1 - (1 - u) * (1 - u);
        const x1 = CX + fly.nx * BR;
        const y1 = CY + fly.ny * BR;
        const x = CX + (x1 - CX) * e;
        const y = HAND_Y + (y1 - HAND_Y) * e;
        drawDartAt(ctx, x, y, Math.atan2(y1 - HAND_Y, x1 - CX), fly.side === 'you' ? '#f87171' : '#38bdf8');
        if (u >= 1) resolveFly();
      } else if (humanTurn() || aimPointer) {
        drawCue(ctx, aimPointer || restPull());
        drawDartAt(ctx, CX, HAND_Y, -Math.PI / 2, turn === 'you' ? '#f87171' : '#38bdf8');
      }
      ctx.strokeStyle = 'rgba(248, 250, 252, 0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(CX - 54, HAND_Y + 22);
      ctx.lineTo(CX + 54, HAND_Y + 22);
      ctx.stroke();
    }

    function frame(now) {
      if (!el.isConnected) return;
      paint(now);
      raf = window.requestAnimationFrame(frame);
    }

    function canvasPoint(event) {
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / (rect.width || canvas.width);
      const sy = canvas.height / (rect.height || canvas.height);
      return {
        x: (event.clientX - rect.left) * sx,
        y: (event.clientY - rect.top) * sy,
      };
    }

    canvas.addEventListener('pointerdown', (event) => {
      if (!humanTurn() || event.button > 0) return;
      dragging = true;
      aimPointer = canvasPoint(event);
      try { canvas.setPointerCapture(event.pointerId); } catch (err) { /* synthetic events */ }
      event.preventDefault();
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!dragging || !humanTurn()) return;
      aimPointer = canvasPoint(event);
    });
    function release(event) {
      if (!dragging) return;
      dragging = false;
      const pointer = aimPointer || canvasPoint(event);
      aimPointer = null;
      if (!humanTurn()) return;
      const shot = landingFromPull(pointer);
      if (!shot) return;
      const landed = scatterLanding(shot.nx, shot.ny, shot.power);
      beginThrow(landed.nx, landed.ny, turn, shot.power);
    }
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', () => {
      dragging = false;
      aimPointer = null;
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
        variant = variantBtn.dataset.variant === '301' ? '301' : '501';
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

    newGame();
    raf = window.requestAnimationFrame(frame);
    return () => {
      window.cancelAnimationFrame(raf);
      clearTimeout(cpuTimer);
    };
  }

  function hydrate(root) {
    (root || document).querySelectorAll('.dart-block[data-dart-index]').forEach((el) => hydrateBlock(el));
  }

  function selfTest() {
    const fails = [];
    function check(name, ok) {
      if (!ok) fails.push(name);
    }
    check('inner bull is 50', scoreAt(0, 0).points === 50 && scoreAt(0, 0).mult === 2);
    check('outer bull is 25', scoreAt(0, -0.06).points === 25 && scoreAt(0, -0.06).mult === 1);
    const dub = scoreAt(0, -0.97);
    check('double 20 is 40', dub.points === 40 && dub.mult === 2 && dub.number === 20);
    const treble = scoreAt(0, -R_TRIPLE_MID);
    check('treble 20 is 60', treble.points === 60 && treble.mult === 3 && treble.number === 20);
    check('single 20 is 20', scoreAt(0, -0.4).points === 20 && scoreAt(0, -0.4).mult === 1);
    check('outside misses', scoreAt(0, -1.05).points === 0);
    const one = aimNumber(1, 's');
    check('single 1 sits clockwise of 20', scoreAt(one.nx, one.ny).number === 1 && scoreAt(one.nx, one.ny).points === 1);
    check('double 20 checks out 40', applyDart(40, { points: 40, mult: 2 }).won);
    check('single leaves 20', applyDart(40, { points: 20, mult: 1 }).remaining === 20 && !applyDart(40, { points: 20, mult: 1 }).won);
    check('non-double checkout busts', applyDart(40, { points: 40, mult: 1 }).bust && applyDart(40, { points: 40, mult: 1 }).remaining === 40);
    check('inner bull checks out 50', applyDart(50, { points: 50, mult: 2 }).won);
    check('going to 1 busts', applyDart(3, { points: 2, mult: 1 }).bust);
    check('overshoot busts', applyDart(32, { points: 40, mult: 2 }).bust);
    check('miss stays', applyDart(2, { points: 0, mult: 0 }).remaining === 2 && !applyDart(2, { points: 0, mult: 0 }).bust);
    const aim501 = scoreAt(preferredAim(501).nx, preferredAim(501).ny);
    check('501 opens on treble 20', aim501.points === 60);
    const aim40 = scoreAt(preferredAim(40).nx, preferredAim(40).ny);
    check('40 aims at double 20', aim40.points === 40 && aim40.mult === 2);
    const aim32 = scoreAt(preferredAim(32).nx, preferredAim(32).ny);
    check('32 aims at double 16', aim32.points === 32 && aim32.number === 16 && aim32.mult === 2);
    const aim50 = scoreAt(preferredAim(50).nx, preferredAim(50).ny);
    check('50 aims at the bull', aim50.points === 50);
    const aim61 = scoreAt(preferredAim(61).nx, preferredAim(61).ny);
    check('61 avoids leaving 1', aim61.points === 21 && applyDart(61, aim61).remaining === 40);
    const steady = cpuLanding(40, 'hard', () => 0.5);
    check('steady cpu hits the double', scoreAt(steady.nx, steady.ny).points === 40);
    const bullPull = pullForLanding(0, 0);
    const bullLand = landingFromPull(bullPull);
    check('half pull hits the bull', bullLand && scoreAt(bullLand.nx, bullLand.ny).points === 50);
    const highPull = pullForLanding(0, -R_TRIPLE_MID);
    const highLand = landingFromPull(highPull);
    check('longer pull reaches treble 20', highLand && scoreAt(highLand.nx, highLand.ny).points === 60);
    check('treble pull is longer than the bull', Math.hypot(handPoint().x - highPull.x, handPoint().y - highPull.y) > Math.hypot(handPoint().x - bullPull.x, handPoint().y - bullPull.y));
    const threePull = pullForLanding(0, R_DOUBLE_MID);
    const threeLand = landingFromPull(threePull);
    check('short cue lands on the 3', threeLand && scoreAt(threeLand.nx, threeLand.ny).number === 3 && threeLand.ny > 0.8);
    check('longer cue is a harder throw', threePull.power < highPull.power);
    let scatterStep = 0;
    const scatterSeq = [0.25, 0.8];
    const scattered = scatterLanding(0, -R_TRIPLE_MID, 1, () => scatterSeq[scatterStep++]);
    check('a hard draw can leave the mark', scattered.ny > -R_TRIPLE_MID && Math.abs(scattered.nx) < 0.001);
    scatterStep = 0;
    const gentle = scatterLanding(0, R_DOUBLE_MID, 0, () => scatterSeq[scatterStep++]);
    check('a short draw wanders less', Math.abs(gentle.ny - R_DOUBLE_MID) < Math.abs(scattered.ny + R_TRIPLE_MID));
    check('short pull does not throw', landingFromPull({ x: handPoint().x, y: handPoint().y + 8 }) === null);
    const angled = landingFromPull({ x: handPoint().x + 48, y: handPoint().y + 150 });
    check('angled cue leaves the center', angled && angled.nx < -0.05);
    check('hard win outscores easy', resultPoints('hard', 501, 15) > resultPoints('easy', 501, 15));
    check('fewer darts score higher', resultPoints('medium', 501, 9) > resultPoints('medium', 501, 24));
    const html = renderBlock('', 'fullscreen;mode=cpu;difficulty=medium;variant=501');
    check('canvas', html.indexOf('dart-canvas') > 0);
    check('501 chip', html.indexOf('data-variant="501"') > 0);
    check('starts at 501', html.indexOf('You 501') > 0);
    const shortGame = renderBlock('', 'variant=301;mode=hotseat');
    check('301 opens lower', shortGame.indexOf('P1 301') > 0 || shortGame.indexOf('You 301') > 0);
    return fails;
  }

  return {
    parseFenceAttrs,
    renderBlock,
    hydrateBlock,
    hydrate,
    selfTest,
    scoreAt,
    applyDart,
    preferredAim,
    landingFromPull,
    pullForLanding,
    scatterLanding,
    cpuLanding,
    resultPoints,
  };
}));
