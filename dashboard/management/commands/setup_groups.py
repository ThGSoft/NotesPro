from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Create default dashboard groups.'

    def handle(self, *args, **options):
        for name in ['Group Admin', 'User']:
            Group.objects.get_or_create(name=name)
            self.stdout.write(self.style.SUCCESS(f'Group ready: {name}'))
