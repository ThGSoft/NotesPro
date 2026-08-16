/**
 * NotesPro ```calcs``` engine — real/complex scalars, vectors, matrices,
 * FIX/ENG/SCI display, and SVG plots.
 */
(function (root, factory) {
  const api = factory();
  root.NotesProCalcs = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EPS = 1e-12;
  const ARRAY_PREVIEW = 10;
  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];
  const FORMAT_CMDS = { FIX: 'fix', ENG: 'eng', SCI: 'sci' };

  function complex(re, im) {
    return { kind: 'c', re: +re || 0, im: +im || 0 };
  }

  function vector(items) {
    return { kind: 'v', items: items.slice() };
  }

  function matrix(rows) {
    return { kind: 'm', rows: rows.map(r => r.slice()) };
  }

  function plotVal(series) {
    return { kind: 'plot', series };
  }

  function timeVal(seconds, withSeconds) {
    return { kind: 't', sec: +seconds || 0, withSeconds: !!withSeconds };
  }

  function isC(v) { return v && v.kind === 'c'; }
  function isV(v) { return v && v.kind === 'v'; }
  function isM(v) { return v && v.kind === 'm'; }
  function isPlot(v) { return v && v.kind === 'plot'; }
  function isT(v) { return v && v.kind === 't'; }

  function nearly(a, b) { return Math.abs(a - b) < EPS; }
  function isZeroC(z) { return nearly(z.re, 0) && nearly(z.im, 0); }
  function isReal(z) { return nearly(z.im, 0); }

  function cloneVal(v) {
    if (isC(v)) return complex(v.re, v.im);
    if (isV(v)) {
      const out = vector(v.items.map(cloneVal));
      if (v.__plotName) out.__plotName = v.__plotName;
      if (v.__indexOrigin != null) out.__indexOrigin = v.__indexOrigin;
      return out;
    }
    if (isM(v)) return matrix(v.rows.map(row => row.map(cloneVal)));
    if (isPlot(v)) return plotVal(v.series.map(s => ({ x: s.x.slice(), y: s.y.slice(), name: s.name })));
    if (isT(v)) return timeVal(v.sec, v.withSeconds);
    return v;
  }

  function cAdd(a, b) { return complex(a.re + b.re, a.im + b.im); }
  function cSub(a, b) { return complex(a.re - b.re, a.im - b.im); }
  function cMul(a, b) {
    return complex(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
  }
  function cDiv(a, b) {
    const d = b.re * b.re + b.im * b.im;
    if (d < EPS * EPS) throw new Error('Division by zero');
    return complex((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
  }
  function cNeg(a) { return complex(-a.re, -a.im); }
  function cAbs(a) { return Math.hypot(a.re, a.im); }
  function cArg(a) { return Math.atan2(a.im, a.re); }
  function cConj(a) { return complex(a.re, -a.im); }

  function cExp(a) {
    const e = Math.exp(a.re);
    return complex(e * Math.cos(a.im), e * Math.sin(a.im));
  }
  function cLn(a) {
    const r = cAbs(a);
    if (r < EPS) throw new Error('ln of zero');
    return complex(Math.log(r), cArg(a));
  }
  function cSqrt(a) {
    const r = cAbs(a);
    if (r < EPS) return complex(0, 0);
    const t = cArg(a) / 2;
    const s = Math.sqrt(r);
    return complex(s * Math.cos(t), s * Math.sin(t));
  }
  function cPow(a, b) {
    if (isZeroC(a)) {
      if (isZeroC(b)) return complex(1, 0);
      if (isReal(b) && b.re > 0) return complex(0, 0);
      throw new Error('0^x is undefined for this exponent');
    }
    return cExp(cMul(b, cLn(a)));
  }
  function cSin(a) {
    return complex(
      Math.sin(a.re) * Math.cosh(a.im),
      Math.cos(a.re) * Math.sinh(a.im),
    );
  }
  function cCos(a) {
    return complex(
      Math.cos(a.re) * Math.cosh(a.im),
      -Math.sin(a.re) * Math.sinh(a.im),
    );
  }
  function cTan(a) { return cDiv(cSin(a), cCos(a)); }
  function cAsin(a) {
    // -i ln(i z + sqrt(1 - z^2))
    const i = complex(0, 1);
    const one = complex(1, 0);
    return cMul(cNeg(i), cLn(cAdd(cMul(i, a), cSqrt(cSub(one, cMul(a, a))))));
  }
  function cAcos(a) {
    const i = complex(0, 1);
    const one = complex(1, 0);
    return cMul(cNeg(i), cLn(cAdd(a, cMul(i, cSqrt(cSub(one, cMul(a, a)))))));
  }
  function cAtan(a) {
    const i = complex(0, 1);
    const one = complex(1, 0);
    return cMul(cDiv(i, complex(2, 0)), cSub(cLn(cSub(one, cMul(i, a))), cLn(cAdd(one, cMul(i, a)))));
  }

  function expectC(v, name) {
    if (!isC(v)) throw new Error(`${name} expects a scalar`);
    return v;
  }

  function mapScalar(v, fn, name) {
    if (isT(v)) return fn(complex(v.sec / 3600, 0));
    if (isC(v)) return fn(v);
    if (isV(v)) return vector(v.items.map(x => mapScalar(x, fn, name)));
    if (isM(v)) return matrix(v.rows.map(row => row.map(x => mapScalar(x, fn, name))));
    throw new Error(`${name} cannot be applied to this value`);
  }

  function shapeOf(v) {
    if (isC(v)) return [1, 1];
    if (isV(v)) return [1, v.items.length];
    if (isM(v)) return [v.rows.length, v.rows[0] ? v.rows[0].length : 0];
    return [0, 0];
  }

  function asMatrix(v) {
    if (isM(v)) return v;
    if (isV(v)) return matrix([v.items.map(cloneVal)]);
    if (isC(v)) return matrix([[cloneVal(v)]]);
    throw new Error('Expected a number, vector, or matrix');
  }

  function sameShape(a, b) {
    const sa = shapeOf(a);
    const sb = shapeOf(b);
    return sa[0] === sb[0] && sa[1] === sb[1];
  }

  function zipBin(a, b, fn, name) {
    if (isC(a) && isC(b)) return fn(a, b);
    if (isC(a)) return mapScalar(b, x => fn(a, x), name);
    if (isC(b)) return mapScalar(a, x => fn(x, b), name);
    if (isV(a) && isV(b)) {
      if (a.items.length !== b.items.length) throw new Error(`${name}: vector length mismatch`);
      return vector(a.items.map((x, i) => zipBin(x, b.items[i], fn, name)));
    }
    if (isM(a) && isM(b)) {
      if (!sameShape(a, b)) throw new Error(`${name}: matrix size mismatch`);
      return matrix(a.rows.map((row, i) => row.map((x, j) => zipBin(x, b.rows[i][j], fn, name))));
    }
    throw new Error(`${name}: incompatible types`);
  }

  function matMul(a, b) {
    const A = asMatrix(a);
    const B = asMatrix(b);
    const n = A.rows.length;
    const m = A.rows[0].length;
    const p = B.rows[0].length;
    if (B.rows.length !== m) throw new Error('Matrix multiply: inner dimensions must agree');
    const out = [];
    for (let i = 0; i < n; i += 1) {
      const row = [];
      for (let j = 0; j < p; j += 1) {
        let s = complex(0, 0);
        for (let k = 0; k < m; k += 1) s = cAdd(s, cMul(A.rows[i][k], B.rows[k][j]));
        row.push(s);
      }
      out.push(row);
    }
    if (isV(a) && isV(b) && n === 1 && p === 1) return out[0][0];
    if (isC(a) || isC(b)) return out[0][0];
    if (isV(b) && p === 1) return vector(out.map(r => r[0]));
    if (n === 1 && isV(a)) return vector(out[0]);
    return matrix(out);
  }

  function identity(n) {
    const rows = [];
    for (let i = 0; i < n; i += 1) {
      const row = [];
      for (let j = 0; j < n; j += 1) row.push(complex(i === j ? 1 : 0, 0));
      rows.push(row);
    }
    return matrix(rows);
  }

  function matInv(v) {
    if (isC(v)) {
      if (isZeroC(v)) throw new Error('inv of zero');
      return cDiv(complex(1, 0), v);
    }
    if (isV(v)) return vector(v.items.map(x => matInv(x)));
    if (!isM(v)) throw new Error('inv expects a scalar or square matrix');
    const n = v.rows.length;
    if (!n || v.rows.some(r => r.length !== n)) throw new Error('inv expects a square matrix');
    const a = v.rows.map((row, i) => row.map(cloneVal).concat(identity(n).rows[i].map(cloneVal)));
    for (let col = 0; col < n; col += 1) {
      let piv = col;
      let best = cAbs(a[col][col]);
      for (let r = col + 1; r < n; r += 1) {
        const mag = cAbs(a[r][col]);
        if (mag > best) { best = mag; piv = r; }
      }
      if (best < EPS) throw new Error('Matrix is singular');
      if (piv !== col) {
        const tmp = a[col];
        a[col] = a[piv];
        a[piv] = tmp;
      }
      const div = a[col][col];
      for (let c = 0; c < 2 * n; c += 1) a[col][c] = cDiv(a[col][c], div);
      for (let r = 0; r < n; r += 1) {
        if (r === col) continue;
        const f = a[r][col];
        if (isZeroC(f)) continue;
        for (let c = 0; c < 2 * n; c += 1) a[r][c] = cSub(a[r][c], cMul(f, a[col][c]));
      }
    }
    return matrix(a.map(row => row.slice(n)));
  }

  function matPowInt(m, n) {
    if (n < 0) return matPowInt(matInv(m), -n);
    if (n === 0) {
      if (!isM(m)) return complex(1, 0);
      const d = m.rows.length;
      if (m.rows.some(r => r.length !== d)) throw new Error('A^0 requires a square matrix');
      return identity(d);
    }
    let acc = isM(m) ? identity(m.rows.length) : complex(1, 0);
    let base = cloneVal(m);
    let e = n;
    while (e > 0) {
      if (e & 1) acc = isM(m) ? matMul(acc, base) : cMul(acc, base);
      e >>= 1;
      if (e) base = isM(m) ? matMul(base, base) : cMul(base, base);
    }
    return acc;
  }

  function powVal(a, b) {
    if (isC(a) && isC(b)) {
      if (isReal(b) && nearly(b.re, Math.round(b.re)) && Math.abs(b.re) <= 1e6) {
        return matPowInt(a, Math.round(b.re));
      }
      return cPow(a, b);
    }
    if (isM(a) && isC(b) && isReal(b) && nearly(b.re, Math.round(b.re))) {
      return matPowInt(a, Math.round(b.re));
    }
    if ((isV(a) || isM(a)) && isC(b)) {
      return mapScalar(a, x => powVal(x, b), '^');
    }
    throw new Error('Unsupported power');
  }

  function mulVal(a, b) {
    if (isT(a) && isC(b) && isReal(b)) return timeVal(a.sec * b.re, a.withSeconds);
    if (isT(b) && isC(a) && isReal(a)) return timeVal(b.sec * a.re, b.withSeconds);
    if (isT(a) || isT(b)) throw new Error('*: multiply time by a real scalar');
    if (isM(a) || isM(b)) {
      if (isC(a) || isC(b)) return zipBin(a, b, cMul, '*');
      return matMul(a, b);
    }
    if (isV(a) && isV(b)) return zipBin(a, b, cMul, '*');
    return zipBin(a, b, cMul, '*');
  }

  function toTimeParts(v, op) {
    if (isT(v)) return { sec: v.sec, withSeconds: v.withSeconds };
    if (isC(v) && isReal(v)) return { sec: v.re * 3600, withSeconds: false };
    throw new Error(`${op}: expected a time or hours`);
  }

  function timeBin(a, b, fn, op) {
    const left = toTimeParts(a, op);
    const right = toTimeParts(b, op);
    return timeVal(fn(left.sec, right.sec), left.withSeconds || right.withSeconds);
  }

  function addVal(a, b) {
    if (isT(a) || isT(b)) return timeBin(a, b, (x, y) => x + y, '+');
    return zipBin(a, b, cAdd, '+');
  }
  function subVal(a, b) {
    if (isT(a) || isT(b)) return timeBin(a, b, (x, y) => x - y, '-');
    return zipBin(a, b, cSub, '-');
  }
  function divVal(a, b) {
    if (isT(a) && isT(b)) {
      if (Math.abs(b.sec) < EPS) throw new Error('Division by zero');
      return complex(a.sec / b.sec, 0);
    }
    if (isT(a) && isC(b) && isReal(b)) {
      if (Math.abs(b.re) < EPS) throw new Error('Division by zero');
      return timeVal(a.sec / b.re, a.withSeconds);
    }
    if (isM(b) && !isC(a)) throw new Error('Use inv(A) or A^-1 to divide by a matrix');
    return zipBin(a, b, cDiv, '/');
  }

  function sumVal(v) {
    if (isC(v) || isT(v)) return cloneVal(v);
    if (isV(v)) return v.items.reduce((s, x) => addVal(s, sumVal(x)), complex(0, 0));
    if (isM(v)) return v.rows.reduce((s, row) => addVal(s, sumVal(vector(row))), complex(0, 0));
    throw new Error('sum expects a number, vector, or matrix');
  }

  function realScalar(v, label) {
    if (isC(v) && isReal(v)) return v.re;
    throw new Error(label || 'Expected a real scalar');
  }

  function intScalar(v, label) {
    const n = realScalar(v, label);
    if (!nearly(n, Math.round(n))) throw new Error(label || 'Expected an integer index');
    return Math.round(n);
  }

  function vectorSlotIndex(idx, indexOrigin) {
    const i = intScalar(idx, 'Index must be an integer');
    if (indexOrigin === 1) {
      if (i < 1) throw new Error('Index must be >= 1');
      return i - 1;
    }
    if (i < 0) throw new Error('Index must be non-negative');
    return i;
  }

  function getVectorElement(arr, idx) {
    if (!isV(arr)) throw new Error('Not a vector');
    const pos = vectorSlotIndex(idx, arr.__indexOrigin || 0);
    if (pos < 0 || pos >= arr.items.length) throw new Error(`Index ${intScalar(idx, 'Index')} out of range`);
    return cloneVal(arr.items[pos]);
  }

  function detectIndexOrigin(indexValues, existing) {
    if (existing && isV(existing) && existing.__indexOrigin != null) {
      return existing.__indexOrigin;
    }
    if (!indexValues.length) return 0;
    const min = Math.min(...indexValues.map(v => intScalar(v, 'Index must be an integer')));
    return min >= 1 ? 1 : 0;
  }

  function evalSlotIndexedAssign(name, indexValues, exprAst, env) {
    // Literal indices / ranges (d[1]:=…, d[1..3]:=…) — values are slot positions.
    const existing = lookupVar(env, name);
    let items = existing && isV(existing) ? existing.items.map(cloneVal) : [];
    const origin = detectIndexOrigin(indexValues, existing);

    for (const idxVal of indexValues) {
      const pos = vectorSlotIndex(idxVal, origin);
      while (items.length <= pos) items.push(complex(0, 0));
      items[pos] = cloneVal(evalAst(exprAst, env));
    }

    const result = vector(items);
    result.__plotName = name;
    result.__indexOrigin = origin;
    env.vars[name] = result;
    return result;
  }

  function evalDomainIndexedAssign(name, indexValues, exprAst, env, indexName) {
    // Named domain (y3[j]:=(j*j)/100 with j:=-10..10) — pack densely; j is the
    // loop value, not a storage index. Result length matches the domain vector.
    const items = indexValues.map((idxVal) => {
      const loopVars = { [indexName]: cloneVal(idxVal) };
      return cloneVal(evalAst(exprAst, childEnv(env, loopVars)));
    });
    const result = vector(items);
    result.__plotName = name;
    result.__indexOrigin = 0;
    result.__domain = vector(indexValues.map(cloneVal));
    env.vars[name] = result;
    return result;
  }

  function evalScalarIndexedAssign(name, indexVal, exprAst, env) {
    return evalSlotIndexedAssign(name, [indexVal], exprAst, env);
  }

  function vectorFromRange(start, end) {
    const a = intScalar(start, 'Range start must be an integer');
    const b = intScalar(end, 'Range end must be an integer');
    const items = [];
    if (a <= b) {
      for (let n = a; n <= b; n += 1) items.push(complex(n, 0));
    } else {
      for (let n = a; n >= b; n -= 1) items.push(complex(n, 0));
    }
    return vector(items);
  }

  function flattenReals(v, out) {
    if (isT(v)) {
      out.push(v.sec / 3600);
      return;
    }
    if (isC(v)) {
      out.push(isReal(v) ? v.re : cAbs(v));
      return;
    }
    if (isV(v)) { v.items.forEach(x => flattenReals(x, out)); return; }
    if (isM(v)) { v.rows.forEach(row => row.forEach(x => flattenReals(x, out))); return; }
  }

  function plotLegendLabel(name, idx) {
    const raw = String(name || `y${idx + 1}`);
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }

  function seriesFromPairArg(arg) {
    if (!isV(arg) || arg.items.length !== 2 || !isV(arg.items[0]) || !isV(arg.items[1])) return null;
    const x = [];
    const y = [];
    flattenReals(arg.items[0], x);
    flattenReals(arg.items[1], y);
    const n = Math.min(x.length, y.length);
    if (!n) return null;
    return {
      x: x.slice(0, n),
      y: y.slice(0, n),
      name: arg.items[1].__plotName || arg.__plotName || 'y',
    };
  }

  function toPlotSeries(args) {
    if (!args.length) throw new Error('plot: missing data');
    const pairs = args.map(seriesFromPairArg);
    if (pairs.length === args.length && pairs.every(Boolean)) return pairs;
    if (args.length === 1) {
      const arg = args[0];
      const singlePair = seriesFromPairArg(arg);
      if (singlePair) return [singlePair];
      if (isV(arg)) {
        const y = [];
        flattenReals(arg, y);
        if (!y.length) throw new Error('plot: empty data');
        return [{ x: y.map((_, i) => i), y, name: arg.__plotName || 'y1' }];
      }
      return toXY(args);
    }
    if (args.every(isV)) {
      return args.map((arg, idx) => {
        const y = [];
        flattenReals(arg, y);
        if (!y.length) throw new Error(`plot: empty series ${idx + 1}`);
        return { x: y.map((_, i) => i), y, name: arg.__plotName || `y${idx + 1}` };
      });
    }
    throw new Error('plot: use Plot(y1, y2, …) or Plot([x,y1],[x,y2])');
  }

  function toXY(args) {
    if (args.length === 1) {
      const y = [];
      flattenReals(args[0], y);
      if (!y.length) throw new Error('plot: empty data');
      return [{ x: y.map((_, i) => i), y, name: 'y' }];
    }
    if (args.length === 2) {
      const x = [];
      const y = [];
      flattenReals(args[0], x);
      flattenReals(args[1], y);
      const n = Math.min(x.length, y.length);
      if (!n) throw new Error('plot: empty data');
      return [{ x: x.slice(0, n), y: y.slice(0, n), name: 'y' }];
    }
    throw new Error('plot([y]) or plot(x, y)');
  }

  function tokenize(src) {
    const tokens = [];
    let i = 0;
    const s = String(src || '');
    const push = (type, value) => tokens.push({ type, value });
    while (i < s.length) {
      const ch = s[i];
      if (ch === ' ' || ch === '\t' || ch === '\r') { i += 1; continue; }
      if (ch === '#' || (ch === '/' && s[i + 1] === '/')) break;
      if (ch === ':' && s[i + 1] === '=') { push('ASSIGN'); i += 2; continue; }
      if (ch === '.' && s[i + 1] === '.') { push('RANGE'); i += 2; continue; }
      if ('+-*/^(),[]'.includes(ch)) {
        const map = {
          '+': 'PLUS', '-': 'MINUS', '*': 'STAR', '/': 'SLASH', '^': 'CARET',
          '(': 'LP', ')': 'RP', '[': 'LB', ']': 'RB', ',': 'COMMA',
        };
        push(map[ch]);
        i += 1;
        continue;
      }
      if (/[0-9.]/.test(ch)) {
        const time = s.slice(i).match(/^(\d{1,5}):([0-5]\d)(?::([0-5]\d))?/);
        if (time) {
          const hours = parseInt(time[1], 10);
          const minutes = parseInt(time[2], 10);
          const seconds = time[3] != null ? parseInt(time[3], 10) : 0;
          push('NUM', timeVal(hours * 3600 + minutes * 60 + seconds, time[3] != null));
          i += time[0].length;
          continue;
        }
        // 0..n must not be tokenized as 0. followed by .2…
        const rangeStart = s.slice(i).match(/^(\d+)\.\./);
        if (rangeStart) {
          push('NUM', complex(parseInt(rangeStart[1], 10), 0));
          i += rangeStart[1].length;
          continue;
        }
        const m = s.slice(i).match(/^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?([iIjJ])?/);
        if (!m) throw new Error(`Bad number near "${s.slice(i, i + 8)}"`);
        const num = parseFloat(m[1] + (m[2] || ''));
        if (m[3]) push('NUM', complex(0, num));
        else push('NUM', complex(num, 0));
        i += m[0].length;
        continue;
      }
      if (/[A-Za-z_]/.test(ch)) {
        const m = s.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
        const name = m[0];
        const upper = name.toUpperCase();
        if (FORMAT_CMDS[upper]) push('FMT', FORMAT_CMDS[upper]);
        else push('ID', name);
        i += name.length;
        continue;
      }
      throw new Error(`Unexpected "${ch}"`);
    }
    push('EOL');
    return tokens;
  }

  function parseLine(src) {
    const tokens = tokenize(src);
    let p = 0;
    const peek = () => tokens[p];
    const eat = (type) => {
      if (peek().type !== type) return null;
      const t = peek();
      p += 1;
      return t;
    };
    const expect = (type, msg) => {
      const t = eat(type);
      if (!t) throw new Error(msg || `Expected ${type}`);
      return t;
    };

    function parsePrimary() {
      if (eat('NUM')) {
        const n = tokens[p - 1].value;
        return { type: 'num', value: n };
      }
      if (peek().type === 'ID') {
        const name = eat('ID').value;
        if (eat('LB')) {
          const index = parseRangeExpr();
          expect('RB', `Missing ] after ${name}[`);
          return { type: 'subscript', name, index };
        }
        if (eat('LP')) {
          const args = [];
          if (peek().type !== 'RP') {
            args.push(parseRangeExpr());
            while (eat('COMMA')) args.push(parseRangeExpr());
          }
          expect('RP', `Missing ) after ${name}(`);
          return { type: 'call', name, args };
        }
        return { type: 'id', name };
      }
      if (eat('LP') || eat('LB')) {
        const closer = tokens[p - 1].type === 'LP' ? 'RP' : 'RB';
        if (peek().type === closer) {
          eat(closer);
          return { type: 'vec', items: [] };
        }
        const items = [parseRangeExpr()];
        while (eat('COMMA')) items.push(parseRangeExpr());
        expect(closer, 'Missing closing ) or ]');
        if (items.length === 1 && closer === 'RP') return items[0];
        return { type: 'vec', items };
      }
      throw new Error('Expected a value');
    }

    function parseUnary() {
      if (eat('MINUS')) return { type: 'neg', inner: parseUnary() };
      if (eat('PLUS')) return parseUnary();
      return parsePrimary();
    }

    function parsePower() {
      let left = parseUnary();
      while (eat('CARET')) {
        left = { type: 'pow', left, right: parseUnary() };
      }
      return left;
    }

    function parseTerm() {
      let left = parsePower();
      while (peek().type === 'STAR' || peek().type === 'SLASH') {
        const op = eat(peek().type).type === 'STAR' ? 'mul' : 'div';
        left = { type: op, left, right: parsePower() };
      }
      return left;
    }

    function parseAddExpr() {
      let left = parseTerm();
      while (peek().type === 'PLUS' || peek().type === 'MINUS') {
        const op = eat(peek().type).type === 'PLUS' ? 'add' : 'sub';
        left = { type: op, left, right: parseTerm() };
      }
      return left;
    }

    function parseRangeExpr() {
      let left = parseAddExpr();
      while (eat('RANGE')) {
        left = { type: 'range', left, right: parseAddExpr() };
      }
      return left;
    }

    if (peek().type === 'EOL') return { type: 'empty' };
    if (peek().type === 'FMT') {
      const mode = eat('FMT').value;
      let digits = null;
      if (peek().type === 'NUM') digits = Math.round(eat('NUM').value.re);
      else if (eat('LP')) {
        if (peek().type === 'NUM') digits = Math.round(eat('NUM').value.re);
        expect('RP', 'Missing ) after format');
      }
      return { type: 'format', mode, digits };
    }
    if (peek().type === 'ID' && tokens[p + 1] && tokens[p + 1].type === 'LB') {
      const saveP = p;
      const name = eat('ID').value;
      eat('LB');
      const index = parseRangeExpr();
      expect('RB', `Missing ] after ${name}[`);
      if (eat('ASSIGN')) {
        return { type: 'indexed_assign', name, index, expr: parseRangeExpr() };
      }
      p = saveP;
    }
    if (peek().type === 'ID' && tokens[p + 1] && tokens[p + 1].type === 'ASSIGN') {
      const name = eat('ID').value;
      eat('ASSIGN');
      return { type: 'assign', name, expr: parseRangeExpr() };
    }
    return { type: 'expr', expr: parseRangeExpr() };
  }

  function listToValue(items) {
    if (items.length && items.every(isV)) {
      const w = items[0].items.length;
      if (w && items.every(v => v.items.length === w && v.items.every(isC))) {
        return matrix(items.map(v => v.items.map(cloneVal)));
      }
    }
    if (items.length && items.every(isC)) return vector(items);
    if (items.length === 1) return items[0];
    return vector(items);
  }

  function childEnv(env, extraVars) {
    return { vars: { ...env.vars, ...extraVars }, format: env.format };
  }

  function evalIndexedAssign(name, indexAst, exprAst, env) {
    if (indexAst.type !== 'id') {
      const indexVal = evalAst(indexAst, env);
      if (isC(indexVal)) return evalScalarIndexedAssign(name, indexVal, exprAst, env);
      if (!isV(indexVal)) throw new Error('index must be a vector, range, or scalar');
      return evalSlotIndexedAssign(name, indexVal.items, exprAst, env);
    }

    const indexName = indexAst.name;
    const idxVar = lookupVar(env, indexName);
    if (!idxVar) throw new Error(`Unknown index "${indexName}"`);
    if (!isV(idxVar)) {
      if (isC(idxVar) && isReal(idxVar) && nearly(idxVar.im, 1)) {
        throw new Error(`${indexName} must be a vector index (use another name, or assign ${indexName}:=0..n first — ${indexName} is the imaginary unit)`);
      }
      throw new Error(`${indexName} must be a vector index`);
    }
    // y[j]:=f(j) — j is a domain vector (may include negatives); pack by position.
    return evalDomainIndexedAssign(name, idxVar.items, exprAst, env, indexName);
  }

  function evalAst(ast, env) {
    switch (ast.type) {
      case 'num': return cloneVal(ast.value);
      case 'id': {
        const found = lookupVar(env, ast.name);
        if (!found) throw new Error(`Unknown name "${ast.name}"`);
        return cloneVal(found);
      }
      case 'neg': {
        const inner = evalAst(ast.inner, env);
        if (isT(inner)) return timeVal(-inner.sec, inner.withSeconds);
        return mapScalar(inner, cNeg, 'unary -');
      }
      case 'add': return addVal(evalAst(ast.left, env), evalAst(ast.right, env));
      case 'sub': return subVal(evalAst(ast.left, env), evalAst(ast.right, env));
      case 'mul': return mulVal(evalAst(ast.left, env), evalAst(ast.right, env));
      case 'div': return divVal(evalAst(ast.left, env), evalAst(ast.right, env));
      case 'pow': return powVal(evalAst(ast.left, env), evalAst(ast.right, env));
      case 'range': return vectorFromRange(evalAst(ast.left, env), evalAst(ast.right, env));
      case 'subscript': {
        const arr = lookupVar(env, ast.name);
        if (!arr) throw new Error(`Unknown name "${ast.name}"`);
        const idx = evalAst(ast.index, env);
        if (isV(arr)) {
          if (isV(idx)) return vector(idx.items.map(i => getVectorElement(arr, i)));
          return getVectorElement(arr, idx);
        }
        throw new Error(`${ast.name} is not subscriptable`);
      }
      case 'vec': return listToValue(ast.items.map(it => evalAst(it, env)));
      case 'call': return evalCall(ast.name, ast.args.map(a => evalAst(a, env)), env);
      default: throw new Error('Internal parse error');
    }
  }

  function evalCall(name, args, env) {
    const fn = name.toLowerCase();
    const one = (label, impl) => {
      if (args.length !== 1) throw new Error(`${label}(x)`);
      return mapScalar(args[0], impl, label);
    };
    switch (fn) {
      case 'sqrt': return one('sqrt', cSqrt);
      case 'sqr': return one('sqr', z => cMul(z, z));
      case 'exp': return one('exp', cExp);
      case 'ln': case 'log': return one('ln', cLn);
      case 'sin': return one('sin', cSin);
      case 'cos': return one('cos', cCos);
      case 'tan': return one('tan', cTan);
      case 'asin': return one('asin', cAsin);
      case 'acos': return one('acos', cAcos);
      case 'atan': return one('atan', cAtan);
      case 'abs': {
        const v = need(args, 1, 'abs');
        if (isT(v)) return timeVal(Math.abs(v.sec), v.withSeconds);
        return mapScalar(v, z => complex(cAbs(z), 0), 'abs');
      }
      case 'inv':
        if (args.length !== 1) throw new Error('inv(x)');
        return matInv(args[0]);
      case 'sum':
        if (args.length !== 1) throw new Error('sum(v)');
        return sumVal(args[0]);
      case 'plot':
        return plotVal(toPlotSeries(args));
      case 're': return one('re', z => complex(z.re, 0));
      case 'im': return one('im', z => complex(z.im, 0));
      case 'conj': return one('conj', cConj);
      default:
        if (Object.prototype.hasOwnProperty.call(env.vars, name)) {
          throw new Error(`"${name}" is not a function`);
        }
        throw new Error(`Unknown function ${name}()`);
    }
  }

  function need(args, n, label) {
    if (args.length !== n) throw new Error(`${label} expects ${n} argument(s)`);
    return args[0];
  }

  function lookupVar(env, name) {
    if (Object.prototype.hasOwnProperty.call(env.vars, name)) return env.vars[name];
    const lower = String(name).toLowerCase();
    const key = Object.keys(env.vars).find(k => k.toLowerCase() === lower);
    return key ? env.vars[key] : null;
  }

  function defaultEnv() {
    return {
      vars: {
        pi: complex(Math.PI, 0),
        e: complex(Math.E, 0),
        i: complex(0, 1),
        j: complex(0, 1),
      },
      format: { mode: 'fix', digits: 4 },
    };
  }

  function applyFenceFormat(env, attrs) {
    const cfg = parseFenceAttrs(attrs);
    const digitsOf = (key, fallback) => {
      const n = parseInt(cfg[key], 10);
      return Number.isFinite(n) ? clampDigits(n) : fallback;
    };
    if (cfg.fix != null) env.format = { mode: 'fix', digits: digitsOf('fix', 4) };
    else if (cfg.sci != null) env.format = { mode: 'sci', digits: digitsOf('sci', 4) };
    else if (cfg.eng != null) env.format = { mode: 'eng', digits: digitsOf('eng', 3) };
    return cfg;
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

  function clampDigits(n) {
    return Math.max(0, Math.min(12, n));
  }

  function formatMantExp(value, digits, eng) {
    if (!Number.isFinite(value)) return String(value);
    if (value === 0) return `0.${'0'.repeat(digits)}e0`;
    const sign = value < 0 ? '-' : '';
    const abs = Math.abs(value);
    let exp = Math.floor(Math.log10(abs));
    if (eng) {
      const rem = ((exp % 3) + 3) % 3;
      exp -= rem;
    }
    const mant = abs / (10 ** exp);
    return `${sign}${mant.toFixed(digits)}e${exp}`;
  }

  function formatReal(value, fmt) {
    if (!Number.isFinite(value)) return String(value);
    const d = clampDigits(fmt.digits);
    if (fmt.mode === 'sci') return formatMantExp(value, d, false);
    if (fmt.mode === 'eng') return formatMantExp(value, d, true);
    return value.toFixed(d);
  }

  function formatComplex(z, fmt) {
    if (isReal(z)) return formatReal(z.re, fmt);
    if (nearly(z.re, 0)) {
      const im = formatReal(z.im, fmt);
      return z.im < 0 ? `${im}i` : `${im}i`;
    }
    const re = formatReal(z.re, fmt);
    const imAbs = formatReal(Math.abs(z.im), fmt);
    return z.im < 0 ? `${re} - ${imAbs}i` : `${re} + ${imAbs}i`;
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function formatTime(v) {
    const sign = v.sec < 0 ? '-' : '';
    let rest = Math.round(Math.abs(v.sec));
    const hours = Math.floor(rest / 3600);
    rest -= hours * 3600;
    const minutes = Math.floor(rest / 60);
    rest -= minutes * 60;
    if (v.withSeconds || rest) return `${sign}${hours}:${pad2(minutes)}:${pad2(rest)}`;
    return `${sign}${hours}:${pad2(minutes)}`;
  }

  function formatVector(v, fmt) {
    const items = v.items;
    if (items.length <= ARRAY_PREVIEW) {
      return `(${items.map(x => formatValue(x, fmt)).join(', ')})`;
    }
    const head = items.slice(0, ARRAY_PREVIEW).map(x => formatValue(x, fmt)).join(', ');
    return `(${head}, ..)`;
  }

  function formatValue(v, fmt) {
    if (isT(v)) return formatTime(v);
    if (isC(v)) return formatComplex(v, fmt);
    if (isV(v)) return formatVector(v, fmt);
    if (isM(v)) {
      return v.rows.map(row => `(${row.map(x => formatValue(x, fmt)).join(', ')})`).join('\n');
    }
    if (isPlot(v)) return '[plot]';
    return String(v);
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sanitizeCalcsColor(value) {
    if (!value) return '';
    const v = String(value).trim();
    if (/^#[0-9a-f]{3,8}$/i.test(v)) return v;
    if (/^[a-zA-Z]+$/.test(v) && v.length <= 20) return v.toLowerCase();
    return '';
  }

  function resolveCalcsStyle(cfg) {
    const strip = value => sanitizeCalcsColor(String(value || '').trim().replace(/,\s*$/, ''));
    let theme = '';
    let colorCss = '';
    const bgCss = strip(cfg.bkcol || cfg.bgcol || cfg.bgcolor || cfg.background || '');
    if (cfg.color != null && cfg.color !== '') {
      colorCss = strip(cfg.color);
    } else if (cfg.col != null && cfg.col !== '') {
      const lower = String(cfg.col).trim().replace(/,\s*$/, '').toLowerCase();
      if (THEMES.includes(lower)) theme = lower;
      else colorCss = strip(cfg.col);
    }
    return { theme, colorCss, bgCss };
  }

  function parseCalcsTrailingQuote(raw) {
    const closed = raw.match(/^(.*?)\s+'([^']*)'\s*$/);
    if (closed && closed[1].trim()) {
      return { rest: closed[1].trim(), md: closed[2], mdPos: 'after' };
    }
    const open = raw.match(/^(.*?)\s+'([^']*)$/);
    if (open && open[1].trim()) {
      return { rest: open[1].trim(), md: open[2], mdPos: 'after' };
    }
    return null;
  }

  function parseCalcsQuotedLine(raw) {
    if (!raw.startsWith("'")) return null;
    const closeIdx = raw.indexOf("'", 1);
    if (closeIdx > 0) {
      return {
        md: raw.slice(1, closeIdx),
        rest: raw.slice(closeIdx + 1).trim() || null,
        mdPos: 'before',
      };
    }
    let body = raw.slice(1);
    if (body.startsWith(' ')) body = body.slice(1);
    if (body.endsWith("'") && body.length > 0) body = body.slice(0, -1).trimEnd();
    return { md: body, rest: null, mdPos: 'before' };
  }

  function parseCalcsMdLine(raw) {
    const quoted = parseCalcsQuotedLine(raw);
    if (!quoted || quoted.rest) return null;
    return quoted.md;
  }

  function renderCalcsMarkdown(text) {
    const src = String(text || '');
    if (!src) return '';
    if (typeof marked !== 'undefined') {
      try {
        const inlineOk = typeof marked.parseInline === 'function'
          && !/[\r\n]/.test(src)
          && !/<[a-z][^>]*>/i.test(src);
        if (inlineOk) {
          return marked.parseInline(src, { async: false });
        }
        return marked.parse(src, { async: false })
          .replace(/^<p>\s*/i, '')
          .replace(/\s*<\/p>$/i, '');
      } catch (_) {
        /* fall through */
      }
    }
    return escapeHtml(src);
  }

  function renderCalcsPartsInline(parts, fmt) {
    return parts.map((part, idx) => {
      const sep = idx ? '<span class="calcs-out-sep">, </span>' : '';
      if (!part.ok) {
        return `${sep}<span class="calcs-out-line calcs-out-line--error">${escapeHtml(part.text)}</span>`;
      }
      const inner = valueHtml({ ...part, ok: true }, part.format || fmt);
      if (part.kind === 'plot') {
        return `${sep}<span class="calcs-out-line calcs-out-line--plot">${inner}</span>`;
      }
      return `${sep}<span class="calcs-out-line">${inner}</span>`;
    }).join('');
  }

  function renderCalcsMixedOutput(row, fmt) {
    const results = row.parts?.length ? renderCalcsPartsInline(row.parts, fmt) : '';
    const mdPart = row.html ? `<span class="calcs-md-inline">${row.html}</span>` : '';
    const gap = row.html && row.parts?.length ? '<span class="calcs-out-sep"> </span>' : '';
    if (row.mdPos === 'after') return results + gap + mdPart;
    return mdPart + gap + results;
  }

  function joinContinuedLines(lines) {
    const logical = [];
    let pending = '';
    for (const line of lines) {
      const trimmed = String(line || '').trim();
      if (!trimmed) continue;
      pending = pending ? `${pending} ${trimmed}` : trimmed;
      if (!pending.endsWith(',')) {
        logical.push(pending);
        pending = '';
      }
    }
    if (pending) logical.push(pending.replace(/,\s*$/, '').trim());
    return logical;
  }

  function splitCalcsStatements(src) {
    const s = String(src || '').trim();
    if (!s) return [];
    const parts = [];
    let depth = 0;
    let bracket = 0;
    let start = 0;
    for (let i = 0; i < s.length; i += 1) {
      const ch = s[i];
      if (ch === '(') depth += 1;
      else if (ch === ')' && depth > 0) depth -= 1;
      else if (ch === '[') bracket += 1;
      else if (ch === ']' && bracket > 0) bracket -= 1;
      else if (ch === ',' && depth === 0 && bracket === 0) {
        const part = s.slice(start, i).trim();
        if (part) parts.push(part);
        start = i + 1;
      }
    }
    const tail = s.slice(start).trim();
    if (tail) parts.push(tail);
    return parts.length ? parts : [s];
  }

  function normalizeCalcsStmt(stmt) {
    let s = String(stmt || '').trim();
    // Optional leading/trailing "=" (result marker). Do not touch ":=".
    if (s.startsWith('=') && !s.startsWith(':=')) s = s.slice(1).trim();
    if (s.endsWith('=') && !s.endsWith(':=')) s = s.replace(/=\s*$/, '').trim();
    return s;
  }

  function runCalcsStatement(stmt, env) {
    const ast = parseLine(normalizeCalcsStmt(stmt));
    if (ast.type === 'empty') return null;
    if (ast.type === 'format') {
      env.format = {
        mode: ast.mode,
        digits: ast.digits == null ? env.format.digits : clampDigits(ast.digits),
      };
      return {
        ok: true,
        kind: 'format',
        text: `${ast.mode.toUpperCase()} ${env.format.digits}`,
        format: { ...env.format },
      };
    }
    if (ast.type === 'indexed_assign') {
      const value = evalIndexedAssign(ast.name, ast.index, ast.expr, env);
      return {
        ok: true,
        kind: isPlot(value) ? 'plot' : 'assign',
        name: ast.name,
        value,
        format: { ...env.format },
        text: formatValue(value, env.format),
      };
    }
    if (ast.type === 'assign') {
      const value = evalAst(ast.expr, env);
      const stored = cloneVal(value);
      if (isV(stored)) stored.__plotName = ast.name;
      env.vars[ast.name] = stored;
      return {
        ok: true,
        kind: isPlot(stored) ? 'plot' : 'assign',
        name: ast.name,
        value: stored,
        format: { ...env.format },
        text: formatValue(stored, env.format),
      };
    }
    const value = evalAst(ast.expr, env);
    return {
      ok: true,
      kind: isPlot(value) ? 'plot' : 'expr',
      value,
      format: { ...env.format },
      text: formatValue(value, env.format),
    };
  }

  function evaluate(source, options = {}) {
    const env = defaultEnv();
    const cfg = applyFenceFormat(env, options.fenceAttrs || '');
    const logicalLines = joinContinuedLines(String(source || '').replace(/\r\n/g, '\n').split('\n'));
    const rows = [];

    function pushExprWithMd(raw, idx, md, rest, mdPos) {
      const statements = splitCalcsStatements(rest);
      const parts = [];
      for (const stmt of statements) {
        try {
          const result = runCalcsStatement(stmt, env);
          if (result) parts.push({ ...result, stmt });
        } catch (err) {
          parts.push({
            ok: false,
            kind: 'error',
            text: err.message || String(err),
            stmt,
          });
        }
      }
      rows.push({
        source: raw,
        line: idx + 1,
        ok: parts.every(p => p.ok),
        kind: parts.length > 1 ? 'multi' : 'mixed',
        md,
        html: renderCalcsMarkdown(md),
        mdPos,
        parts,
      });
    }

    logicalLines.forEach((raw, idx) => {
      if (!raw || raw.startsWith('#') || raw.startsWith('//')) return;
      const quoted = parseCalcsQuotedLine(raw);
      if (quoted) {
        if (quoted.rest) {
          pushExprWithMd(raw, idx, quoted.md, quoted.rest, quoted.mdPos);
          return;
        }
        if (quoted.md) {
          rows.push({
            ok: true,
            source: raw,
            kind: 'md',
            text: quoted.md,
            html: renderCalcsMarkdown(quoted.md),
          });
        }
        return;
      }
      const trailing = parseCalcsTrailingQuote(raw);
      if (trailing) {
        pushExprWithMd(raw, idx, trailing.md, trailing.rest, trailing.mdPos);
        return;
      }
      const exprSrc = normalizeCalcsStmt(raw);
      if (!exprSrc || exprSrc.startsWith('#') || exprSrc.startsWith('//')) return;
      const statements = splitCalcsStatements(exprSrc);
      const parts = [];
      for (const stmt of statements) {
        try {
          const result = runCalcsStatement(stmt, env);
          if (result) parts.push({ ...result, stmt });
        } catch (err) {
          parts.push({
            ok: false,
            kind: 'error',
            text: err.message || String(err),
            stmt,
          });
        }
      }
      if (!parts.length) return;
      if (parts.length === 1) {
        rows.push({ source: raw, line: idx + 1, ...parts[0] });
        return;
      }
      rows.push({
        source: raw,
        line: idx + 1,
        ok: parts.every(p => p.ok),
        kind: 'multi',
        parts,
      });
    });
    return { rows, format: { ...env.format }, config: cfg };
  }

  function niceNum(span, ticks) {
    const rough = span / Math.max(1, ticks);
    const mag = 10 ** Math.floor(Math.log10(Math.max(rough, 1e-12)));
    const norm = rough / mag;
    let nice = 10;
    if (norm < 1.5) nice = 1;
    else if (norm < 3) nice = 2;
    else if (norm < 7) nice = 5;
    return nice * mag;
  }

  function ticks(min, max, count) {
    if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
    if (nearly(min, max)) {
      const pad = Math.abs(min) * 0.1 || 1;
      min -= pad;
      max += pad;
    }
    const step = niceNum(max - min, count);
    const start = Math.floor(min / step) * step;
    const end = Math.ceil(max / step) * step;
    const out = [];
    for (let v = start; v <= end + step * 0.5; v += step) out.push(v);
    return out;
  }

  function measurePlotLegend(series) {
    const labels = series.map((s, i) => plotLegendLabel(s.name, i));
    const rowH = 18;
    const boxPadX = 10;
    const boxPadY = 8;
    const swatchW = 18;
    const labelPad = 6;
    const maxLabelLen = Math.max(...labels.map(l => l.length), 1);
    const textW = Math.max(24, Math.ceil(maxLabelLen * 7.4));
    return {
      labels,
      rowH,
      boxPadX,
      boxPadY,
      swatchW,
      labelPad,
      boxW: boxPadX * 2 + swatchW + labelPad + textW,
      boxH: boxPadY * 2 + series.length * rowH - 2,
    };
  }

  function renderPlotLegend(series, colors, W, pad, metrics) {
    if (!series.length || !metrics) return '';
    const boxX = W - pad.r + 8;
    const boxY = pad.t;
    const bg = `<rect class="calcs-plot-legend-box" x="${boxX.toFixed(1)}" y="${boxY.toFixed(1)}" width="${metrics.boxW.toFixed(1)}" height="${metrics.boxH.toFixed(1)}" rx="4"/>`;
    const items = series.map((s, i) => {
      const y = boxY + metrics.boxPadY + i * metrics.rowH + 10;
      const color = colors[i % colors.length];
      const lineX1 = boxX + metrics.boxPadX;
      const lineX2 = lineX1 + metrics.swatchW;
      const textX = lineX2 + metrics.labelPad;
      return [
        `<line class="calcs-plot-legend-swatch" x1="${lineX1.toFixed(1)}" y1="${y.toFixed(1)}" x2="${lineX2.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${color}"/>`,
        `<text class="calcs-plot-legend-label" x="${textX.toFixed(1)}" y="${(y + 3.5).toFixed(1)}">${escapeHtml(metrics.labels[i])}</text>`,
      ].join('');
    }).join('');
    return `<g class="calcs-plot-legend">${bg}${items}</g>`;
  }

  const PLOT_COLORS = ['#dc2626', '#16a34a', '#ca8a04', '#2563eb', '#9333ea', '#0891b2'];

  function renderPlotSvg(series, size, withMeta) {
    const dims = size || { w: 420, h: 220 };
    const W = dims.w;
    const H = dims.h;
    const colors = PLOT_COLORS;
    const legend = series.length ? measurePlotLegend(series) : null;
    const pad = { l: 42, r: legend ? legend.boxW + 16 : 12, t: 12, b: 28 };
    const xs = series.flatMap(s => s.x);
    const ys = series.flatMap(s => s.y);
    let xmin = Math.min(...xs);
    let xmax = Math.max(...xs);
    let ymin = Math.min(...ys);
    let ymax = Math.max(...ys);
    const xt = ticks(xmin, xmax, 5);
    const yt = ticks(ymin, ymax, 4);
    xmin = xt[0];
    xmax = xt[xt.length - 1];
    ymin = yt[0];
    ymax = yt[yt.length - 1];
    const iw = W - pad.l - pad.r;
    const ih = H - pad.t - pad.b;
    const sx = x => pad.l + ((x - xmin) / (xmax - xmin || 1)) * iw;
    const sy = y => pad.t + (1 - (y - ymin) / (ymax - ymin || 1)) * ih;
    const grid = [];
    xt.forEach(x => {
      grid.push(`<line class="calcs-plot-grid" x1="${sx(x)}" y1="${pad.t}" x2="${sx(x)}" y2="${pad.t + ih}"/>`);
      grid.push(`<text class="calcs-plot-tick" x="${sx(x)}" y="${H - 8}" text-anchor="middle">${formatReal(x, { mode: 'fix', digits: 2 })}</text>`);
    });
    yt.forEach(y => {
      grid.push(`<line class="calcs-plot-grid" x1="${pad.l}" y1="${sy(y)}" x2="${pad.l + iw}" y2="${sy(y)}"/>`);
      grid.push(`<text class="calcs-plot-tick" x="${pad.l - 6}" y="${sy(y) + 3}" text-anchor="end">${formatReal(y, { mode: 'fix', digits: 2 })}</text>`);
    });
    const paths = series.map((s, i) => {
      const d = s.x.map((x, k) => `${k ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(s.y[k]).toFixed(1)}`).join(' ');
      return `<path class="calcs-plot-line" d="${d}" stroke="${colors[i % colors.length]}" fill="none"/>`;
    }).join('');
    const legendSvg = renderPlotLegend(series, colors, W, pad, legend);
    const svg = [
      `<svg class="calcs-plot" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="plot">`,
      `<rect class="calcs-plot-bg" x="0" y="0" width="${W}" height="${H}"/>`,
      grid.join(''),
      paths,
      legendSvg,
      '<g class="calcs-plot-snap" aria-hidden="true"></g>',
      `</svg>`,
    ].join('');
    if (!withMeta) return svg;
    return {
      svg,
      meta: buildPlotMeta(series, dims, pad, xmin, xmax, ymin, ymax),
    };
  }

  function buildPlotMeta(series, dims, pad, xmin, xmax, ymin, ymax) {
    return {
      series: series.map(s => ({ name: s.name || '', x: s.x.slice(), y: s.y.slice() })),
      colors: PLOT_COLORS.slice(),
      w: dims.w,
      h: dims.h,
      pad: { ...pad },
      xmin,
      xmax,
      ymin,
      ymax,
    };
  }

  function encodePlotMeta(meta) {
    return encodeURIComponent(JSON.stringify(meta));
  }

  function decodePlotMeta(raw) {
    return JSON.parse(decodeURIComponent(raw));
  }

  function plotDataToSvg(meta, x, y) {
    const plotW = meta.w - meta.pad.l - meta.pad.r;
    const plotH = meta.h - meta.pad.t - meta.pad.b;
    return {
      x: meta.pad.l + ((x - meta.xmin) / (meta.xmax - meta.xmin || 1)) * plotW,
      y: meta.pad.t + (1 - (y - meta.ymin) / (meta.ymax - meta.ymin || 1)) * plotH,
    };
  }

  function plotDataToClient(svg, meta, x, y) {
    const rect = svg.getBoundingClientRect();
    const pt = plotDataToSvg(meta, x, y);
    return {
      x: rect.left + (pt.x / meta.w) * rect.width,
      y: rect.top + (pt.y / meta.h) * rect.height,
    };
  }

  function clientXToPlotX(svg, meta, clientX) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return meta.xmin;
    const xSvg = ((clientX - rect.left) / rect.width) * meta.w;
    const plotW = meta.w - meta.pad.l - meta.pad.r;
    const ratio = (xSvg - meta.pad.l) / (plotW || 1);
    return meta.xmin + ratio * (meta.xmax - meta.xmin);
  }

  function snapPlotIndex(meta, xData) {
    const s0 = meta.series[0];
    if (!s0 || !s0.x.length) return 0;
    let pointIdx = 0;
    let bestDist = Infinity;
    for (let k = 0; k < s0.x.length; k += 1) {
      const dist = Math.abs(s0.x[k] - xData);
      if (dist < bestDist) {
        bestDist = dist;
        pointIdx = k;
      }
    }
    return pointIdx;
  }

  function plotSnapHits(meta, pointIdx) {
    return meta.series.map((s, seriesIdx) => {
      const idx = Math.min(Math.max(0, pointIdx), Math.max(0, s.x.length - 1));
      return {
        seriesIdx,
        pointIdx: idx,
        x: s.x[idx],
        y: s.y[idx],
        name: s.name,
      };
    });
  }

  function plotTipLinesFromIndex(meta, pointIdx) {
    const hits = plotSnapHits(meta, pointIdx);
    const fmtY = { mode: 'fix', digits: 4 };
    const fmtX = { mode: 'fix', digits: 2 };
    const lines = hits.map((h, i) => `${plotLegendLabel(h.name, i)}: ${formatReal(h.y, fmtY)}`);
    if (hits.length) lines.push(`x: ${formatReal(hits[0].x, fmtX)}`);
    return lines.join('\n');
  }

  function plotSnapSvg(meta, pointIdx) {
    const hits = plotSnapHits(meta, pointIdx);
    if (!hits.length) return '';
    const anchor = plotDataToSvg(meta, hits[0].x, hits[0].y);
    const yTop = meta.pad.t;
    const yBot = meta.h - meta.pad.b;
    const colors = meta.colors || PLOT_COLORS;
    const parts = [
      `<line class="calcs-plot-snap-line" x1="${anchor.x.toFixed(1)}" y1="${yTop}" x2="${anchor.x.toFixed(1)}" y2="${yBot}"/>`,
    ];
    hits.forEach((h, i) => {
      const pt = plotDataToSvg(meta, h.x, h.y);
      const color = colors[i % colors.length];
      parts.push(
        `<circle class="calcs-plot-snap-point" cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="4.5" fill="${color}" stroke="#fff" stroke-width="1.5"/>`,
      );
    });
    return parts.join('');
  }

  function nearestPlotPoints(meta, xData) {
    return plotSnapHits(meta, snapPlotIndex(meta, xData));
  }

  function plotTipLines(meta, xData) {
    return plotTipLinesFromIndex(meta, snapPlotIndex(meta, xData));
  }

  function renderPlotWrap(series, size) {
    const built = renderPlotSvg(series, size, true);
    const payload = encodePlotMeta(built.meta);
    return `<div class="calcs-plot-wrap" data-calcs-plot="${payload}">${built.svg}</div>`;
  }

  function matrixHtml(v, fmt) {
    const rows = v.rows.map(row => (
      `<tr>${row.map(cell => `<td>${escapeHtml(formatValue(cell, fmt))}</td>`).join('')}</tr>`
    )).join('');
    return `<table class="calcs-matrix"><tbody>${rows}</tbody></table>`;
  }

  function valueHtml(row, fmt) {
    if (row.kind === 'mixed' || (row.kind === 'multi' && row.html)) {
      return renderCalcsMixedOutput(row, fmt);
    }
    if (row.kind === 'multi') {
      return renderCalcsPartsInline(row.parts, fmt);
    }
    if (!row.ok) return `<span class="calcs-error">${escapeHtml(row.text)}</span>`;
    if (row.kind === 'md') return row.html || escapeHtml(row.text || '');
    if (row.kind === 'format') return `<span class="calcs-format">${escapeHtml(row.text)}</span>`;
    if (row.kind === 'plot' && row.value) return renderPlotWrap(row.value.series);
    if (row.value && isM(row.value)) return matrixHtml(row.value, row.format || fmt);
    return `<span class="calcs-value">${escapeHtml(row.text)}</span>`;
  }

  function renderBlock(source, fenceAttrs) {
    const result = evaluate(source, { fenceAttrs });
    const cfg = result.config || {};
    const style = resolveCalcsStyle(cfg);
    const title = cfg.title || 'Calcs';
    const fmtLabel = `${result.format.mode.toUpperCase()} ${result.format.digits}`;
    const body = result.rows.length
      ? result.rows.map(row => {
        if (row.kind === 'md') {
          return `<div class="calcs-row calcs-row--md"><div class="calcs-md">${valueHtml(row, result.format)}</div></div>`;
        }
        const outClass = row.kind === 'multi' || row.kind === 'mixed' ? ' calcs-out--multi' : '';
        return `<div class="calcs-row${row.ok ? '' : ' calcs-row--error'}">`
          + `<div class="calcs-src"><code>${escapeHtml(row.source)}</code></div>`
          + `<div class="calcs-out${outClass}">${valueHtml(row, result.format)}</div>`
          + `</div>`;
      }).join('')
      : '<div class="calcs-empty">Empty calculator block</div>';
    const themeClass = style.theme ? ` calcs-block--${style.theme}` : '';
    const customClass = (style.colorCss || style.bgCss) ? ' calcs-block--custom' : '';
    const styleVars = [];
    if (style.colorCss) styleVars.push(`--calcs-custom-color:${style.colorCss}`);
    if (style.bgCss) styleVars.push(`--calcs-custom-bg:${style.bgCss}`);
    const styleAttr = styleVars.length
      ? ` style="${styleVars.map(v => escapeHtml(v)).join(';')}"`
      : '';
    return [
      `<div class="calcs-block${themeClass}${customClass}"${styleAttr}>`,
      `<div class="calcs-block-header">`,
      `<div class="calcs-block-title">${escapeHtml(title)}</div>`,
      `<div class="calcs-block-meta">${escapeHtml(fmtLabel)}</div>`,
      `</div>`,
      `<div class="calcs-block-body">${body}</div>`,
      `</div>`,
    ].join('');
  }

  function selfTest() {
    const fails = [];
    const check = (label, cond, detail) => {
      if (!cond) fails.push(detail ? `${label}: ${detail}` : label);
    };
    const run = (src, attrs) => evaluate(src, { fenceAttrs: attrs || '' });

    let r = run('x:=5\nx');
    check('assign real', r.rows[0].ok && nearly(r.rows[0].value.re, 5) && nearly(r.rows[0].value.im, 0));
    check('read x', r.rows[1].ok && nearly(r.rows[1].value.re, 5));

    r = run('c:=5.0+7.0i\nc');
    check('complex assign', r.rows[0].ok && nearly(r.rows[0].value.re, 5) && nearly(r.rows[0].value.im, 7));

    r = run('v:=(1,2+6i,3)\nsum(v)');
    check('vector', r.rows[0].ok && isV(r.rows[0].value) && r.rows[0].value.items.length === 3);
    check('sum(v)', r.rows[1].ok && nearly(r.rows[1].value.re, 6) && nearly(r.rows[1].value.im, 6));

    r = run('A:=((1,2),(3,4))\ninv(A)\nA^-1');
    check('matrix', r.rows[0].ok && isM(r.rows[0].value));
    const invA = r.rows[1].value;
    check('inv(A)', r.rows[1].ok && isM(invA) && nearly(invA.rows[0][0].re, -2) && nearly(invA.rows[0][1].re, 1));
    check('A^-1', r.rows[2].ok && nearly(r.rows[2].value.rows[1][0].re, 1.5));

    r = run('sqrt(x)\nx:=4\nsqrt(x)\nsqr(2)\nexp(0)\nln(e)');
    check('unknown then ok', !r.rows[0].ok && r.rows[1].ok && nearly(r.rows[2].value.re, 2));
    check('sqr', nearly(r.rows[3].value.re, 4));
    check('exp/ln', nearly(r.rows[4].value.re, 1) && nearly(r.rows[5].value.re, 1));

    r = run('sin(0)\ncos(0)\natan(0)\nabs(-3)\ninv(4)');
    check('trig/abs/inv', nearly(r.rows[0].value.re, 0) && nearly(r.rows[1].value.re, 1)
      && nearly(r.rows[3].value.re, 3) && nearly(r.rows[4].value.re, 0.25));

    r = run('sqrt(-1)');
    check('sqrt(-1)', r.rows[0].ok && nearly(r.rows[0].value.re, 0) && nearly(r.rows[0].value.im, 1));

    r = run('FIX 2\n1/3\nSCI 3\n12345\nENG 3\n12345');
    check('FIX', r.rows[1].text === '0.33');
    check('SCI', /^1\.235e4$/i.test(r.rows[3].text));
    check('ENG', /12\.345e3/i.test(r.rows[5].text));

    r = run('plot([1,4,9])');
    check('plot', r.rows[0].ok && isPlot(r.rows[0].value) && r.rows[0].value.series[0].y[2] === 9);

    r = run('= 17:34 - 13:23 + 3:33');
    check('time calc', r.rows[0].ok && isT(r.rows[0].value) && r.rows[0].value.sec === 7 * 3600 + 44 * 60, r.rows[0].text);
    check('time format', r.rows[0].text === '7:44');
    r = run('12:44 +13:23=');
    check('time trailing =', r.rows[0].ok && isT(r.rows[0].value) && r.rows[0].text === '26:07');
    r = run('start:=17:34\nstart - 13:23');
    check('time assign', r.rows[1].ok && r.rows[1].text === '4:11');
    r = run('2 * 1:30\n3:00 / 2\n1:00:30 + 0:00:45');
    check('time scale', r.rows[0].text === '3:00' && r.rows[1].text === '1:30');
    check('time seconds', r.rows[2].text === '1:01:15');

    r = run([
      'f:=50',
      'A:=1',
      'w:=2*Pi*f',
      'SR:=96*3',
      'i:=0..2*SR',
      'y1[i]:=exp(-i/SR)*A',
      'y2[i]:=sin(20*w*i/SR)*exp(-i/SR)*A',
      'Plot([i,y1],[i,y2])',
    ].join('\n'));
    check('signal setup', r.rows.slice(0, 7).every(row => row.ok));
    check('range length', isV(r.rows[4].value) && r.rows[4].value.items.length === 577);
    check('y1 length', isV(r.rows[5].value) && r.rows[5].value.items.length === 577);
    check('large array preview', /,\s*\.\.\)$/.test(r.rows[5].text));
    check('dual plot pairs', r.rows[7].ok && isPlot(r.rows[7].value) && r.rows[7].value.series.length === 2);

    r = run('y1:=(1,2,3)\ny2:=(3,2,1)\nPlot(y1,y2)');
    check('Plot(y1,y2)', r.rows[2].ok && isPlot(r.rows[2].value) && r.rows[2].value.series.length === 2
      && r.rows[2].value.series[0].name === 'y1' && r.rows[2].value.series[1].name === 'y2');

    r = run('SR:=288\nj:=0..2*SR\ny1[j]:=exp(-j/SR)');
    check('j range assign', r.rows[1].ok && isV(r.rows[1].value) && r.rows[1].value.items.length === 577);
    check('j indexed assign', r.rows[2].ok && isV(r.rows[2].value) && r.rows[2].value.items.length === 577);

    r = run('j:=0..10');
    check('0..10 range', r.rows[0].ok && isV(r.rows[0].value) && r.rows[0].value.items.length === 11);

    r = run('j:=-10..10\ny3[j]:=(j*j)/100\nPlot([j, y3])');
    check('neg domain j', r.rows[0].ok && isV(r.rows[0].value) && r.rows[0].value.items.length === 21);
    check('neg domain y3', r.rows[1].ok && isV(r.rows[1].value) && r.rows[1].value.items.length === 21
      && nearly(r.rows[1].value.items[0].re, 1) && nearly(r.rows[1].value.items[10].re, 0));
    check('neg domain plot', r.rows[2].ok && isPlot(r.rows[2].value));

    r = run("' **Montag**");
    check('md line', r.rows[0].ok && r.rows[0].kind === 'md' && r.rows[0].text === '**Montag**');

    r = run('a:=12:30-8:08\nb:=17:00-13:13,a+b');
    check('time a', r.rows[0].ok && isT(r.rows[0].value) && r.rows[0].text === '4:22');
    check('multi comma', r.rows[1].kind === 'multi' && r.rows[1].parts.length === 2);
    check('time b', r.rows[1].parts[0].text === '3:47');
    check('time sum', r.rows[1].parts[1].text === '8:09');

    r = run('a:=12:30-8:08\nb:=17:00-13:13\nd[1]:=a+b\nd[3]:=a+b\nd');
    check('scalar idx assign len', r.rows[4].ok && isV(r.rows[4].value) && r.rows[4].value.items.length === 3);
    check('scalar idx d[1]', r.rows[2].text === '(8:09)');
    check('scalar idx d[3]', r.rows[3].text === '(8:09, 0, 8:09)');
    check('scalar idx read', r.rows[5].text === '(8:09, 0, 8:09)');

    r = run('dSoll[1..3]:=6:24\ndSoll[3]');
    check('range idx assign', r.rows[0].ok && r.rows[0].text === '(6:24, 6:24, 6:24)');
    check('range idx origin', r.rows[0].value.__indexOrigin === 1);
    check('range idx read', r.rows[1].ok && r.rows[1].text === '6:24');

    r = run('v:=(10,20,30)\nv[2]');
    check('subscript read 0-based', r.rows[1].ok && r.rows[1].text === '20');

    r = run("a:=12:30-8:08\nb:=17:00-13:13\n'**Total:**'   a+b");
    check('mixed md+expr prefix', r.rows[2].kind === 'mixed' && r.rows[2].mdPos === 'before' && r.rows[2].parts[0].text === '8:09');

    r = run("a:=12:30-8:08\nb:=17:00-13:13\na+b '**Total:**'");
    check('mixed md+expr suffix', r.rows[2].kind === 'mixed' && r.rows[2].mdPos === 'after' && r.rows[2].parts[0].text === '8:09');

    r = run("' **Montag**");
    check('md only quote', r.rows[0].kind === 'md');

    const html = renderBlock("' **Montag**\\nx:=5", 'title=Demo;color=red,;bkcol=silver');
    check('html color+bg', html.includes('calcs-block--custom')
      && html.includes('--calcs-custom-color:red')
      && html.includes('--calcs-custom-bg:silver'));

    r = run('y1:=(1,2,3)\nPlot(y1)');
    check('plot wrap', r.rows[1].kind === 'plot' && renderPlotWrap(r.rows[1].value.series).includes('calcs-plot-wrap'));
    check('plot tip', plotTipLines(
      decodePlotMeta(encodePlotMeta(buildPlotMeta(
        [{ name: 'y1', x: [0, 1], y: [1, 2] }],
        { w: 420, h: 220 },
        { l: 42, r: 12, t: 12, b: 28 },
        0, 1, 1, 2,
      ))),
      0.9,
    ).includes('Y1: 2'));
    check('plot snap index', snapPlotIndex(decodePlotMeta(encodePlotMeta(buildPlotMeta(
      [{ name: 'y1', x: [0, 10, 20], y: [1, 2, 3] }],
      { w: 420, h: 220 },
      { l: 42, r: 12, t: 12, b: 28 },
      0, 20, 1, 3,
    ))), 11) === 1);
    check('plot snap svg', plotSnapSvg(decodePlotMeta(encodePlotMeta(buildPlotMeta(
      [{ name: 'y1', x: [0, 1], y: [1, 2] }],
      { w: 420, h: 220 },
      { l: 42, r: 12, t: 12, b: 28 },
      0, 1, 1, 2,
    ))), 1).includes('calcs-plot-snap-point'));

    return fails;
  }

  return {
    evaluate,
    renderBlock,
    renderPlotWrap,
    renderPlotSvg,
    decodePlotMeta,
    clientXToPlotX,
    snapPlotIndex,
    plotSnapHits,
    plotTipLines,
    plotTipLinesFromIndex,
    plotSnapSvg,
    plotDataToClient,
    formatValue,
    parseFenceAttrs,
    selfTest,
    complex,
    vector,
    matrix,
  };
}));

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  const fails = module.exports.selfTest();
  if (fails.length) {
    console.error(`calcs self-test failed (${fails.length}):`);
    fails.forEach(f => console.error(' -', f));
    process.exit(1);
  }
  console.log('calcs self-test ok');
}
