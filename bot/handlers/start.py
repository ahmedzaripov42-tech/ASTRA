from __future__ import annotations

from aiogram import F, Router
from aiogram.filters import CommandStart
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from ..i18n import get_user_lang, has_user_lang, set_user_lang, t
from ..keyboards import main_menu_kb

router = Router()


@router.message(CommandStart())
async def start_handler(message: Message) -> None:
    if has_user_lang(message.from_user.id):
        lang = get_user_lang(message.from_user.id)
        await message.answer(t("welcome", lang), reply_markup=main_menu_kb(lang))
        return
    await message.answer(t("choose_language", "uz"), reply_markup=_lang_kb())


@router.callback_query(F.data.startswith("lang:"))
async def set_language(callback: CallbackQuery) -> None:
    lang = callback.data.split("lang:")[-1]
    set_user_lang(callback.from_user.id, lang)
    await callback.message.answer(t("language_set", lang), reply_markup=main_menu_kb(lang))
    await callback.answer()


def _lang_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="O'zbekcha", callback_data="lang:uz")],
            [InlineKeyboardButton(text="Русский", callback_data="lang:ru")],
        ]
    )

