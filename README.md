# Notes Pro
* Organize your Markup Notes with a tree.
* Share you Workspace with different users.
* You can invite users with read or read / write access
* You can use Notes Pro for private or buisiness use, or both together
* Paste Images easyly into Markdown text
* Add sheets and charts inside MarkupNotes, calculates inside sheets.
* Integrated Chat and Mail Feature
Features:
- Multiple workspaces
- jsTree with search
- Inline rename
- Page / folder create, rename, delete
- Drag-drop sorting
- EasyMDE markdown editor with preview
- Tab-separated `sheet` blocks (formulas) and D3 `chart` blocks linked by sheet id
- File manager
- Drag-drop image upload
- Dark dashboard UI

## Install

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py makemigrations
python manage.py createsuperuser
python manage.py seed_demo
python manage.py runserver
```

Open:
- http://127.0.0.1:8000/login/
- Demo user after `seed_demo`: `demo` / `password`

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

## Sheets and charts

Define data in a sheet block (set `id` so charts can reference it):

~~~
```sheet
`id=quarterly; header=1
Month	Sales
Jan	100
Feb	150
Mar	200
```
~~~

Render a D3 chart from that sheet:

~~~
```chart
quarterly
bar
```
~~~

Or use a config line: `` `sheet=quarterly; type=line; x=Month; y=Sales ``

Chart types: `bar`, `line`, `pie`. Column `x` / `y` can be header names or `0`-based indices.

## Notes
- Markdown images and attachments use `/api/uploads/`.
- File manager shows uploaded files from the media folder.
