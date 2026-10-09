import json

from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.views.decorators.http import require_POST

from .python_sandbox import MAX_CODE_BYTES, run_python


@login_required
@require_POST
def python_run(request):
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'stderr': 'Invalid JSON.', 'stdout': '', 'timed_out': False}, status=400)
    code = payload.get('code')
    if code is None:
        return JsonResponse({'ok': False, 'stderr': 'code is required.', 'stdout': '', 'timed_out': False}, status=400)
    if not isinstance(code, str):
        return JsonResponse({'ok': False, 'stderr': 'code must be text.', 'stdout': '', 'timed_out': False}, status=400)
    if len(code.encode('utf-8', 'replace')) > MAX_CODE_BYTES:
        return JsonResponse({
            'ok': False,
            'stderr': f'code exceeds {MAX_CODE_BYTES} bytes.',
            'stdout': '',
            'timed_out': False,
        }, status=400)
    result = run_python(code)
    return JsonResponse(result)
