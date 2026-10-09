"""Run short Python snippets in an isolated subprocess sandbox."""
from __future__ import annotations

import base64
import os
import shutil
import signal
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    import resource
except ImportError:  # Unix-only; missing on Windows
    resource = None

MAX_CODE_BYTES = 64 * 1024
MAX_OUTPUT_BYTES = 100 * 1024
DEFAULT_TIMEOUT = 5
MEMORY_MB = 128

ALLOWED_IMPORTS = (
    'abc', 'array', 'base64', 'bisect', 'calendar', 'cmath', 'collections',
    'copy', 'csv', 'dataclasses', 'datetime', 'decimal', 'enum', 'fractions',
    'functools', 'graphlib', 'hashlib', 'heapq', 'html', 'itertools', 'json',
    'keyword', 'math', 'numbers', 'operator', 'pprint', 'random', 're',
    'reprlib', 'secrets', 'statistics', 'string', 'textwrap', 'time', 'types',
    'typing', 'unicodedata', 'weakref', 'zoneinfo',
)

SAFE_BUILTINS = (
    'abs', 'all', 'any', 'ascii', 'bin', 'bool', 'bytearray', 'bytes',
    'callable', 'chr', 'classmethod', 'complex', 'dict', 'dir', 'divmod',
    'enumerate', 'filter', 'float', 'format', 'frozenset', 'getattr',
    'hasattr', 'hash', 'hex', 'id', 'int', 'isinstance', 'issubclass',
    'iter', 'len', 'list', 'map', 'max', 'min', 'next', 'object', 'oct',
    'ord', 'pow', 'print', 'property', 'range', 'repr', 'reversed', 'round',
    'set', 'setattr', 'slice', 'sorted', 'staticmethod', 'str', 'sum',
    'super', 'tuple', 'type', 'zip',
    'ArithmeticError', 'AssertionError', 'AttributeError', 'BaseException',
    'Exception', 'FloatingPointError', 'ImportError', 'IndexError',
    'KeyError', 'LookupError', 'MemoryError', 'NameError', 'OverflowError',
    'RuntimeError', 'StopIteration', 'SyntaxError', 'TypeError',
    'UnicodeError', 'ValueError', 'ZeroDivisionError', 'NotImplementedError',
    'ModuleNotFoundError',
)

