from __future__ import annotations

from aiogram import F, Router
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, Message, WebAppInfo

from ..config import WEBAPP_URL
from ..i18n import get_user_lang, menu_labels, t
from ..roles import can_manage_manhwa, is_blocked

router = Router()


@router.message(F.text.in_(menu_labels("webapp")))
async def open_webapp(message: Message) -> None:
    if is_blocked(message.from_user.id):
        lang = get_user_lang(message.from_user.id)
        await message.answer(t("access_denied", lang))
        return
    if not can_manage_manhwa(message.from_user.id):
        lang = get_user_lang(message.from_user.id)
        await message.answer(t("access_denied", lang))
        return
    if not WEBAPP_URL:
        await message.answer("Mini App URL is not configured.")
        return
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text="Open Mini App", web_app=WebAppInfo(url=WEBAPP_URL))]]
    )
    await message.answer("Launch the Manhwa CMS Mini App:", reply_markup=keyboard)

