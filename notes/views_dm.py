import json

from django.contrib.auth import get_user_model
from django.contrib.auth.decorators import login_required
from django.db.models import Q
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.http import require_GET, require_POST

from .models import DirectConversation, DirectMessage, DmPeerSignal, UserDirectMessageKey

User = get_user_model()


def _dm_message_dict(msg):
    return {
        'id': msg.id,
        'sender_id': msg.sender_id,
        'sender': msg.sender.username,
        'iv': msg.iv,
        'ciphertext': msg.ciphertext,
        'created_at': msg.created_at.isoformat(),
    }


def _conversation_dict(conv, user):
    peer = conv.peer_for(user)
    last = conv.messages.order_by('-id').first()
    peer_key = UserDirectMessageKey.objects.filter(user=peer).first()
    return {
        'id': conv.id,
        'peer': {
            'id': peer.id,
            'username': peer.username,
            'has_public_key': bool(peer_key),
        },
        'last_message': _dm_message_dict(last) if last else None,
        'updated_at': conv.updated_at.isoformat(),
    }


@login_required
@require_GET
def dm_own_key(request):
    key = UserDirectMessageKey.objects.filter(user=request.user).first()
    public_key_jwk = None
    if key:
        try:
            public_key_jwk = json.loads(key.public_key_jwk)
        except json.JSONDecodeError:
            public_key_jwk = None
    return JsonResponse({'status': 'success', 'public_key_jwk': public_key_jwk})


@login_required
@require_POST
def dm_own_key_set(request):
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)
    pub = payload.get('public_key_jwk')
    if not pub:
        return JsonResponse({'status': 'error', 'message': 'public_key_jwk required.'}, status=400)
    UserDirectMessageKey.objects.update_or_create(
        user=request.user,
        defaults={'public_key_jwk': json.dumps(pub)},
    )
    return JsonResponse({'status': 'success'})


@login_required
@require_GET
def dm_peer_key(request, user_id):
    peer = get_object_or_404(User, pk=user_id)
    if peer.id == request.user.id:
        return JsonResponse({'status': 'error', 'message': 'Cannot fetch own key here.'}, status=400)
    key = UserDirectMessageKey.objects.filter(user=peer).first()
    public_key_jwk = None
    if key:
        try:
            public_key_jwk = json.loads(key.public_key_jwk)
        except json.JSONDecodeError:
            public_key_jwk = None
    return JsonResponse({
        'status': 'success',
        'user_id': peer.id,
        'username': peer.username,
        'public_key_jwk': public_key_jwk,
    })


@login_required
@require_GET
def dm_conversation_list(request):
    convs = DirectConversation.objects.filter(
        Q(participant_a=request.user) | Q(participant_b=request.user)
    ).select_related('participant_a', 'participant_b').order_by('-updated_at')[:50]
    return JsonResponse({
        'status': 'success',
        'conversations': [_conversation_dict(c, request.user) for c in convs],
    })


@login_required
@require_POST
def dm_conversation_start(request):
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)
    peer = get_object_or_404(User, pk=payload.get('user_id'))
    if peer.id == request.user.id:
        return JsonResponse({'status': 'error', 'message': 'Cannot message yourself.'}, status=400)
    a, b = DirectConversation.ordered_pair(request.user, peer)
    conv, created = DirectConversation.objects.get_or_create(participant_a=a, participant_b=b)
    return JsonResponse({
        'status': 'success',
        'conversation': _conversation_dict(conv, request.user),
        'created': created,
    })


@login_required
@require_GET
def dm_message_list(request, conversation_id):
    conv = get_object_or_404(DirectConversation, pk=conversation_id)
    if not conv.involves(request.user):
        return JsonResponse({'status': 'error', 'message': 'Access denied.'}, status=403)
    after_id = request.GET.get('after')
    qs = conv.messages.select_related('sender')
    if after_id:
        try:
            qs = qs.filter(id__gt=int(after_id)).order_by('id')
            return JsonResponse({
                'status': 'success',
                'messages': [_dm_message_dict(m) for m in qs],
            })
        except (TypeError, ValueError):
            pass
    messages = list(reversed(list(qs.order_by('-created_at')[:80])))
    return JsonResponse({
        'status': 'success',
        'messages': [_dm_message_dict(m) for m in messages],
    })


@login_required
@require_POST
def dm_message_send(request, conversation_id):
    conv = get_object_or_404(DirectConversation, pk=conversation_id)
    if not conv.involves(request.user):
        return JsonResponse({'status': 'error', 'message': 'Access denied.'}, status=403)
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)
    iv = (payload.get('iv') or '').strip()
    ciphertext = (payload.get('ciphertext') or '').strip()
    if not iv or not ciphertext:
        return JsonResponse({'status': 'error', 'message': 'Encrypted payload required.'}, status=400)
    msg = DirectMessage.objects.create(
        conversation=conv,
        sender=request.user,
        iv=iv,
        ciphertext=ciphertext,
    )
    DirectConversation.objects.filter(pk=conv.pk).update(updated_at=timezone.now())
    return JsonResponse({'status': 'success', 'message': _dm_message_dict(msg)})


@login_required
@require_POST
def dm_signal_send(request, user_id):
    peer = get_object_or_404(User, pk=user_id)
    if peer.id == request.user.id:
        return JsonResponse({'status': 'error', 'message': 'Invalid peer.'}, status=400)
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)
    kind = (payload.get('kind') or '').strip()
    if kind not in ('offer', 'answer', 'ice'):
        return JsonResponse({'status': 'error', 'message': 'Invalid signal kind.'}, status=400)
    signal_payload = payload.get('payload')
    if signal_payload is None:
        return JsonResponse({'status': 'error', 'message': 'payload required.'}, status=400)
    DmPeerSignal.objects.create(
        sender=request.user,
        recipient=peer,
        kind=kind,
        payload=json.dumps(signal_payload),
    )
    return JsonResponse({'status': 'success'})


@login_required
@require_GET
def dm_signal_poll(request):
    after_id = 0
    raw = request.GET.get('after', '0')
    try:
        after_id = max(0, int(raw))
    except (TypeError, ValueError):
        after_id = 0
    signals = list(
        DmPeerSignal.objects.filter(recipient=request.user, id__gt=after_id)
        .select_related('sender')
        .order_by('id')[:100]
    )
    consumed_ids = [s.id for s in signals]
    response = JsonResponse({
        'status': 'success',
        'signals': [
            {
                'id': s.id,
                'sender_id': s.sender_id,
                'kind': s.kind,
                'payload': json.loads(s.payload),
            }
            for s in signals
        ],
    })
    if consumed_ids:
        DmPeerSignal.objects.filter(id__in=consumed_ids).delete()
    return response
