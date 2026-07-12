from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.db.models import Q

from .models import Workspace
from .tags import (
    list_workspace_tag_names,
    normalize_tag_name,
    search_workspace_pages_by_tag,
)


class WorkspaceTagsConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        self.workspace_id = int(self.scope['url_route']['kwargs']['workspace_id'])
        self.user = self.scope['user']

        if not self.user.is_authenticated:
            await self.close()
            return

        if not await self._user_has_workspace_access():
            await self.close()
            return

        self.group_name = f'workspace_tags_{self.workspace_id}'
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, 'group_name'):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive_json(self, content, **kwargs):
        action = content.get('action')

        if action == 'list_tags':
            query = (content.get('q') or '').strip().lower()
            tags = await database_sync_to_async(list_workspace_tag_names)(self.workspace_id, query)
            await self.send_json({'type': 'tags', 'tags': tags})
            return

        if action == 'search_pages':
            tag = normalize_tag_name(content.get('tag', ''))
            query = (content.get('q') or '').strip()
            if not tag:
                await self.send_json({'type': 'error', 'message': 'tag required'})
                return
            pages = await database_sync_to_async(search_workspace_pages_by_tag)(
                self.workspace_id, tag, query,
            )
            await self.send_json({'type': 'pages', 'pages': pages})
            return

        await self.send_json({'type': 'error', 'message': 'unknown action'})

    async def tags_updated(self, event):
        await self.send_json({
            'type': 'tags_updated',
            'page_id': event.get('page_id'),
        })

    @database_sync_to_async
    def _user_has_workspace_access(self):
        return Workspace.objects.filter(
            Q(owner=self.user) | Q(workspacemembership__user=self.user),
            pk=self.workspace_id,
            deleted=False,
        ).exists()
