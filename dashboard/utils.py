GROUP_ADMIN = 'Group Admin'


def is_group_admin(user):
    return user.is_authenticated and user.groups.filter(name=GROUP_ADMIN).exists()


def user_can_access_folder(user, folder):
    return folder.user_can_view(user)
