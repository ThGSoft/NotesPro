import json

from django.contrib.auth.decorators import login_required
from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from .game_scores import (
    GAMES,
    MAX_SCORE,
    sanitize_extra,
    serialize_row,
    serialize_workspace_highscores,
)
from .models import GameHighScore
from .views import _workspace_qs


@login_required
def game_highscores(request, workspace_id):
    workspace = get_object_or_404(_workspace_qs(request.user), pk=workspace_id)
    if request.method == 'GET':
        return JsonResponse(serialize_workspace_highscores(workspace, request.user))
    if request.method != 'POST':
        return JsonResponse({'status': 'error', 'message': 'Method not allowed'}, status=405)

    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)

    game = str(data.get('game') or '').strip().lower()
    if game not in GAMES:
        return JsonResponse({'status': 'error', 'message': 'Unknown game'}, status=400)
    try:
        score = int(data.get('score'))
    except (TypeError, ValueError):
        return JsonResponse({'status': 'error', 'message': 'Invalid score'}, status=400)
    score = max(0, min(MAX_SCORE, score))
    extra = sanitize_extra(data.get('extra'))

    with transaction.atomic():
        row, created = GameHighScore.objects.select_for_update().get_or_create(
            workspace=workspace,
            user=request.user,
            game=game,
            defaults={'score': score, 'extra': extra},
        )
        improved = created or score > row.score
        if improved and not created:
            row.score = score
            row.extra = extra
            row.save(update_fields=['score', 'extra', 'updated_at'])

    payload = serialize_workspace_highscores(workspace, request.user)
    payload['improved'] = improved
    payload['mine'] = serialize_row(row)
    return JsonResponse(payload)
