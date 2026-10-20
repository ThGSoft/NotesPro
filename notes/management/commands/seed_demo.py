import hashlib
from pathlib import Path

from django.conf import settings
from django.contrib.auth.models import User
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand

from notes.models import Page, UploadedFile, UserSettings, Workspace
from notes.media_refs import media_markdown_href

SCREENSHOT_FILES = (
    'dashboard-overview.png',
    'dashboard-editor.png',
    'dashboard-preview.png',
    'dashboard-chat.png',
    'dashboard-full.png',
    'dashboard-full1.png',
    'Kanban.png',
    'Mindmap.png',
    'SprintBoard.png',
    'Panels.png',
    'Sheets.png',
    'Sheet-Charts.png',
    'RSS-Feeds.png',
)

GALLERY_SHOTS = (
    ('dashboard-full.png', 'Dashboard'),
    ('dashboard-overview.png', 'Overview'),
    ('dashboard-editor.png', 'Editor'),
    ('dashboard-chat.png', 'Chat'),
    ('Kanban.png', 'Kanban'),
    ('Mindmap.png', 'Mindmap'),
    ('SprintBoard.png', 'Sprint board'),
    ('Sheets.png', 'Sheets'),
    ('RSS-Feeds.png', 'RSS Feeds'),
)

LIVE_DEMO_URL = 'https://thgsoft.online/DjangoNotesPro/'
LINKEDIN_SHARE_URL = (
    'https://www.linkedin.com/sharing/share-offsite/?url='
    'https%3A%2F%2Fthgsoft.online%2FDjangoNotesPro%2F'
)
YOUTUBE_UPLOAD_URL = 'https://www.youtube.com/upload'



def ensure_screenshot_uploads(workspace, user):
    """Copy docs/screenshots PNGs into the workspace file manager."""
    url_by_name = {}
    src_dir = Path(settings.BASE_DIR) / 'docs' / 'screenshots'

    for name in SCREENSHOT_FILES:
        src = src_dir / name
        if not src.is_file():
            continue

        data = src.read_bytes()
        file_hash = hashlib.md5(data).hexdigest()
        existing = UploadedFile.objects.filter(
            workspace=workspace,
            md5_hash=file_hash,
        ).first()
        if existing:
            url_by_name[name] = existing.file.url
            continue

        item = UploadedFile(
            user=user,
            workspace=workspace,
            md5_hash=file_hash,
            original_name=name,
        )
        item.file.save(name, ContentFile(data), save=True)
        url_by_name[name] = item.file.url

    return url_by_name


def build_gallery_markdown(workspace, user):
    urls = ensure_screenshot_uploads(workspace, user)
    lines = [
        '# Gallery',
        '',
        'Walk-in corridor of NotesPro screenshots. **Demo tour** starts on load — tap it to stop or start again. In **Edit**, hover the gallery and press **Ctrl+V** to paste a photo.',
        '',
        '```gallery{title=NotesPro;front=Welcome;back=NotesPro;mode=walk;demo;col=info}',
    ]
    for name, label in GALLERY_SHOTS:
        url = urls.get(name)
        if url:
            lines.append(f'![{label}]({media_markdown_href(url)})')
    lines.extend([
        '```',
        '',
        '## Share NotesPro',
        '',
        f'- Live demo: {LIVE_DEMO_URL}',
        f'- [Share on LinkedIn]({LINKEDIN_SHARE_URL})',
        f'- [Upload a walkthrough on YouTube]({YOUTUBE_UPLOAD_URL}) — film **Docs → Gallery** with Demo tour on your phone, then paste the watch URL into this gallery.',
        '',
    ])
    return '\n'.join(lines)


LABYRINTH_FALLBACK_SHOTS = (
    ('https://picsum.photos/id/1015/960/720', 'Lake'),
    ('https://picsum.photos/id/1018/960/720', 'Forest'),
    ('https://picsum.photos/id/1016/960/720', 'Coast'),
    ('https://picsum.photos/id/1043/960/720', 'Valley'),
    ('https://picsum.photos/id/1036/960/720', 'Bridge'),
    ('https://picsum.photos/id/1019/960/720', 'Hills'),
)


def build_labyrinth_markdown(workspace, user):
    urls = ensure_screenshot_uploads(workspace, user)
    lines = [
        '# Photo labyrinth',
        '',
        'First-person maze whose walls are NotesPro screenshots. **Demo tour** auto-walks the path. **Enter** starts the timer; walk through the green **EXIT** to stop it.',
        '',
        '```labyrinth{title=Photo labyrinth;demo;col=warning}',
    ]
    used = False
    for name, label in GALLERY_SHOTS:
        url = urls.get(name)
        if url:
            lines.append(f'![{label}]({media_markdown_href(url)})')
            used = True
    if not used:
        for url, label in LABYRINTH_FALLBACK_SHOTS:
            lines.append(f'![{label}]({url})')
    lines.extend([
        '```',
        '',
        'Paste or drop more photos while editing — they cover the maze walls.',
        '',
    ])
    return '\n'.join(lines)


