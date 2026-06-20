from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.contrib.auth import views as auth_views
from django.urls import include, path

from notes.views_auth import TwoFactorLoginView, setup_2fa, verify_2fa

urlpatterns = [
    path('admin/', admin.site.urls),
    path('', include('notes.urls')),
    path('login/', TwoFactorLoginView.as_view(), name='login'),
    path('login/2fa/', verify_2fa, name='verify_2fa'),
    path('account/2fa/', setup_2fa, name='setup_2fa'),
    path('logout/', auth_views.LogoutView.as_view(), name='logout'),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
