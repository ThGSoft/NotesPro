from django.contrib import messages
from django.contrib.auth.decorators import login_required, user_passes_test
from django.contrib.auth.models import User
from django.db.models import Q
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render

from .forms import FolderForm, ProfileSettingsForm, UserSettingsForm
from .models import DriveFile, Folder
from .utils import is_group_admin


def visible_folders(user):
    if user.is_superuser or is_group_admin(user):
        return Folder.objects.select_related('owner').prefetch_related('groups')
    return Folder.objects.filter(
        Q(owner=user) | Q(groups__in=user.groups.all()) | Q(parent__groups__in=user.groups.all())
    ).distinct().select_related('owner').prefetch_related('groups')


@login_required
def dashboard(request):
    if is_group_admin(request.user):
        return redirect('admin_dashboard')
    return render(request, 'dashboard/user_dashboard.html')


@login_required
@user_passes_test(is_group_admin)
def admin_dashboard(request):
    context = {
        'total_users': User.objects.count(),
        'active_users': User.objects.filter(is_active=True).count(),
        'staff_users': User.objects.filter(is_staff=True).count(),
        'total_folders': Folder.objects.count(),
        'total_files': DriveFile.objects.count(),
    }
    return render(request, 'dashboard/admin_dashboard.html', context)


@login_required
def settings_view(request):
    profile, _ = request.user.profile.__class__.objects.get_or_create(user=request.user)

    if request.method == 'POST':
        user_form = UserSettingsForm(request.POST, instance=request.user)
        profile_form = ProfileSettingsForm(request.POST, instance=profile)
        if user_form.is_valid() and profile_form.is_valid():
            user_form.save()
            profile_form.save()
            messages.success(request, 'Settings saved.')
            return redirect('settings')
    else:
        user_form = UserSettingsForm(instance=request.user)
        profile_form = ProfileSettingsForm(instance=profile)

    return render(request, 'dashboard/settings.html', {
        'user_form': user_form,
        'profile_form': profile_form,
    })


@login_required
@user_passes_test(is_group_admin)
def admin_settings(request):
    return render(request, 'dashboard/admin_settings.html')


@login_required
@user_passes_test(is_group_admin)
def admin_users(request):
    users = User.objects.select_related('profile').order_by('username')
    return render(request, 'dashboard/admin_users.html', {'users': users})


@login_required
def drive_home(request):
    folders = visible_folders(request.user).filter(parent__isnull=True)
    return render(request, 'dashboard/drive_home.html', {'folders': folders})


@login_required
def folder_detail(request, folder_id):
    folder = get_object_or_404(Folder.objects.select_related('owner').prefetch_related('groups'), id=folder_id)
    if not folder.user_can_view(request.user):
        return render(request, 'dashboard/403.html', status=403)
    children = visible_folders(request.user).filter(parent=folder)
    files = folder.files.select_related('uploaded_by')
    can_edit = folder.user_can_edit(request.user)
    return render(request, 'dashboard/folder_detail.html', {
        'folder': folder,
        'children': children,
        'files': files,
        'can_edit': can_edit,
    })


@login_required
def create_folder(request):
    initial_parent = request.GET.get('parent')
    parent = None
    if initial_parent:
        parent = get_object_or_404(Folder, id=initial_parent)
        if not parent.user_can_edit(request.user):
            return render(request, 'dashboard/403.html', status=403)

    if request.method == 'POST':
        form = FolderForm(request.POST)
        if form.is_valid():
            folder = form.save(commit=False)
            folder.owner = request.user
            folder.save()
            form.save_m2m()
            messages.success(request, 'Folder created.')
            return redirect('folder_detail', folder_id=folder.id)
    else:
        form = FolderForm(initial={'parent': parent})

    return render(request, 'dashboard/folder_form.html', {'form': form, 'parent': parent})


@login_required
def upload_files(request, folder_id):
    folder = get_object_or_404(Folder, id=folder_id)
    if not folder.user_can_view(request.user):
        return JsonResponse({'ok': False, 'error': 'You cannot upload to this folder.'}, status=403)
    if request.method != 'POST':
        return JsonResponse({'ok': False, 'error': 'POST required.'}, status=405)

    created = []
    for uploaded in request.FILES.getlist('files'):
        drive_file = DriveFile.objects.create(
            folder=folder,
            uploaded_by=request.user,
            file=uploaded,
            original_name=uploaded.name,
            size=uploaded.size,
            content_type=getattr(uploaded, 'content_type', ''),
        )
        created.append({'id': drive_file.id, 'name': drive_file.original_name, 'url': drive_file.file.url, 'size': drive_file.size})
    return JsonResponse({'ok': True, 'files': created})


@login_required
def delete_file(request, file_id):
    drive_file = get_object_or_404(DriveFile.objects.select_related('folder'), id=file_id)
    if not drive_file.folder.user_can_edit(request.user):
        return render(request, 'dashboard/403.html', status=403)
    folder_id = drive_file.folder_id
    if request.method == 'POST':
        drive_file.file.delete(save=False)
        drive_file.delete()
        messages.success(request, 'File deleted.')
    return redirect('folder_detail', folder_id=folder_id)