def build_readme_markdown(workspace, user):
    readme_path = Path(settings.BASE_DIR) / 'README.md'
    if not readme_path.is_file():
        return (
            '# Django Notes Pro\n\n'
            'README.md was not found in the project root.\n'
        )

    text = readme_path.read_text(encoding='utf-8')
    for name, url in ensure_screenshot_uploads(workspace, user).items():
        text = text.replace(f'docs/screenshots/{name}', media_markdown_href(url))
    return text


NOTESLIST_DEMO_MARKDOWN = """# NotesList

Local ads board. Search, pick a category, open a listing, then **Reply** to enter a message mailed to all group members. **Add item** sends a listing by mail. Page owners can **Edit** a listing.

```noteslist{to=demo;city=Main;currency=EUR}
# community
Neighborhood picnic | free | Riverside | Saturday potluck at the park. Bring a dish.
Lost cat | — | Elm St | Orange tabby, answers to Maple. Last seen near the bakery.

# services
Bike tune-up | 35 | Downtown | Pickup or drop-off. Same-day if booked before noon.
Tutoring | 20 | Campus | Math and physics, evenings.

# housing
Studio loft | 780 | Old Town | Bright one-room, available Oct 1, no pets.
Room share | 420 | Eastside | Furnished room in a 3-bed flat.

# for sale
Desk lamp | 12 | Downtown | Working LED lamp, pickup only | https://picsum.photos/id/106/400/300
Road bike | 180 | Harbor | 21-speed, recently serviced | https://picsum.photos/id/146/400/300
Standing desk | 90 | Midtown | Adjustable height, minor scuffs | https://picsum.photos/id/201/400/300

# jobs
Barista | hourly | Cafe Row | Weekend shifts, training provided.
Page editor | remote | Workspace | Help keep the Docs folder tidy.

# gigs
Moving help | 40 | West End | Two hours, Saturday morning.
Photo walk | 25 | Market | Shoot product photos for a stall.
```
"""


RSS_FEEDS_MARKDOWN = """# RSS Feeds

## Great Britain

### bbc.news
```news url=https://feeds.bbci.co.uk/news/world/rss.xml
```

## Deutschland

### tagesschau.de
```news url=https://www.tagesschau.de/index~rss2.xml
# World news
```

### spiegel.de
```news url=https://www.spiegel.de/schlagzeilen/tops/index.rss
```

### zeit.de
```news url=https://newsfeed.zeit.de/index
# News
```

### stern.de
```news url=https://www.stern.de/feed/standard/alle-nachrichten/
# World news
```

### n-tv.de
```news url=https://www.n-tv.de/politik/rss
```

## Schweiz

### nnz.schweiz
```news url=https://www.nzz.ch/schweiz.rss
# World news
```

### bazonline
```news url=https://partner-feeds.publishing.tamedia.ch/rss/bazonline/front
```

### bazonline.sport
```news url=https://partner-feeds.publishing.tamedia.ch/rss/bazonline/sport
```

### bazonline.schweiz
```news url=https://partner-feeds.publishing.tamedia.ch/rss/bazonline/schweiz
```

### bazonline.wirtschaft
```news url=https://partner-feeds.publishing.tamedia.ch/rss/bazonline/wirtschaft
```

### bazonline.digital
```news url=https://partner-feeds.publishing.tamedia.ch/rss/bazonline/digital
```

### sonntagszeitung
```news url=https://partner-feeds.publishing.tamedia.ch/rss/bazonline/sonntagszeitung
```

### srf.news
```news url=https://www.srf.ch/news/bnf/rss/1646
```

### srf.sport
```news url=https://partner-feeds.publishing.tamedia.ch/rss/bazonline/sport
```
"""


CALENDAR_DEMO_MARKDOWN = """# Calendar

Day, week, month, and year views with sample notes. In **Edit**, click a day to add events, or **hover a day and press Ctrl+V** to paste a screenshot onto it.

## Day

```calendar{from=01.09.26;to=30.09.26;mode=day;col=info;title=September 2026}
@d:07.09.26 | **Sprint planning** | ![Lake](https://picsum.photos/id/1015/640/480) | ![Hills](https://picsum.photos/id/1016/640/480)
@d:09.09.26 | 09:00-09:30 | Standup
@d:09.09.26 | 14:00-15:00 | Demo review
@d:11.09.26 | 10:00-12:00 | Workshop | ![Workshop](https://picsum.photos/id/1018/640/480)
@d:15.09.26-18.09.26 | Conference
@d:21.09.26-25.09.26 | Vacation
```

## Week

```calendar{from=01.09.26;to=30.09.26;mode=week;col=primary;title=Weeks}
@w:2026-W37 | **Sprint 12**
@w:2026-W39 | Off-site
@d:09.09.26 | 09:00-09:30 | Standup
@d:15.09.26-18.09.26 | Conference
```

## Month

```calendar{from=01.01.26;to=31.12.26;mode=month;col=success;title=2026}
@m:2026-9 | NotesPro demo month
@d:09.09.26 | 14:00-15:00 | Demo review
@d:15.09.26-18.09.26 | Conference
@d:21.09.26-25.09.26 | Vacation
```

## Year

```calendar{from=01.01.25;to=31.12.27;mode=year;col=danger;title=Years}
@y:2025 | Kickoff year
@y:2026 | **NotesPro** demo
@y:2027 | Roadmap
```
"""


