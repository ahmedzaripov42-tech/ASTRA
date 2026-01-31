from __future__ import annotations

from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from ..config import SETTINGS_PATH
from ..i18n import button_label, button_labels_all, ensure_access, get_user_lang, menu_labels, t
from ..flow_registry import track, untrack
from ..keyboards import inline_cancel_back_kb, main_menu_kb, quality_kb
from ..roles import can_manage_manhwa
from server import processor

router = Router()


class SettingsState(StatesGroup):
    dmca_text = State()
    dmca_opacity = State()


@router.message(F.text.in_(menu_labels("quality")))
async def quality_menu(message: Message) -> None:
    if not await ensure_access(message, can_manage_manhwa):
        return
    settings = processor.load_settings(SETTINGS_PATH)
    lang = get_user_lang(message.from_user.id)
    await message.answer(
        f"Current quality: {settings['quality_mode']}",
        reply_markup=quality_kb(lang),
    )


@router.message(F.text.in_(processor.QUALITY_LABELS))
async def set_quality(message: Message) -> None:
    if not await ensure_access(message, can_manage_manhwa):
        return
    settings = processor.load_settings(SETTINGS_PATH)
    settings["quality_mode"] = processor.QUALITY_LABELS[message.text]
    processor.save_settings(SETTINGS_PATH, settings)
    await message.answer(
        f"Quality updated: {settings['quality_mode']}",
        reply_markup=main_menu_kb(get_user_lang(message.from_user.id)),
    )


@router.message(F.text.in_(menu_labels("rules")))
async def file_rules(message: Message) -> None:
    rules = (
        "Accepted files:\n"
        "- PDF\n"
        "- ZIP (images)\n"
        "- JPG/PNG (single)\n"
        "Files are auto-detected and converted to JPG pages."
    )
    await message.answer(rules, reply_markup=main_menu_kb(get_user_lang(message.from_user.id)))


@router.message(F.text.in_(menu_labels("settings")))
async def platform_settings(message: Message, state: FSMContext) -> None:
    if not await ensure_access(message, can_manage_manhwa):
        return
    await state.clear()
    track(message.chat.id, message.from_user.id)
    settings = processor.load_settings(SETTINGS_PATH)
    text = (
        f"Auto deploy: {settings['auto_deploy']}\n"
        f"DMCA watermark text: {settings['dmca_watermark_text'] or 'disabled'}\n"
        f"DMCA watermark opacity: {settings['dmca_watermark_opacity']}\n\n"
        "Choose an action:"
    )
    await message.answer(text, reply_markup=_settings_kb(get_user_lang(message.from_user.id)))


@router.callback_query(F.data == "settings:auto")
async def toggle_auto_deploy(callback: CallbackQuery) -> None:
    if not await ensure_access(callback, can_manage_manhwa):
        return
    settings = processor.load_settings(SETTINGS_PATH)
    settings["auto_deploy"] = not settings["auto_deploy"]
    processor.save_settings(SETTINGS_PATH, settings)
    await callback.message.answer(
        f"Auto deploy set to {settings['auto_deploy']}",
        reply_markup=_settings_kb(get_user_lang(callback.from_user.id)),
    )
    await callback.answer()


@router.callback_query(F.data == "settings:dmca_text")
async def dmca_text_start(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_manage_manhwa):
        return
    await state.set_state(SettingsState.dmca_text)
    lang = get_user_lang(callback.from_user.id)
    await callback.message.answer(
        "Send new DMCA watermark text (empty to disable):",
        reply_markup=inline_cancel_back_kb("settings:back", lang=lang),
    )
    await callback.answer()


@router.message(SettingsState.dmca_text, F.text)
async def dmca_text_save(message: Message, state: FSMContext) -> None:
    if not await ensure_access(message, can_manage_manhwa):
        return
    settings = processor.load_settings(SETTINGS_PATH)
    settings["dmca_watermark_text"] = message.text.strip()
    processor.save_settings(SETTINGS_PATH, settings)
    await state.clear()
    untrack(message.chat.id, message.from_user.id)
    await message.answer("DMCA watermark text updated.", reply_markup=_settings_kb(get_user_lang(message.from_user.id)))