RUNNER_SOURCE = r'''
import ast
import builtins
import os
import sys
import traceback

ALLOWED = frozenset(%(allowed)s)
SAFE_BUILTIN_NAMES = %(safe_builtins)s
CWD = os.path.realpath(os.getcwd())
_real_import = builtins.__import__
_real_open = builtins.open


def _safe_import(name, globals=None, locals=None, fromlist=(), level=0):
    root = (name or '').split('.')[0]
    if root not in ALLOWED:
        raise ImportError(f'sandbox: import of {name!r} is blocked')
    return _real_import(name, globals, locals, fromlist, level)


def _safe_open(file, *args, **kwargs):
    if not isinstance(file, (str, bytes, os.PathLike)):
        raise PermissionError('sandbox: file access denied')
    raw = os.fspath(file)
    path = os.path.realpath(raw if os.path.isabs(raw) else os.path.join(CWD, raw))
    if path != CWD and not path.startswith(CWD + os.sep):
        raise PermissionError('sandbox: file access denied')
    return _real_open(file, *args, **kwargs)


def _is_print_call(value):
    if not isinstance(value, ast.Call):
        return False
    func = value.func
    return isinstance(func, ast.Name) and func.id in ('print', 'pprint', 'display', 'plot')


def _is_docstring(index, stmt, body_len):
    return (
        index == 0
        and body_len > 1
        and isinstance(stmt, ast.Expr)
        and isinstance(stmt.value, ast.Constant)
        and isinstance(stmt.value.value, (str, bytes))
    )


def _display_stmts(value):
    return [
        ast.Assign(
            targets=[ast.Name(id='_', ctx=ast.Store())],
            value=value,
        ),
        ast.If(
            test=ast.Compare(
                left=ast.Name(id='_', ctx=ast.Load()),
                ops=[ast.IsNot()],
                comparators=[ast.Constant(value=None)],
            ),
            body=[ast.If(
                test=ast.Call(
                    func=ast.Name(id='isinstance', ctx=ast.Load()),
                    args=[
                        ast.Name(id='_', ctx=ast.Load()),
                        ast.Name(id='str', ctx=ast.Load()),
                    ],
                    keywords=[],
                ),
                body=[ast.Expr(value=ast.Call(
                    func=ast.Name(id='print', ctx=ast.Load()),
                    args=[ast.Name(id='_', ctx=ast.Load())],
                    keywords=[],
                ))],
                orelse=[ast.Expr(value=ast.Call(
                    func=ast.Name(id='print', ctx=ast.Load()),
                    args=[ast.Call(
                        func=ast.Name(id='repr', ctx=ast.Load()),
                        args=[ast.Name(id='_', ctx=ast.Load())],
                        keywords=[],
                    )],
                    keywords=[],
                ))],
            )],
            orelse=[],
        ),
    ]


def _rewrite_stmts(body):
    out = []
    for index, stmt in enumerate(body or []):
        if isinstance(stmt, ast.Expr) and not _is_print_call(stmt.value) and not _is_docstring(index, stmt, len(body or [])):
            out.extend(_display_stmts(stmt.value))
            continue
        _rewrite_nested(stmt)
        out.append(stmt)
    return out


def _rewrite_nested(stmt):
    if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        stmt.body = _rewrite_stmts(stmt.body)
    elif isinstance(stmt, (ast.If, ast.For, ast.AsyncFor, ast.While)):
        stmt.body = _rewrite_stmts(stmt.body)
        stmt.orelse = _rewrite_stmts(stmt.orelse)
    elif isinstance(stmt, (ast.With, ast.AsyncWith)):
        stmt.body = _rewrite_stmts(stmt.body)
    elif isinstance(stmt, ast.Try):
        stmt.body = _rewrite_stmts(stmt.body)
        stmt.orelse = _rewrite_stmts(stmt.orelse)
        stmt.finalbody = _rewrite_stmts(stmt.finalbody)
        for handler in stmt.handlers:
            handler.body = _rewrite_stmts(handler.body)
    elif isinstance(stmt, ast.ExceptHandler):
        stmt.body = _rewrite_stmts(stmt.body)
    elif hasattr(ast, 'Match') and isinstance(stmt, ast.Match):
        for case in stmt.cases:
            case.body = _rewrite_stmts(case.body)


def _rewrite_last_expression(src: str):
    tree = ast.parse(src, filename='<python>')
    tree.body = _rewrite_stmts(tree.body)
    ast.fix_missing_locations(tree)
    return compile(tree, '<python>', 'exec')


_PLOT_COLORS = ('#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed')
_PLOT_COUNT = 0


def _as_floats(seq):
    try:
        out = [float(x) for x in seq]
    except (TypeError, ValueError) as exc:
        raise TypeError('plot: values must be numbers') from exc
    if not out:
        raise ValueError('plot: empty data')
    if len(out) > 4000:
        raise ValueError('plot: too many points')
    return out


def _xy_pair(arg):
    if isinstance(arg, (tuple, list)) and len(arg) == 2:
        a, b = arg
        if not isinstance(a, (int, float, bool)) and not isinstance(b, (int, float, bool)):
            x, y = _as_floats(a), _as_floats(b)
            if len(x) != len(y):
                raise ValueError('plot: x and y length mismatch')
            return x, y
    return None


def _svg_plot(series, title=''):
    w, h = 560, 280
    pad = {'l': 48, 'r': 16, 't': 22 if title else 12, 'b': 28}
    iw, ih = w - pad['l'] - pad['r'], h - pad['t'] - pad['b']
    xs = [x for x, _, _ in series for x in x]
    ys = [y for _, y, _ in series for y in y]
    xmin, xmax = min(xs), max(xs)
    ymin, ymax = min(ys), max(ys)
    if xmin == xmax:
        xmin, xmax = xmin - 1, xmax + 1
    if ymin == ymax:
        ymin, ymax = ymin - 1, ymax + 1
    dx, dy = xmax - xmin, ymax - ymin

    def sx(x):
        return pad['l'] + (x - xmin) / dx * iw

    def sy(y):
        return pad['t'] + (1 - (y - ymin) / dy) * ih

    def ticks(lo, hi, n=5):
        step = (hi - lo) / n
        return [lo + i * step for i in range(n + 1)]

    def fmt(v):
        av = abs(v)
        if av >= 100 or (av > 0 and av < 0.01):
            return f'{v:.2e}'
        return f'{v:.3g}'

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">',
        f'<rect x="0" y="0" width="{w}" height="{h}" fill="#fff" rx="8"/>',
    ]
    if title:
        t = str(title).replace('&', '&amp;').replace('<', '&lt;')
        parts.append(f'<text x="{w/2:.1f}" y="16" text-anchor="middle" font-size="12" fill="#334155">{t}</text>')
    for x in ticks(xmin, xmax):
        parts.append(f'<line x1="{sx(x):.1f}" y1="{pad["t"]}" x2="{sx(x):.1f}" y2="{pad["t"]+ih}" stroke="#e2e8f0"/>')
        parts.append(f'<text x="{sx(x):.1f}" y="{h-8}" text-anchor="middle" font-size="10" fill="#64748b">{fmt(x)}</text>')
    for y in ticks(ymin, ymax):
        parts.append(f'<line x1="{pad["l"]}" y1="{sy(y):.1f}" x2="{pad["l"]+iw}" y2="{sy(y):.1f}" stroke="#e2e8f0"/>')
        parts.append(f'<text x="{pad["l"]-6}" y="{sy(y)+3:.1f}" text-anchor="end" font-size="10" fill="#64748b">{fmt(y)}</text>')
    for i, (x, y, name) in enumerate(series):
        color = _PLOT_COLORS[i %% len(_PLOT_COLORS)]
        d = ' '.join(
            f'{"M" if j == 0 else "L"}{sx(px):.2f},{sy(py):.2f}'
            for j, (px, py) in enumerate(zip(x, y))
        )
        parts.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="2"/>')
        lx = pad['l'] + 8 + i * 72
        parts.append(f'<line x1="{lx}" y1="{pad["t"]+8}" x2="{lx+16}" y2="{pad["t"]+8}" stroke="{color}" stroke-width="2"/>')
        lab = str(name).replace('&', '&amp;').replace('<', '&lt;')
        parts.append(f'<text x="{lx+20}" y="{pad["t"]+12}" font-size="11" fill="#334155">{lab}</text>')
    parts.append('</svg>')
    return ''.join(parts)


def plot(*args, title=''):
    global _PLOT_COUNT
    if not args:
        raise TypeError('plot(y) or plot(x, y) or plot([x,y], [x,y2], …)')
    series = []
    if len(args) == 1:
        pair = _xy_pair(args[0])
        if pair:
            series.append((*pair, 'y'))
        else:
            y = _as_floats(args[0])
            series.append((list(range(len(y))), y, 'y'))
    elif len(args) == 2 and _xy_pair(args[0]) is None and _xy_pair(args[1]) is None:
        x, y = _as_floats(args[0]), _as_floats(args[1])
        if len(x) != len(y):
            raise ValueError('plot: x and y length mismatch')
        series.append((x, y, 'y'))
    else:
        for i, arg in enumerate(args):
            pair = _xy_pair(arg)
            if pair:
                series.append((*pair, f'y{i+1}'))
            else:
                y = _as_floats(arg)
                series.append((list(range(len(y))), y, f'y{i+1}'))
    if _PLOT_COUNT >= 8:
        raise RuntimeError('plot: too many figures')
    _PLOT_COUNT += 1
    name = f'notespro-plot-{_PLOT_COUNT:02d}.svg'
    open(name, 'w', encoding='utf-8').write(_svg_plot(series, title))


safe_builtins = {name: getattr(builtins, name) for name in SAFE_BUILTIN_NAMES if hasattr(builtins, name)}
safe_builtins['open'] = _safe_open
safe_builtins['__import__'] = _safe_import
safe_builtins['plot'] = plot
safe_builtins['True'] = True
safe_builtins['False'] = False
safe_builtins['None'] = None
safe_builtins['Ellipsis'] = Ellipsis
safe_builtins['NotImplemented'] = NotImplemented

src = open(sys.argv[1], encoding='utf-8').read()
try:
    code = _rewrite_last_expression(src)
except SyntaxError:
    traceback.print_exc()
    sys.exit(1)

try:
    exec(code, {'__name__': '__main__', '__builtins__': safe_builtins})
except Exception:
    traceback.print_exc()
    sys.exit(1)
''' % {
    'allowed': repr(ALLOWED_IMPORTS),
    'safe_builtins': repr(SAFE_BUILTINS),
}


