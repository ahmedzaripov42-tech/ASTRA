from __future__ import annotations

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from ..config import LOGS_PATH, MANHWA_PATH, PUBLIC_DIR, SETTINGS_PATH, UPLOADS_DIR
from ..flow_registry import track, untrack
from ..i18n import button_label, get_user_lang, menu_labels, t
from ..keyboards import inline_cancel_back_kb, main_menu_kb
from ..prompt_guard import mark_prompt, reset_prompt
from ..roles import can_manage_manhwa, is_blocked
from server import processor

router = Router()


class AddManhwa(StatesGroup):
    title = State()
    genres = State()
    status = State()
    cover = State()


@router.message(Command("add_manhwa"))
@router.message(F.text.in_(menu_labels("manhwa")))
async def add_manhwa_start(message: Message, state: FSMContext) -> None:
    if is_blocked(message.from_user.id):
        lang = get_user_lang(message.from_user.id)
        await message.answer(t("access_denied", lang))
        return
    if not can_manage_manhwa(message.from_user.id):
        lang = get_user_lang(message.from_user.id)
        await message.answer(t("access_denied", lang))
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
    await state.update_data(title=message.text.strip())
    await state.set_state(AddManhwa.genres)
    lang = get_user_lang(message.from_user.id)
    await message.answer("Select genres (tap to toggle, then Done):", reply_markup=_genres_kb(lang))


@router.message(AddManhwa.title)
async def add_manhwa_title_invalid(message: Message) -> None:
    lang = get_user_lang(message.from_user.id)
    await message.answer("Please send the manhwa title as text.", reply_markup=inline_cancel_back_kb(lang=lang))


@router.callback_query(AddManhwa.genres, F.data.startswith("manhwa:genre:"))
async def add_manhwa_genre_toggle(callback: CallbackQuery, state: FSMContext) -> None:
    genre = callback.data.split("manhwa:genre:")[-1]
    data = await state.get_data()
    selected = set(data.get("genres", []))
    if genre in selected:
        selected.remove(genre)
    else:
        selected.add(genre)
    await state.update_data(genres=list(selected))
    await callback.message.answer(f"Selected: {', '.join(selected) or 'none'}")
    await callback.answer()


@router.callback_query(AddManhwa.genres, F.data == "manhwa:genre:done")
async def add_manhwa_genre_done(callback: CallbackQuery, state: FSMContext) -> None:
    data = await state.get_data()
    if not data.get("genres"):
        await callback.message.answer("Select at least one genre.")
        await callback.answer()
        return
    await state.set_state(AddManhwa.status)
    lang = get_user_lang(callback.from_user.id)
    await callback.message.answer("Select status:", reply_markup=_status_kb(lang))
    await callback.answer()


@router.message(AddManhwa.genres)
async def add_manhwa_genres_invalid(message: Message) -> None:
    lang = get_user_lang(message.from_user.id)
    await message.answer("Please choose genres using the buttons.", reply_markup=_genres_kb(lang))


@router.callback_query(AddManhwa.status, F.data.startswith("manhwa:status:"))
async def add_manhwa_status(callback: CallbackQuery, state: FSMContext) -> None:
    status = callback.data.split("manhwa:status:")[-1]
    await state.update_data(status=status)
    await state.set_state(AddManhwa.cover)
    lang = get_user_lang(callback.from_user.id)
    await callback.message.answer(
        "Send cover photo or tap Skip:",
        reply_markup=_cover_kb(lang),
    )
    await callback.answer()


@router.message(AddManhwa.status)
async def add_manhwa_status_invalid(message: Message) -> None:
    lang = get_user_lang(message.from_user.id)
    await message.answer("Please select a status using the buttons.", reply_markup=_status_kb(lang))


@router.callback_query(AddManhwa.genres, F.data == "manhwa:back:title")
async def add_manhwa_back_title(callback: CallbackQuery, state: FSMContext) -> None:
    await state.set_state(AddManhwa.title)
    lang = get_user_lang(callback.from_user.id)
    await callback.message.answer("Send manhwa title:", reply_markup=inline_cancel_back_kb(lang=lang))
    await callback.answer()


@router.callback_query(AddManhwa.status, F.data == "manhwa:back:genres")
async def add_manhwa_back_genres(callback: CallbackQuery, state: FSMContext) -> None:
    await state.set_state(AddManhwa.genres)
    lang = get_user_lang(callback.from_user.id)
    await callback.message.answer("Select genres (tap to toggle, then Done):", reply_markup=_genres_kb(lang))
    await callback.answer()


@router.callback_query(AddManhwa.cover, F.data == "manhwa:back:status")
async def add_manhwa_back_status(callback: CallbackQuery, state: FSMContext) -> None:
    await state.set_state(AddManhwa.status)
    lang = get_user_lang(callback.from_user.id)
    await callback.message.answer("Select status:", reply_markup=_status_kb(lang))
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
            genres=data["genres"],
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
        lang = get_user_lang(message.from_user.id)
        await message.answer(f"Failed to add manhwa: {exc}", reply_markup=inline_cancel_back_kb(lang=lang))


@router.message(AddManhwa.cover)
async def add_manhwa_cover_invalid(message: Message) -> None:
    lang = get_user_lang(message.from_user.id)
    await message.answer("Please send a photo or tap Skip.", reply_markup=_cover_kb(lang))


@router.callback_query(AddManhwa.cover, F.data == "manhwa:cover:skip")
async def add_manhwa_cover_skip(callback: CallbackQuery, state: FSMContext) -> None:
    data = await state.get_data()
    try:
        settings = processor.load_settings(SETTINGS_PATH)
        manhwa = processor.add_manhwa(
            title=data["title"],
            genres=data["genres"],
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
        lang = get_user_lang(callback.from_user.id)
        await callback.message.answer(f"Failed to add manhwa: {exc}", reply_markup=inline_cancel_back_kb(lang=lang))
    await callback.answer()


def _genres_kb(lang: str) -> InlineKeyboardMarkup:
    genres = [
        "Action",
        "Romance",
        "Fantasy",
        "Drama",
        "Dark",
        "Psychological",
        "Comedy",
        "Mystery",
    ]
    rows = [[InlineKeyboardButton(text=genre, callback_data=f"manhwa:genre:{genre}")] for genre in genres]
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
        [InlineKeyboardButton(text="Ongoing", callback_data="manhwa:status:Ongoing")],
        [InlineKeyboardButton(text="Completed", callback_data="manhwa:status:Completed")],
        [InlineKeyboardButton(text="Hiatus", callback_data="manhwa:status:Hiatus")],
        [
            InlineKeyboardButton(text=button_label("back", lang), callback_data="manhwa:back:genres"),
            InlineKeyboardButton(text=button_label("cancel", lang), callback_data="flow:cancel"),
        ],
    ]
    return InlineKeyboardMarkup(inline_keyboard=rows)


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

