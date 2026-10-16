"""Install the self-hosted diagrams.net editor."""

import os
import subprocess
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

REPO = 'https://github.com/jgraph/drawio.git'

# Stock PreConfig leaves DRAWIO_BASE_URL null, and the app then loads
# https://app.diagrams.net on any host that is not diagrams.net itself.
PRECONFIG = """/**
 * Copyright (c) 2006-2024, JGraph Holdings Ltd
 * Copyright (c) 2006-2024, draw.io AG
 */
// Overrides of global vars need to be pre-loaded.
// NotesPro serves this folder, so the base URL is this directory.
window.DRAWIO_PUBLIC_BUILD = true;
window.EXPORT_URL = null; // null: PDF export uses the print dialog
(function () {
  var path = window.location.pathname || '';
  var cut = path.lastIndexOf('/');
  var dir = cut >= 0 ? path.substring(0, cut) : '';
  var base = window.location.origin + dir;
  window.DRAWIO_BASE_URL = base;
  window.DRAWIO_VIEWER_URL = base + '/js/viewer-static.min.js';
  window.DRAWIO_LIGHTBOX_URL = base;
})();
window.DRAW_MATH_URL = 'math4/es5';
window.DRAWIO_CONFIG = null;
urlParams['sync'] = 'manual';
"""


class Command(BaseCommand):
    help = (
        'Clone jgraph/drawio and serve src/main/webapp as the Draw.io editor. '
        'Re-run with --update to pull and reapply the local base URL.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--update',
            action='store_true',
            help='Fast-forward an existing checkout, then reapply the local base URL.',
        )

    def handle(self, *args, **options):
        root = Path(settings.BASE_DIR) / 'vendor' / 'drawio'
        webapp = root / 'src' / 'main' / 'webapp'
        if options['update']:
            if not (root / '.git').is_dir():
                raise CommandError(f'No checkout at {root}. Run fetch_drawio without --update first.')
            self._git(['git', '-C', str(root), 'pull', '--ff-only'])
            self._git(['git', '-C', str(root), 'sparse-checkout', 'set', 'src/main/webapp'])
        elif not (webapp / 'index.html').is_file():
            if root.exists():
                raise CommandError(
                    f'{root} exists but has no src/main/webapp/index.html. '
                    'Remove that folder and run this again.'
                )
            root.parent.mkdir(parents=True, exist_ok=True)
            self._git([
                'git', 'clone', '--depth', '1', '--filter=blob:none', '--sparse',
                REPO, str(root),
            ])
            self._git(['git', '-C', str(root), 'sparse-checkout', 'set', 'src/main/webapp'])
        pre = webapp / 'js' / 'PreConfig.js'
        if not pre.parent.is_dir():
            raise CommandError(f'Missing {pre.parent}. The draw.io clone did not include the webapp.')
        pre.write_text(PRECONFIG, encoding='utf-8', newline='\n')
        self._link_static(webapp)
        self.stdout.write(self.style.SUCCESS(f'Draw.io editor ready in {webapp}'))

    def _link_static(self, webapp):
        """Expose the webapp at /static/drawio/ via vendor/drawio-static/drawio."""
        link = Path(settings.BASE_DIR) / 'vendor' / 'drawio-static' / 'drawio'
        link.parent.mkdir(parents=True, exist_ok=True)
        if link.exists():
            return
        if os.name == 'nt':
            self._git(['cmd', '/c', 'mklink', '/J', str(link), str(webapp)])
            return
        link.symlink_to(webapp, target_is_directory=True)

    def _git(self, args):
        self.stdout.write(' '.join(args))
        result = subprocess.run(args, check=False)
        if result.returncode != 0:
            raise CommandError(f'git failed ({result.returncode}): {" ".join(args)}')
