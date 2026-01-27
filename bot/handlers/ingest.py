from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, Message

from ..config import (
    CHANNEL_CACHE_PATH,
    INGEST_HISTORY_PATH,
    LOGS_PATH,
    MANHWA_PATH,
    PUBLIC_DIR,
    SETTINGS_PATH,
    UPLOADS_DIR,
)
from ..i18n import button_label, get_user_lang, menu_labels, t
from ..keyboards import inline_cancel_back_kb, inline_chapter_kb, inline_manhwa_kb, main_menu_kb
from ..roles import can_upload, is_blocked
from server import processor
from server.ingest_parser import guess_from_filename

router = Router()


class IngestFlow(StatesGroup):
    channel = State()
    files = State()
    manhwa = State()
    chapter = State()
    confirm = State()


@router.channel_post(F.document)
async def cache_channel_documents(message: Message) -> None:
    if not message.document:
        return
    file_name = message.document.file_name or ""
    if not file_name.lower().endswith((".pdf", ".zip", ".rar")):
        return
    cache = _load_cache()
    cache.append(
        {
            "channel_id": message.chat.id,
            "channel_title": message.chat.title or "Unknown",
            "message_id": message.message_id,
            "file_id": message.document.file_id,
            "file_unique_id": message.document.file_unique_id,
            "file_name": file_name,
            "file_size": message.document.file_size,
            "date": message.date.isoformat(),
        }
    )
    _save_cache(cache[-100:])


@router.message(F.text.in_(menu_labels("ingest")))
async def ingest_menu(message: Message, state: FSMContext) -> None:
    if is_blocked(message.from_user.id):
        lang = get_user_lang(message.from_user.id)
        await message.answer(t("access_denied", lang))
        return
    if not can_upload(message.from_user.id):
        lang = get_user_lang(message.from_user.id)
        await message.answer(t("access_denied", lang))
        return
    await state.clear()
    channels = _group_channels(_load_cache())
    if not channels:
        await message.answer("No channel files cached yet.", reply_markup=main_menu_kb(get_user_lang(message.from_user.id)))
        return
    await state.set_state(IngestFlow.channel)
    await message.answer(
        "Select a channel:",
        reply_markup=inline_manhwa_kb(channels, lang=get_user_lang(message.from_user.id)),
    )


@router.callback_query(F.data.startswith("upload:manhwa:"))
async def ingest_select_channel(callback: CallbackQuery, state: FSMContext) -> None:
    if not await _is_ingest_state(state):
        return
    channel_id = int(callback.data.split("upload:manhwa:")[-1])
    await state.update_data(channel_id=channel_id, selected_files=[])
    await state.set_state(IngestFlow.files)
    await _prompt_files(callback.message, channel_id)
    await callback.answer()


async def _prompt_files(message: Message, channel_id: int) -> None:
    cached = [item for item in _load_cache() if item["channel_id"] == channel_id]
    cached = cached[-10:]
    if not cached:
        lang = get_user_lang(message.from_user.id)
        await message.answer(
            "No files found in this channel.",
            reply_markup=inline_cancel_back_kb("ingest:back:channel", lang=lang),
        )
        return
    text_lines = ["Select files to ingest (multi-select):"]
    for idx, item in enumerate(cached, start=1):
        text_lines.append(f"{idx}. {item['file_name']} ({_size(item['file_size'])})")
    buttons = []
    for idx, item in enumerate(cached, start=1):
        buttons.append(
            [
                {
                    "text": f"Toggle {idx}",
                    "callback_data": f"ingest:toggle:{item['file_unique_id']}",
                }
            ]
        )
    buttons.append([{"text": "✅ Review Selected", "callback_data": "ingest:review"}])
    await message.answer(
        "\n".join(text_lines),
        reply_markup=_inline_buttons(buttons, back_data="ingest:back:channel", lang=get_user_lang(message.from_user.id)),
    )


@router.callback_query(F.data == "ingest:back:channel")
async def ingest_back_channel(callback: CallbackQuery, state: FSMContext) -> None:
    channels = _group_channels(_load_cache())
    await state.set_state(IngestFlow.channel)
    await callback.message.answer(
        "Select a channel:",
        reply_markup=inline_manhwa_kb(channels, lang=get_user_lang(callback.from_user.id)),
    )
    await callback.answer()


@router.callback_query(F.data.startswith("ingest:toggle:"))
async def ingest_toggle_file(callback: CallbackQuery, state: FSMContext) -> None:
    file_unique_id = callback.data.split("ingest:toggle:")[-1]
    data = await state.get_data()
    selected = set(data.get("selected_files", []))
    if file_unique_id in selected:
        selected.remove(file_unique_id)
    else:
        selected.add(file_unique_id)
    await state.update_data(selected_files=list(selected))
    await callback.message.answer(f"Selected: {len(selected)} files")
    await callback.answer()


