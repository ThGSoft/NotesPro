from django.contrib import admin, messages
from django.contrib.auth import get_user_model
from django.http import HttpResponse
from django.shortcuts import redirect
from django.template.response import TemplateResponse
from django.urls import path, reverse

from .models import (
    Page,
    PageTag,
    Tag,
    UploadedFile,
    UserSettings,
    Workspace,
    DirectConversation,
    DirectMessage,
    UserDirectMessageKey,
    WorkspaceChatMessage,
    WorkspaceInvite,
    WorkspaceMailMessage,
    WorkspaceMailRecipient,
)
from .workspace_io import (
    export_workspace_zip,
    import_workspace,
    parse_import_upload,
)


@admin.register(Workspace)
class WorkspaceAdmin(admin.ModelAdmin):
    list_display = ('name', 'slug', 'owner', 'deleted', 'created_at')
    list_filter = ('deleted', 'owner')
    search_fields = ('name', 'slug', 'owner__username')
    actions = ['export_workspace_action']
    change_list_template = 'admin/notes/workspace/change_list.html'

    def get_urls(self):
        urls = super().get_urls()
        custom = [
            path(
                'import/',
                self.admin_site.admin_view(self.import_workspace_view),
                name='notes_workspace_import',
            ),
        ]
        return custom + urls

    @admin.action(description='Export selected workspace')
    def export_workspace_action(self, request, queryset):
        if queryset.count() != 1:
            self.message_user(
                request,
                'Select exactly one workspace to export.',
                level=messages.ERROR,
            )
            return
        ws = queryset.first()
        content = export_workspace_zip(ws)
        response = HttpResponse(content, content_type='application/zip')
        response['Content-Disposition'] = f'attachment; filename="{ws.slug}.zip"'
        return response

    def import_workspace_view(self, request):
        User = get_user_model()
        if request.method == 'POST':
            upload = request.FILES.get('file')
            owner_id = request.POST.get('owner')
            name = (request.POST.get('name') or '').strip()
            if not upload:
                self.message_user(request, 'Choose a JSON or ZIP file to import.', level=messages.ERROR)
            else:
                try:
                    owner = User.objects.get(pk=owner_id)
                    data, archive = parse_import_upload(upload)
                    ws = import_workspace(data, owner, name=name or None, archive=archive)
                    self.message_user(
                        request,
                        f'Imported workspace "{ws.name}" (id={ws.id}).',
                        level=messages.SUCCESS,
                    )
                    return redirect(reverse('admin:notes_workspace_change', args=[ws.pk]))
                except Exception as exc:
                    self.message_user(request, f'Import failed: {exc}', level=messages.ERROR)

        context = {
            **self.admin_site.each_context(request),
            'title': 'Import workspace',
            'opts': self.model._meta,
            'owners': User.objects.order_by('username'),
            'default_owner': request.user.pk,
        }
        return TemplateResponse(request, 'admin/notes/workspace/import_form.html', context)


admin.site.register(Page)
admin.site.register(Tag)
admin.site.register(PageTag)
admin.site.register(UploadedFile)
admin.site.register(WorkspaceInvite)
admin.site.register(WorkspaceMailMessage)
admin.site.register(WorkspaceMailRecipient)
admin.site.register(WorkspaceChatMessage)
admin.site.register(UserDirectMessageKey)
admin.site.register(DirectConversation)
admin.site.register(DirectMessage)


@admin.register(UserSettings)
class UserSettingsAdmin(admin.ModelAdmin):
    list_display = (
        'user', 'last_workspace_id', 'theme',
        'sidebar_width', 'left_panel_expanded', 'right_panel_width', 'right_panel_expanded',
        'totp_enabled',
    )
    search_fields = ('user__username',)
