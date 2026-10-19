/**
 * NotesPro ```hp12c``` block — RPN financial calculator in the HP-12C layout.
 * Aliases: hp-12c, hp12s. TVM, cash flows, percents, and a four-level stack.
 */
(function (root, factory) {
  const api = factory();
  root.NotesProHp12c = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SESSIONS = new Map();

  const KEYS = [
    ['n', 'n', 'AMORT', '12÷', 1, 1],
    ['i', 'i', 'INT', '12×', 1, 2],
    ['pv', 'PV', 'NPV', 'CF0', 1, 3],
    ['pmt', 'PMT', 'RND', 'CFj', 1, 4],
    ['fv', 'FV', 'IRR', 'Nj', 1, 5],
    ['chs', 'CHS', 'SL', '√x', 1, 6],
    ['7', '7', '', 'BEG', 1, 7, 'num'],
    ['8', '8', '', 'END', 1, 8, 'num'],
    ['9', '9', '', '', 1, 9, 'num'],
    ['div', '÷', '', '', 1, 10, 'op'],
    ['yx', 'yˣ', 'SOYD', 'eˣ', 2, 1],
    ['inv', '1/x', 'DB', 'LN', 2, 2],
    ['pctt', '%T', '', '', 2, 3],
    ['delta', 'Δ%', '', '', 2, 4],
    ['pct', '%', '', '', 2, 5],
    ['eex', 'EEX', '', '', 2, 6],
    ['4', '4', '', '', 2, 7, 'num'],
    ['5', '5', '', '', 2, 8, 'num'],
    ['6', '6', '', '', 2, 9, 'num'],
    ['mul', '×', '', '', 2, 10, 'op'],
    ['rdown', 'R↓', '', 's', 3, 1],
    ['swap', 'x⇄y', '', 'x̄', 3, 2],
    ['clx', 'CLx', 'FIN', 'REG', 3, 3],
    ['enter', 'ENTER', '', 'LSTx', 3, 4, 'enter', 3],
    ['1', '1', '', '', 3, 7, 'num'],
    ['2', '2', '', '', 3, 8, 'num'],
    ['3', '3', '', '', 3, 9, 'num'],
    ['sub', '−', '', '', 3, 10, 'op'],
    ['on', 'ON', '', '', 4, 1, 'on'],
    ['f', 'f', '', '', 4, 2, 'f'],
    ['g', 'g', '', '', 4, 3, 'g'],
    ['sto', 'STO', '', '', 4, 4],
    ['rcl', 'RCL', '', '', 4, 5],
    ['0', '0', '', '', 4, 7, 'num'],
    ['dot', '·', 'FIX', '', 4, 8, 'num'],
    ['sigma', 'Σ+', '', 'Σ−', 4, 9],
    ['add', '+', '', '', 4, 10, 'op'],
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
      last: 0,
      lift: true,
      fresh: false,
      entry: null,
      shift: null,
      pending: null,
      digits: 2,
      begin: false,
      n: 0,
      i: 0,
      pv: 0,
      pmt: 0,
      fv: 0,
      flows: [],
      regs: {},
      statN: 0,
      statSum: 0,
      statSq: 0,
      error: null,
    };
  }

  function liftStack(state) {
    state.re[3] = state.re[2];
    state.re[2] = state.re[1];
    state.re[1] = state.re[0];
  }

  function dropStack(state) {
    state.re[1] = state.re[2];
    state.re[2] = state.re[3];
  }

  function fail(state, code) {
    state.error = code;
    state.entry = null;
    state.pending = null;
    state.fresh = false;
  }

  function setX(state, value) {
    if (!Number.isFinite(value)) {
      fail(state, 'Error 0');
      return false;
    }
    state.re[0] = value;
    state.lift = true;
    state.fresh = false;
    state.entry = null;
    return true;
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
      state.re[0] = 0;
    }
    state.lift = false;
    state.fresh = true;
    if (!state.entry) state.entry = { man: '', exp: null, expNeg: false, neg: false };
  }

  function digit(state, d) {
    startEntry(state);
    const entry = state.entry;
    if (entry.exp != null) entry.exp = (entry.exp + d).slice(0, 2);
    else if (entry.man.replace('.', '').replace('-', '').length < 10) {
      entry.man = entry.man === '0' ? d : entry.man + d;
    }
  }

  function dot(state) {
    startEntry(state);
    const entry = state.entry;
    if (entry.exp != null) return;
    if (!entry.man.includes('.')) entry.man = entry.man ? `${entry.man}.` : '0.';
  }

  function eex(state) {
    startEntry(state);
    if (state.entry.exp == null) state.entry.exp = '';
  }

  function chs(state) {
    if (state.entry) {
      if (state.entry.exp != null) state.entry.expNeg = !state.entry.expNeg;
      else state.entry.neg = !state.entry.neg;
      return;
    }
    closeEntry(state);
    state.re[0] = -state.re[0];
    state.fresh = false;
  }

  function enter(state) {
    closeEntry(state);
    liftStack(state);
    state.re[0] = state.re[1];
    state.lift = false;
    state.fresh = true;
  }

  function clx(state) {
    state.entry = null;
    state.re[0] = 0;
    state.lift = false;
    state.fresh = false;
  }

  function binary(state, fn) {
    closeEntry(state);
    const y = state.re[1];
    const x = state.re[0];
    state.last = x;
    const value = fn(y, x);
    if (!Number.isFinite(value)) {
      fail(state, 'Error 0');
      return;
    }
    dropStack(state);
    state.re[0] = value;
    state.lift = true;
    state.fresh = false;
    state.entry = null;
  }

  function unary(state, fn) {
    closeEntry(state);
    state.last = state.re[0];
    const value = fn(state.re[0]);
    if (!setX(state, value)) return;
    state.lift = true;
  }

  function xValue(state) {
    closeEntry(state);
    return state.re[0];
  }

  function annuity(n, rate, begin) {
    if (!(n >= 0) || !Number.isFinite(n)) return null;
    if (Math.abs(rate) < 1e-14) return { a: n, b: 1 };
    const b = (1 + rate) ** -n;
    if (!Number.isFinite(b)) return null;
    let a = (1 - b) / rate;
    if (begin) a *= (1 + rate);
    return { a, b };
  }

  function residual(n, iPct, pv, pmt, fv, begin) {
    const factors = annuity(n, iPct / 100, begin);
    if (!factors) return NaN;
    return pv + pmt * factors.a + fv * factors.b;
  }

  function storeFin(state, name) {
    state[name] = xValue(state);
    state.lift = true;
    state.fresh = false;
  }

  function solveFin(state, name) {
    closeEntry(state);
    const { n, i, pv, pmt, fv, begin } = state;
    let value = NaN;
    if (name === 'pv' || name === 'pmt' || name === 'fv') {
      const factors = annuity(n, i / 100, begin);
      if (!factors || Math.abs(factors.a) < 1e-14 || Math.abs(factors.b) < 1e-14) {
        fail(state, 'Error 5');
        return;
      }
      if (name === 'pv') value = -(pmt * factors.a + fv * factors.b);
      if (name === 'fv') value = -(pv + pmt * factors.a) / factors.b;
      if (name === 'pmt') value = -(pv + fv * factors.b) / factors.a;
    } else if (name === 'n') {
      if (Math.abs(i) < 1e-12) {
        value = Math.abs(pmt) < 1e-14 ? NaN : -(pv + fv) / pmt;
      } else {
        const rate = i / 100;
        const left = pmt / rate - fv;
        const right = pv + (begin ? pmt * (1 + rate) : pmt) / rate;
        if (begin) {
          let guess = 12;
          for (let k = 0; k < 40; k += 1) {
            const y1 = residual(guess, i, pv, pmt, fv, begin);
            const y2 = residual(guess + 1e-4, i, pv, pmt, fv, begin);
            const slope = (y2 - y1) / 1e-4;
            if (!Number.isFinite(slope) || Math.abs(slope) < 1e-12) break;
            const next = guess - y1 / slope;
            if (!Number.isFinite(next)) break;
            if (Math.abs(next - guess) < 1e-8) {
              guess = next;
              break;
            }
            guess = next;
          }
          value = guess;
        } else if (left === 0 || right === 0 || left / right <= 0) {
          value = NaN;
        } else {
          value = Math.log(left / right) / Math.log(1 + rate);
        }
      }
    } else if (name === 'i') {
      let guess = Math.abs(i) > 1e-8 ? i : 1;
      for (let k = 0; k < 50; k += 1) {
        const y1 = residual(n, guess, pv, pmt, fv, begin);
        const y2 = residual(n, guess + 1e-4, pv, pmt, fv, begin);
        const slope = (y2 - y1) / 1e-4;
        if (!Number.isFinite(y1)) break;
        if (Math.abs(y1) < 1e-6) break;
        if (!Number.isFinite(slope) || Math.abs(slope) < 1e-12) break;
        const next = guess - y1 / slope;
        if (!Number.isFinite(next)) break;
        if (Math.abs(next - guess) < 1e-9) {
          guess = next;
          break;
        }
        guess = next;
      }
      value = guess;
    }
    if (!Number.isFinite(value)) {
      fail(state, 'Error 5');
      return;
    }
    state[name] = value;
    state.last = state.re[0];
    setX(state, value);
  }

  function finance(state, name) {
    if (state.fresh || state.entry) storeFin(state, name);
    else solveFin(state, name);
  }

  function scaleFin(state, name, factor) {
    const base = state.fresh || state.entry ? xValue(state) : state[name];
    const value = base * factor;
    if (!Number.isFinite(value)) {
      fail(state, 'Error 0');
      return;
    }
    state[name] = value;
    state.last = state.re[0];
    setX(state, value);
  }

  function npvAt(flows, rate) {
    let total = 0;
    let t = 0;
    flows.forEach((flow, index) => {
      const count = Math.max(1, flow.count | 0);
      if (index === 0) {
        total += flow.amount;
        return;
      }
      for (let k = 0; k < count; k += 1) {
        t += 1;
        total += flow.amount / (1 + rate) ** t;
      }
    });
    return total;
  }

  function npv(state) {
    closeEntry(state);
    const rate = state.i / 100;
    if (rate <= -1 || !state.flows.length) {
      fail(state, 'Error 5');
      return;
    }
    const value = npvAt(state.flows, rate);
    if (!setX(state, value)) return;
  }

  function irr(state) {
    closeEntry(state);
    if (state.flows.length < 2) {
      fail(state, 'Error 3');
      return;
    }
    let lo = -0.99;
    let hi = 10;
    let flo = npvAt(state.flows, lo);
    let fhi = npvAt(state.flows, hi);
    if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) {
      fail(state, 'Error 3');
      return;
    }
    for (let k = 0; k < 60; k += 1) {
      const mid = (lo + hi) / 2;
      const fm = npvAt(state.flows, mid);
      if (flo * fm <= 0) {
        hi = mid;
        fhi = fm;
      } else {
        lo = mid;
        flo = fm;
      }
    }
    const value = ((lo + hi) / 2) * 100;
    state.i = value;
    setX(state, value);
  }

  function amort(state) {
    const periods = Math.max(1, Math.round(xValue(state)) || 1);
    const rate = state.i / 100;
    let balance = state.pv;
    let interest = 0;
    let principal = 0;
    for (let k = 0; k < periods; k += 1) {
      const due = balance * rate;
      const prin = state.pmt + due;
      interest += due;
      principal += prin;
      balance += prin;
    }
    state.pv = balance;
    state.n = Math.max(0, state.n - periods);
    state.last = state.re[0];
    state.re[1] = principal;
    setX(state, interest);
  }

  function simpleInterest(state) {
    closeEntry(state);
    const interest = state.pv * (state.i / 100) * (state.n / 360);
    if (!setX(state, interest)) return;
  }

  function roundDisplay(state) {
    closeEntry(state);
    const factor = 10 ** state.digits;
    setX(state, Math.round(state.re[0] * factor) / factor);
  }

  function depreciation(state, method) {
    const year = Math.round(xValue(state));
    const life = state.n;
    const cost = state.pv;
    const salvage = state.fv;
    if (year < 1 || life < 1 || year > life) {
      fail(state, 'Error 5');
      return;
    }
    const base = cost - salvage;
    let dep = 0;
    if (method === 'sl') dep = base / life;
    else if (method === 'soyd') {
      const syd = life * (life + 1) / 2;
      dep = (life - year + 1) / syd * base;
    } else {
      let book = cost;
      const rate = (state.i / 100) / life;
      for (let y = 1; y <= year; y += 1) {
        dep = book * rate;
        book -= dep;
      }
    }
    setX(state, dep);
  }

  function sigma(state, sign) {
    const x = xValue(state);
    state.statN += sign;
    state.statSum += sign * x;
    state.statSq += sign * x * x;
    if (state.statN < 0) state.statN = 0;
    setX(state, state.statN);
  }

  function mean(state) {
    closeEntry(state);
    if (state.statN < 1) {
      fail(state, 'Error 2');
      return;
    }
    setX(state, state.statSum / state.statN);
  }

  function stdev(state) {
    closeEntry(state);
    if (state.statN < 2) {
      fail(state, 'Error 2');
      return;
    }
    const n = state.statN;
    const variance = (state.statSq - (state.statSum ** 2) / n) / (n - 1);
    setX(state, Math.sqrt(Math.max(0, variance)));
  }

  function clearFin(state) {
    state.n = 0;
    state.i = 0;
    state.pv = 0;
    state.pmt = 0;
    state.fv = 0;
    state.flows = [];
    state.begin = false;
  }

  function clearReg(state) {
    state.regs = {};
    state.statN = 0;
    state.statSum = 0;
    state.statSq = 0;
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
      closeEntry(state);
      state.regs[key] = state.re[0];
      state.fresh = false;
      state.lift = true;
      return;
    }
    if (pending === 'rcl') {
      if (state.lift) liftStack(state);
      state.re[0] = state.regs[key] || 0;
      state.entry = null;
      state.lift = true;
      state.fresh = false;
    }
  }

  function dispatch(state, key, shift) {
    if (shift === 'f' && key === 'dot') {
      state.pending = 'fix';
      return;
    }
    if (shift === 'g' && key === '7') {
      state.begin = true;
      return;
    }
    if (shift === 'g' && key === '8') {
      state.begin = false;
      return;
    }
    if (key === 'n') {
      if (shift === 'f') amort(state);
      else if (shift === 'g') scaleFin(state, 'n', 12);
      else finance(state, 'n');
      return;
    }
    if (key === 'i') {
      if (shift === 'f') simpleInterest(state);
      else if (shift === 'g') scaleFin(state, 'i', 1 / 12);
      else finance(state, 'i');
      return;
    }
    if (key === 'pv') {
      if (shift === 'f') npv(state);
      else if (shift === 'g') {
        const amount = xValue(state);
        state.flows = [{ amount, count: 1 }];
        state.fresh = false;
        state.lift = true;
      } else finance(state, 'pv');
      return;
    }
    if (key === 'pmt') {
      if (shift === 'f') roundDisplay(state);
      else if (shift === 'g') {
        const amount = xValue(state);
        if (!state.flows.length) state.flows.push({ amount: 0, count: 1 });
        state.flows.push({ amount, count: 1 });
        state.fresh = false;
        state.lift = true;
      } else finance(state, 'pmt');
      return;
    }
    if (key === 'fv') {
      if (shift === 'f') irr(state);
      else if (shift === 'g') {
        const count = Math.max(1, Math.round(xValue(state)) || 1);
        const last = state.flows[state.flows.length - 1];
        if (last) last.count = count;
        state.fresh = false;
        state.lift = true;
      } else finance(state, 'fv');
      return;
    }
    if (key === 'chs' && shift === 'f') {
      depreciation(state, 'sl');
      return;
    }
    if (key === 'yx' && shift === 'f') {
      depreciation(state, 'soyd');
      return;
    }
    if (key === 'inv' && shift === 'f') {
      depreciation(state, 'db');
      return;
    }
    if (key === 'clx' && shift === 'f') {
      clearFin(state);
      return;
    }
    if (key === 'clx' && shift === 'g') {
      clearReg(state);
      return;
    }
    if (/^[0-9]$/.test(key) && !shift) {
      digit(state, key);
      return;
    }
    const actions = {
      dot: () => dot(state),
      eex: () => eex(state),
      chs: () => (shift === 'g' ? unary(state, (x) => Math.sqrt(x)) : chs(state)),
      enter: () => {
        if (shift === 'g') setX(state, state.last);
        else enter(state);
      },
      add: () => binary(state, (y, x) => y + x),
      sub: () => binary(state, (y, x) => y - x),
      mul: () => binary(state, (y, x) => y * x),
      div: () => binary(state, (y, x) => x === 0 ? NaN : y / x),
      yx: () => (shift === 'g' ? unary(state, Math.exp) : binary(state, (y, x) => y ** x)),
      inv: () => (shift === 'g' ? unary(state, Math.log) : unary(state, (x) => 1 / x)),
      pct: () => {
        closeEntry(state);
        const y = state.re[1];
        state.last = state.re[0];
        setX(state, y * state.re[0] / 100);
        state.re[1] = y;
      },
      delta: () => {
        closeEntry(state);
        const y = state.re[1];
        state.last = state.re[0];
        setX(state, y === 0 ? NaN : (state.re[0] - y) / y * 100);
      },
      pctt: () => {
        closeEntry(state);
        const y = state.re[1];
        state.last = state.re[0];
        setX(state, y === 0 ? NaN : state.re[0] / y * 100);
      },
      rdown: () => {
        if (shift === 'g') {
          stdev(state);
          return;
        }
        closeEntry(state);
        const x = state.re[0];
        state.re[0] = state.re[1];
        state.re[1] = state.re[2];
        state.re[2] = state.re[3];
        state.re[3] = x;
        state.lift = true;
        state.fresh = false;
      },
      swap: () => {
        if (shift === 'g') {
          mean(state);
          return;
        }
        closeEntry(state);
        const x = state.re[0];
        state.re[0] = state.re[1];
        state.re[1] = x;
        state.lift = true;
        state.fresh = false;
      },
      clx: () => clx(state),
      sto: () => { state.pending = 'sto'; },
      rcl: () => { state.pending = 'rcl'; },
      sigma: () => sigma(state, shift === 'g' ? -1 : 1),
    };
    const action = actions[key];
    if (action) action();
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
      return state;
    }
    if (key === 'f' || key === 'g') {
      state.shift = state.shift === key ? null : key;
      return state;
    }
    const shift = state.shift;
    state.shift = null;
    if (state.pending) {
      handlePending(state, key);
      return state;
    }
    dispatch(state, key, shift);
    return state;
  }

  function formatParts(value, digits) {
    if (!Number.isFinite(value)) return { man: 'Error 0', exp: '' };
    const abs = Math.abs(value);
    const sign = value < 0 ? '-' : '';
    if (value !== 0 && (abs >= 1e10 || abs < 5e-11)) {
      const exp = Math.floor(Math.log10(abs));
      const man = abs / 10 ** exp;
      return { man: `${sign}${man.toFixed(Math.min(digits, 6))}`, exp: ` ${exp}` };
    }
    const text = abs.toFixed(digits);
    const [whole, frac] = text.split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return { man: sign + grouped + (frac != null ? `.${frac}` : ''), exp: '' };
  }

  function formatEntry(entry) {
    const sign = entry.neg ? '-' : '';
    const man = entry.man === '' ? '0' : entry.man;
    let exp = '';
    if (entry.exp != null) {
      const flags = entry.expNeg ? '-' : '';
      exp = ` ${flags}${entry.exp || '0'}`;
    }
    return { man: sign + man, exp };
  }

  function readout(state) {
    if (!state.on) return { man: '', exp: '', ann: {} };
    if (state.error) return { man: state.error, exp: '', ann: annunciators(state) };
    const parts = state.entry ? formatEntry(state.entry) : formatParts(state.re[0], state.digits);
    return { man: parts.man, exp: parts.exp, ann: annunciators(state) };
  }

  function annunciators(state) {
    let pend = '';
    if (state.pending === 'sto') pend = 'STO';
    else if (state.pending === 'rcl') pend = 'RCL';
    else if (state.pending === 'fix') pend = 'FIX';
    return {
      f: state.shift === 'f',
      g: state.shift === 'g',
      begin: state.begin,
      pend,
    };
  }

  function stackLines(state) {
    return [3, 2, 1].map((i) => {
      const parts = formatParts(state.re[i], state.digits);
      const tag = i === 3 ? 'T' : i === 2 ? 'Z' : 'Y';
      return `${tag} ${parts.man}${parts.exp || ''}`;
    });
  }

  function resolveFullscreen(cfg) {
    const raw = String(cfg.fullscreen ?? cfg.full ?? '1').trim().toLowerCase();
    if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'compact') return false;
    return true;
  }

  function renderBlock(content, fenceAttrs, options = {}) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const title = String(cfg.title || 'HP-12C').trim() || 'HP-12C';
    const index = Number.isFinite(options.hp12cIndex) ? options.hp12cIndex : 0;
    const fullscreen = resolveFullscreen(cfg);
    const fullClass = fullscreen ? ' hp12c-block--fullscreen' : '';
    const keys = KEYS.map((spec) => {
      const [id, face, gold, blue, row, col, kind, span] = spec;
      const style = `grid-row:${row};grid-column:${col}${span ? ` / span ${span}` : ''}`;
      const classes = ['hp-slot', kind ? `hp-slot--${kind}` : ''].filter(Boolean).join(' ');
      const tip = [gold ? `f ${gold}` : '', face, blue ? `g ${blue}` : ''].filter(Boolean).join(' · ');
      return `<div class="${classes}" style="${style}">`
        + `<div class="hp-f">${escapeHtml(gold)}</div>`
        + `<button type="button" class="hp-key${kind ? ` hp-key--${kind}` : ''}" data-key="${id}" title="${escapeHtml(tip)}" aria-label="${escapeHtml(tip)}">`
        + `<span class="hp-face">${escapeHtml(face)}</span>`
        + `<span class="hp-g">${escapeHtml(blue)}</span>`
        + '</button></div>';
    }).join('');
    const fsButton = (typeof globalThis !== 'undefined' && globalThis.NotesProGameFullscreen?.renderButton?.()) || '';
    return `<div class="hp12c-block${fullClass}" data-hp12-index="${index}" tabindex="0">`
      + fsButton
      + '<div class="hp-bezel">'
      + `<div class="hp-badge">${escapeHtml(title)}</div>`
      + '<div class="hp-tag">RPN financial</div>'
      + '</div>'
      + '<div class="hp-lcd" data-role="lcd">'
      + '<div class="hp-ann">'
      + '<span data-ann="f">f</span><span data-ann="g">g</span><span data-ann="begin">BEGIN</span>'
      + '<span data-ann="pend" class="hp-pend"></span>'
      + '</div>'
      + '<div class="hp-lcd-body">'
      + '<div class="hp-stack" data-role="stack"></div>'
      + '<div class="hp-readout"><div class="hp-value"><span data-role="man"></span><span data-role="exp"></span></div></div>'
      + '</div></div>'
      + `<div class="hp-keys">${keys}</div>`
      + '</div>';
  }

  function paint(el, state) {
    const view = readout(state);
    const lcd = el.querySelector('[data-role="lcd"]');
    lcd.classList.toggle('is-off', !state.on);
    el.querySelector('[data-role="man"]').textContent = view.man;
    el.querySelector('[data-role="exp"]').textContent = view.exp || '';
    const stack = el.querySelector('[data-role="stack"]');
    stack.innerHTML = state.on && !state.error
      ? stackLines(state).map((line) => `<div>${escapeHtml(line)}</div>`).join('')
      : '';
    ['f', 'g', 'begin'].forEach((name) => {
      const node = el.querySelector(`[data-ann="${name}"]`);
      if (node) node.classList.toggle('is-on', !!view.ann[name]);
    });
    const pend = el.querySelector('[data-ann="pend"]');
    if (pend) pend.textContent = view.ann.pend || '';
  }

  function hydrateBlock(el) {
    if (!el || el.dataset.hpReady === '1') return;
    el.dataset.hpReady = '1';
    const key = `hp12:${el.dataset.hp12Index || '0'}`;
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
        Enter: 'enter',
        Backspace: 'clx',
        Escape: 'clx',
        '+': 'add',
        '-': 'sub',
        '*': 'mul',
        '/': 'div',
        '.': 'dot',
        f: 'f',
        g: 'g',
        n: 'n',
        i: 'i',
        p: 'pv',
        '%': 'pct',
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
    if (!Number.isFinite(a) || Math.abs(a - b) > 0.02) throw new Error(`${msg}: ${a} != ${b}`);
  };
  const run = (keys) => {
    const state = api.createState();
    keys.forEach((key) => api.press(state, key));
    return state;
  };
  near(run(['2', 'enter', '3', 'add']).re[0], 5, 'add');
  near(run(['2', '0', '0', 'enter', '1', '0', 'pct']).re[0], 20, 'percent');
  near(run(['1', '0', '0', 'enter', '1', '2', '5', 'delta']).re[0], 25, 'delta');
  const pmt = run([
    '3', '6', '0', 'n',
    '0', 'dot', '5', 'i',
    '1', '0', '0', '0', '0', '0', 'pv',
    '0', 'fv',
    'pmt',
  ]);
  near(pmt.re[0], -599.55, 'pmt');
  const monthly = run(['6', 'g', 'i']);
  near(monthly.i, 0.5, '12x');
  const npv = run([
    '1', '0', 'i',
    '1', '0', '0', 'chs', 'g', 'pv',
    '6', '0', 'g', 'pmt',
    '6', '0', 'g', 'pmt',
    'f', 'pv',
  ]);
  near(npv.re[0], 4.13, 'npv');
  const html = api.renderBlock('', 'title=HP-12C');
  if (!html.includes('hp12c-block--fullscreen') || !html.includes('data-key="pv"') || !html.includes('PMT')) {
    throw new Error('render');
  }
  const compact = api.renderBlock('', 'fullscreen=0');
  if (compact.includes('hp12c-block--fullscreen')) throw new Error('compact fullscreen');
  const shown = api.formatParts(1234.5, 2);
  if (shown.man !== '1,234.50') throw new Error(`format ${shown.man}`);
  console.log('hp12c self-test ok');
}
