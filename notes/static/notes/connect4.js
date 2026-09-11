/**
 * NotesPro ```connect4``` block — drop discs, connect four.
 */
(function (root, factory) {
  const api = factory();
  root.NotesProConnect4 = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];
  const ROWS = 6;
  const COLS = 7;
  const EMPTY = 42;
  const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

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
    const chars = String(raw || '').toUpperCase().replace(/[^XO.]/g, '').padEnd(EMPTY, '.').slice(0, EMPTY);
    return chars.split('').map((ch) => (ch === 'X' || ch === 'O' ? ch : ''));
  }

  function serializeBoard(board) {
    return (board || []).map((c) => c || '.').join('').padEnd(EMPTY, '.').slice(0, EMPTY);
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
      if (value == null || value === '') return;
      parts.push(`${key}=${value}`);
    });
    if (boardStr && boardStr !== '.'.repeat(EMPTY)) parts.push(`board=${boardStr}`);
    return parts.join(';');
  }

  function idx(r, c) { return r * COLS + c; }

  function at(board, r, c) {
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
    return board[idx(r, c)] || '';
  }

  function dropRow(board, col) {
    for (let r = ROWS - 1; r >= 0; r -= 1) {
      if (!board[idx(r, col)]) return r;
    }
    return -1;
  }

  function legalCols(board) {
    const cols = [];
    for (let c = 0; c < COLS; c += 1) if (dropRow(board, c) >= 0) cols.push(c);
    return cols;
  }

  function nextTurn(board) {
    let x = 0;
    let o = 0;
    board.forEach((c) => {
      if (c === 'X') x += 1;
      if (c === 'O') o += 1;
    });
    return x <= o ? 'X' : 'O';
  }

  function lineFrom(board, r, c, dr, dc) {
    const mark = at(board, r, c);
    if (!mark) return null;
    const cells = [idx(r, c)];
    for (let i = 1; i < 4; i += 1) {
      const rr = r + dr * i;
      const cc = c + dc * i;
      if (at(board, rr, cc) !== mark) return null;
      cells.push(idx(rr, cc));
    }
    return { mark, line: cells };
  }

  function winnerOf(board) {
    for (let r = 0; r < ROWS; r += 1) {
      for (let c = 0; c < COLS; c += 1) {
        for (const [dr, dc] of DIRS) {
          const win = lineFrom(board, r, c, dr, dc);
          if (win) return win;
        }
      }
    }
    if (board.every(Boolean)) return { mark: 'draw', line: [] };
    return null;
  }

  function applyDrop(board, col, mark) {
    const r = dropRow(board, col);
    if (r < 0) return -1;
    board[idx(r, col)] = mark;
    return idx(r, col);
  }

  function windowScore(board, mark) {
    const opp = mark === 'X' ? 'O' : 'X';
    let score = 0;
    const center = 3;
    for (let r = 0; r < ROWS; r += 1) {
      if (board[idx(r, center)] === mark) score += 3;
    }
    function evalFour(cells) {
      let mine = 0;
      let theirs = 0;
      let empty = 0;
      cells.forEach((i) => {
        if (board[i] === mark) mine += 1;
        else if (board[i] === opp) theirs += 1;
        else empty += 1;
      });
      if (mine === 4) score += 10000;
      else if (mine === 3 && empty === 1) score += 40;
      else if (mine === 2 && empty === 2) score += 8;
      if (theirs === 3 && empty === 1) score -= 80;
    }
    for (let r = 0; r < ROWS; r += 1) {
      for (let c = 0; c < COLS - 3; c += 1) {
        evalFour([idx(r, c), idx(r, c + 1), idx(r, c + 2), idx(r, c + 3)]);
      }
    }
    for (let c = 0; c < COLS; c += 1) {
      for (let r = 0; r < ROWS - 3; r += 1) {
        evalFour([idx(r, c), idx(r + 1, c), idx(r + 2, c), idx(r + 3, c)]);
      }
    }
    for (let r = 0; r < ROWS - 3; r += 1) {
      for (let c = 0; c < COLS - 3; c += 1) {
        evalFour([idx(r, c), idx(r + 1, c + 1), idx(r + 2, c + 2), idx(r + 3, c + 3)]);
      }
    }
    for (let r = 3; r < ROWS; r += 1) {
      for (let c = 0; c < COLS - 3; c += 1) {
        evalFour([idx(r, c), idx(r - 1, c + 1), idx(r - 2, c + 2), idx(r - 3, c + 3)]);
      }
    }
    return score;
  }

  function minimax(board, mark, ai, depth, alpha, beta, maximizing) {
    const win = winnerOf(board);
    if (win?.mark === ai) return 100000 + depth;
    if (win?.mark && win.mark !== 'draw' && win.mark !== ai) return -100000 - depth;
    if (win?.mark === 'draw' || depth <= 0) return windowScore(board, ai);
    const cols = legalCols(board);
    const order = [3, 2, 4, 1, 5, 0, 6].filter((c) => cols.includes(c));
    if (maximizing) {
      let best = -Infinity;
      for (const col of order) {
        const copy = board.slice();
        applyDrop(copy, col, mark);
        const val = minimax(copy, mark === 'X' ? 'O' : 'X', ai, depth - 1, alpha, beta, false);
        best = Math.max(best, val);
        alpha = Math.max(alpha, val);
        if (beta <= alpha) break;
      }
      return best;
    }
    let best = Infinity;
    for (const col of order) {
      const copy = board.slice();
      applyDrop(copy, col, mark);
      const val = minimax(copy, mark === 'X' ? 'O' : 'X', ai, depth - 1, alpha, beta, true);
      best = Math.min(best, val);
      beta = Math.min(beta, val);
      if (beta <= alpha) break;
    }
    return best;
  }

  function bestCpuMove(board, difficulty) {
    const cols = legalCols(board);
    if (!cols.length) return -1;
    const rng = Math.random();
    if (difficulty === 'easy' && rng < 0.55) return cols[Math.floor(Math.random() * cols.length)];
    const depth = difficulty === 'hard' ? 5 : difficulty === 'easy' ? 2 : 4;
    let best = -Infinity;
    let choices = [cols[0]];
    cols.forEach((col) => {
      const copy = board.slice();
      applyDrop(copy, col, 'O');
      if (winnerOf(copy)?.mark === 'O') {
        best = Infinity;
        choices = [col];
        return;
      }
      const val = minimax(copy, 'X', 'O', depth - 1, -Infinity, Infinity, false);
      if (val > best) {
        best = val;
        choices = [col];
      } else if (val === best) choices.push(col);
    });
    if (difficulty === 'medium' && rng < 0.22) return cols[Math.floor(Math.random() * cols.length)];
    return choices[Math.floor(Math.random() * choices.length)];
  }

  function renderCells(board, winLine) {
    const line = winLine || [];
    let html = '';
    for (let r = 0; r < ROWS; r += 1) {
      for (let c = 0; c < COLS; c += 1) {
        const i = idx(r, c);
        const mark = board[i] || '';
        const cls = [
          'connect4-cell',
          mark === 'X' ? 'connect4-cell--x' : '',
          mark === 'O' ? 'connect4-cell--o' : '',
          !mark ? 'connect4-cell--empty' : '',
          line.includes(i) ? 'connect4-cell--win' : '',
        ].filter(Boolean).join(' ');
        html += `<button type="button" class="${cls}" data-col="${c}" data-idx="${i}" aria-label="column ${c + 1}"></button>`;
      }
    }
    return html;
  }

  function renderBlock(source, fenceAttrs, options = {}) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const style = resolveStyle(cfg);
    const title = String(cfg.title || 'Connect Four').trim() || 'Connect Four';
    const mode = resolveMode(cfg);
    const difficulty = resolveDifficulty(cfg);
    const board = parseBoard(cfg.board);
    const score = parseScore(cfg.score);
    const win = winnerOf(board);
    const gameIndex = Number.isFinite(options.connect4Index) ? options.connect4Index : 0;
    const fullscreen = resolveFullscreen(cfg);
    const themeClass = style.theme ? ` connect4-block--${style.theme}` : '';
    const customClass = (style.colorCss || style.bgCss) ? ' connect4-block--custom' : '';
    const fullClass = fullscreen ? ' connect4-block--fullscreen' : '';
    const styleVars = [];
    if (style.colorCss) styleVars.push(`--connect4-accent:${style.colorCss}`);
    if (style.bgCss) styleVars.push(`--connect4-bg:${style.bgCss}`);
    const styleAttr = styleVars.length ? ` style="${styleVars.map((v) => escapeHtml(v)).join(';')}"` : '';
    const meta = mode === 'cpu' ? `vs CPU · ${difficulty}` : '2 players';
    const chrome = fullscreen ? '' : [
      `<div class="connect4-block-header">`,
      `<div class="connect4-block-title">${escapeHtml(title)}</div>`,
      `<div class="connect4-block-meta">${escapeHtml(meta)}</div>`,
      `</div>`,
    ].join('');
    return [
      `<div class="connect4-block${themeClass}${customClass}${fullClass}"${styleAttr}`,
      ` data-connect4-index="${gameIndex}"`,
      ` data-connect4-mode="${mode}"`,
      ` data-connect4-difficulty="${difficulty}"`,
      ` data-connect4-board="${escapeHtml(serializeBoard(board))}"`,
      ` data-connect4-score="${escapeHtml(serializeScore(score))}" tabindex="0">`,
      window.NotesProGameFullscreen?.renderButton?.() || '',
      chrome,
      `<div class="connect4-play-area">`,
      `<div class="connect4-toolbar" role="toolbar" aria-label="Connect Four options">`,
      `<button type="button" class="connect4-chip${mode === 'cpu' ? ' is-active' : ''}" data-mode="cpu">CPU</button>`,
      `<button type="button" class="connect4-chip${mode === 'hotseat' ? ' is-active' : ''}" data-mode="hotseat">2 players</button>`,
      `<span class="connect4-toolbar-gap" aria-hidden="true"></span>`,
      `<button type="button" class="connect4-chip connect4-chip--diff${difficulty === 'easy' ? ' is-active' : ''}" data-diff="easy">Easy</button>`,
      `<button type="button" class="connect4-chip connect4-chip--diff${difficulty === 'medium' ? ' is-active' : ''}" data-diff="medium">Med</button>`,
      `<button type="button" class="connect4-chip connect4-chip--diff${difficulty === 'hard' ? ' is-active' : ''}" data-diff="hard">Hard</button>`,
      `</div>`,
      `<div class="connect4-score" aria-live="polite">`,
      `<span data-score="x">You 0</span><span data-score="draw">Draw 0</span><span data-score="o">CPU 0</span>`,
      `</div>`,
      `<div class="connect4-grid" role="grid" aria-label="${escapeHtml(title)}">${renderCells(board, win?.line || [])}</div>`,
      `<div class="connect4-actions">`,
      `<button type="button" class="btn btn-sm btn-outline-light" data-action="new">New game</button>`,
      `</div>`,
      `</div>`,
      `<div class="connect4-status" aria-live="polite"></div>`,
      `</div>`,
    ].join('');
  }

  function setStatus(el, text, kind) {
    const status = el.querySelector('.connect4-status');
    if (!status) return;
    status.textContent = text || '';
    status.className = 'connect4-status' + (kind ? ` connect4-status--${kind}` : '');
  }

  function reportWin(difficulty, moves) {
    const mult = difficulty === 'hard' ? 3 : difficulty === 'easy' ? 1 : 2;
    const score = Math.max(100, 12000 * mult - moves * 40);
    window.NotesProHighscores?.submit?.('connect4', score, { won: true, level: mult, moves });
  }

  function hydrateBlock(el, options = {}) {
    if (!el || el.dataset.connect4Hydrated === '1') return;
    el.dataset.connect4Hydrated = '1';
    window.NotesProGameFullscreen?.bind?.(el);

    let mode = el.dataset.connect4Mode === 'hotseat' ? 'hotseat' : 'cpu';
    let difficulty = resolveDifficulty({ difficulty: el.dataset.connect4Difficulty });
    let board = parseBoard(el.dataset.connect4Board);
    let score = parseScore(el.dataset.connect4Score);
    let scored = !!winnerOf(board);
    let busy = false;
    let persistTimer = null;
    let moves = board.filter(Boolean).length;

    function schedulePersist() {
      if (typeof options.onPersist !== 'function') return;
      clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        options.onPersist({
          board: serializeBoard(board),
          mode,
          difficulty,
          score: serializeScore(score),
        });
      }, 280);
    }

    function paint() {
      const win = winnerOf(board);
      const line = win?.line || [];
      el.querySelectorAll('.connect4-cell').forEach((cell) => {
        const i = parseInt(cell.dataset.idx, 10);
        const mark = board[i] || '';
        cell.classList.toggle('connect4-cell--x', mark === 'X');
        cell.classList.toggle('connect4-cell--o', mark === 'O');
        cell.classList.toggle('connect4-cell--empty', !mark);
        cell.classList.toggle('connect4-cell--win', line.includes(i));
      });
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
      if (xEl) xEl.textContent = mode === 'cpu' ? `You ${score.x}` : `Red ${score.x}`;
      if (oEl) oEl.textContent = mode === 'cpu' ? `CPU ${score.o}` : `Yellow ${score.o}`;
      if (dEl) dEl.textContent = `Draw ${score.draw}`;
      const meta = el.querySelector('.connect4-block-meta');
      if (meta) meta.textContent = mode === 'cpu' ? `vs CPU · ${difficulty}` : '2 players';
      el.classList.toggle('connect4-block--busy', busy);
      const winNow = winnerOf(board);
      if (winNow?.mark === 'draw') setStatus(el, 'Draw.', 'info');
      else if (winNow?.mark === 'X') setStatus(el, mode === 'cpu' ? 'You win!' : 'Red wins.', 'success');
      else if (winNow?.mark === 'O') setStatus(el, mode === 'cpu' ? 'CPU wins.' : 'Yellow wins.', 'warn');
      else {
        const turn = nextTurn(board);
        if (mode === 'cpu') setStatus(el, turn === 'X' ? 'Your turn — drop a disc.' : 'CPU thinking…', '');
        else setStatus(el, `${turn === 'X' ? 'Red' : 'Yellow'} to drop.`, '');
      }
    }

    function tally(win) {
      if (!win || scored) return;
      scored = true;
      if (win.mark === 'X') {
        score.x += 1;
        if (mode === 'cpu') reportWin(difficulty, moves);
      } else if (win.mark === 'O') score.o += 1;
      else score.draw += 1;
    }

    function playCpu() {
      if (mode !== 'cpu' || winnerOf(board) || nextTurn(board) !== 'O') return;
      busy = true;
      paint();
      window.setTimeout(() => {
        const col = bestCpuMove(board, difficulty);
        if (col >= 0) {
          applyDrop(board, col, 'O');
          moves += 1;
        }
        busy = false;
        const win = winnerOf(board);
        if (win) tally(win);
        paint();
        schedulePersist();
      }, 380);
    }

    function drop(col) {
      if (busy || winnerOf(board)) return;
      const turn = nextTurn(board);
      if (mode === 'cpu' && turn !== 'X') return;
      if (applyDrop(board, col, turn) < 0) return;
      moves += 1;
      const win = winnerOf(board);
      if (win) tally(win);
      paint();
      schedulePersist();
      if (mode === 'cpu' && !winnerOf(board) && nextTurn(board) === 'O') playCpu();
    }

    function newGame() {
      board = parseBoard('');
      scored = false;
      busy = false;
      moves = 0;
      paint();
      schedulePersist();
    }

    el.addEventListener('click', (e) => {
      const modeBtn = e.target.closest('[data-mode]');
      const diffBtn = e.target.closest('[data-diff]');
      const action = e.target.closest('[data-action]')?.dataset.action;
      const cell = e.target.closest('[data-col]');
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
      if (cell) drop(parseInt(cell.dataset.col, 10));
      el.focus({ preventScroll: true });
    });

    paint();
    if (mode === 'cpu' && !winnerOf(board) && nextTurn(board) === 'O') playCpu();
  }

  function hydrate(root) {
    (root || document).querySelectorAll('.connect4-block[data-connect4-index]').forEach((el) => hydrateBlock(el));
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
