/** HP-42S-style scientific RPN block. Uses the shared HP scientific engine. */
(function (root, factory) {
  const base = root.NotesProHp15c || (typeof require === 'function' ? require('./hp15c.js') : null);
  const api = factory(base);
  root.NotesProHp42s = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (base) {
  'use strict';
  const sessions = new Map();
  // Each key supplies explicit engine strokes for its primary and shifted functions.
  const keys = [
    ['sigma', 'Σ+', 'Σ−', ['sigma'], ['g', 'sigma']],
    ['inv', '1/x', 'yˣ', ['inv'], ['pow']],
    ['sqrt', '√x', 'x²', ['sqrt'], ['g', 'sqrt']],
    ['log', 'LOG', '10ˣ', ['g', 'exp10'], ['exp10']],
    ['ln', 'LN', 'eˣ', ['g', 'exp'], ['exp']],
    ['xeq', 'XEQ', 'GTO', ['gsb'], ['gto']],
    ['sto', 'STO', 'COMPLEX', ['sto'], ['f', 'tan']],
    ['rcl', 'RCL', '%', ['rcl'], ['g', 'pow']],
    ['rdown', 'R↓', 'π', ['rdown'], ['g', 'eex']],
    ['sin', 'SIN', 'ASIN', ['sin'], ['g', 'sin']],
    ['cos', 'COS', 'ACOS', ['cos'], ['g', 'cos']],
    ['tan', 'TAN', 'ATAN', ['tan'], ['g', 'tan']],
    ['enter', 'ENTER', 'ALPHA', ['enter'], 'alpha'],
    ['swap', 'x⇄y', 'LAST x', ['swap'], ['g', 'enter']],
    ['chs', '+/−', 'MODES', ['chs'], 'modes'],
    ['eex', 'E', 'DISP', ['eex'], 'disp'],
    ['bsp', '⬅', 'CLEAR', ['bsp'], 'clear'],
    ['up', '▲', 'BST', ['g', 'sst'], ['g', 'sst']],
    ['7', '7', 'SOLVER', ['7'], ['f', 'div']],
    ['8', '8', '∫ f(x)', ['8'], ['f', 'mul']],
    ['9', '9', 'MATRIX', ['9'], 'matrix'],
    ['div', '÷', 'STAT', ['div'], 'stat'],
    ['down', '▼', 'SST', ['sst'], ['sst']],
    ['4', '4', 'BASE', ['4'], 'base'],
    ['5', '5', 'CONVERT', ['5'], 'convert'],
    ['6', '6', 'FLAGS', ['6'], 'flags'],
    ['mul', '×', 'PROB', ['mul'], 'prob'],
    ['shift', '▧', '', [], []],
    ['1', '1', 'ASSIGN', ['1'], 'assign'],
    ['2', '2', 'CUSTOM', ['2'], 'custom'],
    ['3', '3', 'PGM.FCN', ['3'], 'program'],
    ['sub', '−', 'PRINT', ['sub'], 'print'],
    ['on', 'EXIT', 'OFF', [], []],
    ['0', '0', 'TOP.FCN', ['0'], 'top'],
    ['dot', '•', 'SHOW', ['dot'], 'show'],
    ['rs', 'R/S', 'PRGM', ['rs'], ['g', 'rs']],
    ['add', '+', 'CATALOG', ['add'], 'catalog'],
  ];
  const menus = {
    modes: [['DEG', ['g','7']], ['RAD', ['g','8']], ['GRAD', ['g','9']]],
    disp: [['FIX', ['f','7']], ['SCI', ['f','8']], ['ENG', ['f','9']]],
    clear: [['CLX', ['g','bsp']], ['CLΣ', ['f','gsb']], ['CL REG', ['f','swap']], ['CL PRGM', ['f','rdown']]],
    stat: [['Σ+', ['sigma']], ['Σ−', ['g','sigma']], ['MEAN', ['g','0']], ['SDEV', ['g','dot']], ['L.R.', ['f','sigma']]],
    program: [['LBL', ['f','sst']], ['RTN', ['g','gsb']], ['GTO', ['gto']], ['XEQ', ['gsb']]],
    flags: [['SF', ['g','4']], ['CF', ['g','5']], ['F?', ['g','6']]],
    prob: [['x!', ['f','0']], ['nPr', ['f','add']], ['nCr', ['g','add']], ['RAN', ['f','enter']]],
    convert: [['→POL', ['g','1']], ['→REC', ['f','1']], ['→HMS', ['f','2']], ['→HR', ['g','2']], ['→DEG', ['g','3']], ['→RAD', ['f','3']]],
    top: [['ABS', ['g','chs']], ['1/x', ['inv']], ['√x', ['sqrt']]],
  };
  menus.catalog = [...menus.disp, ...menus.modes, ...menus.prob];
  const byKey = new Map(keys.map(k => [k[0], k]));
  function escapeHtml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function createState() { const s = base.createState(); s.hp42Shift = false; s.hp42Menu = null; return s; }
  function press(s, key) {
    if (key === 'shift') {
      if (s.on && !s.error) s.hp42Shift = !s.hp42Shift;
      return s;
    }
    if (key === 'on') {
      if (!s.on || s.hp42Shift) base.press(s, 'on');
      else { s.pending = null; s.message = null; s.error = null; }
      s.hp42Menu = null; s.hp42Shift = false;
      return s;
    }
    let strokes;
    if (key.startsWith('menu:')) {
      strokes = menus[s.hp42Menu]?.[Number(key.slice(5))]?.[1];
      s.hp42Menu = null;
      if (!strokes) return s;
    } else {
      const spec = byKey.get(key);
      if (!spec) return s;
      strokes = spec[s.hp42Shift ? 4 : 3];
    }
    s.hp42Shift = false;
    if (typeof strokes === 'string') {
      if (!s.on) return s;
      if (s.error) { s.error = null; return s; }
      s.hp42Menu = menus[strokes] ? strokes : null;
      s.message = strokes === 'show' ? String(s.re[0]) : menus[strokes] ? null : strokes.toUpperCase() + ' unavailable';
      return s;
    }
    // An error consumes one key, even when a function uses several engine strokes.
    if (!s.on || s.error) return base.press(s, strokes[strokes.length - 1]);
    s.hp42Menu = null;
    for (const stroke of strokes) base.press(s, stroke);
    return s;
  }
  function renderBlock(content, attrs, options = {}) {
    const cfg = base.parseFenceAttrs(attrs);
    const full = !/^(0|false|no|compact)$/i.test(String(cfg.fullscreen ?? cfg.full ?? '1'));
    const raw = String(cfg.size ?? '100%');
    let size = parseFloat(raw);
    if (!Number.isFinite(size) || size <= 0) size = 100;
    if (!raw.includes('%') && size <= 1) size *= 100;
    size = Math.max(10, Math.min(100, size));
    const index = Number.isFinite(options.hp42sIndex) ? options.hp42sIndex : 0;
    const button = (k, index) => {
      const [id, face, shifted] = k;
      const extra = id === 'enter' ? ' hp42-enter' : id === 'shift' ? ' hp42-shift' : id === 'on' ? ' hp42-exit' : index >= 17 ? ' hp42-number' : '';
      return '<div class="hp42-slot' + extra + '"><span class="hp42-shift-label">' + escapeHtml(shifted) + '</span><button type="button" class="hp42-key" data-key="' + id + '" title="' + escapeHtml(face + (shifted ? ' · ⇧ ' + shifted : '')) + '" aria-label="' + escapeHtml(id === 'shift' ? 'Orange shift' : face + (shifted ? ', shift ' + shifted : '')) + '"><span>' + escapeHtml(face) + '</span></button>' + (id === 'on' ? '<span class="hp42-on-label">ON</span>' : '') + '</div>';
    };
    return '<div class="hp42s-block' + (full ? ' hp42s-block--fullscreen' : '') + '" style="--calc-size:' + size + '%" data-hp42-index="' + index + '" tabindex="0" aria-label="' + escapeHtml(cfg.title || 'HP-42S calculator') + '">'
      + (globalThis.NotesProGameFullscreen?.renderButton?.() || '')
      + '<div class="hp42-body"><div class="hp42-maker"><span class="hp42-emblem">hp</span><span>HEWLETT<br>PACKARD</span></div>'
      + '<div class="hp42-display-panel"><div class="hp42-brand"><span>' + escapeHtml(cfg.title || '42S') + '</span><small>RPN SCIENTIFIC</small></div>'
      + '<div class="hp42-lcd-frame"><div class="hp42-lcd" aria-live="polite"><div data-role="status"></div><div class="hp42-line"><span>Y:</span><output data-role="y"></output></div><div class="hp42-line"><span>X:</span><output data-role="x"></output></div><div class="hp42-menu" data-role="menu"></div></div></div></div>'
      + '<div class="hp42-keypad"><div class="hp42-top">' + keys.slice(0, 12).map(button).join('') + '</div>'
      + '<div class="hp42-middle">' + keys.slice(12, 17).map(button).join('') + '</div>'
      + '<div class="hp42-bottom">' + keys.slice(17).map((k, i) => button(k, i + 17)).join('') + '</div></div></div></div>';
  }

  function paint(el, s) {
    const view = base.readout(s);
    const y = base.formatParts(s.re[1], s.mode, s.digits);
    el.querySelector('[data-role="y"]').textContent = s.on ? y.man + (y.exp || '') : '';
    el.querySelector('[data-role="x"]').textContent = s.on ? view.man + (view.exp || '') : '';
    el.querySelector('[data-role="status"]').textContent = s.on ? [s.hp42Shift ? '⇧' : '', s.angle.toUpperCase(), s.prgm ? 'PRGM' : '', s.complex ? 'CPX' : '', view.ann.pend || '', view.imag || ''].filter(Boolean).join('  ') : '';
    const menu = el.querySelector('[data-role="menu"]');
    menu.innerHTML = s.on && s.hp42Menu ? menus[s.hp42Menu].map((item, i) => '<button type="button" data-key="menu:' + i + '">' + escapeHtml(item[0]) + '</button>').join('') : '';
    el.querySelector('[data-key="shift"]').setAttribute('aria-pressed', String(s.hp42Shift));
  }
  function hydrateBlock(el) {
    if (!el || el.dataset.hp42Ready === '1') return;
    el.dataset.hp42Ready = '1';
    const id = el.dataset.hp42Index || '0';
    if (!sessions.has(id)) sessions.set(id, createState());
    const s = sessions.get(id);
    const act = key => { press(s, key); paint(el, s); };
    el.addEventListener('click', e => {
      const button = e.target.closest?.('[data-key]');
      if (!button || !el.contains(button)) return;
      e.preventDefault(); act(button.dataset.key);
    });
    el.addEventListener('keydown', e => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape' && (document.fullscreenElement === el || el.classList.contains('game-block--monitor-fullscreen'))) return;
      // Let the browser activate a focused button with Enter or Space.
      if (e.target.closest?.('button') && (e.key === 'Enter' || e.key === ' ')) return;
      const map = {Enter:'enter', Backspace:'bsp', Escape:'on', ArrowUp:'up', ArrowDown:'down', '+':'add', '-':'sub', '*':'mul', '/':'div', '.':'dot', ',':'dot', f:'shift', e:'eex'};
      const key = /^[0-9]$/.test(e.key) ? e.key : map[e.key];
      if (!key) return;
      e.preventDefault(); e.stopPropagation(); act(key);
    });
    globalThis.NotesProGameFullscreen?.bind?.(el);
    paint(el, s);
  }
  return { createState, press, readout: base.readout, renderBlock, hydrateBlock, parseFenceAttrs: base.parseFenceAttrs };
}));

