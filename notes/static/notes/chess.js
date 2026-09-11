/**
 * NotesPro ```chess``` block — play vs CPU or a second player.
 */
(function (root, factory) {
  const api = factory();
  root.NotesProChess = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];
  const START = 'rnbqkbnrpppppppp................................PPPPPPPPRNBQKBNR';
  const GLYPH = {
    K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
    k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
  };
  const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
  const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const W_PST = [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
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
    const chars = String(raw || START).replace(/[^prnbqkPRNBQK.]/g, '').padEnd(64, '.').slice(0, 64);
    if (!/[Kk]/.test(chars)) return START.split('');
    return chars.split('');
  }

  function serializeBoard(board) {
    return (board || []).join('').padEnd(64, '.').slice(0, 64);
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

  function isWhite(p) { return !!p && p !== '.' && p === p.toUpperCase(); }
  function isBlack(p) { return !!p && p !== '.' && p === p.toLowerCase(); }
  function colorOf(p) { return isWhite(p) ? 'w' : isBlack(p) ? 'b' : ''; }
  function enemy(turn) { return turn === 'w' ? 'b' : 'w'; }
  function rc(i) { return [(i / 8) | 0, i & 7]; }
  function sq(r, c) { return r * 8 + c; }
  function onBoard(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
  function kind(p) { return String(p || '').toLowerCase(); }

  function cloneState(state) {
    return {
      board: state.board.slice(),
      turn: state.turn,
      castle: state.castle,
      ep: state.ep,
    };
  }

  function findKing(board, turn) {
    const k = turn === 'w' ? 'K' : 'k';
    return board.indexOf(k);
  }

  function attacked(board, target, byWhite) {
    const [tr, tc] = rc(target);
    const pawnDir = byWhite ? 1 : -1;
    const pawn = byWhite ? 'P' : 'p';
    for (const dc of [-1, 1]) {
      const r = tr + pawnDir;
      const c = tc + dc;
      if (onBoard(r, c) && board[sq(r, c)] === pawn) return true;
    }
    for (const [dr, dc] of KNIGHT) {
      const r = tr + dr;
      const c = tc + dc;
      if (!onBoard(r, c)) continue;
      const p = board[sq(r, c)];
      if (p && kind(p) === 'n' && isWhite(p) === byWhite) return true;
    }
    for (const [dr, dc] of KING) {
      const r = tr + dr;
      const c = tc + dc;
      if (!onBoard(r, c)) continue;
      const p = board[sq(r, c)];
      if (p && kind(p) === 'k' && isWhite(p) === byWhite) return true;
    }
    const rays = [
      { dirs: [[-1, 0], [1, 0], [0, -1], [0, 1]], pieces: 'rq' },
      { dirs: [[-1, -1], [-1, 1], [1, -1], [1, 1]], pieces: 'bq' },
    ];
    for (const ray of rays) {
      for (const [dr, dc] of ray.dirs) {
        let r = tr + dr;
        let c = tc + dc;
        while (onBoard(r, c)) {
          const p = board[sq(r, c)];
          if (p && p !== '.') {
            if (isWhite(p) === byWhite && ray.pieces.includes(kind(p))) return true;
            break;
          }
          r += dr;
          c += dc;
        }
      }
    }
    return false;
  }

  function inCheck(board, turn) {
    const k = findKing(board, turn);
    if (k < 0) return true;
    return attacked(board, k, turn !== 'w');
  }

  function pushMove(list, from, to, extra) {
    list.push(Object.assign({ from, to, promo: '', castle: '', ep: false }, extra || {}));
  }

  function genPseudo(state) {
    const { board, turn, castle, ep } = state;
    const moves = [];
    const white = turn === 'w';
    for (let i = 0; i < 64; i += 1) {
      const p = board[i];
      if (!p || p === '.' || colorOf(p) !== turn) continue;
      const [r, c] = rc(i);
      const t = kind(p);
      if (t === 'p') {
        const dir = white ? -1 : 1;
        const start = white ? 6 : 1;
        const promoRank = white ? 0 : 7;
        const fwd = r + dir;
        if (onBoard(fwd, c) && board[sq(fwd, c)] === '.') {
          if (fwd === promoRank) pushMove(moves, i, sq(fwd, c), { promo: white ? 'Q' : 'q' });
          else {
            pushMove(moves, i, sq(fwd, c));
            const two = r + dir * 2;
            if (r === start && onBoard(two, c) && board[sq(two, c)] === '.') {
              pushMove(moves, i, sq(two, c));
            }
          }
        }
        for (const dc of [-1, 1]) {
          const cc = c + dc;
          if (!onBoard(fwd, cc)) continue;
          const dest = sq(fwd, cc);
          const hit = board[dest];
          if (hit && hit !== '.' && colorOf(hit) !== turn) {
            if (fwd === promoRank) pushMove(moves, i, dest, { promo: white ? 'Q' : 'q' });
            else pushMove(moves, i, dest);
          } else if (ep === dest) {
            pushMove(moves, i, dest, { ep: true });
          }
        }
      } else if (t === 'n') {
        KNIGHT.forEach(([dr, dc]) => {
          const rr = r + dr;
          const cc = c + dc;
          if (!onBoard(rr, cc)) return;
          const dest = sq(rr, cc);
          const hit = board[dest];
          if (!hit || hit === '.' || colorOf(hit) !== turn) pushMove(moves, i, dest);
        });
      } else if (t === 'k') {
        KING.forEach(([dr, dc]) => {
          const rr = r + dr;
          const cc = c + dc;
          if (!onBoard(rr, cc)) return;
          const dest = sq(rr, cc);
          const hit = board[dest];
          if (!hit || hit === '.' || colorOf(hit) !== turn) pushMove(moves, i, dest);
        });
        if (white) {
          if (castle.includes('K') && board[61] === '.' && board[62] === '.' && board[63] === 'R') {
            pushMove(moves, i, 62, { castle: 'K' });
          }
          if (castle.includes('Q') && board[59] === '.' && board[58] === '.' && board[57] === '.' && board[56] === 'R') {
            pushMove(moves, i, 58, { castle: 'Q' });
          }
        } else {
          if (castle.includes('k') && board[5] === '.' && board[6] === '.' && board[7] === 'r') {
            pushMove(moves, i, 6, { castle: 'k' });
          }
          if (castle.includes('q') && board[3] === '.' && board[2] === '.' && board[1] === '.' && board[0] === 'r') {
            pushMove(moves, i, 2, { castle: 'q' });
          }
        }
      } else {
        const slides = t === 'b'
          ? [[-1, -1], [-1, 1], [1, -1], [1, 1]]
          : t === 'r'
            ? [[-1, 0], [1, 0], [0, -1], [0, 1]]
            : [[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]];
        slides.forEach(([dr, dc]) => {
          let rr = r + dr;
          let cc = c + dc;
          while (onBoard(rr, cc)) {
            const dest = sq(rr, cc);
            const hit = board[dest];
            if (!hit || hit === '.') pushMove(moves, i, dest);
            else {
              if (colorOf(hit) !== turn) pushMove(moves, i, dest);
              break;
            }
            rr += dr;
            cc += dc;
          }
        });
      }
    }
    return moves;
  }

  function applyMove(state, move) {
    const next = cloneState(state);
    const p = next.board[move.from];
    next.board[move.from] = '.';
    if (move.ep) {
      const [tr, tc] = rc(move.to);
      const cap = sq(tr + (state.turn === 'w' ? 1 : -1), tc);
      next.board[cap] = '.';
    }
    next.board[move.to] = move.promo || p;
    if (move.castle === 'K') {
      next.board[63] = '.';
      next.board[61] = 'R';
    } else if (move.castle === 'Q') {
      next.board[56] = '.';
      next.board[59] = 'R';
    } else if (move.castle === 'k') {
      next.board[7] = '.';
      next.board[5] = 'r';
    } else if (move.castle === 'q') {
      next.board[0] = '.';
      next.board[3] = 'r';
    }
    let castle = next.castle;
    if (p === 'K' || move.from === 60 || move.to === 60) castle = castle.replace(/[KQ]/g, '');
    if (p === 'k' || move.from === 4 || move.to === 4) castle = castle.replace(/[kq]/g, '');
    if (move.from === 63 || move.to === 63) castle = castle.replace('K', '');
    if (move.from === 56 || move.to === 56) castle = castle.replace('Q', '');
    if (move.from === 7 || move.to === 7) castle = castle.replace('k', '');
    if (move.from === 0 || move.to === 0) castle = castle.replace('q', '');
    next.castle = castle;
    next.ep = -1;
    if (kind(p) === 'p' && Math.abs(move.to - move.from) === 16) {
      next.ep = (move.from + move.to) / 2;
    }
    next.turn = enemy(state.turn);
    return next;
  }

  function legalMoves(state) {
    const out = [];
    genPseudo(state).forEach((move) => {
      if (move.castle) {
        const path = move.castle === 'K' ? [60, 61, 62]
          : move.castle === 'Q' ? [60, 59, 58]
            : move.castle === 'k' ? [4, 5, 6]
              : [4, 3, 2];
        if (path.some((s) => attacked(state.board, s, state.turn !== 'w'))) return;
      }
      const next = applyMove(state, move);
      if (!inCheck(next.board, state.turn)) out.push(move);
    });
    return out;
  }

  function evaluate(state) {
    let score = 0;
    state.board.forEach((p, i) => {
      if (!p || p === '.') return;
      const v = VAL[kind(p)] || 0;
      const pst = kind(p) === 'p' ? W_PST[isWhite(p) ? i : 63 - i] : 0;
      const s = v + pst;
      score += isWhite(p) ? s : -s;
    });
    return state.turn === 'w' ? score : -score;
  }

  function minimax(state, depth, alpha, beta) {
    if (depth <= 0) return evaluate(state);
    const moves = legalMoves(state);
    if (!moves.length) {
      if (inCheck(state.board, state.turn)) return -200000 - depth;
      return 0;
    }
    let best = -Infinity;
    for (const mv of moves) {
      const val = -minimax(applyMove(state, mv), depth - 1, -beta, -alpha);
      if (val > best) best = val;
      if (val > alpha) alpha = val;
      if (alpha >= beta) break;
    }
    return best;
  }

  function bestCpuMove(state, difficulty) {
    const moves = legalMoves(state);
    if (!moves.length) return null;
    const rng = Math.random();
    if (difficulty === 'easy' && rng < 0.55) return moves[Math.floor(Math.random() * moves.length)];
    const depth = difficulty === 'hard' ? 3 : difficulty === 'easy' ? 1 : 2;
    let best = -Infinity;
    let choices = [moves[0]];
    moves.forEach((mv) => {
      const val = -minimax(applyMove(state, mv), depth - 1, -Infinity, Infinity);
      if (val > best) {
        best = val;
        choices = [mv];
      } else if (val === best) choices.push(mv);
    });
    if (difficulty === 'medium' && rng < 0.2) return moves[Math.floor(Math.random() * moves.length)];
    return choices[Math.floor(Math.random() * choices.length)];
  }

  function outcome(state) {
    const moves = legalMoves(state);
    if (moves.length) return null;
    if (inCheck(state.board, state.turn)) {
      return { mark: enemy(state.turn), mate: true };
    }
    return { mark: 'draw', mate: false };
  }

  function parseEp(raw) {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 && n < 64 ? n : -1;
  }

  function makeState(cfg) {
    return {
      board: parseBoard(cfg.board),
      turn: String(cfg.turn || 'w').toLowerCase() === 'b' ? 'b' : 'w',
      castle: String(cfg.castle || 'KQkq').replace(/[^KQkq]/g, '') || '',
      ep: parseEp(cfg.ep),
    };
  }

  function renderCells(board, selected, dests) {
    const destSet = new Set(dests || []);
    let html = '';
    for (let i = 0; i < 64; i += 1) {
      const [r, c] = rc(i);
      const p = board[i];
      const dark = (r + c) % 2 === 1;
      const cls = [
        'chess-sq',
        dark ? 'chess-sq--dark' : 'chess-sq--light',
        selected === i ? 'chess-sq--sel' : '',
        destSet.has(i) ? 'chess-sq--dest' : '',
        p && p !== '.' ? (isWhite(p) ? 'chess-sq--w' : 'chess-sq--b') : '',
      ].filter(Boolean).join(' ');
      const glyph = GLYPH[p] || '';
      html += `<button type="button" class="${cls}" data-idx="${i}" aria-label="square ${i}">${glyph}</button>`;
    }
    return html;
  }

  function renderBlock(source, fenceAttrs, options = {}) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const style = resolveStyle(cfg);
    const title = String(cfg.title || 'Chess').trim() || 'Chess';
    const mode = resolveMode(cfg);
    const difficulty = resolveDifficulty(cfg);
    const state = makeState(cfg);
    const score = parseScore(cfg.score);
    const gameIndex = Number.isFinite(options.chessIndex) ? options.chessIndex : 0;
    const fullscreen = resolveFullscreen(cfg);
    const themeClass = style.theme ? ` chess-block--${style.theme}` : '';
    const customClass = (style.colorCss || style.bgCss) ? ' chess-block--custom' : '';
    const fullClass = fullscreen ? ' chess-block--fullscreen' : '';
    const styleVars = [];
    if (style.colorCss) styleVars.push(`--chess-accent:${style.colorCss}`);
    if (style.bgCss) styleVars.push(`--chess-bg:${style.bgCss}`);
    const styleAttr = styleVars.length ? ` style="${styleVars.map((v) => escapeHtml(v)).join(';')}"` : '';
    const meta = mode === 'cpu' ? `vs CPU · ${difficulty}` : '2 players';
    const chrome = fullscreen ? '' : [
      `<div class="chess-block-header">`,
      `<div class="chess-block-title">${escapeHtml(title)}</div>`,
      `<div class="chess-block-meta">${escapeHtml(meta)}</div>`,
      `</div>`,
    ].join('');
    return [
      `<div class="chess-block${themeClass}${customClass}${fullClass}"${styleAttr}`,
      ` data-chess-index="${gameIndex}"`,
      ` data-chess-mode="${mode}"`,
      ` data-chess-difficulty="${difficulty}"`,
      ` data-chess-turn="${state.turn}"`,
      ` data-chess-castle="${escapeHtml(state.castle)}"`,
      ` data-chess-ep="${state.ep}"`,
      ` data-chess-board="${escapeHtml(serializeBoard(state.board))}"`,
      ` data-chess-score="${escapeHtml(serializeScore(score))}" tabindex="0">`,
      window.NotesProGameFullscreen?.renderButton?.() || '',
      chrome,
      `<div class="chess-play-area">`,
      `<div class="chess-toolbar" role="toolbar" aria-label="Chess options">`,
      `<button type="button" class="chess-chip${mode === 'cpu' ? ' is-active' : ''}" data-mode="cpu">CPU</button>`,
      `<button type="button" class="chess-chip${mode === 'hotseat' ? ' is-active' : ''}" data-mode="hotseat">2 players</button>`,
      `<span class="chess-toolbar-gap" aria-hidden="true"></span>`,
      `<button type="button" class="chess-chip chess-chip--diff${difficulty === 'easy' ? ' is-active' : ''}" data-diff="easy">Easy</button>`,
      `<button type="button" class="chess-chip chess-chip--diff${difficulty === 'medium' ? ' is-active' : ''}" data-diff="medium">Med</button>`,
      `<button type="button" class="chess-chip chess-chip--diff${difficulty === 'hard' ? ' is-active' : ''}" data-diff="hard">Hard</button>`,
      `</div>`,
      `<div class="chess-score" aria-live="polite">`,
      `<span data-score="w">You 0</span><span data-score="draw">Draw 0</span><span data-score="b">CPU 0</span>`,
      `</div>`,
      `<div class="chess-grid" role="grid" aria-label="${escapeHtml(title)}">${renderCells(state.board, -1, [])}</div>`,
      `<div class="chess-actions">`,
      `<button type="button" class="btn btn-sm btn-outline-light" data-action="new">New game</button>`,
      `</div>`,
      `</div>`,
      `<div class="chess-status" aria-live="polite"></div>`,
      `</div>`,
    ].join('');
  }

  function setStatus(el, text, kind) {
    const status = el.querySelector('.chess-status');
    if (!status) return;
    status.textContent = text || '';
    status.className = 'chess-status' + (kind ? ` chess-status--${kind}` : '');
  }

  function reportWin(difficulty, ply) {
    const mult = difficulty === 'hard' ? 3 : difficulty === 'easy' ? 1 : 2;
    const score = Math.max(100, 15000 * mult - ply * 20);
    window.NotesProHighscores?.submit?.('chess', score, { won: true, level: mult, moves: ply });
  }

  function hydrateBlock(el, options = {}) {
    if (!el || el.dataset.chessHydrated === '1') return;
    el.dataset.chessHydrated = '1';
    window.NotesProGameFullscreen?.bind?.(el);

    let mode = el.dataset.chessMode === 'hotseat' ? 'hotseat' : 'cpu';
    let difficulty = resolveDifficulty({ difficulty: el.dataset.chessDifficulty });
    let state = {
      board: parseBoard(el.dataset.chessBoard),
      turn: el.dataset.chessTurn === 'b' ? 'b' : 'w',
      castle: String(el.dataset.chessCastle || 'KQkq'),
      ep: parseEp(el.dataset.chessEp),
    };
    let score = parseScore(el.dataset.chessScore);
    let selected = -1;
    let scored = !!outcome(state);
    let busy = false;
    let ply = 0;
    let persistTimer = null;

    function schedulePersist() {
      if (typeof options.onPersist !== 'function') return;
      clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        options.onPersist({
          board: serializeBoard(state.board),
          mode,
          difficulty,
          score: serializeScore(score),
          turn: state.turn,
          castle: state.castle,
          ep: state.ep,
        });
      }, 280);
    }

    function destsFrom(from) {
      return legalMoves(state).filter((m) => m.from === from).map((m) => m.to);
    }

    function paint() {
      const dests = selected >= 0 ? destsFrom(selected) : [];
      const destSet = new Set(dests);
      el.querySelectorAll('.chess-sq').forEach((cell) => {
        const i = parseInt(cell.dataset.idx, 10);
        const p = state.board[i];
        cell.textContent = GLYPH[p] || '';
        cell.classList.toggle('chess-sq--sel', selected === i);
        cell.classList.toggle('chess-sq--dest', destSet.has(i));
        cell.classList.toggle('chess-sq--w', isWhite(p));
        cell.classList.toggle('chess-sq--b', isBlack(p));
      });
      el.querySelectorAll('[data-mode]').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.mode === mode);
      });
      el.querySelectorAll('[data-diff]').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.diff === difficulty);
        btn.hidden = mode !== 'cpu';
      });
      const wEl = el.querySelector('[data-score="w"]');
      const bEl = el.querySelector('[data-score="b"]');
      const dEl = el.querySelector('[data-score="draw"]');
      if (wEl) wEl.textContent = mode === 'cpu' ? `You ${score.w}` : `White ${score.w}`;
      if (bEl) bEl.textContent = mode === 'cpu' ? `CPU ${score.b}` : `Black ${score.b}`;
      if (dEl) dEl.textContent = `Draw ${score.draw}`;
      const meta = el.querySelector('.chess-block-meta');
      if (meta) meta.textContent = mode === 'cpu' ? `vs CPU · ${difficulty}` : '2 players';
      el.classList.toggle('chess-block--busy', busy);
      const end = outcome(state);
      if (end?.mark === 'draw') setStatus(el, 'Stalemate.', 'info');
      else if (end?.mark === 'w') setStatus(el, mode === 'cpu' ? 'Checkmate — you win!' : 'White mates.', 'success');
      else if (end?.mark === 'b') setStatus(el, mode === 'cpu' ? 'Checkmate — CPU wins.' : 'Black mates.', 'warn');
      else if (busy) setStatus(el, 'CPU thinking…', '');
      else if (inCheck(state.board, state.turn)) {
        setStatus(el, `${state.turn === 'w' ? 'White' : 'Black'} in check.`, 'warn');
      } else if (mode === 'cpu') {
        setStatus(el, state.turn === 'w' ? 'Your turn (white).' : 'CPU thinking…', '');
      } else {
        setStatus(el, `${state.turn === 'w' ? 'White' : 'Black'} to move.`, '');
      }
    }

    function tally(end) {
      if (!end || scored) return;
      scored = true;
      if (end.mark === 'w') {
        score.w += 1;
        if (mode === 'cpu') reportWin(difficulty, ply);
      } else if (end.mark === 'b') score.b += 1;
      else score.draw += 1;
    }

    function playMove(move) {
      state = applyMove(state, move);
      ply += 1;
      selected = -1;
      const end = outcome(state);
      if (end) tally(end);
      paint();
      schedulePersist();
      if (mode === 'cpu' && state.turn === 'b' && !outcome(state)) playCpu();
    }

    function playCpu() {
      if (mode !== 'cpu' || state.turn !== 'b' || outcome(state)) return;
      busy = true;
      paint();
      window.setTimeout(() => {
        const mv = bestCpuMove(state, difficulty);
        busy = false;
        if (mv) playMove(mv);
        else paint();
      }, 280);
    }

    function clickSq(i) {
      if (busy || outcome(state)) return;
      if (mode === 'cpu' && state.turn !== 'w') return;
      const moves = legalMoves(state);
      if (selected >= 0) {
        const mv = moves.find((m) => m.from === selected && m.to === i);
        if (mv) {
          playMove(mv);
          return;
        }
      }
      if (colorOf(state.board[i]) === state.turn) selected = i;
      else selected = -1;
      paint();
    }

    function newGame() {
      state = makeState({ board: START, turn: 'w', castle: 'KQkq', ep: '-1' });
      selected = -1;
      scored = false;
      busy = false;
      ply = 0;
      paint();
      schedulePersist();
    }

    el.addEventListener('click', (e) => {
      const modeBtn = e.target.closest('[data-mode]');
      const diffBtn = e.target.closest('[data-diff]');
      const action = e.target.closest('[data-action]')?.dataset.action;
      const sqBtn = e.target.closest('[data-idx]');
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
      if (sqBtn) clickSq(parseInt(sqBtn.dataset.idx, 10));
      el.focus({ preventScroll: true });
    });

    paint();
    if (mode === 'cpu' && state.turn === 'b') playCpu();
  }

  function hydrate(root) {
    (root || document).querySelectorAll('.chess-block[data-chess-index]').forEach((el) => hydrateBlock(el));
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
