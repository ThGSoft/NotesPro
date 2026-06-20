# Django Notes Pro

Collaborative notes app with workspaces, markdown editing, embedded spreadsheets and charts, team chat, and encrypted messaging.

## Screenshots
```sheet
Dashboard (edit + preview) | Editor toolbar & find/replace 
![Dashboard overview](/media/uploads/2026/06/dashboard-overview.png) ![Editor toolbar](/media/uploads/2026/06/dashboard-editor.png)

Preview mode (sheets & charts) | Chat panel (private / group / mail) |

![Preview mode](/media/uploads/2026/06/dashboard-editor.png) ![Chat panel](/media/uploads/2026/06/dashboard-chat.png)

Screenshots are generated from `docs/screenshots/dashboard-mock.html` (static mock using the app stylesheet). After UI changes, refresh them by opening that file via a local server and capturing each `?shot=` view (`overview`, `editor`, `preview`, `chat`).

## Features

### Notes & workspaces
- Multiple workspaces with members, roles, and email invites
- jsTree page/folder tree with search, drag-and-drop reorder, inline rename
- **Per-workspace page memory** — last opened page is restored when you switch workspaces
- EasyMDE markdown editor with split edit + live preview, synced scrolling, and floating TOC
- **Two-row editor toolbar** — structure tools on the first row; find/replace, indent, colors, and font size on the second
- **Find / replace** bar above the editor (`Ctrl+F`, `Ctrl+H`, `F3`); **Replace all** for bulk edits
- **Snippets** — reusable text blocks (toolbar + sidebar); stored in your user settings
- **Colored panels** — info / success / warning / danger / note callout blocks in markdown
- Tab-separated `sheet` blocks (formulas) and D3 `chart` blocks linked by sheet id
- File manager with drag-and-drop uploads; click images to open in a new tab
- **Local file links** — paste Windows paths or insert via toolbar; click in preview to reveal in Explorer (local dev server)
- Resizable dashboard panels (sidebar, editor, chat/mail)
- Dark dashboard UI

### Chat & mail
- **Private chat** — WhatsApp-style 1:1 messages, end-to-end encrypted in the browser (ECDH + AES-GCM)
- Optional **P2P delivery** via WebRTC when both users are online; server relay as fallback
- **Group chat** — workspace-wide channel (Chat panel → **Group** tab)
- Workspace **mail** (inbox, sent, compose)
- Start a private chat from the member list (💬) or by searching users in the Private tab

### Security
- **TOTP two-factor authentication** (setup from the dashboard top bar)
- **Database encryption at rest** for page content, chat, mail, DM ciphertext, and TOTP secrets (Fernet)
- Direct messages: encrypted client-side first, then encrypted again in the database

## Install

```bash
python -m venv .venv
```

**Linux / macOS**

```bash
source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser
python manage.py seed_demo   # optional demo workspace + README page with screenshots
python manage.py runserver
```

**Windows (PowerShell)**

```powershell
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser
python manage.py seed_demo   # optional demo workspace + README page with screenshots
python manage.py runserver
```

Open:
- http://127.0.0.1:8000/login/
- Demo user after `seed_demo`: `demo` / `password` — workspace **Docs → README** contains this guide with screenshots

Copy `.env.example` to `.env.dev` (or set `DJANGO_ENV`) for local settings. See [Email invitations](#email-invitations) and [Database encryption](#database-encryption) below.

## Database encryption

Sensitive fields are encrypted at rest in SQLite. In **development**, a key is derived from `SECRET_KEY` if `DB_ENCRYPTION_KEY` is not set.

**Production** — set a dedicated Fernet key (back it up; losing it means data loss):

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Add to your environment or `.env`:

```
DB_ENCRYPTION_KEY=your-generated-key-here
```

For local file links from preview, keep `LOCAL_FILE_OPEN_ENABLED=true` only on trusted local/dev hosts (default when `DEBUG=true`). Set `LOCAL_FILE_OPEN_ENABLED=false` in production.

After upgrading from an older version, run migrations and optionally:

```bash
python manage.py encrypt_db_fields
```

## Chat

Open the **Chat** panel (💬 in the top bar).

![Chat panel](/media/uploads/2026/06/dashboard-chat.png)

| Tab | Purpose |
|-----|---------|
| **Private** | Encrypted 1:1 chats; search users or message a workspace member |
| **Group** | Shared workspace channel for all members |

Private chat requires both users to open the Private tab at least once so encryption keys are created in the browser. Status line shows **Direct · encrypted** when P2P is active, or **Private · encrypted** when using server relay.

## Email invitations

By default, emails use the **console backend** — they are **not** sent to a real inbox. They print in the terminal where `runserver` is running.

### Option A: Read emails in the terminal (default)

Run `python manage.py runserver` and watch that window when you click **Send invitation**.

### Option B: Save emails as files

```powershell
$env:DJANGO_EMAIL_BACKEND="file"
python manage.py runserver
```

Messages are written under `sent_emails/`.

### Option C: Real SMTP (Gmail, Outlook, …)

Set environment variables before starting Django (see `.env.example`):

```powershell
$env:DJANGO_EMAIL_BACKEND="smtp"
$env:EMAIL_HOST="smtp.gmail.com"
$env:EMAIL_PORT="587"
$env:EMAIL_USE_TLS="true"
$env:EMAIL_HOST_USER="you@gmail.com"
$env:EMAIL_HOST_PASSWORD="your-app-password"
$env:DEFAULT_FROM_EMAIL="you@gmail.com"
$env:SITE_URL="http://127.0.0.1:8000"
python manage.py runserver
```

Test delivery:

```bash
python manage.py send_test_email someone@example.com
```

**Note:** If the invitee already has an account with that email, they are added directly and get a “you were added” notification instead of a signup invite link.

## Sheets

Sheets are tab-separated tables embedded in markdown as fenced `sheet` blocks. Tables render at **≤ 100%** page width. They support formulas, per-cell styling, **markdown images in cells**, and can be linked from `chart` blocks by sheet id.

Use the **Insert sheet** toolbar button in the markdown editor, or type a block manually:

~~~
```sheet
`id=quarterly; frLen=2; align=left
Month	Sales	Costs
Jan	100	80
Feb	150	90
Mar	200	110
Apr	120	85
```
~~~

