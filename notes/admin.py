from django import forms
from django.contrib import admin, messages
from django.contrib.admin.widgets import FilteredSelectMultiple
from django.contrib.auth import get_user_model
from django.contrib.auth.admin import GroupAdmin as BaseGroupAdmin
from django.contrib.auth.models import Group
from django.http import HttpResponse
from django.shortcuts import redirect
from django.template.response import TemplateResponse
from django.urls import path, reverse

from django.utils.html import format_html

from .models import (
    IncomingMail,
    IpVisitLog,
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


admin.site.unregister(Group)


class GroupAdminForm(forms.ModelForm):
    workspaces = forms.ModelMultipleChoiceField(
        queryset=Workspace.objects.none(),
        required=False,
        label='Workspaces',
        widget=FilteredSelectMultiple('workspaces', is_stacked=False),
    )

    class Meta:
        model = Group
        fields = ('name', 'permissions')

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        qs = Workspace.objects.filter(deleted=False).select_related('owner').order_by(
            'owner__username', 'name',
        )
        self.fields['workspaces'].queryset = qs
        self.fields['workspaces'].label_from_instance = lambda ws: f'{ws.owner.username}: {ws.name}'
        if self.instance.pk:
            self.fields['workspaces'].initial = self.instance.workspaces.all()

    def save(self, commit=True):
        group = super().save(commit=commit)
        if commit:
            group.workspaces.set(self.cleaned_data.get('workspaces', []))
        return group


@admin.register(Group)
class GroupAdmin(BaseGroupAdmin):
    form = GroupAdminForm
    filter_horizontal = ('permissions',)


@admin.register(Workspace)
class WorkspaceAdmin(admin.ModelAdmin):
    list_display = ('name', 'slug', 'owner', 'deleted', 'created_at')
    list_filter = ('deleted', 'owner', 'groups')
    search_fields = ('name', 'slug', 'owner__username')
    filter_horizontal = ('groups',)
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


@admin.register(IncomingMail)
class IncomingMailAdmin(admin.ModelAdmin):
    list_display = (
        'id', 'recipient', 'sender_email', 'parsed_workspace', 'parsed_page',
        'status', 'received_at',
    )
    list_filter = ('status',)
    search_fields = ('recipient__username', 'sender_email', 'parsed_workspace', 'parsed_page')
    readonly_fields = ('received_at', 'distributed_at', 'external_id')


@admin.register(UserSettings)
class UserSettingsAdmin(admin.ModelAdmin):
    list_display = (
        'user', 'last_workspace_id', 'theme',
        'sidebar_width', 'left_panel_expanded', 'right_panel_width', 'right_panel_expanded',
        'totp_enabled',
    )
    search_fields = ('user__username',)


@admin.register(IpVisitLog)
class IpVisitLogAdmin(admin.ModelAdmin):
    list_display = (
        'created_at', 'ip_address', 'geo_display', 'map_link', 'user', 'event_type',
        'method', 'path',
    )
    list_filter = ('event_type', 'country', 'country_code', 'method')
    search_fields = ('ip_address', 'user__username', 'path', 'city', 'region', 'country', 'isp', 'org')
    date_hierarchy = 'created_at'
    readonly_fields = (
        'created_at', 'ip_address', 'user', 'method', 'path', 'query_string', 'user_agent',
        'event_type', 'country', 'country_code', 'region', 'city', 'latitude', 'longitude',
        'isp', 'org', 'map_link',
    )
    ordering = ('-created_at',)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    @admin.display(description='Location')
    def geo_display(self, obj):
        label = obj.geo_label
        if obj.country_code:
            return f'{label} ({obj.country_code})'
        return label

    @admin.display(description='Map')
    def map_link(self, obj):
        if obj.latitude is None or obj.longitude is None:
            return '—'
        url = f'https://www.openstreetmap.org/?mlat={obj.latitude}&mlon={obj.longitude}#map=10/{obj.latitude}/{obj.longitude}'
        return format_html('<a href="{}" target="_blank" rel="noopener noreferrer">Open map</a>', url)
