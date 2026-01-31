from __future__ import annotations

from aiogram import F, Router
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, Message, WebAppInfo

from ..config import WEBAPP_URL
from ..i18n import ensure_access, get_user_lang, menu_labels, t
from ..roles import can_manage_manhwa

router = Router()


@router.message(F.text.in_(menu_labels("webapp")))
async def open_webapp(message: Message) -> None:
    if not await ensure_access(message, can_manage_manhwa):
        return
    if not WEBAPP_URL:
        await message.answer("Mini App URL is not configured.")
        return
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text="Open Mini App", web_app=WebAppInfo(url=WEBAPP_URL))]]
    )
    await message.answer("Launch the Manhwa CMS Mini App:", reply_markup=keyboard)

