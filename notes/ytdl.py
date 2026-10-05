"""Download one YouTube video with yt-dlp_x86 on Windows and yt-dlp on Linux."""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from django.conf import settings


def ytdlp_names():
    if sys.platform.startswith('win'):
        return ('yt-dlp_x86.exe', 'yt-dlp_x86')
    return ('yt-dlp',)


def ytdlp_label():
    return 'yt-dlp' if not sys.platform.startswith('win') else 'yt-dlp_x86'
YOUTUBE_HOSTS = {
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'music.youtube.com',
    'youtu.be',
    'www.youtu.be',
    'youtube-nocookie.com',
    'www.youtube-nocookie.com',
}
MEDIA_EXTS = {'.mp4', '.webm', '.mkv', '.m4a', '.mp3', '.opus', '.ogg', '.mov'}
MAX_BYTES = 250 * 1024 * 1024
TIMEOUT_SECONDS = 600


class YtDlpError(Exception):
    pass


def normalize_youtube_url(raw) -> str:
    text = str(raw or '').strip()
    parsed = urlparse(text)
    host = (parsed.hostname or '').lower().rstrip('.')
    if parsed.scheme not in ('http', 'https') or host not in YOUTUBE_HOSTS:
        raise YtDlpError('Paste a YouTube link.')
    if not parsed.path and not parsed.query:
        raise YtDlpError('Paste a YouTube link.')
    return text


def find_ytdlp() -> Path | None:
    configured = str(getattr(settings, 'YTDLP_BIN', '') or '').strip()
    candidates = []
    if configured:
        candidates.append(Path(configured))
    base = Path(getattr(settings, 'BASE_DIR', '.'))
    for name in ytdlp_names():
        candidates.append(base / name)
        candidates.append(base / 'bin' / name)
        found = shutil.which(name)
        if found:
            candidates.append(Path(found))
    for path in candidates:
        if path.is_file():
            return path
    return None


def run_ytdlp(exe: Path, url: str, dest_dir: Path) -> subprocess.CompletedProcess:
    dest_dir.mkdir(parents=True, exist_ok=True)
    outtmpl = str(dest_dir / '%(title).80s-%(id)s.%(ext)s')
    command = [
        str(exe),
        '--no-playlist',
        '--no-mtime',
        '--restrict-filenames',
        '--no-warnings',
        '-f', 'b[ext=mp4]/b',
        '--max-filesize', '250M',
        '-o', outtmpl,
        url,
    ]
    flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    options = {}
    if flags:
        options['creationflags'] = flags
    return subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=TIMEOUT_SECONDS,
        check=False,
        **options,
    )


def pick_media_file(dest_dir: Path) -> Path | None:
    files = [
        path for path in dest_dir.iterdir()
        if path.is_file() and path.suffix.lower() in MEDIA_EXTS and path.stat().st_size > 0
    ]
    if not files:
        return None
    return max(files, key=lambda path: path.stat().st_size)


def _error_text(result: subprocess.CompletedProcess) -> str:
    text = (result.stderr or result.stdout or '').strip()
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return f'{ytdlp_label()} could not download that video.'
    return lines[-1][:400]


def download_youtube(url: str) -> tuple[bytes, str]:
    page = normalize_youtube_url(url)
    exe = find_ytdlp()
    if exe is None:
        label = ytdlp_label()
        hint = 'yt-dlp' if label == 'yt-dlp' else 'yt-dlp_x86.exe'
        raise YtDlpError(f'{label} was not found. Put {hint} in the project folder or on PATH.')
    try:
        with tempfile.TemporaryDirectory(prefix='notespro-ytdl-') as tmp:
            dest = Path(tmp)
            result = run_ytdlp(exe, page, dest)
            media = pick_media_file(dest)
            if result.returncode != 0 or media is None:
                raise YtDlpError(_error_text(result))
            if media.stat().st_size > MAX_BYTES:
                raise YtDlpError('That video is larger than 250 MB.')
            return media.read_bytes(), media.name
    except subprocess.TimeoutExpired as exc:
        raise YtDlpError('The download took too long and was stopped.') from exc