GAMES_DEMO_PAGES = (
    (
        'sudoku',
        'Sudoku',
        0,
        '# Sudoku\n\n'
        '```sudoku{fullscreen;sample=classic}\n'
        '```\n',
    ),
    (
        'puzzle',
        'Jigsaw puzzle',
        1,
        '# Jigsaw puzzle\n\n'
        '```puzzle{fullscreen;difficulty=medium}\n'
        '![Lake](https://picsum.photos/id/1015/960/720)\n'
        '```\n',
    ),
    (
        'pinball',
        'Pinball',
        2,
        '# Pinball\n\n'
        '```pinball{fullscreen}\n'
        '```\n',
    ),
    (
        'pacman',
        'Pac-Man',
        3,
        '# Pac-Man\n\n'
        '```pacman{fullscreen}\n'
        '```\n',
    ),
    (
        'mario',
        'Super Mario',
        4,
        '# Super Mario\n\n'
        '```mario{fullscreen}\n'
        '```\n',
    ),
    (
        'lemmings',
        'Lemmings',
        5,
        '# Lemmings\n\n'
        '```lemmings{fullscreen}\n'
        '```\n',
    ),
    (
        'tictactoe',
        'Tic Tac Toe',
        6,
        '# Tic Tac Toe\n\n'
        '```tictactoe{fullscreen;mode=cpu;difficulty=medium}\n'
        '```\n',
    ),
    (
        'chess',
        'Chess',
        7,
        '# Chess\n\n'
        'Play white against the CPU, or switch to two players. Click a piece, then a highlighted square.\n\n'
        '```chess{fullscreen;mode=cpu;difficulty=medium}\n'
        '```\n',
    ),
    (
        'connect4',
        'Connect Four',
        8,
        '# Connect Four\n\n'
        'Drop discs to get four in a row. CPU or hotseat.\n\n'
        '```connect4{fullscreen;mode=cpu;difficulty=medium}\n'
        '```\n',
    ),
    (
        'reversi',
        'Reversi',
        9,
        '# Reversi\n\n'
        'You play black. Flank the CPU to flip discs; corners are gold.\n\n'
        '```reversi{fullscreen;mode=cpu;difficulty=medium}\n'
        '```\n',
    ),
    (
        'muhle',
        'Mühle',
        9,
        '# Mühle\n\n'
        'Nine Men\'s Morris. Place nine white stones, then slide along the lines. '
        'Three in a row is a mill: remove an opponent stone. '
        'With three stones left you may fly.\n\n'
        '```muhle{fullscreen;mode=cpu;difficulty=medium}\n'
        '```\n',
    ),
    (
        'backgammon',
        'Backgammon',
        9,
        '# Backgammon\n\n'
        'You play white. Roll, click a checker, then a highlighted point. '
        'Hit blots, enter from the bar, and bear off all fifteen. '
        'A gammon or backgammon is worth extra.\n\n'
        '```backgammon{fullscreen;mode=cpu;difficulty=medium}\n'
        '```\n',
    ),
    (
        'carambole',
        'Carambole',
        9,
        '# Carambole\n\n'
        'Three balls, no pockets. You and the CPU both shoot the white ball. '
        'Drag back from it and release. A carom scores when it touches yellow and red. '
        'Switch to 3-cushion when you want the rails to count.\n\n'
        '```carambole{fullscreen;mode=cpu;difficulty=medium;variant=libre}\n'
        '```\n',
    ),
    (
        'carrom',
        'Carrom',
        9,
        '# Carrom\n\n'
        'You play white from the near baseline. Slide the striker along the line, '
        'pull back, and release. Pocket your coins. Cover the red queen with one of yours '
        'before the last coin. The striker in a pocket is a foul.\n\n'
        '```carrom{fullscreen;mode=cpu;difficulty=medium;size=medium}\n'
        '```\n',
    ),
    (
        'dart',
        'Darts',
        9,
        '# Darts\n\n'
        '501, double-out. Pull back from the dart like a cue, then release. A longer pull throws harder. '
        'Three darts a visit. The inner bull counts as a double. '
        'Switch to 301 for a shorter leg.\n\n'
        '```dart{fullscreen;mode=cpu;difficulty=medium;variant=501}\n'
        '```\n',
    ),
    (
        'tetris',
        'Tetris',
        10,
        '# Tetris\n\n'
        '```tetris{fullscreen}\n'
        '```\n',
    ),
    (
        'sokoban',
        'Sokoban',
        11,
        '# Sokoban\n\n'
        'Push every crate onto a gold target. U undoes, R resets, [ ] changes level.\n\n'
        '```sokoban{fullscreen}\n'
        '```\n',
    ),
    (
        'invaders',
        'Space Invaders',
        12,
        '# Space Invaders\n\n'
        'Defend Earth from the descending ranks. ← → move, Space fire, P pause, R restart.\n\n'
        '```invaders{fullscreen}\n'
        '```\n',
    ),
    (
        'breakout',
        'Breakout',
        13,
        '# Breakout\n\n'
        'Bounce the ball to clear every brick. ← → or mouse to move, Space to launch.\n\n'
        '```breakout{fullscreen}\n'
        '```\n',
    ),
    (
        'snake',
        'Snake',
        14,
        '# Snake\n\n'
        'Eat to grow. Hit a wall or yourself and it is over. R restarts. Add `wrap` in the fence for wrap-around edges.\n\n'
        '```snake{fullscreen}\n'
        '```\n',
    ),
    (
        'marbleblast',
        'Marble blast',
        15,
        '# Marble blast\n\n'
        'Roll the marble, collect gems, then hit the gold finish pad. Space jumps. [ ] changes course. '
        'C / **View** toggles ego chase cam vs orbit. In ego view, **WASD** rolls the marble (A/D strafe) and drag looks around. Fence `view=ego` (or `cam=ego` / `ego`) starts in ego view.\n\n'
        '```marbleblast{fullscreen;view=ego}\n'
        '```\n',
    ),
    (
        'photocube',
        'Photo cube',
        16,
        '# Photo cube\n\n'
        '```photocube{title=Photo cube;col=info}\n'
        '![Lake](https://picsum.photos/id/1015/800/800)\n'
        '![Forest](https://picsum.photos/id/1018/800/800)\n'
        '![Coast](https://picsum.photos/id/1016/800/800)\n'
        '![Valley](https://picsum.photos/id/1043/800/800)\n'
        '![Bridge](https://picsum.photos/id/1036/800/800)\n'
        '![Hills](https://picsum.photos/id/1019/800/800)\n'
        '```\n',
    ),
    (
        'photobook',
        'Photo book',
        17,
        '# Photo book\n\n'
        '```photobook{title=Photo book;col=warning}\n'
        '![Cover lake](https://picsum.photos/id/1015/960/720)\n'
        '![Forest path](https://picsum.photos/id/1018/960/720)\n'
        '![Coast](https://picsum.photos/id/1016/960/720)\n'
        '![Valley](https://picsum.photos/id/1043/960/720)\n'
        '![Bridge](https://picsum.photos/id/1036/960/720)\n'
        '![Hills](https://picsum.photos/id/1019/960/720)\n'
        '![Town](https://picsum.photos/id/1025/960/720)\n'
        '![Sky](https://picsum.photos/id/1011/960/720)\n'
        '```\n',
    ),
    (
        'rollercoast',
        'Roller coaster',
        18,
        '# Roller coaster\n\n'
        '```rollercoast{mode=jungle;title=Jungle coaster;demo;col=success}\n'
        '![Canopy](https://picsum.photos/id/1018/960/720)\n'
        '![River](https://picsum.photos/id/1015/960/720)\n'
        '![Trail](https://picsum.photos/id/1043/960/720)\n'
        '![Mist](https://picsum.photos/id/1016/960/720)\n'
        '```\n',
    ),
    (
        'scooter',
        'Auto scooter',
        19,
        '# Auto scooter\n\n'
        '```scooter{title=Auto scooter;demo;col=warning}\n'
        '![Blue](https://picsum.photos/id/1015/640/480)\n'
        '![Green](https://picsum.photos/id/1018/640/480)\n'
        '![Coast](https://picsum.photos/id/1016/640/480)\n'
        '![Valley](https://picsum.photos/id/1043/640/480)\n'
        '![Bridge](https://picsum.photos/id/1036/640/480)\n'
        '```\n',
    ),
    (
        'ghosttrain',
        'Ghost train',
        20,
        '# Ghost train\n\n'
        '```ghosttrain{title=Ghost train;demo;col=note}\n'
        '![Phantom](https://picsum.photos/id/1011/640/480)\n'
        '![Mist](https://picsum.photos/id/1016/640/480)\n'
        '![Grave](https://picsum.photos/id/1025/640/480)\n'
        '![Night](https://picsum.photos/id/1033/640/480)\n'
        '![Fog](https://picsum.photos/id/1044/640/480)\n'
        '```\n',
    ),
)


