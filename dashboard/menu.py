from django.urls import reverse

from .utils import is_group_admin


def build_sidebar_menu(user):
    menu = [
        {'label': 'Dashboard', 'url': reverse('dashboard'), 'icon': '🏠'},
        {'label': 'My Drive', 'url': reverse('drive_home'), 'icon': '📁'},
        {'label': 'My Settings', 'url': reverse('settings'), 'icon': '⚙️'},
    ]

    if is_group_admin(user):
        menu.extend([
            {'label': 'Admin Dashboard', 'url': reverse('admin_dashboard'), 'icon': '🛡️'},
            {'label': 'Users', 'url': reverse('admin_users'), 'icon': '👥'},
            {'label': 'Admin Settings', 'url': reverse('admin_settings'), 'icon': '🔧'},
        ])

    return menu