@router.callback_query(F.data == "ingest:review")
async def ingest_review(callback: CallbackQuery, state: FSMContext) -> None:
    data = await state.get_data()
    selected = data.get("selected_files", [])
    if not selected:
        await callback.message.answer("Select at least one file.")
        await callback.answer()
        return
    await state.update_data(pending_files=selected, current_index=0)
    await _start_next_ingest(callback.message, state)
    await callback.answer()


@router.callback_query(IngestFlow.manhwa, F.data.startswith("upload:manhwa:"))
async def ingest_choose_manhwa(callback: CallbackQuery, state: FSMContext) -> None:
    manhwa_id = callback.data.split("upload:manhwa:")[-1]
    await state.update_data(manhwa_id=manhwa_id)
    await state.set_state(IngestFlow.chapter)
    existing = processor.get_chapter_numbers(MANHWA_PATH, manhwa_id)
    suggestions = _suggest_chapters(existing)
    await callback.message.answer(
        "Choose chapter number:",
        reply_markup=inline_chapter_kb(
            existing=[],
            suggestions=suggestions,
            back_data="ingest:back:manhwa",
            lang=get_user_lang(callback.from_user.id),
        ),
    )
    await callback.answer()


@router.callback_query(F.data == "ingest:back:manhwa")
async def ingest_back_manhwa(callback: CallbackQuery, state: FSMContext) -> None:
    manhwas = processor.get_manhwa_list(MANHWA_PATH)
    await state.set_state(IngestFlow.manhwa)
    await callback.message.answer(
        "Select manhwa for this file:",
        reply_markup=inline_manhwa_kb(manhwas, lang=get_user_lang(callback.from_user.id)),
    )
    await callback.answer()


@router.callback_query(F.data.startswith("upload:chapter:new:"))
async def ingest_choose_chapter(callback: CallbackQuery, state: FSMContext) -> None:
    chapter = callback.data.split("upload:chapter:new:")[-1]
    await state.update_data(chapter_number=chapter)
    await state.set_state(IngestFlow.confirm)
    data = await state.get_data()
    cached = data.get("selected_file", {})
    guess = data.get("guess", {})
    await callback.message.answer(
        _guess_summary(cached.get("file_name", "File"), guess_from_dict(guess)),
        reply_markup=_inline_buttons(
            [
                [{"text": "✅ Confirm", "callback_data": "ingest:confirm"}],
                [{"text": "✏ Edit", "callback_data": "ingest:edit"}],
            ],
            back_data="ingest:back:channel",
            lang=get_user_lang(callback.from_user.id),
        ),
    )
    await callback.answer()


@router.callback_query(F.data == "ingest:edit")
async def ingest_edit(callback: CallbackQuery, state: FSMContext) -> None:
    manhwas = processor.get_manhwa_list(MANHWA_PATH)
    await state.set_state(IngestFlow.manhwa)
    await callback.message.answer(
        "Select manhwa for this file:",
        reply_markup=inline_manhwa_kb(manhwas, lang=get_user_lang(callback.from_user.id)),
    )
    await callback.answer()


@router.callback_query(F.data == "ingest:confirm")
async def ingest_confirm(callback: CallbackQuery, state: FSMContext) -> None:
    data = await state.get_data()
    cached = data.get("selected_file")
    if not cached:
        await callback.message.answer(
            "No file selected.", reply_markup=main_menu_kb(get_user_lang(callback.from_user.id))
        )
        await callback.answer()
        return
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    file = await callback.bot.get_file(cached["file_id"])
    local_path = UPLOADS_DIR / cached["file_name"]
    await callback.bot.download_file(file.file_path, destination=local_path)
    settings = processor.load_settings(SETTINGS_PATH)
    result = processor.process_upload(
        manhwa_id=data["manhwa_id"],
        chapter_number=data["chapter_number"],
        upload_path=local_path,
        manhwa_path=MANHWA_PATH,
        public_dir=PUBLIC_DIR,
        settings=settings,
    )
    _mark_ingested(cached["file_unique_id"])
    processor.log_action(
        user_id=callback.from_user.id,
        action=f"Ingested {cached['file_name']} -> {data['manhwa_id']} {data['chapter_number']}",
        logs_path=LOGS_PATH,
    )
    await _advance_queue(callback.message, state, result["pages_count"])
    await callback.answer()


def _load_cache() -> list[dict]:
    if not CHANNEL_CACHE_PATH.exists():
        return []
    with CHANNEL_CACHE_PATH.open("r", encoding="utf-8") as file:
        return json.load(file)


