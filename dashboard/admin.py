from django.contrib import admin

from .models import DriveFile, Folder, Profile


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ('user', 'theme', 'notifications_enabled')


class DriveFileInline(admin.TabularInline):
    model = DriveFile
    extra = 0
    readonly_fields = ('original_name', 'size', 'content_type', 'uploaded_by', 'created_at')


@admin.register(Folder)
class FolderAdmin(admin.ModelAdmin):
    list_display = ('name', 'owner', 'parent', 'updated_at')
    list_filter = ('groups',)
    search_fields = ('name', 'description')
    filter_horizontal = ('groups',)
    inlines = [DriveFileInline]


@admin.register(DriveFile)
class DriveFileAdmin(admin.ModelAdmin):
    list_display = ('original_name', 'folder', 'uploaded_by', 'size', 'created_at')
    search_fields = ('original_name',)
    list_filter = ('content_type', 'created_at')
