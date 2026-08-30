/**
 * NotesPro ```sudoku``` block — interactive 9×9 puzzle in preview.
 */
(function (root, factory) {
  const api = factory();
  root.NotesProSudoku = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];
  const DIFFICULTY_CLUES = { easy: 40, medium: 32, hard: 26 };
  const CLASSIC_PUZZLE = [
    5, 3, 0, 0, 7, 0, 0, 0, 0,
    6, 0, 0, 1, 9, 5, 0, 0, 0,
    0, 9, 8, 0, 0, 0, 0, 6, 0,
    8, 0, 0, 0, 6, 0, 0, 0, 3,
    4, 0, 0, 8, 0, 3, 0, 0, 1,
    7, 0, 0, 0, 2, 0, 0, 0, 6,
    0, 6, 0, 0, 0, 0, 2, 8, 0,
    0, 0, 0, 4, 1, 9, 0, 0, 5,
    0, 0, 0, 0, 8, 0, 0, 7, 9,
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

  function seededRandom(seed) {
    let s = (Number(seed) || 1) >>> 0;
    return function rng() {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function boxStart(index) {
    const row = Math.floor(index / 9);
    const col = index % 9;
    return Math.floor(row / 3) * 27 + Math.floor(col / 3) * 3;
  }

  function isValidPlacement(grid, index, digit) {
    const row = Math.floor(index / 9);
    const col = index % 9;
    for (let c = 0; c < 9; c += 1) {
      if (grid[row * 9 + c] === digit) return false;
    }
    for (let r = 0; r < 9; r += 1) {
      if (grid[r * 9 + col] === digit) return false;
    }
    const start = boxStart(index);
    for (let i = 0; i < 9; i += 1) {
      const pos = start + Math.floor(i / 3) * 9 + (i % 3);
      if (grid[pos] === digit) return false;
    }
    return true;
  }

  function solveGrid(grid, limit = 1) {
    let count = 0;
    function dfs() {
      let empty = -1;
      for (let i = 0; i < 81; i += 1) {
        if (grid[i] === 0) {
          empty = i;
          break;
        }
      }
      if (empty < 0) {
        count += 1;
        return count >= limit;
      }
      for (let digit = 1; digit <= 9; digit += 1) {
        if (!isValidPlacement(grid, empty, digit)) continue;
        grid[empty] = digit;
        if (dfs()) return true;
        grid[empty] = 0;
      }
      return false;
    }
    dfs();
    return count;
  }

  function fillBox(grid, boxRow, boxCol, rng) {
    const digits = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rng);
    let n = 0;
    for (let r = 0; r < 3; r += 1) {
      for (let c = 0; c < 3; c += 1) {
        grid[(boxRow + r) * 9 + (boxCol + c)] = digits[n++];
      }
    }
  }

  function generateSolvedGrid(rng) {
    const grid = Array(81).fill(0);
    for (let box = 0; box < 9; box += 3) {
      fillBox(grid, box, box, rng);
    }
    solveGrid(grid, 1);
    return grid;
  }

  function generatePuzzle(difficulty, seed) {
    const rng = seededRandom(seed || Date.now());
    const solved = generateSolvedGrid(rng);
    const puzzle = solved.slice();
    const clues = DIFFICULTY_CLUES[difficulty] || DIFFICULTY_CLUES.medium;
    const indices = shuffle([...Array(81).keys()], rng);
    let removed = 0;
    for (const i of indices) {
      if (removed >= 81 - clues) break;
      puzzle[i] = 0;
      removed += 1;
    }
    return { puzzle, solution: solved };
  }

  function parseDigit(token) {
    const t = String(token || '').trim();
    if (!t || t === '.' || t === '_' || t === '-' || t === '0') return 0;
    const n = parseInt(t, 10);
    return Number.isFinite(n) && n >= 1 && n <= 9 ? n : 0;
  }

  function parsePuzzleSource(source) {
    const text = String(source || '').trim();
    if (!text) return null;

    const withoutState = stripStateSection(text);
    const bodyText = withoutState.puzzleText;

    const compact = bodyText.replace(/\s+/g, '');
    if (/^[0-9._-]{81}$/.test(compact)) {
      return compact.split('').map(parseDigit);
    }

    const grid = Array(81).fill(0);
    const lines = bodyText.split(/\r?\n/);
    let row = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      if (/^[-+|=]+$/.test(trimmed.replace(/\s/g, ''))) continue;
      const tokens = trimmed.split(/[\s|,]+/).filter(Boolean);
      if (!tokens.length) continue;
      if (row >= 9) break;
      for (let col = 0; col < 9; col += 1) {
        grid[row * 9 + col] = parseDigit(tokens[col]);
      }
      row += 1;
    }
    if (row === 0) return null;
    return grid;
  }

  function stripStateSection(text) {
    const lines = String(text || '').split(/\r?\n/);
    const puzzleLines = [];
    let stateText = '';
    let inState = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!inState && /^state\s*[:=]/i.test(trimmed)) {
        inState = true;
        stateText += trimmed.replace(/^state\s*[:=]\s*/i, '');
        continue;
      }
      if (inState) {
        if (!trimmed) continue;
        if (/^state\s*[:=]/i.test(trimmed)) {
          stateText += trimmed.replace(/^state\s*[:=]\s*/i, '');
        } else if (/^[0-9._\-.\s|]+$/.test(trimmed)) {
          stateText += trimmed;
        } else {
          inState = false;
          puzzleLines.push(line);
        }
        continue;
      }
      puzzleLines.push(line);
    }
    return {
      puzzleText: puzzleLines.join('\n').trim(),
      stateText: stateText.trim(),
    };
  }

  function parseStateString(raw) {
    const compact = String(raw || '').replace(/\s+/g, '');
    if (compact.length !== 81) return null;
    return compact.split('').map(ch => {
      if (ch === '.' || ch === '_' || ch === '-') return 0;
      const n = parseInt(ch, 10);
      return Number.isFinite(n) && n >= 0 && n <= 9 ? n : 0;
    });
  }

  function parseStateFromSource(source, cfg) {
    const fromAttr = parseStateString(cfg?.state || '');
    if (fromAttr) return fromAttr;
    const stripped = stripStateSection(source);
    if (!stripped.stateText) return null;
    const compact = stripped.stateText.replace(/\s+/g, '');
    if (compact.length === 81) return parseStateString(compact);
    const grid = Array(81).fill(0);
    const lines = stripped.stateText.split(/\r?\n/).filter(l => l.trim());
    let row = 0;
    for (const line of lines) {
      const tokens = line.trim().split(/[\s|,]+/).filter(Boolean);
      if (!tokens.length || row >= 9) break;
      for (let col = 0; col < 9; col += 1) {
        grid[row * 9 + col] = parseDigit(tokens[col]);
      }
      row += 1;
    }
    return row > 0 ? grid : null;
  }

  function mergeGivensAndState(givens, state) {
    const values = givens.slice();
    if (!state) return values;
    for (let i = 0; i < 81; i += 1) {
      if (givens[i] > 0) continue;
      if (state[i] > 0) values[i] = state[i];
    }
    return values;
  }

  function serializeState(values, givens) {
    return values.map((v, i) => {
      if (givens[i] > 0) return '.';
      return v > 0 ? String(v) : '.';
    }).join('');
  }

  function formatPuzzleBody(puzzle) {
    const rows = [];
    for (let r = 0; r < 9; r += 1) {
      const cells = [];
      for (let c = 0; c < 9; c += 1) {
        const v = puzzle[r * 9 + c];
        cells.push(v > 0 ? String(v) : '.');
      }
      rows.push(cells.join(' '));
    }
    return rows.join('\n');
  }

  function buildFenceAttrsString(cfg, stateStr) {
    const parts = [];
    Object.entries(cfg || {}).forEach(([key, value]) => {
      if (key === 'state') return;
      if (value == null || value === '') return;
      parts.push(`${key}=${value}`);
    });
    const compactState = String(stateStr || '');
    if (compactState && compactState.replace(/\./g, '').length) {
      parts.push(`state=${compactState}`);
    }
    return parts.join(';');
  }

  function resolvePuzzle(source, cfg) {
    const parsed = parsePuzzleSource(source);
    if (parsed) {
      const working = parsed.slice();
      const solution = parsed.slice();
      if (!solveGrid(solution, 1)) {
        return { error: 'Puzzle has no valid solution.' };
      }
      return { puzzle: parsed, solution };
    }
    const difficulty = String(cfg.difficulty || cfg.level || 'medium').trim().toLowerCase();
    const seed = cfg.seed != null && cfg.seed !== '' ? cfg.seed : Date.now();
    if (String(cfg.sample || '').toLowerCase() === 'classic') {
      const solution = CLASSIC_PUZZLE.slice();
      solveGrid(solution, 1);
      return { puzzle: CLASSIC_PUZZLE.slice(), solution };
    }
    return generatePuzzle(difficulty, seed);
  }

  function gridToData(grid) {
    return grid.map(v => (v ? String(v) : '0')).join('');
  }

  function dataToGrid(raw) {
    return String(raw || '').split('').map(ch => {
      const n = parseInt(ch, 10);
      return Number.isFinite(n) && n >= 1 && n <= 9 ? n : 0;
    });
  }

  function cellClasses(index) {
    const row = Math.floor(index / 9);
    const col = index % 9;
    const classes = ['sudoku-cell'];
    if (col % 3 === 2 && col !== 8) classes.push('sudoku-cell--box-right');
    if (row % 3 === 2 && row !== 8) classes.push('sudoku-cell--box-bottom');
    return classes.join(' ');
  }

  function renderGridCells(values, givens) {
    return values.map((value, index) => {
      const given = givens[index] > 0;
      const display = given ? givens[index] : value;
      const label = `Row ${Math.floor(index / 9) + 1}, column ${(index % 9) + 1}`;
      return `<button type="button" class="${cellClasses(index)}${given ? ' sudoku-cell--given' : ''}"`
        + ` data-idx="${index}" aria-label="${escapeHtml(label)}"${given ? ' disabled' : ''}>`
        + (display > 0 ? String(display) : '')
        + `</button>`;
    }).join('');
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

  function renderBlock(source, fenceAttrs, options = {}) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const style = resolveStyle(cfg);
    const title = String(cfg.title || 'Sudoku').trim() || 'Sudoku';
    const resolved = resolvePuzzle(source, cfg);
    if (resolved.error) {
      return `<div class="sudoku-block sudoku-block--error">${escapeHtml(resolved.error)}</div>`;
    }
    const givens = resolved.puzzle;
    const state = parseStateFromSource(source, cfg);
    const values = mergeGivensAndState(givens, state);
    const sudokuIndex = Number.isFinite(options.sudokuIndex) ? options.sudokuIndex : 0;
    const editable = options.editable !== false;
    const fullscreen = resolveFullscreen(cfg);
    const themeClass = style.theme ? ` sudoku-block--${style.theme}` : '';
    const customClass = (style.colorCss || style.bgCss) ? ' sudoku-block--custom' : '';
    const fullClass = fullscreen ? ' sudoku-block--fullscreen' : '';
    const styleVars = [];
    if (style.colorCss) styleVars.push(`--sudoku-accent:${style.colorCss}`);
    if (style.bgCss) styleVars.push(`--sudoku-bg:${style.bgCss}`);
    const styleAttr = styleVars.length
      ? ` style="${styleVars.map(v => escapeHtml(v)).join(';')}"`
      : '';
    const chrome = fullscreen ? '' : [
      `<div class="sudoku-block-header">`,
      `<div class="sudoku-block-title">${escapeHtml(title)}</div>`,
      `<div class="sudoku-block-meta">${escapeHtml(String(cfg.difficulty || cfg.level || (source.trim() ? 'custom' : 'medium')).trim())}</div>`,
      `</div>`,
    ].join('');
    return [
      `<div class="sudoku-block${themeClass}${customClass}${fullClass}${editable ? ' sudoku-block--editable' : ''}"${styleAttr}`
      + ` data-sudoku-index="${sudokuIndex}"`
      + ` data-sudoku-givens="${escapeHtml(gridToData(givens))}"`
      + ` data-sudoku-solution="${escapeHtml(gridToData(resolved.solution))}">`,
      renderFullscreenButton(),
      chrome,
      `<div class="sudoku-play-area">`,
      `<div class="sudoku-grid" role="grid" aria-label="${escapeHtml(title)}">${renderGridCells(values, givens)}</div>`,
      `<div class="sudoku-numpad" aria-label="Number pad">`,
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
        `<button type="button" class="sudoku-num" data-num="${n}">${n}</button>`
      )).join(''),
      `<button type="button" class="sudoku-num sudoku-num--erase" data-num="0" title="Erase">⌫</button>`,
      `</div>`,
      `<div class="sudoku-actions">`,
      `<button type="button" class="btn btn-sm btn-outline-light sudoku-action" data-action="check">Check</button>`,
      `<button type="button" class="btn btn-sm btn-outline-secondary sudoku-action" data-action="clear">Clear</button>`,
      `</div>`,
      `</div>`,
      `<div class="sudoku-status" aria-live="polite"></div>`,
      `</div>`,
    ].join('');
  }

  function setStatus(el, text, kind) {
    const status = el.querySelector('.sudoku-status');
    if (!status) return;
    status.textContent = text || '';
    status.className = 'sudoku-status' + (kind ? ` sudoku-status--${kind}` : '');
  }

  function paintGrid(el, values, givens, options = {}) {
    el.querySelectorAll('.sudoku-cell').forEach(cell => {
      const idx = parseInt(cell.dataset.idx, 10);
      const value = values[idx];
      const given = givens[idx] > 0;
      cell.textContent = value > 0 ? String(value) : '';
      cell.classList.toggle('sudoku-cell--selected', options.selected === idx);
      cell.classList.toggle('sudoku-cell--error', !!(options.errors && options.errors[idx]));
      cell.classList.toggle('sudoku-cell--match', !!(options.matches && options.matches[idx]));
      if (!given) cell.disabled = false;
    });
  }

  function findConflicts(values, index, digit) {
    const conflicts = {};
    if (!digit) return conflicts;
    const row = Math.floor(index / 9);
    const col = index % 9;
    for (let c = 0; c < 9; c += 1) {
      const i = row * 9 + c;
      if (i !== index && values[i] === digit) conflicts[i] = true;
    }
    for (let r = 0; r < 9; r += 1) {
      const i = r * 9 + col;
      if (i !== index && values[i] === digit) conflicts[i] = true;
    }
    const start = boxStart(index);
    for (let i = 0; i < 9; i += 1) {
      const pos = start + Math.floor(i / 3) * 9 + (i % 3);
      if (pos !== index && values[pos] === digit) conflicts[pos] = true;
    }
    return conflicts;
  }

  function hydrateBlock(el, options = {}) {
    if (!el || el.dataset.sudokuHydrated === '1') return;
    el.dataset.sudokuHydrated = '1';
    bindFullscreenButton(el);

    const givens = dataToGrid(el.dataset.sudokuGivens);
    const solution = dataToGrid(el.dataset.sudokuSolution);
    const values = givens.slice();
    el.querySelectorAll('.sudoku-cell').forEach(cell => {
      const idx = parseInt(cell.dataset.idx, 10);
      if (givens[idx] > 0) return;
      const text = cell.textContent.trim();
      if (text) values[idx] = parseInt(text, 10) || 0;
    });
    let selected = -1;
    let persistTimer = null;

    function schedulePersist() {
      if (typeof options.onPersist !== 'function') return;
      clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        options.onPersist({
          values: values.slice(),
          givens: givens.slice(),
          puzzle: givens.slice(),
        });
      }, 450);
    }

    function refresh(options = {}) {
      paintGrid(el, values, givens, { selected, ...options });
    }

    function selectCell(index) {
      if (index < 0 || index > 80 || givens[index] > 0) return;
      selected = index;
      refresh();
    }

    function setDigit(digit) {
      if (selected < 0 || givens[selected] > 0) return;
      values[selected] = digit >= 1 && digit <= 9 ? digit : 0;
      const conflicts = digit ? findConflicts(values, selected, digit) : {};
      refresh({ errors: conflicts });
      schedulePersist();
      if (Object.keys(conflicts).length) {
        setStatus(el, 'Conflict in row, column, or box.', 'warn');
        return;
      }
      setStatus(el, '');
      const complete = values.every((v, i) => v === solution[i]);
      if (complete) setStatus(el, 'Solved!', 'success');
    }

    el.querySelector('.sudoku-grid')?.addEventListener('click', e => {
      const cell = e.target.closest('.sudoku-cell');
      if (!cell || cell.disabled) return;
      selectCell(parseInt(cell.dataset.idx, 10));
    });

    el.querySelector('.sudoku-numpad')?.addEventListener('click', e => {
      const btn = e.target.closest('.sudoku-num');
      if (!btn) return;
      setDigit(parseInt(btn.dataset.num, 10));
    });

    el.querySelector('.sudoku-actions')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'clear') {
        for (let i = 0; i < 81; i += 1) {
          if (!givens[i]) values[i] = 0;
        }
        setStatus(el, '');
        refresh();
        schedulePersist();
        return;
      }
      if (action === 'check') {
        const errors = {};
        const matches = {};
        let wrong = 0;
        let empty = 0;
        for (let i = 0; i < 81; i += 1) {
          if (givens[i]) continue;
          if (!values[i]) {
            empty += 1;
            continue;
          }
          if (values[i] !== solution[i]) {
            errors[i] = true;
            wrong += 1;
          } else {
            matches[i] = true;
          }
        }
        refresh({ errors, matches });
        if (wrong) setStatus(el, `${wrong} incorrect cell${wrong === 1 ? '' : 's'}.`, 'warn');
        else if (empty) setStatus(el, `${empty} empty cell${empty === 1 ? '' : 's'} remaining.`, 'info');
        else setStatus(el, 'Solved!', 'success');
      }
    });

    el.addEventListener('keydown', e => {
      if (!el.contains(document.activeElement) && selected < 0) return;
      if (e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        setDigit(parseInt(e.key, 10));
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
        e.preventDefault();
        setDigit(0);
        return;
      }
      if (selected >= 0 && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const row = Math.floor(selected / 9);
        const col = selected % 9;
        let next = selected;
        if (e.key === 'ArrowUp') next = Math.max(0, (row - 1) * 9 + col);
        if (e.key === 'ArrowDown') next = Math.min(80, (row + 1) * 9 + col);
        if (e.key === 'ArrowLeft') next = row * 9 + Math.max(0, col - 1);
        if (e.key === 'ArrowRight') next = row * 9 + Math.min(8, col + 1);
        selectCell(next);
      }
    });

    el.tabIndex = 0;
    refresh();
  }

  function hydrate(root) {
    (root || document).querySelectorAll('.sudoku-block[data-sudoku-givens]').forEach(hydrateBlock);
  }

  return {
    parseFenceAttrs,
    parsePuzzleSource,
    parseStateString,
    mergeGivensAndState,
    serializeState,
    formatPuzzleBody,
    buildFenceAttrsString,
    renderBlock,
    hydrate,
    hydrateBlock,
  };
}));
