from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.filters import StateFilter
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from ..config import LOGS_PATH, MANHWA_PATH, PUBLIC_DIR, SETTINGS_PATH, UPLOADS_DIR
from ..flow_registry import track, untrack
from ..i18n import button_label, ensure_access, get_user_lang, menu_labels, menu_labels_all, t
from ..keyboards import inline_cancel_back_kb, inline_confirm_kb, main_menu_kb
from ..prompt_guard import mark_prompt, reset_prompt
from ..roles import can_manage_manhwa
from server import processor

router = Router()

GENRES = [
    "Action",
    "Romance",
    "Fantasy",
    "Drama",
    "Dark",
    "Psychological",
    "Comedy",
    "Mystery",
]


class AddManhwa(StatesGroup):
    title = State()
    genres = State()
    status = State()
    cover = State()


class ManageManhwa(StatesGroup):
    menu = State()
    delete_select = State()
    delete_confirm = State()
    clear_confirm = State()


@router.message(F.text.in_(menu_labels("manhwa")))
async def manhwa_menu(message: Message, state: FSMContext) -> None:
    if not await ensure_access(message, can_manage_manhwa):
        return
    await state.clear()
    await state.set_state(ManageManhwa.menu)
    await message.answer("Choose an action:", reply_markup=_manage_kb(get_user_lang(message.from_user.id)))


@router.message(Command("add_manhwa"))
async def add_manhwa_start(message: Message, state: FSMContext) -> None:
    if not await ensure_access(message, can_manage_manhwa):
        return
    await _start_add_flow(message, state)


@router.callback_query(ManageManhwa.menu, F.data == "manhwa:manage:add")
async def manage_add(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_manage_manhwa):
        return
    await _start_add_flow(callback.message, state)
    await callback.answer()


@router.callback_query(ManageManhwa.menu, F.data == "manhwa:manage:delete")
async def manage_delete_start(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_manage_manhwa):
        return
    manhwas = processor.load_manhwa(MANHWA_PATH)
    lang = get_user_lang(callback.from_user.id)
    if not manhwas:
        await callback.message.answer(t("no_manhwa", lang))
        await callback.answer()
        return
    await state.update_data(delete_id_map=_build_id_map(manhwas))
    await state.set_state(ManageManhwa.delete_select)
    await callback.message.answer(
        "Select manhwa to delete:",
        reply_markup=_manage_manhwa_kb(manhwas, lang, use_index=True, page=0),
    )
    await callback.answer()


@router.callback_query(ManageManhwa.menu, F.data == "manhwa:manage:clear")
async def manage_clear_start(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_manage_manhwa):
        return
    manhwas = processor.load_manhwa(MANHWA_PATH)
    lang = get_user_lang(callback.from_user.id)
    if not manhwas:
        await callback.message.answer(t("no_manhwa", lang))
        await callback.answer()
        return
    await state.set_state(ManageManhwa.clear_confirm)
    await callback.message.answer(
        "Clear all manhwa data? This cannot be undone.",
        reply_markup=inline_confirm_kb("manhwa:manage:clear:confirm", back_data="manhwa:manage:menu", lang=lang),
    )
    await callback.answer()


@router.callback_query(ManageManhwa.delete_select, F.data.startswith("manhwa:manage:delete:"))
async def manage_delete_confirm(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_manage_manhwa):
        return
    raw_id = callback.data.split("manhwa:manage:delete:")[-1]
    data = await state.get_data()
    manhwa_id = _resolve_manhwa_id(raw_id, data.get("delete_id_map"))
    if not manhwa_id:
        await state.clear()
        await callback.message.answer(
            "Invalid manhwa selection.",
            reply_markup=_manage_kb(get_user_lang(callback.from_user.id)),
        )
        await callback.answer()
        return
    manhwa = processor.get_manhwa_by_id(MANHWA_PATH, manhwa_id)
    if not manhwa:
        lang = get_user_lang(callback.from_user.id)
        await callback.message.answer(t("no_manhwa", lang), reply_markup=_manage_kb(lang))
        await state.clear()
        await callback.answer()
        return
    await state.update_data(delete_id=manhwa_id)
    await state.set_state(ManageManhwa.delete_confirm)
    lang = get_user_lang(callback.from_user.id)
    await callback.message.answer(
        f"Delete {manhwa['title']} ({manhwa_id})?",
        reply_markup=inline_confirm_kb("manhwa:manage:delete:confirm", back_data="manhwa:manage:delete:back", lang=lang),
    )
    await callback.answer()


