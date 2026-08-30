/**
 * NotesPro ```python``` / ```executecode``` runner — Pyodide Wasm sandbox.
 * Captures print() stdout and matplotlib figures for the markdown preview.
 */
(function (root, factory) {
  const api = factory();
  root.NotesProPython = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PYODIDE_VERSION = '0.27.5';
  const PYODIDE_INDEX = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
  const PYODIDE_SCRIPT = `${PYODIDE_INDEX}pyodide.js`;
  const LOAD_TIMEOUT_MS = 180000; // first CDN + wasm download
  const PACKAGE_TIMEOUT_MS = 180000; // numpy / matplotlib wheels
  const RUN_TIMEOUT_MS = 60000;

  let loadScriptPromise = null;
  let pyodidePromise = null;
  let matplotlibHooked = false;
  const loadedPackages = new Set();
  let runQueue = Promise.resolve();
  const resultCache = new Map();
  const CACHE_LIMIT = 40;
  const CACHE_VERSION = 'stdout-v3';

  // Packages we auto-load when the source mentions them.
  const AUTO_PACKAGES = [
    { name: 'pandas', test: /\b(pandas|pd\s*\.)/ },
    { name: 'matplotlib', test: /\b(matplotlib|pyplot|seaborn|plt\s*\.)/ },
    { name: 'numpy', test: /\b(numpy|np\s*\.)/ },
  ];

  function loadScript(src) {
    if (window.loadPyodide) return Promise.resolve();
    if (loadScriptPromise) return loadScriptPromise;
    loadScriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-notespro-pyodide]`);
      if (existing) {
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('Failed to load Pyodide')));
        if (window.loadPyodide) resolve();
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.dataset.notesproPyodide = '1';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load Pyodide from CDN'));
      document.head.appendChild(s);
    });
    return loadScriptPromise;
  }

  async function getPyodide() {
    if (!pyodidePromise) {
      pyodidePromise = (async () => {
        await loadScript(PYODIDE_SCRIPT);
        if (typeof loadPyodide !== 'function') {
          throw new Error('Pyodide loader missing');
        }
        return loadPyodide({ indexURL: PYODIDE_INDEX });
      })().catch((err) => {
        // Allow retry after a failed bootstrap.
        pyodidePromise = null;
        throw err;
      });
    }
    return pyodidePromise;
  }

  async function ensureMatplotlibHooks(pyodide) {
    if (matplotlibHooked) return;
    await pyodide.runPythonAsync(`
import matplotlib
matplotlib.use("AGG")
import matplotlib.pyplot as plt
import io, base64
_notespro_plots = []

def _notespro_capture_current_fig():
    if not plt.get_fignums():
        return
    buf = io.BytesIO()
    plt.savefig(buf, format="png", bbox_inches="tight", dpi=120)
    buf.seek(0)
    _notespro_plots.append(base64.b64encode(buf.read()).decode("ascii"))
    plt.close("all")

def _notespro_show(*args, **kwargs):
    _notespro_capture_current_fig()

plt.show = _notespro_show
`);
    matplotlibHooked = true;
  }

  function detectPackages(code) {
    const src = String(code || '');
    const names = [];
    AUTO_PACKAGES.forEach((pkg) => {
      if (pkg.test.test(src)) names.push(pkg.name);
    });
    // pandas depends on numpy; matplotlib often used with numpy.
    if (names.includes('pandas') && !names.includes('numpy')) names.push('numpy');
    if (names.includes('matplotlib') && !names.includes('numpy')) names.push('numpy');
    return names;
  }

  async function ensurePackages(pyodide, code) {
    const needed = detectPackages(code).filter((name) => !loadedPackages.has(name));
    if (needed.length) {
      await pyodide.loadPackage(needed);
      needed.forEach((name) => loadedPackages.add(name));
    }
    if (detectPackages(code).includes('matplotlib')) {
      await ensureMatplotlibHooks(pyodide);
    }
  }

  function codeLooksLikePlot(code) {
    return /\b(matplotlib|pyplot|seaborn|plt\s*\.)/.test(String(code || ''));
  }

  function cacheGet(key) {
    return resultCache.get(key) || null;
  }

  function cacheSet(key, value) {
    if (resultCache.has(key)) resultCache.delete(key);
    resultCache.set(key, value);
    while (resultCache.size > CACHE_LIMIT) {
      const oldest = resultCache.keys().next().value;
      resultCache.delete(oldest);
    }
  }

  function isTransientFailure(result) {
    const msg = String(result?.error || '');
    return /timed out|Failed to load|Pyodide loader missing|network|fetch/i.test(msg);
  }

  function formatError(err) {
    if (!err) return 'Unknown error';
    // Pyodide PythonError often puts the traceback in message.
    const msg = err.message != null ? String(err.message) : String(err);
    return msg.replace(/^\s+/, '');
  }

  function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label || `Timed out after ${Math.round(ms / 1000)}s`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  /**
   * @param {string} code
   * @param {{ timeoutMs?: number, force?: boolean }} [options]
   * @returns {Promise<{ ok: boolean, stdout: string, stderr: string, plots: string[], error: string|null, cached?: boolean }>}
   */
  async function run(code, options = {}) {
    const src = String(code || '');
    const cacheKey = `${CACHE_VERSION}\n${src}`;
    if (!options.force) {
      const hit = cacheGet(cacheKey);
      if (hit && !isTransientFailure(hit)) return { ...hit, cached: true };
      if (hit && isTransientFailure(hit)) resultCache.delete(cacheKey);
    }

    // Serialize runs: one shared Pyodide interpreter + stdout hooks.
    const job = runQueue.then(() => runExclusive(src, cacheKey, options));
    runQueue = job.then(() => undefined, () => undefined);
    return job;
  }

  async function runExclusive(src, cacheKey, options) {
    let stdout = '';
    let stderr = '';
    let plots = [];
    const runTimeout = Math.max(5000, Number(options.timeoutMs) || RUN_TIMEOUT_MS);

    try {
      const pyodide = await withTimeout(
        getPyodide(),
        LOAD_TIMEOUT_MS,
        'Pyodide load timed out (check network / CDN). Hard-refresh and retry.',
      );

      const wantPlot = codeLooksLikePlot(src);
      const pkgs = detectPackages(src);
      if (pkgs.length) {
        await withTimeout(
          ensurePackages(pyodide, src),
          PACKAGE_TIMEOUT_MS,
          'Package download timed out (numpy/pandas/matplotlib). Hard-refresh and retry.',
        );
      }

      // Capture print() via sys.stdout — more reliable than setStdout across Pyodide builds.
      await pyodide.runPythonAsync(`
import sys, io
_notespro_stdout = io.StringIO()
_notespro_stderr = io.StringIO()
sys.stdout = _notespro_stdout
sys.stderr = _notespro_stderr
`);
      if (wantPlot) {
        await pyodide.runPythonAsync('_notespro_plots = []');
      }

      await withTimeout(pyodide.runPythonAsync(src), runTimeout, 'Python execution timed out');

      stdout = String(pyodide.runPython('_notespro_stdout.getvalue()') || '');
      stderr = String(pyodide.runPython('_notespro_stderr.getvalue()') || '');

      if (wantPlot) {
        await pyodide.runPythonAsync(`
if plt.get_fignums():
    _notespro_capture_current_fig()
`);
        const raw = pyodide.globals.get('_notespro_plots');
        try {
          plots = raw ? raw.toJs({ depth: 1 }) : [];
          if (!Array.isArray(plots)) plots = [];
        } finally {
          if (raw && typeof raw.destroy === 'function') raw.destroy();
        }
      }

      const result = {
        ok: true,
        stdout,
        stderr,
        plots,
        error: null,
      };
      cacheSet(cacheKey, result);
      return result;
    } catch (err) {
      // Best-effort drain buffers if the redirect was installed before the error.
      try {
        const pyodide = await getPyodide();
        if (!stdout) {
          stdout = String(pyodide.runPython(
            '_notespro_stdout.getvalue() if "_notespro_stdout" in dir() else ""',
          ) || '');
        }
        if (!stderr) {
          stderr = String(pyodide.runPython(
            '_notespro_stderr.getvalue() if "_notespro_stderr" in dir() else ""',
          ) || '');
        }
      } catch (_) { /* ignore */ }

      const result = {
        ok: false,
        stdout,
        stderr,
        plots,
        error: formatError(err),
      };
      // Cache real Python errors; do not stick load/timeout failures forever.
      if (!isTransientFailure(result)) cacheSet(cacheKey, result);
      return result;
    }
  }

  function clearCache() {
    resultCache.clear();
  }

  return {
    run,
    preload: getPyodide,
    clearCache,
    PYODIDE_VERSION,
  };
}));