def _save_cache(data: list[dict]) -> None:
    CHANNEL_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with CHANNEL_CACHE_PATH.open("w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)


def _load_history() -> set[str]:
    if not INGEST_HISTORY_PATH.exists():
        return set()
    with INGEST_HISTORY_PATH.open("r", encoding="utf-8") as file:
        return set(json.load(file))


def _mark_ingested(file_unique_id: str) -> None:
    history = _load_history()
    history.add(file_unique_id)
    INGEST_HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    with INGEST_HISTORY_PATH.open("w", encoding="utf-8") as file:
        json.dump(sorted(history), file, ensure_ascii=False, indent=2)


def _is_ingested(file_unique_id: str) -> bool:
    return file_unique_id in _load_history()


def _group_channels(cache: list[dict]) -> list[dict]:
    grouped = {}
    for item in cache:
        grouped[item["channel_id"]] = {
            "id": str(item["channel_id"]),
            "title": item["channel_title"],
        }
    return [{"id": k, "title": v["title"]} for k, v in grouped.items()]


def _size(size: int) -> str:
    if size < 1024:
        return f"{size} B"
    if size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    return f"{size / (1024 * 1024):.1f} MB"


def _inline_buttons(rows: list[list[dict]], back_data: str | None = None, lang: str = "uz"):
    from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

    inline_rows = []
    for row in rows:
        inline_rows.append([InlineKeyboardButton(text=item["text"], callback_data=item["callback_data"]) for item in row])
    if back_data:
        inline_rows.append(
            [
                InlineKeyboardButton(text=button_label("back", lang), callback_data=back_data),
                InlineKeyboardButton(text=button_label("cancel", lang), callback_data="flow:cancel"),
            ]
        )
    return InlineKeyboardMarkup(inline_keyboard=inline_rows)


def _guess_summary(filename: str, guess) -> str:
    return (
        "🤖 AI Ingest Guess:\n"
        f"• File: {filename}\n"
        f"• Manhwa: {guess.manhwa_id or 'Unknown'}\n"
        f"• Chapter: {guess.chapter or 'Unknown'}\n"
        f"• Confidence: {int(guess.confidence * 100)}%\n\n"
        "Proceed?"
    )


async def _start_next_ingest(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    pending = data.get("pending_files", [])
    index = data.get("current_index", 0)
    if index >= len(pending):
        await state.clear()
        await message.answer("Ingest queue complete.", reply_markup=main_menu_kb(get_user_lang(message.from_user.id)))
        return
    file_unique_id = pending[index]
    cached = next((item for item in _load_cache() if item["file_unique_id"] == file_unique_id), None)
    if not cached:
        await message.answer("File not found. Skipping.")
        await state.update_data(current_index=index + 1)
        await _start_next_ingest(message, state)
        return
    if _is_ingested(file_unique_id):
        await message.answer(f"Already processed: {cached['file_name']}. Skipping.")
        await state.update_data(current_index=index + 1)
        await _start_next_ingest(message, state)
        return
    manhwas = processor.get_manhwa_list(MANHWA_PATH)
    guess = guess_from_filename(cached["file_name"], manhwas)
    await state.update_data(selected_file=cached, guess=guess.__dict__)
    if guess.manhwa_id and guess.chapter:
        await state.update_data(manhwa_id=guess.manhwa_id, chapter_number=guess.chapter)
        await state.set_state(IngestFlow.confirm)
        await message.answer(
            _guess_summary(cached["file_name"], guess),
            reply_markup=_inline_buttons(
                [
                    [{"text": "✅ Confirm", "callback_data": "ingest:confirm"}],
                    [{"text": "✏ Edit", "callback_data": "ingest:edit"}],
                ],
                back_data="ingest:back:channel",
                lang=get_user_lang(message.from_user.id),
            ),
        )
    else:
        await state.set_state(IngestFlow.manhwa)
        await message.answer(
            "Select manhwa for this file:",
            reply_markup=inline_manhwa_kb(manhwas, lang=get_user_lang(message.from_user.id)),
        )


async def _advance_queue(message: Message, state: FSMContext, pages_count: int) -> None:
    data = await state.get_data()
    index = data.get("current_index", 0)
    await message.answer(f"Ingested file {index + 1}. Pages: {pages_count}")
    await state.update_data(current_index=index + 1)
    await _start_next_ingest(message, state)


def guess_from_dict(data: dict):
    from server.ingest_parser import GuessResult

    return GuessResult(
        manhwa_id=data.get("manhwa_id"),
        chapter=data.get("chapter"),
        confidence=data.get("confidence", 0.0),
    )


def _suggest_chapters(existing: list[str]) -> list[str]:
    numbers = []
    for value in existing:
        try:
            numbers.append(float(value))
        except ValueError:
            continue
    if not numbers:
        return ["1", "1.5", "2"]
    max_number = max(numbers)
    return [
        _format_number(max_number + 1),
        _format_number(max_number + 0.5),
        _format_number(max_number + 2),
    ]


def _format_number(value: float) -> str:
    if value.is_integer():
        return str(int(value))
    return f"{value:.1f}".rstrip("0").rstrip(".")


async def _is_ingest_state(state: FSMContext) -> bool:
    current = await state.get_state()
    return current in {IngestFlow.channel.state, IngestFlow.files.state, IngestFlow.manhwa.state, IngestFlow.chapter.state}