def _sandbox_python() -> str:
    env_bin = (os.environ.get('NOTESPRO_PYTHON_SANDBOX') or '').strip()
    if env_bin:
        return env_bin
    for candidate in ('/usr/bin/python3', '/usr/local/bin/python3'):
        if os.path.isfile(candidate):
            return candidate
    return sys.executable


def _truncate(text: str, limit: int = MAX_OUTPUT_BYTES) -> str:
    raw = text or ''
    encoded = raw.encode('utf-8', 'replace')
    if len(encoded) <= limit:
        return raw
    clipped = encoded[:limit].decode('utf-8', 'ignore')
    return clipped + '\n… (output truncated)\n'


def _collect_plot_images(workdir: Path) -> list[dict]:
    images = []
    for path in sorted(workdir.glob('notespro-plot-*.svg')) + sorted(workdir.glob('notespro-plot-*.png')):
        if len(images) >= 8:
            break
        raw = path.read_bytes()
        if not raw or len(raw) > MAX_OUTPUT_BYTES:
            continue
        mime = 'image/svg+xml' if path.suffix.lower() == '.svg' else 'image/png'
        images.append({
            'mime': mime,
            'data': base64.b64encode(raw).decode('ascii'),
        })
    return images


def _run_result(exit_code, stdout, stderr, timed_out, images=None):
    if timed_out:
        stderr = (stderr + '\n' if stderr else '') + 'sandbox: timed out'
    return {
        'ok': (not timed_out) and exit_code == 0,
        'stdout': stdout,
        'stderr': stderr,
        'timed_out': timed_out,
        'exit_code': exit_code,
        'images': images or [],
    }


