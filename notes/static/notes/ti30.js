/**
 * NotesPro ```ti30``` block — algebraic scientific calculator in the TI-30 layout.
 * Aliases: ti-30, ti30xa. Immediate unary functions and AOS precedence.
 */
(function (root, factory) {
  const api = factory();
  root.NotesProTi30 = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SESSIONS = new Map();

  const KEYS = [
    ['onc', 'ON/C', '', '', 1, 1, 'on'],
    ['shift', '2nd', '', '', 1, 2, '2nd'],
    ['drg', 'DRG', '', '', 1, 3],
    ['pi', 'π', '', '', 1, 4],
    ['sq', 'x²', '√x', '', 1, 5],
    ['sin', 'sin', 'sin⁻¹', '', 2, 1],
    ['cos', 'cos', 'cos⁻¹', '', 2, 2],
    ['tan', 'tan', 'tan⁻¹', '', 2, 3],
    ['log', 'log', '10ˣ', '', 2, 4],
    ['ln', 'ln', 'eˣ', '', 2, 5],
    ['ee', 'EE', '', '', 3, 1],
    ['lpar', '(', '', '', 3, 2],
    ['rpar', ')', '', '', 3, 3],
    ['inv', '1/x', '', '', 3, 4],
    ['div', '÷', '', '', 3, 5, 'op'],
    ['7', '7', '', '', 4, 1, 'num'],
    ['8', '8', '', '', 4, 2, 'num'],
    ['9', '9', '', '', 4, 3, 'num'],
    ['yx', 'yˣ', '', '', 4, 4],
    ['mul', '×', '', '', 4, 5, 'op'],
    ['4', '4', '', '', 5, 1, 'num'],
    ['5', '5', '', '', 5, 2, 'num'],
    ['6', '6', '', '', 5, 3, 'num'],
    ['sto', 'STO', '', '', 5, 4],
    ['sub', '−', '', '', 5, 5, 'op'],
    ['1', '1', '', '', 6, 1, 'num'],
    ['2', '2', '', '', 6, 2, 'num'],
    ['3', '3', '', '', 6, 3, 'num'],
    ['rcl', 'RCL', '', '', 6, 4],
    ['add', '+', '', '', 6, 5, 'op'],
    ['0', '0', '', '', 7, 1, 'num'],
    ['dot', '·', 'FIX', '', 7, 2, 'num'],
    ['chs', '+/−', '', '', 7, 3],
    ['bsp', '←', '', '', 7, 4],
    ['eq', '=', '', '', 7, 5, 'eq'],
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
    String(attrs || '').split(';').forEach((pair) => {
      const trimmed = pair.trim();
      if (!trimmed) return;
      const eq = trimmed.indexOf('=');
      if (eq < 0) config[trimmed.toLowerCase()] = '';
      else config[trimmed.slice(0, eq).trim().toLowerCase()] = trimmed.slice(eq + 1).trim();
    });
    return config;
  }

  function createState() {
    return {
      on: true,
      x: 0,
      entry: null,
      fresh: true,
      ops: [],
      vals: [],
      shift: false,
      angle: 'deg',
      digits: null,
      pending: null,
      regs: {},
      error: null,
      paren: 0,
    };
  }

  function fail(state, code) {
    state.error = code || 'Error';
    state.entry = null;
    state.pending = null;
    state.ops = [];
    state.vals = [];
    state.paren = 0;
    state.fresh = true;
  }

  function entryValue(entry) {
    let man = entry.man === '' || entry.man === '.' || entry.man === '0.' ? '0' : entry.man;
    if (man.endsWith('.')) man = man.slice(0, -1) || '0';
    let value = parseFloat(man || '0');
    if (entry.neg) value = -value;
    if (entry.exp != null && entry.exp !== '') {
      let exp = parseInt(entry.exp, 10) || 0;
      if (entry.expNeg) exp = -exp;
      value *= 10 ** exp;
    }
    return Number.isFinite(value) ? value : 0;
  }

  function commit(state) {
    if (state.entry) {
      state.x = entryValue(state.entry);
      state.entry = null;
    }
  }

  function startEntry(state) {
    state.entry = { man: '', exp: null, expNeg: false, neg: state.x < 0 && !state.fresh ? false : false };
    state.fresh = false;
  }

  function digit(state, d) {
    if (state.fresh || !state.entry) startEntry(state);
    const entry = state.entry;
    if (entry.exp != null) entry.exp = (entry.exp + d).slice(0, 2);
    else if (entry.man.replace('.', '').length < 10) {
      entry.man = entry.man === '0' ? d : entry.man + d;
    }
    state.fresh = false;
  }

  function dot(state) {
    if (state.fresh || !state.entry) startEntry(state);
    const entry = state.entry;
    if (entry.exp != null) return;
    if (!entry.man.includes('.')) entry.man = entry.man ? `${entry.man}.` : '0.';
  }

  function chs(state) {
    if (state.entry) {
      if (state.entry.exp != null) state.entry.expNeg = !state.entry.expNeg;
      else state.entry.neg = !state.entry.neg;
      return;
    }
    state.x = -state.x;
  }

  function toRad(value, angle) {
    if (angle === 'rad') return value;
    if (angle === 'grad') return value * Math.PI / 200;
    return value * Math.PI / 180;
  }

  function fromRad(value, angle) {
    if (angle === 'rad') return value;
    if (angle === 'grad') return value * 200 / Math.PI;
    return value * 180 / Math.PI;
  }

  function setX(state, value) {
    if (!Number.isFinite(value)) {
      fail(state, 'Error');
      return;
    }
    state.x = value;
    state.entry = null;
    state.fresh = true;
  }

  function prec(op) {
    if (op === 'yx') return 3;
    if (op === 'mul' || op === 'div') return 2;
    if (op === 'add' || op === 'sub') return 1;
    return 0;
  }

  function applyTop(state) {
    const op = state.ops.pop();
    const left = state.vals.pop();
    const right = state.x;
    let value = NaN;
    if (op === 'add') value = left + right;
    else if (op === 'sub') value = left - right;
    else if (op === 'mul') value = left * right;
    else if (op === 'div') value = right === 0 ? NaN : left / right;
    else if (op === 'yx') value = left ** right;
    if (!Number.isFinite(value)) {
      fail(state, 'Error');
      return false;
    }
    state.x = value;
    return true;
  }

  function pushOp(state, op) {
    commit(state);
    if (state.error) return;
    while (state.ops.length && state.ops[state.ops.length - 1] !== '(' && prec(state.ops[state.ops.length - 1]) >= prec(op)) {
      if (!applyTop(state)) return;
    }
    state.vals.push(state.x);
    state.ops.push(op);
    state.fresh = true;
    state.entry = null;
  }

  function equals(state) {
    commit(state);
    if (state.error) return;
    while (state.ops.length) {
      if (state.ops[state.ops.length - 1] === '(') {
        fail(state, 'Error');
        return;
      }
      if (!applyTop(state)) return;
    }
    state.fresh = true;
    state.entry = null;
    state.paren = 0;
  }

  function openParen(state) {
    state.ops.push('(');
    state.paren += 1;
    state.fresh = true;
    state.entry = null;
  }

  function closeParen(state) {
    commit(state);
    if (state.error) return;
    while (state.ops.length && state.ops[state.ops.length - 1] !== '(') {
      if (!applyTop(state)) return;
    }
    if (state.ops[state.ops.length - 1] !== '(') {
      fail(state, 'Error');
      return;
    }
    state.ops.pop();
    state.paren = Math.max(0, state.paren - 1);
    state.fresh = true;
    state.entry = null;
  }

  function unary(state, fn) {
    commit(state);
    if (state.error) return;
    setX(state, fn(state.x));
  }

  function handlePending(state, key) {
    const pending = state.pending;
    state.pending = null;
    if (!/^[0-9]$/.test(key)) return;
    if (pending === 'fix') {
      state.digits = parseInt(key, 10);
      return;
    }
    if (pending === 'sto') {
      commit(state);
      state.regs[key] = state.x;
      state.fresh = true;
      return;
    }
    if (pending === 'rcl') {
      state.x = state.regs[key] || 0;
      state.entry = null;
      state.fresh = true;
    }
  }

  function clear(state) {
    if (state.error || (state.fresh && !state.entry && state.x === 0 && !state.ops.length)) {
      Object.assign(state, createState());
      return;
    }
    state.x = 0;
    state.entry = null;
    state.fresh = true;
    state.error = null;
    if (!state.ops.length) return;
    state.ops = [];
    state.vals = [];
    state.paren = 0;
  }

  function backspace(state) {
    if (!state.entry) {
      state.x = 0;
      state.fresh = true;
      return;
    }
    const entry = state.entry;
    if (entry.exp != null) {
      if (entry.exp) entry.exp = entry.exp.slice(0, -1);
      else entry.exp = null;
      return;
    }
    entry.man = entry.man.slice(0, -1);
    if (!entry.man) {
      state.entry = null;
      state.x = 0;
      state.fresh = true;
    }
  }

  function dispatch(state, key, shifted) {
    if (shifted && key === 'dot') {
      state.pending = 'fix';
      return;
    }
    if (/^[0-9]$/.test(key)) {
      digit(state, key);
      return;
    }
    const trig = {
      sin: [Math.sin, Math.asin],
      cos: [Math.cos, Math.acos],
      tan: [Math.tan, Math.atan],
    };
    if (trig[key]) {
      const [fwd, inv] = trig[key];
      if (shifted) unary(state, (x) => fromRad(inv(x), state.angle));
      else unary(state, (x) => fwd(toRad(x, state.angle)));
      return;
    }
    const actions = {
      onc: () => clear(state),
      drg: () => {
        state.angle = state.angle === 'deg' ? 'rad' : state.angle === 'rad' ? 'grad' : 'deg';
      },
      pi: () => setX(state, Math.PI),
      sq: () => unary(state, shifted ? Math.sqrt : (x) => x * x),
      log: () => unary(state, shifted ? (x) => 10 ** x : Math.log10),
      ln: () => unary(state, shifted ? Math.exp : Math.log),
      ee: () => {
        if (state.fresh || !state.entry) startEntry(state);
        if (state.entry.exp == null) state.entry.exp = '';
      },
      lpar: () => openParen(state),
      rpar: () => closeParen(state),
      inv: () => unary(state, (x) => 1 / x),
      div: () => pushOp(state, 'div'),
      yx: () => pushOp(state, 'yx'),
      mul: () => pushOp(state, 'mul'),
      sto: () => { state.pending = 'sto'; },
      sub: () => pushOp(state, 'sub'),
      rcl: () => { state.pending = 'rcl'; },
      add: () => pushOp(state, 'add'),
      dot: () => dot(state),
      chs: () => chs(state),
      bsp: () => backspace(state),
      eq: () => equals(state),
    };
    const action = actions[key];
    if (action) action();
  }

  function press(state, key) {
    if (!state.on) {
      if (key === 'onc') state.on = true;
      return state;
    }
    if (state.error) {
      if (key === 'onc') clear(state);
      else state.error = null;
      return state;
    }
    if (key === 'shift') {
      state.shift = !state.shift;
      return state;
    }
    const shifted = state.shift;
    state.shift = false;
    if (state.pending) {
      handlePending(state, key);
      return state;
    }
    dispatch(state, key, shifted);
    return state;
  }

  function formatNumber(value, digits) {
    if (!Number.isFinite(value)) return 'Error';
    if (value === 0) return digits == null ? '0' : (0).toFixed(digits);
    const abs = Math.abs(value);
    if (digits != null && abs >= 1e-9 && abs < 1e10) return value.toFixed(digits);
    if (abs >= 1e10 || abs < 1e-9) {
      const exp = Math.floor(Math.log10(abs));
      const man = value / 10 ** exp;
      return `${man.toFixed(6)}e${exp >= 0 ? '+' : ''}${exp}`;
    }
    const text = value.toPrecision(10);
    if (/e/i.test(text)) return text;
    return String(parseFloat(text));
  }

  function formatEntry(entry) {
    const sign = entry.neg ? '-' : '';
    const man = entry.man === '' ? '0' : entry.man;
    let exp = '';
    if (entry.exp != null) exp = `e${entry.expNeg ? '-' : ''}${entry.exp || '0'}`;
    return sign + man + exp;
  }

  function statusText(state) {
    if (!state.ops.length && !state.paren) return '';
    const bits = [];
    state.ops.forEach((op, index) => {
      if (op === '(') bits.push('(');
      else bits.push(String(state.vals[index] ?? ''));
    });
    if (state.paren) bits.push(')');
    return bits.join(' ').replace(/\s+/g, ' ').trim();
  }

  function readout(state) {
    if (!state.on) return { man: '', ann: {}, status: '' };
    if (state.error) return { man: state.error, ann: annunciators(state), status: '' };
    const man = state.entry ? formatEntry(state.entry) : formatNumber(state.x, state.digits);
    return { man, ann: annunciators(state), status: statusText(state) };
  }

  function annunciators(state) {
    let pend = '';
    if (state.pending === 'sto') pend = 'STO';
    else if (state.pending === 'rcl') pend = 'RCL';
    else if (state.pending === 'fix') pend = 'FIX';
    return {
      shift: state.shift,
      deg: state.angle === 'deg',
      rad: state.angle === 'rad',
      grad: state.angle === 'grad',
      pend,
    };
  }

  function resolveFullscreen(cfg) {
    const raw = String(cfg.fullscreen ?? cfg.full ?? '1').trim().toLowerCase();
    if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'compact') return false;
    return true;
  }

  function renderBlock(content, fenceAttrs, options = {}) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const title = String(cfg.title || 'TI-30').trim() || 'TI-30';
    const index = Number.isFinite(options.ti30Index) ? options.ti30Index : 0;
    const fullscreen = resolveFullscreen(cfg);
    const fullClass = fullscreen ? ' ti30-block--fullscreen' : '';
    const keys = KEYS.map((spec) => {
      const [id, face, gold, , row, col, kind] = spec;
      const style = `grid-row:${row};grid-column:${col}`;
      const classes = ['hp-slot', kind ? `hp-slot--${kind}` : ''].filter(Boolean).join(' ');
      const tip = [gold ? `2nd ${gold}` : '', face].filter(Boolean).join(' · ');
      return `<div class="${classes}" style="${style}">`
        + `<div class="hp-f">${escapeHtml(gold)}</div>`
        + `<button type="button" class="hp-key${kind ? ` hp-key--${kind}` : ''}" data-key="${id}" title="${escapeHtml(tip)}" aria-label="${escapeHtml(tip)}">`
        + `<span class="hp-face">${escapeHtml(face)}</span>`
        + '</button></div>';
    }).join('');
    const fsButton = (typeof globalThis !== 'undefined' && globalThis.NotesProGameFullscreen?.renderButton?.()) || '';
    return `<div class="ti30-block${fullClass}" data-ti30-index="${index}" tabindex="0">`
      + fsButton
      + '<div class="hp-bezel">'
      + `<div class="hp-badge">${escapeHtml(title)}</div>`
      + '<div class="hp-tag">scientific</div>'
      + '</div>'
      + '<div class="hp-lcd" data-role="lcd">'
      + '<div class="hp-ann">'
      + '<span data-ann="shift">2nd</span><span data-ann="deg">DEG</span><span data-ann="rad">RAD</span><span data-ann="grad">GRAD</span>'
      + '<span data-ann="pend" class="hp-pend"></span>'
      + '</div>'
      + '<div class="hp-lcd-body">'
      + '<div class="hp-stack" data-role="stack"></div>'
      + '<div class="hp-readout"><div class="hp-value"><span data-role="man"></span></div></div>'
      + '</div></div>'
      + `<div class="hp-keys">${keys}</div>`
      + '</div>';
  }

  function paint(el, state) {
    const view = readout(state);
    const lcd = el.querySelector('[data-role="lcd"]');
    lcd.classList.toggle('is-off', !state.on);
    el.querySelector('[data-role="man"]').textContent = view.man;
    const stack = el.querySelector('[data-role="stack"]');
    if (stack) stack.textContent = state.on && !state.error ? (view.status || '') : '';
    ['shift', 'deg', 'rad', 'grad'].forEach((name) => {
      const node = el.querySelector(`[data-ann="${name}"]`);
      if (node) node.classList.toggle('is-on', !!view.ann[name]);
    });
    const pend = el.querySelector('[data-ann="pend"]');
    if (pend) pend.textContent = view.ann.pend || '';
  }

  function hydrateBlock(el) {
    if (!el || el.dataset.tiReady === '1') return;
    el.dataset.tiReady = '1';
    const key = `ti30:${el.dataset.ti30Index || '0'}`;
    if (!SESSIONS.has(key)) SESSIONS.set(key, createState());
    const state = SESSIONS.get(key);
    const onKey = (name) => {
      press(state, name);
      paint(el, state);
    };
    el.addEventListener('click', (event) => {
      const btn = event.target.closest?.('[data-key]');
      if (!btn || !el.contains(btn)) return;
      event.preventDefault();
      onKey(btn.dataset.key);
    });
    globalThis.NotesProGameFullscreen?.bind?.(el);
    el.addEventListener('keydown', (event) => {
      const monitorFull = document.fullscreenElement === el
        || el.classList.contains('game-block--monitor-fullscreen');
      if (event.key === 'Escape' && monitorFull) return;
      const map = {
        Enter: 'eq',
        '=': 'eq',
        Backspace: 'bsp',
        Escape: 'onc',
        '+': 'add',
        '-': 'sub',
        '*': 'mul',
        '/': 'div',
        '.': 'dot',
        '(': 'lpar',
        ')': 'rpar',
        s: 'sin',
        c: 'cos',
        t: 'tan',
      };
      let name = map[event.key];
      if (!name && /^[0-9]$/.test(event.key)) name = event.key;
      if (!name) return;
      event.preventDefault();
      event.stopPropagation();
      onKey(name);
    });
    paint(el, state);
  }

  return {
    createState,
    press,
    readout,
    renderBlock,
    hydrateBlock,
    parseFenceAttrs,
  };
}));

