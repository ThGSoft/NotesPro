from django.contrib import admin
from .models import (
    Page,
    Workspace,
    UploadedFile,
    UserSettings,
    WorkspaceInvite,
    WorkspaceMailMessage,
    WorkspaceMailRecipient,
    WorkspaceChatMessage,
)

admin.site.register(Workspace)
admin.site.register(Page)
admin.site.register(UploadedFile)
admin.site.register(WorkspaceInvite)
admin.site.register(WorkspaceMailMessage)
admin.site.register(WorkspaceMailRecipient)
admin.site.register(WorkspaceChatMessage)


@admin.register(UserSettings)
class UserSettingsAdmin(admin.ModelAdmin):
    list_display = ('user', 'last_workspace_id', 'theme')
    search_fields = ('user__username',)