/**
 * NotesPro ```muhle``` block — Nine Men's Morris (Mühle).
 * White (X) places and moves first. A mill removes one opponent stone
 * (two if the move closes two mills at once). With three stones left,
 * that side may fly to any empty point.
 */
(function (root, factory) {
  const api = factory();
  root.NotesProMuhle = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];
  const NEIGHBORS = [
    [1, 7], [0, 2, 9], [1, 3], [2, 4, 11], [3, 5], [4, 6, 13], [5, 7], [0, 6, 15],
    [9, 15], [8, 10, 1, 17], [9, 11], [10, 12, 3, 19], [11, 13], [12, 14, 5, 21], [13, 15], [8, 14, 7, 23],
    [17, 23], [16, 18, 9], [17, 19], [18, 20, 11], [19, 21], [20, 22, 13], [21, 23], [16, 22, 15],
  ];
  const MILLS = [
    [0, 1, 2], [2, 3, 4], [4, 5, 6], [6, 7, 0],
    [8, 9, 10], [10, 11, 12], [12, 13, 14], [14, 15, 8],
    [16, 17, 18], [18, 19, 20], [20, 21, 22], [22, 23, 16],
    [1, 9, 17], [3, 11, 19], [5, 13, 21], [7, 15, 23],
  ];
  const MILLS_AT = Array.from({ length: 24 }, () => []);
  MILLS.forEach((line) => {
    line.forEach((i) => MILLS_AT[i].push(line));
  });
  const COORDS = [
    [0, 0], [3, 0], [6, 0], [6, 3], [6, 6], [3, 6], [0, 6], [0, 3],
    [1, 1], [3, 1], [5, 1], [5, 3], [5, 5], [3, 5], [1, 5], [1, 3],
    [2, 2], [3, 2], [4, 2], [4, 3], [4, 4], [3, 4], [2, 4], [2, 3],
  ].map(([x, y]) => [8 + x * 14, 8 + y * 14]);

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

  function resolveMode(cfg) {
    const raw = String(cfg.mode || cfg.vs || 'cpu').trim().toLowerCase();
    if (raw === 'hotseat' || raw === '2p' || raw === 'pvp' || raw === 'two') return 'hotseat';
    return 'cpu';
  }

  function resolveDifficulty(cfg) {
    const raw = String(cfg.difficulty || cfg.level || 'medium').trim().toLowerCase();
    if (raw === 'easy' || raw === 'hard') return raw;
    return 'medium';
  }

  function opponent(mark) {
    return mark === 'X' ? 'O' : 'X';
  }

  function clampCount(raw, fallback) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(9, n));
  }

  function emptyState() {
    return {
      board: Array(24).fill(''),
      xleft: 9,
      oleft: 9,
      turn: 'X',
      takes: 0,
    };
  }

  function parseState(cfg, source) {
    const raw = String((cfg && cfg.board) || source || '').toUpperCase().replace(/[^XO.]/g, '');
    const board = raw.padEnd(24, '.').slice(0, 24).split('').map((ch) => (ch === 'X' || ch === 'O' ? ch : ''));
    const placedX = board.filter((c) => c === 'X').length;
    const placedO = board.filter((c) => c === 'O').length;
    const hasLeft = cfg && (cfg.xleft != null && cfg.xleft !== '' || cfg.oleft != null && cfg.oleft !== '');
    const state = {
      board,
      xleft: hasLeft ? clampCount(cfg.xleft, Math.max(0, 9 - placedX)) : Math.max(0, 9 - placedX),
      oleft: hasLeft ? clampCount(cfg.oleft, Math.max(0, 9 - placedO)) : Math.max(0, 9 - placedO),
      turn: String((cfg && cfg.turn) || 'X').toUpperCase() === 'O' ? 'O' : 'X',
      takes: clampCount(cfg && cfg.takes, 0) > 2 ? 2 : Math.max(0, parseInt(cfg && cfg.takes, 10) || 0),
    };
    if (state.takes > 2) state.takes = 2;
    return state;
  }

  function serializeBoard(state) {
    const board = state && state.board ? state.board : state;
    return (board || []).map((cell) => cell || '.').join('').padEnd(24, '.').slice(0, 24);
  }

  function parseScore(raw) {
    const parts = String(raw || '').split(/[-:/,]/).map((n) => parseInt(n, 10));
    return {
      x: Number.isFinite(parts[0]) && parts[0] >= 0 ? parts[0] : 0,
      o: Number.isFinite(parts[1]) && parts[1] >= 0 ? parts[1] : 0,
      draw: Number.isFinite(parts[2]) && parts[2] >= 0 ? parts[2] : 0,
    };
  }

  function serializeScore(score) {
    return `${score.x}-${score.o}-${score.draw}`;
  }

  function buildFenceAttrsString(cfg, boardStr) {
    const parts = [];
    Object.entries(cfg || {}).forEach(([key, value]) => {
      if (key === 'board') return;
      if (key === 'score' && String(value) === '0-0-0') return;
      if ((key === 'xleft' || key === 'oleft') && String(value) === '9') return;
      if (key === 'takes' && String(value) === '0') return;
      if (key === 'turn' && String(value).toUpperCase() === 'X') return;
      if (value == null || value === '') return;
      parts.push(`${key}=${value}`);
    });
    if (boardStr && boardStr !== '........................') parts.push(`board=${boardStr}`);
    return parts.join(';');
  }

  function countOf(board, mark) {
    let n = 0;
    for (let i = 0; i < 24; i += 1) if (board[i] === mark) n += 1;
    return n;
  }

  function millsAt(board, index) {
    const mark = board[index];
    if (!mark) return 0;
    let n = 0;
    const lines = MILLS_AT[index];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (board[line[0]] === mark && board[line[1]] === mark && board[line[2]] === mark) n += 1;
    }
    return n;
  }

  function inMill(board, index) {
    return millsAt(board, index) > 0;
  }

  function leftOf(state, mark) {
    return mark === 'X' ? state.xleft : state.oleft;
  }

  function phaseOf(state, mark) {
    if (leftOf(state, mark) > 0) return 'place';
    if (countOf(state.board, mark) <= 3) return 'fly';
    return 'move';
  }

  function placementDone(state) {
    return state.xleft === 0 && state.oleft === 0;
  }

  function cloneState(state) {
    return {
      board: state.board.slice(),
      xleft: state.xleft,
      oleft: state.oleft,
      turn: state.turn,
      takes: state.takes,
    };
  }

  function removable(state) {
    const opp = opponent(state.turn);
    const all = [];
    const free = [];
    for (let i = 0; i < 24; i += 1) {
      if (state.board[i] !== opp) continue;
      all.push(i);
      if (!inMill(state.board, i)) free.push(i);
    }
    return free.length ? free : all;
  }

  function legalMoves(state) {
    if (state.takes > 0) {
      return removable(state).map((to) => ({ type: 'remove', to }));
    }
    const turn = state.turn;
    const phase = phaseOf(state, turn);
    const moves = [];
    if (phase === 'place') {
      for (let i = 0; i < 24; i += 1) {
        if (!state.board[i]) moves.push({ type: 'place', to: i });
      }
      return moves;
    }
    for (let from = 0; from < 24; from += 1) {
      if (state.board[from] !== turn) continue;
      const dests = phase === 'fly'
        ? state.board.map((cell, i) => (cell ? -1 : i)).filter((i) => i >= 0)
        : NEIGHBORS[from].filter((i) => !state.board[i]);
      dests.forEach((to) => moves.push({ type: 'move', from, to }));
    }
    return moves;
  }

  function applyMove(state, move) {
    const next = cloneState(state);
    const turn = next.turn;
    if (move.type === 'remove') {
      next.board[move.to] = '';
      next.takes = Math.max(0, next.takes - 1);
      if (next.takes === 0) next.turn = opponent(turn);
      return next;
    }
    if (move.type === 'place') {
      next.board[move.to] = turn;
      if (turn === 'X') next.xleft -= 1;
      else next.oleft -= 1;
    } else {
      next.board[move.from] = '';
      next.board[move.to] = turn;
    }
    const closed = millsAt(next.board, move.to);
    if (closed > 0) next.takes = closed;
    else next.turn = opponent(turn);
    return next;
  }

  function winnerOf(state) {
    if (!placementDone(state)) return null;
    const xc = countOf(state.board, 'X');
    const oc = countOf(state.board, 'O');
    if (xc < 3) return 'O';
    if (oc < 3) return 'X';
    if (state.takes > 0) return null;
    if (!legalMoves(state).length) return opponent(state.turn);
    return null;
  }

  function peek(state, move) {
    if (move.type === 'remove') return state.board;
    const board = state.board.slice();
    if (move.type === 'move') board[move.from] = '';
    board[move.to] = state.turn;
    return board;
  }

  function wouldMill(state, move) {
    if (move.type === 'remove') return false;
    return millsAt(peek(state, move), move.to) > 0;
  }

  function blocksMill(state, move) {
    if (move.type !== 'place' && move.type !== 'move') return false;
    const opp = opponent(state.turn);
    const board = state.board.slice();
    if (move.type === 'move') board[move.from] = '';
    if (board[move.to]) return false;
    board[move.to] = opp;
    return millsAt(board, move.to) > 0;
  }

  function lineCounts(board, line) {
    let x = 0;
    let o = 0;
    let empty = 0;
    for (let k = 0; k < 3; k += 1) {
      const cell = board[line[k]];
      if (cell === 'X') x += 1;
      else if (cell === 'O') o += 1;
      else empty += 1;
    }
    return { x, o, empty };
  }

  function evaluate(state, ai) {
    const win = winnerOf(state);
    if (win === ai) return 12000;
    if (win) return -12000;
    const opp = opponent(ai);
    const board = state.board;
    let score = (countOf(board, ai) + leftOf(state, ai) - countOf(board, opp) - leftOf(state, opp)) * 180;
    for (let i = 0; i < MILLS.length; i += 1) {
      const counts = lineCounts(board, MILLS[i]);
      const mine = ai === 'X' ? counts.x : counts.o;
      const them = ai === 'X' ? counts.o : counts.x;
      if (mine === 3) score += 48;
      else if (mine === 2 && counts.empty === 1) score += 86;
      else if (mine === 1 && counts.empty === 2) score += 8;
      if (them === 3) score -= 48;
      else if (them === 2 && counts.empty === 1) score -= 108;
      else if (them === 1 && counts.empty === 2) score -= 8;
    }
    if (placementDone(state)) {
      const mineN = countOf(board, ai);
      const oppN = countOf(board, opp);
      if (mineN <= 3) score -= 90;
      if (oppN <= 3) score += 90;
      const mobile = legalMoves(state).length;
      score += state.turn === ai ? mobile * 3 : -mobile * 3;
    }
    for (let i = 0; i < 24; i += 1) {
      if (!board[i]) continue;
      const weight = (NEIGHBORS[i].length - 2) * 14;
      score += board[i] === ai ? weight : -weight;
    }
    if (state.takes > 0) score += state.turn === ai ? 40 : -40;
    return score;
  }

  function moveRank(state, move) {
    if (move.type === 'remove') {
      let rank = 40 + NEIGHBORS[move.to].length;
      const mark = state.board[move.to];
      MILLS_AT[move.to].forEach((line) => {
        let friends = 0;
        let empty = 0;
        for (let k = 0; k < 3; k += 1) {
          const cell = state.board[line[k]];
          if (line[k] === move.to) continue;
          if (cell === mark) friends += 1;
          else if (!cell) empty += 1;
        }
        if (friends === 1 && empty === 1) rank += 12;
      });
      return rank;
    }
    if (wouldMill(state, move)) return 200 + millsAt(peek(state, move), move.to) * 20;
    if (blocksMill(state, move)) return 140;
    const board = peek(state, move);
    let threats = 0;
    MILLS_AT[move.to].forEach((line) => {
      const counts = lineCounts(board, line);
      const mine = state.turn === 'X' ? counts.x : counts.o;
      if (mine === 2 && counts.empty === 1) threats += 1;
    });
    return 10 + threats * 28 + NEIGHBORS[move.to].length;
  }

  function orderMoves(state, moves) {
    return moves.slice().sort((a, b) => moveRank(state, b) - moveRank(state, a));
  }

  function search(state, depth, alpha, beta, ai, budget) {
    budget.n += 1;
    if (budget.stop || budget.n > budget.limit || ((budget.n & 63) === 0 && Date.now() > budget.deadline)) {
      budget.stop = true;
      return evaluate(state, ai);
    }
    const win = winnerOf(state);
    if (win === ai) return 9000 + depth;
    if (win) return depth - 9000;
    let moves = legalMoves(state);
    if (!moves.length) return state.turn === ai ? -9000 : 9000;
    if (state.takes > 0) {
      moves = orderMoves(state, moves);
    } else if (depth <= 0) {
      const mills = moves.filter((mv) => wouldMill(state, mv));
      if (!mills.length || depth < -1) return evaluate(state, ai);
      moves = orderMoves(state, mills);
    } else {
      moves = orderMoves(state, moves);
    }
    const maxing = state.turn === ai;
    let best = maxing ? -Infinity : Infinity;
    for (let i = 0; i < moves.length; i += 1) {
      const child = applyMove(state, moves[i]);
      const nextDepth = child.takes > 0 && child.turn === state.turn ? depth : depth - 1;
      const score = search(child, nextDepth, alpha, beta, ai, budget);
      if (maxing) {
        if (score > best) best = score;
        if (best > alpha) alpha = best;
      } else {
        if (score < best) best = score;
        if (best < beta) beta = best;
      }
      if (alpha >= beta) break;
    }
    return best;
  }

  function chooseMove(state, difficulty) {
    const moves = legalMoves(state);
    if (!moves.length) return null;
    if (difficulty === 'easy') {
      const mills = moves.filter((mv) => mv.type === 'remove' || wouldMill(state, mv));
      if (mills.length) return orderMoves(state, mills)[0];
      const blocks = moves.filter((mv) => blocksMill(state, mv));
      if (blocks.length && Math.random() < 0.72) return blocks[Math.floor(Math.random() * blocks.length)];
      return moves[Math.floor(Math.random() * moves.length)];
    }
    const ordered = orderMoves(state, moves);
    let depth = difficulty === 'hard' ? 3 : 2;
    if (difficulty === 'hard' && ordered.length <= 16) depth = 4;
    const ai = state.turn;
    const budget = {
      n: 0,
      limit: difficulty === 'hard' ? 50000 : 16000,
      deadline: Date.now() + (difficulty === 'hard' ? 280 : 140),
      stop: false,
    };
    let best = -Infinity;
    let choices = [];
    for (let i = 0; i < ordered.length; i += 1) {
      const child = applyMove(state, ordered[i]);
      const nextDepth = child.takes > 0 && child.turn === state.turn ? depth : depth - 1;
      const score = search(child, nextDepth, -Infinity, Infinity, ai, budget);
      if (score > best) {
        best = score;
        choices = [ordered[i]];
      } else if (score === best) choices.push(ordered[i]);
    }
    choices.sort((a, b) => moveRank(state, b) - moveRank(state, a));
    const top = moveRank(state, choices[0]);
    const tied = choices.filter((mv) => moveRank(state, mv) === top);
    return tied[Math.floor(Math.random() * tied.length)];
  }

  function sideName(mark, mode) {
    if (mode === 'cpu') return mark === 'X' ? 'You' : 'CPU';
    return mark === 'X' ? 'White' : 'Black';
  }

  function scoreLine(score, mode) {
    const left = mode === 'cpu' ? 'You' : 'White';
    const right = mode === 'cpu' ? 'CPU' : 'Black';
    const draw = score && score.draw ? ` · Draw ${score.draw}` : '';
    return `${left} ${score ? score.x : 0}–${right} ${score ? score.o : 0}${draw}`;
  }

  function statusFor(state, mode, score) {
    const win = winnerOf(state);
    const tally = score ? `  ${scoreLine(score, mode)}` : '';
    if (win === 'X') return { text: (mode === 'cpu' ? 'You win!' : 'White wins.') + tally, kind: 'success' };
    if (win === 'O') return { text: (mode === 'cpu' ? 'CPU wins.' : 'Black wins.') + tally, kind: 'warn' };
    if (state.takes > 0) {
      const n = state.takes;
      return {
        text: n > 1 ? `Mill. Remove ${n} opponent stones.` : 'Mill. Remove an opponent stone.',
        kind: 'info',
      };
    }
    const phase = phaseOf(state, state.turn);
    const who = sideName(state.turn, mode);
    const left = leftOf(state, state.turn);
    if (phase === 'place') return { text: `${who}: place a stone. ${left} left.`, kind: '' };
    if (phase === 'fly') return { text: `${who} may fly to any empty point.`, kind: '' };
    return { text: `${who}: move a stone along a line.`, kind: '' };
  }

  function linePath(points) {
    return points.map((i, n) => `${n ? 'L' : 'M'} ${COORDS[i][0]} ${COORDS[i][1]}`).join(' ');
  }

  function renderBoardSvg() {
    const squares = [
      [0, 1, 2, 3, 4, 5, 6, 7, 0],
      [8, 9, 10, 11, 12, 13, 14, 15, 8],
      [16, 17, 18, 19, 20, 21, 22, 23, 16],
    ];
    const spokes = [[1, 9, 17], [3, 11, 19], [5, 13, 21], [7, 15, 23]];
    const paths = squares.concat(spokes).map((pts) => `<path d="${linePath(pts)}"></path>`).join('');
    return `<svg class="muhle-lines" viewBox="0 0 100 100" aria-hidden="true">${paths}</svg>`;
  }

  function renderPoints(state, selected, dests, takes) {
    return state.board.map((mark, i) => {
      const [x, y] = COORDS[i];
      const cls = [
        'muhle-point',
        mark === 'X' ? 'muhle-point--x' : '',
        mark === 'O' ? 'muhle-point--o' : '',
        !mark ? 'muhle-point--empty' : '',
        selected === i ? 'muhle-point--sel' : '',
        dests.includes(i) ? 'muhle-point--dest' : '',
        takes.includes(i) ? 'muhle-point--take' : '',
        mark && inMill(state.board, i) ? 'muhle-point--mill' : '',
      ].filter(Boolean).join(' ');
      return `<button type="button" class="${cls}" data-idx="${i}" style="left:${x}%;top:${y}%" aria-label="Point ${i + 1}"></button>`;
    }).join('');
  }

  function renderBlock(source, fenceAttrs, options = {}) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const style = resolveStyle(cfg);
    const title = String(cfg.title || 'Mühle').trim() || 'Mühle';
    const mode = resolveMode(cfg);
    const difficulty = resolveDifficulty(cfg);
    const state = parseState(cfg, source);
    const score = parseScore(cfg.score);
    const gameIndex = Number.isFinite(options.muhleIndex) ? options.muhleIndex : 0;
    const fullscreen = resolveFullscreen(cfg);
    const themeClass = style.theme ? ` muhle-block--${style.theme}` : '';
    const customClass = (style.colorCss || style.bgCss) ? ' muhle-block--custom' : '';
    const fullClass = fullscreen ? ' muhle-block--fullscreen' : '';
    const styleVars = [];
    if (style.colorCss) styleVars.push(`--strat-accent:${style.colorCss}`);
    if (style.bgCss) styleVars.push(`--strat-bg:${style.bgCss}`);
    const styleAttr = styleVars.length ? ` style="${styleVars.map((v) => escapeHtml(v)).join(';')}"` : '';
    const meta = mode === 'cpu' ? `vs CPU · ${difficulty}` : '2 players';
    const st = statusFor(state, mode, score);
    const chrome = fullscreen ? '' : [
      `<div class="muhle-block-header">`,
      `<div class="muhle-block-title">${escapeHtml(title)}</div>`,
      `<div class="muhle-block-meta">${escapeHtml(meta)}</div>`,
      `</div>`,
    ].join('');
    return [
      `<div class="muhle-block${themeClass}${customClass}${fullClass}"${styleAttr}`,
      ` data-muhle-index="${gameIndex}"`,
      ` data-muhle-mode="${mode}"`,
      ` data-muhle-difficulty="${difficulty}"`,
      ` data-muhle-board="${escapeHtml(serializeBoard(state))}"`,
      ` data-muhle-xleft="${state.xleft}"`,
      ` data-muhle-oleft="${state.oleft}"`,
      ` data-muhle-turn="${state.turn}"`,
      ` data-muhle-takes="${state.takes}"`,
      ` data-muhle-score="${escapeHtml(serializeScore(score))}" tabindex="0">`,
      (typeof window !== 'undefined' && window.NotesProGameFullscreen?.renderButton?.()) || '',
      chrome,
      `<div class="muhle-play-area">`,
      `<div class="muhle-toolbar" role="toolbar" aria-label="Mühle options">`,
      `<button type="button" class="muhle-chip${mode === 'cpu' ? ' is-active' : ''}" data-mode="cpu">CPU</button>`,
      `<button type="button" class="muhle-chip${mode === 'hotseat' ? ' is-active' : ''}" data-mode="hotseat">2 players</button>`,
      `<span class="muhle-toolbar-gap" aria-hidden="true"></span>`,
      `<button type="button" class="muhle-chip muhle-chip--diff${difficulty === 'easy' ? ' is-active' : ''}" data-diff="easy">Easy</button>`,
      `<button type="button" class="muhle-chip muhle-chip--diff${difficulty === 'medium' ? ' is-active' : ''}" data-diff="medium">Med</button>`,
      `<button type="button" class="muhle-chip muhle-chip--diff${difficulty === 'hard' ? ' is-active' : ''}" data-diff="hard">Hard</button>`,
      `</div>`,
      `<div class="muhle-score" aria-live="polite">`,
      `<span data-score="x">You ${score.x}</span>`,
      `<span data-score="draw">Draw ${score.draw}</span>`,
      `<span data-score="o">CPU ${score.o}</span>`,
      `<span data-score="hi" hidden></span>`,
      `</div>`,
      `<div class="muhle-board" role="group" aria-label="${escapeHtml(title)}">`,
      renderBoardSvg(),
      renderPoints(state, -1, [], []),
      `</div>`,
      `<div class="muhle-actions">`,
      `<button type="button" class="btn btn-sm btn-outline-light" data-action="new">New game</button>`,
      `</div>`,
      `</div>`,
      `<div class="muhle-status${st.kind ? ` muhle-status--${st.kind}` : ''}" aria-live="polite">${escapeHtml(st.text)}</div>`,
      `</div>`,
    ].join('');
  }

  function hints(state, selected) {
    if (winnerOf(state)) return { dests: [], takes: [] };
    if (state.takes > 0) return { dests: [], takes: removable(state) };
    const phase = phaseOf(state, state.turn);
    if (phase === 'place') {
      const dests = [];
      for (let i = 0; i < 24; i += 1) if (!state.board[i]) dests.push(i);
      return { dests, takes: [] };
    }
    if (selected < 0 || state.board[selected] !== state.turn) return { dests: [], takes: [] };
    const dests = phase === 'fly'
      ? state.board.map((cell, i) => (cell ? -1 : i)).filter((i) => i >= 0)
      : NEIGHBORS[selected].filter((i) => !state.board[i]);
    return { dests, takes: [] };
  }

  function paint(el, state, selected) {
    const hint = hints(state, selected);
    el.querySelectorAll('.muhle-point').forEach((point) => {
      const idx = parseInt(point.dataset.idx, 10);
      const mark = state.board[idx] || '';
      point.classList.toggle('muhle-point--x', mark === 'X');
      point.classList.toggle('muhle-point--o', mark === 'O');
      point.classList.toggle('muhle-point--empty', !mark);
      point.classList.toggle('muhle-point--sel', selected === idx);
      point.classList.toggle('muhle-point--dest', hint.dests.includes(idx));
      point.classList.toggle('muhle-point--take', hint.takes.includes(idx));
      point.classList.toggle('muhle-point--mill', !!(mark && inMill(state.board, idx)));
    });
  }

  function resultPoints(kind, difficulty, moves) {
    const mult = difficulty === 'hard' ? 3 : difficulty === 'easy' ? 1 : 2;
    const base = kind === 'win' ? 15000 : kind === 'draw' ? 7000 : 2000;
    const floor = kind === 'loss' ? 50 : 100;
    return Math.max(floor, base * mult - moves * 30);
  }

  function reportResult(kind, difficulty, moves) {
    const mult = difficulty === 'hard' ? 3 : difficulty === 'easy' ? 1 : 2;
    const points = resultPoints(kind, difficulty, moves);
    const extra = { won: kind === 'win', level: mult, moves };
    const pending = window.NotesProHighscores?.submit?.('muhle', points, extra);
    return Promise.resolve(pending).then((res) => ({
      points,
      improved: !!res?.improved,
    }));
  }

  function hydrateBlock(el, options = {}) {
    if (!el || el.dataset.muhleHydrated === '1') return;
    el.dataset.muhleHydrated = '1';
    window.NotesProGameFullscreen?.bind?.(el);

    let mode = el.dataset.muhleMode === 'hotseat' ? 'hotseat' : 'cpu';
    let difficulty = resolveDifficulty({ difficulty: el.dataset.muhleDifficulty });
    let state = parseState({
      board: el.dataset.muhleBoard,
      xleft: el.dataset.muhleXleft,
      oleft: el.dataset.muhleOleft,
      turn: el.dataset.muhleTurn,
      takes: el.dataset.muhleTakes,
    });
    let score = parseScore(el.dataset.muhleScore);
    let selected = -1;
    let scored = !!winnerOf(state);
    let busy = false;
    let moves = 0;
    let persistTimer = null;
    const seen = new Map();

    function remember() {
      const key = `${serializeBoard(state)}|${state.turn}|${state.takes}|${state.xleft}|${state.oleft}`;
      const n = (seen.get(key) || 0) + 1;
      seen.set(key, n);
      return n >= 3;
    }

    function schedulePersist() {
      if (typeof options.onPersist !== 'function') return;
      clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        options.onPersist({
          board: serializeBoard(state),
          mode,
          difficulty,
          score: serializeScore(score),
          turn: state.turn,
          xleft: String(state.xleft),
          oleft: String(state.oleft),
          takes: String(state.takes),
        });
      }, 280);
    }

    function syncChrome() {
      el.querySelectorAll('[data-mode]').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.mode === mode);
      });
      el.querySelectorAll('[data-diff]').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.diff === difficulty);
        btn.hidden = mode !== 'cpu';
      });
      const xEl = el.querySelector('[data-score="x"]');
      const oEl = el.querySelector('[data-score="o"]');
      const dEl = el.querySelector('[data-score="draw"]');
      if (xEl) xEl.textContent = mode === 'cpu' ? `You ${score.x}` : `White ${score.x}`;
      if (oEl) oEl.textContent = mode === 'cpu' ? `CPU ${score.o}` : `Black ${score.o}`;
      if (dEl) {
        dEl.textContent = `Draw ${score.draw}`;
        dEl.hidden = score.draw === 0;
      }
      const hiEl = el.querySelector('[data-score="hi"]');
      if (hiEl) {
        const hi = window.NotesProHighscores?.statusSuffix?.('muhle', 0) || '';
        hiEl.textContent = hi.replace(/^ · /, '');
        hiEl.hidden = !hiEl.textContent;
      }
      const meta = el.querySelector('.muhle-block-meta');
      if (meta) meta.textContent = mode === 'cpu' ? `vs CPU · ${difficulty}` : '2 players';
      el.classList.toggle('muhle-block--busy', busy);
      const st = statusFor(state, mode, score);
      const status = el.querySelector('.muhle-status');
      if (status) {
        status.textContent = busy && state.turn === 'O' && mode === 'cpu' ? 'CPU is thinking…' : st.text;
        status.className = 'muhle-status' + (st.kind ? ` muhle-status--${st.kind}` : '');
      }
    }

    function refresh() {
      paint(el, state, selected);
      syncChrome();
    }

    function tally(win) {
      if (!win || scored) return;
      scored = true;
      if (win === 'X') score.x += 1;
      else if (win === 'O') score.o += 1;
      if (mode === 'cpu') publishResult(win === 'X' ? 'win' : 'loss');
    }

    function publishResult(kind, label) {
      const snapshot = label || statusFor(state, mode, score).text;
      reportResult(kind, difficulty, moves).then((res) => {
        if (!el.isConnected) return;
        const hi = window.NotesProHighscores?.statusSuffix?.('muhle', res.points) || '';
        const status = el.querySelector('.muhle-status');
        const prefix = res.improved ? 'New high score · ' : '';
        if (status) status.textContent = `${prefix}${snapshot} · ${res.points} pts${hi}`;
        const hiEl = el.querySelector('[data-score="hi"]');
        if (hiEl) {
          hiEl.textContent = (hi || `HI ${res.points}`).replace(/^ · /, '');
          hiEl.hidden = !hiEl.textContent;
        }
      });
    }

    function afterHuman() {
      moves += 1;
      const repeated = remember();
      const win = repeated ? null : winnerOf(state);
      if (win) tally(win);
      if (repeated) {
        score.draw += 1;
        scored = true;
      }
      refresh();
      if (repeated) {
        const status = el.querySelector('.muhle-status');
        if (status) {
          status.textContent = 'Draw by repetition.';
          status.className = 'muhle-status muhle-status--info';
        }
        if (mode === 'cpu') publishResult('draw', 'Draw by repetition.');
      }
      schedulePersist();
      if (!repeated && mode === 'cpu' && !win && state.turn === 'O') playCpu();
    }

    function playCpu() {
      if (mode !== 'cpu' || winnerOf(state) || state.turn !== 'O') return;
      busy = true;
      refresh();
      window.setTimeout(() => {
        if (winnerOf(state) || state.turn !== 'O') {
          busy = false;
          refresh();
          return;
        }
        const mv = chooseMove(state, difficulty);
        if (!mv) {
          busy = false;
          refresh();
          return;
        }
        state = applyMove(state, mv);
        selected = -1;
        const win = winnerOf(state);
        if (win) {
          tally(win);
          busy = false;
          refresh();
          schedulePersist();
          return;
        }
        if (state.turn === 'O') {
          playCpu();
          return;
        }
        busy = false;
        refresh();
        schedulePersist();
      }, 320);
    }

    function clickPoint(index) {
      if (busy || winnerOf(state) || scored) return;
      if (mode === 'cpu' && state.turn !== 'X') return;
      if (state.takes > 0) {
        if (!removable(state).includes(index)) return;
        state = applyMove(state, { type: 'remove', to: index });
        selected = -1;
        afterHuman();
        return;
      }
      const phase = phaseOf(state, state.turn);
      if (phase === 'place') {
        if (state.board[index]) return;
        state = applyMove(state, { type: 'place', to: index });
        selected = -1;
        afterHuman();
        return;
      }
      if (state.board[index] === state.turn) {
        selected = selected === index ? -1 : index;
        refresh();
        return;
      }
      if (selected < 0 || state.board[index]) return;
      const { dests } = hints(state, selected);
      if (!dests.includes(index)) return;
      state = applyMove(state, { type: 'move', from: selected, to: index });
      selected = -1;
      afterHuman();
    }

    function newGame() {
      state = emptyState();
      selected = -1;
      scored = false;
      busy = false;
      moves = 0;
      seen.clear();
      refresh();
      schedulePersist();
    }

    function nearestPoint(board, event) {
      const rect = board.getBoundingClientRect();
      const cs = getComputedStyle(board);
      const bl = parseFloat(cs.borderLeftWidth) || 0;
      const br = parseFloat(cs.borderRightWidth) || 0;
      const bt = parseFloat(cs.borderTopWidth) || 0;
      const bb = parseFloat(cs.borderBottomWidth) || 0;
      const innerW = rect.width - bl - br;
      const innerH = rect.height - bt - bb;
      if (innerW <= 0 || innerH <= 0) return -1;
      const x = ((event.clientX - rect.left - bl) / innerW) * 100;
      const y = ((event.clientY - rect.top - bt) / innerH) * 100;
      let best = -1;
      let bestD = 81;
      for (let i = 0; i < COORDS.length; i += 1) {
        const dx = x - COORDS[i][0];
        const dy = y - COORDS[i][1];
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    }

    el.querySelector('.muhle-board')?.addEventListener('click', (e) => {
      const board = e.currentTarget;
      const fromBtn = e.target.closest?.('.muhle-point');
      const index = fromBtn
        ? parseInt(fromBtn.dataset.idx, 10)
        : nearestPoint(board, e);
      if (!Number.isFinite(index) || index < 0) return;
      el.focus({ preventScroll: true });
      clickPoint(index);
    });
    el.querySelector('[data-action="new"]')?.addEventListener('click', (e) => {
      e.preventDefault();
      newGame();
    });
    el.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const next = btn.dataset.mode === 'hotseat' ? 'hotseat' : 'cpu';
        if (next === mode) return;
        mode = next;
        newGame();
      });
    });
    el.querySelectorAll('[data-diff]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const next = resolveDifficulty({ difficulty: btn.dataset.diff });
        if (next === difficulty) return;
        difficulty = next;
        if (mode === 'cpu') newGame();
        else {
          refresh();
          schedulePersist();
        }
      });
    });

    refresh();
    if (mode === 'cpu' && !winnerOf(state) && state.turn === 'O') playCpu();
  }

  function hydrate(root) {
    (root || document).querySelectorAll('.muhle-block[data-muhle-index]').forEach((el) => hydrateBlock(el));
  }

  function selfTest() {
    const fails = [];
    function check(name, ok) {
      if (!ok) fails.push(name);
    }
    const start = emptyState();
    check('opening moves', legalMoves(start).length === 24);
    let s = start;
    s = applyMove(s, { type: 'place', to: 0 });
    s = applyMove(s, { type: 'place', to: 8 });
    s = applyMove(s, { type: 'place', to: 1 });
    s = applyMove(s, { type: 'place', to: 10 });
    s = applyMove(s, { type: 'place', to: 2 });
    check('mill takes', s.takes === 1 && s.turn === 'X' && s.board[0] === 'X' && s.board[1] === 'X' && s.board[2] === 'X');
    const before = removable(s);
    check('cannot take from mill only', before.includes(8) && before.includes(10));
    s = applyMove(s, { type: 'remove', to: 8 });
    check('removed', s.board[8] === '' && s.turn === 'O' && s.takes === 0);

    const both = emptyState();
    both.board = Array(24).fill('');
    both.board[1] = 'X';
    both.board[2] = 'X';
    both.board[7] = 'X';
    both.board[6] = 'X';
    both.xleft = 1;
    both.oleft = 0;
    both.turn = 'X';
    const closed = applyMove(both, { type: 'place', to: 0 });
    check('double mill', closed.takes === 2 && closed.turn === 'X');

    const end = emptyState();
    end.xleft = 0;
    end.oleft = 0;
    end.turn = 'X';
    end.board[0] = 'X';
    end.board[1] = 'X';
    end.board[16] = 'X';
    end.board[4] = 'O';
    end.board[5] = 'O';
    end.board[6] = 'O';
    const milled = applyMove(end, { type: 'move', from: 16, to: 2 });
    check('late mill', milled.takes === 1 && milled.xleft === 0);
    const won = applyMove(milled, { type: 'remove', to: 4 });
    check('win by two stones', winnerOf(won) === 'X' && countOf(won.board, 'O') === 2);

    const fly = emptyState();
    fly.xleft = 0;
    fly.oleft = 0;
    fly.turn = 'X';
    fly.board[0] = 'X';
    fly.board[8] = 'X';
    fly.board[16] = 'X';
    fly.board[4] = 'O';
    fly.board[5] = 'O';
    fly.board[6] = 'O';
    check('fly phase', phaseOf(fly, 'X') === 'fly');
    const flyMoves = legalMoves(fly).filter((mv) => mv.from === 0);
    check('fly reaches far point', flyMoves.some((mv) => mv.to === 12));

    const block = emptyState();
    block.board[0] = 'X';
    block.board[1] = 'X';
    block.xleft = 7;
    block.oleft = 9;
    block.turn = 'O';
    const blocked = chooseMove(block, 'medium');
    check('blocks a mill', blocked && blocked.type === 'place' && blocked.to === 2);

    const strike = emptyState();
    strike.board[8] = 'O';
    strike.board[9] = 'O';
    strike.board[0] = 'X';
    strike.board[1] = 'X';
    strike.xleft = 7;
    strike.oleft = 7;
    strike.turn = 'O';
    const struck = chooseMove(strike, 'medium');
    check('closes own mill first', struck && struck.type === 'place' && struck.to === 10);

    const reply = emptyState();
    reply.board[0] = 'X';
    reply.xleft = 8;
    reply.oleft = 9;
    reply.turn = 'O';
    const answer = chooseMove(reply, 'hard');
    check('opening takes a junction', answer && answer.type === 'place' && NEIGHBORS[answer.to].length >= 3);

    check('render', renderBlock('', 'fullscreen;mode=cpu').indexOf('muhle-board') > 0);
    const wonHtml = renderBlock('', 'mode=cpu;score=2-1-0;xleft=0;oleft=0;board=XXX...............OO..............');
    check('win count in score', wonHtml.indexOf('You 2') > 0 && wonHtml.indexOf('CPU 1') > 0);
    check('win count in status', wonHtml.indexOf('You win!') > 0 && wonHtml.indexOf('You 2–CPU 1') > 0);
    check('win points beat a loss', resultPoints('win', 'medium', 12) > resultPoints('loss', 'medium', 12));
    check('loss still scores', resultPoints('loss', 'easy', 20) >= 50);
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
    chooseMove,
    emptyState,
    applyMove,
    winnerOf,
    legalMoves,
  };
}));
