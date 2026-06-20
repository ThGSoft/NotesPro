"""Open local filesystem paths in the OS file manager (Explorer, Finder, etc.)."""
import os
import platform
import re
import subprocess
from urllib.parse import unquote, urlparse


def file_url_to_path(href: str) -> str:
    href = (href or '').strip().strip('"').strip("'")
    if not href:
        raise ValueError('Path required')
    if not href.lower().startswith('file:'):
        return os.path.normpath(href)

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

    if os.name == 'nt':
        if len(path) > 2 and path[0] == '/' and path[2] == ':':
            path = path[1:]
        if path.startswith('//') and not path.startswith('\\\\'):
            path = '\\\\' + path[2:].replace('/', '\\')

    path = path.replace('/', os.sep)
    if path:
        return os.path.normpath(path)

    raw = re.sub(r'^file://+', '', href, flags=re.I)
    raw = unquote(raw.lstrip('/').replace('/', os.sep))
    if os.name == 'nt' and len(raw) > 2 and raw[0] in '/\\' and raw[1].isalpha() and raw[2] == ':':
        raw = raw.lstrip('/\\')
    return os.path.normpath(raw)


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
    resolved = os.path.abspath(os.path.normpath(path))
    if not os.path.exists(resolved):
        raise FileNotFoundError(resolved)

    system = platform.system()
    if system == 'Windows':
        _windows_open_in_explorer(resolved)
    elif system == 'Darwin':
        if os.path.isfile(resolved):
            subprocess.run(['open', '-R', resolved], check=False)
        else:
            subprocess.run(['open', resolved], check=False)
    else:
        target = resolved if os.path.isdir(resolved) else os.path.dirname(resolved)
        subprocess.run(['xdg-open', target], check=False)
    return resolved
