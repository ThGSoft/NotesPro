/**
 * NotesPro ```tetris``` block — guideline-style Tetris (7-bag, ghost, hold, next).
 * Free vanilla JS implementation for NotesPro (no third-party game engine).
 */
(function (root, factory) {
  const api = factory();
  root.NotesProTetris = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];
  const COLS = 10;
  const ROWS = 20;
  const HIDDEN = 2;
  const TOTAL = ROWS + HIDDEN;
  const NAMES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
  const COLORS = {
    I: '#22d3ee',
    O: '#facc15',
    T: '#c084fc',
    S: '#4ade80',
    Z: '#f87171',
    J: '#60a5fa',
    L: '#fb923c',
  };
  const SHAPES = {
    I: [
      [[0, 1], [1, 1], [2, 1], [3, 1]],
      [[2, 0], [2, 1], [2, 2], [2, 3]],
      [[0, 2], [1, 2], [2, 2], [3, 2]],
      [[1, 0], [1, 1], [1, 2], [1, 3]],
    ],
    O: [
      [[1, 0], [2, 0], [1, 1], [2, 1]],
      [[1, 0], [2, 0], [1, 1], [2, 1]],
      [[1, 0], [2, 0], [1, 1], [2, 1]],
      [[1, 0], [2, 0], [1, 1], [2, 1]],
    ],
    T: [
      [[1, 0], [0, 1], [1, 1], [2, 1]],
      [[1, 0], [1, 1], [2, 1], [1, 2]],
      [[0, 1], [1, 1], [2, 1], [1, 2]],
      [[1, 0], [0, 1], [1, 1], [1, 2]],
    ],
    S: [
      [[1, 0], [2, 0], [0, 1], [1, 1]],
      [[1, 0], [1, 1], [2, 1], [2, 2]],
      [[1, 1], [2, 1], [0, 2], [1, 2]],
      [[0, 0], [0, 1], [1, 1], [1, 2]],
    ],
    Z: [
      [[0, 0], [1, 0], [1, 1], [2, 1]],
      [[2, 0], [1, 1], [2, 1], [1, 2]],
      [[0, 1], [1, 1], [1, 2], [2, 2]],
      [[1, 0], [0, 1], [1, 1], [0, 2]],
    ],
    J: [
      [[0, 0], [0, 1], [1, 1], [2, 1]],
      [[1, 0], [2, 0], [1, 1], [1, 2]],
      [[0, 1], [1, 1], [2, 1], [2, 2]],
      [[1, 0], [1, 1], [0, 2], [1, 2]],
    ],
    L: [
      [[2, 0], [0, 1], [1, 1], [2, 1]],
      [[1, 0], [1, 1], [1, 2], [2, 2]],
      [[0, 1], [1, 1], [2, 1], [0, 2]],
      [[0, 0], [1, 0], [1, 1], [1, 2]],
    ],
  };
  const KICKS = [[0, 0], [-1, 0], [1, 0], [0, -1], [-2, 0], [2, 0], [-1, -1], [1, -1], [0, 1]];
  const LINE_SCORES = [0, 100, 300, 500, 800];

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

  function parentIsMobile() {
    try {
      return document.body.classList.contains('mobile-layout')
        || window.matchMedia('(max-width: 768px)').matches;
    } catch (_) {
      return false;
    }
  }

  function emptyGrid() {
    return Array.from({ length: TOTAL }, () => Array(COLS).fill(''));
  }

  function cellsOf(piece) {
    return SHAPES[piece.name][piece.rot].map(([x, y]) => [piece.x + x, piece.y + y]);
  }

  function fits(grid, piece) {
    return cellsOf(piece).every(([x, y]) => (
      x >= 0 && x < COLS && y < TOTAL && (y < 0 || !grid[y][x])
    ));
  }

  function spawn(name) {
    return { name, rot: 0, x: 3, y: 0 };
  }

  function renderBlock(source, fenceAttrs, options = {}) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const style = resolveStyle(cfg);
    const title = String(cfg.title || 'Tetris').trim() || 'Tetris';
    const tetrisIndex = Number.isFinite(options.tetrisIndex) ? options.tetrisIndex : 0;
    const fullscreen = resolveFullscreen(cfg);
    const themeClass = style.theme ? ` tetris-block--${style.theme}` : '';
    const customClass = (style.colorCss || style.bgCss) ? ' tetris-block--custom' : '';
    const fullClass = fullscreen ? ' tetris-block--fullscreen' : '';
    const styleVars = [];
    if (style.colorCss) styleVars.push(`--tetris-accent:${style.colorCss}`);
    if (style.bgCss) styleVars.push(`--tetris-bg:${style.bgCss}`);
    const styleAttr = styleVars.length
      ? ` style="${styleVars.map(v => escapeHtml(v)).join(';')}"`
      : '';
    const chrome = fullscreen ? '' : [
      `<div class="tetris-block-header">`,
      `<div class="tetris-block-title">${escapeHtml(title)}</div>`,
      `<div class="tetris-block-meta">slow · 7-bag · ghost · hold</div>`,
      `</div>`,
      `<p class="tetris-block-hint">← → move · ↑ / X rotate · Z counter · ↓ soft · Space hard · C hold · P pause · R restart</p>`,
    ].join('');
    return [
      `<div class="tetris-block${themeClass}${customClass}${fullClass}"${styleAttr}`
      + ` data-tetris-index="${tetrisIndex}" tabindex="0">`,
      renderFullscreenButton(),
      chrome,
      `<div class="tetris-stage">`,
      `<canvas class="tetris-canvas" width="392" height="560" aria-label="${escapeHtml(title)}"></canvas>`,
      `</div>`,
      `<div class="tetris-pad" aria-label="Tetris controls">`,
      `<button type="button" class="tetris-pad__btn tetris-pad__btn--hold" data-act="hold" tabindex="-1">Hold</button>`,
      `<button type="button" class="tetris-pad__btn tetris-pad__btn--rot" data-act="rot" tabindex="-1">↻</button>`,
      `<button type="button" class="tetris-pad__btn tetris-pad__btn--drop" data-act="drop" tabindex="-1">Drop</button>`,
      `<button type="button" class="tetris-pad__btn tetris-pad__btn--left" data-act="left" tabindex="-1">◀</button>`,
      `<button type="button" class="tetris-pad__btn tetris-pad__btn--down" data-act="down" tabindex="-1">▼</button>`,
      `<button type="button" class="tetris-pad__btn tetris-pad__btn--right" data-act="right" tabindex="-1">▶</button>`,
      `</div>`,
      `<div class="tetris-status" aria-live="polite">Click to play</div>`,
      `</div>`,
    ].join('');
  }

  function createGame(el) {
    const canvas = el.querySelector('.tetris-canvas');
    const status = el.querySelector('.tetris-status');
    const pad = el.querySelector('.tetris-pad');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const state = {
      grid: emptyGrid(),
      piece: null,
      hold: '',
      holdUsed: false,
      bag: [],
      next: [],
      score: 0,
      lines: 0,
      level: 1,
      dropMs: 1600,
      acc: 0,
      last: 0,
      over: false,
      reported: false,
      paused: false,
      started: false,
      visible: true,
      raf: 0,
      running: true,
      keys: { left: 0, right: 0, down: false },
    };

    function setStatus(text) {
      if (status) status.textContent = text;
    }

    function reportScore() {
      if (state.reported || state.score <= 0) return;
      state.reported = true;
      const hs = window.NotesProHighscores;
      const improved = hs?.isNewRecord?.('tetris', state.score);
      hs?.submit?.('tetris', state.score, { level: state.level, lines: state.lines });
      const suffix = hs?.statusSuffix?.('tetris', state.score) || '';
      setStatus((improved ? 'New high score · ' : '') + `Game over · ${state.score} pts · R restart${suffix}`);
    }

    function fillBag() {
      const bag = NAMES.slice();
      for (let i = bag.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      state.bag.push(...bag);
    }

    function takeNext() {
      while (state.bag.length < 8) fillBag();
      while (state.next.length < 3) state.next.push(state.bag.shift());
      return state.next.shift();
    }

    function gravityMs() {
      return Math.max(220, 1600 - (state.level - 1) * 45);
    }

    function spawnPiece(name) {
      const piece = spawn(name || takeNext());
      if (!fits(state.grid, piece)) {
        state.over = true;
        state.paused = false;
        reportScore();
        return;
      }
      state.piece = piece;
      state.holdUsed = false;
      state.dropMs = gravityMs();
      state.acc = 0;
    }

    function lockPiece() {
      cellsOf(state.piece).forEach(([x, y]) => {
        if (y >= 0 && y < TOTAL) state.grid[y][x] = state.piece.name;
      });
      let cleared = 0;
      for (let y = TOTAL - 1; y >= 0; y -= 1) {
        if (state.grid[y].every(Boolean)) {
          state.grid.splice(y, 1);
          state.grid.unshift(Array(COLS).fill(''));
          cleared += 1;
          y += 1;
        }
      }
      if (cleared) {
        state.lines += cleared;
        state.score += (LINE_SCORES[cleared] || 0) * state.level;
        state.level = Math.floor(state.lines / 10) + 1;
      }
      spawnPiece();
    }

    function ghostY() {
      if (!state.piece) return 0;
      const ghost = { ...state.piece };
      while (fits(state.grid, { ...ghost, y: ghost.y + 1 })) ghost.y += 1;
      return ghost.y;
    }

    function tryMove(dx, dy) {
      if (!state.piece || state.over || state.paused) return false;
      const next = { ...state.piece, x: state.piece.x + dx, y: state.piece.y + dy };
      if (!fits(state.grid, next)) return false;
      state.piece = next;
      return true;
    }

    function rotate(dir) {
      if (!state.piece || state.over || state.paused) return;
      const rot = (state.piece.rot + dir + 4) % 4;
      for (const [kx, ky] of KICKS) {
        const next = { ...state.piece, rot, x: state.piece.x + kx, y: state.piece.y + ky };
        if (fits(state.grid, next)) {
          state.piece = next;
          return;
        }
      }
    }

    function hardDrop() {
      if (!state.piece || state.over || state.paused) return;
      let n = 0;
      while (tryMove(0, 1)) n += 1;
      state.score += n * 2;
      lockPiece();
    }

    function holdPiece() {
      if (!state.piece || state.over || state.paused || state.holdUsed) return;
      const current = state.piece.name;
      if (state.hold) {
        state.piece = spawn(state.hold);
        if (!fits(state.grid, state.piece)) state.piece = spawn(current);
        else state.hold = current;
      } else {
        state.hold = current;
        spawnPiece();
      }
      state.holdUsed = true;
    }

    function restart() {
      state.grid = emptyGrid();
      state.hold = '';
      state.holdUsed = false;
      state.bag = [];
      state.next = [];
      state.score = 0;
      state.lines = 0;
      state.level = 1;
      state.over = false;
      state.reported = false;
      state.paused = false;
      state.started = true;
      spawnPiece();
      setStatus(`Score ${state.score} · Lv ${state.level}${window.NotesProHighscores?.statusSuffix?.('tetris', 0) || ''}`);
    }

    function cellSize() {
      return Math.max(12, Math.floor(canvas.height / ROWS));
    }

    function drawMini(name, ox, oy, size) {
      if (!name) return;
      ctx.fillStyle = COLORS[name];
      SHAPES[name][0].forEach(([x, y]) => {
        ctx.fillRect(ox + x * size, oy + y * size, size - 1, size - 1);
      });
    }

    function draw() {
      const c = cellSize();
      const boardW = COLS * c;
      const side = canvas.width - boardW - 12;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#0b1020';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#111827';
      ctx.fillRect(0, 0, boardW, canvas.height);

      for (let y = HIDDEN; y < TOTAL; y += 1) {
        for (let x = 0; x < COLS; x += 1) {
          const cell = state.grid[y][x];
          if (!cell) continue;
          ctx.fillStyle = COLORS[cell];
          ctx.fillRect(x * c + 1, (y - HIDDEN) * c + 1, c - 2, c - 2);
        }
      }

      if (state.piece && !state.over) {
        const gy = ghostY();
        ctx.fillStyle = 'rgba(226, 232, 240, 0.18)';
        cellsOf({ ...state.piece, y: gy }).forEach(([x, y]) => {
          if (y < HIDDEN) return;
          ctx.fillRect(x * c + 1, (y - HIDDEN) * c + 1, c - 2, c - 2);
        });
        ctx.fillStyle = COLORS[state.piece.name];
        cellsOf(state.piece).forEach(([x, y]) => {
          if (y < HIDDEN) return;
          ctx.fillRect(x * c + 1, (y - HIDDEN) * c + 1, c - 2, c - 2);
        });
      }

      const sx = boardW + 14;
      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.fillText('HOLD', sx, 18);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(sx, 24, side - 8, 64);
      drawMini(state.hold, sx + 8, 32, 12);
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('NEXT', sx, 108);
      state.next.forEach((name, i) => {
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(sx, 116 + i * 70, side - 8, 64);
        drawMini(name, sx + 8, 124 + i * 70, 12);
      });
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '700 14px system-ui, sans-serif';
      ctx.fillText(String(state.score), sx, canvas.height - 72);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.fillText(`Lv ${state.level}`, sx, canvas.height - 52);
      ctx.fillText(`${state.lines} lines`, sx, canvas.height - 36);
      ctx.fillStyle = '#fde047';
      ctx.fillText(window.NotesProHighscores?.hudLine?.('tetris', state.score) || 'HI 000000', sx, canvas.height - 16);
      if (state.paused && !state.over) {
        ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
        ctx.fillRect(0, 0, boardW, canvas.height);
        ctx.fillStyle = '#f8fafc';
        ctx.font = '700 22px system-ui, sans-serif';
        ctx.fillText('PAUSED', 70, canvas.height / 2);
      }
      if (state.over) {
        ctx.fillStyle = 'rgba(15, 23, 42, 0.62)';
        ctx.fillRect(0, 0, boardW, canvas.height);
        ctx.fillStyle = '#f8fafc';
        ctx.font = '700 20px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('GAME OVER', 48, canvas.height / 2 - 36);
        window.NotesProHighscores?.drawBoard?.(ctx, {
          game: 'tetris',
          x: boardW / 2,
          y: canvas.height / 2 - 8,
          currentScore: state.score,
          maxRows: 5,
          color: '#e2e8f0',
        });
      }
    }

    function tick(now) {
      if (!state.running) return;
      state.raf = requestAnimationFrame(tick);
      if (!state.visible) return;
      const dt = Math.min(40, now - (state.last || now));
      state.last = now;
      if (state.started && !state.paused && !state.over) {
        if (state.keys.left > 0) {
          state.keys.left += dt;
          if (state.keys.left === dt || state.keys.left > 180) {
            tryMove(-1, 0);
            if (state.keys.left > 180) state.keys.left = 130;
          }
        }
        if (state.keys.right > 0) {
          state.keys.right += dt;
          if (state.keys.right === dt || state.keys.right > 180) {
            tryMove(1, 0);
            if (state.keys.right > 180) state.keys.right = 130;
          }
        }
        state.acc += dt;
        const step = state.keys.down ? 90 : state.dropMs;
        if (state.acc >= step) {
          state.acc = 0;
          if (!tryMove(0, 1)) lockPiece();
          else if (state.keys.down) state.score += 1;
        }
        setStatus(`Score ${state.score} · Lv ${state.level}${window.NotesProHighscores?.statusSuffix?.('tetris', state.score) || ''}`);
      }
      draw();
    }

    function fitCanvas() {
      const stage = el.querySelector('.tetris-stage');
      const maxW = Math.max(280, (stage?.clientWidth || 392));
      const maxH = Math.max(360, (stage?.clientHeight || 560));
      const cell = Math.max(12, Math.min(28, Math.floor((maxH - 8) / ROWS), Math.floor((maxW - 110) / COLS)));
      canvas.width = COLS * cell + 112;
      canvas.height = ROWS * cell;
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
        setStatus(state.paused ? 'Paused' : `Score ${state.score} · Lv ${state.level}${window.NotesProHighscores?.statusSuffix?.('tetris', state.score) || ''}`);
        return;
      }
      startIfNeeded();
      if (state.over || state.paused) return;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') {
        event.preventDefault();
        if (!state.keys.left) {
          tryMove(-1, 0);
          state.keys.left = 1;
        }
      } else if (k === 'ArrowRight' || k === 'd' || k === 'D') {
        event.preventDefault();
        if (!state.keys.right) {
          tryMove(1, 0);
          state.keys.right = 1;
        }
      } else if (k === 'ArrowDown' || k === 's' || k === 'S') {
        event.preventDefault();
        state.keys.down = true;
      } else if (k === 'ArrowUp' || k === 'x' || k === 'X' || k === 'w' || k === 'W') {
        event.preventDefault();
        rotate(1);
      } else if (k === 'z' || k === 'Z' || k === 'q' || k === 'Q') {
        event.preventDefault();
        rotate(-1);
      } else if (k === ' ') {
        event.preventDefault();
        hardDrop();
      } else if (k === 'c' || k === 'C' || k === 'Shift') {
        event.preventDefault();
        holdPiece();
      }
    }

    function onKeyUp(event) {
      const k = event.key;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') state.keys.left = 0;
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') state.keys.right = 0;
      else if (k === 'ArrowDown' || k === 's' || k === 'S') state.keys.down = false;
    }

    function syncPad() {
      if (!pad) return;
      const mobile = parentIsMobile();
      el.classList.toggle('tetris-block--mobile', mobile);
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
          if (act === 'left') {
            tryMove(-1, 0);
            state.keys.left = 1;
          } else if (act === 'right') {
            tryMove(1, 0);
            state.keys.right = 1;
          } else if (act === 'down') state.keys.down = true;
          else if (act === 'rot') rotate(1);
          else if (act === 'drop') hardDrop();
          else if (act === 'hold') holdPiece();
        };
        const up = (event) => {
          event.preventDefault();
          if (act === 'left') state.keys.left = 0;
          if (act === 'right') state.keys.right = 0;
          if (act === 'down') state.keys.down = false;
        };
        btn.addEventListener('pointerdown', down);
        btn.addEventListener('pointerup', up);
        btn.addEventListener('pointercancel', up);
        btn.addEventListener('lostpointercapture', up);
        btn.addEventListener('contextmenu', (event) => event.preventDefault());
      });
    }

    function onPointerDown(event) {
      if (event.target.closest?.('.tetris-pad')) return;
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
      state.visible = entries.some(e => e.isIntersecting);
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
    if (el._tetrisGame?.destroy) el._tetrisGame.destroy();
    el._tetrisGame = createGame(el);
  }

  function hydrate(root) {
    (root || document).querySelectorAll('.tetris-block[data-tetris-index]').forEach(hydrateBlock);
  }

  return {
    parseFenceAttrs,
    renderBlock,
    hydrateBlock,
    hydrate,
  };
}));