Set default **column width** on the fence (semicolon-separated attributes):

~~~
```sheet{width=25%; id=screenshots}
Overview	Editor	Preview	Chat
![Overview](/media/uploads/2026/06/dashboard-overview.png)	![Editor](/media/uploads/2026/06/dashboard-editor.png)	![Preview](/media/uploads/2026/06/dashboard-editor.png)	![Chat](/media/uploads/2026/06/dashboard-chat.png)
```
~~~

Column `%` widths are scaled down if their sum exceeds 100%.

### Syntax

| Rule | Description |
|------|-------------|
| **Columns** | Separate cells with a **tab** character (not spaces). |
| **Config line** | Optional first line in backticks: `` `key=value;key2=value2` `` |
| **Data rows** | One row per line after the config line. |
| **Header row** | The **first data row** is treated as column headers by default (`<thead>`). |
| **Formulas** | A cell starting with `=` is evaluated (see below). |
| **Format cell** | A cell wrapped in backticks sets formatting for that cell and all following cells until the next format cell (see below). |
| **Fence attrs** | Optional `{key=value;…}` on the opening fence, e.g. `` ```sheet{width=25%; id=foo} `` — same keys as config/format (column `width`, `id`, `align`, …). |
| **Close fence** | End the block with `` ``` `` on its **own line** before the next markdown (headings, text, …). |

### Sheet config (backtick line)

The optional first line sets **sheet-wide** options (`id`, `header`, `frLen`, …). You can **chain a format block** on the same line so the header row gets that style:

