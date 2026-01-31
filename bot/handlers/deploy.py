from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from ..config import GITHUB_REPO, GITHUB_TOKEN, NETLIFY_HOOK
from ..i18n import button_label, ensure_access, get_user_lang, menu_labels, t
from ..keyboards import main_menu_kb
from ..roles import can_deploy
from server import github

router = Router()


@router.message(F.text.in_(menu_labels("deploy")))
async def deploy_menu(message: Message) -> None:
    if not await ensure_access(message, can_deploy):
        return
    await message.answer("Choose deploy action:", reply_markup=_deploy_kb(get_user_lang(message.from_user.id)))


@router.callback_query(F.data == "deploy:git")
async def git_push_handler(callback: CallbackQuery) -> None:
    if not await ensure_access(callback, can_deploy):
        return
    result = github.git_push("Bot update", repo=GITHUB_REPO, token=GITHUB_TOKEN)
    if "failed" in result.lower():
        logging.error("Git push failed: %s", result)
    await callback.message.answer(result)
    await callback.answer()


@router.callback_query(F.data == "deploy:netlify")
async def netlify_handler(callback: CallbackQuery) -> None:
    if not await ensure_access(callback, can_deploy):
        return
    result = github.netlify_deploy(NETLIFY_HOOK)
    if "failed" in result.lower() or "not configured" in result.lower():
        logging.error("Netlify deploy failed: %s", result)
    await callback.message.answer(result)
    await callback.answer()


@router.callback_query(F.data == "deploy:all")
async def deploy_all(callback: CallbackQuery) -> None:
    if not await ensure_access(callback, can_deploy):
        return
    git_result = github.git_push("Bot update", repo=GITHUB_REPO, token=GITHUB_TOKEN)
    netlify_result = github.netlify_deploy(NETLIFY_HOOK)
    if "failed" in git_result.lower():
        logging.error("Git push failed: %s", git_result)
    if "failed" in netlify_result.lower() or "not configured" in netlify_result.lower():
        logging.error("Netlify deploy failed: %s", netlify_result)
    await callback.message.answer(f"{git_result}\n{netlify_result}")
    await callback.answer()


def _deploy_kb(lang: str) -> InlineKeyboardMarkup:
    rows = [
        [InlineKeyboardButton(text="⬆ Git Push", callback_data="deploy:git")],
        [InlineKeyboardButton(text="🚀 Netlify Deploy", callback_data="deploy:netlify")],
        [InlineKeyboardButton(text="✅ Git + Netlify", callback_data="deploy:all")],
        [
            InlineKeyboardButton(text=button_label("back", lang), callback_data="deploy:back"),
            InlineKeyboardButton(text=button_label("cancel", lang), callback_data="flow:cancel"),
        ],
    ]
    return InlineKeyboardMarkup(inline_keyboard=rows)


@router.callback_query(F.data == "deploy:back")
async def deploy_back(callback: CallbackQuery) -> None:
    await callback.message.answer("Back to main menu.", reply_markup=main_menu_kb(get_user_lang(callback.from_user.id)))
    await callback.answer()