PUBLIC_PAGE = {'public': True, 'contents': True, 'tags': True}

DRAW_DEMO_MARKDOWN = """# Drawing

Draw with a finger or the mouse. No login is required on this public page.
Pen, eraser, ruler, and text are under **Tools**. Drag the text box to move it.
**Angle** turns the label. The sketch stays in this browser.

```draw{fullscreen;pen=#1e293b;bg=#fffef8;size=8}
#1e293b 8 80,400 220,180 400,320 620,150 820,280
#dc2626 10 140,120 280,150 420,100
text #1e293b 28 80,80 Notes
```
"""

def upsert_page(workspace, slug, **defaults):
    Page.objects.update_or_create(
        workspace=workspace,
        slug=slug,
        deleted=False,
        defaults=defaults,
    )


def ensure_folder(workspace, slug, title, parent, sort_order):
    page, _ = Page.objects.update_or_create(
        workspace=workspace,
        slug=slug,
        deleted=False,
        defaults={
            'parent': parent,
            'title': title,
            'is_folder': True,
            'sort_order': sort_order,
            'markdown_content': '',
        },
    )
    return page


def seed_page(workspace, parent, slug, title, sort_order, markdown):
    upsert_page(
        workspace,
        slug,
        parent=parent,
        title=title,
        is_folder=False,
        sort_order=sort_order,
        settings=PUBLIC_PAGE,
        markdown_content=markdown,
    )