~~~
`id=styled``bold;align=center;bg-col=yellow;frlen=0;font-size=48px`
Month	Sales
~~~

First `` `id=styled` `` → sheet id for charts. Second `` `bold;align=center;…` `` → carry-forward format applied from the header row onward (no tab between the two blocks).

Sheet config keys (semicolon-separated inside one `` `…` `` block):

| Key | Description |
|-----|-------------|
| `id` or `sheet` | Sheet name used by `chart` blocks on the same page. |
| `header=0` / `false` / `no` | Treat every row as data (no header row). |
| `frLen=N` | Default decimal places for numeric display and formulas (default `2`). |
| `align=left` / `center` / `right` | Default cell alignment. |
| `col=blue` / `#777` | Default text color (CSS name or hex). |
| `bg-col=#eee` / `yellow` | Default background color (CSS name or hex). |
| `font-size=medium` | Table font size (`small`, `medium`, `large`, or CSS size). |

Example without header row:

~~~
```sheet
`id=raw; header=0
10	20	30
40	50	60
```
~~~

### Cell format (backtick, carry-forward)

Set formatting by putting a **backtick-wrapped directive** in a cell. Syntax matches the sheet config line: semicolon-separated tokens inside backticks.

~~~
`bold;align=center;frlen=0;col=blue;bg-col=#eee`
~~~

That cell and **all following cells** (left-to-right, top-to-bottom) use the format until another format cell appears.

A format prefix may be **glued to cell text** (no tab after the closing backtick): `` `bold;align=center`Month `` renders as “Month” with that format. A format-only cell uses backticks alone: `` `bold;align=center` ``.

| Token | Effect |
|-------|--------|
| `bold` | Bold text |
| `normal` / `nobold` | Turn bold off |
| `frlen=N` | Decimal places for numbers and formula results |
| `align=left` / `center` / `right` | Cell text alignment |
| `col=blue` / `#777` | Text color (CSS color name or `#hex`) |
| `bg-col=#eee` / `yellow` | Background color (CSS name or `#hex`) |
| `font-size=small` / `medium` / `large` / `12px` | Cell font size |
| `width=25%` / `120px` | **Cell/column** width (carry-forward); images scale to fit the cell |
| `col=none` / `bg-col=none` / `font-size=none` / `width=none` | Clear text, background, font size, or image width |

Only listed options change; others keep their previous value (including sheet defaults from the config line).

**Alternate syntax** (comma-separated, no backticks): `style=bold,col=blue,bg-col=#777`

Example:

~~~
```sheet
`id=styled``bold;align=center;bg-col=yellow;frlen=0;font-size=48px`
Month	Sales
`bg-col=green;frlen=0;font-size=12px`
Jan	100
Feb	150
Mar	200
`frlen=0;align=center;col=#2563eb`Total	`frlen=0;align=center`=sum(c[0, -2], c[0, 0])
```
~~~

- **Line 1** — sheet id + header format (yellow, bold, 48px) for Month/Sales  
- **Line 3** — format-only row switches data rows to green / 12px  
- **Total row** — format glued to label and formula cells

### Formulas

Cells starting with `=` are formulas. Invalid formulas show `#ERR!`.

#### Relative cell reference

`c[col, row]` — offsets relative to the **current** cell. **Column first**, then row.

| Reference | Meaning (from current cell) |
|-----------|----------------------------|
| `c[0, -1]` | Same column, one row above |
| `c[-1, 0]` | One column left, same row |
| `c[1, 1]` | One column right, one row below |

Missing or non-numeric cells count as `0` in formulas.

#### Sum of a rectangular area

~~~
=sum(c[col1, row1], c[col2, row2])
~~~

Sums all numeric cells in the inclusive rectangle between the two corners. Corner order does not matter. Case-insensitive: `SUM(...)` works too.

Example — total of three cells in the same row:

