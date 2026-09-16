from django import forms
from django.contrib.auth.forms import UserCreationForm
from django.contrib.auth.models import User

from .activation import normalize_mobile, register_mail_enabled, register_mobile_enabled
from .models import UserSettings


class RegisterForm(UserCreationForm):
    email = forms.EmailField(
        required=True,
        widget=forms.EmailInput(attrs={'class': 'form-control', 'autocomplete': 'email'}),
    )
    mobile = forms.CharField(
        required=True,
        label='Mobile number',
        help_text='International format, e.g. +41 79 123 45 67. We send a 6-digit activation code by SMS.',
        widget=forms.TextInput(attrs={
            'class': 'form-control',
            'type': 'tel',
            'autocomplete': 'tel',
            'placeholder': '+41 79 123 45 67',
        }),
    )

    class Meta:
        model = User
        fields = ('username', 'email', 'password1', 'password2')

    field_order = ['username', 'email', 'mobile', 'password1', 'password2']

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for name in ('username', 'password1', 'password2'):
            self.fields[name].widget.attrs.setdefault('class', 'form-control')
        self.fields['username'].widget.attrs.setdefault('autocomplete', 'username')
        self.fields['password1'].widget.attrs.setdefault('autocomplete', 'new-password')
        self.fields['password2'].widget.attrs.setdefault('autocomplete', 'new-password')

        self.register_mail = register_mail_enabled()
        self.register_mobile = register_mobile_enabled()

        posted_email = ''
        if self.is_bound:
            posted_email = (self.data.get('email') or '').strip()
        initial_email = (self.initial.get('email') or posted_email or '').strip()

        if not self.register_mail:
            if initial_email:
                self.fields['email'].required = False
                self.fields['email'].widget = forms.HiddenInput()
            else:
                self.fields.pop('email')

        if not self.register_mobile:
            self.fields.pop('mobile', None)

    def clean_email(self):
        email = (self.cleaned_data.get('email') or '').strip()
        if not email:
            return ''
        taken = User.objects.filter(email__iexact=email).exists()
        if taken:
            raise forms.ValidationError('This email is already registered.')
        return email

    def clean_mobile(self):
        raw = self.cleaned_data.get('mobile')
        if not raw:
            return ''
        try:
            mobile = normalize_mobile(raw)
        except ValueError as exc:
            raise forms.ValidationError(str(exc)) from exc
        taken = UserSettings.objects.filter(mobile=mobile).exclude(mobile='').exists()
        if taken:
            raise forms.ValidationError('This mobile number is already registered.')
        return mobile

    def save(self, commit=True):
        user = super().save(commit=False)
        email = (self.cleaned_data.get('email') or '').strip()
        mobile = (self.cleaned_data.get('mobile') or '').strip()
        user.email = email
        needs_code = bool(
            (self.register_mobile and mobile)
            or (self.register_mail and email)
        )
        user.is_active = not needs_code
        if commit:
            user.save()
            settings_obj, _ = UserSettings.objects.get_or_create(user=user)
            settings_obj.mobile = mobile
            settings_obj.mobile_verified = False
            settings_obj.save(update_fields=['mobile', 'mobile_verified'])
        return user