def markdown_for_game(slug):
    for page_slug, _title, _order, markdown in GAMES_DEMO_PAGES:
        if page_slug == slug:
            return markdown
    raise KeyError(slug)


# Older seeds used these slugs for the same apps. Retire them so each app is one page.
LEGACY_DEMO_SLUGS = (
    'jigsaw-puzzle',
    'pac-man',
    'tic-tac-toe',
    'connect-four',
    'darts',
    'space-invaders',
    'marble-blast',
    'photo-cube',
    'photo-cube-1',
    'photo-book',
    'roller-coaster',
    'auto-scooter',
    'ghost-train',
    'photo-carousel',
    'photo-labyrinth',
    'super-mario',
)

# Toolbar order. Dropdown buttons hold one page per item.
TOOLBAR_GAME_SLUGS = (
    'sudoku',
    'tictactoe',
    'chess',
    'connect4',
    'reversi',
    'muhle',
    'backgammon',
    'carambole',
    'carrom',
    'dart',
    'tetris',
    'sokoban',
    'invaders',
    'breakout',
    'snake',
    'marbleblast',
    'puzzle',
    'pinball',
    'pacman',
    'mario',
    'lemmings',
    'rollercoast',
    'scooter',
    'ghosttrain',
)

BLOCKS_INDEX_MARKDOWN = """# Blocks

Each app has its own page. Folders under **Demo** follow the editor tool buttons, in the same order.

- **Panel**
- **Sheet**, **Chart**, **Calcs**, **Python**
- **Calendar**, **World clock**, **Alarm**, **Countdown**, **HP-15C**, **HP-12C**, **TI-30**
- **Boards** — Gantt, Kanban, Mindmap, Kanban gantt
- **Checklist**
- **Apps** — Jukebox, Dance, Yoga
- **Forms** — Radio, Vote, Text input, Textarea, Number, Enum
- **Menu** — Menu, Shop, SW Shop, NotesList
- **Voice**, **Drawing**, **Draw.io**
- **Photos** — Gallery, Photo carousel, Photo book, Photo cube, Photo labyrinth
- **Games** — one page per game, in toolbar order
- **News**
"""