~~~
=sum(c[-2, 0], c[0, 0])
~~~

#### Sum above (same column)

~~~
=SUM_ABOVE
~~~

Adds all numeric values above the current cell in the same column.

#### Math expressions

After `c[…]` and `sum(…)` are expanded, the rest is plain JavaScript math. Available helpers:

`sqrt`, `sqr`, `abs`, `round`, `pow`, `ln`, `log`, `exp`, `ceil`, `floor`, `PI`, `E`

Examples:

~~~
=c[0, -1] + c[-1, 0]
=sqrt(c[0, -1].2)
=round(c[0,-1] * 1.19)
~~~

#### Decimal places

- Default from sheet `frLen` or active cell `style=frlen=N`.
- Override for one formula with a **`.N` suffix** (stripped before evaluation): `=c[0,-1]+c[0,-2].0` → integer result.

Formulas are evaluated **row by row, left to right**. References to cells not yet evaluated may still contain raw formula text and are treated as non-numeric.

### Editing sheets in preview

1. Click **Edit** on the page (markdown + preview side by side).
2. Click a sheet cell in the preview to edit inline.
3. Press **Enter** or click away to save; the matching tab-separated cell in the markdown `sheet` block is updated and autosaved.

Header cells are editable too. In read-only preview (not editing), cells are not editable. Editing a formula cell replaces the formula with the typed value.

**Images in cells** — any cell (header or data) can contain markdown images. They render as pictures in preview; edit the markdown in the sheet block (not inline in preview).

Set **column width** with `` ```sheet{width=25%} `` on the fence, a format token (`width=25%` in backticks, carry-forward), or both. Images scale to fit the cell. Override image size only with inline `{width=20%}` on the markdown image.

After `python manage.py seed_demo`, image paths in **Docs → README** are rewritten to `/media/uploads/…` automatically.

### Full example (data + format + formulas)

~~~
```sheet
`id=report; frLen=2
`bold;align=center`Item	Q1	Q2	Q3	Total
Product A	10	20	30	=sum(c[-3, 0], c[-1, 0])
Product B	5	15	25	=sum(c[-3, 0], c[-1, 0])
`bold;frlen=0;align=right`Grand total	=sum(c[0, -2], c[0, -1])	=sum(c[1, -2], c[1, -1])	=sum(c[2, -2], c[2, -1])	=sum(c[-4, -2], c[0, -1])
```
~~~

## Charts

Charts read data from a `sheet` block on the same page (matched by `id`). Use **Insert chart** in the toolbar to pick sheet, type, and X/Y columns.

Define data in a sheet block first:

