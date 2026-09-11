/**
 * NotesPro ```snake``` block — grow by eating, walls or wrap.
 * Free vanilla JS implementation for NotesPro (no third-party game engine).
 */
(function (root, factory) {
  const api = factory();
  root.NotesProSnake = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];
  const COLS = 24;
  const ROWS = 18;
  const DIRS = {
    left: { x: -1, y: 0, name: 'left', opp: 'right' },
    right: { x: 1, y: 0, name: 'right', opp: 'left' },
    up: { x: 0, y: -1, name: 'up', opp: 'down' },
    down: { x: 0, y: 1, name: 'down', opp: 'up' },
  };

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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

  function resolveWrap(cfg) {
    const raw = String(cfg.wrap ?? cfg.walls ?? cfg.mode ?? '').trim().toLowerCase();
    if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'wrap' || raw === 'on') return true;
    if ('wrap' in cfg && (raw === '' || raw === 'wrap')) return true;
    return false;
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

  function renderBlock(source, fenceAttrs, options = {}) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const style = resolveStyle(cfg);
    const wrap = resolveWrap(cfg);
    const title = String(cfg.title || 'Snake').trim() || 'Snake';
    const snakeIndex = Number.isFinite(options.snakeIndex) ? options.snakeIndex : 0;
    const fullscreen = resolveFullscreen(cfg);
    const themeClass = style.theme ? ` snake-block--${style.theme}` : '';
    const customClass = (style.colorCss || style.bgCss) ? ' snake-block--custom' : '';
    const fullClass = fullscreen ? ' snake-block--fullscreen' : '';
    const styleVars = [];
    if (style.colorCss) styleVars.push(`--snake-accent:${style.colorCss}`);
    if (style.bgCss) styleVars.push(`--snake-bg:${style.bgCss}`);
    const styleAttr = styleVars.length
      ? ` style="${styleVars.map((v) => escapeHtml(v)).join(';')}"`
      : '';
    const chrome = fullscreen ? '' : [
      `<div class="snake-block-header">`,
      `<div class="snake-block-title">${escapeHtml(title)}</div>`,
      `<div class="snake-block-meta">${wrap ? 'wrap edges' : 'solid walls'}</div>`,
      `</div>`,
      `<p class="snake-block-hint">←↑↓→ / WASD · P pause · R restart</p>`,
    ].join('');
    return [
      `<div class="snake-block${themeClass}${customClass}${fullClass}"${styleAttr}`
      + ` data-snake-index="${snakeIndex}" data-snake-wrap="${wrap ? '1' : '0'}" tabindex="0">`,
      renderFullscreenButton(),
      chrome,
      `<div class="snake-stage">`,
      `<canvas class="snake-canvas" width="480" height="400" aria-label="${escapeHtml(title)}"></canvas>`,
      `</div>`,
      `<div class="snake-pad" aria-label="Snake controls">`,
      `<button type="button" class="snake-pad__btn snake-pad__btn--up" data-act="up" tabindex="-1">▲</button>`,
      `<button type="button" class="snake-pad__btn snake-pad__btn--left" data-act="left" tabindex="-1">◀</button>`,
      `<button type="button" class="snake-pad__btn snake-pad__btn--down" data-act="down" tabindex="-1">▼</button>`,
      `<button type="button" class="snake-pad__btn snake-pad__btn--right" data-act="right" tabindex="-1">▶</button>`,
      `</div>`,
      `<div class="snake-status" aria-live="polite">Click to play</div>`,
      `</div>`,
    ].join('');
  }

  function keyOf(x, y) {
    return `${x},${y}`;
  }

  function createGame(el) {
    const canvas = el.querySelector('.snake-canvas');
    const status = el.querySelector('.snake-status');
    const pad = el.querySelector('.snake-pad');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const wrap = el.dataset.snakeWrap === '1';
    const state = {
      body: [],
      dir: DIRS.right,
      queued: null,
      food: { x: 10, y: 8 },
      score: 0,
      over: false,
      reported: false,
      paused: false,
      started: false,
      acc: 0,
      stepMs: 140,
      visible: true,
      raf: 0,
      running: true,
      last: 0,
    };

    function setStatus(text) {
      if (status) status.textContent = text;
    }

    function length() {
      return state.body.length;
    }

    function reportScore() {
      if (state.reported || state.score <= 0) return;
      state.reported = true;
      const hs = window.NotesProHighscores;
      const improved = hs?.isNewRecord?.('snake', state.score);
      hs?.submit?.('snake', state.score, { length: length() });
      const suffix = hs?.statusSuffix?.('snake', state.score) || '';
      setStatus((improved ? 'New high score · ' : '') + `Game over · ${state.score} pts · R restart${suffix}`);
    }

    function occupied() {
      const set = new Set();
      state.body.forEach((p) => set.add(keyOf(p.x, p.y)));
      return set;
    }

    function placeFood() {
      const used = occupied();
      const free = [];
      for (let y = 0; y < ROWS; y += 1) {
        for (let x = 0; x < COLS; x += 1) {
          if (!used.has(keyOf(x, y))) free.push({ x, y });
        }
      }
      state.food = free.length ? free[Math.floor(Math.random() * free.length)] : { x: 0, y: 0 };
    }

    function restart() {
      const cx = Math.floor(COLS / 2);
      const cy = Math.floor(ROWS / 2);
      state.body = [{ x: cx - 1, y: cy }, { x: cx, y: cy }, { x: cx + 1, y: cy }];
      state.dir = DIRS.right;
      state.queued = null;
      state.score = 0;
      state.over = false;
      state.reported = false;
      state.paused = false;
      state.started = true;
      state.acc = 0;
      state.stepMs = 140;
      placeFood();
      setStatus(`Score ${state.score} · Len ${length()}${window.NotesProHighscores?.statusSuffix?.('snake', 0) || ''}`);
    }

    function turn(name) {
      const next = DIRS[name];
      if (!next) return;
      const current = state.queued || state.dir;
      if (next.name === current.opp) return;
      state.queued = next;
    }

    function step() {
      const dir = state.queued || state.dir;
      state.dir = dir;
      state.queued = null;
      const head = state.body[state.body.length - 1];
      let nx = head.x + dir.x;
      let ny = head.y + dir.y;
      if (wrap) {
        nx = (nx + COLS) % COLS;
        ny = (ny + ROWS) % ROWS;
      } else if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) {
        state.over = true;
        reportScore();
        return;
      }
      const eating = nx === state.food.x && ny === state.food.y;
      const used = occupied();
      if (!eating && state.body.length) {
        const tail = state.body[0];
        used.delete(keyOf(tail.x, tail.y));
      }
      if (used.has(keyOf(nx, ny))) {
        state.over = true;
        reportScore();
        return;
      }
      state.body.push({ x: nx, y: ny });
      if (eating) {
        state.score += 10 + Math.floor((length() - 3) / 2);
        state.stepMs = Math.max(70, 140 - Math.floor((length() - 3) * 2.2));
        placeFood();
      } else {
        state.body.shift();
      }
    }

    function cellSize() {
      return Math.floor(Math.min(canvas.width / COLS, (canvas.height - 28) / ROWS));
    }

    function draw() {
      const c = cellSize();
      const boardW = COLS * c;
      const boardH = ROWS * c;
      const ox = Math.floor((canvas.width - boardW) / 2);
      const oy = 28 + Math.floor((canvas.height - 28 - boardH) / 2);
      ctx.fillStyle = '#06140c';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#0b1f14';
      ctx.fillRect(ox, oy, boardW, boardH);
      ctx.strokeStyle = 'rgba(74, 222, 128, 0.08)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= COLS; x += 1) {
        ctx.beginPath();
        ctx.moveTo(ox + x * c + 0.5, oy);
        ctx.lineTo(ox + x * c + 0.5, oy + boardH);
        ctx.stroke();
      }
      for (let y = 0; y <= ROWS; y += 1) {
        ctx.beginPath();
        ctx.moveTo(ox, oy + y * c + 0.5);
        ctx.lineTo(ox + boardW, oy + y * c + 0.5);
        ctx.stroke();
      }
      if (!wrap) {
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 3;
        ctx.strokeRect(ox + 1.5, oy + 1.5, boardW - 3, boardH - 3);
      }

      ctx.fillStyle = '#94a3b8';
      ctx.font = '700 13px ui-monospace, Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(`SCORE ${String(state.score).padStart(6, '0')}`, 12, 18);
      ctx.textAlign = 'center';
      ctx.fillText(wrap ? 'WRAP' : 'WALLS', canvas.width / 2, 18);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#fde047';
      ctx.fillText(window.NotesProHighscores?.hudLine?.('snake', state.score) || 'HI 000000', canvas.width - 12, 18);

      const foodPulse = 0.75 + Math.sin(performance.now() / 180) * 0.15;
      ctx.fillStyle = '#f87171';
      ctx.beginPath();
      ctx.arc(ox + state.food.x * c + c / 2, oy + state.food.y * c + c / 2, (c / 2 - 2) * foodPulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#4ade80';
      ctx.fillRect(ox + state.food.x * c + c / 2 - 1, oy + state.food.y * c + 2, 2, 4);

      state.body.forEach((seg, i) => {
        const t = i / Math.max(1, state.body.length - 1);
        ctx.fillStyle = i === state.body.length - 1 ? '#bbf7d0' : `rgb(${34 + t * 80},${197 - t * 40},${94 + t * 40})`;
        const pad = i === state.body.length - 1 ? 1 : 2;
        ctx.fillRect(ox + seg.x * c + pad, oy + seg.y * c + pad, c - pad * 2, c - pad * 2);
      });
      const head = state.body[state.body.length - 1];
      if (head) {
        ctx.fillStyle = '#052e16';
        const hx = ox + head.x * c + c / 2 + state.dir.x * 3;
        const hy = oy + head.y * c + c / 2 + state.dir.y * 3;
        const oxe = state.dir.x === 0 ? 3 : 0;
        const oye = state.dir.y === 0 ? 3 : 0;
        ctx.beginPath();
        ctx.arc(hx - oxe, hy - oye, 2, 0, Math.PI * 2);
        ctx.arc(hx + oxe, hy + oye, 2, 0, Math.PI * 2);
        ctx.fill();
      }

      if (state.paused && !state.over) {
        ctx.fillStyle = 'rgba(6, 20, 12, 0.55)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#f8fafc';
        ctx.font = '700 28px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('PAUSED', canvas.width / 2, canvas.height / 2);
      }
      if (state.over) {
        ctx.fillStyle = 'rgba(6, 20, 12, 0.62)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#f8fafc';
        ctx.font = '700 22px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('GAME OVER', canvas.width / 2, canvas.height / 2 - 48);
        window.NotesProHighscores?.drawBoard?.(ctx, {
          game: 'snake',
          x: canvas.width / 2,
          y: canvas.height / 2 - 16,
          currentScore: state.score,
          maxRows: 5,
          color: '#e2e8f0',
        });
      }
      if (!state.started) {
        ctx.fillStyle = 'rgba(6, 20, 12, 0.35)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#e2e8f0';
        ctx.font = '700 18px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('CLICK TO PLAY', canvas.width / 2, canvas.height / 2);
      }
    }

    function tick(now) {
      if (!state.running) return;
      state.raf = requestAnimationFrame(tick);
      if (!state.visible) return;
      const dt = Math.min(40, now - (state.last || now));
      state.last = now;
      if (state.started && !state.paused && !state.over) {
        state.acc += dt;
        while (state.acc >= state.stepMs) {
          state.acc -= state.stepMs;
          step();
          if (state.over) break;
        }
        setStatus(`Score ${state.score} · Len ${length()}${window.NotesProHighscores?.statusSuffix?.('snake', state.score) || ''}`);
      }
      draw();
    }

    function fitCanvas() {
      const stage = el.querySelector('.snake-stage');
      const maxW = Math.max(280, stage?.clientWidth || 480);
      const maxH = Math.max(280, stage?.clientHeight || 400);
      const cell = Math.max(12, Math.min(28, Math.floor(maxW / COLS), Math.floor((maxH - 28) / ROWS)));
      canvas.width = COLS * cell;
      canvas.height = ROWS * cell + 28;
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
        setStatus(state.paused ? 'Paused' : `Score ${state.score} · Len ${length()}`);
        return;
      }
      startIfNeeded();
      if (state.over || state.paused) return;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') {
        event.preventDefault();
        turn('left');
      } else if (k === 'ArrowRight' || k === 'd' || k === 'D') {
        event.preventDefault();
        turn('right');
      } else if (k === 'ArrowUp' || k === 'w' || k === 'W') {
        event.preventDefault();
        turn('up');
      } else if (k === 'ArrowDown' || k === 's' || k === 'S') {
        event.preventDefault();
        turn('down');
      }
    }

    function syncPad() {
      if (!pad) return;
      const mobile = parentIsMobile();
      el.classList.toggle('snake-block--mobile', mobile);
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
          turn(act);
        };
        btn.addEventListener('pointerdown', down);
        btn.addEventListener('contextmenu', (event) => event.preventDefault());
      });
    }

    function onPointerDown(event) {
      if (event.target.closest?.('.snake-pad')) return;
      el.focus({ preventScroll: true });
      if (!state.started || state.over) restart();
    }

    fitCanvas();
    syncPad();
    bindPad();
    draw();
    el.addEventListener('keydown', onKeyDown);
    canvas.addEventListener('pointerdown', onPointerDown);
    const onResize = () => {
      fitCanvas();
      syncPad();
      draw();
    };
    window.addEventListener('resize', onResize);
    const io = new IntersectionObserver((entries) => {
      state.visible = entries.some((e) => e.isIntersecting);
    }, { threshold: 0.05 });
    io.observe(el);
    state.raf = requestAnimationFrame(tick);

    return {
      destroy() {
        state.running = false;
        cancelAnimationFrame(state.raf);
        el.removeEventListener('keydown', onKeyDown);
        canvas.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('resize', onResize);
        io.disconnect();
      },
    };
  }

  function hydrateBlock(el) {
    if (!el) return;
    bindFullscreenButton(el);
    if (el._snakeGame?.destroy) el._snakeGame.destroy();
    el._snakeGame = createGame(el);
  }

  function hydrate(root) {
    (root || document).querySelectorAll('.snake-block[data-snake-index]').forEach(hydrateBlock);
  }

  return {
    parseFenceAttrs,
    renderBlock,
    hydrateBlock,
    hydrate,
  };
}));
