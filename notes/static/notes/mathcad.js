/** Mathcad-style worksheets. Local math.js runs in a disposable worker. */
(function (root, factory) {
  const node = typeof module !== 'undefined' && module.exports;
  const base = typeof document !== 'undefined' ? new URL('.', document.currentScript.src).href : '';
  const api = factory(root, base, () => node ? require('./vendor/mathjs/math.js') : root.math);
  root.NotesProMathcad = api;
  if (node) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root, assetBase, getMath) {
  'use strict';
  const MAX_ROWS = 160;
  const MAX_LENGTH = 24000;
  const MAX_ITEMS = 2000;
  const functions = new Set(('sin cos tan asin acos atan atan2 sinh cosh tanh exp log log10 log2 sqrt cbrt abs arg conj re im complex ' +
    'round floor ceil fix sign mod factorial gcd lcm min max sum prod mean median std variance norm det inv transpose trace dot cross ' +
    'size length concat identity ones zeros matrix reshape range unit to number format').split(' '));
  const forbidden = new Set('import createUnit evaluate parse compile simplify derivative resolve reviver config help typed chain parser'.split(' '));
  const sample = [
    '# Engineering worksheet',
    'text: Define quantities with :=. Results recalculate from top to bottom.',
    'mass := 12 kg',
    'acceleration := 9.81 m/s^2',
    'force := mass * acceleration',
    'force to N =',
    'text: Functions, matrices, and plots',
    'f(x) := exp(-0.2*x) * sin(2*x)',
    'A := [2, 1; 1, 3]',
    'det(A) =',
    'plot(f(x), x, 0, 12)',
  ].join('\n');
  const escape = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function parseFenceAttrs(raw) {
    const cfg = {};
    String(raw || '').split(';').forEach(pair => {
      const i = pair.indexOf('=');
      if (i < 0) cfg[pair.trim().toLowerCase()] = '';
      else cfg[pair.slice(0, i).trim().toLowerCase()] = pair.slice(i + 1).trim();
    });
    return cfg;
  }
  const fenceRe = () => /```(?:mathcad|mathworksheet)(?:\{([^}]*)\})?[ \t]*(?:\r?\n([\s\S]*?))?```/gi;
  function rewriteFence(markdown, index, source) {
    let n = 0;
    return String(markdown || '').replace(fenceRe(), (match, attrs) => n++ === index
      ? '```mathcad' + (attrs ? '{' + attrs + '}' : '') + '\n' + source.replace(/```/g, '`\u200b`\u200b`') + '\n```' : match);
  }
  function normalize(source) {
    let text = source.trim().replace(/:=|≔/g, '=').replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/π/g, 'pi');
    if (text.endsWith('=')) text = text.slice(0, -1).trim();
    const range = text.match(/^([A-Za-z][\w]*\s*=\s*)([^,]+),\s*(.+?)\s*\.\.\s*(.+)$/);
    if (range) text = range[1] + '(' + range[2] + '):((' + range[3] + ')-(' + range[2] + ')):(' + range[4] + ')';
    else text = text.replace(/\.\./g, ':');
    return text;
  }
  function mathMarkup(n) {
    if (n.isConstantNode) return '<mn>' + escape(n.value) + '</mn>';
    if (n.isSymbolNode) return '<mi>' + escape(n.name === 'pi' ? 'π' : n.name) + '</mi>';
    if (n.isParenthesisNode) return '<mrow><mo>(</mo>' + mathMarkup(n.content) + '<mo>)</mo></mrow>';
    if (n.isAssignmentNode) return '<mrow>' + mathMarkup(n.object) + '<mo>≔</mo>' + mathMarkup(n.value) + '</mrow>';
    if (n.isFunctionAssignmentNode) return '<mrow><mi>' + escape(n.name) + '</mi><mo>(</mo><mi>' + escape(n.params.join(', ')) + '</mi><mo>)</mo><mo>≔</mo>' + mathMarkup(n.expr) + '</mrow>';
    if (n.isOperatorNode) {
      const a = n.args.map(mathMarkup);
      if (n.op === '/' && a.length === 2) return '<mfrac>' + a.join('') + '</mfrac>';
      if (n.op === '^' && a.length === 2) return '<msup>' + a.join('') + '</msup>';
      return '<mrow>' + (a.length === 1 ? '<mo>' + escape(n.op) + '</mo>' + a[0] : a.join('<mo>' + escape(n.op === '*' ? '·' : n.op) + '</mo>')) + '</mrow>';
    }
    if (n.isFunctionNode && n.fn.name === 'sqrt' && n.args.length === 1) return '<msqrt>' + mathMarkup(n.args[0]) + '</msqrt>';
    return '<mtext>' + escape(n.toString()) + '</mtext>';
  }
  function createEngine() {
    const lib = getMath();
    if (!lib) throw Error('Math engine unavailable');
    const math = lib.create(lib.all);
    // Keep constructors bounded even inside user-defined functions.
    for (const name of ['zeros', 'ones', 'identity', 'range', 'reshape']) {
      const original = math[name];
      math.import({[name]: (...args) => {
        const numbers = args.flat(Infinity).filter(v => typeof v === 'number');
        if (numbers.some(v => !Number.isFinite(v) || Math.abs(v) > MAX_ITEMS)
          || (name !== 'range' && numbers.reduce((a, b) => a * Math.max(1, Math.abs(b)), 1) > MAX_ITEMS)) throw Error('Array size limit exceeded');
        if (name === 'range' && args.length >= 2) {
          const step = args[2] == null ? 1 : Number(args[2]);
          if (!step || Math.abs((Number(args[1]) - Number(args[0])) / step) > MAX_ITEMS) throw Error('Range is too large');
        }
        const result = original(...args);
        if (name === 'range' && result.size()[0] > MAX_ITEMS) throw Error('Range is too large');
        return result;
      }}, {override: true});
    }
    return math;
  }
  function validate(node, math, scope, userFunctions) {
    let count = 0;
    const ranges = [];
    node.traverse(n => {
      if (++count > 400) throw Error('Expression is too large');
      if (!['ConstantNode', 'SymbolNode', 'OperatorNode', 'ParenthesisNode', 'ArrayNode', 'RangeNode', 'FunctionNode', 'AssignmentNode', 'FunctionAssignmentNode'].includes(n.type)) throw Error('Unsupported expression: ' + n.type);
      if (n.isSymbolNode && forbidden.has(n.name)) throw Error('Function is not available: ' + n.name);
      if (n.isFunctionNode && (!n.fn.isSymbolNode || (!functions.has(n.fn.name) && !userFunctions.has(n.fn.name)))) throw Error('Unknown function: ' + n.fn.toString());
      if (n.isAssignmentNode || n.isFunctionAssignmentNode) {
        const name = n.isAssignmentNode ? n.object.name : n.name;
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name || '') || name in math || forbidden.has(name)) throw Error('Choose another variable name: ' + name);
        if (n.index) throw Error('Indexed assignment is not supported');
      }
      if (n.isRangeNode) ranges.push(n);
    });
    // Validate the whole tree before evaluating any range bound.
    for (const range of ranges) {
      const a = Number(range.start.compile().evaluate(scope));
      const b = Number(range.end.compile().evaluate(scope));
      const step = range.step ? Number(range.step.compile().evaluate(scope)) : 1;
      if (![a, b, step].every(Number.isFinite) || !step || Math.abs((b - a) / step) > MAX_ITEMS - 1) throw Error('Range is too large or invalid');
    }
  }
  function drawPlot(node, math, scope, userFunctions) {
    if (node.args.length !== 4 || !node.args[1].isSymbolNode) throw Error('Use plot(expression, variable, start, end)');
    const [expr, variable, start, end] = node.args;
    validate(start, math, scope, userFunctions);
    validate(end, math, scope, userFunctions);
    const lo = Number(start.compile().evaluate(scope));
    const hi = Number(end.compile().evaluate(scope));
    if (![lo, hi].every(Number.isFinite) || hi <= lo) throw Error('Plot bounds must be finite with end > start');
    const expressions = expr.isArrayNode ? expr.items : [expr];
    if (expressions.length > 5) throw Error('Use at most five plot curves');
    const local = new Map(scope);
    local.set(variable.name, lo);
    for (const item of [...expressions, start, end]) validate(item, math, local, userFunctions);
    const compiled = expressions.map(item => item.compile());
    const series = compiled.map((c, i) => ({name: expressions[i].toString(), points: []}));
    for (let i = 0; i <= 240; i++) {
      const x = lo + (hi - lo) * i / 240;
      local.set(variable.name, x);
      compiled.forEach((c, j) => {
        let y = NaN;
        try { const value = c.evaluate(local); if (typeof value === 'number') y = value; } catch (_) { /* a gap in the curve */ }
        series[j].points.push({x, y: Number.isFinite(y) ? y : null});
      });
    }
    if (!series.some(s => s.points.some(p => p.y != null))) throw Error('Plot needs real, dimensionless values');
    return series;
  }
  function evaluate(source, precision = 6) {
    if (String(source).length > MAX_LENGTH) throw Error('Worksheet is too large');
    const lines = String(source).split(/\r?\n/);
    if (lines.length > MAX_ROWS) throw Error('Use at most ' + MAX_ROWS + ' regions');
    const math = createEngine();
    const scope = new Map();
    const userFunctions = new Set();
    precision = Math.min(14, Math.max(2, Number(precision) || 6));
    return lines.map(source => {
      const row = {source};
      if (/^#\s/.test(source)) return {...row, kind: 'heading', text: source.replace(/^#\s*/, '')};
      if (/^text:/i.test(source)) return {...row, kind: 'text', text: source.replace(/^text:\s*/i, '')};
      if (!source.trim()) return {...row, kind: 'empty'};
      try {
        const node = math.parse(normalize(source));
        if (node.isFunctionNode && node.fn.name.toLowerCase() === 'plot') return {...row, kind: 'plot', series: drawPlot(node, math, scope, userFunctions)};
        validate(node, math, scope, userFunctions);
        const value = node.compile().evaluate(scope);
        if (node.isFunctionAssignmentNode) userFunctions.add(node.name);
        let result = node.isFunctionAssignmentNode ? 'function defined' : math.format(value, {precision});
        if (result.length > 3000) result = result.slice(0, 3000) + '…';
        return {...row, kind: 'math', formula: '<math xmlns="http://www.w3.org/1998/Math/MathML">' + mathMarkup(node) + '</math>', result};
      } catch (e) { return {...row, kind: 'error', error: e.message}; }
    });
  }
  function plotSvg(series) {
    const points = series.flatMap(s => s.points).filter(p => p.y != null);
    const lo = Math.min(...points.map(p => p.x)), hi = Math.max(...points.map(p => p.x));
    let low = Math.min(...points.map(p => p.y)), high = Math.max(...points.map(p => p.y));
    if (high === low) { low -= 1; high += 1; }
    const pad = (high - low) * 0.08; low -= pad; high += pad;
    const x = n => 55 + (n - lo) / (hi - lo) * 575;
    const y = n => 235 - (n - low) / (high - low) * 215;
    let grid = '';
    for (let i = 0; i <= 5; i++) {
      const yy = low + (high - low) * i / 5, xx = lo + (hi - lo) * i / 5;
      grid += '<path d="M55 ' + y(yy) + 'H630 M' + x(xx) + ' 20V235" stroke="#dce5ed" fill="none"/>';
      grid += '<text x="48" y="' + (y(yy) + 4) + '" text-anchor="end">' + Number(yy.toPrecision(3)) + '</text><text x="' + x(xx) + '" y="255" text-anchor="middle">' + Number(xx.toPrecision(3)) + '</text>';
    }
    const colors = ['#176caa', '#dc7c27', '#388958', '#a055ab', '#c34957'];
    const paths = series.map((s, i) => {
      let pen = false;
      const d = s.points.map(p => {
        if (p.y == null) { pen = false; return ''; }
        const cmd = (pen ? 'L' : 'M') + x(p.x).toFixed(2) + ' ' + y(p.y).toFixed(2); pen = true; return cmd;
      }).join(' ');
      return '<path d="' + d + '" stroke="' + colors[i] + '" fill="none" stroke-width="2.2"/>';
    }).join('');
    return '<svg class="mathcad-plot" viewBox="0 0 650 275" role="img" aria-label="Worksheet plot">' + grid + paths + '</svg><div class="mathcad-legend">' + series.map((s, i) => '<span style="color:' + colors[i] + '">● ' + escape(s.name) + '</span>').join('') + '</div>';
  }
  function renderBlock(source, attrs, options = {}) {
    const cfg = parseFenceAttrs(attrs);
    const content = String(source || '').replace(/`\u200b`\u200b`/g, '```');
    return '<section class="mathcad-block" data-mathcad-index="' + (Number(options.mathcadIndex) || 0) + '"><header class="mathcad-header"><div><span class="mathcad-eyebrow">MATH WORKSHEET</span><h3>' + escape(cfg.title || 'Engineering worksheet') + '</h3></div><span class="mathcad-state" role="status">Ready</span></header>'
      + '<div class="mathcad-toolbar"><button type="button" data-action="calculate">Recalculate</button><button type="button" data-action="add-math" data-edit>+ Calculation</button><button type="button" data-action="add-text" data-edit>+ Text</button><button type="button" data-action="add-plot" data-edit>+ Plot</button><label>Digits <select data-precision aria-label="Result precision">' + [4,6,8,12].map(n => '<option' + (n === 6 ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label><button type="button" data-action="help">Syntax</button>' + (root.NotesProGameFullscreen?.renderButton?.() || '') + '</div>'
      + '<div class="mathcad-help" hidden><strong>Worksheet syntax</strong><p><code>mass := 12 kg</code> defines a variable. <code>mass * 9.81 m/s^2 =</code> evaluates it. <code>force to N =</code> converts units.</p><p><code>f(x) := sin(x)</code> · <code>t := 0, 0.1 .. 10</code> · <code>A := [1,2;3,4]</code> · <code>plot([sin(x), cos(x)], x, 0, 2*pi)</code></p><p>Use <code># Heading</code> or <code>text: Notes</code>. Definitions apply to the regions below them. Trig uses radians; explicit units such as <code>sin(30 deg)</code> also work. Shift+Enter adds a calculation.</p></div><div class="mathcad-paper"></div><textarea class="mathcad-source" hidden>' + escape(content) + '</textarea></section>';
  }
  function hydrateBlock(el, options = {}) {
    if (!el || el.dataset.mathcadReady) return;
    el.dataset.mathcadReady = '1';
    const editable = !!options.editable;
    const paper = el.querySelector('.mathcad-paper');
    const status = el.querySelector('.mathcad-state');
    const store = el.querySelector('.mathcad-source');
    let lines = store.value.split(/\r?\n/);
    let worker = null, timer = 0, debounce = 0;
    let generation = 0;
    el.querySelectorAll('[data-edit]').forEach(button => { button.hidden = !editable; });
    function persist() {
      store.value = lines.join('\n');
      options.onChange?.(store.value);
    }
    function build() {
      paper.innerHTML = lines.map((line, i) => '<div class="mathcad-region"><div class="mathcad-region-number">' + (i + 1) + '</div><div class="mathcad-region-content"><input class="mathcad-input" aria-label="Region ' + (i + 1) + '" value="' + escape(line) + '"' + (editable ? '' : ' readonly') + '><div class="mathcad-output"></div></div>' + (editable ? '<div class="mathcad-region-actions"><button type="button" data-move="-1" data-row="' + i + '" aria-label="Move region up">↑</button><button type="button" data-move="1" data-row="' + i + '" aria-label="Move region down">↓</button><button type="button" data-delete="' + i + '" aria-label="Delete region">×</button></div>' : '') + '</div>').join('');
    }
    function calculate() {
      clearTimeout(debounce); clearTimeout(timer); worker?.terminate();
      if (!el.isConnected) return;
      const id = ++generation;
      status.textContent = 'Calculating…';
      try { worker = new Worker(new URL('mathcad-worker.js', assetBase)); }
      catch (_) { status.textContent = 'Could not start the calculation worker.'; return; }
      timer = setTimeout(() => { worker.terminate(); status.textContent = 'Calculation stopped: time limit exceeded.'; }, 3500);
      worker.onmessage = event => {
        if (id !== generation) return;
        clearTimeout(timer); worker.terminate();
        if (event.data.error) { status.textContent = event.data.error; return; }
        const rows = event.data.rows;
        paper.querySelectorAll('.mathcad-region').forEach((region, i) => {
          const row = rows[i];
          const output = region.querySelector('.mathcad-output');
          region.dataset.kind = row.kind;
          output.innerHTML = row.kind === 'plot' ? plotSvg(row.series) : row.kind === 'math' ? '<div class="mathcad-equation">' + row.formula + '<span class="mathcad-equals">=</span><output>' + escape(row.result) + '</output></div>' : row.kind === 'error' ? '<span class="mathcad-error">' + escape(row.error) + '</span>' : row.kind === 'heading' ? '<h4>' + escape(row.text) + '</h4>' : row.kind === 'text' ? '<p>' + escape(row.text) + '</p>' : '';
        });
        const errors = rows.filter(row => row.kind === 'error').length;
        status.textContent = errors ? errors + (errors === 1 ? ' region needs attention' : ' regions need attention') : 'Up to date';
      };
      worker.onerror = () => { clearTimeout(timer); worker.terminate(); status.textContent = 'Math engine could not load. Try recalculating.'; };
      worker.postMessage({source: lines.join('\n'), precision: Number(el.querySelector('[data-precision]').value)});
    }
    function append(line) {
      if (lines.length >= MAX_ROWS) { status.textContent = 'Region limit reached'; return; }
      lines.push(line); persist(); build(); calculate(); paper.querySelector('.mathcad-region:last-child input')?.focus();
    }
    paper.addEventListener('input', event => {
      if (!editable || !event.target.matches('.mathcad-input')) return;
      lines = Array.from(paper.querySelectorAll('input')).map(input => input.value);
      persist();
      clearTimeout(debounce); debounce = setTimeout(calculate, 450);
    });
    el.addEventListener('keydown', event => { if (editable && event.key === 'Enter' && event.shiftKey) { event.preventDefault(); append(''); } });
    el.addEventListener('click', event => {
      const button = event.target.closest('button'); if (!button || !el.contains(button)) return;
      const action = button.dataset.action;
      if (action === 'calculate') calculate();
      if (action === 'help') { const help = el.querySelector('.mathcad-help'); help.hidden = !help.hidden; }
      if (!editable) return;
      if (action === 'add-math') append('');
      if (action === 'add-text') append('text: ');
      if (action === 'add-plot') append('plot(sin(x), x, 0, 2*pi)');
      if (button.dataset.delete != null) { lines.splice(Number(button.dataset.delete), 1); if (!lines.length) lines.push(''); persist(); build(); calculate(); }
      if (button.dataset.move) {
        const i = Number(button.dataset.row), j = i + Number(button.dataset.move);
        if (j < 0 || j >= lines.length) return;
        [lines[i], lines[j]] = [lines[j], lines[i]]; persist(); build(); calculate();
      }
    });
    el.querySelector('[data-precision]').addEventListener('change', calculate);
    const watch = new MutationObserver(() => { if (!el.isConnected) { clearTimeout(timer); clearTimeout(debounce); worker?.terminate(); watch.disconnect(); } });
    watch.observe(document.body, {childList: true, subtree: true});
    root.NotesProGameFullscreen?.bind?.(el);
    build(); calculate();
  }
  return {sample, evaluate, renderBlock, hydrateBlock, parseFenceAttrs, rewriteFence, normalize};
}));
