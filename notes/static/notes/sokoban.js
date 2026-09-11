/**
 * NotesPro ```sokoban``` block — push crates onto targets.
 */
(function (root, factory) {
  const api = factory();
  root.NotesProSokoban = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];
  const DIRS = {
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0],
  };

  const BUILTIN = [
    {
      name: 'Crate in the corner',
      map: [
        '#####',
        '#   #',
        '# $.#',
        '# @ #',
        '#####',
      ],
    },
    {
      name: 'Two crates',
      map: [
        '######',
        '#    #',
        '# $$ #',
        '# .. #',
        '# @  #',
        '######',
      ],
    },
    {
      name: 'Hall push',
      map: [
        '#######',
        '#     #',
        '# $ $ #',
        '#.@ . #',
        '#######',
      ],
    },
    {
      name: 'Mini warehouse',
      map: [
        '  ####',
        '  #  #',
        '###$.#',
        '#  $.#',
        '# @  #',
        '######',
      ],
    },
    {
      name: 'U-turn',
      map: [
        '########',
        '#      #',
        '# #### #',
        '# #..# #',
        '# #$ # #',
        '#  $ @ #',
        '########',
      ],
    },
    {
      name: 'Four rooms',
      map: [
        '#########',
        '#  #    #',
        '# $#. $ #',
        '#  #  @ #',
        '##$# ####',
        '#  .    #',
        '#    .  #',
        '#########',
      ],
    },
    {
      name: 'Narrow dock',
      map: [
        '  #####',
        '###   #',
        '# $ # ##',
        '# $  . #',
        '#  ##. #',
        '## @   #',
        ' #######',
      ],
    },
    {
      name: 'Yard loop',
      map: [
        '##########',
        '#   ..   #',
        '# ##  ## #',
        '#  $  $  #',
        '##  ##  ##',
        '#  $  $  #',
        '# ##  ## #',
        '#   @    #',
        '##########',
      ],
    },
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

  function renderFullscreenButton() {
    return window.NotesProGameFullscreen?.renderButton?.() || '';
  }

  function bindFullscreenButton(el) {
    window.NotesProGameFullscreen?.bind?.(el);
  }

  function parseMaps(source) {
    const text = String(source || '').replace(/\r\n/g, '\n').trim();
    if (!text) return BUILTIN.slice();
    const chunks = text.split(/\n\s*\n/).map((c) => c.trim()).filter(Boolean);
    const levels = [];
    chunks.forEach((chunk, i) => {
      const rawLines = chunk.split('\n').map((l) => l.replace(/\s+$/, '')).filter(Boolean);
      const map = rawLines.filter((l) => /[#$@*+]/.test(l) && !/^#\s+[A-Za-z]/.test(l));
      if (!map.length) return;
      const titleLine = rawLines.find((l) => (
        /^#\s+[A-Za-z]/.test(l) || (/^[A-Za-z]/.test(l.trim()) && !/[#$@*+]/.test(l))
      ));
      levels.push({
        name: titleLine ? titleLine.replace(/^#\s*/, '').trim() : `Custom ${i + 1}`,
        map,
      });
    });
    return levels.length ? levels : BUILTIN.slice();
  }

  function cloneLevel(level) {
    const walls = new Set();
    const goals = new Set();
    const boxes = new Set();
    let player = { x: 1, y: 1 };
    let w = 0;
    const rows = level.map || [];
    rows.forEach((row, y) => {
      w = Math.max(w, row.length);
      for (let x = 0; x < row.length; x += 1) {
        const ch = row[x];
        const key = `${x},${y}`;
        if (ch === '#') walls.add(key);
        if (ch === '.' || ch === '+' || ch === '*') goals.add(key);
        if (ch === '$' || ch === '*') boxes.add(key);
        if (ch === '@' || ch === '+') player = { x, y };
      }
    });
    return {
      name: level.name || 'Sokoban',
      walls,
      goals,
      boxes,
      player,
      w,
      h: rows.length,
    };
  }

  function keyOf(x, y) {
    return `${x},${y}`;
  }

  function snapshot(state) {
    return {
      player: { ...state.player },
      boxes: new Set(state.boxes),
      moves: state.moves,
      pushes: state.pushes,
    };
  }

  function restore(state, snap) {
    state.player = { ...snap.player };
    state.boxes = new Set(snap.boxes);
    state.moves = snap.moves;
    state.pushes = snap.pushes;
  }

  function won(state) {
    for (const g of state.goals) {
      if (!state.boxes.has(g)) return false;
    }
    return state.goals.size > 0;
  }

  function formatTime(ms) {
    const t = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(t / 60);
    const s = t % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function scoreFor(levelIndex, moves, seconds) {
    const base = (levelIndex + 1) * 10000;
    return Math.max(100, base - moves * 8 - seconds * 12);
  }

  function encodeSpec(spec) {
    try {
      return btoa(unescape(encodeURIComponent(JSON.stringify(spec))));
    } catch (_) {
      return '';
    }
  }

  function decodeSpec(raw) {
    try {
      return JSON.parse(decodeURIComponent(escape(atob(raw))));
    } catch (_) {
      return null;
    }
  }

  function renderBlock(source, fenceAttrs, options = {}) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const style = resolveStyle(cfg);
    const title = String(cfg.title || 'Sokoban').trim() || 'Sokoban';
    const sokobanIndex = Number.isFinite(options.sokobanIndex) ? options.sokobanIndex : 0;
    const fullscreen = resolveFullscreen(cfg);
    const themeClass = style.theme ? ` sokoban-block--${style.theme}` : '';
    const customClass = (style.colorCss || style.bgCss) ? ' sokoban-block--custom' : '';
    const fullClass = fullscreen ? ' sokoban-block--fullscreen' : '';
    const styleVars = [];
    if (style.colorCss) styleVars.push(`--sokoban-accent:${style.colorCss}`);
    if (style.bgCss) styleVars.push(`--sokoban-bg:${style.bgCss}`);
    const styleAttr = styleVars.length
      ? ` style="${styleVars.map((v) => escapeHtml(v)).join(';')}"`
      : '';
    const chrome = fullscreen ? '' : [
      `<div class="sokoban-block-header">`,
      `<div class="sokoban-block-title">${escapeHtml(title)}</div>`,
      `<div class="sokoban-block-meta">push crates onto the dots</div>`,
      `</div>`,
      `<p class="sokoban-block-hint">←↑↓→ / WASD move · U undo · R reset · [ ] level</p>`,
    ].join('');
    return [
      `<div class="sokoban-block${themeClass}${customClass}${fullClass}"${styleAttr}`,
      ` data-sokoban-index="${sokobanIndex}"`,
      ` data-sokoban-spec="${escapeHtml(encodeSpec({ source: source || '', cfg }))}" tabindex="0">`,
      renderFullscreenButton(),
      chrome,
      `<div class="sokoban-stage">`,
      `<canvas class="sokoban-canvas" width="640" height="480" aria-label="${escapeHtml(title)}"></canvas>`,
      `</div>`,
      `<div class="sokoban-toolbar">`,
      `<button type="button" class="btn btn-sm btn-outline-light" data-act="undo">Undo</button>`,
      `<button type="button" class="btn btn-sm btn-outline-light" data-act="reset">Reset</button>`,
      `<button type="button" class="btn btn-sm btn-outline-light" data-act="prev">Prev</button>`,
      `<button type="button" class="btn btn-sm btn-outline-light" data-act="next">Next</button>`,
      `</div>`,
      `<div class="sokoban-pad" aria-label="Sokoban controls">`,
      `<button type="button" class="sokoban-pad__btn sokoban-pad__btn--up" data-dir="KeyW" tabindex="-1">▲</button>`,
      `<button type="button" class="sokoban-pad__btn sokoban-pad__btn--left" data-dir="KeyA" tabindex="-1">◀</button>`,
      `<button type="button" class="sokoban-pad__btn sokoban-pad__btn--down" data-dir="KeyS" tabindex="-1">▼</button>`,
      `<button type="button" class="sokoban-pad__btn sokoban-pad__btn--right" data-dir="KeyD" tabindex="-1">▶</button>`,
      `</div>`,
      `<div class="sokoban-status" aria-live="polite">Click to play</div>`,
      `</div>`,
    ].join('');
  }

  function createGame(el, source, cfg) {
    const canvas = el.querySelector('.sokoban-canvas');
    const status = el.querySelector('.sokoban-status');
    const pad = el.querySelector('.sokoban-pad');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const levels = parseMaps(source);
    const startLevel = Math.max(0, Math.min(levels.length - 1, parseInt(cfg.level, 10) - 1 || 0));
    const state = {
      levelIndex: startLevel,
      ...cloneLevel(levels[startLevel]),
      moves: 0,
      pushes: 0,
      startedAt: 0,
      elapsed: 0,
      won: false,
      reported: false,
      history: [],
      totalScore: 0,
      raf: 0,
      running: true,
    };

    function setStatus(text) {
      if (status) status.textContent = text;
    }

    function nowMs() {
      if (state.won) return state.elapsed;
      if (!state.startedAt) return 0;
      return performance.now() - state.startedAt;
    }

    function loadLevel(index) {
      const i = ((index % levels.length) + levels.length) % levels.length;
      const packed = cloneLevel(levels[i]);
      state.levelIndex = i;
      state.walls = packed.walls;
      state.goals = packed.goals;
      state.boxes = packed.boxes;
      state.player = packed.player;
      state.w = packed.w;
      state.h = packed.h;
      state.moves = 0;
      state.pushes = 0;
      state.startedAt = 0;
      state.elapsed = 0;
      state.won = false;
      state.reported = false;
      state.history = [];
      paint();
      setStatus(`${packed.name} · ${i + 1}/${levels.length}`);
    }

    function tryMove(dx, dy) {
      if (state.won) return;
      const nx = state.player.x + dx;
      const ny = state.player.y + dy;
      const nk = keyOf(nx, ny);
      if (state.walls.has(nk)) return;
      const snap = snapshot(state);
      if (state.boxes.has(nk)) {
        const bx = nx + dx;
        const by = ny + dy;
        const bk = keyOf(bx, by);
        if (state.walls.has(bk) || state.boxes.has(bk)) return;
        state.boxes.delete(nk);
        state.boxes.add(bk);
        state.pushes += 1;
      }
      if (!state.startedAt) state.startedAt = performance.now();
      state.history.push(snap);
      if (state.history.length > 400) state.history.shift();
      state.player = { x: nx, y: ny };
      state.moves += 1;
      if (won(state)) {
        state.won = true;
        state.elapsed = nowMs();
        const seconds = Math.floor(state.elapsed / 1000);
        const gained = scoreFor(state.levelIndex, state.moves, seconds);
        state.totalScore += gained;
        reportScore();
        setStatus(`Solved in ${state.moves} moves · ${formatTime(state.elapsed)} · +${gained} · Next for more`);
      }
      paint();
    }

    function undo() {
      if (state.won || !state.history.length) return;
      restore(state, state.history.pop());
      paint();
    }

    function reportScore() {
      if (state.reported || state.totalScore <= 0) return;
      state.reported = true;
      const hs = window.NotesProHighscores;
      hs?.submit?.('sokoban', state.totalScore, {
        level: state.levelIndex + 1,
        moves: state.moves,
        time: Math.floor(state.elapsed / 1000),
      });
    }

    function paint() {
      const padPx = 12;
      const cell = Math.max(18, Math.min(
        (canvas.width - padPx * 2) / Math.max(1, state.w),
        (canvas.height - padPx * 2) / Math.max(1, state.h),
      ));
      const ox = (canvas.width - state.w * cell) / 2;
      const oy = (canvas.height - state.h * cell) / 2;
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(ox - 4, oy - 4, state.w * cell + 8, state.h * cell + 8);

      for (let y = 0; y < state.h; y += 1) {
        for (let x = 0; x < state.w; x += 1) {
          const k = keyOf(x, y);
          const px = ox + x * cell;
          const py = oy + y * cell;
          if (state.walls.has(k)) {
            ctx.fillStyle = (x + y) % 2 ? '#475569' : '#334155';
            ctx.fillRect(px + 1, py + 1, cell - 2, cell - 2);
            ctx.fillStyle = '#94a3b8';
            ctx.fillRect(px + 1, py + 1, cell - 2, 3);
            continue;
          }
          ctx.fillStyle = (x + y) % 2 ? '#243044' : '#1b2536';
          ctx.fillRect(px + 1, py + 1, cell - 2, cell - 2);
          if (state.goals.has(k)) {
            ctx.beginPath();
            ctx.arc(px + cell / 2, py + cell / 2, cell * 0.16, 0, Math.PI * 2);
            ctx.fillStyle = '#fbbf24';
            ctx.fill();
          }
          if (state.boxes.has(k)) {
            const on = state.goals.has(k);
            ctx.fillStyle = on ? '#22c55e' : '#b45309';
            const m = cell * 0.14;
            ctx.fillRect(px + m, py + m, cell - m * 2, cell - m * 2);
            ctx.strokeStyle = on ? '#bbf7d0' : '#fde68a';
            ctx.lineWidth = 2;
            ctx.strokeRect(px + m, py + m, cell - m * 2, cell - m * 2);
            ctx.beginPath();
            ctx.moveTo(px + m, py + m);
            ctx.lineTo(px + cell - m, py + cell - m);
            ctx.moveTo(px + cell - m, py + m);
            ctx.lineTo(px + m, py + cell - m);
            ctx.stroke();
          }
        }
      }
      const px = ox + state.player.x * cell + cell / 2;
      const py = oy + state.player.y * cell + cell / 2;
      ctx.beginPath();
      ctx.arc(px, py, cell * 0.32, 0, Math.PI * 2);
      ctx.fillStyle = '#38bdf8';
      ctx.fill();
      ctx.strokeStyle = '#e0f2fe';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#f8fafc';
      ctx.font = `600 ${Math.max(11, Math.floor(cell * 0.28))}px system-ui,sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const hi = window.NotesProHighscores?.hudLine?.('sokoban', state.totalScore) || '';
      ctx.fillText(
        `Lv ${state.levelIndex + 1}/${levels.length}  Moves ${state.moves}  ${formatTime(nowMs())}${hi ? `  ${hi}` : ''}`,
        10,
        8,
      );
      if (!state.startedAt && !state.won) {
        ctx.fillStyle = 'rgba(15,23,42,0.55)';
        ctx.fillRect(0, canvas.height / 2 - 22, canvas.width, 44);
        ctx.fillStyle = '#fde68a';
        ctx.textAlign = 'center';
        ctx.font = '600 16px system-ui,sans-serif';
        ctx.fillText('Click · push every crate onto a gold dot', canvas.width / 2, canvas.height / 2 - 6);
      }
      if (state.won) {
        ctx.fillStyle = 'rgba(6,78,59,0.55)';
        ctx.fillRect(0, canvas.height / 2 - 28, canvas.width, 56);
        ctx.fillStyle = '#bbf7d0';
        ctx.textAlign = 'center';
        ctx.font = '700 22px system-ui,sans-serif';
        ctx.fillText('Solved', canvas.width / 2, canvas.height / 2 - 8);
      }
    }

    function onKeyDown(e) {
      if (!el.contains(document.activeElement) && document.activeElement !== el) return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      const dir = DIRS[e.code];
      if (dir) {
        e.preventDefault();
        tryMove(dir[0], dir[1]);
        return;
      }
      if (e.code === 'KeyU' || e.code === 'KeyZ') {
        e.preventDefault();
        undo();
      } else if (e.code === 'KeyR') {
        e.preventDefault();
        loadLevel(state.levelIndex);
      } else if (e.code === 'BracketLeft' || e.code === 'Comma') {
        e.preventDefault();
        loadLevel(state.levelIndex - 1);
      } else if (e.code === 'BracketRight' || e.code === 'Period') {
        e.preventDefault();
        loadLevel(state.levelIndex + 1);
      }
    }

    function syncPad() {
      if (!pad) return;
      const mobile = document.body.classList.contains('mobile-layout')
        || (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 768px)').matches);
      pad.classList.toggle('is-visible', mobile);
    }

    function onClick(e) {
      const act = e.target.closest('[data-act]')?.dataset.act;
      const dir = e.target.closest('[data-dir]')?.dataset.dir;
      if (dir && DIRS[dir]) {
        tryMove(DIRS[dir][0], DIRS[dir][1]);
        return;
      }
      if (act === 'undo') undo();
      else if (act === 'reset') loadLevel(state.levelIndex);
      else if (act === 'prev') loadLevel(state.levelIndex - 1);
      else if (act === 'next') loadLevel(state.levelIndex + 1);
      el.focus({ preventScroll: true });
    }

    el.addEventListener('click', onClick);
    el.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', syncPad);
    syncPad();
    loadLevel(startLevel);

    function tick() {
      if (!state.running) return;
      if (state.startedAt && !state.won) paint();
      state.raf = requestAnimationFrame(tick);
    }
    state.raf = requestAnimationFrame(tick);

    return {
      destroy() {
        state.running = false;
        cancelAnimationFrame(state.raf);
        el.removeEventListener('click', onClick);
        el.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('resize', syncPad);
      },
    };
  }

  function hydrateBlock(el) {
    if (!el) return;
    bindFullscreenButton(el);
    const spec = decodeSpec(el.dataset.sokobanSpec) || {};
    if (el._sokobanGame?.destroy) el._sokobanGame.destroy();
    el._sokobanGame = createGame(el, spec.source || '', spec.cfg || {});
  }

  function hydrate(root) {
    (root || document).querySelectorAll('.sokoban-block[data-sokoban-index]').forEach((el) => hydrateBlock(el));
  }

  return {
    parseFenceAttrs,
    parseMaps,
    renderBlock,
    hydrateBlock,
    hydrate,
  };
}));