@router.message(SettingsState.dmca_text, ~F.text)
async def dmca_text_invalid(message: Message, state: FSMContext) -> None:
    await state.clear()
    untrack(message.chat.id, message.from_user.id)
    await message.answer("Invalid input. Returning to main menu.", reply_markup=main_menu_kb(get_user_lang(message.from_user.id)))


@router.callback_query(F.data == "settings:dmca_opacity")
async def dmca_opacity_start(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_manage_manhwa):
        return
    await state.set_state(SettingsState.dmca_opacity)
    lang = get_user_lang(callback.from_user.id)
    await callback.message.answer(
        "Send opacity (0 to 1):",
        reply_markup=inline_cancel_back_kb("settings:back", lang=lang),
    )
    await callback.answer()


@router.message(SettingsState.dmca_opacity, F.text)
async def dmca_opacity_save(message: Message, state: FSMContext) -> None:
    if not await ensure_access(message, can_manage_manhwa):
        return
    try:
        value = float(message.text.strip())
    except ValueError:
        await state.clear()
        untrack(message.chat.id, message.from_user.id)
        await message.answer("Invalid number. Returning to main menu.", reply_markup=main_menu_kb(get_user_lang(message.from_user.id)))
        return
    value = max(0.0, min(1.0, value))
    settings = processor.load_settings(SETTINGS_PATH)
    settings["dmca_watermark_opacity"] = value
    processor.save_settings(SETTINGS_PATH, settings)
    await state.clear()
    untrack(message.chat.id, message.from_user.id)
    await message.answer(
        f"DMCA opacity updated to {value}",
        reply_markup=_settings_kb(get_user_lang(message.from_user.id)),
    )


@router.message(SettingsState.dmca_opacity, ~F.text)
async def dmca_opacity_invalid(message: Message, state: FSMContext) -> None:
    await state.clear()
    untrack(message.chat.id, message.from_user.id)
    await message.answer("Invalid input. Returning to main menu.", reply_markup=main_menu_kb(get_user_lang(message.from_user.id)))


@router.callback_query(F.data == "settings:menu")
async def settings_menu_back(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    untrack(callback.message.chat.id, callback.from_user.id)
    await callback.message.answer("Back to main menu.", reply_markup=main_menu_kb(get_user_lang(callback.from_user.id)))
    await callback.answer()


@router.callback_query(F.data == "settings:back")
async def settings_back(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await callback.message.answer("Back to settings.", reply_markup=_settings_kb(get_user_lang(callback.from_user.id)))
    await callback.answer()


@router.message(F.text.in_(button_labels_all("back")))
async def back_to_menu(message: Message, state: FSMContext) -> None:
    await state.clear()
    untrack(message.chat.id, message.from_user.id)
    await message.answer("Back to main menu.", reply_markup=main_menu_kb(get_user_lang(message.from_user.id)))


def _settings_kb(lang: str) -> InlineKeyboardMarkup:
    rows = [
        [InlineKeyboardButton(text="Toggle Auto Deploy", callback_data="settings:auto")],
        [InlineKeyboardButton(text="Update DMCA Text", callback_data="settings:dmca_text")],
        [InlineKeyboardButton(text="Update DMCA Opacity", callback_data="settings:dmca_opacity")],
        [InlineKeyboardButton(text=button_label("restart", lang), callback_data="flow:restart")],
        [InlineKeyboardButton(text=button_label("reset", lang), callback_data="flow:reset")],
        [InlineKeyboardButton(text="⬅ Back to Menu", callback_data="settings:menu")],
    ]
    return InlineKeyboardMarkup(inline_keyboard=rows)