def seed_toolbar_apps(workspace, user, demo):
    """One public page per app, grouped in folders that match the toolbar buttons."""
    Page.objects.filter(workspace=workspace, slug='classifieds', deleted=False).update(slug='noteslist', title='NotesList')
    folders = []

    def add_folder(slug, title):
        folder = ensure_folder(workspace, slug, title, demo, len(folders))
        folders.append(folder)
        return folder

    panel = add_folder('tb-panel', 'Panel')
    sheet = add_folder('tb-sheet', 'Sheet')
    chart = add_folder('tb-chart', 'Chart')
    calcs = add_folder('tb-calcs', 'Calcs')
    python = add_folder('tb-python', 'Python')
    calendar = add_folder('tb-calendar', 'Calendar')
    worldclock = add_folder('tb-worldclock', 'World clock')
    alarm = add_folder('tb-alarm', 'Alarm')
    countdown = add_folder('tb-countdown', 'Countdown')
    hp15c = add_folder('tb-hp15c', 'HP-15C')
    hp12c = add_folder('tb-hp12c', 'HP-12C')
    hp42s = add_folder('tb-hp42s', 'HP-42S')
    ti30 = add_folder('tb-ti30', 'TI-30')
    boards = add_folder('tb-boards', 'Boards')
    checklist = add_folder('tb-checklist', 'Checklist')
    apps = add_folder('tb-apps', 'Apps')
    forms = add_folder('tb-forms', 'Forms')
    menu = add_folder('tb-menu', 'Menu')
    voice = add_folder('tb-voice', 'Voice')
    drawing = add_folder('tb-drawing', 'Drawing')
    drawio = add_folder('tb-drawio', 'Draw.io')
    photos = add_folder('tb-photos', 'Photos')
    games = add_folder('games', 'Games')
    news = add_folder('tb-news', 'News')

    seed_page(workspace, panel, 'panel', 'Panel', 0, """# Panel

```panel info
# info
Your content here.
```

```panel success
# success
Your content here.
```

```panel warning
# Warning
Your content here.
```

```panel danger
# danger
Your content here.
```

```panel note
# note
Your content here.
```
""")

    seed_page(workspace, sheet, 'table', 'Sheet', 0, """# Sheet

```sheet
`id=supplies
Item	Qty	Price
Paper	3	4.50
Ink	2	6.00
Ruler	1	3.20
```

```sheet
`id=quarterly
Month	Sales	Costs
Jan	100	80
Feb	150	90
Mar	200	110
Apr	120	85
```
""")

    seed_page(workspace, chart, 'chart', 'Chart', 0, """# Chart

```sheet
`id=quarterly
Month	Sales	Costs
Jan	100	80
Feb	150	90
Mar	200	110
Apr	120	85
```

```chart
quarterly
bar
Month
Sales
Costs
```
""")

    seed_page(workspace, calcs, 'calcs', 'Calcs', 0, """# Calcs

```calcs{fix=7;col=info}
(* sample *)
% Octave-style syntax
FIX(7, true)
V1 = [1 3 4 8]
sum(V1)
a = 3 + 4i
sqr(1i)
j = -10:10
y3[j] = (j.*j)/100
Plot([j, y3])
```
""")

    seed_page(workspace, python, 'python', 'Python', 0, """# Python

```python{title=Pandas;col=info}
import pandas as pd

df = pd.DataFrame({
    "name": ["Ada", "Grace", "Alan"],
    "score": [98, 91, 87],
})
print(df)
print()
print("mean score:", df["score"].mean())
print(df.describe())
```

```python{title=Plot;col=info}
import matplotlib.pyplot as plt
import numpy as np

x = np.linspace(0, 2 * np.pi, 200)
print("points:", len(x))
plt.plot(x, np.sin(x))
plt.show()
```
""")

    seed_page(workspace, calendar, 'calendar', 'Calendar', 0, CALENDAR_DEMO_MARKDOWN)

    seed_page(workspace, worldclock, 'worldclock', 'World clock', 0, """# World clock

```worldclock{title=World clock;col=info}
Local | local | both
London | Europe/London | analog
New York | America/New_York | digital
Tokyo | Asia/Tokyo | both
Sydney | Australia/Sydney | digital
CET | CET | digital
OESZ | OESZ | analog
```
""")

    seed_page(workspace, alarm, 'alarm', 'Alarm', 0, """# Alarm

```alarm{title=Alarm;col=warning}
Wake | 07:00 | off | analog
Standup | 09:30 | on | digital
```
""")

    seed_page(workspace, countdown, 'countdown', 'Countdown', 0, """# Countdown

```countdowntimer{title=Countdown;col=info}
Pomodoro | 25:00
Short break | 5:00
Tea | 3:00 | repeat
```
""")

    seed_page(workspace, hp15c, 'hp15c', 'HP-15C', 0, """# HP-15C

```hp15c{title=HP-15C;fullscreen;size=100%}
```
""")

    seed_page(workspace, hp12c, 'hp12c', 'HP-12C', 0, """# HP-12C

```hp12c{title=HP-12C;fullscreen;size=100%}
```
""")

    seed_page(workspace, hp42s, 'hp42s', 'HP-42S', 0, """# HP-42S

```hp42s{title=HP-42S;fullscreen;size=100%}
```
""")

    seed_page(workspace, ti30, 'ti30', 'TI-30', 0, """# TI-30

```ti30{title=TI-30;fullscreen;size=100%}
```
""")

    seed_page(workspace, boards, 'gantt', 'Gantt', 0, """# Gantt

```gantt{from=01.07.26;to=31.07.26;col=info}
# Project plan
Phase A | 01.07.26 | 15.07.26 | **Start**
Phase B | 15.07.26 | 31.07.26 | Delivery
```
""")
    seed_page(workspace, boards, 'kanban', 'Kanban', 1, """# Kanban

```kanban{cols=Todo,Doing,Done;col=danger}
# MidasNano Remote
Todo | Create 488 Api | **Basis 488 Commmands**
Todo | Build API
Done | Kickoff | ![](media/uploads/photo.png)
Done | Define Remote
```
""")
    seed_page(workspace, boards, 'mindmap', 'Mindmap', 2, """# Mindmap

```mindmap{dir=right;col=warning}
# Ideas
Central topic
  Branch A | **Key point**
    Detail A1
    Detail A2
  Branch B
    Detail B1 | note
```
""")
    seed_page(workspace, boards, 'sprintboard', 'Kanban gantt', 3, """# Kanban gantt

```sprintboard{cols=Todo,Doing,Suspended,Done;withcost=1;rate=50;currency=EUR;col=info}
# Sprint board
Todo | Design wireframes | status=idle;rate=60
Doing | Build API | status=idle;rate=75
Suspended | On hold task | status=suspended;rate=75;elapsed=1800
Done | Kickoff | status=stopped;rate=50;elapsed=7200
```
""")

    seed_page(workspace, checklist, 'checklist', 'Checklist', 0, """# Checklist

```checklist{align=left;col=info}
# Packing
- [ ] Passport
- [x] Tickets
- [ ] Charger
```
""")

    seed_page(workspace, apps, 'jukebox', 'Jukebox', 0, """# Jukebox

Drop MP3 files or a music folder onto the player, or use **Add tracks or folders**. Nested folders become albums. Paste a Google Drive file or folder link (**Add Drive**) — share as *Anyone with the link*. Group songs with `# Album` headings.

```jukebox{title=Livia's Jukebox;fullscreen}
```
""")
    seed_page(workspace, apps, 'dance', 'Dance', 1, """# Dance

Footstep charts for rumba, cha-cha-cha, salsa, waltz, tango, foxtrot, disco fox, blues, and rock 'n' roll.

```dance{title=Dance;col=info}
```
""")
    seed_page(workspace, apps, 'yoga', 'Yoga', 2, """# Yoga

```training{title=Good Morning Yoga;time=30s;col=info;endMessage="end"}
![Mountain pose — posture](/static/notes/yoga/morning/mountain.jpg?v=3) | 30s
![Forward bend — hamstrings](/static/notes/yoga/morning/forward-bend.jpg?v=3) | 30s
![Downward facing dog — hamstrings, calves](/static/notes/yoga/morning/downward-dog.jpg?v=3) | 30s
![Warrior 1 — quadriceps](/static/notes/yoga/morning/warrior-1.jpg?v=3) | 30s
![Warrior 2 — quadriceps](/static/notes/yoga/morning/warrior-2.jpg?v=3) | 30s
![Child's pose — lower back](/static/notes/yoga/morning/child.jpg?v=3) | 30s
![Corpse — rest](/static/notes/yoga/morning/corpse.jpg?v=3) | 30s
```
""")

    seed_page(workspace, forms, 'radio', 'Radio list', 0, """# Radio list

```radio{col=info}
# Color
- Red
- (x) Green
- Blue
```
""")
    seed_page(workspace, forms, 'vote', 'Vote', 1, """# Vote

```vote{col=info}
# Lunch
- Pizza
- Sushi
- Salad
```
""")
    seed_page(workspace, forms, 'textinput', 'Text input', 2, """# Text input

```textinput{col=info}
# Name
```
""")
    seed_page(workspace, forms, 'textarea', 'Textarea', 3, """# Textarea

```textarea{col=info}
# Notes
```
""")
    seed_page(workspace, forms, 'number', 'Number', 4, """# Number

```number{min=0;max=100;step=1;col=info}
# Count
0
```
""")
    seed_page(workspace, forms, 'enum', 'Enum', 5, """# Enum

```enum{col=info}
# Status
- Open
- (x) Doing
- Done
```
""")

    seed_page(workspace, menu, 'speisekarte', 'Menu', 0, """# Menu

```menu{to=demo;title=Lunch menu;col=warning;tables=1-4}
# Starters
Soup of the day | 6.50
Mixed salad | 7.90

# Mains
Wiener schnitzel | 18.50 | with fries
Garlic spaghetti | 14.00

# Desserts
Tiramisu | 6.50
```
""")
    seed_page(workspace, menu, 'shop', 'Shop', 1, """# Shop

```shop{to=demo;title=Office shop;col=info;currency=EUR}
# Stationery
Notebook A5 | 4.50 | Lined, 80 pages — pocket notebook for daily notes | https://picsum.photos/id/24/400/300
Pens (pack of 10) | 3.20 | Smooth black ink, office pack | https://picsum.photos/id/367/400/300

# Snacks
Coffee beans | 12.00 | 250g medium roast | https://picsum.photos/id/425/400/300
Tea selection | 8.50 | Assorted herbal and black teas | https://picsum.photos/id/225/400/300
```
""")
    seed_page(
        workspace, menu, 'sw-shop', 'SW Shop', 2,
        '# SW Shop\n\n'
        'Download a build, or add a license to the cart and **Checkout**. '
        'You are then asked to pay with **PayPal**, **Visa**, or **Mastercard**. '
        'Visa and Mastercard ask for your **Konto** and transfer to the shop Konto in **Settings**. '
        'Open **Additional info** for license notes. Card numbers are never stored.\n\n'
        '```swshop{to=demo;title=SW Shop;col=info;currency=EUR;kind=sw}\n'
        '# NotesPro\n'
        'NotesPro source | 0.00 | Collaborative notes app — zip from GitHub | https://picsum.photos/id/180/640/400 | https://github.com/ThGSoft/NotesPro/archive/refs/heads/main.zip | Python and Django. Clone or unzip, then run locally.\n'
        'NotesPro license | 49.00 | Single-site license, setup notes by mail | https://picsum.photos/id/0/640/400 | Windows, macOS, and Linux. PayPal, Visa, or Mastercard on checkout.\n'
        '```\n',
    )
    seed_page(workspace, menu, 'noteslist', 'NotesList', 3, NOTESLIST_DEMO_MARKDOWN)

    seed_page(workspace, voice, 'voice', 'Voice', 0, """# Voice note

Record in the browser, then Whisper tiny transcribes locally (first run downloads the open-source model).

```voice{lang=auto;title=Voice note;col=info}
```
""")

    seed_page(workspace, drawing, 'draw', 'Drawing', 0, DRAW_DEMO_MARKDOWN)
    seed_page(workspace, drawio, 'drawio', 'Draw.io', 0, """# Draw.io

```drawio{fullscreen;title=Diagram;ui=dark}
```
""")

    seed_page(workspace, photos, 'gallery', 'Gallery', 0, build_gallery_markdown(workspace, user))
    seed_page(workspace, photos, 'carousel', 'Photo carousel', 1, """# Photo carousel

**A/D** (or drag) turns the wheel. **W/S** or the mouse wheel tilts the camera. Switch to Wheel V for a vertical ring.

```carousel{title=Photo carousel;demo;col=info}
![Lake](https://picsum.photos/id/1015/960/720)
![Forest path](https://picsum.photos/id/1018/960/720)
![Coast](https://picsum.photos/id/1016/960/720)
![Valley](https://picsum.photos/id/1043/960/720)
![Bridge](https://picsum.photos/id/1036/960/720)
![Hills](https://picsum.photos/id/1019/960/720)
```
""")
    seed_page(workspace, photos, 'photobook', 'Photo book', 2, markdown_for_game('photobook'))
    seed_page(workspace, photos, 'photocube', 'Photo cube', 3, markdown_for_game('photocube'))
    seed_page(workspace, photos, 'labyrinth', 'Photo labyrinth', 4, build_labyrinth_markdown(workspace, user))

    game_titles = {row[0]: row[1] for row in GAMES_DEMO_PAGES}
    for index, slug in enumerate(TOOLBAR_GAME_SLUGS):
        seed_page(workspace, games, slug, game_titles[slug], index, markdown_for_game(slug))

    seed_page(workspace, news, 'rss-feeds', 'News', 0, RSS_FEEDS_MARKDOWN)

    Page.objects.filter(
        workspace=workspace,
        parent=games,
        slug='photo-labyrinth',
        deleted=False,
    ).update(deleted=True)
    Page.objects.filter(
        workspace=workspace,
        slug__in=LEGACY_DEMO_SLUGS,
        deleted=False,
    ).update(deleted=True)


