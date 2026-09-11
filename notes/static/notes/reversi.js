/**
 * NotesPro ```reversi``` / ```othello``` block — flip discs, own the board.
 */
(function (root, factory) {
  const api = factory();
  root.NotesProReversi = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];
  const N = 8;
  const DIRS = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1],
  ];
  const START = (
    '........'
    + '........'
    + '........'
    + '...WB...'
    + '...BW...'
    + '........'
    + '........'
    + '........'
  );
  const WEIGHTS = [
    120, -20, 20, 5, 5, 20, -20, 120,
    -20, -40, -5, -5, -5, -5, -40, -20,
    20, -5, 15, 3, 3, 15, -5, 20,
    5, -5, 3, 3, 3, 3, -5, 5,
    5, -5, 3, 3, 3, 3, -5, 5,
    20, -5, 15, 3, 3, 15, -5, 20,
    -20, -40, -5, -5, -5, -5, -40, -20,
    120, -20, 20, 5, 5, 20, -20, 120,
  ];

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

  function parseBoard(raw) {
    const chars = String(raw || START).toUpperCase().replace(/[^BW.]/g, '').padEnd(64, '.').slice(0, 64);
    if (!/[BW]/.test(chars)) return START.split('');
    return chars.split('');
  }

  function serializeBoard(board) {
    return (board || []).join('').padEnd(64, '.').slice(0, 64);
  }

  function parseScore(raw) {
    const parts = String(raw || '').split(/[-:/,]/).map((n) => parseInt(n, 10));
    return {
      b: Number.isFinite(parts[0]) && parts[0] >= 0 ? parts[0] : 0,
      w: Number.isFinite(parts[1]) && parts[1] >= 0 ? parts[1] : 0,
      draw: Number.isFinite(parts[2]) && parts[2] >= 0 ? parts[2] : 0,
    };
  }

  function serializeScore(score) {
    return `${score.b}-${score.w}-${score.draw}`;
  }

  function buildFenceAttrsString(cfg, boardStr) {
    const parts = [];
    Object.entries(cfg || {}).forEach(([key, value]) => {
      if (key === 'board') return;
      if (key === 'score' && String(value) === '0-0-0') return;
      if (value == null || value === '') return;
      parts.push(`${key}=${value}`);
    });
    if (boardStr && boardStr !== START) parts.push(`board=${boardStr}`);
    return parts.join(';');
  }

  function idx(r, c) { return r * N + c; }

  function inside(r, c) {
    return r >= 0 && r < N && c >= 0 && c < N;
  }

  function flipsAt(board, i, mark) {
    const opp = mark === 'B' ? 'W' : 'B';
    const r0 = (i / N) | 0;
    const c0 = i % N;
    if (board[i] !== '.') return [];
    const flipped = [];
    DIRS.forEach(([dr, dc]) => {
      const run = [];
      let r = r0 + dr;
      let c = c0 + dc;
      while (inside(r, c) && board[idx(r, c)] === opp) {
        run.push(idx(r, c));
        r += dr;
        c += dc;
      }
      if (run.length && inside(r, c) && board[idx(r, c)] === mark) {
        flipped.push(...run);
      }
    });
    return flipped;
  }

  function legalMoves(board, mark) {
    const moves = [];
    for (let i = 0; i < 64; i += 1) {
      const flips = flipsAt(board, i, mark);
      if (flips.length) moves.push({ i, flips });
    }
    return moves;
  }

  function applyMove(board, move, mark) {
    const next = board.slice();
    next[move.i] = mark;
    move.flips.forEach((i) => { next[i] = mark; });
    return next;
  }

  function counts(board) {
    let b = 0;
    let w = 0;
    board.forEach((c) => {
      if (c === 'B') b += 1;
      if (c === 'W') w += 1;
    });
    return { b, w };
  }

  function evaluate(board, mark) {
    const opp = mark === 'B' ? 'W' : 'B';
    let score = 0;
    for (let i = 0; i < 64; i += 1) {
      if (board[i] === mark) score += WEIGHTS[i];
      else if (board[i] === opp) score -= WEIGHTS[i];
    }
    score += (legalMoves(board, mark).length - legalMoves(board, opp).length) * 8;
    return score;
  }

  function minimax(board, mark, ai, depth, alpha, beta, maximizing) {
    const mine = legalMoves(board, mark);
    const oppMark = mark === 'B' ? 'W' : 'B';
    const theirs = legalMoves(board, oppMark);
    if (depth <= 0 || (!mine.length && !theirs.length)) return evaluate(board, ai);
    const moves = maximizing ? mine : theirs;
    const side = maximizing ? mark : oppMark;
    if (!moves.length) {
      return minimax(board, oppMark, ai, depth - 1, alpha, beta, !maximizing);
    }
    if (maximizing) {
      let best = -Infinity;
      for (const mv of moves) {
        const val = minimax(applyMove(board, mv, side), oppMark, ai, depth - 1, alpha, beta, false);
        best = Math.max(best, val);
        alpha = Math.max(alpha, val);
        if (beta <= alpha) break;
      }
      return best;
    }
    let best = Infinity;
    for (const mv of moves) {
      const val = minimax(applyMove(board, mv, side), mark, ai, depth - 1, alpha, beta, true);
      best = Math.min(best, val);
      beta = Math.min(beta, val);
      if (beta <= alpha) break;
    }
    return best;
  }

  function bestCpuMove(board, difficulty) {
    const moves = legalMoves(board, 'W');
    if (!moves.length) return null;
    const rng = Math.random();
    if (difficulty === 'easy' && rng < 0.6) return moves[Math.floor(Math.random() * moves.length)];
    if (difficulty === 'easy') {
      moves.sort((a, b) => b.flips.length - a.flips.length);
      return moves[0];
    }
    const depth = difficulty === 'hard' ? 4 : 3;
    let best = -Infinity;
    let choices = [moves[0]];
    moves.forEach((mv) => {
      const next = applyMove(board, mv, 'W');
      const val = minimax(next, 'B', 'W', depth - 1, -Infinity, Infinity, false) + WEIGHTS[mv.i];
      if (val > best) {
        best = val;
        choices = [mv];
      } else if (val === best) choices.push(mv);
    });
    if (difficulty === 'medium' && rng < 0.18) return moves[Math.floor(Math.random() * moves.length)];
    return choices[Math.floor(Math.random() * choices.length)];
  }

  function winnerOf(board) {
    const bMoves = legalMoves(board, 'B');
    const wMoves = legalMoves(board, 'W');
    if (bMoves.length || wMoves.length) return null;
    const { b, w } = counts(board);
    if (b > w) return { mark: 'B', b, w };
    if (w > b) return { mark: 'W', b, w };
    return { mark: 'draw', b, w };
  }

  function renderCells(board, hints) {
    const hintSet = new Set(hints || []);
    let html = '';
    for (let i = 0; i < 64; i += 1) {
      const mark = board[i];
      const cls = [
        'reversi-cell',
        mark === 'B' ? 'reversi-cell--b' : '',
        mark === 'W' ? 'reversi-cell--w' : '',
        mark === '.' ? 'reversi-cell--empty' : '',
        hintSet.has(i) ? 'reversi-cell--hint' : '',
      ].filter(Boolean).join(' ');
      html += `<button type="button" class="${cls}" data-idx="${i}" aria-label="square ${i}"></button>`;
    }
    return html;
  }

  function renderBlock(source, fenceAttrs, options = {}) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const style = resolveStyle(cfg);
    const title = String(cfg.title || 'Reversi').trim() || 'Reversi';
    const mode = resolveMode(cfg);
    const difficulty = resolveDifficulty(cfg);
    const board = parseBoard(cfg.board);
    const score = parseScore(cfg.score);
    const gameIndex = Number.isFinite(options.reversiIndex) ? options.reversiIndex : 0;
    const fullscreen = resolveFullscreen(cfg);
    const themeClass = style.theme ? ` reversi-block--${style.theme}` : '';
    const customClass = (style.colorCss || style.bgCss) ? ' reversi-block--custom' : '';
    const fullClass = fullscreen ? ' reversi-block--fullscreen' : '';
    const styleVars = [];
    if (style.colorCss) styleVars.push(`--reversi-accent:${style.colorCss}`);
    if (style.bgCss) styleVars.push(`--reversi-bg:${style.bgCss}`);
    const styleAttr = styleVars.length ? ` style="${styleVars.map((v) => escapeHtml(v)).join(';')}"` : '';
    const meta = mode === 'cpu' ? `vs CPU · ${difficulty}` : '2 players';
    const chrome = fullscreen ? '' : [
      `<div class="reversi-block-header">`,
      `<div class="reversi-block-title">${escapeHtml(title)}</div>`,
      `<div class="reversi-block-meta">${escapeHtml(meta)}</div>`,
      `</div>`,
    ].join('');
    const hints = legalMoves(board, 'B').map((m) => m.i);
    return [
      `<div class="reversi-block${themeClass}${customClass}${fullClass}"${styleAttr}`,
      ` data-reversi-index="${gameIndex}"`,
      ` data-reversi-mode="${mode}"`,
      ` data-reversi-difficulty="${difficulty}"`,
      ` data-reversi-turn="${escapeHtml(String(cfg.turn || 'B'))}"`,
      ` data-reversi-board="${escapeHtml(serializeBoard(board))}"`,
      ` data-reversi-score="${escapeHtml(serializeScore(score))}" tabindex="0">`,
      window.NotesProGameFullscreen?.renderButton?.() || '',
      chrome,
      `<div class="reversi-play-area">`,
      `<div class="reversi-toolbar" role="toolbar" aria-label="Reversi options">`,
      `<button type="button" class="reversi-chip${mode === 'cpu' ? ' is-active' : ''}" data-mode="cpu">CPU</button>`,
      `<button type="button" class="reversi-chip${mode === 'hotseat' ? ' is-active' : ''}" data-mode="hotseat">2 players</button>`,
      `<span class="reversi-toolbar-gap" aria-hidden="true"></span>`,
      `<button type="button" class="reversi-chip reversi-chip--diff${difficulty === 'easy' ? ' is-active' : ''}" data-diff="easy">Easy</button>`,
      `<button type="button" class="reversi-chip reversi-chip--diff${difficulty === 'medium' ? ' is-active' : ''}" data-diff="medium">Med</button>`,
      `<button type="button" class="reversi-chip reversi-chip--diff${difficulty === 'hard' ? ' is-active' : ''}" data-diff="hard">Hard</button>`,
      `</div>`,
      `<div class="reversi-score" aria-live="polite">`,
      `<span data-score="b">Black 0</span><span data-discs></span><span data-score="w">White 0</span>`,
      `</div>`,
      `<div class="reversi-grid" role="grid" aria-label="${escapeHtml(title)}">${renderCells(board, hints)}</div>`,
      `<div class="reversi-actions">`,
      `<button type="button" class="btn btn-sm btn-outline-light" data-action="new">New game</button>`,
      `</div>`,
      `</div>`,
      `<div class="reversi-status" aria-live="polite"></div>`,
      `</div>`,
    ].join('');
  }

  function setStatus(el, text, kind) {
    const status = el.querySelector('.reversi-status');
    if (!status) return;
    status.textContent = text || '';
    status.className = 'reversi-status' + (kind ? ` reversi-status--${kind}` : '');
  }

  function reportWin(difficulty, discs) {
    const mult = difficulty === 'hard' ? 3 : difficulty === 'easy' ? 1 : 2;
    const score = Math.max(100, 8000 * mult + discs * 40);
    window.NotesProHighscores?.submit?.('reversi', score, { won: true, level: mult, gems: discs });
  }

  function hydrateBlock(el, options = {}) {
    if (!el || el.dataset.reversiHydrated === '1') return;
    el.dataset.reversiHydrated = '1';
    window.NotesProGameFullscreen?.bind?.(el);

    let mode = el.dataset.reversiMode === 'hotseat' ? 'hotseat' : 'cpu';
    let difficulty = resolveDifficulty({ difficulty: el.dataset.reversiDifficulty });
    let board = parseBoard(el.dataset.reversiBoard);
    let turn = el.dataset.reversiTurn === 'W' ? 'W' : 'B';
    let score = parseScore(el.dataset.reversiScore);
    let scored = !!winnerOf(board);
    let busy = false;
    let persistTimer = null;

    function schedulePersist() {
      if (typeof options.onPersist !== 'function') return;
      clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        options.onPersist({
          board: serializeBoard(board),
          mode,
          difficulty,
          score: serializeScore(score),
          turn,
        });
      }, 280);
    }

    function paint() {
      const win = winnerOf(board);
      const hints = win ? [] : legalMoves(board, turn).map((m) => m.i);
      const hintSet = new Set(hints);
      el.querySelectorAll('.reversi-cell').forEach((cell) => {
        const i = parseInt(cell.dataset.idx, 10);
        const mark = board[i];
        cell.classList.toggle('reversi-cell--b', mark === 'B');
        cell.classList.toggle('reversi-cell--w', mark === 'W');
        cell.classList.toggle('reversi-cell--empty', mark === '.');
        cell.classList.toggle('reversi-cell--hint', hintSet.has(i));
      });
      el.querySelectorAll('[data-mode]').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.mode === mode);
      });
      el.querySelectorAll('[data-diff]').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.diff === difficulty);
        btn.hidden = mode !== 'cpu';
      });
      const { b, w } = counts(board);
      const bEl = el.querySelector('[data-score="b"]');
      const wEl = el.querySelector('[data-score="w"]');
      const dEl = el.querySelector('[data-discs]');
      if (bEl) bEl.textContent = mode === 'cpu' ? `You ${score.b}` : `Black ${score.b}`;
      if (wEl) wEl.textContent = mode === 'cpu' ? `CPU ${score.w}` : `White ${score.w}`;
      if (dEl) dEl.textContent = `${b}–${w}`;
      const meta = el.querySelector('.reversi-block-meta');
      if (meta) meta.textContent = mode === 'cpu' ? `vs CPU · ${difficulty}` : '2 players';
      el.classList.toggle('reversi-block--busy', busy);
      if (win?.mark === 'draw') setStatus(el, `Draw ${b}–${w}.`, 'info');
      else if (win?.mark === 'B') setStatus(el, mode === 'cpu' ? `You win ${b}–${w}!` : `Black wins ${b}–${w}.`, 'success');
      else if (win?.mark === 'W') setStatus(el, mode === 'cpu' ? `CPU wins ${w}–${b}.` : `White wins ${w}–${b}.`, 'warn');
      else if (busy) setStatus(el, 'CPU thinking…', '');
      else if (!legalMoves(board, turn).length) setStatus(el, `${turn === 'B' ? 'Black' : 'White'} passes.`, 'info');
      else if (mode === 'cpu') setStatus(el, turn === 'B' ? 'Your turn (black).' : 'CPU thinking…', '');
      else setStatus(el, `${turn === 'B' ? 'Black' : 'White'} to play.`, '');
    }

    function tally(win) {
      if (!win || scored) return;
      scored = true;
      if (win.mark === 'B') {
        score.b += 1;
        if (mode === 'cpu') reportWin(difficulty, win.b - win.w);
      } else if (win.mark === 'W') score.w += 1;
      else score.draw += 1;
    }

    function afterMove() {
      const win = winnerOf(board);
      if (win) {
        tally(win);
        paint();
        schedulePersist();
        return;
      }
      const other = turn === 'B' ? 'W' : 'B';
      if (legalMoves(board, other).length) turn = other;
      else if (!legalMoves(board, turn).length) {
        tally(winnerOf(board) || { mark: 'draw', ...counts(board) });
      }
      paint();
      schedulePersist();
      if (mode === 'cpu' && turn === 'W' && !winnerOf(board)) playCpu();
    }

    function playCpu() {
      if (mode !== 'cpu' || turn !== 'W' || winnerOf(board)) return;
      const moves = legalMoves(board, 'W');
      if (!moves.length) {
        afterMove();
        return;
      }
      busy = true;
      paint();
      window.setTimeout(() => {
        const mv = bestCpuMove(board, difficulty);
        if (mv) board = applyMove(board, mv, 'W');
        busy = false;
        afterMove();
      }, 420);
    }

    function play(i) {
      if (busy || winnerOf(board)) return;
      if (mode === 'cpu' && turn !== 'B') return;
      const mv = legalMoves(board, turn).find((m) => m.i === i);
      if (!mv) return;
      board = applyMove(board, mv, turn);
      afterMove();
    }

    function newGame() {
      board = parseBoard(START);
      turn = 'B';
      scored = false;
      busy = false;
      paint();
      schedulePersist();
    }

    el.addEventListener('click', (e) => {
      const modeBtn = e.target.closest('[data-mode]');
      const diffBtn = e.target.closest('[data-diff]');
      const action = e.target.closest('[data-action]')?.dataset.action;
      const cell = e.target.closest('[data-idx]');
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
      if (cell) play(parseInt(cell.dataset.idx, 10));
      el.focus({ preventScroll: true });
    });

    paint();
    if (mode === 'cpu' && turn === 'W') playCpu();
  }

  function hydrate(root) {
    (root || document).querySelectorAll('.reversi-block[data-reversi-index]').forEach((el) => hydrateBlock(el));
  }

  return {
    parseFenceAttrs,
    buildFenceAttrsString,
    serializeBoard,
    renderBlock,
    hydrateBlock,
    hydrate,
  };
}));
