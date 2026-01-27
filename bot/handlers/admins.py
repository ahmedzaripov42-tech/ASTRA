from __future__ import annotations

from aiogram import F, Router
from aiogram.types import Message

from ..i18n import get_user_lang, menu_labels, t
from ..roles import add_role, is_blocked, is_owner, remove_role

router = Router()


@router.message(F.text.in_(menu_labels("admins")))
async def admin_menu(message: Message) -> None:
    if is_blocked(message.from_user.id):
        lang = get_user_lang(message.from_user.id)
        await message.answer(t("access_denied", lang))
        return
    if not is_owner(message.from_user.id):
        await message.answer("Only owner can manage roles.")
        return
    text = (
        "Role commands:\n"
        "add <role> <user_id>\n"
        "remove <role> <user_id>\n"
        "Roles: owner, admins, editors, uploaders, moderators, blocked"
    )
    await message.answer(text)


@router.message(F.text.startswith("add "))
async def add_role_handler(message: Message) -> None:
    if not is_owner(message.from_user.id):
        return
    parts = message.text.split()
    if len(parts) != 3:
        await message.answer("Format: add <role> <user_id>")
        return
    role, user_id = parts[1], parts[2]
    try:
        user_id_int = int(user_id)
    except ValueError:
        await message.answer("Invalid user id.")
        return
    add_role(user_id_int, role)
    await message.answer(f"Added {user_id_int} to {role}")


@router.message(F.text.startswith("remove "))
async def remove_role_handler(message: Message) -> None:
    if not is_owner(message.from_user.id):
        return
    parts = message.text.split()
    if len(parts) != 3:
        await message.answer("Format: remove <role> <user_id>")
        return
    role, user_id = parts[1], parts[2]
    try:
        user_id_int = int(user_id)
    except ValueError:
        await message.answer("Invalid user id.")
        return
    remove_role(user_id_int, role)
    await message.answer(f"Removed {user_id_int} from {role}")

