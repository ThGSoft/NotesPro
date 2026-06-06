# Django Notes Pro

Features:
- Multiple workspaces
- jsTree with search
- Inline rename
- Page / folder create, rename, delete
- Drag-drop sorting
- Quill rich editor
- EasyMDE markdown editor
- Lightweight block editor
- Editor mode switch: rich / markdown / blocks / preview
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

## Notes
- The block editor is a lightweight JSON block system, not a full Notion clone.
- Quill image uploads use `/api/uploads/`.
- File manager shows uploaded files from the media folder.
