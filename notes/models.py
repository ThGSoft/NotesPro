from django.conf import settings
from django.db import models
from django.utils.text import slugify
from django.utils.crypto import get_random_string
from django.db.models.signals import post_save
from django.contrib.auth.models import User
from django.dispatch import receiver


def _invite_token():
    return get_random_string(48)


def copy_members(apps, schema_editor):
    Workspace = apps.get_model('notes', 'Workspace')
    WorkspaceMembership = apps.get_model('notes', 'WorkspaceMembership')

    for workspace in Workspace.objects.all():
        for user in workspace.members_old.all():
            WorkspaceMembership.objects.get_or_create(
                workspace=workspace,
                user=user,
                defaults={'role': 'read'}
            )

class Workspace(models.Model):
    # owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='workspaces')
        # Das Feld MUSS 'owner' heissen (kleingeschrieben)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, 
        on_delete=models.CASCADE, 
        related_name='workspaces'
    )
    name = models.CharField(max_length=255)
    # workspace_id = models.CharField(max_length=100)
    name = models.CharField(max_length=120)
    slug = models.SlugField(max_length=140)
    created_at = models.DateTimeField(auto_now_add=True)
    deleted = models.BooleanField(default=False, db_index=True)

    members = models.ManyToManyField(
        User,
        through='WorkspaceMembership',
        related_name='shared_workspacesNee',
    )

    
    class Meta:
        ordering = ['name']
        constraints = [
            models.UniqueConstraint(
                fields=['owner', 'slug'],
                condition=models.Q(deleted=False),
                name='notes_workspace_owner_slug_active',
            ),
        ]

    def __str__(self):
        return self.name
    
class WorkspaceMembership(models.Model):
    ROLE_CHOICES = [
        ('read', 'Nur Lesen'),
        ('write', 'Lesen & Schreiben'),
    ]
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE)
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    role = models.CharField(max_length=10, choices=ROLE_CHOICES, default='read')

    class Meta:
        unique_together = ('workspace', 'user') # Verhindert doppelte Einträge


class WorkspaceInvite(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='invites')
    email = models.EmailField()
    role = models.CharField(max_length=10, choices=WorkspaceMembership.ROLE_CHOICES, default='read')
    token = models.CharField(max_length=64, unique=True, default=_invite_token)
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='sent_workspace_invites',
    )
    accepted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.email} → {self.workspace.name}'


class WorkspaceMailMessage(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='mail_messages')
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='sent_workspace_mails',
    )
    subject = models.CharField(max_length=255)
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.subject


class WorkspaceMailRecipient(models.Model):
    message = models.ForeignKey(
        WorkspaceMailMessage,
        on_delete=models.CASCADE,
        related_name='recipients',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='workspace_mail_inbox',
    )
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = ('message', 'user')

    def __str__(self):
        return f'{self.user.username} ← {self.message.subject}'


class WorkspaceChatMessage(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='chat_messages')
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='workspace_chat_messages',
    )
    body = models.TextField(max_length=4000)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f'{self.sender.username}: {self.body[:40]}'


class Page(models.Model):
    EDITOR_CHOICES = [('rich', 'Rich'), ('markdown', 'Markdown'), ('blocks', 'Blocks')]
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='pages')
    parent = models.ForeignKey('self', null=True, blank=True, related_name='children', on_delete=models.CASCADE)
    title = models.CharField(max_length=255)
    slug = models.SlugField(max_length=255, blank=True)
    is_folder = models.BooleanField(default=False)
    sort_order = models.IntegerField(default=0)
    editor_mode = models.CharField(max_length=20, choices=EDITOR_CHOICES, default='rich')
    rich_content = models.TextField(blank=True, default='')
    markdown_content = models.TextField(blank=True, default='')
    blocks_content = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted = models.BooleanField(default=False, db_index=True)

    class Meta:
        ordering = ['sort_order', 'id']
        constraints = [
            models.UniqueConstraint(
                fields=['workspace', 'slug'],
                condition=models.Q(deleted=False),
                name='notes_page_workspace_slug_active',
            ),
        ]

    def __str__(self):
        return self.title

    def save(self, *args, **kwargs):
        if not self.slug:
            base = slugify(self.title) or 'page'
            slug = base
            i = 1
            qs = Page.objects.filter(workspace=self.workspace, deleted=False).exclude(pk=self.pk)
            while qs.filter(slug=slug).exists():
                slug = f'{base}-{i}'
                i += 1
            self.slug = slug
        super().save(*args, **kwargs)

class UploadedFile(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='uploads')
    md5_hash = models.CharField(max_length=32, unique=True, db_index=True)
    file = models.FileField(upload_to='uploads/%Y/%m/')
    original_name = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

class PastedFile(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='pasted_images')
    md5_hash = models.CharField(max_length=32, unique=True, db_index=True)
    file = models.FileField(upload_to='pasted_images/%Y/%m/')
    original_name = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

# class UserTreeState(models.Model):
#     user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
#     workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, null=True)
    
#     # workspace = models.ForeignKey('Workspace', on_delete=models.SET_NULL, null=True, blank=True)
#     opened_nodes = models.JSONField(default=list)  # Liste von IDs: ["1", "5"]
#     selected_nodes = models.JSONField(default=list) # Liste von IDs: ["10"]
#     last_updated = models.DateTimeField(auto_now=True)




# class TreeNode(models.Model):
#     # Nur der Ersteller sieht diesen Knoten (optional)
#     name = models.CharField(max_length=255)
#     workspace = models.ForeignKey('Workspace', on_delete=models.CASCADE, null=True)
#     parent = models.ForeignKey('self', on_delete=models.CASCADE, null=True, blank=True, related_name='children')


class UserSettings(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='settings')
    
    # Editor-Einstellungen
    theme = models.CharField(max_length=20, default='light', choices=[('light', 'Light'), ('dark', 'Dark')])
    show_toolbar = models.BooleanField(default=True)
    font_size = models.IntegerField(default=14)
    
    # App-Status (Workspace-Gedächtnis)
    last_workspace_id = models.IntegerField(null=True, blank=True)
    last_page_id = models.IntegerField(null=True, blank=True)
    
    # Flexible Daten als JSON (z.B. für jsTree-Zustände)
    extra_configs = models.JSONField(default=dict, blank=True)

    def __str__(self):
        return f"Settings for {self.user.username}"

@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def create_user_settings(sender, instance, created, **kwargs):
    if created:
        UserSettings.objects.create(user=instance)  