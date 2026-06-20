from django.contrib.auth.models import User
from django.db import models


class Profile(models.Model):
    THEME_CHOICES = [
        ('light', 'Light'),
        ('dark', 'Dark'),
    ]

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    bio = models.TextField(blank=True)
    theme = models.CharField(max_length=20, choices=THEME_CHOICES, default='light')
    notifications_enabled = models.BooleanField(default=True)

    def __str__(self):
        return f'{self.user.username} profile'


class Folder(models.Model):
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name='owned_folders')
    groups = models.ManyToManyField('auth.Group', blank=True, related_name='shared_folders')
    parent = models.ForeignKey('self', on_delete=models.CASCADE, null=True, blank=True, related_name='children')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name

    def user_can_view(self, user):
        if not user.is_authenticated:
            return False
        if user.is_superuser or self.owner_id == user.id:
            return True
        if user.groups.filter(id__in=self.groups.values_list('id', flat=True)).exists():
            return True
        if self.parent:
            return self.parent.user_can_view(user)
        return False

    def user_can_edit(self, user):
        if not user.is_authenticated:
            return False
        return user.is_superuser or self.owner_id == user.id or user.groups.filter(name='Group Admin').exists()


def folder_upload_path(instance, filename):
    return f'folder_uploads/folder_{instance.folder_id}/{filename}'


class DriveFile(models.Model):
    folder = models.ForeignKey(Folder, on_delete=models.CASCADE, related_name='files')
    uploaded_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='uploaded_drive_files')
    file = models.FileField(upload_to=folder_upload_path)
    original_name = models.CharField(max_length=255)
    size = models.PositiveBigIntegerField(default=0)
    content_type = models.CharField(max_length=120, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.original_name

    @property
    def extension(self):
        return self.original_name.split('.')[-1].upper() if '.' in self.original_name else 'FILE'
