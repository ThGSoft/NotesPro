from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.signals import user_logged_in
from django.db.models.signals import post_save
from django.dispatch import receiver
from .models import UserSettings

@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def create_user_settings(sender, instance, created, **kwargs):
    if created:
        UserSettings.objects.get_or_create(user=instance)

@receiver(user_logged_in)
def ensure_user_settings_on_login(sender, request, user, **kwargs):
    UserSettings.objects.get_or_create(user=user)