@router.callback_query(ManageManhwa.delete_select, F.data.startswith("manhwa:manage:page:"))
async def manage_delete_page(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_manage_manhwa):
        return
    raw_page = callback.data.split("manhwa:manage:page:")[-1]
    try:
        page = int(raw_page)
    except ValueError:
        await callback.answer()
        return
    manhwas = processor.load_manhwa(MANHWA_PATH)
    lang = get_user_lang(callback.from_user.id)
    if not manhwas:
        await state.clear()
        await callback.message.answer(t("no_manhwa", lang), reply_markup=_manage_kb(lang))
        await callback.answer()
        return
    await state.update_data(delete_id_map=_build_id_map(manhwas))
    await callback.message.edit_reply_markup(
        reply_markup=_manage_manhwa_kb(manhwas, lang, use_index=True, page=page)
    )
    await callback.answer()


@router.callback_query(ManageManhwa.delete_confirm, F.data == "manhwa:manage:delete:confirm")
async def manage_delete_apply(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_manage_manhwa):
        return
    data = await state.get_data()
    manhwa_id = data.get("delete_id")
    if not manhwa_id:
        await state.clear()
        await callback.message.answer("No manhwa selected.", reply_markup=_manage_kb(get_user_lang(callback.from_user.id)))
        await callback.answer()
        return
    try:
        deleted = processor.delete_manhwa(MANHWA_PATH, PUBLIC_DIR, manhwa_id)
        processor.log_action(
            user_id=callback.from_user.id,
            action=f"Deleted manhwa {deleted['title']} ({deleted['id']})",
            logs_path=LOGS_PATH,
        )
        await state.clear()
        await callback.message.answer(
            f"Manhwa deleted: {deleted['title']} ({deleted['id']})",
            reply_markup=main_menu_kb(get_user_lang(callback.from_user.id)),
        )
    except Exception:  # noqa: BLE001
        logging.exception("Failed to delete manhwa %s", manhwa_id)
        await state.clear()
        lang = get_user_lang(callback.from_user.id)
        await callback.message.answer(
            "Failed to delete manhwa.",
            reply_markup=_manage_kb(lang),
        )
    await callback.answer()


@router.callback_query(ManageManhwa.clear_confirm, F.data == "manhwa:manage:clear:confirm")
async def manage_clear_apply(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_manage_manhwa):
        return
    try:
        count = processor.clear_all_manhwa(MANHWA_PATH, PUBLIC_DIR)
        processor.log_action(
            user_id=callback.from_user.id,
            action=f"Cleared all manhwa ({count})",
            logs_path=LOGS_PATH,
        )
        await state.clear()
        await callback.message.answer(
            f"All manhwa cleared ({count}).",
            reply_markup=main_menu_kb(get_user_lang(callback.from_user.id)),
        )
    except Exception:  # noqa: BLE001
        logging.exception("Failed to clear all manhwa")
        await state.clear()
        await callback.message.answer(
            "Failed to clear manhwa data.",
            reply_markup=_manage_kb(get_user_lang(callback.from_user.id)),
        )
    await callback.answer()


@router.callback_query(StateFilter(ManageManhwa.menu, ManageManhwa.delete_select, ManageManhwa.delete_confirm, ManageManhwa.clear_confirm), F.data == "manhwa:manage:menu")
async def manage_back_menu(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_manage_manhwa):
        return
    await state.clear()
    reset_prompt(callback.from_user.id)
    await state.set_state(ManageManhwa.menu)
    await callback.message.answer("Choose an action:", reply_markup=_manage_kb(get_user_lang(callback.from_user.id)))
    await callback.answer()


@router.callback_query(ManageManhwa.delete_confirm, F.data == "manhwa:manage:delete:back")
async def manage_delete_back(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_manage_manhwa):
        return
    await state.clear()
    reset_prompt(callback.from_user.id)
    manhwas = processor.load_manhwa(MANHWA_PATH)
    lang = get_user_lang(callback.from_user.id)
    if not manhwas:
        await state.clear()
        await callback.message.answer(t("no_manhwa", lang), reply_markup=_manage_kb(lang))
        await callback.answer()
        return
    await state.update_data(delete_id_map=_build_id_map(manhwas))
    await state.set_state(ManageManhwa.delete_select)
    await callback.message.answer(
        "Select manhwa to delete:",
        reply_markup=_manage_manhwa_kb(manhwas, lang, use_index=True, page=0),
    )
    await callback.answer()


