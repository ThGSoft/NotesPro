/**
 * NotesPro ```hp15c``` block — RPN scientific calculator in the HP-15C layout.
 * Stack, shifts, complex numbers, storage, statistics, and keystroke programs.
 */
(function (root, factory) {
  const api = factory();
  root.NotesProHp15c = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SESSIONS = new Map();
  const LIVE = new Set(['prgm', 'sst', 'bst', 'bsp', 'clprefix', 'on']);
  const TOP_LABEL = { sqrt: 'A', exp: 'B', exp10: 'C', pow: 'D', inv: 'E' };
  const LANCZOS = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];

  const KEYS = [
    ['sqrt', '√x', 'A', 'x²', 1, 1],
    ['exp', 'eˣ', 'B', 'LN', 1, 2],
    ['exp10', '10ˣ', 'C', 'LOG', 1, 3],
    ['pow', 'yˣ', 'D', '%', 1, 4],
    ['inv', '1/x', 'E', 'Δ%', 1, 5],
    ['chs', 'CHS', 'MATRIX', 'ABS', 1, 6],
    ['7', '7', 'FIX', 'DEG', 1, 7, 'num'],
    ['8', '8', 'SCI', 'RAD', 1, 8, 'num'],
    ['9', '9', 'ENG', 'GRD', 1, 9, 'num'],
    ['div', '÷', 'SOLVE', 'x≤y', 1, 10, 'op'],
    ['sst', 'SST', 'LBL', 'BST', 2, 1],
    ['gto', 'GTO', 'HYP', 'HYP⁻¹', 2, 2],
    ['sin', 'SIN', 'DIM', 'SIN⁻¹', 2, 3],
    ['cos', 'COS', '(i)', 'COS⁻¹', 2, 4],
    ['tan', 'TAN', 'I', 'TAN⁻¹', 2, 5],
    ['eex', 'EEX', 'RESULT', 'π', 2, 6],
    ['4', '4', 'x⇄', 'SF', 2, 7, 'num'],
    ['5', '5', 'DSE', 'CF', 2, 8, 'num'],
    ['6', '6', 'ISG', 'F?', 2, 9, 'num'],
    ['mul', '×', '∫', 'x=0', 2, 10, 'op'],
    ['rs', 'R/S', 'PSE', 'P/R', 3, 1],
    ['gsb', 'GSB', 'CLΣ', 'RTN', 3, 2],
    ['rdown', 'R↓', 'CLPRGM', 'R↑', 3, 3],
    ['swap', 'x⇄y', 'CLREG', 'RND', 3, 4],
    ['bsp', '←', 'PREFIX', 'CLx', 3, 5],
    ['enter', 'ENTER', 'RAN#', 'LSTx', 3, 6, 'enter', 2],
    ['1', '1', '→R', '→P', 3, 7, 'num'],
    ['2', '2', '→H.MS', '→H', 3, 8, 'num'],
    ['3', '3', '→RAD', '→DEG', 3, 9, 'num'],
    ['sub', '−', 'Re⇄Im', 'TEST', 3, 10, 'op'],
    ['on', 'ON', '', '', 4, 1, 'on'],
    ['f', 'f', '', '', 4, 2, 'f'],
    ['g', 'g', '', '', 4, 3, 'g'],
    ['sto', 'STO', 'FRAC', 'INT', 4, 4],
    ['rcl', 'RCL', 'USER', 'MEM', 4, 5],
    ['0', '0', 'x!', 'x̄', 4, 7, 'num'],
    ['dot', '·', 'ŷ,r', 's', 4, 8, 'num'],
    ['sigma', 'Σ+', 'L.R.', 'Σ−', 4, 9],
    ['add', '+', 'Py,x', 'Cy,x', 4, 10, 'op'],
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
      re: [0, 0, 0, 0],
      im: [0, 0, 0, 0],
      lastRe: 0,
      lastIm: 0,
      lift: true,
      entry: null,
      shift: null,
      pending: null,
      mode: 'fix',
      digits: 4,
      angle: 'deg',
      complex: false,
      user: false,
      prgm: false,
      viewImag: false,
      skip: false,
      flags: [false, false, false, false, false, false, false, false, false, false],
      regs: {},
      program: [],
      pc: 0,
      ret: [],
      error: null,
      message: null,
      depth: 0,
      rand: 123456789,
    };
  }

  function cx(state, i = 0) {
    return { re: state.re[i], im: state.complex ? state.im[i] : 0 };
  }

  function liftStack(state) {
    state.re[3] = state.re[2];
    state.im[3] = state.im[2];
    state.re[2] = state.re[1];
    state.im[2] = state.im[1];
    state.re[1] = state.re[0];
    state.im[1] = state.im[0];
  }

  function dropStack(state) {
    state.re[1] = state.re[2];
    state.im[1] = state.im[2];
    state.re[2] = state.re[3];
    state.im[2] = state.im[3];
  }

  function remember(state) {
    state.lastRe = state.re[0];
    state.lastIm = state.im[0];
  }

  function setX(state, z) {
    if (!z || !Number.isFinite(z.re) || !Number.isFinite(z.im || 0)) {
      state.error = 'Error 0';
      return;
    }
    let re = z.re;
    let im = z.im || 0;
    if (Math.abs(re) >= 1e100 || Math.abs(im) >= 1e100) {
      state.flags[9] = true;
      re = Math.sign(re) * Math.min(Math.abs(re), 9.999999999e99);
      im = Math.sign(im) * Math.min(Math.abs(im), 9.999999999e99);
    } else if (re !== 0 && Math.abs(re) < 1e-99) re = 0;
    if (im !== 0 && Math.abs(im) < 1e-99) im = 0;
    state.re[0] = re;
    state.im[0] = im;
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

  function closeEntry(state) {
    if (!state.entry) return;
    state.re[0] = entryValue(state.entry);
    state.entry = null;
  }

  function startEntry(state) {
    if (state.lift) {
      liftStack(state);
      state.im[0] = 0;
      state.re[0] = 0;
    }
    state.lift = false;
    if (!state.entry) state.entry = { man: '', exp: null, expNeg: false, neg: false };
  }

  function digit(state, d) {
    startEntry(state);
    const entry = state.entry;
    if (entry.exp != null) {
      entry.exp = (entry.exp + d).slice(0, 2);
    } else {
      const digits = entry.man.replace('.', '').length;
      if (digits >= 10) return;
      entry.man = entry.man === '0' ? d : entry.man + d;
    }
    state.re[0] = entryValue(entry);
  }

  function dot(state) {
    startEntry(state);
    const entry = state.entry;
    if (entry.exp != null) return;
    if (entry.man.includes('.')) return;
    entry.man = entry.man ? `${entry.man}.` : '0.';
    state.re[0] = entryValue(entry);
  }

  function chs(state) {
    if (state.entry) {
      if (state.entry.exp != null) state.entry.expNeg = !state.entry.expNeg;
      else state.entry.neg = !state.entry.neg;
      state.re[0] = entryValue(state.entry);
      return;
    }
    state.re[0] = -state.re[0];
    state.lift = true;
  }

  function eex(state) {
    if (!state.entry) {
      startEntry(state);
      state.entry.man = '1';
    }
    if (state.entry.exp == null) state.entry.exp = '';
    state.re[0] = entryValue(state.entry);
  }

  function backspace(state) {
    const entry = state.entry;
    if (!entry) {
      state.re[0] = 0;
      state.lift = false;
      return;
    }
    if (entry.exp != null) {
      if (entry.exp.length) entry.exp = entry.exp.slice(0, -1);
      else entry.exp = null;
      state.re[0] = entryValue(entry);
      return;
    }
    entry.man = entry.man.slice(0, -1);
    if (!entry.man) {
      state.entry = null;
      state.re[0] = 0;
      state.lift = false;
      return;
    }
    state.re[0] = entryValue(entry);
  }

  function gamma(z) {
    if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
    z -= 1;
    let x = LANCZOS[0];
    for (let i = 1; i < LANCZOS.length; i += 1) x += LANCZOS[i] / (z + i);
    const t = z + LANCZOS.length - 1.5;
    return Math.sqrt(2 * Math.PI) * (t ** (z + 0.5)) * Math.exp(-t) * x;
  }

  function factorial(n) {
    if (!Number.isFinite(n) || n < 0) throw new Error('math');
    if (Math.abs(n - Math.round(n)) < 1e-10) {
      const k = Math.round(n);
      if (k > 170) throw new Error('math');
      let r = 1;
      for (let i = 2; i <= k; i += 1) r *= i;
      return r;
    }
    return gamma(n + 1);
  }

  function cadd(a, b) { return { re: a.re + b.re, im: a.im + b.im }; }
  function csub(a, b) { return { re: a.re - b.re, im: a.im - b.im }; }
  function cmul(a, b) {
    return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
  }
  function cdiv(a, b) {
    const d = b.re * b.re + b.im * b.im;
    if (!d) throw new Error('math');
    return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
  }
  function csqrt(a) {
    if (!a.re && !a.im) return { re: 0, im: 0 };
    const m = Math.hypot(a.re, a.im);
    const re = Math.sqrt((m + a.re) / 2);
    let im = Math.sqrt((m - Math.min(a.re, m)) / 2);
    if (a.im < 0) im = -im;
    return { re, im };
  }
  function cln(a) {
    const m = Math.hypot(a.re, a.im);
    if (!m) throw new Error('math');
    return { re: Math.log(m), im: Math.atan2(a.im, a.re) };
  }
  function cexp(a) {
    const e = Math.exp(a.re);
    return { re: e * Math.cos(a.im), im: e * Math.sin(a.im) };
  }
  function csin(a) {
    return { re: Math.sin(a.re) * Math.cosh(a.im), im: Math.cos(a.re) * Math.sinh(a.im) };
  }
  function ccos(a) {
    return { re: Math.cos(a.re) * Math.cosh(a.im), im: -Math.sin(a.re) * Math.sinh(a.im) };
  }
  function ctan(a) { return cdiv(csin(a), ccos(a)); }
  function cpow(y, x) { return cexp(cmul(x, cln(y))); }

  function toRad(v, angle) {
    if (angle === 'deg') return v * Math.PI / 180;
    if (angle === 'grad') return v * Math.PI / 200;
    return v;
  }
  function fromRad(v, angle) {
    if (angle === 'deg') return v * 180 / Math.PI;
    if (angle === 'grad') return v * 200 / Math.PI;
    return v;
  }

  function realUnary(state, fn) {
    closeEntry(state);
    remember(state);
    const z = cx(state);
    if (state.complex && z.im) throw new Error('math');
    setX(state, { re: fn(z.re), im: 0 });
    state.lift = true;
  }

  function anyUnary(state, realFn, complexFn) {
    closeEntry(state);
    remember(state);
    const z = cx(state);
    const out = state.complex ? complexFn(z) : { re: realFn(z.re), im: 0 };
    setX(state, out);
    state.lift = true;
  }

  function binary(state, realFn, complexFn) {
    closeEntry(state);
    remember(state);
    const x = cx(state, 0);
    const y = cx(state, 1);
    const out = state.complex ? complexFn(y, x) : { re: realFn(y.re, x.re), im: 0 };
    dropStack(state);
    setX(state, out);
    state.lift = true;
  }

  function enableComplex(state) {
    state.complex = true;
    state.flags[8] = true;
  }

  function slotOf(state, name) {
    if (name === '(i)') {
      const n = Math.trunc(state.regs.I || 0);
      if (n >= 0 && n <= 9) return String(n);
      if (n >= 10 && n <= 19) return `.${n - 10}`;
      return null;
    }
    return name;
  }

  function labelOf(state, label) {
    if (label !== 'I') return label;
    const n = Math.trunc(state.regs.I || 0);
    if (n >= 0 && n <= 9) return String(n);
    if (n >= 10 && n <= 14) return 'ABCDE'[n - 10];
    return null;
  }

  function findLabel(state, label) {
    const name = labelOf(state, label);
    if (name == null) return -1;
    return state.program.findIndex((ins) => ins.op === 'lbl' && ins.label === name);
  }

  function insertIns(state, ins) {
    state.program.splice(state.pc, 0, ins);
    state.pc += 1;
    if (state.program.length > 320) {
      state.program.length = 320;
      state.error = 'Error 4';
    }
  }

  function formatParts(value, mode, digits) {
    if (!Number.isFinite(value)) return { man: 'Error 0', exp: '' };
    const sign = value < 0 ? '-' : '';
    const av = Math.abs(value);
    const digs = Math.max(0, Math.min(9, digits | 0));
    const sci = (expMode) => {
      if (av === 0) return { man: `${sign}0.${'0'.repeat(digs)}`, exp: ' 00' };
      let exp = Math.floor(Math.log10(av));
      let mant = av / (10 ** exp);
      if (expMode === 'eng') {
        const shift = ((exp % 3) + 3) % 3;
        exp -= shift;
        mant = av / (10 ** exp);
      }
      mant = Number(mant.toFixed(digs));
      if (mant >= 10) {
        mant /= 10;
        exp += 1;
      }
      const expText = `${exp < 0 ? '-' : ' '}${String(Math.abs(exp)).padStart(2, '0')}`;
      return { man: sign + mant.toFixed(digs), exp: expText };
    };
    if (mode === 'sci') return sci('sci');
    if (mode === 'eng') return sci('eng');
    if (av !== 0 && (av >= 1e10 || av < 10 ** (-digs))) return sci('sci');
    const fixed = av.toFixed(digs);
    if (fixed.replace('.', '').replace(/^0+/, '').length > 10 || fixed.length > 12) return sci('sci');
    return { man: sign + fixed, exp: '' };
  }

  function formatEntry(entry) {
    const sign = entry.neg ? '-' : '';
    const man = entry.man || '0';
    if (entry.exp == null) return { man: sign + man, exp: '' };
    const expSign = entry.expNeg ? '-' : ' ';
    const exp = entry.exp === '' ? '00' : entry.exp.padStart(2, '0');
    return { man: sign + man, exp: expSign + exp };
  }

  function mnemonic(ins) {
    if (!ins) return '';
    const name = {
      digit: ins.d,
      dot: '·',
      eex: 'EEX',
      chs: 'CHS',
      enter: 'ENTER',
      add: '+',
      sub: '−',
      mul: '×',
      div: '÷',
      sqrt: '√x',
      sq: 'x²',
      inv: '1/x',
      pow: 'yˣ',
      exp: 'eˣ',
      ln: 'LN',
      exp10: '10ˣ',
      log: 'LOG',
      sin: 'SIN',
      cos: 'COS',
      tan: 'TAN',
      asin: 'SIN⁻¹',
      acos: 'COS⁻¹',
      atan: 'TAN⁻¹',
      sinh: 'HYP SIN',
      cosh: 'HYP COS',
      tanh: 'HYP TAN',
      asinh: 'HYP⁻¹ SIN',
      acosh: 'HYP⁻¹ COS',
      atanh: 'HYP⁻¹ TAN',
      pi: 'π',
      abs: 'ABS',
      fact: 'x!',
      int: 'INT',
      frac: 'FRAC',
      rnd: 'RND',
      percent: '%',
      deltapct: 'Δ%',
      recip: '1/x',
      lastx: 'LSTx',
      swap: 'x⇄y',
      rdown: 'R↓',
      rup: 'R↑',
      clx: 'CLx',
      sigma: 'Σ+',
      sigmasub: 'Σ−',
      mean: 'x̄',
      std: 's',
      lr: 'L.R.',
      yhat: 'ŷ,r',
      perm: 'Py,x',
      comb: 'Cy,x',
      top: '→P',
      tor: '→R',
      tohms: '→H.MS',
      toh: '→H',
      torad: '→RAD',
      todeg: '→DEG',
      reim: 'Re⇄Im',
      cplx: 'I',
      ran: 'RAN#',
      rs: 'R/S',
      rtn: 'RTN',
      pse: 'PSE',
      xley: 'x≤y',
      xeq0: 'x=0',
      xeqy: 'x=y',
    }[ins.op];
    if (ins.op === 'lbl') return `LBL ${ins.label}`;
    if (ins.op === 'gto') return `GTO ${ins.label}`;
    if (ins.op === 'gsb') return `GSB ${ins.label}`;
    if (ins.op === 'sto') return `STO ${ins.arith || ''}${ins.reg}`;
    if (ins.op === 'rcl') return `RCL ${ins.arith || ''}${ins.reg}`;
    if (ins.op === 'xex') return `x⇄ ${ins.reg}`;
    if (ins.op === 'fix' || ins.op === 'sci' || ins.op === 'eng') return `${ins.op.toUpperCase()} ${ins.n}`;
    if (ins.op === 'sf' || ins.op === 'cf' || ins.op === 'fq') {
      const tag = ins.op === 'fq' ? 'F?' : ins.op.toUpperCase();
      return `${tag} ${ins.n}`;
    }
    if (ins.op === 'dse' || ins.op === 'isg') return `${ins.op.toUpperCase()} ${ins.reg}`;
    if (ins.op === 'solve') return `SOLVE ${ins.label}`;
    if (ins.op === 'integ') return `∫ ${ins.label}`;
    if (ins.op === 'test') return `TEST ${ins.n}`;
    if (ins.op === 'deg' || ins.op === 'rad' || ins.op === 'grad') return ins.op.toUpperCase();
    return name || ins.op.toUpperCase();
  }

  function snapshot(state) {
    return {
      re: state.re.slice(),
      im: state.im.slice(),
      pc: state.pc,
      ret: state.ret.slice(),
      lift: state.lift,
      entry: state.entry,
      lastRe: state.lastRe,
      lastIm: state.lastIm,
    };
  }

  function restore(state, snap) {
    state.re = snap.re.slice();
    state.im = snap.im.slice();
    state.pc = snap.pc;
    state.ret = snap.ret.slice();
    state.lift = snap.lift;
    state.entry = snap.entry;
    state.lastRe = snap.lastRe;
    state.lastIm = snap.lastIm;
  }

  function runLoop(state) {
    let steps = 0;
    while (steps < 20000) {
      if (state.pc >= state.program.length) return;
      const ins = state.program[state.pc];
      state.pc += 1;
      const signal = apply(state, ins, true);
      if (state.error) return;
      if (signal === 'stop') return;
      if (signal === 'skip') state.pc += 1;
      steps += 1;
    }
    state.error = 'Error 4';
  }

  function callLabel(state, label) {
    const wasEntry = !!state.entry;
    closeEntry(state);
    if (wasEntry) state.lift = true;
    const at = findLabel(state, label);
    if (at < 0) {
      state.error = 'Error 4';
      return;
    }
    if (state.ret.length >= 7 || state.depth > 12) {
      state.error = 'Error 5';
      return;
    }
    state.depth += 1;
    state.ret.push(state.program.length);
    state.pc = at + 1;
    runLoop(state);
    state.depth -= 1;
  }

  function evalProgram(state, label, x) {
    const snap = snapshot(state);
    state.re = snap.re.slice();
    state.im = snap.im.slice();
    state.re[0] = x;
    state.im[0] = 0;
    state.entry = null;
    state.lift = true;
    state.ret = [];
    state.error = null;
    callLabel(state, label);
    const out = state.error ? null : state.re[0];
    const err = state.error;
    restore(state, snap);
    state.error = err;
    return out;
  }

  function solveRoot(state, label) {
    closeEntry(state);
    let x0 = state.re[1];
    let x1 = state.re[0];
    if (x0 === x1) x0 = x1 + (x1 === 0 ? 0.1 : x1 * 0.01);
    let f0 = evalProgram(state, label, x0);
    let f1 = evalProgram(state, label, x1);
    if (f0 == null || f1 == null) return;
    for (let i = 0; i < 40; i += 1) {
      if (Math.abs(f1) < 1e-9) break;
      const den = f1 - f0;
      let x2;
      if (Math.abs(den) < 1e-14) x2 = (x0 + x1) / 2;
      else x2 = x1 - f1 * (x1 - x0) / den;
      if (!Number.isFinite(x2)) {
        state.error = 'Error 8';
        return;
      }
      x0 = x1;
      f0 = f1;
      x1 = x2;
      f1 = evalProgram(state, label, x1);
      if (f1 == null) return;
      if (Math.abs(x1 - x0) < 1e-10 * Math.max(1, Math.abs(x1))) break;
    }
    if (f1 == null || Math.abs(f1) > 1e-4) {
      state.error = 'Error 8';
      return;
    }
    remember(state);
    state.re[0] = x1;
    state.im[0] = 0;
    state.lift = true;
  }

  function integrate(state, label) {
    closeEntry(state);
    const a = state.re[1];
    const b = state.re[0];
    if (a === b) {
      remember(state);
      state.re[0] = 0;
      state.lift = true;
      return;
    }
    const tol = 0.5 * (10 ** (-Math.min(6, state.digits + 1)));
    const f = (x) => evalProgram(state, label, x);
    const simpson = (n) => {
      const h = (b - a) / n;
      let s = f(a) + f(b);
      if (s == null || !Number.isFinite(s)) return null;
      for (let i = 1; i < n; i += 1) {
        const y = f(a + i * h);
        if (y == null || !Number.isFinite(y)) return null;
        s += y * (i % 2 ? 4 : 2);
      }
      return s * h / 3;
    };
    let n = 8;
    let prev = simpson(n);
    if (prev == null) return;
    let cur = prev;
    while (n < 128) {
      n *= 2;
      cur = simpson(n);
      if (cur == null) return;
      if (Math.abs(cur - prev) <= tol * Math.max(1, Math.abs(cur))) break;
      prev = cur;
    }
    remember(state);
    state.re[0] = cur;
    state.im[0] = 0;
    state.lift = true;
  }

  function controlWord(value, dir) {
    const sign = value < 0 ? -1 : 1;
    const av = Math.abs(value);
    const counter = Math.trunc(av + 1e-9);
    const frac5 = Math.round((av - counter) * 1e5);
    const end = Math.trunc(frac5 / 100);
    let inc = frac5 % 100;
    if (!inc) inc = 1;
    const next = counter + dir * inc;
    const skip = dir > 0 ? next > end : next <= end;
    const stored = sign * (next + end / 1000 + inc / 1e5);
    return { stored, skip };
  }

  function bump(state, reg, dir) {
    const slot = slotOf(state, reg);
    if (!slot) {
      state.error = 'Error 3';
      return false;
    }
    const word = controlWord(state.regs[slot] || 0, dir);
    state.regs[slot] = word.stored;
    return word.skip;
  }

  function testValue(state, n) {
    const x = state.re[0];
    const y = state.re[1];
    const xi = state.complex ? state.im[0] : 0;
    const yi = state.complex ? state.im[1] : 0;
    switch (n) {
      case 0: return state.complex ? (x !== 0 || xi !== 0) : x !== 0;
      case 1: return x > 0;
      case 2: return x < 0;
      case 3: return x >= 0;
      case 4: return x <= 0;
      case 5: return x === y && xi === yi;
      case 6: return x !== y || xi !== yi;
      case 7: return x > y;
      case 8: return x < y;
      case 9: return x >= y;
      default: return false;
    }
  }

  function applyTest(state, ok, inside) {
    if (ok) return;
    if (inside) return 'skip';
    state.skip = true;
    return undefined;
  }

  function toHms(h) {
    const sign = h < 0 ? -1 : 1;
    let x = Math.abs(h);
    const hours = Math.floor(x + 1e-10);
    x = (x - hours) * 60;
    const minutes = Math.floor(x + 1e-10);
    const seconds = (x - minutes) * 60;
    return sign * (hours + minutes / 100 + seconds / 10000);
  }

  function fromHms(h) {
    const sign = h < 0 ? -1 : 1;
    let x = Math.abs(h);
    const hours = Math.floor(x + 1e-10);
    x = (x - hours) * 100;
    const minutes = Math.floor(x + 1e-10);
    const seconds = (x - minutes) * 100;
    return sign * (hours + minutes / 60 + seconds / 3600);
  }

  function random(state) {
    state.rand = (Math.imul(state.rand, 1664525) + 1013904223) >>> 0;
    return state.rand / 4294967296;
  }

  function sigma(state, sign) {
    closeEntry(state);
    const x = state.re[0];
    const y = state.re[1];
    const add = (reg, v) => { state.regs[reg] = (state.regs[reg] || 0) + v; };
    add('2', sign);
    add('3', sign * x);
    add('4', sign * x * x);
    add('5', sign * y);
    add('6', sign * y * y);
    add('7', sign * x * y);
    state.re[0] = state.regs['2'] || 0;
    state.im[0] = 0;
    state.lift = false;
    state.entry = null;
  }

  function statsMoments(state) {
    const n = state.regs['2'] || 0;
    if (n <= 0) throw new Error('math');
    return {
      n,
      sx: state.regs['3'] || 0,
      sx2: state.regs['4'] || 0,
      sy: state.regs['5'] || 0,
      sy2: state.regs['6'] || 0,
      sxy: state.regs['7'] || 0,
    };
  }

  function apply(state, ins, inside) {
    const op = ins.op;
    try {
      if (op === 'digit') { digit(state, ins.d); return; }
      if (op === 'dot') { dot(state); return; }
      if (op === 'eex') { eex(state); return; }
      if (op === 'chs') { chs(state); return; }
      if (op === 'enter') {
        closeEntry(state);
        liftStack(state);
        state.lift = false;
        return;
      }
      if (op === 'bsp' || op === 'clx') { backspace(state); return; }
      if (op === 'add') { binary(state, (y, x) => y + x, cadd); return; }
      if (op === 'sub') { binary(state, (y, x) => y - x, csub); return; }
      if (op === 'mul') { binary(state, (y, x) => y * x, cmul); return; }
      if (op === 'div') {
        binary(state, (y, x) => {
          if (!x) throw new Error('math');
          return y / x;
        }, cdiv);
        return;
      }
      if (op === 'sqrt') {
        anyUnary(state, (x) => {
          if (x < 0) throw new Error('math');
          return Math.sqrt(x);
        }, csqrt);
        return;
      }
      if (op === 'sq') {
        anyUnary(state, (x) => x * x, (z) => cmul(z, z));
        return;
      }
      if (op === 'inv' || op === 'recip') {
        anyUnary(state, (x) => {
          if (!x) throw new Error('math');
          return 1 / x;
        }, (z) => cdiv({ re: 1, im: 0 }, z));
        return;
      }
      if (op === 'pow') {
        binary(state, (y, x) => {
          if (y < 0 && Math.abs(x - Math.round(x)) > 1e-10) throw new Error('math');
          return y ** x;
        }, cpow);
        return;
      }
      if (op === 'exp') { anyUnary(state, Math.exp, cexp); return; }
      if (op === 'ln') {
        anyUnary(state, (x) => {
          if (x <= 0) throw new Error('math');
          return Math.log(x);
        }, cln);
        return;
      }
      if (op === 'exp10') { anyUnary(state, (x) => 10 ** x, (z) => cpow({ re: 10, im: 0 }, z)); return; }
      if (op === 'log') {
        anyUnary(state, (x) => {
          if (x <= 0) throw new Error('math');
          return Math.log10(x);
        }, (z) => {
          const w = cln(z);
          return { re: w.re / Math.LN10, im: w.im / Math.LN10 };
        });
        return;
      }
      if (op === 'sin' || op === 'cos' || op === 'tan' || op === 'asin' || op === 'acos' || op === 'atan') {
        closeEntry(state);
        remember(state);
        const z = cx(state);
        let out;
        if (state.complex) {
          if (op === 'sin') out = csin(z);
          else if (op === 'cos') out = ccos(z);
          else if (op === 'tan') out = ctan(z);
          else throw new Error('math');
        } else if (op === 'sin') out = { re: Math.sin(toRad(z.re, state.angle)), im: 0 };
        else if (op === 'cos') out = { re: Math.cos(toRad(z.re, state.angle)), im: 0 };
        else if (op === 'tan') out = { re: Math.tan(toRad(z.re, state.angle)), im: 0 };
        else if (op === 'asin') out = { re: fromRad(Math.asin(z.re), state.angle), im: 0 };
        else if (op === 'acos') out = { re: fromRad(Math.acos(z.re), state.angle), im: 0 };
        else out = { re: fromRad(Math.atan(z.re), state.angle), im: 0 };
        setX(state, out);
        state.lift = true;
        return;
      }
      if (op === 'sinh') { realUnary(state, Math.sinh); return; }
      if (op === 'cosh') { realUnary(state, Math.cosh); return; }
      if (op === 'tanh') { realUnary(state, Math.tanh); return; }
      if (op === 'asinh') { realUnary(state, Math.asinh); return; }
      if (op === 'acosh') { realUnary(state, Math.acosh); return; }
      if (op === 'atanh') { realUnary(state, Math.atanh); return; }
      if (op === 'pi') {
        if (state.lift) liftStack(state);
        state.re[0] = Math.PI;
        state.im[0] = 0;
        state.entry = null;
        state.lift = true;
        return;
      }
      if (op === 'abs') {
        closeEntry(state);
        remember(state);
        const z = cx(state);
        setX(state, { re: Math.hypot(z.re, z.im), im: 0 });
        state.lift = true;
        return;
      }
      if (op === 'fact') { realUnary(state, factorial); return; }
      if (op === 'int') { realUnary(state, (x) => Math.trunc(x)); return; }
      if (op === 'frac') { realUnary(state, (x) => x - Math.trunc(x)); return; }
      if (op === 'rnd') {
        closeEntry(state);
        const parts = formatParts(state.re[0], state.mode, state.digits);
        const exp = parts.exp.trim();
        const man = parseFloat(parts.man);
        const value = exp ? man * (10 ** parseInt(exp, 10)) : man;
        state.re[0] = value;
        state.lift = true;
        return;
      }
      if (op === 'percent') {
        closeEntry(state);
        remember(state);
        state.re[0] = state.re[1] * state.re[0] / 100;
        state.im[0] = 0;
        state.lift = true;
        return;
      }
      if (op === 'deltapct') {
        closeEntry(state);
        remember(state);
        if (!state.re[1]) throw new Error('math');
        state.re[0] = (state.re[0] - state.re[1]) / state.re[1] * 100;
        state.im[0] = 0;
        state.lift = true;
        return;
      }
      if (op === 'lastx') {
        if (state.lift) liftStack(state);
        state.re[0] = state.lastRe;
        state.im[0] = state.complex ? state.lastIm : 0;
        state.entry = null;
        state.lift = true;
        return;
      }
      if (op === 'swap') {
        closeEntry(state);
        const re = state.re[0];
        const im = state.im[0];
        state.re[0] = state.re[1];
        state.im[0] = state.im[1];
        state.re[1] = re;
        state.im[1] = im;
        state.lift = true;
        return;
      }
      if (op === 'rdown') {
        closeEntry(state);
        const re = state.re[0];
        const im = state.im[0];
        state.re[0] = state.re[1];
        state.im[0] = state.im[1];
        state.re[1] = state.re[2];
        state.im[1] = state.im[2];
        state.re[2] = state.re[3];
        state.im[2] = state.im[3];
        state.re[3] = re;
        state.im[3] = im;
        state.lift = true;
        return;
      }
      if (op === 'rup') {
        closeEntry(state);
        const re = state.re[3];
        const im = state.im[3];
        state.re[3] = state.re[2];
        state.im[3] = state.im[2];
        state.re[2] = state.re[1];
        state.im[2] = state.im[1];
        state.re[1] = state.re[0];
        state.im[1] = state.im[0];
        state.re[0] = re;
        state.im[0] = im;
        state.lift = true;
        return;
      }
      if (op === 'sigma') { sigma(state, 1); return; }
      if (op === 'sigmasub') { sigma(state, -1); return; }
      if (op === 'mean') {
        closeEntry(state);
        const s = statsMoments(state);
        state.re[0] = s.sx / s.n;
        state.re[1] = s.sy / s.n;
        state.im[0] = 0;
        state.lift = true;
        return;
      }
      if (op === 'std') {
        closeEntry(state);
        const s = statsMoments(state);
        if (s.n < 2) throw new Error('math');
        state.re[0] = Math.sqrt(Math.max(0, (s.sx2 - (s.sx * s.sx) / s.n) / (s.n - 1)));
        state.re[1] = Math.sqrt(Math.max(0, (s.sy2 - (s.sy * s.sy) / s.n) / (s.n - 1)));
        state.lift = true;
        return;
      }
      if (op === 'lr' || op === 'yhat') {
        closeEntry(state);
        const s = statsMoments(state);
        const den = s.n * s.sx2 - s.sx * s.sx;
        if (!den || s.n < 2) throw new Error('math');
        const slope = (s.n * s.sxy - s.sx * s.sy) / den;
        const intercept = (s.sy - slope * s.sx) / s.n;
        if (op === 'lr') {
          state.re[1] = slope;
          state.re[0] = intercept;
        } else {
          const x = state.re[0];
          const vary = s.n * s.sy2 - s.sy * s.sy;
          const r = vary > 0 ? (s.n * s.sxy - s.sx * s.sy) / Math.sqrt(den * vary) : 0;
          state.re[1] = r;
          state.re[0] = slope * x + intercept;
        }
        state.lift = true;
        return;
      }
      if (op === 'perm' || op === 'comb') {
        closeEntry(state);
        remember(state);
        const y = Math.round(state.re[1]);
        const x = Math.round(state.re[0]);
        if (x < 0 || y < 0 || x > y) throw new Error('math');
        let r = 1;
        if (op === 'perm') {
          for (let i = 0; i < x; i += 1) r *= (y - i);
        } else {
          const k = Math.min(x, y - x);
          for (let i = 0; i < k; i += 1) r = r * (y - i) / (i + 1);
        }
        dropStack(state);
        setX(state, { re: r, im: 0 });
        state.lift = true;
        return;
      }
      if (op === 'top' || op === 'tor') {
        closeEntry(state);
        remember(state);
        if (op === 'top') {
          const x = state.re[0];
          const y = state.re[1];
          state.re[0] = Math.hypot(x, y);
          state.re[1] = fromRad(Math.atan2(y, x), state.angle);
        } else {
          const r = state.re[0];
          const th = toRad(state.re[1], state.angle);
          state.re[0] = r * Math.cos(th);
          state.re[1] = r * Math.sin(th);
        }
        state.im[0] = 0;
        state.im[1] = 0;
        state.lift = true;
        return;
      }
      if (op === 'tohms') { realUnary(state, toHms); return; }
      if (op === 'toh') { realUnary(state, fromHms); return; }
      if (op === 'torad') { realUnary(state, (x) => x * Math.PI / 180); return; }
      if (op === 'todeg') { realUnary(state, (x) => x * 180 / Math.PI); return; }
      if (op === 'reim') {
        closeEntry(state);
        enableComplex(state);
        const re = state.re[0];
        state.re[0] = state.im[0];
        state.im[0] = re;
        state.lift = true;
        return;
      }
      if (op === 'cplx') {
        closeEntry(state);
        enableComplex(state);
        const imag = state.re[0];
        const real = state.re[1];
        dropStack(state);
        state.re[0] = real;
        state.im[0] = imag;
        state.lift = true;
        return;
      }
      if (op === 'showi') {
        state.viewImag = true;
        return;
      }
      if (op === 'ran') {
        if (state.lift) liftStack(state);
        state.re[0] = random(state);
        state.im[0] = 0;
        state.entry = null;
        state.lift = true;
        return;
      }
      if (op === 'deg' || op === 'rad' || op === 'grad') {
        closeEntry(state);
        state.angle = op === 'grad' ? 'grad' : op;
        state.lift = true;
        return;
      }
      if (op === 'fix' || op === 'sci' || op === 'eng') {
        closeEntry(state);
        state.mode = op;
        state.digits = ins.n;
        state.lift = true;
        return;
      }
      if (op === 'user') { state.user = !state.user; return; }
      if (op === 'prgm') { state.prgm = !state.prgm; state.pending = null; return; }
      if (op === 'mem') {
        state.message = `P ${String(state.program.length).padStart(3, '0')}  R 20`;
        return;
      }
      if (op === 'clsigma') {
        ['2', '3', '4', '5', '6', '7'].forEach((reg) => { state.regs[reg] = 0; });
        return;
      }
      if (op === 'clreg') { state.regs = {}; return; }
      if (op === 'clprgm') {
        if (state.prgm) {
          state.program = [];
          state.pc = 0;
        } else state.pc = 0;
        return;
      }
      if (op === 'clprefix') {
        state.shift = null;
        state.pending = null;
        state.viewImag = false;
        return;
      }
      if (op === 'sf' || op === 'cf') {
        const n = ins.n;
        if (n < 0 || n > 9) return;
        state.flags[n] = op === 'sf';
        if (n === 8) {
          state.complex = state.flags[8];
          if (!state.complex) state.im = [0, 0, 0, 0];
        }
        if (n === 9 && op === 'cf') state.flags[9] = false;
        return;
      }
      if (op === 'fq') return applyTest(state, !!state.flags[ins.n], inside);
      if (op === 'sto') {
        const slot = slotOf(state, ins.reg);
        if (!slot) { state.error = 'Error 3'; return; }
        closeEntry(state);
        const x = state.re[0];
        const cur = state.regs[slot] || 0;
        let value = x;
        if (ins.arith === '+') value = cur + x;
        else if (ins.arith === '-') value = cur - x;
        else if (ins.arith === '×') value = cur * x;
        else if (ins.arith === '÷') {
          if (!x) throw new Error('math');
          value = cur / x;
        }
        if (!Number.isFinite(value)) throw new Error('math');
        state.regs[slot] = value;
        return;
      }
      if (op === 'rcl') {
        const slot = slotOf(state, ins.reg);
        if (!slot) { state.error = 'Error 3'; return; }
        closeEntry(state);
        const cur = state.regs[slot] || 0;
        if (ins.arith) {
          let value = cur;
          if (ins.arith === '+') value = state.re[0] + cur;
          else if (ins.arith === '-') value = state.re[0] - cur;
          else if (ins.arith === '×') value = state.re[0] * cur;
          else if (ins.arith === '÷') {
            if (!cur) throw new Error('math');
            value = state.re[0] / cur;
          }
          setX(state, { re: value, im: state.im[0] });
          state.lift = true;
          return;
        }
        if (state.lift) liftStack(state);
        state.re[0] = cur;
        state.im[0] = 0;
        state.lift = true;
        return;
      }
      if (op === 'xex') {
        const slot = slotOf(state, ins.reg);
        if (!slot) { state.error = 'Error 3'; return; }
        closeEntry(state);
        const cur = state.regs[slot] || 0;
        state.regs[slot] = state.re[0];
        state.re[0] = cur;
        state.lift = true;
        return;
      }
      if (op === 'lbl') return;
      if (op === 'gto') {
        const at = findLabel(state, ins.label);
        if (at < 0) { state.error = 'Error 4'; return; }
        state.pc = at + 1;
        return;
      }
      if (op === 'gsb') { callLabel(state, ins.label); return; }
      if (op === 'rtn') {
        if (!state.ret.length) return 'stop';
        state.pc = state.ret.pop();
        return;
      }
      if (op === 'rs' || op === 'pse') return inside ? 'stop' : undefined;
      if (op === 'sst') {
        if (state.prgm) {
          if (state.pc < state.program.length) state.pc += 1;
          return;
        }
        if (state.pc >= state.program.length) state.pc = 0;
        if (state.pc < state.program.length) {
          const step = state.program[state.pc];
          state.pc += 1;
          const signal = apply(state, step, true);
          if (signal === 'skip') state.pc += 1;
        }
        return;
      }
      if (op === 'bst') {
        if (state.pc > 0) state.pc -= 1;
        return;
      }
      if (op === 'dse' || op === 'isg') {
        const skip = bump(state, ins.reg, op === 'isg' ? 1 : -1);
        if (!skip) return;
        if (inside) return 'skip';
        state.skip = true;
        return;
      }
      if (op === 'solve') { solveRoot(state, ins.label); return; }
      if (op === 'integ') { integrate(state, ins.label); return; }
      if (op === 'xley') return applyTest(state, state.re[0] <= state.re[1], inside);
      if (op === 'xeq0') return applyTest(state, state.re[0] === 0 && (!state.complex || state.im[0] === 0), inside);
      if (op === 'xeqy') return applyTest(state, state.re[0] === state.re[1], inside);
      if (op === 'test') return applyTest(state, testValue(state, ins.n), inside);
      if (op === 'matrix' || op === 'dim' || op === 'result') {
        state.error = 'Error 1';
        return;
      }
      if (op === 'nop') return;
    } catch (err) {
      state.error = 'Error 0';
    }
    return undefined;
  }

  function resolve(state, key, shift) {
    if (!state.prgm && state.user && !shift && TOP_LABEL[key]) return { op: 'gsb', label: TOP_LABEL[key] };
    if (!state.prgm && state.user && shift === 'f' && TOP_LABEL[key]) shift = null;
    if (!shift && /^[0-9]$/.test(key)) return { op: 'digit', d: key };
    if (shift === 'f') {
      const gold = {
        sqrt: { op: 'gsb', label: 'A' },
        exp: { op: 'gsb', label: 'B' },
        exp10: { op: 'gsb', label: 'C' },
        pow: { op: 'gsb', label: 'D' },
        inv: { op: 'gsb', label: 'E' },
        chs: { op: 'matrix' },
        7: { op: 'fix' },
        8: { op: 'sci' },
        9: { op: 'eng' },
        div: { op: 'solve' },
        sst: { op: 'lbl' },
        gto: { op: 'hyp' },
        sin: { op: 'dim' },
        cos: { op: 'showi' },
        tan: { op: 'cplx' },
        eex: { op: 'result' },
        4: { op: 'xex' },
        5: { op: 'dse' },
        6: { op: 'isg' },
        mul: { op: 'integ' },
        rs: { op: 'pse' },
        gsb: { op: 'clsigma' },
        rdown: { op: 'clprgm' },
        swap: { op: 'clreg' },
        bsp: { op: 'clprefix' },
        enter: { op: 'ran' },
        1: { op: 'tor' },
        2: { op: 'tohms' },
        3: { op: 'torad' },
        sub: { op: 'reim' },
        sto: { op: 'frac' },
        rcl: { op: 'user' },
        0: { op: 'fact' },
        dot: { op: 'yhat' },
        sigma: { op: 'lr' },
        add: { op: 'perm' },
      };
      return gold[key] || { op: 'nop' };
    }
    if (shift === 'g') {
      const blue = {
        sqrt: { op: 'sq' },
        exp: { op: 'ln' },
        exp10: { op: 'log' },
        pow: { op: 'percent' },
        inv: { op: 'deltapct' },
        chs: { op: 'abs' },
        7: { op: 'deg' },
        8: { op: 'rad' },
        9: { op: 'grad' },
        div: { op: 'xley' },
        sst: { op: 'bst' },
        gto: { op: 'ahyp' },
        sin: { op: 'asin' },
        cos: { op: 'acos' },
        tan: { op: 'atan' },
        eex: { op: 'pi' },
        4: { op: 'sf' },
        5: { op: 'cf' },
        6: { op: 'fq' },
        mul: { op: 'xeq0' },
        rs: { op: 'prgm' },
        gsb: { op: 'rtn' },
        rdown: { op: 'rup' },
        swap: { op: 'rnd' },
        bsp: { op: 'clx' },
        enter: { op: 'lastx' },
        1: { op: 'top' },
        2: { op: 'toh' },
        3: { op: 'todeg' },
        sub: { op: 'test' },
        sto: { op: 'int' },
        rcl: { op: 'mem' },
        0: { op: 'mean' },
        dot: { op: 'std' },
        sigma: { op: 'sigmasub' },
        add: { op: 'comb' },
      };
      return blue[key] || { op: 'nop' };
    }
    const primary = {
      sqrt: { op: 'sqrt' },
      exp: { op: 'exp' },
      exp10: { op: 'exp10' },
      pow: { op: 'pow' },
      inv: { op: 'inv' },
      chs: { op: 'chs' },
      div: { op: 'div' },
      sst: { op: 'sst' },
      gto: { op: 'gto' },
      sin: { op: 'sin' },
      cos: { op: 'cos' },
      tan: { op: 'tan' },
      eex: { op: 'eex' },
      mul: { op: 'mul' },
      rs: { op: 'rs' },
      gsb: { op: 'gsb' },
      rdown: { op: 'rdown' },
      swap: { op: 'swap' },
      bsp: { op: 'bsp' },
      enter: { op: 'enter' },
      sub: { op: 'sub' },
      on: { op: 'on' },
      sto: { op: 'sto' },
      rcl: { op: 'rcl' },
      dot: { op: 'dot' },
      sigma: { op: 'sigma' },
      add: { op: 'add' },
    };
    return primary[key] || { op: 'nop' };
  }

  const ARG_OPS = new Set(['sto', 'rcl', 'xex', 'fix', 'sci', 'eng', 'sf', 'cf', 'fq', 'gto', 'gsb', 'lbl', 'dse', 'isg', 'solve', 'integ', 'test', 'hyp', 'ahyp']);

  function commit(state, ins) {
    state.pending = null;
    if (state.prgm && !LIVE.has(ins.op)) {
      insertIns(state, ins);
      return;
    }
    apply(state, ins, false);
  }

  function takeLabel(state, key, shift) {
    if (state.pending.dot) {
      if (!shift && /^[0-9]$/.test(key)) return `.${key}`;
      return null;
    }
    if (!shift && key === 'dot') {
      state.pending.dot = true;
      return 'wait';
    }
    if (!shift && /^[0-9]$/.test(key)) return key;
    if (shift === 'f' && TOP_LABEL[key]) return TOP_LABEL[key];
    if (shift === 'f' && key === 'tan') return 'I';
    return null;
  }

  function takeReg(state, key, shift) {
    if (state.pending.dot) {
      if (!shift && /^[0-9]$/.test(key)) return `.${key}`;
      return null;
    }
    if (!shift && key === 'dot') {
      state.pending.dot = true;
      return 'wait';
    }
    if (!shift && /^[0-9]$/.test(key)) return key;
    if (shift === 'f' && key === 'tan') return 'I';
    if (shift === 'f' && key === 'cos') return '(i)';
    if (!shift && !state.pending.arith && (key === 'add' || key === 'sub' || key === 'mul' || key === 'div')) {
      state.pending.arith = { add: '+', sub: '-', mul: '×', div: '÷' }[key];
      return 'wait';
    }
    return null;
  }

  function handlePending(state, key, shift) {
    const pending = state.pending;
    if (pending.op === 'hyp' || pending.op === 'ahyp') {
      const inv = pending.op === 'ahyp';
      const map = inv
        ? { sin: 'asinh', cos: 'acosh', tan: 'atanh' }
        : { sin: 'sinh', cos: 'cosh', tan: 'tanh' };
      if (!shift && map[key]) {
        commit(state, { op: map[key] });
        return;
      }
      state.pending = null;
      const ins = resolve(state, key, shift);
      dispatch(state, ins);
      return;
    }
    if (pending.op === 'fix' || pending.op === 'sci' || pending.op === 'eng' || pending.op === 'sf' || pending.op === 'cf' || pending.op === 'fq' || pending.op === 'test') {
      if (!shift && /^[0-9]$/.test(key)) {
        commit(state, { op: pending.op, n: parseInt(key, 10) });
        return;
      }
      state.pending = null;
      return;
    }
    if (pending.op === 'gto' || pending.op === 'gsb' || pending.op === 'lbl' || pending.op === 'solve' || pending.op === 'integ') {
      const label = takeLabel(state, key, shift);
      if (label === 'wait') return;
      if (!label) {
        state.pending = null;
        return;
      }
      commit(state, { op: pending.op, label });
      return;
    }
    const reg = takeReg(state, key, shift);
    if (reg === 'wait') return;
    if (!reg) {
      state.pending = null;
      return;
    }
    commit(state, { op: pending.op, reg, arith: pending.arith || '' });
  }

  function dispatch(state, ins) {
    if (ins.op === 'bsp' && state.prgm) {
      if (state.pc > 0) {
        state.pc -= 1;
        state.program.splice(state.pc, 1);
      }
      return;
    }
    if (ins.op === 'rs' && !state.prgm) {
      if (state.pc >= state.program.length) state.pc = 0;
      runLoop(state);
      return;
    }
    if (ARG_OPS.has(ins.op) && ins.label == null && ins.reg == null && ins.n == null && ins.op !== 'showi') {
      state.pending = { op: ins.op, arith: '', dot: false };
      return;
    }
    if (state.prgm && !LIVE.has(ins.op)) {
      insertIns(state, ins);
      return;
    }
    apply(state, ins, false);
  }

  function press(state, key) {
    if (!state.on) {
      if (key === 'on') state.on = true;
      return state;
    }
    if (key === 'on') {
      state.on = false;
      return state;
    }
    if (state.error) {
      state.error = null;
      state.flags[9] = false;
      return state;
    }
    if (state.message) state.message = null;
    if (key === 'f' || key === 'g') {
      state.shift = state.shift === key ? null : key;
      state.viewImag = false;
      return state;
    }
    const shift = state.shift;
    state.shift = null;
    state.viewImag = false;
    if (state.skip) {
      state.skip = false;
      return state;
    }
    if (state.pending) {
      handlePending(state, key, shift);
      return state;
    }
    dispatch(state, resolve(state, key, shift));
    return state;
  }

  function readout(state) {
    if (!state.on) return { man: '', exp: '', imag: '', step: '', ann: {} };
    if (state.error) {
      return { man: state.error, exp: '', imag: '', step: state.error, ann: annunciators(state) };
    }
    if (state.message) {
      return { man: state.message, exp: '', imag: '', step: state.message, ann: annunciators(state) };
    }
    if (state.prgm) {
      const step = state.pc === 0
        ? '000-'
        : `${String(state.pc).padStart(3, '0')}  ${mnemonic(state.program[state.pc - 1])}`;
      return { man: step, exp: '', imag: '', step, ann: annunciators(state) };
    }
    const value = state.viewImag ? state.im[0] : state.re[0];
    const parts = state.entry && !state.viewImag ? formatEntry(state.entry) : formatParts(value, state.mode, state.digits);
    const imag = state.complex ? formatParts(state.viewImag ? state.re[0] : state.im[0], state.mode, state.digits) : null;
    return {
      man: parts.man,
      exp: parts.exp,
      imag: imag ? `i ${imag.man}${imag.exp ? ` ${imag.exp.trim()}` : ''}` : '',
      step: '',
      ann: annunciators(state),
    };
  }

  function annunciators(state) {
    let pend = '';
    if (state.pending) {
      const op = state.pending.op === 'ahyp' ? 'HYP⁻¹' : state.pending.op === 'hyp' ? 'HYP' : state.pending.op.toUpperCase();
      pend = `${op} ${state.pending.arith || ''}`.trim();
    }
    return {
      user: state.user,
      f: state.shift === 'f',
      g: state.shift === 'g',
      rad: state.angle === 'rad',
      grad: state.angle === 'grad',
      c: state.complex,
      prgm: state.prgm,
      pend,
      blink: !!state.flags[9],
    };
  }

  function stackLines(state) {
    return [3, 2, 1].map((i) => {
      const parts = formatParts(state.re[i], state.mode, state.digits);
      const tag = i === 3 ? 'T' : i === 2 ? 'Z' : 'Y';
      return `${tag} ${parts.man}${parts.exp ? parts.exp : ''}`;
    });
  }

  function renderBlock(content, fenceAttrs, options = {}) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const title = String(cfg.title || 'HP-15C').trim() || 'HP-15C';
    const index = Number.isFinite(options.hp15cIndex) ? options.hp15cIndex : 0;
    const keys = KEYS.map((spec) => {
      const [id, face, gold, blue, row, col, kind, span] = spec;
      const style = `grid-row:${row}${span ? ` / span ${span}` : ''};grid-column:${col}`;
      const classes = ['hp-slot', kind ? `hp-slot--${kind}` : ''].filter(Boolean).join(' ');
      const tip = [gold ? `f ${gold}` : '', face, blue ? `g ${blue}` : ''].filter(Boolean).join(' · ');
      return `<div class="${classes}" style="${style}">`
        + `<div class="hp-f">${escapeHtml(gold)}</div>`
        + `<button type="button" class="hp-key${kind ? ` hp-key--${kind}` : ''}" data-key="${id}" title="${escapeHtml(tip)}" aria-label="${escapeHtml(tip)}">`
        + `<span class="hp-face">${escapeHtml(face)}</span>`
        + `<span class="hp-g">${escapeHtml(blue)}</span>`
        + '</button></div>';
    }).join('');
    return `<div class="hp15c-block" data-hp-index="${index}" tabindex="0">`
      + '<div class="hp-bezel">'
      + `<div class="hp-badge">${escapeHtml(title)}</div>`
      + '<div class="hp-tag">RPN scientific</div>'
      + '</div>'
      + '<div class="hp-lcd" data-role="lcd">'
      + '<div class="hp-ann">'
      + '<span data-ann="user">USER</span><span data-ann="f">f</span><span data-ann="g">g</span>'
      + '<span data-ann="pend" class="hp-pend"></span>'
      + '<span data-ann="rad">RAD</span><span data-ann="grad">GRAD</span><span data-ann="c">C</span><span data-ann="prgm">PRGM</span>'
      + '</div>'
      + '<div class="hp-lcd-body">'
      + '<div class="hp-stack" data-role="stack"></div>'
      + '<div class="hp-readout"><div class="hp-value"><span data-role="man"></span><span data-role="exp"></span></div>'
      + '<div class="hp-imag" data-role="imag"></div></div>'
      + '</div></div>'
      + `<div class="hp-keys">${keys}</div>`
      + '</div>';
  }

  function paint(el, state) {
    const view = readout(state);
    const lcd = el.querySelector('[data-role="lcd"]');
    lcd.classList.toggle('is-off', !state.on);
    lcd.classList.toggle('is-blink', !!view.ann.blink);
    lcd.classList.toggle('is-prgm', !!state.prgm);
    el.querySelector('[data-role="man"]').textContent = view.man;
    el.querySelector('[data-role="exp"]').textContent = view.exp || '';
    el.querySelector('[data-role="imag"]').textContent = view.imag || '';
    const stack = el.querySelector('[data-role="stack"]');
    stack.innerHTML = state.on && !state.prgm && !state.error && !state.message
      ? stackLines(state).map((line) => `<div>${escapeHtml(line)}</div>`).join('')
      : '';
    Object.keys(view.ann).forEach((name) => {
      if (name === 'pend' || name === 'blink') return;
      const node = el.querySelector(`[data-ann="${name}"]`);
      if (node) node.classList.toggle('is-on', !!view.ann[name]);
    });
    const pend = el.querySelector('[data-ann="pend"]');
    if (pend) pend.textContent = view.ann.pend || '';
  }

  function hydrateBlock(el) {
    if (!el || el.dataset.hpReady === '1') return;
    el.dataset.hpReady = '1';
    const key = el.dataset.hpIndex || '0';
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
    el.addEventListener('keydown', (event) => {
      const map = {
        Enter: 'enter',
        Backspace: 'bsp',
        Escape: 'bsp',
        '+': 'add',
        '-': 'sub',
        '*': 'mul',
        '/': 'div',
        '.': 'dot',
        f: 'f',
        g: 'g',
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
    formatParts,
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
  near(run(['2', 'enter', '3', 'add']).re[0], 5, 'add');
  near(run(['6', 'enter', '3', 'div']).re[0], 2, 'div');
  near(run(['9', 'sqrt']).re[0], 3, 'sqrt');
  near(run(['2', 'enter', '3', 'pow']).re[0], 8, 'pow');
  near(run(['3', '0', 'sin']).re[0], 0.5, 'sin 30');
  near(run(['2', 'enter', '3', 'add', '4', 'add']).re[0], 9, 'stack lift');
  const lifted = run(['2', 'enter', '3']);
  near(lifted.re[0], 3, 'enter overwrite x');
  near(lifted.re[1], 2, 'enter y');
  near(run(['5', 'f', '0']).re[0], 120, 'fact');
  near(run(['5', 'sto', '1', '0', 'rcl', '1']).re[0], 5, 'sto rcl');
  near(run(['2', '0', '0', 'enter', '5', 'g', 'pow']).re[0], 10, 'percent');
  const cplx = run(['2', 'enter', '3', 'f', 'tan', '4', 'enter', '5', 'f', 'tan', 'add']);
  near(cplx.re[0], 6, 'complex re');
  near(cplx.im[0], 8, 'complex im');
  near(run(['3', 'enter', '4', 'f', 'tan', 'g', 'chs']).re[0], 5, 'abs');
  near(run(['1', 'dot', '5', 'f', '2']).re[0], 1.3, 'hms');
  near(run(['g', 'eex', 'g', '3']).re[0], 180, 'pi to deg');
  const polar = run(['3', 'enter', '4', 'g', '1']);
  near(polar.re[0], 5, 'polar r');
  near(run(['5', 'enter', '2', 'g', 'add']).re[0], 10, 'comb');
  const prog = run([
    'g', 'rs', 'f', 'sst', 'f', 'sqrt', '2', 'mul', 'g', 'gsb', 'g', 'rs',
    '2', '1', 'f', 'sqrt',
  ]);
  near(prog.re[0], 42, 'program');
  const solved = run([
    'g', 'rs', 'f', 'sst', 'f', 'exp', '2', 'sub', 'g', 'gsb', 'g', 'rs',
    '0', 'enter', '4', 'f', 'div', 'f', 'exp',
  ]);
  near(solved.re[0], 2, 'solve');
  const integral = run([
    'g', 'rs', 'f', 'sst', 'f', 'exp10', '1', 'g', 'gsb', 'g', 'rs',
    '0', 'enter', '1', 'f', 'mul', 'f', 'exp10',
  ]);
  near(integral.re[0], 1, 'integrate');
  const html = api.renderBlock('', 'title=HP-15C');
  if (!html.includes('hp15c-block') || !html.includes('data-key="enter"') || !html.includes('SOLVE')) {
    throw new Error('render');
  }
  const shown = api.formatParts(1 / 3, 'fix', 4);
  if (shown.man !== '0.3333') throw new Error(`format ${shown.man}`);
  console.log('hp15c self-test ok');
}
