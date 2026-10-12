/**
 * NotesPro ```backgammon``` / ```bg``` block — race home, hit blots, bear off.
 */
(function (root, factory) {
  const api = factory();
  root.NotesProBackgammon = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];
  const START_POINTS = [-2, 0, 0, 0, 0, 5, 0, 3, 0, 0, 0, -5, 5, 0, 0, 0, -3, 0, -5, 0, 0, 0, 0, 2];
  const START_BOARD = START_POINTS.join(',');
  const TOP_POINTS = [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];
  const BOTTOM_POINTS = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  const PIP_MAP = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
  };

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

  function parsePoints(raw) {
    const parts = String(raw || START_BOARD).split(/[,/|]+/).map((n) => parseInt(n, 10));
    const points = START_POINTS.slice();
    for (let i = 0; i < 24; i += 1) {
      if (Number.isFinite(parts[i]) && Math.abs(parts[i]) <= 15) points[i] = parts[i];
    }
    return points;
  }

  function serializeBoard(points) {
    return (points && points.length ? points : START_POINTS).slice(0, 24).join(',');
  }

  function parsePair(raw) {
    const parts = String(raw || '').split(/[-:/,]/).map((n) => parseInt(n, 10));
    return {
      w: Number.isFinite(parts[0]) && parts[0] >= 0 ? Math.min(15, parts[0]) : 0,
      b: Number.isFinite(parts[1]) && parts[1] >= 0 ? Math.min(15, parts[1]) : 0,
    };
  }

  function serializePair(pair) {
    return `${pair.w || 0},${pair.b || 0}`;
  }

  function parseDice(raw) {
    return String(raw || '')
      .split(/[,x/]+/)
      .map((n) => parseInt(n, 10))
      .filter((n) => n >= 1 && n <= 6);
  }

  function serializeDice(dice) {
    return (dice || []).join(',');
  }

  function parseScore(raw) {
    const parts = String(raw || '').split(/[-:/,]/).map((n) => parseInt(n, 10));
    return {
      w: Number.isFinite(parts[0]) && parts[0] >= 0 ? parts[0] : 0,
      b: Number.isFinite(parts[1]) && parts[1] >= 0 ? parts[1] : 0,
      draw: Number.isFinite(parts[2]) && parts[2] >= 0 ? parts[2] : 0,
    };
  }

  function serializeScore(score) {
    return `${score.w}-${score.b}-${score.draw}`;
  }

  function emptyState() {
    return {
      points: START_POINTS.slice(),
      barW: 0,
      barB: 0,
      offW: 0,
      offB: 0,
      turn: 'W',
      dice: [],
      rolled: [],
    };
  }

  function parseState(cfg) {
    const bar = parsePair(cfg.bar);
    const off = parsePair(cfg.off);
    const dice = parseDice(cfg.dice);
    const rolled = parseDice(cfg.rolled);
    return {
      points: parsePoints(cfg.board),
      barW: bar.w,
      barB: bar.b,
      offW: off.w,
      offB: off.b,
      turn: String(cfg.turn || 'W').toUpperCase() === 'B' ? 'B' : 'W',
      dice,
      rolled: rolled.length ? rolled : dice.slice(0, 2),
    };
  }

  function cloneState(state) {
    return {
      points: state.points.slice(),
      barW: state.barW,
      barB: state.barB,
      offW: state.offW,
      offB: state.offB,
      turn: state.turn,
      dice: state.dice.slice(),
      rolled: state.rolled.slice(),
    };
  }

  function buildFenceAttrsString(cfg, boardStr) {
    const parts = [];
    Object.entries(cfg || {}).forEach(([key, value]) => {
      if (key === 'board') return;
      if (key === 'score' && String(value) === '0-0-0') return;
      if ((key === 'bar' || key === 'off') && String(value) === '0,0') return;
      if ((key === 'dice' || key === 'rolled') && !value) return;
      if (value == null || value === '') return;
      parts.push(`${key}=${value}`);
    });
    if (boardStr && boardStr !== START_BOARD) parts.push(`board=${boardStr}`);
    return parts.join(';');
  }

  function ownerAt(points, i) {
    const n = points[i];
    if (n > 0) return 'W';
    if (n < 0) return 'B';
    return null;
  }

  function countAt(points, i) {
    return Math.abs(points[i] || 0);
  }

  function barCount(state, color) {
    return color === 'W' ? state.barW : state.barB;
  }

  function offCount(state, color) {
    return color === 'W' ? state.offW : state.offB;
  }

  function enterPoint(color, die) {
    return color === 'W' ? 24 - die : die - 1;
  }

  function destFrom(from, die, color) {
    if (from === 'bar') return enterPoint(color, die);
    return color === 'W' ? from - die : from + die;
  }

  function isOff(dest, color) {
    return color === 'W' ? dest < 0 : dest > 23;
  }

  function inHome(state, color) {
    if (barCount(state, color)) return false;
    if (color === 'W') {
      for (let i = 6; i < 24; i += 1) if (state.points[i] > 0) return false;
    } else {
      for (let i = 0; i < 18; i += 1) if (state.points[i] < 0) return false;
    }
    return true;
  }

  function canLand(state, dest, color) {
    if (dest < 0 || dest > 23) return false;
    const owner = ownerAt(state.points, dest);
    if (!owner || owner === color) return true;
    return countAt(state.points, dest) === 1;
  }

  function canBearOff(state, from, die, color) {
    if (!inHome(state, color) || from === 'bar') return false;
    const dest = destFrom(from, die, color);
    if (!isOff(dest, color)) return false;
    const pipNeeded = color === 'W' ? from + 1 : 24 - from;
    if (die === pipNeeded) return true;
    if (die < pipNeeded) return false;
    if (color === 'W') {
      for (let i = from + 1; i <= 5; i += 1) if (state.points[i] > 0) return false;
    } else {
      for (let i = 18; i < from; i += 1) if (state.points[i] < 0) return false;
    }
    return true;
  }

  function applyMove(state, move) {
    const next = cloneState(state);
    const color = state.turn;
    const sign = color === 'W' ? 1 : -1;
    const opp = color === 'W' ? 'B' : 'W';
    if (move.from === 'bar') {
      if (color === 'W') next.barW -= 1;
      else next.barB -= 1;
    } else {
      next.points[move.from] -= sign;
    }
    if (move.to === 'off') {
      if (color === 'W') next.offW += 1;
      else next.offB += 1;
    } else {
      if (ownerAt(next.points, move.to) === opp && countAt(next.points, move.to) === 1) {
        next.points[move.to] = 0;
        if (opp === 'W') next.barW += 1;
        else next.barB += 1;
      }
      next.points[move.to] += sign;
    }
    const di = next.dice.indexOf(move.die);
    if (di >= 0) next.dice.splice(di, 1);
    return next;
  }

  function candidateMoves(state) {
    const color = state.turn;
    const uniqueDice = [];
    state.dice.forEach((die) => {
      if (!uniqueDice.includes(die)) uniqueDice.push(die);
    });
    const moves = [];
    const onBar = barCount(state, color) > 0;
    uniqueDice.forEach((die) => {
      if (onBar) {
        const dest = enterPoint(color, die);
        if (canLand(state, dest, color)) {
          const hit = ownerAt(state.points, dest) && ownerAt(state.points, dest) !== color;
          moves.push({ from: 'bar', to: dest, die, hit: !!hit });
        }
        return;
      }
      for (let from = 0; from < 24; from += 1) {
        if (ownerAt(state.points, from) !== color) continue;
        const dest = destFrom(from, die, color);
        if (isOff(dest, color)) {
          if (canBearOff(state, from, die, color)) moves.push({ from, to: 'off', die, hit: false });
        } else if (canLand(state, dest, color)) {
          const hit = ownerAt(state.points, dest) && ownerAt(state.points, dest) !== color;
          moves.push({ from, to: dest, die, hit: !!hit });
        }
      }
    });
    return moves;
  }

  function generatePlays(state) {
    const plays = [];
    function rec(current, acc) {
      const cands = candidateMoves(current);
      if (!cands.length) {
        plays.push(acc.slice());
        return;
      }
      cands.forEach((move) => {
        acc.push(move);
        rec(applyMove(current, move), acc);
        acc.pop();
      });
    }
    rec(state, []);
    return plays;
  }

  function maximalPlays(state) {
    if (!state.dice.length) return [];
    const plays = generatePlays(state);
    let maxLen = 0;
    plays.forEach((play) => { if (play.length > maxLen) maxLen = play.length; });
    if (!maxLen) return [];
    let best = plays.filter((play) => play.length === maxLen);
    if (maxLen === 1 && state.dice.length >= 2) {
      const high = Math.max.apply(null, state.dice);
      const withHigh = best.filter((play) => play[0] && play[0].die === high);
      if (withHigh.length) best = withHigh;
    }
    return best;
  }

  function firstMoves(state) {
    const plays = maximalPlays(state);
    const list = [];
    const seen = new Set();
    plays.forEach((play) => {
      const move = play[0];
      if (!move) return;
      const key = `${move.from}:${move.to}:${move.die}`;
      if (seen.has(key)) return;
      seen.add(key);
      list.push(move);
    });
    return list;
  }

  function sameSlot(a, b) {
    return String(a) === String(b);
  }

  function winnerOf(state) {
    if (state.offW >= 15) return 'W';
    if (state.offB >= 15) return 'B';
    return null;
  }

  function winKind(state, winner) {
    const loser = winner === 'W' ? 'B' : 'W';
    if (offCount(state, loser) > 0) return 'win';
    const inWinnerHome = loser === 'B'
      ? state.points.slice(0, 6).some((n) => n < 0)
      : state.points.slice(18, 24).some((n) => n > 0);
    if (barCount(state, loser) > 0 || inWinnerHome) return 'backgammon';
    return 'gammon';
  }

  function pipCount(state, color) {
    let pips = barCount(state, color) * 25;
    for (let i = 0; i < 24; i += 1) {
      if (ownerAt(state.points, i) !== color) continue;
      const dist = color === 'W' ? i + 1 : 24 - i;
      pips += countAt(state.points, i) * dist;
    }
    return pips;
  }

  function evaluate(state, color) {
    const opp = color === 'W' ? 'B' : 'W';
    let score = (offCount(state, color) - offCount(state, opp)) * 42;
    score -= pipCount(state, color) * 1.15;
    score += pipCount(state, opp);
    score -= barCount(state, color) * 28;
    score += barCount(state, opp) * 34;
    for (let i = 0; i < 24; i += 1) {
      const owner = ownerAt(state.points, i);
      const n = countAt(state.points, i);
      if (!owner) continue;
      const homeAnchor = color === 'W' ? i >= 18 : i <= 5;
      const ownHome = color === 'W' ? i <= 5 : i >= 18;
      if (owner === color) {
        if (n >= 2) score += 9 + (homeAnchor ? 8 : 0) + (ownHome ? 3 : 0);
        else {
          score -= ownHome ? 6 : 14;
          if (homeAnchor) score -= 10;
        }
      } else if (n === 1) {
        score += 7;
      } else if (n >= 2 && ((color === 'W' && i <= 5) || (color === 'B' && i >= 18))) {
        score -= 11;
      }
    }
    return score;
  }

  function rollDice() {
    const a = 1 + Math.floor(Math.random() * 6);
    const b = 1 + Math.floor(Math.random() * 6);
    if (a === b) return { rolled: [a, b], dice: [a, a, a, a] };
    return { rolled: [a, b], dice: [a, b] };
  }

  function applyRoll(state, roll) {
    const next = cloneState(state);
    next.rolled = roll.rolled.slice();
    next.dice = roll.dice.slice();
    return next;
  }

  function bestPlay(state, difficulty) {
    const plays = maximalPlays(state);
    if (!plays.length) return [];
    if (difficulty === 'easy') return plays[Math.floor(Math.random() * plays.length)];
    let best = plays[0];
    let bestScore = -Infinity;
    plays.forEach((play) => {
      let next = state;
      play.forEach((move) => { next = applyMove(next, move); });
      let score = evaluate(next, state.turn);
      if (difficulty === 'hard') {
        const opp = state.turn === 'W' ? 'B' : 'W';
        score -= evaluate(next, opp) * 0.35;
        play.forEach((move) => { if (move.hit) score += 18; });
      }
      if (score > bestScore) {
        bestScore = score;
        best = play;
      }
    });
    return best;
  }

  function resultPoints(kind, difficulty, leftover) {
    const mult = difficulty === 'hard' ? 3 : difficulty === 'easy' ? 1 : 2;
    const stake = kind === 'backgammon' ? 3 : kind === 'gammon' ? 2 : 1;
    return Math.max(120, 3500 * mult * stake + leftover * 60);
  }

  function checkerStack(count, color) {
    const show = Math.min(count, 5);
    const parts = [];
    for (let i = 0; i < show; i += 1) {
      parts.push(`<span class="bg-checker bg-checker--${color.toLowerCase()}"></span>`);
    }
    if (count > show) parts.push(`<span class="bg-checker-count">${count}</span>`);
    return parts.join('');
  }

  function renderDie(value, used) {
    const pips = PIP_MAP[value] || [];
    let cells = '';
    for (let i = 0; i < 9; i += 1) {
      cells += `<span class="bg-die-cell${pips.includes(i) ? ' is-pip' : ''}"></span>`;
    }
    return `<span class="bg-die${used ? ' is-used' : ''}" data-pips="${value}" aria-hidden="true">${cells}</span>`;
  }

  function renderPoint(state, pointNum, selected, destSet) {
    const idx = pointNum - 1;
    const owner = ownerAt(state.points, idx);
    const count = countAt(state.points, idx);
    const dark = pointNum % 2 === 1;
    const sel = selected && selected.type === 'point' && selected.i === idx;
    const dest = destSet.has(idx);
    const cls = [
      'bg-point',
      dark ? 'bg-point--dark' : 'bg-point--light',
      sel ? 'bg-point--sel' : '',
      dest ? 'bg-point--dest' : '',
      count ? 'bg-point--filled' : '',
    ].filter(Boolean).join(' ');
    const label = owner ? `${count} ${owner === 'W' ? 'white' : 'black'} on point ${pointNum}` : `Point ${pointNum}`;
    return [
      `<button type="button" class="${cls}" data-point="${pointNum}" aria-label="${escapeHtml(label)}">`,
      `<span class="bg-point__tri"></span>`,
      `<span class="bg-point__stack">${owner ? checkerStack(count, owner) : ''}</span>`,
      `<span class="bg-point__num">${pointNum}</span>`,
      `</button>`,
    ].join('');
  }

  function renderRow(state, points, selected, destSet) {
    const left = points.slice(0, 6).map((p) => renderPoint(state, p, selected, destSet)).join('');
    const right = points.slice(6).map((p) => renderPoint(state, p, selected, destSet)).join('');
    const side = points[0] > 12 ? 'top' : 'bottom';
    const barSel = selected && selected.type === 'bar';
    const barColor = side === 'top' ? 'B' : 'W';
    const barN = barCount(state, barColor);
    return [
      `<div class="bg-row bg-row--${side}">`,
      `<div class="bg-quad">${left}</div>`,
      `<button type="button" class="bg-bar${barSel && barN ? ' bg-bar--sel' : ''}${barN ? ' bg-bar--filled' : ''}" data-bar="${barColor}" aria-label="${barN} on the bar">`,
      barN ? checkerStack(barN, barColor) : '',
      `</button>`,
      `<div class="bg-quad">${right}</div>`,
      `</div>`,
    ].join('');
  }

  function renderBoard(state, selected, dests) {
    const destSet = new Set((dests || []).filter((d) => d !== 'off'));
    const offDest = (dests || []).includes('off');
    return [
      `<div class="bg-board" role="group" aria-label="Backgammon board">`,
      `<button type="button" class="bg-off bg-off--b${offDest && state.turn === 'B' ? ' bg-off--dest' : ''}" data-off="B" aria-label="Black borne off ${state.offB}">`,
      `<span class="bg-off-label">Off</span>`,
      checkerStack(state.offB, 'B'),
      `<span class="bg-off-count">${state.offB}</span>`,
      `</button>`,
      `<div class="bg-field">`,
      renderRow(state, TOP_POINTS, selected, destSet),
      renderRow(state, BOTTOM_POINTS, selected, destSet),
      `</div>`,
      `<button type="button" class="bg-off bg-off--w${offDest && state.turn === 'W' ? ' bg-off--dest' : ''}" data-off="W" aria-label="White borne off ${state.offW}">`,
      `<span class="bg-off-label">Off</span>`,
      checkerStack(state.offW, 'W'),
      `<span class="bg-off-count">${state.offW}</span>`,
      `</button>`,
      `</div>`,
    ].join('');
  }

  function renderBlock(source, fenceAttrs, options = {}) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const style = resolveStyle(cfg);
    const title = String(cfg.title || 'Backgammon').trim() || 'Backgammon';
    const mode = resolveMode(cfg);
    const difficulty = resolveDifficulty(cfg);
    const state = parseState(cfg);
    const score = parseScore(cfg.score);
    const gameIndex = Number.isFinite(options.backgammonIndex) ? options.backgammonIndex : 0;
    const fullscreen = resolveFullscreen(cfg);
    const themeClass = style.theme ? ` backgammon-block--${style.theme}` : '';
    const customClass = (style.colorCss || style.bgCss) ? ' backgammon-block--custom' : '';
    const fullClass = fullscreen ? ' backgammon-block--fullscreen' : '';
    const styleVars = [];
    if (style.colorCss) styleVars.push(`--backgammon-accent:${style.colorCss}`);
    if (style.bgCss) styleVars.push(`--backgammon-bg:${style.bgCss}`);
    const styleAttr = styleVars.length ? ` style="${styleVars.map((v) => escapeHtml(v)).join(';')}"` : '';
    const meta = mode === 'cpu' ? `vs CPU · ${difficulty}` : '2 players';
    const chrome = fullscreen ? '' : [
      `<div class="backgammon-block-header">`,
      `<div class="backgammon-block-title">${escapeHtml(title)}</div>`,
      `<div class="backgammon-block-meta">${escapeHtml(meta)}</div>`,
      `</div>`,
    ].join('');
    return [
      `<div class="backgammon-block${themeClass}${customClass}${fullClass}"${styleAttr}`,
      ` data-backgammon-index="${gameIndex}"`,
      ` data-backgammon-mode="${mode}"`,
      ` data-backgammon-difficulty="${difficulty}"`,
      ` data-backgammon-turn="${state.turn}"`,
      ` data-backgammon-board="${escapeHtml(serializeBoard(state.points))}"`,
      ` data-backgammon-bar="${serializePair({ w: state.barW, b: state.barB })}"`,
      ` data-backgammon-off="${serializePair({ w: state.offW, b: state.offB })}"`,
      ` data-backgammon-dice="${escapeHtml(serializeDice(state.dice))}"`,
      ` data-backgammon-rolled="${escapeHtml(serializeDice(state.rolled))}"`,
      ` data-backgammon-score="${escapeHtml(serializeScore(score))}" tabindex="0">`,
      window.NotesProGameFullscreen?.renderButton?.() || '',
      chrome,
      `<div class="backgammon-play-area">`,
      `<div class="backgammon-toolbar" role="toolbar" aria-label="Backgammon options">`,
      `<button type="button" class="backgammon-chip${mode === 'cpu' ? ' is-active' : ''}" data-mode="cpu">CPU</button>`,
      `<button type="button" class="backgammon-chip${mode === 'hotseat' ? ' is-active' : ''}" data-mode="hotseat">2 players</button>`,
      `<span class="backgammon-toolbar-gap" aria-hidden="true"></span>`,
      `<button type="button" class="backgammon-chip backgammon-chip--diff${difficulty === 'easy' ? ' is-active' : ''}" data-diff="easy">Easy</button>`,
      `<button type="button" class="backgammon-chip backgammon-chip--diff${difficulty === 'medium' ? ' is-active' : ''}" data-diff="medium">Med</button>`,
      `<button type="button" class="backgammon-chip backgammon-chip--diff${difficulty === 'hard' ? ' is-active' : ''}" data-diff="hard">Hard</button>`,
      `</div>`,
      `<div class="backgammon-score" aria-live="polite">`,
      `<span data-score="w">White 0</span><span data-pips></span><span data-score="b">Black 0</span>`,
      `</div>`,
      renderBoard(state, null, []),
      `<div class="bg-dice" aria-label="Dice">`,
      `<div class="bg-dice-faces" data-dice-faces></div>`,
      `<button type="button" class="btn btn-sm btn-outline-light" data-action="roll">Roll</button>`,
      `</div>`,
      `<div class="backgammon-actions">`,
      `<button type="button" class="btn btn-sm btn-outline-light" data-action="undo">Undo</button>`,
      `<button type="button" class="btn btn-sm btn-outline-light" data-action="new">New game</button>`,
      `</div>`,
      `</div>`,
      `<div class="backgammon-status" aria-live="polite"></div>`,
      `</div>`,
    ].join('');
  }

  function setStatus(el, text, kind) {
    const status = el.querySelector('.backgammon-status');
    if (!status) return;
    status.textContent = text || '';
    status.className = 'backgammon-status' + (kind ? ` backgammon-status--${kind}` : '');
  }

  function reportWin(difficulty, kind, leftover) {
    const score = resultPoints(kind, difficulty, leftover);
    window.NotesProHighscores?.submit?.('backgammon', score, { won: true, level: difficulty === 'hard' ? 3 : difficulty === 'easy' ? 1 : 2 });
  }

  function hydrateBlock(el, options = {}) {
    if (!el || el.dataset.backgammonHydrated === '1') return;
    el.dataset.backgammonHydrated = '1';
    window.NotesProGameFullscreen?.bind?.(el);

    let mode = el.dataset.backgammonMode === 'hotseat' ? 'hotseat' : 'cpu';
    let difficulty = resolveDifficulty({ difficulty: el.dataset.backgammonDifficulty });
    let state = parseState({
      board: el.dataset.backgammonBoard,
      bar: el.dataset.backgammonBar,
      off: el.dataset.backgammonOff,
      dice: el.dataset.backgammonDice,
      rolled: el.dataset.backgammonRolled,
      turn: el.dataset.backgammonTurn,
    });
    let score = parseScore(el.dataset.backgammonScore);
    let selected = null;
    let scored = !!winnerOf(state);
    let busy = false;
    let persistTimer = null;
    let snapshot = null;

    function schedulePersist() {
      if (typeof options.onPersist !== 'function') return;
      clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        options.onPersist({
          board: serializeBoard(state.points),
          mode,
          difficulty,
          score: serializeScore(score),
          turn: state.turn,
          bar: serializePair({ w: state.barW, b: state.barB }),
          off: serializePair({ w: state.offW, b: state.offB }),
          dice: serializeDice(state.dice),
          rolled: serializeDice(state.rolled),
        });
      }, 280);
    }

    function destsForSelected() {
      if (!selected) return [];
      return firstMoves(state)
        .filter((move) => (selected.type === 'bar' ? move.from === 'bar' : move.from === selected.i))
        .map((move) => move.to);
    }

    function paint() {
      const win = winnerOf(state);
      const dests = win || busy ? [] : destsForSelected();
      const board = el.querySelector('.bg-board');
      if (board) board.outerHTML = renderBoard(state, selected, dests);
      el.querySelectorAll('[data-mode]').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.mode === mode);
      });
      el.querySelectorAll('[data-diff]').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.diff === difficulty);
        btn.hidden = mode !== 'cpu';
      });
      const wEl = el.querySelector('[data-score="w"]');
      const bEl = el.querySelector('[data-score="b"]');
      const pEl = el.querySelector('[data-pips]');
      if (wEl) wEl.textContent = mode === 'cpu' ? `You ${score.w}` : `White ${score.w}`;
      if (bEl) bEl.textContent = mode === 'cpu' ? `CPU ${score.b}` : `Black ${score.b}`;
      if (pEl) pEl.textContent = `${pipCount(state, 'W')}–${pipCount(state, 'B')}`;
      const meta = el.querySelector('.backgammon-block-meta');
      if (meta) meta.textContent = mode === 'cpu' ? `vs CPU · ${difficulty}` : '2 players';
      const faces = el.querySelector('[data-dice-faces]');
      if (faces) {
        if (!state.rolled.length) faces.innerHTML = '';
        else {
          const doubles = state.rolled.length === 2 && state.rolled[0] === state.rolled[1];
          const shown = doubles
            ? [state.rolled[0], state.rolled[0], state.rolled[0], state.rolled[0]]
            : state.rolled.slice();
          const remain = state.dice.slice();
          faces.innerHTML = shown.map((die) => {
            const idx = remain.indexOf(die);
            const used = idx < 0;
            if (idx >= 0) remain.splice(idx, 1);
            return renderDie(die, used);
          }).join('');
        }
      }
      const rollBtn = el.querySelector('[data-action="roll"]');
      if (rollBtn) {
        rollBtn.hidden = !!win || !!state.rolled.length || busy;
        rollBtn.disabled = busy;
      }
      const undoBtn = el.querySelector('[data-action="undo"]');
      if (undoBtn) undoBtn.hidden = !snapshot || busy || !!win;
      el.classList.toggle('backgammon-block--busy', busy);
      const you = mode === 'cpu' && state.turn === 'W';
      const name = mode === 'cpu'
        ? (state.turn === 'W' ? 'You' : 'CPU')
        : (state.turn === 'W' ? 'White' : 'Black');
      if (win === 'W') setStatus(el, mode === 'cpu' ? 'You bear off and win!' : 'White bears off and wins.', 'success');
      else if (win === 'B') setStatus(el, mode === 'cpu' ? 'CPU bears off and wins.' : 'Black bears off and wins.', 'warn');
      else if (busy) setStatus(el, 'CPU thinking…', '');
      else if (!state.rolled.length) setStatus(el, `${name} — roll the dice.`, '');
      else if (!firstMoves(state).length) setStatus(el, `${name} has no move.`, 'info');
      else if (selected) setStatus(el, 'Click a highlighted point (or Off) to move.', '');
      else setStatus(el, you || mode === 'hotseat' ? `${name}: click a checker, then a destination.` : 'CPU to play.', '');
    }

    function tally(win) {
      if (!win || scored) return;
      scored = true;
      const kind = winKind(state, win);
      if (win === 'W') {
        score.w += kind === 'backgammon' ? 3 : kind === 'gammon' ? 2 : 1;
        if (mode === 'cpu') reportWin(difficulty, kind, 15 - state.offB);
      } else {
        score.b += kind === 'backgammon' ? 3 : kind === 'gammon' ? 2 : 1;
      }
    }

    function endTurn() {
      selected = null;
      snapshot = null;
      if (winnerOf(state)) {
        tally(winnerOf(state));
        paint();
        schedulePersist();
        return;
      }
      state.turn = state.turn === 'W' ? 'B' : 'W';
      state.dice = [];
      state.rolled = [];
      paint();
      schedulePersist();
      if (mode === 'cpu' && state.turn === 'B') playCpu();
    }

    function afterHumanMove() {
      selected = null;
      if (winnerOf(state) || !state.dice.length || !firstMoves(state).length) {
        window.setTimeout(endTurn, winnerOf(state) ? 80 : 420);
        paint();
        schedulePersist();
        return;
      }
      paint();
      schedulePersist();
    }

    function doRoll() {
      if (busy || winnerOf(state) || state.rolled.length) return;
      if (mode === 'cpu' && state.turn !== 'W') return;
      state = applyRoll(state, rollDice());
      snapshot = cloneState(state);
      selected = null;
      paint();
      schedulePersist();
      if (!firstMoves(state).length) window.setTimeout(endTurn, 700);
    }

    function playMove(move) {
      state = applyMove(state, move);
    }

    function chooseFromClick(fromKey, toKey) {
      const legal = firstMoves(state).filter((move) => (
        sameSlot(move.from, fromKey) && sameSlot(move.to, toKey)
      ));
      if (!legal.length) return null;
      legal.sort((a, b) => a.die - b.die);
      return legal[0];
    }

    function clickSlot(slot) {
      if (busy || winnerOf(state) || !state.rolled.length) return;
      if (mode === 'cpu' && state.turn !== 'W') return;
      const fromKey = selected
        ? (selected.type === 'bar' ? 'bar' : selected.i)
        : null;
      if (fromKey != null) {
        const move = chooseFromClick(fromKey, slot.to);
        if (move) {
          playMove(move);
          afterHumanMove();
          return;
        }
      }
      if (slot.source) {
        if (selected && sameSlot(selected.type === 'bar' ? 'bar' : selected.i, slot.from)) {
          selected = null;
        } else {
          selected = slot.sel;
        }
        paint();
        return;
      }
      selected = null;
      paint();
    }

    function playCpu() {
      if (mode !== 'cpu' || state.turn !== 'B' || winnerOf(state)) return;
      busy = true;
      selected = null;
      paint();
      window.setTimeout(() => {
        if (!state.rolled.length) state = applyRoll(state, rollDice());
        const play = bestPlay(state, difficulty);
        let i = 0;
        function step() {
          if (i >= play.length) {
            busy = false;
            endTurn();
            return;
          }
          playMove(play[i]);
          i += 1;
          paint();
          window.setTimeout(step, 380);
        }
        paint();
        window.setTimeout(step, play.length ? 360 : 500);
      }, 280);
    }

    function newGame() {
      state = emptyState();
      selected = null;
      scored = false;
      busy = false;
      snapshot = null;
      paint();
      schedulePersist();
    }

    function undoTurn() {
      if (!snapshot || busy || winnerOf(state)) return;
      state = cloneState(snapshot);
      selected = null;
      paint();
      schedulePersist();
    }

    el.addEventListener('click', (e) => {
      const modeBtn = e.target.closest('[data-mode]');
      const diffBtn = e.target.closest('[data-diff]');
      const action = e.target.closest('[data-action]')?.dataset.action;
      const point = e.target.closest('[data-point]');
      const bar = e.target.closest('[data-bar]');
      const off = e.target.closest('[data-off]');
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
      if (action === 'new') {
        newGame();
        return;
      }
      if (action === 'undo') {
        undoTurn();
        return;
      }
      if (action === 'roll') {
        doRoll();
        return;
      }
      if (point) {
        const i = parseInt(point.dataset.point, 10) - 1;
        const mine = ownerAt(state.points, i) === state.turn && !barCount(state, state.turn);
        clickSlot({
          to: i,
          from: i,
          source: mine,
          sel: { type: 'point', i },
        });
      } else if (bar) {
        const mine = barCount(state, state.turn) > 0;
        clickSlot({
          to: 'bar',
          from: 'bar',
          source: mine,
          sel: { type: 'bar' },
        });
      } else if (off) {
        clickSlot({ to: 'off', from: 'off', source: false, sel: null });
      }
      el.focus({ preventScroll: true });
    });

    paint();
    if (mode === 'cpu' && state.turn === 'B' && !winnerOf(state)) playCpu();
  }

  function hydrate(root) {
    (root || document).querySelectorAll('.backgammon-block[data-backgammon-index]').forEach((el) => hydrateBlock(el));
  }

  function selfTest() {
    const fails = [];
    function check(name, ok) {
      if (!ok) fails.push(name);
    }
    const start = emptyState();
    check('start pips 167', pipCount(start, 'W') === 167 && pipCount(start, 'B') === 167);
    check('render', renderBlock('', 'fullscreen;mode=cpu').indexOf('bg-board') > 0);

    const hit = emptyState();
    hit.points = [0, 0, 0, 0, -1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    hit.dice = [1];
    hit.rolled = [1, 2];
    const moves = firstMoves(hit);
    check('can hit blot', moves.some((m) => m.from === 5 && m.to === 4 && m.hit));
    const hitMove = moves.find((m) => m.hit);
    const afterHit = hitMove ? applyMove(hit, hitMove) : hit;
    check('hit goes to bar', afterHit.barB === 1 && afterHit.points[4] === 1);

    const closed = emptyState();
    closed.points = [0, 0, 0, 0, -2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    closed.dice = [1];
    closed.rolled = [1];
    check('blocked by made point', firstMoves(closed).length === 0);

    const barIn = emptyState();
    barIn.points = START_POINTS.map(() => 0);
    barIn.barW = 1;
    barIn.dice = [3];
    barIn.rolled = [3];
    const entries = firstMoves(barIn);
    check('enter from bar', entries.length === 1 && entries[0].from === 'bar' && entries[0].to === 21);

    const bear = emptyState();
    bear.points = [3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    bear.offW = 12;
    bear.dice = [1, 2];
    bear.rolled = [1, 2];
    check('in home', inHome(bear, 'W'));
    check('bear off exact', firstMoves(bear).some((m) => m.from === 0 && m.to === 'off' && m.die === 1));

    const overshoot = emptyState();
    overshoot.points = [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    overshoot.offW = 13;
    overshoot.dice = [6];
    overshoot.rolled = [6];
    check('overshoot bear off', firstMoves(overshoot).some((m) => m.to === 'off' && m.from === 0));

    const blockedBear = emptyState();
    blockedBear.points = [1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    blockedBear.offW = 13;
    blockedBear.dice = [6];
    blockedBear.rolled = [6];
    check('no overshoot past higher checker', firstMoves(blockedBear).every((m) => m.from !== 0));

    const both = emptyState();
    both.points = [0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    both.dice = [2, 3];
    both.rolled = [2, 3];
    const plays = maximalPlays(both);
    check('must use both dice', plays.length > 0 && plays.every((p) => p.length === 2));

    const onlyHigh = emptyState();
    onlyHigh.points = [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    onlyHigh.dice = [1, 6];
    onlyHigh.rolled = [1, 6];
    onlyHigh.points[4] = -2;
    const forced = firstMoves(onlyHigh);
    check('must play higher die if only one', forced.length === 1 && forced[0].die === 6);

    const win = emptyState();
    win.offW = 15;
    check('white wins', winnerOf(win) === 'W');
    const gammon = emptyState();
    gammon.points = START_POINTS.map(() => 0);
    gammon.offW = 15;
    check('gammon when none off', winKind(gammon, 'W') === 'gammon');
    const bg = emptyState();
    bg.offW = 15;
    bg.barB = 1;
    check('backgammon on bar', winKind(bg, 'W') === 'backgammon');
    check('hard win beats easy', resultPoints('win', 'hard', 8) > resultPoints('win', 'easy', 8));
    return fails;
  }

  return {
    parseFenceAttrs,
    buildFenceAttrsString,
    serializeBoard,
    renderBlock,
    hydrateBlock,
    hydrate,
    selfTest,
    emptyState,
    applyMove,
    firstMoves,
    bestPlay,
  };
}));
