"""Open local filesystem paths in the OS file manager (Explorer, Finder, etc.)."""
import os
import platform
import re
import subprocess
from urllib.parse import unquote, urlparse

_WIN_DRIVE_PREFIX_RE = re.compile(r'^[/\\]?([A-Za-z]):[/\\]?(.*)$')
_WIN_DRIVE_ONLY_RE = re.compile(r'^[/\\]?([A-Za-z]):$')


def _strip_windows_drive_slash(path: str) -> str:
    """Turn '/C:/Users/...' or '\\C:\\Users\\...' into 'C:/Users/...'."""
    if not path:
        return path
    if len(path) > 2 and path[0] in '/\\' and path[1].isalpha() and path[2] == ':':
        return path[1:]
    return path


def _collapse_win_seps(path: str) -> str:
    text = path.replace('/', '\\')
    while '\\\\' in text:
        text = text.replace('\\\\', '\\')
    return text


def _as_windows_path(path: str):
    """If *path* looks like a Windows drive path, return 'X:\\rest' (or None)."""
    text = (path or '').strip().strip('"').strip("'")
    if not text:
        return None
    text = _strip_windows_drive_slash(_collapse_win_seps(text))
    match = _WIN_DRIVE_PREFIX_RE.match(text) or _WIN_DRIVE_ONLY_RE.match(text)
    if not match:
        return None
    drive = match.group(1).upper()
    rest = match.group(2) if match.lastindex and match.lastindex >= 2 else ''
    rest = _collapse_win_seps(rest).strip('\\')
    if rest:
        return f'{drive}:\\{rest}'
    return f'{drive}:\\'


def _wsl_mount_path(windows_path: str):
    """Map 'C:\\Users\\...' → '/mnt/c/Users/...' when running under WSL/Linux."""
    win = _as_windows_path(windows_path)
    if not win:
        return None
    drive = win[0].lower()
    rest = win[2:].lstrip('\\').replace('\\', '/')
    return f'/mnt/{drive}/{rest}' if rest else f'/mnt/{drive}'


def file_url_to_path(href: str) -> str:
    href = (href or '').strip().strip('"').strip("'")
    if not href:
        raise ValueError('Path required')

    if not href.lower().startswith('file:'):
        win = _as_windows_path(href)
        if win:
            return os.path.normpath(win) if os.name == 'nt' else win
        cleaned = _strip_windows_drive_slash(href)
        return os.path.normpath(cleaned)

    parsed = urlparse(href)
    netloc = unquote(parsed.netloc or '')
    path = unquote(parsed.path or '')

    # file://C:/Users/... — drive letter ends up in netloc
    if netloc and re.fullmatch(r'[A-Za-z](?::|%3A)?', netloc, re.I):
        drive = netloc[0].upper()
        path = f'{drive}:{path}'

    # file://server/share/... — UNC host in netloc
    elif netloc and not path.startswith('//'):
        path = f'//{netloc}{path}'

    path = _strip_windows_drive_slash(path)

    win = _as_windows_path(path)
    if win:
        return os.path.normpath(win) if os.name == 'nt' else win

    if os.name == 'nt' and path.startswith('//') and not path.startswith('\\\\'):
        path = '\\\\' + path[2:].replace('/', '\\')

    path = path.replace('/', os.sep)
    if path:
        return os.path.normpath(path)

    raw = re.sub(r'^file://+', '', href, flags=re.I)
    raw = unquote(_strip_windows_drive_slash(raw))
    win = _as_windows_path(raw)
    if win:
        return os.path.normpath(win) if os.name == 'nt' else win
    return os.path.normpath(raw.replace('/', os.sep))


def local_path_candidates(path: str):
    """Return filesystem paths to try (native + WSL mount for Windows paths)."""
    try:
        primary = file_url_to_path(path)
    except ValueError:
        primary = os.path.normpath(path)

    seen = []
    for item in (primary, _wsl_mount_path(primary)):
        if item and item not in seen:
            seen.append(item)
    return seen


def _windows_shell_execute(file_or_verb: str, params: str = '') -> None:
    import ctypes

    ret = ctypes.windll.shell32.ShellExecuteW(
        None,
        'open',
        file_or_verb,
        params or None,
        None,
        1,
    )
    if ret <= 32:
        raise OSError(f'Could not open file manager (Windows error {ret})')


def _windows_open_in_explorer(resolved: str) -> None:
    resolved = os.path.normpath(resolved)
    explorer = os.path.join(os.environ.get('SystemRoot', r'C:\Windows'), 'explorer.exe')

    if os.path.isfile(resolved):
        select_arg = f'/select,"{resolved}"'
        try:
            _windows_shell_execute(explorer, select_arg)
        except OSError:
            parent = os.path.dirname(resolved)
            if parent and os.path.isdir(parent):
                os.startfile(parent)
            else:
                raise
    else:
        os.startfile(resolved)


def open_in_file_manager(path: str) -> str:
    """Reveal *path* in the system file manager. Returns the resolved path."""
    resolved = None
    tried = []
    for candidate in local_path_candidates(path):
        probes = [candidate]
        # Avoid abspath() on bare Windows paths under Linux/WSL — it prefixes cwd.
        if not (os.name != 'nt' and _as_windows_path(candidate)):
            abs_candidate = os.path.abspath(os.path.normpath(candidate))
            if abs_candidate != candidate:
                probes.append(abs_candidate)
        for probe in probes:
            if probe in tried:
                continue
            tried.append(probe)
            if os.path.exists(probe):
                resolved = probe
                break
        if resolved is not None:
            break

    if resolved is None:
        raise FileNotFoundError(tried[0] if tried else path)

    system = platform.system()
    if system == 'Windows':
        _windows_open_in_explorer(resolved)
    elif system == 'Darwin':
        if os.path.isfile(resolved):
            subprocess.run(['open', '-R', resolved], check=False)
        else:
            subprocess.run(['open', resolved], check=False)
    else:
        target = resolved if os.path.isdir(resolved) else os.path.dirname(resolved) or resolved
        subprocess.run(['xdg-open', target], check=False)
    return resolved