async def _start_add_flow(message: Message, state: FSMContext) -> None:
    if not await ensure_access(message, can_manage_manhwa):
        return
    await state.clear()
    track(message.chat.id, message.from_user.id)
    await state.set_state(AddManhwa.title)
    prompt = "Send manhwa title:"
    count = mark_prompt(message.from_user.id, prompt)
    lang = get_user_lang(message.from_user.id)
    await message.answer(prompt, reply_markup=inline_cancel_back_kb(lang=lang))
    if count >= 2:
        await message.answer("Tip: Use Cancel to exit the flow.")


@router.message(AddManhwa.title, F.text)
async def add_manhwa_title(message: Message, state: FSMContext) -> None:
    await state.update_data(title=message.text.strip(), genres=[])
    await state.set_state(AddManhwa.genres)
    lang = get_user_lang(message.from_user.id)
    await message.answer("Select genres (tap to toggle, then Done):", reply_markup=_genres_kb(lang))


@router.message(AddManhwa.title, F.text & ~F.text.in_(menu_labels_all()))
async def add_manhwa_title_invalid(message: Message, state: FSMContext) -> None:
    await state.clear()
    untrack(message.chat.id, message.from_user.id)
    reset_prompt(message.from_user.id)
    lang = get_user_lang(message.from_user.id)
    await message.answer("Please send the manhwa title as text.", reply_markup=main_menu_kb(lang))


@router.callback_query(AddManhwa.genres, F.data.in_([f"manhwa:genre:{genre}" for genre in GENRES]))
async def add_manhwa_genre_toggle(callback: CallbackQuery, state: FSMContext) -> None:
    genre = callback.data.split("manhwa:genre:")[-1]
    data = await state.get_data()
    if not data.get("title"):
        await state.clear()
        untrack(callback.message.chat.id, callback.from_user.id)
        reset_prompt(callback.from_user.id)
        lang = get_user_lang(callback.from_user.id)
        await callback.message.answer("Session expired. Please start again.", reply_markup=main_menu_kb(lang))
        await callback.answer()
        return
    selected = set(data.get("genres", []))
    if genre in selected:
        selected.remove(genre)
    else:
        selected.add(genre)
    await state.update_data(genres=list(selected))
    lang = get_user_lang(callback.from_user.id)
    selected_ordered = [item for item in GENRES if item in selected]
    await callback.message.edit_reply_markup(reply_markup=_genres_kb(lang, selected_ordered))
    await callback.answer(f"Selected: {', '.join(selected_ordered) or 'none'}")


@router.callback_query(AddManhwa.genres, F.data == "manhwa:genre:done")
async def add_manhwa_genre_done(callback: CallbackQuery, state: FSMContext) -> None:
    data = await state.get_data()
    if not data.get("title"):
        await state.clear()
        untrack(callback.message.chat.id, callback.from_user.id)
        reset_prompt(callback.from_user.id)
        lang = get_user_lang(callback.from_user.id)
        await callback.message.answer("Session expired. Please start again.", reply_markup=main_menu_kb(lang))
        await callback.answer()
        return
    logging.info("Genres selected user=%s genres=%s", callback.from_user.id, data.get("genres"))
    await state.set_state(AddManhwa.status)
    lang = get_user_lang(callback.from_user.id)
    await callback.message.answer("Select status:", reply_markup=_status_kb(lang))
    await callback.answer()


@router.message(AddManhwa.genres, F.text & ~F.text.in_(menu_labels_all()))
async def add_manhwa_genres_invalid(message: Message, state: FSMContext) -> None:
    await state.clear()
    untrack(message.chat.id, message.from_user.id)
    reset_prompt(message.from_user.id)
    lang = get_user_lang(message.from_user.id)
    await message.answer("Please choose genres using the buttons.", reply_markup=main_menu_kb(lang))


@router.callback_query(AddManhwa.status, F.data.startswith("manhwa:status:"))
async def add_manhwa_status(callback: CallbackQuery, state: FSMContext) -> None:
    raw_status = callback.data.split("manhwa:status:")[-1]
    await state.update_data(status=processor.normalize_status(raw_status))
    await state.set_state(AddManhwa.cover)
    lang = get_user_lang(callback.from_user.id)
    await callback.message.answer(
        "Send cover photo or tap Skip:",
        reply_markup=_cover_kb(lang),
    )
    await callback.answer()


@router.message(AddManhwa.status, F.text & ~F.text.in_(menu_labels_all()))
async def add_manhwa_status_invalid(message: Message, state: FSMContext) -> None:
    await state.clear()
    untrack(message.chat.id, message.from_user.id)
    reset_prompt(message.from_user.id)
    lang = get_user_lang(message.from_user.id)
    await message.answer("Please select a status using the buttons.", reply_markup=main_menu_kb(lang))


