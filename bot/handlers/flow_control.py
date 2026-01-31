from __future__ import annotations

from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.fsm.storage.base import StorageKey
from aiogram.types import CallbackQuery, Message

from ..config import LOGS_PATH
from ..i18n import button_labels_all, ensure_access, get_user_lang, t
from ..flow_registry import all_active, untrack
from ..keyboards import main_menu_kb
from ..prompt_guard import reset_prompt
from ..roles import can_deploy, is_owner
from ..state import STORAGE
from server import processor

router = Router()


@router.message(F.text.in_(button_labels_all("cancel")))
async def cancel_message(message: Message, state: FSMContext) -> None:
    await _cancel_flow(message, state)


@router.callback_query(F.data == "flow:cancel")
async def cancel_callback(callback: CallbackQuery, state: FSMContext) -> None:
    await _cancel_flow(callback.message, state)
    await callback.answer()


@router.callback_query(F.data == "noop")
async def noop_callback(callback: CallbackQuery) -> None:
    await callback.answer()


async def _cancel_flow(message: Message, state: FSMContext) -> None:
    if state:
        await state.clear()
    if message.from_user:
        untrack(message.chat.id, message.from_user.id)
        reset_prompt(message.from_user.id)
    lang = get_user_lang(message.from_user.id)
    await message.answer(t("flow_canceled", lang), reply_markup=main_menu_kb(lang))


@router.message(F.text.in_(button_labels_all("reset")))
async def reset_states_message(message: Message) -> None:
    await _reset_states(message)


@router.callback_query(F.data == "flow:reset")
async def reset_states_callback(callback: CallbackQuery) -> None:
    await _reset_states(callback.message)
    await callback.answer()


async def _reset_states(message: Message) -> None:
    if not await ensure_access(message, is_owner):
        return
    for entry in all_active():
        key = StorageKey(bot_id=message.bot.id, chat_id=entry.chat_id, user_id=entry.user_id)
        await STORAGE.set_state(key, None)
        await STORAGE.set_data(key, {})
        untrack(entry.chat_id, entry.user_id)
        reset_prompt(entry.user_id)
    processor.log_action(message.from_user.id, "Reset all states", LOGS_PATH)
    lang = get_user_lang(message.from_user.id)
    await message.answer(t("states_reset", lang), reply_markup=main_menu_kb(lang))


@router.message(F.text.in_(button_labels_all("restart")))
async def restart_message(message: Message) -> None:
    await _restart_bot(message)


@router.callback_query(F.data == "flow:restart")
async def restart_callback(callback: CallbackQuery) -> None:
    await _restart_bot(callback.message)
    await callback.answer()


async def _restart_bot(message: Message) -> None:
    if not await ensure_access(message, can_deploy):
        return
    processor.log_action(message.from_user.id, "Restarted bot", LOGS_PATH)
    lang = get_user_lang(message.from_user.id)
    await message.answer(t("restart_now", lang))
    await message.bot.session.close()
    raise SystemExit(0)

