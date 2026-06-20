from django import forms
from django.contrib.auth.models import User

from .models import Profile


class UserSettingsForm(forms.ModelForm):
    class Meta:
        model = User
        fields = ['first_name', 'last_name', 'email']


class ProfileSettingsForm(forms.ModelForm):
    class Meta:
        model = Profile
        fields = ['bio', 'theme', 'notifications_enabled']

from .models import Folder

class FolderForm(forms.ModelForm):
    class Meta:
        model = Folder
        fields = ['name', 'description', 'groups', 'parent']
        widgets = {
            'groups': forms.CheckboxSelectMultiple,
        }
