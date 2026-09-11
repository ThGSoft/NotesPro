import shutil
import subprocess
from pathlib import Path

from django.test import SimpleTestCase

CALCS_JS = Path(__file__).resolve().parents[1] / 'static' / 'notes' / 'calcs.js'
DASHBOARD_HTML = Path(__file__).resolve().parents[1] / 'templates' / 'notes' / 'dashboard.html'


class CalcsEngineTests(SimpleTestCase):
    def test_dashboard_loads_calcs_script(self):
        html = DASHBOARD_HTML.read_text(encoding='utf-8')
        self.assertIn("notes/calcs.js", html)

    def test_calcs_js_exports_engine(self):
        src = CALCS_JS.read_text(encoding='utf-8')
        for token in ('NotesProCalcs', 'function evaluate', 'function renderBlock', 'plot', 'FIX', '0..', '[i]:=', "kind: 'md'", "kind: 'mixed'", 'resolveCalcsStyle', 'parseCalcsQuotedLine', '__indexOrigin', 'evalScalarIndexedAssign'):
            self.assertIn(token, src)

    def test_calcs_js_self_test(self):
        node = shutil.which('node')
        if not node:
            self.skipTest('node is not available')
        result = subprocess.run(
            [node, str(CALCS_JS)],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(
            result.returncode,
            0,
            msg=result.stdout + result.stderr,
        )