class Command(BaseCommand):
    help = 'Create demo workspace and pages'

    def handle(self, *args, **options):
        user, created = User.objects.get_or_create(
            username='demo',
            defaults={'email': 'demo@example.com'},
        )
        if created:
            user.set_password('password')
            user.save()

        settings_obj, _ = UserSettings.objects.get_or_create(user=user)
        extra = dict(settings_obj.extra_configs or {}) if isinstance(settings_obj.extra_configs, dict) else {}
        extra['shop'] = {
            'description': 'Software and office shop. Download builds, or pay with PayPal, Visa, or Mastercard.',
            'info': 'Card numbers are never stored. Visa and Mastercard transfer from the buyer Konto to the shop Konto in Settings. PayPal opens a checkout window. Source downloads are zip archives from GitHub.',
            'images': [
                'https://picsum.photos/id/20/640/240',
                'https://picsum.photos/id/366/640/240',
            ],
            'paypal_enabled': True,
            'paypal': 'demo@example.com',
            'visa_enabled': True,
            'mastercard_enabled': True,
            'konto': 'DE89 3704 0044 0532 0130 00',
            'mastercard': 'Pay by invoice. Transfer to the shop Konto. Do not enter card numbers here.',
        }
        settings_obj.extra_configs = extra
        settings_obj.save(update_fields=['extra_configs'])

        ws, _ = Workspace.objects.get_or_create(
            owner=user,
            slug='main',
            deleted=False,
            defaults={'name': 'Main'},
        )
        docs, _ = Page.objects.get_or_create(
            workspace=ws,
            title='Docs',
            is_folder=True,
            deleted=False,
            defaults={'slug': 'docs'},
        )
        demo, _ = Page.objects.update_or_create(
            workspace=ws,
            slug='demo',
            deleted=False,
            defaults={
                'parent': None,
                'title': 'Demo',
                'is_folder': True,
                'sort_order': 1,
                'markdown_content': '',
            },
        )

        readme_content = build_readme_markdown(ws, user)
        Page.objects.update_or_create(
            workspace=ws,
            slug='readme',
            deleted=False,
            defaults={
                'parent': docs,
                'title': 'README',
                'sort_order': 0,
                'markdown_content': readme_content,
            },
        )

        Page.objects.update_or_create(
            workspace=ws,
            slug='welcome',
            deleted=False,
            defaults={
                'parent': docs,
                'title': 'Welcome',
                'sort_order': 1,
                'markdown_content': (
                    '# Welcome\n\n'
                    'Edit in markdown, preview when you are done.\n\n'
                    'See **README** in this folder for the full project guide and screenshots.\n\n'
                    'Each app has its own page under **Demo**. Folders there follow the editor tool buttons, in the same order: '
                    'Panel, Sheet, Chart, Calcs, Python, Calendar, World clock, Alarm, Countdown, HP-15C, HP-12C, TI-30, '
                    'Boards, Checklist, Apps, Forms, Menu, Voice, Drawing, Draw.io, Photos, Games, and News.\n\n'
                    'Those pages are public, so visitors can open them without signing in. '
                    'A sketch made without login stays in that browser.\n\n'
                    'Open **Blocks** for the same folder list.'
                ),
            },
        )

        Page.objects.update_or_create(
            workspace=ws,
            slug='blocks',
            deleted=False,
            defaults={
                'parent': docs,
                'title': 'Blocks',
                'sort_order': 2,
                'markdown_content': BLOCKS_INDEX_MARKDOWN,
            },
        )

        seed_toolbar_apps(ws, user, demo)

        missing = [
            name for name in SCREENSHOT_FILES
            if not (Path(settings.BASE_DIR) / 'docs' / 'screenshots' / name).is_file()
        ]
        if missing:
            self.stdout.write(self.style.WARNING(
                f'Screenshot files missing (README images may be broken): {", ".join(missing)}',
            ))

        self.stdout.write(self.style.SUCCESS(
            'Demo data ready. Login: demo / password — Docs for the guide, Demo for one public page per toolbar app',
        ))