@router.callback_query(AddManhwa.genres, F.data == "manhwa:back:title")
async def add_manhwa_back_title(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    untrack(callback.message.chat.id, callback.from_user.id)
    reset_prompt(callback.from_user.id)
    await _start_add_flow(callback.message, state)
    await callback.answer()


@router.callback_query(AddManhwa.status, F.data == "manhwa:back:genres")
async def add_manhwa_back_genres(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    untrack(callback.message.chat.id, callback.from_user.id)
    reset_prompt(callback.from_user.id)
    await _start_add_flow(callback.message, state)
    await callback.answer()


@router.callback_query(AddManhwa.cover, F.data == "manhwa:back:status")
async def add_manhwa_back_status(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    untrack(callback.message.chat.id, callback.from_user.id)
    reset_prompt(callback.from_user.id)
    await _start_add_flow(callback.message, state)
    await callback.answer()


@router.message(AddManhwa.cover, F.photo)
async def add_manhwa_cover(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    cover_path = None
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    file = await message.bot.get_file(message.photo[-1].file_id)
    cover_path = UPLOADS_DIR / f"cover_{message.from_user.id}.jpg"
    await message.bot.download_file(file.file_path, destination=cover_path)

    try:
        settings = processor.load_settings(SETTINGS_PATH)
        manhwa = processor.add_manhwa(
            title=data["title"],
            genres=data.get("genres", []),
            status=data["status"],
            cover_path=cover_path,
            manhwa_path=MANHWA_PATH,
            public_dir=PUBLIC_DIR,
            settings=settings,
        )
        processor.log_action(
            user_id=message.from_user.id,
            action=f"Added manhwa {manhwa['title']}",
            logs_path=LOGS_PATH,
        )
        await state.clear()
        reset_prompt(message.from_user.id)
        untrack(message.chat.id, message.from_user.id)
        lang = get_user_lang(message.from_user.id)
        await message.answer(
            f"Manhwa added: {manhwa['title']} ({manhwa['id']})",
            reply_markup=main_menu_kb(lang),
        )
    except Exception as exc:  # noqa: BLE001
        logging.exception("Failed to add manhwa")
        await state.clear()
        untrack(message.chat.id, message.from_user.id)
        reset_prompt(message.from_user.id)
        lang = get_user_lang(message.from_user.id)
        await message.answer(f"Failed to add manhwa: {exc}", reply_markup=inline_cancel_back_kb(lang=lang))


@router.message(AddManhwa.cover, F.text & ~F.text.in_(menu_labels_all()))
async def add_manhwa_cover_invalid(message: Message, state: FSMContext) -> None:
    await state.clear()
    untrack(message.chat.id, message.from_user.id)
    reset_prompt(message.from_user.id)
    lang = get_user_lang(message.from_user.id)
    await message.answer("Please send a photo or tap Skip.", reply_markup=main_menu_kb(lang))


@router.callback_query(AddManhwa.cover, F.data == "manhwa:cover:skip")
async def add_manhwa_cover_skip(callback: CallbackQuery, state: FSMContext) -> None:
    data = await state.get_data()
    try:
        settings = processor.load_settings(SETTINGS_PATH)
        manhwa = processor.add_manhwa(
            title=data["title"],
            genres=data.get("genres", []),
            status=data["status"],
            cover_path=None,
            manhwa_path=MANHWA_PATH,
            public_dir=PUBLIC_DIR,
            settings=settings,
        )
        processor.log_action(
            user_id=callback.from_user.id,
            action=f"Added manhwa {manhwa['title']}",
            logs_path=LOGS_PATH,
        )
        await state.clear()
        reset_prompt(callback.from_user.id)
        untrack(callback.message.chat.id, callback.from_user.id)
        await callback.message.answer(
            f"Manhwa added: {manhwa['title']} ({manhwa['id']})",
            reply_markup=main_menu_kb(get_user_lang(callback.from_user.id)),
        )
    except Exception as exc:  # noqa: BLE001
        logging.exception("Failed to add manhwa")
        await state.clear()
        untrack(callback.message.chat.id, callback.from_user.id)
        reset_prompt(callback.from_user.id)
        lang = get_user_lang(callback.from_user.id)
        await callback.message.answer(f"Failed to add manhwa: {exc}", reply_markup=inline_cancel_back_kb(lang=lang))
    await callback.answer()


def _genres_kb(lang: str, selected: list[str] | None = None) -> InlineKeyboardMarkup:
    selected_set = set(selected or [])
    rows = [
        [
            InlineKeyboardButton(
                text=f"✅ {genre}" if genre in selected_set else genre,
                callback_data=f"manhwa:genre:{genre}",
            )
        ]
        for genre in GENRES
    ]
    rows.append(
        [
            InlineKeyboardButton(text=button_label("back", lang), callback_data="manhwa:back:title"),
            InlineKeyboardButton(text=button_label("confirm", lang), callback_data="manhwa:genre:done"),
        ]
    )
    rows.append([InlineKeyboardButton(text=button_label("cancel", lang), callback_data="flow:cancel")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def _status_kb(lang: str) -> InlineKeyboardMarkup:
    rows = [
        [InlineKeyboardButton(text="Ongoing", callback_data="manhwa:status:ongoing")],
        [InlineKeyboardButton(text="Completed", callback_data="manhwa:status:completed")],
        [
            InlineKeyboardButton(text=button_label("back", lang), callback_data="manhwa:back:genres"),
            InlineKeyboardButton(text=button_label("cancel", lang), callback_data="flow:cancel"),
        ],
    ]
    return InlineKeyboardMarkup(inline_keyboard=rows)


@router.message(StateFilter(AddManhwa.title, AddManhwa.genres, AddManhwa.status), ~F.text)
async def add_manhwa_invalid_non_text(message: Message, state: FSMContext) -> None:
    await state.clear()
    untrack(message.chat.id, message.from_user.id)
    reset_prompt(message.from_user.id)
    lang = get_user_lang(message.from_user.id)
    await message.answer("Invalid input. Returning to main menu.", reply_markup=main_menu_kb(lang))


@router.message(AddManhwa.cover, ~F.photo & ~F.text)
async def add_manhwa_cover_invalid_non_text(message: Message, state: FSMContext) -> None:
    await state.clear()
    untrack(message.chat.id, message.from_user.id)
    reset_prompt(message.from_user.id)
    lang = get_user_lang(message.from_user.id)
    await message.answer("Invalid input. Returning to main menu.", reply_markup=main_menu_kb(lang))


def _cover_kb(lang: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text=button_label("back", lang), callback_data="manhwa:back:status"),
                InlineKeyboardButton(text="Skip", callback_data="manhwa:cover:skip"),
            ],
            [InlineKeyboardButton(text=button_label("cancel", lang), callback_data="flow:cancel")],
        ]
    )


def _manage_kb(lang: str) -> InlineKeyboardMarkup:
    rows = [
        [InlineKeyboardButton(text="➕ Add Manhwa", callback_data="manhwa:manage:add")],
        [InlineKeyboardButton(text="🗑 Delete Manhwa", callback_data="manhwa:manage:delete")],
        [InlineKeyboardButton(text="🧹 Clear All Manhwa", callback_data="manhwa:manage:clear")],
        [InlineKeyboardButton(text=button_label("cancel", lang), callback_data="flow:cancel")],
    ]
    return InlineKeyboardMarkup(inline_keyboard=rows)


def _build_id_map(manhwas: list[dict]) -> dict[str, str]:
    return {str(idx): str(item.get("id", "")) for idx, item in enumerate(manhwas) if item.get("id")}


def _resolve_manhwa_id(raw_id: str, id_map: dict | None) -> str | None:
    if id_map and raw_id in id_map:
        return id_map[raw_id]
    return raw_id or None


def _manage_manhwa_kb(
    manhwas: list[dict],
    lang: str,
    use_index: bool = False,
    page: int = 0,
    page_size: int = 30,
) -> InlineKeyboardMarkup:
    rows = []
    total = len(manhwas)
    total_pages = max(1, (total + page_size - 1) // page_size)
    page = max(0, min(page, total_pages - 1))
    start = page * page_size
    end = start + page_size
    for idx, item in enumerate(manhwas[start:end], start=start):
        value = str(idx) if use_index else str(item.get("id") or idx)
        rows.append([InlineKeyboardButton(text=item["title"], callback_data=f"manhwa:manage:delete:{value}")])
    if total_pages > 1:
        nav_row = []
        if page > 0:
            nav_row.append(
                InlineKeyboardButton(text="⬅ Prev", callback_data=f"manhwa:manage:page:{page - 1}")
            )
        nav_row.append(InlineKeyboardButton(text=f"{page + 1}/{total_pages}", callback_data="noop"))
        if page < total_pages - 1:
            nav_row.append(
                InlineKeyboardButton(text="Next ➡", callback_data=f"manhwa:manage:page:{page + 1}")
            )
        rows.append(nav_row)
    rows.append([InlineKeyboardButton(text=button_label("back", lang), callback_data="manhwa:manage:menu")])
    rows.append([InlineKeyboardButton(text=button_label("cancel", lang), callback_data="flow:cancel")])
    return InlineKeyboardMarkup(inline_keyboard=rows)