~~~
```sheet
`id=quarterly
Month	Sales	Costs
Jan	100	80
Feb	150	90
Mar	200	110
Apr	120	85
```
~~~

Render a D3 chart from that sheet:

~~~
```chart
quarterly
bar
Month
Sales
Costs
```
~~~

Multiple Y columns produce **grouped bars** (or multiple lines). You can also use comma-separated names in one config line:

`` `sheet=quarterly; type=bar; x=Month; y=Sales,Costs` ``

Chart types: `bar`, `line`, `scatter`, `pie`. Pie charts use the first Y column only. Column names can be header names or `0`-based indices.

In preview, use the chart **settings** (gear) to switch type, toggle data points, and change X / left Y / right Y axes; settings are saved per page in your user preferences.

## Markdown editor

![Edit mode with toolbar and find bar](/media/uploads/2026/06/dashboard-editor.png)

### Edit vs preview

| Mode | How |
|------|-----|
| **Edit** | Top bar **Edit** — EasyMDE toolbar, markdown source, and live preview side by side |
| **Preview** | Top bar **Preview** — rendered page only (full width; chat panel auto-hides) |

Writers and workspace owners start in edit mode; read-only members see preview only.

### Find / replace

Available in edit mode: toolbar icons or **Find** / **Replace** bar above the editor.

| Shortcut | Action |
|----------|--------|
| `Ctrl+F` | Find |
| `Ctrl+H` | Replace |
| `F3` / `Shift+F3` | Next / previous match |
| `Esc` | Close find bar |

Use **Replace** for the current match and **All** to replace every match in the page.

### Toolbar formatting

The editor toolbar wraps across two rows. Formatting controls are on the second row.

#### Font size

**Text size** dropdown (text-height icon):

| Option | Effect |
|--------|--------|
| bigger | 150% |
| big | 125% |
| normal | Remove font-size markup |
| small | 87.5% |
| smaller | 75% |

Select text (or place the cursor on a line), then pick a size. Sizes are stored as inline `<span style="font-size:…">` in the markdown source.

#### Text and background color

**Text color** (font icon) and **Background color** (brush icon) each offer:

| Preset | Bootstrap color |
|--------|-----------------|
| red | danger |
| blue | primary |
| light blue | blue tint |
| yellow | warning |
| light green | green tint |
| green | success |
| cyan | info |

Click a preset to apply it to the selection (or current line).

**Color palette** opens a floating picker with the presets plus orange, teal, purple, pink, indigo, secondary, and dark. **Click** a swatch to preview; **double-click** to apply and close. Use **Custom** + **Apply** for any other color.

#### Indent and outdent

Toolbar **indent** / **outdent** buttons, or `Tab` / `Shift+Tab` in the markdown editor.

In split preview while editing:

- Plain text lines — add or remove leading spaces in the source
- Colored **panel** blocks — indent panel body lines
- **Sheet** cells — `Tab` indents the cell value in the markdown `sheet` block

#### Clear formatting

**Remove formats** (eraser icon) strips inline HTML (`<span>`, `<b>`, etc.) from the selection or current line.

### Snippets

Reusable text blocks stored in your user settings (`extra_configs.snippets`).

- **Toolbar** — puzzle-piece icon → manage, edit, insert
- **Sidebar** — **Snippets** panel → quick insert or **Manage snippets…**

### Colored panels

Insert via the toolbar **panel** button (square icon) or manually:

~~~
```panel info
# Optional title
Panel content with **markdown**.
```
~~~

| Type | Use |
|------|-----|
| `info` | Blue — general information |
| `success` | Green — positive / completed |
| `warning` | Amber — caution |
| `danger` | Red — important / error |
| `note` | Gray — neutral note |

Optional title: first line `# Title` or `title: My title`.

### Local file links

Link to files on your PC (paths with spaces are supported):

~~~markdown
[Report](file:///C:/Users/you/My Documents/report.pdf)
~~~

Or paste a path from Explorer (**Shift+Right click → Copy as path**) into the editor.

- **Insert** — toolbar folder icon or sidebar **Link local file…**
- **Preview click** — opens the file in Explorer / Finder when Django runs on the same machine (`LOCAL_FILE_OPEN_ENABLED`, on by default in dev)

### Tags

Tags are indexed per page and shown in a tag bar below the preview. Use any of these forms:

| Syntax | Example |
|--------|---------|
| Hashtag | `#wlan` |
| Bracket | `[tag:WLAN]` |
| Brace | `{tag: WLAN}` |

Brace and bracket forms support spaces and mixed case (`{tag: Haefely}`). `{tag: …}` and `[tag: …]` markers are hidden in preview; hashtags stay visible in the text.

You can also use the toolbar **hashtag** button on selected text.

## Notes

- Markdown images support optional size and alignment: `![alt](/media/uploads/photo.png){width=50%}` or `{width=120px; align=center}`. Pasted screenshots default to `{width=100%}`.
- Markdown images and attachments use `/api/uploads/`; preview and chat images open in a new browser tab when clicked.
- File manager lists uploads for the current workspace.
- Workspace export/import and soft-delete are available via the API and admin tools.
- Layout (sidebar width, panel sizes, last page per workspace) is persisted in **User settings**.
