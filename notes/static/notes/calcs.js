/**
 * NotesPro engineering calculator for fenced ```calcs``` blocks.
 * Exposes window.NotesProCalcs.renderBlock / parseFenceAttrs.
 */
(function (global) {
  const EPS = 1e-12;
  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function parseFenceAttrs(raw) {
    const config = {};
    String(raw || '').split(';').forEach((part) => {
      const piece = String(part || '').trim();
      if (!piece) return;
      const eq = piece.indexOf('=');
      if (eq <= 0) {
        const key = piece.toLowerCase();
        if (key === 'fix' || key === 'sci' || key === 'eng') config[key] = '4';
        return;
      }
      const key = piece.slice(0, eq).trim().toLowerCase();
      let val = piece.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key) config[key] = val;
    });
    return config;
  }

  function C(re, im) {
    return { k: 'c', re: Number(re) || 0, im: Number(im) || 0 };
  }

  function T(seconds) {
    return { k: 't', sec: Number(seconds) || 0 };
  }

  function V(items) {
    return { k: 'v', items: items.slice() };
  }

  function M(rows) {
    return { k: 'm', rows: rows.map((r) => r.slice()) };
  }

  function L(items) {
    return { k: 'l', items: items.slice() };
  }

  function isC(v) { return v && v.k === 'c'; }
  function isT(v) { return v && v.k === 't'; }
  function isV(v) { return v && v.k === 'v'; }
  function isM(v) { return v && v.k === 'm'; }
  function isL(v) { return v && v.k === 'l'; }
  function isB(v) { return v && v.k === 'b'; }

  function cloneVal(v) {
    if (isC(v)) return C(v.re, v.im);
    if (isT(v)) return T(v.sec);
    if (isB(v)) return { k: 'b', v: !!v.v };
    if (isV(v)) return V(v.items.map(cloneVal));
    if (isL(v)) return L(v.items.map(cloneVal));
    if (isM(v)) return M(v.rows.map((r) => r.map(cloneVal)));
    return v;
  }

  function mag2(z) { return z.re * z.re + z.im * z.im; }
  function mag(z) { return Math.sqrt(mag2(z)); }
  function nearly0(z) { return Math.abs(z.re) < EPS && Math.abs(z.im) < EPS; }
  function isReal(z) { return Math.abs(z.im) < EPS; }
  function isInt(z) { return isReal(z) && Math.abs(z.re - Math.round(z.re)) < 1e-9; }

  function addC(a, b) { return C(a.re + b.re, a.im + b.im); }
  function subC(a, b) { return C(a.re - b.re, a.im - b.im); }
  function mulC(a, b) { return C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re); }
  function divC(a, b) {
    const d = mag2(b);
    if (d < EPS * EPS) throw new Error('Divide by 0');
    return C((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
  }
  function negC(a) { return C(-a.re, -a.im); }
  function conjC(a) { return C(a.re, -a.im); }

  function expC(z) {
    const e = Math.exp(z.re);
    return C(e * Math.cos(z.im), e * Math.sin(z.im));
  }

  function lnC(z) {
    if (nearly0(z)) throw new Error('Log of zero');
    return C(Math.log(mag(z)), Math.atan2(z.im, z.re));
  }

  function sqrtC(z) {
    if (nearly0(z)) return C(0, 0);
    const r = mag(z);
    const re = Math.sqrt(Math.max(0, (r + z.re) / 2));
    let im = Math.sqrt(Math.max(0, (r - z.re) / 2));
    if (z.im < 0) im = -im;
    return C(re, im);
  }

  function sinC(z) {
    return C(Math.sin(z.re) * Math.cosh(z.im), Math.cos(z.re) * Math.sinh(z.im));
  }

  function cosC(z) {
    return C(Math.cos(z.re) * Math.cosh(z.im), -Math.sin(z.re) * Math.sinh(z.im));
  }

  function tanC(z) { return divC(sinC(z), cosC(z)); }

  function asinC(z) {
    // -i * ln(i*z + sqrt(1 - z^2))
    const i = C(0, 1);
    return mulC(C(0, -1), lnC(addC(mulC(i, z), sqrtC(subC(C(1, 0), mulC(z, z))))));
  }

  function atanC(z) {
    // (i/2) * ln((1 - i z) / (1 + i z))
    const iz = mulC(C(0, 1), z);
    return mulC(C(0, 0.5), lnC(divC(subC(C(1, 0), iz), addC(C(1, 0), iz))));
  }

  function powC(a, b) {
    if (isInt(b) && Math.abs(b.re) <= 64) {
      return powIntC(a, Math.round(b.re));
    }
    if (nearly0(a)) {
      if (b.re > 0) return C(0, 0);
      throw new Error('0 to a non-positive power');
    }
    return expC(mulC(b, lnC(a)));
  }

  function powIntC(a, n) {
    if (n === 0) return C(1, 0);
    if (n < 0) return divC(C(1, 0), powIntC(a, -n));
    let acc = C(1, 0);
    let base = a;
    let e = n;
    while (e > 0) {
      if (e & 1) acc = mulC(acc, base);
      base = mulC(base, base);
      e >>= 1;
    }
    return acc;
  }

  function hoursToTime(z) {
    if (!isC(z) || !isReal(z)) throw new Error('Expected a real number of hours');
    return T(z.re * 3600);
  }

  function timeToHours(t) {
    return C(t.sec / 3600, 0);
  }

  function shapeError(op) {
    throw new Error(`Incompatible shapes for ${op}`);
  }

  function vecLen(v) { return v.items.length; }

  function matShape(m) {
    const r = m.rows.length;
    const c = r ? m.rows[0].length : 0;
    return [r, c];
  }

  function assertRect(m) {
    const cols = m.rows[0] ? m.rows[0].length : 0;
    m.rows.forEach((row) => {
      if (row.length !== cols) throw new Error('Jagged matrix');
    });
  }

  function mapC(val, fn) {
    if (isC(val)) return fn(val);
    if (isV(val)) return V(val.items.map((x) => mapC(x, fn)));
    if (isM(val)) return M(val.rows.map((row) => row.map((x) => mapC(x, fn))));
    throw new Error('Expected a numeric value');
  }

  function zipBin(a, b, fn, op) {
    if (isC(a) && isC(b)) return fn(a, b);
    if (isC(a) && (isV(b) || isM(b))) return mapC(b, (x) => fn(a, x));
    if ((isV(a) || isM(a)) && isC(b)) return mapC(a, (x) => fn(x, b));
    if (isV(a) && isV(b)) {
      if (vecLen(a) !== vecLen(b)) shapeError(op);
      return V(a.items.map((x, i) => fn(x, b.items[i])));
    }
    if (isM(a) && isM(b)) {
      const [r1, c1] = matShape(a);
      const [r2, c2] = matShape(b);
      if (r1 !== r2 || c1 !== c2) shapeError(op);
      return M(a.rows.map((row, i) => row.map((x, j) => fn(x, b.rows[i][j]))));
    }
    shapeError(op);
  }

  function addVal(a, b) {
    if (isT(a) || isT(b)) {
      const ta = isT(a) ? a : hoursToTime(a);
      const tb = isT(b) ? b : hoursToTime(b);
      return T(ta.sec + tb.sec);
    }
    return zipBin(a, b, addC, '+');
  }

  function subVal(a, b) {
    if (isT(a) || isT(b)) {
      const ta = isT(a) ? a : hoursToTime(a);
      const tb = isT(b) ? b : hoursToTime(b);
      return T(ta.sec - tb.sec);
    }
    return zipBin(a, b, subC, '-');
  }

  function mulMatMat(a, b) {
    const [r1, c1] = matShape(a);
    const [r2, c2] = matShape(b);
    if (c1 !== r2) shapeError('*');
    const out = [];
    for (let i = 0; i < r1; i += 1) {
      const row = [];
      for (let j = 0; j < c2; j += 1) {
        let s = C(0, 0);
        for (let k = 0; k < c1; k += 1) s = addC(s, mulC(a.rows[i][k], b.rows[k][j]));
        row.push(s);
      }
      out.push(row);
    }
    return M(out);
  }

  function mulMatVec(m, v) {
    const [r, c] = matShape(m);
    if (c !== vecLen(v)) shapeError('*');
    return V(m.rows.map((row) => {
      let s = C(0, 0);
      row.forEach((x, j) => { s = addC(s, mulC(x, v.items[j])); });
      return s;
    }));
  }

  function mulVal(a, b) {
    if (isT(a) || isT(b)) {
      if (isT(a) && isT(b)) throw new Error('Cannot multiply two times');
      const t = isT(a) ? a : b;
      const n = isT(a) ? b : a;
      if (!isC(n) || !isReal(n)) throw new Error('Time scale must be real');
      return T(t.sec * n.re);
    }
    if (isM(a) && isM(b)) return mulMatMat(a, b);
    if (isM(a) && isV(b)) return mulMatVec(a, b);
    if (isV(a) && isM(b)) {
      // row vector * matrix
      const row = M([a.items]);
      const prod = mulMatMat(row, b);
      return V(prod.rows[0]);
    }
    return zipBin(a, b, mulC, '*');
  }

  function divVal(a, b) {
    if (isT(a) || isT(b)) {
      if (isT(a) && isT(b)) return C(a.sec / b.sec, 0);
      if (isT(a) && isC(b) && isReal(b)) {
        if (Math.abs(b.re) < EPS) throw new Error('Divide by 0');
        return T(a.sec / b.re);
      }
      throw new Error('Invalid time division');
    }
    return zipBin(a, b, divC, '/');
  }

  function negVal(a) {
    if (isT(a)) return T(-a.sec);
    return mapC(a, negC);
  }

  function flattenNums(val, acc) {
    if (isC(val)) { acc.push(val); return acc; }
    if (isV(val)) { val.items.forEach((x) => flattenNums(x, acc)); return acc; }
    if (isM(val)) { val.rows.forEach((row) => row.forEach((x) => flattenNums(x, acc))); return acc; }
    throw new Error('Cannot flatten value');
  }

  function identMat(n) {
    const rows = [];
    for (let i = 0; i < n; i += 1) {
      const row = [];
      for (let j = 0; j < n; j += 1) row.push(C(i === j ? 1 : 0, 0));
      rows.push(row);
    }
    return M(rows);
  }

  function invMat(m) {
    assertRect(m);
    const [n, c] = matShape(m);
    if (n !== c) throw new Error('Inverse requires a square matrix');
    const a = m.rows.map((row, i) => row.concat(identMat(n).rows[i]).map(cloneVal));
    for (let col = 0; col < n; col += 1) {
      let piv = col;
      let best = mag2(a[col][col]);
      for (let r = col + 1; r < n; r += 1) {
        const mm = mag2(a[r][col]);
        if (mm > best) { best = mm; piv = r; }
      }
      if (best < EPS * EPS) throw new Error('Matrix is singular');
      if (piv !== col) {
        const tmp = a[col];
        a[col] = a[piv];
        a[piv] = tmp;
      }
      const diag = a[col][col];
      for (let j = 0; j < 2 * n; j += 1) a[col][j] = divC(a[col][j], diag);
      for (let r = 0; r < n; r += 1) {
        if (r === col) continue;
        const f = a[r][col];
        if (nearly0(f)) continue;
        for (let j = 0; j < 2 * n; j += 1) a[r][j] = subC(a[r][j], mulC(f, a[col][j]));
      }
    }
    return M(a.map((row) => row.slice(n)));
  }

  function invVal(val) {
    if (isC(val)) return divC(C(1, 0), val);
    if (isM(val)) return invMat(val);
    throw new Error('inv() expects a scalar or square matrix');
  }

  function powIntMat(m, n) {
    if (n === 0) {
      const [r, c] = matShape(m);
      if (r !== c) throw new Error('Identity requires a square matrix');
      return identMat(r);
    }
    if (n < 0) return powIntMat(invMat(m), -n);
    let acc = identMat(matShape(m)[0]);
    let base = m;
    let e = n;
    while (e > 0) {
      if (e & 1) acc = mulMatMat(acc, base);
      base = mulMatMat(base, base);
      e >>= 1;
    }
    return acc;
  }

  function powVal(a, b) {
    if (isM(a) && isC(b) && isInt(b)) return powIntMat(a, Math.round(b.re));
    if (isC(a) && isC(b)) return powC(a, b);
    if ((isV(a) || isM(a)) && isC(b)) return mapC(a, (x) => powC(x, b));
    throw new Error('Invalid power');
  }

  function absVal(val) {
    if (isC(val)) return C(mag(val), 0);
    if (isT(val)) return T(Math.abs(val.sec));
    const nums = flattenNums(val, []);
    let s = 0;
    nums.forEach((z) => { s += mag2(z); });
    return C(Math.sqrt(s), 0);
  }

  function sumVal(val) {
    if (isT(val)) return cloneVal(val);
    const nums = flattenNums(val, []);
    return nums.reduce((acc, z) => addC(acc, z), C(0, 0));
  }

  function asReal(val) {
    if (isC(val) && isReal(val)) return val.re;
    throw new Error('Expected a real number');
  }

  function asBool(val) {
    if (isB(val)) return !!val.v;
    if (isC(val)) return !nearly0(val);
    throw new Error('Expected true or false');
  }

  function asRealList(val, name) {
    let items;
    if (isV(val)) items = val.items;
    else if (isL(val) && val.items.every(isC)) items = val.items;
    else if (isM(val) && matShape(val)[0] === 1) items = val.rows[0];
    else if (isM(val) && matShape(val)[1] === 1) items = val.rows.map((r) => r[0]);
    else throw new Error(`${name} expects a vector`);
    return items.map((x) => {
      if (!isC(x)) throw new Error(`${name} values must be numeric`);
      return x.re;
    });
  }

  function makeRange(a, b) {
    if (!isC(a) || !isC(b) || !isReal(a) || !isReal(b)) throw new Error('Range bounds must be real');
    const start = isInt(a) && isInt(b) ? Math.round(a.re) : a.re;
    const end = isInt(a) && isInt(b) ? Math.round(b.re) : b.re;
    const step = end >= start ? 1 : -1;
    const n = Math.floor(Math.abs(end - start)) + 1;
    if (n > 100000) throw new Error('Range too large');
    const items = [];
    if (isInt(a) && isInt(b)) {
      for (let i = start; step > 0 ? i <= end : i >= end; i += step) items.push(C(i, 0));
    } else {
      for (let i = 0; i < n; i += 1) items.push(C(start + i * step, 0));
    }
    return V(items);
  }

  function indexGet(val, idx) {
    if (!isV(val) && !isL(val)) throw new Error('Index out of range');
    const items = val.items;
    if (isC(idx) && isInt(idx)) {
      const i = Math.round(idx.re);
      if (i < 0 || i >= items.length) throw new Error('Index out of range');
      return cloneVal(items[i]);
    }
    if (isV(idx)) {
      if (vecLen(idx) === items.length) return cloneVal(val);
      return V(idx.items.map((x) => indexGet(val, x)));
    }
    throw new Error('Index out of range');
  }

  function indexSet(env, name, idx, val) {
    if (isV(idx)) {
      const n = vecLen(idx);
      if (isC(val) || isT(val)) {
        env[name] = V(Array.from({ length: n }, () => cloneVal(val)));
      } else if (isV(val)) {
        if (vecLen(val) !== n) throw new Error('Index out of range');
        env[name] = cloneVal(val);
      } else {
        throw new Error('Indexed assignment expects a scalar or vector');
      }
      return env[name];
    }
    if (!isC(idx) || !isInt(idx)) throw new Error('Index out of range');
    const i = Math.round(idx.re);
    let vec = env[name];
    if (!isV(vec)) vec = V([]);
    if (i < 0 || i >= vecLen(vec)) throw new Error('Index out of range');
    vec.items[i] = cloneVal(val);
    env[name] = vec;
    return cloneVal(val);
  }

  function pairItems(val) {
    if (isL(val)) return val.items;
    if (isV(val) && val.items.length === 2 && (isV(val.items[0]) || isL(val.items[0]))) return val.items;
    return null;
  }

  function isSegmentMatrix(val) {
    return isM(val) && matShape(val)[1] === 4 && matShape(val)[0] > 0;
  }

  function buildPlot(args) {
    const series = [];
    const segments = [];
    const addSegments = (m) => {
      m.rows.forEach((row) => {
        row.forEach((x) => { if (!isC(x)) throw new Error('Plot segments must be numeric'); });
        segments.push({
          x0: row[0].re, y0: row[1].re, x1: row[2].re, y1: row[3].re,
        });
      });
    };
    const addSeriesPair = (xVal, yVal) => {
      const xs = asRealList(xVal, 'Plot');
      const ys = asRealList(yVal, 'Plot');
      if (xs.length !== ys.length) throw new Error('Plot(x, y) length mismatch');
      series.push({ xs, ys });
    };

    if (args.length === 2 && isV(args[0]) && args[0].items.every(isC) && isV(args[1]) && args[1].items.every(isC)) {
      addSeriesPair(args[0], args[1]);
      return { k: 'plot', series, segments };
    }

    args.forEach((arg) => {
      if (isSegmentMatrix(arg)) {
        addSegments(arg);
        return;
      }
      const pair = pairItems(arg);
      if (pair && pair.length === 2) {
        addSeriesPair(pair[0], pair[1]);
        return;
      }
      if (isV(arg) && arg.items.every(isC)) {
        const ys = asRealList(arg, 'Plot');
        series.push({ xs: ys.map((_, i) => i + 1), ys });
        return;
      }
      throw new Error('Plot(y), Plot(x, y), Plot([x, y], …), or Plot(segments)');
    });
    return { k: 'plot', series, segments };
  }

  function applyFormat(fmt, mode, args) {
    const digits = args[0] !== undefined ? Math.round(asReal(args[0])) : 7;
    if (!Number.isFinite(digits) || digits < 0 || digits > 16) throw new Error('Digits must be 0–16');
    const trim = args[1] === undefined ? true : asBool(args[1]);
    fmt.mode = mode;
    fmt.digits = digits;
    fmt.trim = trim;
    return { k: 'fmt' };
  }

  function createFuns(fmt) {
    return {
      inv: (args) => { if (args.length !== 1) throw new Error('inv(x)'); return invVal(args[0]); },
      sqrt: (args) => { if (args.length !== 1) throw new Error('sqrt(x)'); return mapC(args[0], sqrtC); },
      sqr: (args) => { if (args.length !== 1) throw new Error('sqr(x)'); return mulVal(args[0], args[0]); },
      exp: (args) => { if (args.length !== 1) throw new Error('exp(x)'); return mapC(args[0], expC); },
      ln: (args) => { if (args.length !== 1) throw new Error('ln(x)'); return mapC(args[0], lnC); },
      log: (args) => { if (args.length !== 1) throw new Error('log(x)'); return mapC(args[0], lnC); },
      sin: (args) => { if (args.length !== 1) throw new Error('sin(x)'); return mapC(args[0], sinC); },
      cos: (args) => { if (args.length !== 1) throw new Error('cos(x)'); return mapC(args[0], cosC); },
      tan: (args) => { if (args.length !== 1) throw new Error('tan(x)'); return mapC(args[0], tanC); },
      asin: (args) => { if (args.length !== 1) throw new Error('asin(x)'); return mapC(args[0], asinC); },
      atan: (args) => { if (args.length !== 1) throw new Error('atan(x)'); return mapC(args[0], atanC); },
      abs: (args) => { if (args.length !== 1) throw new Error('abs(x)'); return absVal(args[0]); },
      sum: (args) => { if (args.length !== 1) throw new Error('sum(x)'); return sumVal(args[0]); },
      conj: (args) => { if (args.length !== 1) throw new Error('conj(x)'); return mapC(args[0], conjC); },
      re: (args) => { if (args.length !== 1) throw new Error('re(x)'); return mapC(args[0], (z) => C(z.re, 0)); },
      im: (args) => { if (args.length !== 1) throw new Error('im(x)'); return mapC(args[0], (z) => C(z.im, 0)); },
      plot: (args) => buildPlot(args),
      sci: (args) => applyFormat(fmt, 'sci', args),
      eng: (args) => applyFormat(fmt, 'eng', args),
      fix: (args) => applyFormat(fmt, 'fix', args),
    };
  }

  function stripLineComment(line) {
    let out = '';
    for (let i = 0; i < line.length; i += 1) {
      if (line[i] === '#' || (line[i] === '/' && line[i + 1] === '/')) break;
      out += line[i];
    }
    return out;
  }

  function stripBlockComments(text) {
    return String(text || '')
      .replace(/\(\*[\s\S]*?\*\)/g, ' ')
      .replace(/\{[^{}]*\}/g, ' ');
  }

  function countDepth(text) {
    let d = 0;
    for (const ch of text) {
      if (ch === '(' || ch === '[') d += 1;
      else if (ch === ')' || ch === ']') d -= 1;
    }
    return d;
  }

  function logicalLines(content) {
    const raw = stripBlockComments(String(content || '').replace(/\r\n/g, '\n')).split('\n');
    const out = [];
    let buf = '';
    let depth = 0;
    raw.forEach((line) => {
      const code = stripLineComment(line);
      depth += countDepth(code);
      buf = buf ? `${buf}\n${line}` : line;
      if (depth <= 0) {
        out.push(buf);
        buf = '';
        depth = 0;
      }
    });
    if (buf.trim()) out.push(buf);
    return out;
  }

  const ID_RE = /^(?:[\p{L}_])[\p{L}\p{N}_]*/u;

  function tokenize(src) {
    let s = stripLineComment(String(src || '')).replace(/\s+/g, ' ').trim();
    s = s.replace(/^=\s*/, '').replace(/\s*=\s*$/, '');
    const tokens = [];
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (/\s/.test(ch)) { i += 1; continue; }
      if (s.startsWith(':=', i)) { tokens.push({ t: ':=' }); i += 2; continue; }
      if (s.startsWith('..', i)) { tokens.push({ t: '..' }); i += 2; continue; }
      if (ch === '%') { tokens.push({ t: 'unit', v: '%' }); i += 1; continue; }
      if ('+-*/^(),[]'.includes(ch)) { tokens.push({ t: ch }); i += 1; continue; }
      if (/\d/.test(ch) || (ch === '.' && /\d/.test(s[i + 1] || ''))) {
        const time = s.slice(i).match(/^(\d+):(\d{2})(?::(\d{2}))?/);
        if (time) {
          const h = parseInt(time[1], 10);
          const m = parseInt(time[2], 10);
          const sec = time[3] ? parseInt(time[3], 10) : 0;
          if (m > 59 || sec > 59) throw new Error(`Invalid time ${time[0]}`);
          tokens.push({ t: 'time', v: T(h * 3600 + m * 60 + sec) });
          i += time[0].length;
          continue;
        }
        // Do not treat `10..20` as `10.` + `.20` — `..` is the range operator.
        let lex;
        if (ch === '.') {
          lex = (s.slice(i).match(/^\.\d+(?:[eE][+-]?\d+)?/) || [])[0];
        } else {
          lex = (s.slice(i).match(/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/) || [])[0];
        }
        if (!lex) throw new Error('Bad number');
        i += lex.length;
        if (/^[ij](?![\p{L}\p{N}_])/u.test(s.slice(i))) {
          tokens.push({ t: 'num', v: C(0, parseFloat(lex)) });
          i += 1;
          continue;
        }
        tokens.push({ t: 'num', v: C(parseFloat(lex), 0) });
        continue;
      }
      const id = s.slice(i).match(ID_RE);
      if (id) {
        const name = id[0];
        const low = name.toLowerCase();
        if (low === 'true' || low === 'false') tokens.push({ t: 'bool', v: { k: 'b', v: low === 'true' } });
        else tokens.push({ t: 'id', v: name });
        i += name.length;
        continue;
      }
      throw new Error(`Unexpected “${ch}”`);
    }
    return tokens;
  }

  function lookupConst(name) {
    const low = name.toLowerCase();
    if (low === 'pi' || name === 'π') return C(Math.PI, 0);
    if (low === 'e') return C(Math.E, 0);
    if (low === 'i' || low === 'j') return C(0, 1);
    return null;
  }

  function parseTokens(tokens, env, fmt) {
    const funs = createFuns(fmt);
    let p = 0;
    const peek = () => tokens[p] || { t: 'eof' };
    const peekAt = (off) => tokens[p + off] || { t: 'eof' };
    const eat = (t) => {
      const tok = peek();
      if (t && tok.t !== t) throw new Error(`Expected ${t}`);
      p += 1;
      return tok;
    };

    function knownName(name) {
      if (Object.prototype.hasOwnProperty.call(env, name)) return true;
      if (lookupConst(name)) return true;
      if (funs[name.toLowerCase()]) return true;
      return false;
    }

    function parseList(close) {
      const items = [];
      if (peek().t === close) { eat(close); return items; }
      items.push(parseExpr());
      while (peek().t === ',') {
        eat(',');
        items.push(parseExpr());
      }
      eat(close);
      return items;
    }

    function packTuple(items) {
      if (items.length === 1) return items[0];
      if (items.length && items.every(isV)) {
        const n = vecLen(items[0]);
        if (items.every((v) => vecLen(v) === n && v.items.every(isC))) {
          return M(items.map((v) => v.items.map(cloneVal)));
        }
      }
      if (items.every(isC)) return V(items);
      return L(items);
    }

    function parsePrimary() {
      const tok = peek();
      if (tok.t === 'num' || tok.t === 'time' || tok.t === 'bool') { eat(); return tok.v; }
      if (tok.t === 'id') {
        const name = eat().v;
        if (peek().t === '(') {
          eat('(');
          const args = parseList(')');
          const fn = funs[name.toLowerCase()];
          if (!fn) throw new Error(`Unknown function ${name}`);
          return fn(args);
        }
        if (Object.prototype.hasOwnProperty.call(env, name)) return cloneVal(env[name]);
        const cnst = lookupConst(name);
        if (cnst) return cnst;
        throw new Error(`Unknown name ${name}`);
      }
      if (tok.t === '(') {
        eat('(');
        return packTuple(parseList(')'));
      }
      if (tok.t === '[') {
        eat('[');
        const items = parseList(']');
        if (items.every(isC)) return V(items);
        return L(items);
      }
      throw new Error('Expected a value');
    }

    function parsePostfix() {
      let left = parsePrimary();
      while (peek().t === '[') {
        eat('[');
        const idx = parseExpr();
        eat(']');
        left = indexGet(left, idx);
      }
      return left;
    }

    function parseUnary() {
      if (peek().t === '+' || peek().t === '-') {
        const op = eat().t;
        const v = parseUnary();
        return op === '-' ? negVal(v) : v;
      }
      return parsePostfix();
    }

    function parsePow() {
      const left = parseUnary();
      if (peek().t === '^') {
        eat('^');
        return powVal(left, parsePow());
      }
      return left;
    }

    function startsImplicitValue(tok) {
      if (tok.t === 'num' || tok.t === 'time' || tok.t === '(' || tok.t === '[') return true;
      if (tok.t !== 'id') return false;
      if (peekAt(1).t === ':=') return false;
      if (peekAt(1).t === '[') return false;
      if (!knownName(tok.v)) return false;
      return true;
    }

    function parseMul() {
      let left = parsePow();
      while (true) {
        const tok = peek();
        if (tok.t === '*' || tok.t === '/') {
          const op = eat().t;
          const right = parsePow();
          left = op === '*' ? mulVal(left, right) : divVal(left, right);
          continue;
        }
        if (startsImplicitValue(tok)) {
          left = mulVal(left, parsePow());
          continue;
        }
        break;
      }
      return left;
    }

    function parseAdd() {
      let left = parseMul();
      while (peek().t === '+' || peek().t === '-') {
        const op = eat().t;
        const right = parseMul();
        left = op === '+' ? addVal(left, right) : subVal(left, right);
      }
      return left;
    }

    function parseExpr() {
      const left = parseAdd();
      if (peek().t === '..') {
        eat('..');
        return makeRange(left, parseAdd());
      }
      return left;
    }

    function skipUnits() {
      while (peek().t === 'unit' || (peek().t === 'id' && !knownName(peek().v) && peekAt(1).t !== ':=' && peekAt(1).t !== '(' && peekAt(1).t !== '[')) {
        eat();
      }
    }

    function parseStatement() {
      if (peek().t === 'id' && peekAt(1).t === ':=') {
        const name = eat().v;
        eat(':=');
        const val = parseExpr();
        skipUnits();
        if (val.k === 'plot') throw new Error('Cannot assign a plot');
        env[name] = cloneVal(val);
        return val;
      }
      if (peek().t === 'id' && peekAt(1).t === '[') {
        const name = eat().v;
        eat('[');
        const idx = parseExpr();
        eat(']');
        if (peek().t === ':=') {
          eat(':=');
          const val = parseExpr();
          skipUnits();
          return indexSet(env, name, idx, val);
        }
        if (!Object.prototype.hasOwnProperty.call(env, name)) {
          throw new Error(`Unknown name ${name}`);
        }
        let left = indexGet(env[name], idx);
        while (peek().t === '[') {
          eat('[');
          left = indexGet(left, parseExpr());
          eat(']');
        }
        skipUnits();
        return left;
      }
      const val = parseExpr();
      skipUnits();
      return val;
    }

    function parseLine() {
      const values = [];
      values.push(parseStatement());
      while (peek().t !== 'eof') {
        if (peek().t === 'id' && (peekAt(1).t === ':=' || peekAt(1).t === '[' || peekAt(1).t === 'eof')) {
          values.push(parseStatement());
          continue;
        }
        throw new Error('Unexpected input');
      }
      const plot = [...values].reverse().find((v) => v && v.k === 'plot');
      return plot || values[values.length - 1];
    }

    return parseLine();
  }

  function parseFormatCommand(line) {
    const m = String(line || '').trim().match(/^(FIX|SCI|ENG)\s*(\d+)?\s*$/i);
    if (!m) return null;
    const digits = m[2] !== undefined ? parseInt(m[2], 10) : 4;
    if (!Number.isFinite(digits) || digits < 0 || digits > 16) throw new Error('Digits must be 0–16');
    return { mode: m[1].toLowerCase(), digits };
  }

  function trimZeros(text) {
    if (!text.includes('.')) return text;
    return text.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  }

  function formatSciExp(exp) {
    const sign = exp >= 0 ? '+' : '-';
    return `E${sign}${String(Math.abs(exp)).padStart(3, '0')}`;
  }

  function formatNumber(n, fmt) {
    if (!Number.isFinite(n)) return String(n);
    const d = fmt.digits;
    const trim = fmt.trim !== false;
    if (fmt.mode === 'sci') {
      if (n === 0) {
        const mant = (0).toFixed(Math.max(0, d - 1));
        return `${trim ? trimZeros(mant) : mant}${formatSciExp(0)}`;
      }
      const exp = Math.floor(Math.log10(Math.abs(n)));
      const mant = n / (10 ** exp);
      const text = mant.toFixed(Math.max(0, d - 1));
      return `${trim ? trimZeros(text) : text}${formatSciExp(exp)}`;
    }
    if (fmt.mode === 'eng') {
      if (n === 0) {
        const mant = (0).toFixed(d);
        return `${trim ? trimZeros(mant) : mant}E0`;
      }
      const exp = Math.floor(Math.log10(Math.abs(n)));
      const eng = Math.floor(exp / 3) * 3;
      const mant = n / (10 ** eng);
      const text = mant.toFixed(d);
      return `${trim ? trimZeros(text) : text}E${eng}`;
    }
    const text = n.toFixed(d);
    return trim ? trimZeros(text) : text;
  }

  function formatComplex(z, fmt) {
    const re = formatNumber(z.re, fmt);
    if (Math.abs(z.im) < EPS) return re;
    const imAbs = formatNumber(Math.abs(z.im), fmt);
    const sign = z.im < 0 ? '-' : '+';
    if (Math.abs(z.re) < EPS) return `${z.im < 0 ? '-' : ''}${imAbs}i`;
    return `${re}${sign}${imAbs}i`;
  }

  function formatTime(t) {
    const sign = t.sec < 0 ? '-' : '';
    let sec = Math.round(Math.abs(t.sec));
    const h = Math.floor(sec / 3600);
    sec -= h * 3600;
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    const mm = String(m).padStart(2, '0');
    if (s) return `${sign}${h}:${mm}:${String(s).padStart(2, '0')}`;
    return `${sign}${h}:${mm}`;
  }

  function formatValueHtml(val, fmt) {
    if (!val) return '';
    if (val.k === 'plot') return renderPlotSvg(val);
    if (isT(val)) return escapeHtml(formatTime(val));
    if (isC(val)) return escapeHtml(formatComplex(val, fmt));
    if (isB(val)) return val.v ? 'true' : 'false';
    if (isV(val) || isL(val)) {
      const inner = val.items.map((x) => {
        if (isC(x)) return formatComplex(x, fmt);
        if (isV(x) || isL(x) || isM(x)) return formatValueHtml(x, fmt).replace(/<[^>]+>/g, '');
        return '?';
      }).join(', ');
      return escapeHtml(`(${inner})`);
    }
    if (isM(val)) {
      const rows = val.rows.map((row) => (
        `<tr>${row.map((x) => `<td>${escapeHtml(isC(x) ? formatComplex(x, fmt) : '?')}</td>`).join('')}</tr>`
      )).join('');
      return `<table class="calcs-matrix">${rows}</table>`;
    }
    return escapeHtml(String(val));
  }

  const PLOT_COLORS = ['#2563eb', '#ea580c', '#16a34a', '#dc2626', '#7c3aed', '#0891b2'];

  function renderPlotSvg(plot) {
    const w = 460;
    const h = 200;
    const pad = { l: 40, r: 12, t: 10, b: 24 };
    const series = plot.series || (plot.xs ? [{ xs: plot.xs, ys: plot.ys }] : []);
    const segments = plot.segments || [];
    const xs = [
      ...series.flatMap((s) => s.xs),
      ...segments.flatMap((s) => [s.x0, s.x1]),
    ];
    const ys = [
      ...series.flatMap((s) => s.ys),
      ...segments.flatMap((s) => [s.y0, s.y1]),
    ];
    if (!xs.length) return '<span class="calcs-empty">empty plot</span>';
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    const x0 = pad.l;
    const y0 = pad.t;
    const iw = w - pad.l - pad.r;
    const ih = h - pad.t - pad.b;
    const px = (x) => x0 + ((x - minX) / spanX) * iw;
    const py = (y) => y0 + ih - ((y - minY) / spanY) * ih;
    const ticks = [0, 0.5, 1].map((t) => {
      const yv = minY + spanY * t;
      const y = py(yv);
      return `<line class="calcs-plot-grid" x1="${x0}" y1="${y}" x2="${x0 + iw}" y2="${y}"/>`
        + `<text class="calcs-plot-tick" x="${x0 - 4}" y="${y + 3}" text-anchor="end">${escapeHtml(String(Number(yv.toPrecision(4))))}</text>`;
    }).join('');
    const lines = series.map((s, i) => {
      const color = PLOT_COLORS[i % PLOT_COLORS.length];
      const pts = s.xs.map((x, j) => `${px(x).toFixed(1)},${py(s.ys[j]).toFixed(1)}`).join(' ');
      return `<polyline class="calcs-plot-line" stroke="${color}" points="${pts}"/>`;
    }).join('');
    const segColor = PLOT_COLORS[series.length % PLOT_COLORS.length];
    const segs = segments.map((s) => (
      `<line class="calcs-plot-line" stroke="${segColor}" x1="${px(s.x0).toFixed(1)}" y1="${py(s.y0).toFixed(1)}" x2="${px(s.x1).toFixed(1)}" y2="${py(s.y1).toFixed(1)}"/>`
    )).join('');
    return [
      `<svg class="calcs-plot" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="plot">`,
      `<rect class="calcs-plot-bg" x="0" y="0" width="${w}" height="${h}"/>`,
      ticks,
      lines,
      segs,
      '</svg>',
    ].join('');
  }

  function formatLabel(fmt) {
    const trim = fmt.trim === false ? ' pad' : ' trim';
    return `${fmt.mode.toUpperCase()} ${fmt.digits}${trim}`;
  }

  function initialFormat(cfg) {
    const trim = String(cfg.trim || '').toLowerCase();
    const base = { trim: !(trim === 'false' || trim === '0' || trim === 'no') };
    if (cfg.sci !== undefined) return { ...base, mode: 'sci', digits: clampDigits(cfg.sci) };
    if (cfg.eng !== undefined) return { ...base, mode: 'eng', digits: clampDigits(cfg.eng) };
    if (cfg.fix !== undefined) return { ...base, mode: 'fix', digits: clampDigits(cfg.fix) };
    return { ...base, mode: 'fix', digits: 7 };
  }

  function clampDigits(raw) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return 4;
    return Math.max(0, Math.min(12, n));
  }

  function themeClass(cfg) {
    const col = String(cfg.col || cfg.color || 'info').toLowerCase();
    return THEMES.includes(col) ? col : 'info';
  }

  function evaluateLine(raw, env, fmt) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return { kind: 'empty' };
    if (/^(#|\/\/)/.test(trimmed)) return { kind: 'empty' };
    const fmtCmd = parseFormatCommand(stripLineComment(trimmed));
    if (fmtCmd) {
      fmt.mode = fmtCmd.mode;
      fmt.digits = fmtCmd.digits;
      return { kind: 'format', fmt: { ...fmt } };
    }
    const tokens = tokenize(trimmed);
    if (!tokens.length) return { kind: 'empty' };
    const value = parseTokens(tokens, env, fmt);
    if (value && value.k === 'fmt') return { kind: 'format', fmt: { ...fmt } };
    return { kind: 'value', value };
  }

  function renderBlock(content, fenceAttrs) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const fmt = initialFormat(cfg);
    const startFmt = formatLabel(fmt);
    const env = Object.create(null);
    const lines = logicalLines(content);
    const rows = [];
    lines.forEach((line) => {
      const src = line.replace(/\s+$/, '');
      if (!src.trim()) return;
      try {
        const out = evaluateLine(src, env, fmt);
        if (out.kind === 'empty') return;
        if (out.kind === 'format') {
          rows.push(`<div class="calcs-row"><div class="calcs-src"><code>${escapeHtml(src)}</code></div>`
            + `<div class="calcs-out calcs-format">${escapeHtml(formatLabel(out.fmt))}</div></div>`);
          return;
        }
        rows.push(`<div class="calcs-row"><div class="calcs-src"><code>${escapeHtml(src)}</code></div>`
          + `<div class="calcs-out">${formatValueHtml(out.value, fmt)}</div></div>`);
      } catch (err) {
        rows.push(`<div class="calcs-row"><div class="calcs-src"><code>${escapeHtml(src)}</code></div>`
          + `<div class="calcs-out calcs-error">${escapeHtml(err.message || String(err))}</div></div>`);
      }
    });
    const title = String(cfg.title || 'Calc').trim() || 'Calc';
    const theme = themeClass(cfg);
    const body = rows.length ? rows.join('') : '<div class="calcs-empty">No expressions.</div>';
    return [
      `<div class="calcs-block calcs-block--${escapeHtml(theme)}">`,
      `<div class="calcs-block-header"><span class="calcs-block-title">${escapeHtml(title)}</span>`,
      `<span class="calcs-block-meta">${escapeHtml(startFmt)}</span></div>`,
      `<div class="calcs-rows">${body}</div></div>`,
    ].join('');
  }

  const api = {
    parseFenceAttrs,
    renderBlock,
    evaluateLine,
    formatValueHtml,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.NotesProCalcs = api;
})(typeof window !== 'undefined' ? window : globalThis);