def _limit_resources():
    if resource is None:
        return
    cpu = DEFAULT_TIMEOUT + 1
    try:
        resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu))
    except (ValueError, OSError):
        pass
    try:
        mem = MEMORY_MB * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (mem, mem))
    except (ValueError, OSError):
        pass
    try:
        resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT_BYTES * 4, MAX_OUTPUT_BYTES * 4))
    except (ValueError, OSError):
        pass
    try:
        resource.setrlimit(resource.RLIMIT_NOFILE, (32, 32))
    except (ValueError, OSError):
        pass
    try:
        resource.setrlimit(resource.RLIMIT_NPROC, (8, 8))
    except (ValueError, OSError):
        pass
    try:
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    except (ValueError, OSError):
        pass


def _bwrap_cmd(python_bin: str, workdir: Path) -> list[str] | None:
    bwrap = shutil.which('bwrap')
    if not bwrap:
        return None
    binds: list[str] = []
    for path in (
        '/usr', '/lib', '/lib64', '/bin', '/sbin',
        '/etc/ld.so.cache', '/etc/alternatives', '/etc/nsswitch.conf',
    ):
        if os.path.exists(path):
            binds.extend(['--ro-bind', path, path])
    return [
        bwrap,
        *binds,
        '--dev', '/dev',
        '--proc', '/proc',
        '--tmpfs', '/tmp',
        '--bind', str(workdir), '/work',
        '--chdir', '/work',
        '--unshare-net',
        '--unshare-pid',
        '--die-with-parent',
        python_bin, '-I', '/work/runner.py', '/work/user.py',
    ]


