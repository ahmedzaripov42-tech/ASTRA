from __future__ import annotations

import json

from aiogram import F, Router
from aiogram.types import Message

from ..config import LOGS_PATH, MANHWA_PATH
from ..i18n import ensure_access, get_user_lang, menu_labels, t
from ..roles import can_moderate
from server import insights

router = Router()


@router.message(F.text.in_(menu_labels("logs")))
async def logs_menu(message: Message) -> None:
    if not await ensure_access(message, can_moderate):
        return
    if not LOGS_PATH.exists():
        await message.answer("No logs yet.")
        return
    with LOGS_PATH.open("r", encoding="utf-8") as file:
        logs = json.load(file)
    last_logs = logs[-10:]
    text = "\n".join([f"{item['time']} | {item['user']} | {item['action']}" for item in last_logs])
    insight_text = insights.generate_insights(logs, MANHWA_PATH)
    await message.answer(f"{insight_text}\n\nRecent logs:\n{text or 'No logs yet.'}")