if (typeof module !== 'undefined' && require.main === module) {
  const api = module.exports;
  const near = (a, b, msg) => {
    if (!Number.isFinite(a) || Math.abs(a - b) > 1e-6) throw new Error(`${msg}: ${a} != ${b}`);
  };
  const run = (keys) => {
    const state = api.createState();
    keys.forEach((key) => api.press(state, key));
    return state;
  };
  near(run(['2', 'add', '3', 'mul', '4', 'eq']).x, 14, 'precedence');
  near(run(['lpar', '2', 'add', '3', 'rpar', 'mul', '4', 'eq']).x, 20, 'parens');
  near(run(['3', '0', 'sin']).x, 0.5, 'sin 30');
  near(run(['2', 'sq']).x, 4, 'square');
  near(run(['9', 'shift', 'sq']).x, 3, 'sqrt');
  near(run(['2', 'sto', '1', '0', 'rcl', '1']).x, 2, 'sto rcl');
  const html = api.renderBlock('', 'title=TI-30');
  if (!html.includes('ti30-block--fullscreen') || !html.includes('data-key="eq"') || !html.includes('sin⁻¹')) {
    throw new Error('render');
  }
  const compact = api.renderBlock('', 'fullscreen=0');
  if (compact.includes('ti30-block--fullscreen')) throw new Error('compact fullscreen');
  console.log('ti30 self-test ok');
}
