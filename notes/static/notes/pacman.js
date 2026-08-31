/**
 * NotesPro ```pacman``` block — classic maze in preview.
 */
(function (root, factory) {
  const api = factory();
  root.NotesProPacman = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];
  const COLS = 28;
  const ROWS = 31;
  const TILE = 16;
  const HUD = 36;
  const DIRS = {
    left: { x: -1, y: 0, name: 'left' },
    right: { x: 1, y: 0, name: 'right' },
    up: { x: 0, y: -1, name: 'up' },
    down: { x: 0, y: 1, name: 'down' },
  };
  const DIR_LIST = [DIRS.up, DIRS.left, DIRS.down, DIRS.right];
  const LEVELS = [
    {
      name: 'Arcade',
      wall: '#151a6e',
      stroke: '#3d5bff',
      src: [
        '############################',
        '#............##............#',
        '#.####.#####.##.#####.####.#',
        '#o####.#####.##.#####.####o#',
        '#.####.#####.##.#####.####.#',
        '#..........................#',
        '#.####.##.########.##.####.#',
        '#.####.##.########.##.####.#',
        '#......##....##....##......#',
        '######.##### ## #####.######',
        '_____#.##### ## #####.#_____',
        '_____#.##          ##.#_____',
        '_____#.## ###==### ##.#_____',
        '######.## #      # ##.######',
        '      .   #      #   .      ',
        '######.## #      # ##.######',
        '_____#.## ######## ##.#_____',
        '_____#.##          ##.#_____',
        '_____#.## ######## ##.#_____',
        '######.## ######## ##.######',
        '#............##............#',
        '#.####.#####.##.#####.####.#',
        '#o####.#####.##.#####.####o#',
        '#...##.......  .......##...#',
        '###.##.##.########.##.##.###',
        '###.##.##.########.##.##.###',
        '#......##....##....##......#',
        '#.##########.##.##########.#',
        '#.##########.##.##########.#',
        '#..........................#',
        '############################',
      ],
    },
    {
      name: 'Lanes',
      wall: '#0d3d2f',
      stroke: '#2ee6a0',
      src: [
        '############################',
        '#............##............#',
        '#o###.#.####.##.####.#.###o#',
        '#.###.#.####.##.####.#.###.#',
        '#.....#......##......#.....#',
        '#.###.#.############.#.###.#',
        '#.###.##............##.###.#',
        '#......##.########.##......#',
        '#.####.##....##....##.####.#',
        '######.##### ## #####.######',
        '######.##### ## #####.######',
        '######.##          ##.######',
        '######.## ###==### ##.######',
        '######.## #      # ##.######',
        '      .   #      #   .      ',
        '######.## #      # ##.######',
        '######.## ######## ##.######',
        '######.##          ##.######',
        '######.## ######## ##.######',
        '######.## ######## ##.######',
        '#............##............#',
        '#o####.##..........##.####o#',
        '#.####.##.########.##.####.#',
        '#......##....  ....##......#',
        '######.#####.##.#####.######',
        '#......#####.##.#####......#',
        '#.####.##..........##.####.#',
        '#.####.##.########.##.####.#',
        '#......##....##....##......#',
        '#..........................#',
        '############################',
      ],
    },
    {
      name: 'Citadel',
      wall: '#3d1548',
      stroke: '#e050ff',
      src: [
        '############################',
        '#......##..........##......#',
        '#o####.##.########.##.####o#',
        '#.####.##.########.##.####.#',
        '#......##....##....##......#',
        '#.####.#####.##.#####.####.#',
        '#.####.#####.##.#####.####.#',
        '#..........................#',
        '#.####.##.########.##.####.#',
        '######.##### ## #####.######',
        '_____#.##### ## #####.#_____',
        '_____#.##          ##.#_____',
        '_____#.## ###==### ##.#_____',
        '######.## #      # ##.######',
        '      .   #      #   .      ',
        '######.## #      # ##.######',
        '_____#.## ######## ##.#_____',
        '_____#.##          ##.#_____',
        '_____#.## ######## ##.#_____',
        '######.## ######## ##.######',
        '#............##............#',
        '#o####.##..........##.####o#',
        '#.####.##.########.##.####.#',
        '#......##....  ....##......#',
        '######.#####.##.#####.######',
        '#......#####.##.#####......#',
        '#.####.##..........##.####.#',
        '#.####.##.########.##.####.#',
        '#......##....##....##......#',
        '#..........................#',
        '############################',
      ],
    },
    {
      name: 'Fork',
      wall: '#4a2208',
      stroke: '#ff8a3d',
      src: [
        '############################',
        '#............##............#',
        '#.####o#.###.##.###.#o####.#',
        '#.####.#.###.##.###.#.####.#',
        '#......#............#......#',
        '######.#.##########.#.######',
        '#......#.....##.....#......#',
        '#.####.####..##..####.####.#',
        '#......##..........##......#',
        '######.##### ## #####.######',
        '######.##### ## #####.######',
        '######.##          ##.######',
        '######.## ###==### ##.######',
        '######.## #      # ##.######',
        '      .   #      #   .      ',
        '######.## #      # ##.######',
        '######.## ######## ##.######',
        '######.##          ##.######',
        '######.## ######## ##.######',
        '######.## ######## ##.######',
        '#.#..........##..........#.#',
        '#.#.####.###.##.###.####.#.#',
        '#o#.####.###.##.###.####.#o#',
        '#.#.......##    ##.......#.#',
        '#.#.##.#####.##.#####.##.#.#',
        '#......#####.##.#####......#',
        '#.####.##..........##.####.#',
        '#.##########.##.##########.#',
        '#.#......................#.#',
        '#..........................#',
        '############################',
      ],
    },
    {
      name: 'Night',
      wall: '#12304a',
      stroke: '#4ecbff',
      src: [
        '############################',
        '#.#..........##..........#.#',
        '#.#o####.###.##.###.####o#.#',
        '#.#.####.###.##.###.####.#.#',
        '#.#......................#.#',
        '#.#.####.##......##.####.#.#',
        '#.#.####.##.####.##.####.#.#',
        '#.#......##.####.##......#.#',
        '#......##....##....##......#',
        '######.##### ## #####.######',
        '_____#.##### ## #####.#_____',
        '_____#.##          ##.#_____',
        '_____#.## ###==### ##.#_____',
        '######.## #      # ##.######',
        '      .   #      #   .      ',
        '######.## #      # ##.######',
        '_____#.## ######## ##.#_____',
        '_____#.##          ##.#_____',
        '_____#.## ######## ##.#_____',
        '######.## ######## ##.######',
        '#......##..........##......#',
        '#o####.#####.##.#####.####o#',
        '#.####.#####.##.#####.####.#',
        '#...##........  ......##...#',
        '#.###.########.##.####.###.#',
        '#.###.##............##.###.#',
        '#......##.########.##......#',
        '#.##########.##.##########.#',
        '#......##..........##......#',
        '#..........................#',
        '############################',
      ],
    },
    {
      name: 'Wide',
      wall: '#4a1030',
      stroke: '#ff5a9a',
      src: [
        '############################',
        '#..........................#',
        '#o##....................##o#',
        '#.##.##################.##.#',
        '#.##....................##.#',
        '#.##.##.############.##.##.#',
        '#......##..........##......#',
        '#.####.##.########.##.####.#',
        '#..........................#',
        '######.##### ## #####.######',
        '######.##### ## #####.######',
        '######.##          ##.######',
        '######.## ###==### ##.######',
        '######.## #      # ##.######',
        '      .   #      #   .      ',
        '######.## #      # ##.######',
        '######.## ######## ##.######',
        '######.##          ##.######',
        '######.## ######## ##.######',
        '######.## ######## ##.######',
        '#..........................#',
        '#o####.##..........##.####o#',
        '#.####.##.########.##.####.#',
        '#......##....  ....##......#',
        '#.####.#####.##.#####.####.#',
        '#.####.#####.##.#####.####.#',
        '#......##....##....##......#',
        '######.##.########.##.######',
        '#......##..........##......#',
        '#..........................#',
        '############################',
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

  function mazeForLevel(level) {
    const i = ((Math.max(1, level) - 1) % LEVELS.length + LEVELS.length) % LEVELS.length;
    return LEVELS[i];
  }

  function cloneMaze(def) {
    return (def || LEVELS[0]).src.map(row => row.split(''));
  }

  function countPellets(grid) {
    let n = 0;
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        if (grid[y][x] === '.' || grid[y][x] === 'o') n += 1;
      }
    }
    return n;
  }

  function inGhostHouse(tx, ty) {
    return ty >= 12 && ty <= 15 && tx >= 10 && tx <= 17;
  }

  function isBlocked(grid, tx, ty, opts) {
    const ghost = !!opts?.ghost;
    const eyes = !!opts?.eyes;
    if (ty === 14 && (tx < 0 || tx >= COLS)) return false;
    if (ty < 0 || ty >= ROWS || tx < 0 || tx >= COLS) return true;
    const cell = grid[ty][tx];
    if (cell === '#' || cell === '_') return true;
    if (cell === '=' && !ghost && !eyes) return true;
    if (!ghost && !eyes && inGhostHouse(tx, ty)) return true;
    return false;
  }

  function opposite(dir) {
    if (!dir) return null;
    if (dir === DIRS.left) return DIRS.right;
    if (dir === DIRS.right) return DIRS.left;
    if (dir === DIRS.up) return DIRS.down;
    return DIRS.up;
  }

  const CENTER_EPS = 1e-4;

  function wrapTunnel(actor) {
    if (Math.floor(actor.y) !== 14) return;
    if (actor.x < -0.5) actor.x += COLS;
    if (actor.x >= COLS + 0.5) actor.x -= COLS;
  }

  function dist2(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
  }

  function renderBlock(source, fenceAttrs, options = {}) {
    void source;
    const cfg = parseFenceAttrs(fenceAttrs);
    const style = resolveStyle(cfg);
    const fullscreen = resolveFullscreen(cfg);
    const pacmanIndex = Number.isFinite(options.pacmanIndex) ? options.pacmanIndex : 0;
    const themeClass = style.theme ? ` pacman-block--${style.theme}` : '';
    const customClass = (style.colorCss || style.bgCss) ? ' pacman-block--custom' : '';
    const fullClass = fullscreen ? ' pacman-block--fullscreen' : '';
    const styleVars = [];
    if (style.colorCss) styleVars.push(`--pacman-accent:${style.colorCss}`);
    if (style.bgCss) styleVars.push(`--pacman-bg:${style.bgCss}`);
    const styleAttr = styleVars.length
      ? ` style="${styleVars.map(v => escapeHtml(v)).join(';')}"`
      : '';
    const title = String(cfg.title || 'Pac-Man').trim() || 'Pac-Man';
    const chrome = fullscreen ? '' : [
      `<div class="pacman-block-header">`,
      `<div class="pacman-block-title">${escapeHtml(title)}</div>`,
      `<div class="pacman-block-meta">${LEVELS.length} mazes</div>`,
      `</div>`,
      `<p class="pacman-block-hint">Click the maze · Arrows / WASD move · Space pause · R restart · Eat all pellets for the next maze</p>`,
    ].join('');

    return [
      `<div class="pacman-block${themeClass}${customClass}${fullClass}"${styleAttr}`,
      ` data-pacman-index="${pacmanIndex}"`,
      ` data-pacman-spec="{}" tabindex="0">`,
      renderFullscreenButton(),
      chrome,
      `<div class="pacman-stage">`,
      `<canvas class="pacman-canvas" width="${COLS * TILE}" height="${HUD + ROWS * TILE}" aria-label="${escapeHtml(title)}"></canvas>`,
      `</div>`,
      `<div class="pacman-pad" aria-label="Pac-Man direction pad">`,
      `<button type="button" class="pacman-pad__btn pacman-pad__btn--up" data-dir="up" tabindex="-1" aria-label="Up">▲</button>`,
      `<button type="button" class="pacman-pad__btn pacman-pad__btn--left" data-dir="left" tabindex="-1" aria-label="Left">◀</button>`,
      `<button type="button" class="pacman-pad__btn pacman-pad__btn--down" data-dir="down" tabindex="-1" aria-label="Down">▼</button>`,
      `<button type="button" class="pacman-pad__btn pacman-pad__btn--right" data-dir="right" tabindex="-1" aria-label="Right">▶</button>`,
      `</div>`,
      `<div class="pacman-status" aria-live="polite"></div>`,
      `</div>`,
    ].join('');
  }

  function createGame(el) {
    const canvas = el.querySelector('.pacman-canvas');
    const status = el.querySelector('.pacman-status');
    const pad = el.querySelector('.pacman-pad');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const state = {
      maze: mazeForLevel(1),
      grid: null,
      score: 0,
      lives: 3,
      level: 1,
      remaining: 0,
      combo: 0,
      paused: false,
      started: false,
      over: false,
      freeze: 1.6,
      message: 'READY!',
      fright: 0,
      mode: 'scatter',
      modeTime: 7,
      modeIndex: 0,
      pac: null,
      ghosts: [],
      mouth: 0,
      raf: 0,
      last: 0,
      running: true,
      visible: true,
    };

    const MODE_TIMES = [7, 20, 7, 20, 5, 20, 5, 1e9];

    function loadMaze() {
      state.maze = mazeForLevel(state.level);
      state.grid = cloneMaze(state.maze);
      state.remaining = countPellets(state.grid);
    }

    loadMaze();

    function pacSpeed() {
      return 9.2 + Math.min(2.4, (state.level - 1) * 0.28);
    }
    function ghostSpeed(g) {
      if (g.eyes) return 18;
      if (state.fright > 0 && !g.eyes) return 5.6;
      return 8.15 + Math.min(2.4, (state.level - 1) * 0.24);
    }

    function spawnPac() {
      return {
        x: 14.5,
        y: 23.5,
        dir: DIRS.left,
        next: DIRS.left,
        dead: 0,
      };
    }

    function spawnGhosts() {
      return [
        { name: 'blinky', color: '#ff3030', x: 14.5, y: 11.5, dir: DIRS.left, scatter: { x: 25, y: 0 }, home: false },
        { name: 'pinky', color: '#ff9be4', x: 14.5, y: 14.5, dir: DIRS.up, scatter: { x: 2, y: 0 }, home: true },
        { name: 'inky', color: '#00e5ff', x: 12.5, y: 14.5, dir: DIRS.up, scatter: { x: 27, y: 30 }, home: true },
        { name: 'clyde', color: '#ffb347', x: 15.5, y: 14.5, dir: DIRS.up, scatter: { x: 0, y: 30 }, home: true },
      ].map(g => Object.assign(g, { eyes: false, frightened: false }));
    }

    function resetActors(full) {
      state.pac = spawnPac();
      state.ghosts = spawnGhosts();
      state.fright = 0;
      state.combo = 0;
      state.freeze = full ? 0.35 : 1.3;
      state.message = 'READY!';
      if (full) {
        state.mode = 'scatter';
        state.modeIndex = 0;
        state.modeTime = MODE_TIMES[0];
      }
    }

    function restartGame() {
      state.score = 0;
      state.lives = 3;
      state.level = 1;
      state.over = false;
      state.paused = false;
      state.started = true;
      loadMaze();
      resetActors(true);
      setStatus('');
    }

    function setStatus(text) {
      if (status) status.textContent = text || '';
    }

    function setWanted(dir) {
      if (!dir) return;
      if (state.over) {
        restartGame();
        return;
      }
      state.started = true;
      if (state.paused) state.paused = false;
      state.pac.next = dir;
    }

    function keyToDir(event) {
      const k = event.key;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') return DIRS.left;
      if (k === 'ArrowRight' || k === 'd' || k === 'D') return DIRS.right;
      if (k === 'ArrowUp' || k === 'w' || k === 'W') return DIRS.up;
      if (k === 'ArrowDown' || k === 's' || k === 'S') return DIRS.down;
      return null;
    }

    function onKey(event) {
      if (state.over && (event.key === 'r' || event.key === 'R' || event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        restartGame();
        return;
      }
      if (event.key === 'r' || event.key === 'R') {
        event.preventDefault();
        restartGame();
        return;
      }
      if (event.key === ' ' || event.key === 'p' || event.key === 'P') {
        event.preventDefault();
        if (!state.over) {
          state.started = true;
          state.paused = !state.paused;
          state.message = state.paused ? 'PAUSED' : '';
        }
        return;
      }
      const dir = keyToDir(event);
      if (!dir) return;
      event.preventDefault();
      setWanted(dir);
    }

    function canMove(actor, dir, opts) {
      if (!dir) return false;
      const tx = Math.floor(actor.x) + dir.x;
      const ty = Math.floor(actor.y) + dir.y;
      return !isBlocked(state.grid, tx, ty, opts);
    }

    function distTowardCenter(actor, dir) {
      const cx = Math.floor(actor.x) + 0.5;
      const cy = Math.floor(actor.y) + 0.5;
      if (dir.x > 0) return cx - actor.x;
      if (dir.x < 0) return actor.x - cx;
      if (dir.y > 0) return cy - actor.y;
      if (dir.y < 0) return actor.y - cy;
      return 0;
    }

    function distToNextCenter(actor, dir) {
      const cx = Math.floor(actor.x) + 0.5;
      const cy = Math.floor(actor.y) + 0.5;
      if (dir.x > 0) return (cx + 1) - actor.x;
      if (dir.x < 0) return actor.x - (cx - 1);
      if (dir.y > 0) return (cy + 1) - actor.y;
      if (dir.y < 0) return actor.y - (cy - 1);
      return 0;
    }

    function moveActor(actor, speed, dt, opts, onCenter) {
      wrapTunnel(actor);
      if (actor.dir && actor.next === opposite(actor.dir)) {
        actor.dir = actor.next;
      }

      let remaining = speed * dt;
      for (let n = 0; n < 8 && remaining > CENTER_EPS; n += 1) {
        const cx = Math.floor(actor.x) + 0.5;
        const cy = Math.floor(actor.y) + 0.5;
        const centered = Math.abs(actor.x - cx) < CENTER_EPS && Math.abs(actor.y - cy) < CENTER_EPS;

        if (centered) {
          actor.x = cx;
          actor.y = cy;
          if (typeof onCenter === 'function') onCenter(actor);
          if (actor.next && canMove(actor, actor.next, opts)) actor.dir = actor.next;
          if (!actor.dir || !canMove(actor, actor.dir, opts)) {
            actor.dir = null;
            return;
          }
        }

        if (!actor.dir) return;
        if (actor.dir.x !== 0) actor.y = cy;
        else actor.x = cx;

        let toDecision = centered ? 1 : distTowardCenter(actor, actor.dir);
        if (toDecision < -CENTER_EPS) toDecision = distToNextCenter(actor, actor.dir);
        if (toDecision < CENTER_EPS) toDecision = distToNextCenter(actor, actor.dir);

        const step = Math.min(remaining, toDecision);
        actor.x += actor.dir.x * step;
        actor.y += actor.dir.y * step;
        remaining -= step;
        wrapTunnel(actor);

        const ncx = Math.floor(actor.x) + 0.5;
        const ncy = Math.floor(actor.y) + 0.5;
        if (Math.abs(actor.x - ncx) < 1e-6) actor.x = ncx;
        if (Math.abs(actor.y - ncy) < 1e-6) actor.y = ncy;
      }
    }

    function ghostTarget(g) {
      if (g.eyes) return { x: 14, y: 14 };
      if (g.home) return { x: 14, y: 11 };
      if (state.fright > 0) return null;
      if (state.mode === 'scatter') return g.scatter;
      const pac = state.pac;
      const px = Math.floor(pac.x);
      const py = Math.floor(pac.y);
      const pd = pac.dir || DIRS.left;
      if (g.name === 'blinky') return { x: px, y: py };
      if (g.name === 'pinky') {
        const ahead = pd === DIRS.up ? { x: px - 4, y: py - 4 } : { x: px + pd.x * 4, y: py + pd.y * 4 };
        return ahead;
      }
      if (g.name === 'inky') {
        const blinky = state.ghosts[0];
        const ax = px + pd.x * 2;
        const ay = py + pd.y * 2;
        return { x: ax * 2 - Math.floor(blinky.x), y: ay * 2 - Math.floor(blinky.y) };
      }
      const d = dist2(g.x, g.y, pac.x, pac.y);
      if (d > 64) return { x: px, y: py };
      return g.scatter;
    }

    function pickGhostDir(g) {
      const opts = { ghost: true, eyes: g.eyes };
      const target = ghostTarget(g);
      const reverse = opposite(g.dir);
      const choices = DIR_LIST.filter(dir => dir !== reverse && canMove(g, dir, opts));
      const any = DIR_LIST.filter(dir => canMove(g, dir, opts));
      const pool = choices.length ? choices : any;
      if (!pool.length) return reverse && canMove(g, reverse, opts) ? reverse : g.dir;
      if (!target || (state.fright > 0 && !g.eyes && !g.home)) {
        return pool[Math.floor(Math.random() * pool.length)];
      }
      let best = pool[0];
      let bestD = Infinity;
      pool.forEach(dir => {
        const nx = Math.floor(g.x) + dir.x;
        const ny = Math.floor(g.y) + dir.y;
        const d = dist2(nx, ny, target.x, target.y);
        if (d < bestD) {
          bestD = d;
          best = dir;
        }
      });
      return best;
    }

    function updateGhost(g, dt) {
      const opts = { ghost: true, eyes: g.eyes };
      if (g.home && !g.eyes) {
        if (Math.abs(g.x - 14.5) > 0.2) {
          g.dir = g.x < 14.5 ? DIRS.right : DIRS.left;
          g.next = g.dir;
        } else if (g.y > 11.5) {
          g.x = 14.5;
          g.dir = DIRS.up;
          g.next = DIRS.up;
        } else {
          g.home = false;
          g.dir = DIRS.left;
          g.next = DIRS.left;
          g.y = 11.5;
          g.x = 14.5;
        }
      }
      if (g.eyes && Math.floor(g.x) === 14 && Math.floor(g.y) >= 13 && Math.floor(g.y) <= 15) {
        g.eyes = false;
        g.home = true;
        g.x = 14.5;
        g.y = 14.5;
      }
      moveActor(g, ghostSpeed(g), dt, opts, () => {
        g.dir = pickGhostDir(g);
        g.next = g.dir;
      });
    }

    function eatAtPac() {
      const tx = Math.floor(state.pac.x);
      const ty = Math.floor(state.pac.y);
      if (ty < 0 || ty >= ROWS || tx < 0 || tx >= COLS) return;
      const cell = state.grid[ty][tx];
      if (cell === '.') {
        state.grid[ty][tx] = ' ';
        state.score += 10;
        state.remaining -= 1;
      } else if (cell === 'o') {
        state.grid[ty][tx] = ' ';
        state.score += 50;
        state.remaining -= 1;
        state.fright = Math.max(5.2, 6.4 - state.level * 0.35);
        state.combo = 0;
        state.ghosts.forEach((g) => {
          if (!g.eyes && !g.home) g.dir = opposite(g.dir) || g.dir;
        });
      }
      if (state.remaining <= 0) {
        state.level += 1;
        loadMaze();
        resetActors(true);
        state.message = `LEVEL ${state.level}  ${state.maze.name.toUpperCase()}`;
      }
    }

    function collideGhosts() {
      const pac = state.pac;
      for (let i = 0; i < state.ghosts.length; i += 1) {
        const g = state.ghosts[i];
        if (g.eyes) continue;
        if (dist2(pac.x, pac.y, g.x, g.y) > 0.55) continue;
        if (state.fright > 0) {
          g.eyes = true;
          g.home = false;
          state.combo += 1;
          state.score += 200 * (2 ** (state.combo - 1));
        } else {
          state.lives -= 1;
          if (state.lives <= 0) {
            state.over = true;
            state.message = 'GAME OVER';
            setStatus('Game over · R or tap to restart');
            return;
          }
          resetActors(false);
          return;
        }
      }
    }

    function updateModes(dt) {
      if (state.fright > 0) {
        state.fright -= dt;
        if (state.fright <= 0) {
          state.fright = 0;
          state.combo = 0;
        }
        return;
      }
      state.modeTime -= dt;
      if (state.modeTime > 0) return;
      state.modeIndex = Math.min(MODE_TIMES.length - 1, state.modeIndex + 1);
      state.mode = state.modeIndex % 2 === 0 ? 'scatter' : 'chase';
      state.modeTime = MODE_TIMES[state.modeIndex];
      state.ghosts.forEach((g) => {
        if (!g.home && !g.eyes) g.dir = opposite(g.dir) || g.dir;
      });
    }

    function tick(dt) {
      if (!state.started || state.paused || state.over) return;
      if (state.freeze > 0) {
        state.freeze -= dt;
        if (state.freeze <= 0) {
          state.freeze = 0;
          if (state.message === 'READY!' || String(state.message).startsWith('LEVEL')) state.message = '';
        }
        return;
      }
      updateModes(dt);
      state.pac.next = state.pac.next || state.pac.dir;
      moveActor(state.pac, pacSpeed(), dt, { ghost: false });
      eatAtPac();
      state.ghosts.forEach(g => updateGhost(g, dt));
      collideGhosts();
      state.mouth += dt * 18;
    }

    function mazeOrigin() {
      return { x: 0, y: HUD };
    }

    function drawWalls() {
      const o = mazeOrigin();
      const src = state.maze.src;
      ctx.fillStyle = state.maze.wall || '#151a6e';
      ctx.strokeStyle = state.maze.stroke || '#3d5bff';
      ctx.lineWidth = 1.5;
      for (let y = 0; y < ROWS; y += 1) {
        for (let x = 0; x < COLS; x += 1) {
          if (src[y][x] !== '#') continue;
          const px = o.x + x * TILE;
          const py = o.y + y * TILE;
          ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
          ctx.strokeRect(px + 2, py + 2, TILE - 4, TILE - 4);
        }
      }
      ctx.fillStyle = '#ffb4e6';
      for (let y = 0; y < ROWS; y += 1) {
        for (let x = 0; x < COLS; x += 1) {
          if (src[y][x] !== '=') continue;
          ctx.fillRect(o.x + x * TILE + 1, o.y + y * TILE + TILE * 0.42, TILE - 2, 3);
        }
      }
    }

    function drawPellets(t) {
      const o = mazeOrigin();
      for (let y = 0; y < ROWS; y += 1) {
        for (let x = 0; x < COLS; x += 1) {
          const cell = state.grid[y][x];
          const cx = o.x + x * TILE + TILE / 2;
          const cy = o.y + y * TILE + TILE / 2;
          if (cell === '.') {
            ctx.fillStyle = '#ffd9a0';
            ctx.beginPath();
            ctx.arc(cx, cy, 1.8, 0, Math.PI * 2);
            ctx.fill();
          } else if (cell === 'o') {
            const pulse = 4.2 + Math.sin(t * 6) * 1.1;
            ctx.fillStyle = '#ffe6c4';
            ctx.beginPath();
            ctx.arc(cx, cy, pulse, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }

    function drawPac(t) {
      const o = mazeOrigin();
      const p = state.pac;
      const cx = o.x + p.x * TILE;
      const cy = o.y + p.y * TILE;
      const bite = (Math.sin(state.mouth) * 0.5 + 0.5) * 0.42;
      let start = bite;
      let end = Math.PI * 2 - bite;
      const dir = p.dir || DIRS.left;
      let rot = 0;
      if (dir === DIRS.right) rot = 0;
      else if (dir === DIRS.down) rot = Math.PI / 2;
      else if (dir === DIRS.left) rot = Math.PI;
      else rot = -Math.PI / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.fillStyle = '#ffe500';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, TILE * 0.48, start, end);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      void t;
    }

    function drawGhost(g, t) {
      const o = mazeOrigin();
      const cx = o.x + g.x * TILE;
      const cy = o.y + g.y * TILE;
      const r = TILE * 0.46;
      if (g.eyes) {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(cx - 3.2, cy - 2, 3.1, 0, Math.PI * 2);
        ctx.arc(cx + 3.2, cy - 2, 3.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#2230c8';
        const px = (g.dir?.x || 0) * 1.2;
        const py = (g.dir?.y || 0) * 1.2;
        ctx.beginPath();
        ctx.arc(cx - 3.2 + px, cy - 2 + py, 1.4, 0, Math.PI * 2);
        ctx.arc(cx + 3.2 + px, cy - 2 + py, 1.4, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      const flashing = state.fright > 0 && state.fright < 2 && Math.floor(t * 8) % 2 === 0;
      ctx.fillStyle = state.fright > 0 ? (flashing ? '#eef6ff' : '#2230c8') : g.color;
      ctx.beginPath();
      ctx.arc(cx, cy - 1, r, Math.PI, 0);
      ctx.lineTo(cx + r, cy + r * 0.75);
      for (let i = 3; i >= 0; i -= 1) {
        const wx = cx - r + (i + 0.5) * (r * 2 / 4);
        ctx.quadraticCurveTo(wx, cy + r * 1.15, cx - r + i * (r * 2 / 4), cy + r * 0.75);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(cx - 3.3, cy - 2.4, 2.8, 0, Math.PI * 2);
      ctx.arc(cx + 3.3, cy - 2.4, 2.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = state.fright > 0 ? '#fff' : '#2230c8';
      const px = (g.dir?.x || 0) * 1.1;
      const py = (g.dir?.y || 0) * 1.1;
      ctx.beginPath();
      ctx.arc(cx - 3.3 + px, cy - 2.4 + py, 1.35, 0, Math.PI * 2);
      ctx.arc(cx + 3.3 + px, cy - 2.4 + py, 1.35, 0, Math.PI * 2);
      ctx.fill();
    }

    function drawHud() {
      ctx.fillStyle = '#fff6d7';
      ctx.font = 'bold 13px ui-monospace, Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`SCORE ${state.score}`, 8, 22);
      ctx.textAlign = 'center';
      ctx.fillText(`LVL ${state.level} ${state.maze.name}`, (COLS * TILE) / 2, 22);
      ctx.textAlign = 'right';
      ctx.fillText(`❤ ${Math.max(0, state.lives)}`, COLS * TILE - 8, 22);
    }

    function drawOverlay() {
      if (!state.message && state.started && !state.paused && !state.over) return;
      const text = state.over
        ? 'GAME OVER'
        : (state.paused ? 'PAUSED' : (state.message || 'READY!'));
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, HUD + TILE * 12, COLS * TILE, TILE * 4);
      ctx.fillStyle = text === 'GAME OVER' ? '#ff5a5a' : '#ffe500';
      ctx.font = 'bold 22px ui-monospace, Consolas, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(text, (COLS * TILE) / 2, HUD + TILE * 14.4);
      if (!state.started || state.over) {
        ctx.fillStyle = '#d6e4ff';
        ctx.font = '11px ui-sans-serif, sans-serif';
        ctx.fillText(state.over ? 'Press R or tap to play again' : 'Click, then use arrows', (COLS * TILE) / 2, HUD + TILE * 15.6);
      }
    }

    function draw(t) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, COLS * TILE, HUD + ROWS * TILE);
      drawHud();
      drawWalls();
      drawPellets(t);
      state.ghosts.forEach(g => drawGhost(g, t));
      if (!state.over) drawPac(t);
      drawOverlay();
    }

    function fitCanvas() {
      const logicalW = COLS * TILE;
      const logicalH = HUD + ROWS * TILE;
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      canvas.width = Math.round(logicalW * dpr);
      canvas.height = Math.round(logicalH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
    }

    function loop(now) {
      if (!state.running) return;
      if (!state.last) {
        state.last = now;
        if (state.visible) draw(now / 1000);
        state.raf = requestAnimationFrame(loop);
        return;
      }
      const t = now / 1000;
      const dt = Math.min(0.033, (now - state.last) / 1000);
      state.last = now;
      if (state.visible) {
        tick(dt);
        draw(t);
      }
      state.raf = requestAnimationFrame(loop);
    }

    function syncPad() {
      if (!pad) return;
      const mobile = parentIsMobile();
      el.classList.toggle('pacman-block--mobile', mobile);
      pad.classList.toggle('is-visible', mobile);
    }

    function bindPad() {
      if (!pad) return;
      pad.querySelectorAll('[data-dir]').forEach((btn) => {
        const dir = DIRS[btn.getAttribute('data-dir')];
        const press = (event) => {
          event.preventDefault();
          el.focus({ preventScroll: true });
          setWanted(dir);
        };
        btn.addEventListener('pointerdown', press);
        btn.addEventListener('click', press);
        btn.addEventListener('contextmenu', (event) => event.preventDefault());
      });
    }

    function onSwipe(event) {
      if (!start) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.abs(dx) < 18 && Math.abs(dy) < 18) return;
      if (Math.abs(dx) > Math.abs(dy)) setWanted(dx > 0 ? DIRS.right : DIRS.left);
      else setWanted(dy > 0 ? DIRS.down : DIRS.up);
      start = null;
    }
    let start = null;
    function onPointerDown(event) {
      if (event.target.closest?.('.pacman-pad')) return;
      start = { x: event.clientX, y: event.clientY };
      el.focus({ preventScroll: true });
      if (state.over) restartGame();
    }

    resetActors(true);
    fitCanvas();
    syncPad();
    bindPad();
    el.addEventListener('keydown', onKey);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onSwipe);
    canvas.addEventListener('pointercancel', () => { start = null; });
    const onResize = () => {
      fitCanvas();
      syncPad();
    };
    window.addEventListener('resize', onResize);
    const io = new IntersectionObserver((entries) => {
      state.visible = entries.some(e => e.isIntersecting);
    }, { threshold: 0.05 });
    io.observe(el);
    bindFullscreenButton(el);
    state.raf = requestAnimationFrame(loop);

    return {
      destroy() {
        state.running = false;
        cancelAnimationFrame(state.raf);
        el.removeEventListener('keydown', onKey);
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointerup', onSwipe);
        window.removeEventListener('resize', onResize);
        io.disconnect();
      },
    };
  }

  function hydrateBlock(el) {
    if (!el) return;
    if (el._pacmanGame?.destroy) el._pacmanGame.destroy();
    el._pacmanGame = createGame(el);
  }

  function hydrate(root) {
    (root || document).querySelectorAll('.pacman-block[data-pacman-spec]').forEach(hydrateBlock);
  }

  return {
    parseFenceAttrs,
    renderBlock,
    hydrate,
    hydrateBlock,
  };
}));
