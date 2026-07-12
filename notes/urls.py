from django.urls import path
from django.views.generic.base import RedirectView
from django.conf import settings
from . import views
from . import views_messaging
from . import views_dm
from . import views_incoming
from . import views_quicknotes

urlpatterns = [
    path('', views.dashboard, name='dashboard'),
    path('favicon.ico', RedirectView.as_view(url=settings.STATIC_URL + 'images/favicon.ico')),

    path('register/', views.register_view, name='register'),
    path('api/workspaces/', views.workspace_list_create, name='api_workspaces'),
    path('api/workspaces/<int:workspace_id>/tree/', views.tree_data, name='api_tree'),
    path('api/workspaces/<int:workspace_id>/tags/', views.workspace_tags_list, name='api_workspace_tags'),
    path('api/workspaces/<int:workspace_id>/tags/search/', views.workspace_tags_search, name='api_workspace_tags_search'),
    path('api/workspaces/<int:workspace_id>/tags/rebuild/', views.workspace_tags_rebuild, name='api_workspace_tags_rebuild'),
    path('api/workspaces/<int:workspace_id>/quick-notes/', views_quicknotes.quick_note_list, name='api_quick_notes'),
    path('api/workspaces/<int:workspace_id>/quick-notes/create/', views_quicknotes.quick_note_create, name='api_quick_note_create'),
    path('api/quick-notes/<int:pk>/', views_quicknotes.quick_note_detail, name='api_quick_note_detail'),
    path('api/quick-notes/<int:pk>/update/', views_quicknotes.quick_note_update, name='api_quick_note_update'),
    path('api/quick-notes/<int:pk>/delete/', views_quicknotes.quick_note_delete, name='api_quick_note_delete'),
    path('api/workspaces/<int:workspace_id>/updateUserSettings/', views.updateUserSettings, name='updateUserSettings'),
    path('api/workspaces/create/', views.workspace_create, name='workspace_create'),
    path('api/workspaces/<int:workspace_id>/files/', views.file_manager, name='api_files'),
    path('api/workspaces/<int:pk>/update/', views.workspace_update, name='workspace_update'),
    path('api/workspaces/<int:pk>/delete/', views.workspace_delete, name='workspace_delete'),
    path('api/workspaces/<int:pk>/restore/', views.workspace_restore, name='workspace_restore'),
    path('api/workspaces/<int:pk>/export/', views.workspace_export, name='workspace_export'),
    path('api/workspaces/import/', views.workspace_import, name='workspace_import'),

    path('api/workspaces/<int:workspace_id>/members/', views.get_workspace_members, name='workspace_members'),
    
    path('api/users/search/', views.user_search_lookup, name='user_search_lookup'),
    path('api/workspaces/add-user/', views.add_workspace_member, name='add_workspace_member'),
    path('api/workspaces/remove-user/', views.remove_workspace_member, name='remove_workspace_member'),
    path('api/workspaces/change-role/', views.change_member_role, name='change_member_role'),
    path('api/workspaces/<int:workspace_id>/invite-email/', views_messaging.workspace_invite_email, name='workspace_invite_email'),
    path('invite/<str:token>/', views_messaging.accept_workspace_invite, name='accept_workspace_invite'),
    path('api/workspaces/<int:workspace_id>/mail/', views_messaging.workspace_mail_list, name='workspace_mail_list'),
    path('api/workspaces/<int:workspace_id>/mail/send/', views_messaging.workspace_mail_send, name='workspace_mail_send'),
    path('api/workspaces/<int:workspace_id>/mail/<int:message_id>/read/', views_messaging.workspace_mail_mark_read, name='workspace_mail_mark_read'),
    path('api/workspaces/<int:workspace_id>/chat/', views_messaging.workspace_chat_list, name='workspace_chat_list'),
    path('api/workspaces/<int:workspace_id>/chat/send/', views_messaging.workspace_chat_send, name='workspace_chat_send'),

    path('api/dm/keys/', views_dm.dm_own_key, name='dm_own_key'),
    path('api/dm/keys/set/', views_dm.dm_own_key_set, name='dm_own_key_set'),
    path('api/dm/keys/<int:user_id>/', views_dm.dm_peer_key, name='dm_peer_key'),
    path('api/dm/conversations/', views_dm.dm_conversation_list, name='dm_conversation_list'),
    path('api/dm/conversations/start/', views_dm.dm_conversation_start, name='dm_conversation_start'),
    path('api/dm/conversations/<int:conversation_id>/messages/', views_dm.dm_message_list, name='dm_message_list'),
    path('api/dm/conversations/<int:conversation_id>/send/', views_dm.dm_message_send, name='dm_message_send'),
    path('api/dm/signal/poll/', views_dm.dm_signal_poll, name='dm_signal_poll'),
    path('api/dm/signal/<int:user_id>/', views_dm.dm_signal_send, name='dm_signal_send'),

    path('api/uploads/', views.upload_file, name='api_upload'),
    path('api/local-files/open/', views.open_local_file, name='api_open_local_file'),
    path('api/pages/<int:pk>/', views.page_detail, name='api_page_detail'),
    path('api/pages/create/', views.page_create, name='api_page_create'),
    path('api/pages/<int:pk>/update/', views.page_update, name='api_page_update'),
    path('api/pages/<int:pk>/delete/', views.page_delete, name='api_page_delete'),
    path('api/pages/reorder/', views.page_reorder, name='api_page_reorder'),
    path('api/pages/<int:pk>/move/', views.page_move_workspace, name='api_page_move'),
    path('api/upload_pasted_image/', views.upload_pasted_image, name='upload_pasted_image'),

    path('api/incoming/', views_incoming.incoming_mail_list, name='incoming_mail_list'),
    path('api/incoming/fetch/', views_incoming.incoming_mail_fetch, name='incoming_mail_fetch'),
    path('api/incoming/<int:mail_id>/dismiss/', views_incoming.incoming_mail_dismiss, name='incoming_mail_dismiss'),
    path('api/incoming/<int:mail_id>/distribute/', views_incoming.incoming_mail_distribute, name='incoming_mail_distribute'),
    path('api/incoming/<int:mail_id>/eml/', views_incoming.incoming_mail_eml, name='incoming_mail_eml'),
    path('api/incoming/<int:mail_id>/pdf/', views_incoming.incoming_mail_pdf, name='incoming_mail_pdf'),
    path('api/incoming/<int:mail_id>/resolve-route/', views_incoming.incoming_mail_resolve_route, name='incoming_mail_resolve_route'),
    path('api/incoming/<int:mail_id>/suggest-workspace/', views_incoming.incoming_mail_suggest_workspace, name='incoming_mail_suggest_workspace'),
    path("debug/", views.debug)
]