def _run_cmd(cmd: list[str], *, cwd: Path, timeout: int, env: dict[str, str], preexec=None):
    popen_kwargs = {
        'cwd': str(cwd),
        'env': env,
        'stdout': subprocess.PIPE,
        'stderr': subprocess.PIPE,
        'start_new_session': True,
    }
    # preexec_fn is Unix-only; Windows raises ValueError if it is set.
    if preexec is not None and os.name != 'nt':
        popen_kwargs['preexec_fn'] = preexec
    proc = subprocess.Popen(cmd, **popen_kwargs)
    timed_out = False
    stdout_b = b''
    stderr_b = b''
    try:
        stdout_b, stderr_b = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        killers = []
        if hasattr(os, 'killpg') and hasattr(signal, 'SIGKILL'):
            killers.append(lambda: os.killpg(proc.pid, signal.SIGKILL))
        killers.extend([proc.kill, proc.terminate])
        for killer in killers:
            try:
                killer()
                break
            except (ProcessLookupError, PermissionError, OSError):
                continue
        try:
            stdout_b, stderr_b = proc.communicate(timeout=2)
        except Exception:
            stdout_b = stdout_b or b''
            stderr_b = stderr_b or b''
    stdout = _truncate((stdout_b or b'').decode('utf-8', 'replace'))
    stderr = _truncate((stderr_b or b'').decode('utf-8', 'replace'))
    return proc.returncode if proc.returncode is not None else -1, stdout, stderr, timed_out


def run_python(code: str, *, timeout: int = DEFAULT_TIMEOUT) -> dict:
    """Execute `code` in a subprocess sandbox and return stdout/stderr."""
    if code is None:
        code = ''
    if not isinstance(code, str):
        return {
            'ok': False,
            'stdout': '',
            'stderr': 'sandbox: code must be text',
            'timed_out': False,
            'exit_code': 2,
            'images': [],
        }
    encoded = code.encode('utf-8', 'replace')
    if len(encoded) > MAX_CODE_BYTES:
        return {
            'ok': False,
            'stdout': '',
            'stderr': f'sandbox: code exceeds {MAX_CODE_BYTES} bytes',
            'timed_out': False,
            'exit_code': 2,
            'images': [],
        }
    timeout = max(1, min(int(timeout or DEFAULT_TIMEOUT), 15))
    python_bin = _sandbox_python()
    env = {
        'PATH': os.environ.get('PATH', '') if os.name == 'nt' else '/usr/bin:/bin',
        'LANG': os.environ.get('LANG', 'C.UTF-8'),
        'LC_ALL': 'C.UTF-8' if os.name != 'nt' else os.environ.get('LC_ALL', 'C.UTF-8'),
        'PYTHONDONTWRITEBYTECODE': '1',
        'PYTHONIOENCODING': 'utf-8',
        'HOME': '/work',
        'TMPDIR': '/tmp',
    }
    if os.name == 'nt':
        for key in ('SYSTEMROOT', 'WINDIR', 'PATHEXT', 'COMSPEC', 'TEMP', 'TMP'):
            if key in os.environ:
                env[key] = os.environ[key]
    with tempfile.TemporaryDirectory(prefix='notespro-py-') as raw_dir:
        workdir = Path(raw_dir)
        (workdir / 'user.py').write_text(code, encoding='utf-8')
        (workdir / 'runner.py').write_text(RUNNER_SOURCE, encoding='utf-8')
        fallback_env = dict(env)
        fallback_env['HOME'] = str(workdir)
        fallback_env['TMPDIR'] = str(workdir)

        bwrap_cmd = _bwrap_cmd(python_bin, workdir)
        if bwrap_cmd:
            try:
                exit_code, stdout, stderr, timed_out = _run_cmd(
                    bwrap_cmd, cwd=workdir, timeout=timeout, env=env,
                )
                if 'Creating new namespace failed' not in stderr:
                    return _run_result(
                        exit_code, stdout, stderr, timed_out,
                        _collect_plot_images(workdir),
                    )
            except FileNotFoundError:
                pass

        fallback_cmd = [python_bin, '-I', str(workdir / 'runner.py'), str(workdir / 'user.py')]
        exit_code, stdout, stderr, timed_out = _run_cmd(
            fallback_cmd,
            cwd=workdir,
            timeout=timeout,
            env=fallback_env,
            preexec=_limit_resources,
        )
        return _run_result(
            exit_code, stdout, stderr, timed_out,
            _collect_plot_images(workdir),
        )