// Run with node notes/static/notes/hp42s.js.
if (typeof module !== 'undefined' && require.main === module) {
  const api = module.exports;
  const assert = require('node:assert/strict');
  const run = keys => { const s = api.createState(); keys.forEach(k => api.press(s, k)); return s; };
  const near = (keys, expected) => assert.ok(Math.abs(run(keys).re[0] - expected) < 1e-8, keys.join(' '));
  near(['2','enter','3','enter','4','mul','add'], 14);
  near(['1','0','0','log'], 2);
  near(['9','shift','sqrt'], 81);
  near(['3','0','sin'], 0.5);
  near(['1','shift','sin'], 90);
  near(['4','2','sto','1','0','rcl','1'], 42);
  near(['shift','rs','shift','3','menu:0','1','2','mul','shift','3','menu:1','shift','rs','3','xeq','1'], 6);
  near(['shift','chs','menu:1','shift','rdown','2','div','sin'], 1);
  assert.equal(run(['shift','eex','menu:0','2']).digits, 2);
  const off = run(['shift','on']);
  assert.equal(off.on, false);
  api.press(off, 'on');
  assert.equal(off.on, true);
  const error = run(['1','enter','0','div']);
  assert.ok(error.error);
  api.press(error, 'log');
  assert.equal(error.error, null);
  assert.equal(error.shift, null);
  const html = api.renderBlock('', 'title=<script>;size=0.8', {hp42sIndex: 2});
  assert.ok(html.includes('&lt;script&gt;') && html.includes('--calc-size:80%') && html.includes('data-hp42-index="2"'));
  assert.ok(!api.renderBlock('', 'fullscreen=0').includes('hp42s-block--fullscreen'));
  assert.notEqual(api.createState(), api.createState());
  console.log('hp42s self-test ok');
}
