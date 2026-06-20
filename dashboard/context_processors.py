from .menu import build_sidebar_menu
from .utils import is_group_admin


def sidebar_menu(request):
    if not request.user.is_authenticated:
        return {'sidebar_menu': [], 'is_group_admin': False}

    return {
        'sidebar_menu': build_sidebar_menu(request.user),
        'is_group_admin': is_group_admin(request.user),
    }
