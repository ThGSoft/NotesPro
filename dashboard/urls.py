from django.urls import path

from . import views

urlpatterns = [
    path('', views.dashboard, name='home'),
    path('dashboard/', views.dashboard, name='dashboard'),
    path('dashboard/admin/', views.admin_dashboard, name='admin_dashboard'),
    path('dashboard/settings/', views.settings_view, name='settings'),
    path('dashboard/admin/settings/', views.admin_settings, name='admin_settings'),
    path('dashboard/admin/users/', views.admin_users, name='admin_users'),
    path('drive/', views.drive_home, name='drive_home'),
    path('drive/folders/new/', views.create_folder, name='create_folder'),
    path('drive/folders/<int:folder_id>/', views.folder_detail, name='folder_detail'),
    path('drive/folders/<int:folder_id>/upload/', views.upload_files, name='upload_files'),
    path('drive/files/<int:file_id>/delete/', views.delete_file, name='delete_file'),
]
