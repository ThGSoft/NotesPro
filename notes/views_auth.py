from django.conf import settings
from django.contrib import messages
from django.contrib.auth import login
from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.contrib.auth.views import LoginView
from django.shortcuts import redirect, render
from django.views.decorators.http import require_http_methods

from .models import UserSettings
from .totp import generate_secret, provisioning_uri, qr_code_base64, verify_token

SESSION_PENDING_2FA = 'pending_2fa_user_id'


class TwoFactorLoginView(LoginView):
    template_name = 'registration/login.html'

    def form_valid(self, form):
        user = form.get_user()
        user_settings = UserSettings.objects.filter(user=user).first()
        if user_settings and user_settings.totp_enabled and user_settings.totp_secret:
            self.request.session[SESSION_PENDING_2FA] = user.id
            return redirect('verify_2fa')
        return super().form_valid(form)


@require_http_methods(['GET', 'POST'])
def verify_2fa(request):
    user_id = request.session.get(SESSION_PENDING_2FA)
    if not user_id:
        return redirect('login')

    user = User.objects.filter(pk=user_id).first()
    if not user:
        request.session.pop(SESSION_PENDING_2FA, None)
        return redirect('login')

    user_settings = UserSettings.objects.filter(user=user).first()
    if not user_settings or not user_settings.totp_enabled or not user_settings.totp_secret:
        request.session.pop(SESSION_PENDING_2FA, None)
        login(request, user)
        return redirect(settings.LOGIN_REDIRECT_URL)

    if request.method == 'POST':
        token = request.POST.get('token', '')
        if verify_token(user_settings.totp_secret, token):
            request.session.pop(SESSION_PENDING_2FA, None)
            login(request, user)
            return redirect(settings.LOGIN_REDIRECT_URL)
        messages.error(request, 'Invalid verification code. Try again.')

    return render(request, 'registration/verify_2fa.html', {'user': user})


@login_required
@require_http_methods(['GET', 'POST'])
def setup_2fa(request):
    user_settings, _ = UserSettings.objects.get_or_create(user=request.user)
    session_secret_key = 'totp_setup_secret'

    if request.method == 'POST':
        action = request.POST.get('action')
        token = request.POST.get('token', '')

        if action == 'disable':
            if not user_settings.totp_enabled:
                messages.info(request, 'Two-factor authentication is not enabled.')
                return redirect('setup_2fa')
            if not verify_token(user_settings.totp_secret, token):
                messages.error(request, 'Invalid code. Two-factor authentication was not disabled.')
                return redirect('setup_2fa')
            user_settings.totp_secret = ''
            user_settings.totp_enabled = False
            user_settings.save(update_fields=['totp_secret', 'totp_enabled'])
            request.session.pop(session_secret_key, None)
            messages.success(request, 'Two-factor authentication disabled.')
            return redirect('setup_2fa')

        setup_secret = request.session.get(session_secret_key) or user_settings.totp_secret
        if not setup_secret:
            messages.error(request, 'Setup expired. Start again.')
            return redirect('setup_2fa')

        if not verify_token(setup_secret, token):
            messages.error(request, 'Invalid code. Scan the QR code and enter the current 6-digit code.')
            return redirect('setup_2fa')

        user_settings.totp_secret = setup_secret
        user_settings.totp_enabled = True
        user_settings.save(update_fields=['totp_secret', 'totp_enabled'])
        request.session.pop(session_secret_key, None)
        messages.success(request, 'Two-factor authentication enabled.')
        return redirect('setup_2fa')

    if user_settings.totp_enabled:
        return render(request, 'registration/setup_2fa.html', {
            'enabled': True,
            'user_settings': user_settings,
        })

    setup_secret = request.session.get(session_secret_key)
    if not setup_secret:
        setup_secret = generate_secret()
        request.session[session_secret_key] = setup_secret

    uri = provisioning_uri(setup_secret, request.user)
    qr_b64 = qr_code_base64(uri)
    return render(request, 'registration/setup_2fa.html', {
        'enabled': False,
        'secret': setup_secret,
        'provisioning_uri': uri,
        'qr_data_uri': f'data:image/png;base64,{qr_b64}' if qr_b64 else None,
        'user_settings': user_settings,
    })
