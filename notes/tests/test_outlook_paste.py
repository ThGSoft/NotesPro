import json
import os
import shutil
import subprocess
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from django.test import SimpleTestCase

ROOT = Path(__file__).resolve().parents[2]
OUTLOOK_JS = Path(__file__).resolve().parents[1] / 'static' / 'notes' / 'outlook-paste.js'
DASHBOARD_HTML = Path(__file__).resolve().parents[1] / 'templates' / 'notes' / 'dashboard.html'
DASHBOARD_JS = Path(__file__).resolve().parents[1] / 'static' / 'notes' / 'dashboard.js'

BROWSER_CANDIDATES = (
    os.environ.get('NOTESPRO_BROWSER') or '',
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
)


def _browser_path():
    for candidate in BROWSER_CANDIDATES:
        if candidate and Path(candidate).is_file():
            return candidate
    return shutil.which('chrome') or shutil.which('msedge') or shutil.which('google-chrome')


class OutlookPasteTests(SimpleTestCase):
    def test_dashboard_loads_outlook_paste_before_editor(self):
        html = DASHBOARD_HTML.read_text(encoding='utf-8')
        outlook = html.find("notes/outlook-paste.js")
        editor = html.find("notes/dashboard.js")
        self.assertGreaterEqual(outlook, 0)
        self.assertGreater(editor, outlook)

    def test_editor_paste_uses_outlook_converter(self):
        src = DASHBOARD_JS.read_text(encoding='utf-8')
        self.assertIn('NotesProOutlookPaste', src)
        self.assertIn('page-link-app', src)
        listener = src.split("document.addEventListener('paste'", 1)[1][:1200]
        self.assertLess(
            listener.find('tryPasteOutlookMessage(event)'),
            listener.find('tryPasteIntoEditorPhotoFence(event)'),
        )

    def test_outlook_paste_self_test(self):
        node = shutil.which('node')
        if not node:
            self.skipTest('node is not available')
        result = subprocess.run(
            [node, str(OUTLOOK_JS)],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(
            result.returncode,
            0,
            msg=result.stdout + result.stderr,
        )
        self.assertIn('outlook paste self-test ok', result.stdout)

    def test_outlook_html_self_test_in_browser(self):
        browser = _browser_path()
        if not browser:
            self.skipTest('Chrome or Edge is not available')
        handler = partial(SimpleHTTPRequestHandler, directory=str(ROOT))
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        port = server.server_address[1]
        page = ROOT / '_outlook_paste_selftest.html'
        page.write_text(
            '<!doctype html><meta charset="utf-8">'
            '<script src="/notes/static/notes/outlook-paste.js"></script>'
            '<pre id="out"></pre><script>window.addEventListener("load",function(){'
            'var fails=window.NotesProOutlookPaste.selfTest();'
            'document.getElementById("out").textContent=JSON.stringify({fails:fails});'
            '});</script>',
            encoding='utf-8',
        )
        try:
            result = subprocess.run(
                [
                    browser, '--headless=new', '--disable-gpu', '--virtual-time-budget=8000',
                    '--dump-dom', f'http://127.0.0.1:{port}/_outlook_paste_selftest.html',
                ],
                capture_output=True,
                text=True,
                check=False,
                timeout=30,
            )
            self.assertEqual(result.returncode, 0, msg=result.stderr)
            payload = result.stdout.split('id="out">', 1)[-1].split('</pre>', 1)[0]
            data = json.loads(payload.replace('&quot;', '"').replace('&amp;', '&'))
            self.assertEqual(data.get('fails'), [])
        finally:
            server.shutdown()
            page.unlink(missing_ok=True)
