/**
 * NotesPro ```tictactoe``` block — 3×3 noughts and crosses in preview.
 */
(function (root, factory) {
  const api = factory();
  root.NotesProTictactoe = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];
  const LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
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

  function parseBoard(raw) {
    const chars = String(raw || '').toUpperCase().replace(/[^XO.]/g, '').padEnd(9, '.').slice(0, 9);
    return chars.split('').map(ch => (ch === 'X' || ch === 'O' ? ch : ''));
  }

  function serializeBoard(board) {
    return board.map(cell => cell || '.').join('');
  }

  function parseScore(raw) {
    const parts = String(raw || '').split(/[-:/,]/).map(n => parseInt(n, 10));
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
    if (boardStr && boardStr !== '.........') parts.push(`board=${boardStr}`);
    return parts.join(';');
  }

  function winnerOf(board) {
    for (const [a, b, c] of LINES) {
      if (board[a] && board[a] === board[b] && board[a] === board[c]) {
        return { mark: board[a], line: [a, b, c] };
      }
    }
    if (board.every(Boolean)) return { mark: 'draw', line: [] };
    return null;
  }

  function empties(board) {
    return board.map((v, i) => (v ? -1 : i)).filter(i => i >= 0);
  }

  function minimax(board, ai, human, isMax, depth) {
    const win = winnerOf(board);
    if (win?.mark === ai) return 10 - depth;
    if (win?.mark === human) return depth - 10;
    if (win?.mark === 'draw' || !empties(board).length) return 0;
    let best = isMax ? -Infinity : Infinity;
    empties(board).forEach((i) => {
      board[i] = isMax ? ai : human;
      const score = minimax(board, ai, human, !isMax, depth + 1);
      board[i] = '';
      best = isMax ? Math.max(best, score) : Math.min(best, score);
    });
    return best;
  }

  function bestCpuMove(board, ai, human, difficulty) {
    const open = empties(board);
    if (!open.length) return -1;
    const rng = Math.random();
    if (difficulty === 'easy' && rng < 0.65) return open[Math.floor(Math.random() * open.length)];
    if (difficulty === 'medium' && rng < 0.35) return open[Math.floor(Math.random() * open.length)];
    let bestScore = -Infinity;
    let choices = [open[0]];
    open.forEach((i) => {
      board[i] = ai;
      const score = minimax(board, ai, human, false, 0);
      board[i] = '';
      if (score > bestScore) {
        bestScore = score;
        choices = [i];
      } else if (score === bestScore) {
        choices.push(i);
      }
    });
    return choices[Math.floor(Math.random() * choices.length)];
  }

  function nextTurn(board) {
    const x = board.filter(c => c === 'X').length;
    const o = board.filter(c => c === 'O').length;
    return x <= o ? 'X' : 'O';
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

  function renderCells(board, winLine, lastIdx) {
    return board.map((mark, i) => {
      const win = winLine.includes(i);
      const last = lastIdx === i;
      const label = `Row ${Math.floor(i / 3) + 1}, column ${(i % 3) + 1}`;
      return `<button type="button" class="tictactoe-cell${mark ? ` tictactoe-cell--${mark.toLowerCase()}` : ' tictactoe-cell--empty'}${win ? ' tictactoe-cell--win' : ''}${last ? ' tictactoe-cell--last' : ''}"`
        + ` data-idx="${i}" aria-label="${escapeHtml(label)}">`
        + (mark ? escapeHtml(mark) : '')
        + `</button>`;
    }).join('');
  }

  function renderBlock(source, fenceAttrs, options = {}) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const style = resolveStyle(cfg);
    const title = String(cfg.title || 'Tic Tac Toe').trim() || 'Tic Tac Toe';
    const mode = resolveMode(cfg);
    const difficulty = resolveDifficulty(cfg);
    const board = parseBoard(cfg.board || source);
    const win = winnerOf(board);
    const tttIndex = Number.isFinite(options.tictactoeIndex) ? options.tictactoeIndex : 0;
    const fullscreen = resolveFullscreen(cfg);
    const themeClass = style.theme ? ` tictactoe-block--${style.theme}` : '';
    const customClass = (style.colorCss || style.bgCss) ? ' tictactoe-block--custom' : '';
    const fullClass = fullscreen ? ' tictactoe-block--fullscreen' : '';
    const styleVars = [];
    if (style.colorCss) styleVars.push(`--tictactoe-accent:${style.colorCss}`);
    if (style.bgCss) styleVars.push(`--tictactoe-bg:${style.bgCss}`);
    const styleAttr = styleVars.length
      ? ` style="${styleVars.map(v => escapeHtml(v)).join(';')}"`
      : '';
    const score = parseScore(cfg.score);
    const meta = mode === 'cpu' ? `vs CPU · ${difficulty}` : '2 players';
    const chrome = fullscreen ? '' : [
      `<div class="tictactoe-block-header">`,
      `<div class="tictactoe-block-title">${escapeHtml(title)}</div>`,
      `<div class="tictactoe-block-meta">${escapeHtml(meta)}</div>`,
      `</div>`,
    ].join('');
    return [
      `<div class="tictactoe-block${themeClass}${customClass}${fullClass}"${styleAttr}`
      + ` data-tictactoe-index="${tttIndex}"`
      + ` data-tictactoe-mode="${mode}"`
      + ` data-tictactoe-difficulty="${difficulty}"`
      + ` data-tictactoe-board="${escapeHtml(serializeBoard(board))}"`
      + ` data-tictactoe-score="${escapeHtml(serializeScore(score))}"`
      + ` tabindex="0">`,
      renderFullscreenButton(),
      chrome,
      `<div class="tictactoe-play-area">`,
      `<div class="tictactoe-toolbar" role="toolbar" aria-label="Tic Tac Toe options">`,
      `<button type="button" class="tictactoe-chip${mode === 'cpu' ? ' is-active' : ''}" data-mode="cpu">CPU</button>`,
      `<button type="button" class="tictactoe-chip${mode === 'hotseat' ? ' is-active' : ''}" data-mode="hotseat">2 players</button>`,
      `<span class="tictactoe-toolbar-gap" aria-hidden="true"></span>`,
      `<button type="button" class="tictactoe-chip tictactoe-chip--diff${difficulty === 'easy' ? ' is-active' : ''}" data-diff="easy">Easy</button>`,
      `<button type="button" class="tictactoe-chip tictactoe-chip--diff${difficulty === 'medium' ? ' is-active' : ''}" data-diff="medium">Med</button>`,
      `<button type="button" class="tictactoe-chip tictactoe-chip--diff${difficulty === 'hard' ? ' is-active' : ''}" data-diff="hard">Hard</button>`,
      `</div>`,
      `<div class="tictactoe-score" aria-live="polite">`
        + `<span data-score="x">X ${score.x}</span>`
        + `<span data-score="draw">Draw ${score.draw}</span>`
        + `<span data-score="o">O ${score.o}</span>`
      + `</div>`,
      `<div class="tictactoe-grid" role="grid" aria-label="${escapeHtml(title)}">${renderCells(board, win?.line || [], -1)}</div>`,
      `<div class="tictactoe-actions">`,
      `<button type="button" class="btn btn-sm btn-outline-light tictactoe-action" data-action="new">New game</button>`,
      `</div>`,
      `</div>`,
      `<div class="tictactoe-status" aria-live="polite"></div>`,
      `</div>`,
    ].join('');
  }

  function setStatus(el, text, kind) {
    const status = el.querySelector('.tictactoe-status');
    if (!status) return;
    status.textContent = text || '';
    status.className = 'tictactoe-status' + (kind ? ` tictactoe-status--${kind}` : '');
  }

  function paint(el, board, winLine, lastIdx) {
    el.querySelectorAll('.tictactoe-cell').forEach((cell) => {
      const idx = parseInt(cell.dataset.idx, 10);
      const mark = board[idx] || '';
      cell.textContent = mark;
      cell.classList.toggle('tictactoe-cell--x', mark === 'X');
      cell.classList.toggle('tictactoe-cell--o', mark === 'O');
      cell.classList.toggle('tictactoe-cell--empty', !mark);
      cell.classList.toggle('tictactoe-cell--win', !!(winLine && winLine.includes(idx)));
      cell.classList.toggle('tictactoe-cell--last', lastIdx === idx);
    });
  }

  function statusFor(board, mode) {
    const win = winnerOf(board);
    if (win?.mark === 'draw') return { text: 'Draw.', kind: 'info' };
    if (win?.mark === 'X') return { text: mode === 'cpu' ? 'You win!' : 'X wins.', kind: 'success' };
    if (win?.mark === 'O') return { text: mode === 'cpu' ? 'CPU wins.' : 'O wins.', kind: 'warn' };
    const turn = nextTurn(board);
    if (mode === 'cpu') return { text: turn === 'X' ? 'Your turn (X).' : 'CPU thinking…', kind: '' };
    return { text: `${turn} to play.`, kind: '' };
  }

  function hydrateBlock(el, options = {}) {
    if (!el || el.dataset.tictactoeHydrated === '1') return;
    el.dataset.tictactoeHydrated = '1';
    bindFullscreenButton(el);

    let mode = el.dataset.tictactoeMode === 'hotseat' ? 'hotseat' : 'cpu';
    let difficulty = resolveDifficulty({ difficulty: el.dataset.tictactoeDifficulty });
    let board = parseBoard(el.dataset.tictactoeBoard);
    let score = parseScore(el.dataset.tictactoeScore);
    let lastIdx = -1;
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
        });
      }, 280);
    }

    function syncChrome() {
      el.querySelectorAll('[data-mode]').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.mode === mode);
      });
      el.querySelectorAll('[data-diff]').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.diff === difficulty);
        btn.hidden = mode !== 'cpu';
      });
      const xEl = el.querySelector('[data-score="x"]');
      const oEl = el.querySelector('[data-score="o"]');
      const dEl = el.querySelector('[data-score="draw"]');
      if (xEl) xEl.textContent = mode === 'cpu' ? `You ${score.x}` : `X ${score.x}`;
      if (oEl) oEl.textContent = mode === 'cpu' ? `CPU ${score.o}` : `O ${score.o}`;
      if (dEl) dEl.textContent = `Draw ${score.draw}`;
      const meta = el.querySelector('.tictactoe-block-meta');
      if (meta) meta.textContent = mode === 'cpu' ? `vs CPU · ${difficulty}` : '2 players';
    }

    function refresh() {
      const win = winnerOf(board);
      paint(el, board, win?.line || [], lastIdx);
      el.classList.toggle('tictactoe-block--busy', busy);
      const st = statusFor(board, mode);
      setStatus(el, st.text, st.kind);
      syncChrome();
    }

    function tally(win) {
      if (!win || scored) return;
      scored = true;
      if (win.mark === 'X') score.x += 1;
      else if (win.mark === 'O') score.o += 1;
      else score.draw += 1;
    }

    function playCpu() {
      if (mode !== 'cpu' || winnerOf(board) || nextTurn(board) !== 'O') return;
      busy = true;
      refresh();
      window.setTimeout(() => {
        const i = bestCpuMove(board, 'O', 'X', difficulty);
        if (i >= 0 && !board[i]) {
          board[i] = 'O';
          lastIdx = i;
        }
        busy = false;
        const win = winnerOf(board);
        if (win) tally(win);
        refresh();
        schedulePersist();
      }, 420);
    }

    function move(index) {
      if (busy || board[index] || winnerOf(board)) return;
      const turn = nextTurn(board);
      if (mode === 'cpu' && turn !== 'X') return;
      board[index] = turn;
      lastIdx = index;
      const win = winnerOf(board);
      if (win) tally(win);
      refresh();
      schedulePersist();
      if (mode === 'cpu' && !winnerOf(board) && nextTurn(board) === 'O') playCpu();
    }

    function newGame() {
      board = parseBoard('');
      lastIdx = -1;
      scored = false;
      busy = false;
      refresh();
      schedulePersist();
    }

    function setMode(next) {
      if (next === mode) return;
      mode = next === 'hotseat' ? 'hotseat' : 'cpu';
      newGame();
    }

    function setDifficulty(next) {
      const resolved = resolveDifficulty({ difficulty: next });
      if (resolved === difficulty) return;
      difficulty = resolved;
      if (mode === 'cpu') newGame();
      else {
        refresh();
        schedulePersist();
      }
    }

    el.querySelector('.tictactoe-grid')?.addEventListener('click', (e) => {
      const cell = e.target.closest('.tictactoe-cell');
      if (!cell) return;
      el.focus({ preventScroll: true });
      move(parseInt(cell.dataset.idx, 10));
    });
    el.querySelector('[data-action="new"]')?.addEventListener('click', (e) => {
      e.preventDefault();
      newGame();
    });
    el.querySelectorAll('[data-mode]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        setMode(btn.dataset.mode);
      });
    });
    el.querySelectorAll('[data-diff]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        setDifficulty(btn.dataset.diff);
      });
    });
    el.addEventListener('keydown', (e) => {
      if (e.target.closest?.('button[data-mode], button[data-diff], [data-action="new"]')) return;
      if (e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        move(parseInt(e.key, 10) - 1);
      } else if (e.key === 'n' || e.key === 'N' || e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        newGame();
      }
    });

    refresh();
    if (mode === 'cpu' && !winnerOf(board) && nextTurn(board) === 'O') playCpu();
  }

  function hydrate(root) {
    (root || document).querySelectorAll('.tictactoe-block[data-tictactoe-board]').forEach(el => hydrateBlock(el));
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
