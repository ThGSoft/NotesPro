from .models import GameHighScore

GAMES = ('pacman', 'tetris', 'lemmings', 'mario', 'sokoban', 'invaders', 'breakout', 'snake', 'marbleblast', 'chess', 'connect4', 'reversi')
MAX_SCORE = 99_999_999
TOP_N = 10
ALLOWED_EXTRA_KEYS = {
    'level', 'lines', 'saved', 'need', 'out', 'time', 'coins', 'won', 'moves', 'gems', 'course', 'falls',
    'lives', 'wave', 'length',
}


def sanitize_extra(raw):
    if not isinstance(raw, dict):
        return {}
    extra = {}
    for key, value in raw.items():
        name = str(key).strip().lower()[:24]
        if name not in ALLOWED_EXTRA_KEYS:
            continue
        if isinstance(value, bool):
            extra[name] = value
        elif isinstance(value, int):
            extra[name] = max(0, min(MAX_SCORE, value))
        elif isinstance(value, float):
            extra[name] = max(0, min(MAX_SCORE, int(value)))
        elif isinstance(value, str):
            extra[name] = value.strip()[:40]
    return extra


def serialize_row(row):
    return {
        'game': row.game,
        'score': int(row.score),
        'user': row.user.username,
        'user_id': row.user_id,
        'at': row.updated_at.isoformat() if row.updated_at else '',
        'extra': row.extra if isinstance(row.extra, dict) else {},
    }


def serialize_workspace_highscores(workspace, user, top_n=TOP_N):
    empty = {'me': {}, 'boards': {}}
    if workspace is None or user is None:
        return empty
    rows = list(
        GameHighScore.objects.filter(workspace=workspace).select_related('user'),
    )
    me = {}
    grouped = {}
    for row in rows:
        grouped.setdefault(row.game, []).append(row)
        if row.user_id == user.id:
            me[row.game] = serialize_row(row)
    boards = {}
    for game, items in grouped.items():
        items.sort(key=lambda r: (-int(r.score), r.updated_at))
        boards[game] = [serialize_row(r) for r in items[:top_n]]
    return {'me': me, 'boards': boards}
