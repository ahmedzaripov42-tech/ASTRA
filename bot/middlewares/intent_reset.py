from __future__ import annotations

from aiogram import BaseMiddleware
from aiogram.types import Message

from ..i18n import menu_labels_all
from ..flow_registry import untrack
from ..prompt_guard import reset_prompt


class IntentResetMiddleware(BaseMiddleware):
    async def __call__(self, handler, event, data):
        if isinstance(event, Message) and event.text in menu_labels_all():
            state = data.get("state")
            if state:
                await state.clear()
            if event.from_user:
                untrack(event.chat.id, event.from_user.id)
                reset_prompt(event.from_user.id)
        return await handler(event, data)

