from django import forms
from django.contrib import admin, messages
from django.contrib.admin.widgets import FilteredSelectMultiple
from django.contrib.auth import get_user_model
from django.contrib.auth.admin import GroupAdmin as BaseGroupAdmin
from django.contrib.auth.models import Group
from django.core.exceptions import PermissionDenied
from django.http import HttpResponse
from django.shortcuts import redirect
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.utils.html import format_html

from .models import (
    GameHighScore,
    IncomingMail,
    IpVisitLog,
    Page,
    PageTag,
    PastedFile,
    StorageSettings,
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
from .media_quota import (
    apply_purge,
    build_storage_report,
    delete_stored_file,
    format_bytes,
    plan_unreferenced_media,
    stored_file_bytes,
)
from .workspace_io import (
    export_workspace_zip,
    import_workspace,
    parse_import_upload,
)
from .views import _restore_page, _restore_workspace, _soft_delete_page, _soft_delete_workspace


admin.site.unregister(Group)


class SuperuserOnlyMixin:
    def has_module_permission(self, request):
        return bool(request.user.is_superuser)

    def has_view_permission(self, request, obj=None):
        return bool(request.user.is_superuser)

    def has_add_permission(self, request):
        return bool(request.user.is_superuser)

    def has_change_permission(self, request, obj=None):
        return bool(request.user.is_superuser)

    def has_delete_permission(self, request, obj=None):
        return bool(request.user.is_superuser)


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
        # Admin calls save(commit=False) then form.save_m2m(); extra M2M must
        # be applied in that hook or workspaces never persist.
        group = super().save(commit=False)

        def save_workspaces():
            group.workspaces.set(self.cleaned_data.get('workspaces') or [])

        if commit:
            group.save()
            self._save_m2m()
            save_workspaces()
        else:
            old_save_m2m = self.save_m2m

            def save_m2m():
                old_save_m2m()
                save_workspaces()

            self.save_m2m = save_m2m
        return group


@admin.register(Group)
class GroupAdmin(BaseGroupAdmin):
    form = GroupAdminForm
    filter_horizontal = ('permissions',)


@admin.register(Workspace)
class WorkspaceAdmin(admin.ModelAdmin):
    list_display = ('name', 'slug', 'owner', 'storage_quota_mb', 'deleted', 'created_at')
    list_filter = ('deleted', 'owner', 'groups')
    search_fields = ('name', 'slug', 'owner__username')
    filter_horizontal = ('groups',)
    actions = ['export_workspace_action', 'restore_workspaces_action']
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

    @admin.action(description='Restore selected workspaces')
    def restore_workspaces_action(self, request, queryset):
        count = 0
        for ws in queryset.filter(deleted=True):
            _restore_workspace(ws)
            count += 1
        if count:
            self.message_user(request, f'Restored {count} workspace(s).', level=messages.SUCCESS)
        else:
            self.message_user(request, 'No deleted workspaces were selected.', level=messages.WARNING)

    def delete_model(self, request, obj):
        _soft_delete_workspace(obj)

    def delete_queryset(self, request, queryset):
        for obj in queryset.filter(deleted=False):
            _soft_delete_workspace(obj)

    def save_model(self, request, obj, form, change):
        restoring = change and 'deleted' in form.changed_data and not obj.deleted
        deleting = change and 'deleted' in form.changed_data and obj.deleted
        super().save_model(request, obj, form, change)
        if restoring:
            _restore_workspace(obj)
        elif deleting:
            _soft_delete_workspace(obj)

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


class MediaFileAdmin(admin.ModelAdmin):
    list_display = ('id', 'original_name', 'workspace', 'user', 'file_size', 'created_at', 'file')
    list_filter = ('workspace', 'created_at')
    search_fields = ('original_name', 'file', 'md5_hash', 'user__username', 'workspace__name')
    readonly_fields = ('md5_hash', 'created_at', 'file_size')
    date_hierarchy = 'created_at'

    @admin.display(description='Size')
    def file_size(self, obj):
        return format_bytes(stored_file_bytes(obj.file))

    def delete_model(self, request, obj):
        delete_stored_file(obj.file)
        super().delete_model(request, obj)

    def delete_queryset(self, request, queryset):
        for obj in queryset:
            delete_stored_file(obj.file)
            obj.delete()


@admin.register(UploadedFile)
class UploadedFileAdmin(MediaFileAdmin):
    pass


@admin.register(PastedFile)
class PastedFileAdmin(MediaFileAdmin):
    pass


@admin.register(StorageSettings)
class StorageSettingsAdmin(SuperuserOnlyMixin, admin.ModelAdmin):
    fieldsets = (
        ('Quotas', {
            'description': (
                '0 means unlimited. Per-workspace overrides live on each Workspace; '
                'per-user overrides live on User settings '
                '(empty inherit, 0 unlimited, or an explicit megabyte cap).'
            ),
            'fields': ('max_upload_mb', 'workspace_quota_mb', 'user_quota_mb', 'global_quota_mb'),
        }),
    )
    change_form_template = 'admin/notes/storagesettings/change_form.html'

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def changelist_view(self, request, extra_context=None):
        if not request.user.is_superuser:
            raise PermissionDenied
        obj = StorageSettings.load()
        return redirect(reverse('admin:notes_storagesettings_change', args=[obj.pk]))

    def changeform_view(self, request, object_id=None, form_url='', extra_context=None):
        if not request.user.is_superuser:
            raise PermissionDenied
        extra_context = extra_context or {}
        if request.method == 'POST' and (
            '_purge' in request.POST or '_purge_orphans' in request.POST
        ):
            disk_orphans = '_purge_orphans' in request.POST
            plan = plan_unreferenced_media(disk_orphans=disk_orphans)
            n_records = len(plan['records'])
            n_orphans = len(plan['disk_orphans'])
            if n_records == 0 and n_orphans == 0:
                self.message_user(request, 'No unreferenced media files found.', level=messages.INFO)
            else:
                result = apply_purge(plan)
                extra = (
                    f' and {result["deleted_orphans"]} disk orphan(s)'
                    if disk_orphans else ''
                )
                self.message_user(
                    request,
                    f'Purged {result["deleted_rows"]} file record(s){extra} '
                    f'({format_bytes(result["deleted_bytes"])}).',
                    level=messages.SUCCESS,
                )
            obj = StorageSettings.load()
            return redirect(reverse('admin:notes_storagesettings_change', args=[obj.pk]))
        extra_context['storage_report'] = build_storage_report()
        return super().changeform_view(request, object_id, form_url, extra_context)


admin.site.register(Tag)
admin.site.register(PageTag)
admin.site.register(WorkspaceInvite)
admin.site.register(WorkspaceMailMessage)
admin.site.register(WorkspaceMailRecipient)
admin.site.register(WorkspaceChatMessage)
admin.site.register(UserDirectMessageKey)
admin.site.register(DirectConversation)
admin.site.register(DirectMessage)


@admin.register(Page)
class PageAdmin(admin.ModelAdmin):
    list_display = ('title', 'workspace', 'parent', 'is_folder', 'deleted', 'updated_at')
    list_filter = ('deleted', 'is_folder', 'workspace')
    search_fields = ('title', 'slug', 'workspace__name', 'workspace__owner__username')
    actions = ['restore_pages_action']
    change_list_template = 'admin/notes/page/change_list.html'

    @admin.action(description='Restore selected pages')
    def restore_pages_action(self, request, queryset):
        count = 0
        for page in queryset.filter(deleted=True):
            _restore_page(page)
            count += 1
        if count:
            self.message_user(request, f'Restored {count} page(s).', level=messages.SUCCESS)
        else:
            self.message_user(
                request,
                'No deleted pages were selected. Filter by deleted and try again.',
                level=messages.WARNING,
            )

    def delete_model(self, request, obj):
        _soft_delete_page(obj)

    def delete_queryset(self, request, queryset):
        for obj in queryset.filter(deleted=False):
            _soft_delete_page(obj)

    def save_model(self, request, obj, form, change):
        restoring = change and 'deleted' in form.changed_data and not obj.deleted
        deleting = change and 'deleted' in form.changed_data and obj.deleted
        super().save_model(request, obj, form, change)
        if restoring:
            _restore_page(obj)
        elif deleting:
            _soft_delete_page(obj)


@admin.register(IncomingMail)
class IncomingMailAdmin(admin.ModelAdmin):
    list_display = (
        'id', 'recipient', 'sender_email', 'parsed_workspace', 'parsed_page',
        'status', 'received_at',
    )
    list_filter = ('status',)
    search_fields = ('recipient__username', 'sender_email', 'parsed_workspace', 'parsed_page')
    readonly_fields = ('received_at', 'distributed_at', 'external_id')


@admin.register(GameHighScore)
class GameHighScoreAdmin(admin.ModelAdmin):
    list_display = ('game', 'score', 'user', 'workspace', 'updated_at')
    list_filter = ('game', 'workspace')
    search_fields = ('user__username', 'game', 'workspace__name')
    readonly_fields = ('created_at', 'updated_at')


@admin.register(UserSettings)
class UserSettingsAdmin(admin.ModelAdmin):
    list_display = (
        'user', 'storage_quota_mb', 'stay_informed', 'last_workspace_id', 'theme',
        'sidebar_width', 'left_panel_expanded', 'right_panel_width', 'right_panel_expanded',
        'totp_enabled', 'mobile', 'mobile_verified',
    )
    list_filter = ('stay_informed', 'totp_enabled', 'mobile_verified')
    search_fields = ('user__username', 'mobile')
    fieldsets = (
        (None, {'fields': ('user', 'theme', 'show_toolbar', 'font_size')}),
        ('Notifications', {
            'description': 'Stay informed is also offered on registration and in the in-app Settings.',
            'fields': ('stay_informed',),
        }),
        ('Storage', {
            'description': 'Empty inherits the site default from Storage control. 0 = unlimited.',
            'fields': ('storage_quota_mb',),
        }),
        ('Layout', {
            'fields': (
                'last_workspace_id', 'last_page_id', 'workspace_pages',
                'sidebar_width', 'left_panel_expanded',
                'right_panel_width', 'right_panel_expanded',
            ),
        }),
        ('Shop payments', {
            'description': 'PayPal, Visa, Mastercard, and Konto live in extra_configs.shop (also editable in the in-app Settings).',
            'fields': ('extra_configs',),
        }),
        ('Security', {'fields': ('totp_enabled', 'totp_secret', 'mobile', 'mobile_verified', 'activation_sent_at')}),
    )


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
