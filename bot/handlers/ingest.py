from __future__ import annotations

import asyncio
import json
import logging
import re
import shutil
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from aiogram import F, Router
from aiogram.filters import StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, Message

from ..config import (
    CHANNEL_CACHE_PATH,
    INGEST_HISTORY_PATH,
    INGEST_LOGS_PATH,
    INGEST_STATE_PATH,
    LOGS_PATH,
    MANHWA_PATH,
    PUBLIC_DIR,
    SETTINGS_PATH,
    CATALOG_CHANNELS,
    CATALOG_SOURCE_MAP,
    INGEST_CACHE_LIMIT,
    SOURCE_CHANNELS,
    TELEGRAM_SAFE_FILE_BYTES,
    UPLOADS_DIR,
)
from ..i18n import button_label, ensure_access, get_user_lang, menu_labels, menu_labels_all, t
from ..keyboards import inline_cancel_back_kb, inline_chapter_kb, inline_manhwa_kb, main_menu_kb
from ..flow_registry import untrack
from ..prompt_guard import reset_prompt
from ..roles import can_upload
from server import processor
from server.ingest_parser import extract_chapter_numbers, guess_from_filename, match_manhwa_fuzzy

router = Router()


class IngestFlow(StatesGroup):
    mode = State()
    channel = State()
    files = State()
    manhwa = State()
    chapter = State()
    confirm = State()
    auto_manhwa = State()
    auto_preview = State()
    auto_running = State()


@router.channel_post(F.document)
async def cache_channel_documents(message: Message) -> None:
    if not message.document:
        return
    file_name = message.document.file_name or ""
    if not file_name.lower().endswith((".pdf", ".zip", ".rar", ".jpg", ".jpeg", ".png")):
        return
    cache = _load_cache()
    entry = _build_cache_entry(message, entry_type="document")
    if entry:
        cache.append(entry)
        _save_cache(_trim_cache(cache))


@router.channel_post(F.text)
async def cache_channel_text_posts(message: Message) -> None:
    if not message.text:
        return
    cache = _load_cache()
    entry = _build_cache_entry(message, entry_type="post")
    if entry:
        cache.append(entry)
        _save_cache(_trim_cache(cache))


@router.channel_post(F.caption)
async def cache_channel_caption_posts(message: Message) -> None:
    if message.document or message.text:
        return
    if not message.caption:
        return
    cache = _load_cache()
    entry = _build_cache_entry(message, entry_type="post")
    if entry:
        cache.append(entry)
        _save_cache(_trim_cache(cache))


@router.channel_post(F.photo)
async def cache_channel_photo_posts(message: Message) -> None:
    if not message.photo:
        return
    cache = _load_cache()
    entry = _build_cache_entry(message, entry_type="document")
    if entry:
        cache.append(entry)
        _save_cache(_trim_cache(cache))


@router.message(F.text.in_(menu_labels("ingest")))
async def ingest_menu(message: Message, state: FSMContext) -> None:
    if not await ensure_access(message, can_upload):
        return
    await state.clear()
    await state.set_state(IngestFlow.mode)
    await message.answer(
        "Choose ingest mode:",
        reply_markup=_inline_buttons(
            [
                [{"text": "⚡ Auto Channel Ingest (Plan B)", "callback_data": "ingest:mode:auto"}],
                [{"text": "📥 Manual Cache Ingest", "callback_data": "ingest:mode:manual"}],
            ],
            back_data="flow:cancel",
            lang=get_user_lang(message.from_user.id),
        ),
    )


@router.callback_query(IngestFlow.mode, F.data == "ingest:mode:manual")
async def ingest_mode_manual(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_upload):
        return
    await state.set_state(IngestFlow.channel)
    await _prompt_manual_channels(callback.message, state)
    await callback.answer()


@router.callback_query(IngestFlow.mode, F.data == "ingest:mode:auto")
async def ingest_mode_auto(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_upload):
        return
    manhwas = processor.get_manhwa_list(MANHWA_PATH)
    if not manhwas:
        await callback.message.answer(
            t("no_manhwa", get_user_lang(callback.from_user.id)),
            reply_markup=main_menu_kb(get_user_lang(callback.from_user.id)),
        )
        await callback.answer()
        return
    await state.set_state(IngestFlow.auto_manhwa)
    await state.update_data(ingest_manhwa_map=_build_id_map(manhwas))
    await callback.message.answer(
        "Select manhwa for auto-ingest:",
        reply_markup=inline_manhwa_kb(
            manhwas,
            lang=get_user_lang(callback.from_user.id),
            callback_prefix="ingest:auto:manhwa:",
            use_index=True,
            page=0,
            nav_prefix="ingest:auto:manhwa:page:",
        ),
    )
    await callback.answer()


@router.callback_query(
    IngestFlow.channel,
    F.data.startswith("ingest:channel:") & ~F.data.startswith("ingest:channel:page:"),
)
async def ingest_select_channel(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_upload):
        return
    raw_id = callback.data.split("ingest:channel:")[-1]
    data = await state.get_data()
    channel_id = _resolve_id(raw_id, data.get("channel_id_map"))
    try:
        channel_id_int = int(channel_id)
    except (TypeError, ValueError):
        await state.clear()
        untrack(callback.message.chat.id, callback.from_user.id)
        reset_prompt(callback.from_user.id)
        await callback.message.answer(
            "Invalid channel selection.",
            reply_markup=main_menu_kb(get_user_lang(callback.from_user.id)),
        )
        await callback.answer()
        return
    await state.update_data(channel_id=channel_id_int, selected_files=[])
    await state.set_state(IngestFlow.files)
    await _prompt_files(callback.message, channel_id_int)
    await callback.answer()


@router.callback_query(IngestFlow.channel, F.data.startswith("ingest:channel:page:"))
async def ingest_channel_page(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_upload):
        return
    raw_page = callback.data.split("ingest:channel:page:")[-1]
    try:
        page = int(raw_page)
    except ValueError:
        await callback.answer()
        return
    channels = _group_channels(_load_cache())
    if not channels:
        await state.clear()
        untrack(callback.message.chat.id, callback.from_user.id)
        reset_prompt(callback.from_user.id)
        await callback.message.answer(
            "No channel files cached yet.",
            reply_markup=main_menu_kb(get_user_lang(callback.from_user.id)),
        )
        await callback.answer()
        return
    await state.update_data(channel_id_map=_build_id_map(channels))
    await callback.message.edit_reply_markup(
        reply_markup=inline_manhwa_kb(
            channels,
            lang=get_user_lang(callback.from_user.id),
            callback_prefix="ingest:channel:",
            use_index=True,
            page=page,
            nav_prefix="ingest:channel:page:",
        )
    )
    await callback.answer()


@router.callback_query(
    IngestFlow.auto_manhwa,
    F.data.startswith("ingest:auto:manhwa:") & ~F.data.startswith("ingest:auto:manhwa:page:"),
)
async def ingest_auto_select_manhwa(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_upload):
        return
    raw_id = callback.data.split("ingest:auto:manhwa:")[-1]
    data = await state.get_data()
    manhwa_id = _resolve_id(raw_id, data.get("ingest_manhwa_map"))
    if not manhwa_id or not processor.get_manhwa_by_id(MANHWA_PATH, manhwa_id):
        await state.clear()
        untrack(callback.message.chat.id, callback.from_user.id)
        reset_prompt(callback.from_user.id)
        await callback.message.answer(
            "Invalid manhwa selection.",
            reply_markup=main_menu_kb(get_user_lang(callback.from_user.id)),
        )
        await callback.answer()
        return
    await state.update_data(manhwa_id=manhwa_id)
    await _auto_scan_preview(callback.message, state, manhwa_id)
    await callback.answer()


@router.callback_query(IngestFlow.auto_manhwa, F.data.startswith("ingest:auto:manhwa:page:"))
async def ingest_auto_manhwa_page(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_upload):
        return
    raw_page = callback.data.split("ingest:auto:manhwa:page:")[-1]
    try:
        page = int(raw_page)
    except ValueError:
        await callback.answer()
        return
    manhwas = processor.get_manhwa_list(MANHWA_PATH)
    if not manhwas:
        await state.clear()
        untrack(callback.message.chat.id, callback.from_user.id)
        reset_prompt(callback.from_user.id)
        await callback.message.answer(
            t("no_manhwa", get_user_lang(callback.from_user.id)),
            reply_markup=main_menu_kb(get_user_lang(callback.from_user.id)),
        )
        await callback.answer()
        return
    await state.update_data(ingest_manhwa_map=_build_id_map(manhwas))
    await callback.message.edit_reply_markup(
        reply_markup=inline_manhwa_kb(
            manhwas,
            lang=get_user_lang(callback.from_user.id),
            callback_prefix="ingest:auto:manhwa:",
            use_index=True,
            page=page,
            nav_prefix="ingest:auto:manhwa:page:",
        )
    )
    await callback.answer()


@router.callback_query(IngestFlow.auto_preview, F.data == "ingest:auto:confirm")
async def ingest_auto_confirm(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_upload):
        return
    await state.set_state(IngestFlow.auto_running)
    await _run_auto_ingest(callback.message, state)
    await callback.answer()


@router.callback_query(IngestFlow.auto_preview, F.data == "ingest:auto:rescan")
async def ingest_auto_rescan(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_upload):
        return
    data = await state.get_data()
    manhwa_id = data.get("manhwa_id")
    if manhwa_id:
        await _auto_scan_preview(callback.message, state, manhwa_id, force_rescan=True)
    await callback.answer()


@router.callback_query(IngestFlow.auto_preview, F.data == "ingest:auto:back")
async def ingest_auto_back(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_upload):
        return
    manhwas = processor.get_manhwa_list(MANHWA_PATH)
    if not manhwas:
        await callback.message.answer(
            t("no_manhwa", get_user_lang(callback.from_user.id)),
            reply_markup=main_menu_kb(get_user_lang(callback.from_user.id)),
        )
        await callback.answer()
        return
    await state.set_state(IngestFlow.auto_manhwa)
    await state.update_data(ingest_manhwa_map=_build_id_map(manhwas))
    await callback.message.answer(
        "Select manhwa for auto-ingest:",
        reply_markup=inline_manhwa_kb(
            manhwas,
            lang=get_user_lang(callback.from_user.id),
            callback_prefix="ingest:auto:manhwa:",
            use_index=True,
            page=0,
            nav_prefix="ingest:auto:manhwa:page:",
        ),
    )
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


@router.callback_query(
    StateFilter(IngestFlow.files, IngestFlow.manhwa, IngestFlow.chapter, IngestFlow.confirm),
    F.data == "ingest:back:channel",
)
async def ingest_back_channel(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_upload):
        return
    await state.clear()
    reset_prompt(callback.from_user.id)
    await state.set_state(IngestFlow.channel)
    await _prompt_manual_channels(callback.message, state)
    await callback.answer()


@router.callback_query(IngestFlow.files, F.data.startswith("ingest:toggle:"))
async def ingest_toggle_file(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_upload):
        return
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


@router.callback_query(IngestFlow.files, F.data == "ingest:review")
async def ingest_review(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_upload):
        return
    data = await state.get_data()
    selected = data.get("selected_files", [])
    if not selected:
        await callback.message.answer("Select at least one file.")
        await callback.answer()
        return
    await state.update_data(pending_files=selected, current_index=0)
    await _start_next_ingest(callback.message, state)
    await callback.answer()


@router.callback_query(
    IngestFlow.manhwa,
    F.data.startswith("ingest:manhwa:") & ~F.data.startswith("ingest:manhwa:page:"),
)
async def ingest_choose_manhwa(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_upload):
        return
    raw_id = callback.data.split("ingest:manhwa:")[-1]
    data = await state.get_data()
    manhwa_id = _resolve_id(raw_id, data.get("ingest_manhwa_map"))
    if not manhwa_id or not processor.get_manhwa_by_id(MANHWA_PATH, manhwa_id):
        await state.clear()
        untrack(callback.message.chat.id, callback.from_user.id)
        reset_prompt(callback.from_user.id)
        await callback.message.answer(
            "Invalid manhwa selection.",
            reply_markup=main_menu_kb(get_user_lang(callback.from_user.id)),
        )
        await callback.answer()
        return
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


@router.callback_query(IngestFlow.manhwa, F.data.startswith("ingest:manhwa:page:"))
async def ingest_manhwa_page(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_upload):
        return
    raw_page = callback.data.split("ingest:manhwa:page:")[-1]
    try:
        page = int(raw_page)
    except ValueError:
        await callback.answer()
        return
    manhwas = processor.get_manhwa_list(MANHWA_PATH)
    if not manhwas:
        lang = get_user_lang(callback.from_user.id)
        await state.clear()
        untrack(callback.message.chat.id, callback.from_user.id)
        reset_prompt(callback.from_user.id)
        await callback.message.answer(
            t("no_manhwa", lang),
            reply_markup=main_menu_kb(lang),
        )
        await callback.answer()
        return
    await state.update_data(ingest_manhwa_map=_build_id_map(manhwas))
    await callback.message.edit_reply_markup(
        reply_markup=inline_manhwa_kb(
            manhwas,
            lang=get_user_lang(callback.from_user.id),
            callback_prefix="ingest:manhwa:",
            use_index=True,
            page=page,
            nav_prefix="ingest:manhwa:page:",
        )
    )
    await callback.answer()


@router.callback_query(IngestFlow.chapter, F.data == "ingest:back:manhwa")
async def ingest_back_manhwa(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_upload):
        return
    await state.clear()
    reset_prompt(callback.from_user.id)
    manhwas = processor.get_manhwa_list(MANHWA_PATH)
    await state.update_data(ingest_manhwa_map=_build_id_map(manhwas))
    await state.set_state(IngestFlow.manhwa)
    if not manhwas:
        lang = get_user_lang(callback.from_user.id)
        await callback.message.answer(
            t("no_manhwa", lang),
            reply_markup=inline_cancel_back_kb(back_data="ingest:back:channel", lang=lang),
        )
        await callback.answer()
        return
    await callback.message.answer(
        "Select manhwa for this file:",
        reply_markup=inline_manhwa_kb(
            manhwas,
            lang=get_user_lang(callback.from_user.id),
            callback_prefix="ingest:manhwa:",
            use_index=True,
            page=0,
            nav_prefix="ingest:manhwa:page:",
        ),
    )
    await callback.answer()


@router.callback_query(IngestFlow.chapter, F.data.startswith("upload:chapter:new:"))
async def ingest_choose_chapter(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_upload):
        return
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


@router.callback_query(IngestFlow.confirm, F.data == "ingest:edit")
async def ingest_edit(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_upload):
        return
    manhwas = processor.get_manhwa_list(MANHWA_PATH)
    await state.update_data(ingest_manhwa_map=_build_id_map(manhwas))
    await state.set_state(IngestFlow.manhwa)
    if not manhwas:
        lang = get_user_lang(callback.from_user.id)
        await callback.message.answer(
            t("no_manhwa", lang),
            reply_markup=inline_cancel_back_kb(back_data="ingest:back:channel", lang=lang),
        )
        await callback.answer()
        return
    await callback.message.answer(
        "Select manhwa for this file:",
        reply_markup=inline_manhwa_kb(
            manhwas,
            lang=get_user_lang(callback.from_user.id),
            callback_prefix="ingest:manhwa:",
            use_index=True,
        ),
    )
    await callback.answer()


@router.callback_query(IngestFlow.confirm, F.data == "ingest:confirm")
async def ingest_confirm(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_upload):
        return
    data = await state.get_data()
    cached = data.get("selected_file")
    if not cached or not data.get("manhwa_id") or not data.get("chapter_number"):
        await state.clear()
        untrack(callback.message.chat.id, callback.from_user.id)
        reset_prompt(callback.from_user.id)
        await callback.message.answer(
            "No file selected.", reply_markup=main_menu_kb(get_user_lang(callback.from_user.id))
        )
        await callback.answer()
        return
    try:
        file_size = cached.get("file_size") or 0
        if file_size > TELEGRAM_SAFE_FILE_BYTES:
            await callback.message.answer(
                "File too large for Telegram download.\n"
                "Please provide a direct file URL in the upload flow instead."
            )
            await state.update_data(current_index=data.get("current_index", 0) + 1)
            await _start_next_ingest(callback.message, state)
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
    except Exception:  # noqa: BLE001
        logging.exception("Ingest confirm failed")
        await state.clear()
        untrack(callback.message.chat.id, callback.from_user.id)
        reset_prompt(callback.from_user.id)
        await callback.message.answer("Ingest failed. Please try again.", reply_markup=main_menu_kb(get_user_lang(callback.from_user.id)))
    await callback.answer()


def _load_cache() -> list[dict]:
    if not CHANNEL_CACHE_PATH.exists():
        return []
    with CHANNEL_CACHE_PATH.open("r", encoding="utf-8") as file:
        data = json.load(file)
        if isinstance(data, list):
            return data
        return []


def _save_cache(data: list[dict]) -> None:
    CHANNEL_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with CHANNEL_CACHE_PATH.open("w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)


def _trim_cache(cache: list[dict]) -> list[dict]:
    if len(cache) <= INGEST_CACHE_LIMIT:
        return cache
    return cache[-INGEST_CACHE_LIMIT:]


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
        if item.get("type", "document") != "document":
            continue
        if not item.get("file_id"):
            continue
        grouped[item["channel_id"]] = {
            "id": str(item["channel_id"]),
            "title": item["channel_title"],
        }
    return [{"id": k, "title": v["title"]} for k, v in grouped.items()]


def _build_id_map(items: list[dict]) -> dict[str, str]:
    return {str(idx): str(item.get("id", "")) for idx, item in enumerate(items) if item.get("id") is not None}


def _resolve_id(raw_id: str, id_map: dict | None) -> str | None:
    if id_map and raw_id in id_map:
        return id_map[raw_id]
    return raw_id


def _size(size: int) -> str:
    if size < 1024:
        return f"{size} B"
    if size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    return f"{size / (1024 * 1024):.1f} MB"


async def _prompt_manual_channels(message: Message, state: FSMContext) -> None:
    channels = _group_channels(_load_cache())
    if not channels:
        await message.answer("No channel files cached yet.", reply_markup=main_menu_kb(get_user_lang(message.from_user.id)))
        return
    await state.update_data(channel_id_map=_build_id_map(channels))
    await message.answer(
        "Select a channel:",
        reply_markup=inline_manhwa_kb(
            channels,
            lang=get_user_lang(message.from_user.id),
            callback_prefix="ingest:channel:",
            use_index=True,
            page=0,
            nav_prefix="ingest:channel:page:",
        ),
    )


def _normalize_channel_username(value: str | None) -> str:
    if not value:
        return ""
    value = value.strip().lower()
    if value.startswith("@"):
        value = value[1:]
    if value.startswith("https://t.me/") or value.startswith("http://t.me/"):
        value = value.split("t.me/")[-1].split("/")[0]
    return value


def _channel_internal_id(channel_id: int | None) -> str | None:
    if channel_id is None:
        return None
    try:
        channel_id = int(channel_id)
    except (TypeError, ValueError):
        return None
    channel_id = abs(channel_id)
    if channel_id < 1000000000000:
        return None
    return str(channel_id - 1000000000000)


def _extract_links(text: str, entities: list | None) -> list[dict]:
    links: set[str] = set()
    if entities and text:
        for entity in entities:
            if entity.type == "text_link" and entity.url:
                links.add(entity.url)
            elif entity.type == "url":
                start = entity.offset
                end = start + entity.length
                links.add(text[start:end])
    if text:
        links.update(re.findall(r"(https?://\S+|t\.me/\S+)", text))
    parsed: list[dict] = []
    for link in links:
        parsed_link = _parse_link(link)
        if parsed_link:
            parsed.append(parsed_link)
    return parsed


def _parse_link(link: str) -> dict | None:
    if not link:
        return None
    if link.startswith("t.me/"):
        link = f"https://{link}"
    if link.startswith("http://t.me/"):
        link = link.replace("http://", "https://", 1)
    if not link.startswith("http"):
        return None
    parsed = urlparse(link)
    if parsed.netloc not in {"t.me", "telegram.me"}:
        return {"url": link, "kind": "external"}
    parts = parsed.path.strip("/").split("/")
    if len(parts) >= 2 and parts[0] == "c":
        return {"url": link, "kind": "tme", "channel_internal_id": parts[1], "message_id": parts[2] if len(parts) > 2 else None}
    if len(parts) >= 2:
        return {"url": link, "kind": "tme", "channel_username": _normalize_channel_username(parts[0]), "message_id": parts[1]}
    return {"url": link, "kind": "tme"}


def _build_cache_entry(message: Message, entry_type: str) -> dict | None:
    channel_username = _normalize_channel_username(getattr(message.chat, "username", ""))
    text = message.text or message.caption or ""
    entities = message.entities or message.caption_entities or []
    links = _extract_links(text, entities)
    entry: dict = {
        "type": entry_type,
        "channel_id": message.chat.id,
        "channel_title": message.chat.title or "Unknown",
        "channel_username": channel_username,
        "message_id": message.message_id,
        "date": message.date.isoformat(),
        "text": message.text or "",
        "caption": message.caption or "",
        "links": links,
    }
    if message.document:
        entry.update(
            {
                "file_id": message.document.file_id,
                "file_unique_id": message.document.file_unique_id,
                "file_name": message.document.file_name,
                "file_size": message.document.file_size,
            }
        )
    elif message.photo:
        photo = message.photo[-1]
        entry.update(
            {
                "file_id": photo.file_id,
                "file_unique_id": photo.file_unique_id,
                "file_name": f"photo_{message.message_id}.jpg",
                "file_size": photo.file_size,
            }
        )
    if message.forward_from_chat:
        entry["forward_from_chat_id"] = message.forward_from_chat.id
        entry["forward_from_message_id"] = message.forward_from_message_id
    return entry


def _load_ingest_state() -> dict:
    if not INGEST_STATE_PATH.exists():
        return {"manhwas": {}}
    with INGEST_STATE_PATH.open("r", encoding="utf-8") as file:
        try:
            data = json.load(file)
        except json.JSONDecodeError:
            return {"manhwas": {}}
    if not isinstance(data, dict):
        return {"manhwas": {}}
    data.setdefault("manhwas", {})
    return data


def _save_ingest_state(data: dict) -> None:
    INGEST_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with INGEST_STATE_PATH.open("w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)


def _log_ingest_event(event: str, details: dict) -> None:
    INGEST_LOGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    logs = []
    if INGEST_LOGS_PATH.exists():
        with INGEST_LOGS_PATH.open("r", encoding="utf-8") as file:
            try:
                logs = json.load(file)
            except json.JSONDecodeError:
                logs = []
    logs.append(
        {
            "time": datetime.utcnow().isoformat(timespec="seconds"),
            "event": event,
            "details": details,
        }
    )
    with INGEST_LOGS_PATH.open("w", encoding="utf-8") as file:
        json.dump(logs[-5000:], file, ensure_ascii=False, indent=2)


def _catalog_channel_set() -> set[str]:
    return {_normalize_channel_username(item) for item in CATALOG_CHANNELS if item}


def _source_channel_set() -> set[str]:
    return {_normalize_channel_username(item) for item in SOURCE_CHANNELS if item}


def _catalog_source_map() -> dict[str, str]:
    normalized = {}
    for key, value in CATALOG_SOURCE_MAP.items():
        normalized[_normalize_channel_username(key)] = _normalize_channel_username(value)
    return normalized


def _is_catalog_entry(entry: dict) -> bool:
    channel_key = _normalize_channel_username(entry.get("channel_username")) or _normalize_channel_username(
        entry.get("channel_title")
    )
    return channel_key in _catalog_channel_set()


def _is_source_entry(entry: dict) -> bool:
    channel_key = _normalize_channel_username(entry.get("channel_username")) or _normalize_channel_username(
        entry.get("channel_title")
    )
    return channel_key in _source_channel_set()


def _index_documents_by_link(cache: list[dict]) -> dict[str, dict]:
    index: dict[str, dict] = {}
    for entry in cache:
        if entry.get("type", "document") != "document":
            continue
        message_id = str(entry.get("message_id") or "")
        channel_username = _normalize_channel_username(entry.get("channel_username"))
        if channel_username and message_id:
            index[f"{channel_username}:{message_id}"] = entry
        internal_id = _channel_internal_id(entry.get("channel_id"))
        if internal_id and message_id:
            index[f"c:{internal_id}:{message_id}"] = entry
    return index


def _index_source_documents(cache: list[dict], manhwas: list[dict], manhwa_id: str) -> dict[str, dict]:
    index: dict[str, dict] = {}
    for entry in cache:
        if entry.get("type", "document") != "document":
            continue
        if not _is_source_entry(entry):
            continue
        text = f"{entry.get('caption', '')} {entry.get('file_name', '')}"
        matched_id, score = match_manhwa_fuzzy(text, manhwas)
        if matched_id != manhwa_id:
            continue
        chapters = extract_chapter_numbers(text)
        if not chapters:
            continue
        for chapter in chapters:
            existing = index.get(chapter)
            if not existing or score > existing.get("score", 0):
                index[chapter] = {"entry": entry, "score": score}
    return index


def _extract_hashtag_tokens(text: str) -> list[str]:
    if not text:
        return []
    tags = re.findall(r"#([\w\-]+)", text)
    return [tag.replace("-", " ").replace("_", " ") for tag in tags if tag]


def _extract_chapters_from_entry(entry: dict) -> list[str]:
    base_text = f"{entry.get('caption', '')} {entry.get('file_name', '')} {entry.get('text', '')}"
    hashtags_text = " ".join(_extract_hashtag_tokens(base_text))
    chapters = extract_chapter_numbers(base_text)
    if hashtags_text:
        chapters.extend(extract_chapter_numbers(hashtags_text))
    seen = set()
    ordered: list[str] = []
    for value in chapters:
        if value in seen:
            continue
        seen.add(value)
        ordered.append(value)
    return ordered


def _build_source_candidates(
    manhwa_id: str,
    cache: list[dict],
    manhwas: list[dict],
    existing: set[str],
    processed_sources: set[str],
    processed_files: set[str],
) -> tuple[list[dict], dict]:
    candidates: dict[str, dict] = {}
    stats = {
        "total": 0,
        "pending": 0,
        "exists": 0,
        "missing_source": 0,
        "skipped_posts": 0,
        "warnings": 0,
    }
    for entry in cache:
        if entry.get("type", "document") != "document":
            continue
        if not _is_source_entry(entry):
            continue
        text = f"{entry.get('caption', '')} {entry.get('file_name', '')}"
        matched_id, score = match_manhwa_fuzzy(text, manhwas)
        if matched_id != manhwa_id:
            stats["skipped_posts"] += 1
            continue
        chapters = _extract_chapters_from_entry(entry)
        if not chapters:
            stats["skipped_posts"] += 1
            _log_ingest_event(
                "source_skip",
                {
                    "channel": entry.get("channel_username") or entry.get("channel_title"),
                    "message_id": entry.get("message_id"),
                    "reason": "no_chapters_detected",
                },
            )
            continue
        for chapter in chapters:
            stats["total"] += 1
            candidate = candidates.get(chapter)
            if candidate and candidate.get("confidence", 0) >= score:
                continue
            status = "pending"
            reason = ""
            if chapter in existing:
                status = "exists"
                reason = "already_in_manhwa_json"
                stats["exists"] += 1
            else:
                file_unique_id = entry.get("file_unique_id")
                source_key = _source_key(entry)
                if file_unique_id and file_unique_id in processed_files:
                    status = "exists"
                    reason = "already_ingested_file"
                    stats["exists"] += 1
                elif source_key and source_key in processed_sources:
                    status = "exists"
                    reason = "already_ingested_source"
                    stats["exists"] += 1
                else:
                    stats["pending"] += 1
            if score < 0.85:
                stats["warnings"] += 1
            candidates[chapter] = {
                "manhwa_id": manhwa_id,
                "chapter": chapter,
                "catalog": None,
                "source": _source_summary(entry),
                "external_url": None,
                "confidence": score,
                "status": status,
                "reason": reason,
            }
            _log_ingest_event(
                "chapter_detected",
                {
                    "manhwa_id": manhwa_id,
                    "chapter": chapter,
                    "status": status,
                    "source": candidates[chapter]["source"],
                },
            )
    sorted_candidates = sorted(candidates.values(), key=_chapter_sort_key)
    return sorted_candidates, stats


def _assign_links_to_chapters(chapters: list[str], links: list[dict]) -> list[tuple[str, dict | None]]:
    if not chapters:
        return []
    if not links:
        return [(chapter, None) for chapter in chapters]
    if len(links) == len(chapters):
        return list(zip(chapters, links))
    assignments: list[tuple[str, dict | None]] = []
    for chapter in chapters:
        match = next((link for link in links if chapter in link.get("url", "")), None)
        assignments.append((chapter, match))
    return assignments


def _resolve_doc_from_link(link: dict | None, index: dict[str, dict]) -> dict | None:
    if not link or link.get("kind") != "tme":
        return None
    message_id = str(link.get("message_id") or "")
    if link.get("channel_username") and message_id:
        key = f"{_normalize_channel_username(link['channel_username'])}:{message_id}"
        return index.get(key)
    if link.get("channel_internal_id") and message_id:
        key = f"c:{link['channel_internal_id']}:{message_id}"
        return index.get(key)
    return None


def _build_auto_candidates(manhwa_id: str, cache: list[dict], manhwas: list[dict]) -> tuple[list[dict], dict, dict]:
    manhwa = processor.get_manhwa_by_id(MANHWA_PATH, manhwa_id)
    existing = set(processor.get_chapter_numbers(MANHWA_PATH, manhwa_id))
    ingest_state = _load_ingest_state()
    manhwa_state = ingest_state.get("manhwas", {}).get(manhwa_id, {})
    last_scanned = manhwa_state.get("last_scanned", {})
    processed_sources = set(manhwa_state.get("processed_sources", []))
    processed_files = set(manhwa_state.get("processed_files", []))

    catalog_entries = [entry for entry in cache if _is_catalog_entry(entry)]
    if not catalog_entries:
        candidates, stats = _build_source_candidates(
            manhwa_id,
            cache,
            manhwas,
            existing,
            processed_sources,
            processed_files,
        )
        _log_ingest_event(
            "catalog_empty_fallback",
            {"manhwa_id": manhwa_id, "reason": "no_catalog_entries"},
        )
        _log_chapter_gaps(manhwa_id, candidates)
        return candidates, stats, ingest_state

    link_index = _index_documents_by_link(cache)
    source_index = _index_source_documents(cache, manhwas, manhwa_id)
    candidates: dict[str, dict] = {}
    stats = {
        "total": 0,
        "pending": 0,
        "exists": 0,
        "missing_source": 0,
        "skipped_posts": 0,
        "warnings": 0,
    }
    for entry in catalog_entries:
        channel_key = entry.get("channel_username") or str(entry.get("channel_id"))
        message_id = int(entry.get("message_id") or 0)
        expected_source = _catalog_source_map().get(
            _normalize_channel_username(entry.get("channel_username") or entry.get("channel_title"))
        )
        if channel_key and message_id and int(last_scanned.get(channel_key, 0)) >= message_id:
            continue
        text = entry.get("text") or entry.get("caption") or ""
        matched_id, score = match_manhwa_fuzzy(text, manhwas)
        if matched_id != manhwa_id:
            stats["skipped_posts"] += 1
            _log_ingest_event(
                "catalog_skip",
                {
                    "channel": entry.get("channel_username") or entry.get("channel_title"),
                    "message_id": entry.get("message_id"),
                    "reason": "manhwa_mismatch",
                },
            )
            continue
        chapters = extract_chapter_numbers(text)
        if not chapters:
            stats["skipped_posts"] += 1
            _log_ingest_event(
                "catalog_skip",
                {
                    "channel": entry.get("channel_username") or entry.get("channel_title"),
                    "message_id": entry.get("message_id"),
                    "reason": "no_chapters_detected",
                },
            )
            continue
        links = entry.get("links", [])
        assignments = _assign_links_to_chapters(chapters, links)
        for chapter, link in assignments:
            stats["total"] += 1
            candidate = candidates.get(chapter)
            if candidate and candidate.get("confidence", 0) >= score:
                continue
            source_entry = _resolve_doc_from_link(link, link_index)
            source_score = 0.0
            if not source_entry:
                source_match = source_index.get(chapter)
                if source_match:
                    source_entry = source_match["entry"]
                    source_score = source_match.get("score", 0.0)
            if source_entry and expected_source:
                source_channel = _normalize_channel_username(source_entry.get("channel_username"))
                if source_channel and source_channel != expected_source:
                    source_entry = None
                    source_score = 0.0
            confidence = max(score, source_score)
            status = "pending"
            reason = ""
            external_url = link["url"] if link and link.get("kind") == "external" else None
            if chapter in existing:
                status = "exists"
                reason = "already_in_manhwa_json"
                stats["exists"] += 1
            elif source_entry:
                file_unique_id = source_entry.get("file_unique_id")
                source_key = _source_key(source_entry)
                if file_unique_id and file_unique_id in processed_files:
                    status = "exists"
                    reason = "already_ingested_file"
                    stats["exists"] += 1
                elif source_key and source_key in processed_sources:
                    status = "exists"
                    reason = "already_ingested_source"
                    stats["exists"] += 1
                else:
                    stats["pending"] += 1
            elif external_url:
                if f"url:{external_url}" in processed_sources:
                    status = "exists"
                    reason = "already_ingested_url"
                    stats["exists"] += 1
                else:
                    stats["pending"] += 1
            else:
                status = "missing_source"
                reason = "no_source_doc"
                stats["missing_source"] += 1
            if confidence < 0.85:
                stats["warnings"] += 1
            candidates[chapter] = {
                "manhwa_id": manhwa_id,
                "manhwa_title": manhwa.get("title") if manhwa else "",
                "chapter": chapter,
                "catalog": {
                    "channel": entry.get("channel_username") or entry.get("channel_title"),
                    "message_id": entry.get("message_id"),
                },
                "source": _source_summary(source_entry) if source_entry else None,
                "external_url": external_url,
                "confidence": confidence,
                "status": status,
                "reason": reason,
            }
            _log_ingest_event(
                "chapter_detected",
                {
                    "manhwa_id": manhwa_id,
                    "chapter": chapter,
                    "status": status,
                    "source": candidates[chapter]["source"],
                    "external_url": external_url,
                },
            )
        if channel_key and message_id:
            last_scanned[channel_key] = max(int(last_scanned.get(channel_key, 0)), message_id)

    if stats["total"] == 0:
        candidates, stats = _build_source_candidates(
            manhwa_id,
            cache,
            manhwas,
            existing,
            processed_sources,
            processed_files,
        )
        _log_ingest_event(
            "catalog_empty_fallback",
            {"manhwa_id": manhwa_id, "reason": "no_catalog_candidates"},
        )
        _log_chapter_gaps(manhwa_id, candidates)
        return candidates, stats, ingest_state

    ingest_state.setdefault("manhwas", {})
    ingest_state["manhwas"].setdefault(manhwa_id, {})
    ingest_state["manhwas"][manhwa_id]["last_scanned"] = last_scanned
    sorted_candidates = sorted(candidates.values(), key=_chapter_sort_key)
    _log_chapter_gaps(manhwa_id, sorted_candidates)
    return sorted_candidates, stats, ingest_state


def _source_key(entry: dict | None) -> str | None:
    if not entry:
        return None
    channel = _normalize_channel_username(entry.get("channel_username") or entry.get("channel"))
    if not channel and entry.get("channel_id") is not None:
        channel = str(entry.get("channel_id"))
    message_id = entry.get("message_id")
    if not channel or not message_id:
        return None
    return f"{channel}:{message_id}"


def _chapter_sort_key(candidate: dict) -> tuple[int, float, str]:
    value = candidate.get("chapter") if isinstance(candidate, dict) else str(candidate)
    try:
        number = float(str(value).replace(",", "."))
        return (0, number, str(value))
    except ValueError:
        return (1, 0.0, str(value))


def _log_chapter_gaps(manhwa_id: str, candidates: list[dict]) -> None:
    numbers: list[int] = []
    for item in candidates:
        value = item.get("chapter")
        if value is None:
            continue
        if str(value).isdigit():
            numbers.append(int(value))
    numbers = sorted(set(numbers))
    gaps = []
    for idx in range(1, len(numbers)):
        prev_num = numbers[idx - 1]
        current = numbers[idx]
        if current - prev_num > 1:
            gaps.append({"from": prev_num, "to": current})
    if gaps:
        _log_ingest_event(
            "chapter_gaps_detected",
            {"manhwa_id": manhwa_id, "gaps": gaps},
        )


def _source_summary(entry: dict | None) -> dict | None:
    if not entry:
        return None
    return {
        "channel": entry.get("channel_username") or entry.get("channel_title"),
        "channel_username": entry.get("channel_username"),
        "channel_id": entry.get("channel_id"),
        "message_id": entry.get("message_id"),
        "file_id": entry.get("file_id"),
        "file_unique_id": entry.get("file_unique_id"),
        "file_name": entry.get("file_name"),
        "file_size": entry.get("file_size"),
    }


def _format_auto_preview(candidates: list[dict], stats: dict, manhwa_title: str) -> str:
    lines = [
        f"📡 Auto Ingest Preview: {manhwa_title}",
        f"Detected: {stats.get('total', 0)}",
        f"Ready: {stats.get('pending', 0)} • Exists: {stats.get('exists', 0)} • Missing: {stats.get('missing_source', 0)}",
    ]
    if stats.get("warnings"):
        lines.append(f"Warnings: {stats.get('warnings', 0)} (low confidence)")
    lines.append("")
    preview = candidates[:15]
    for item in preview:
        status = item.get("status")
        source = item.get("source") or {}
        source_ref = ""
        if source.get("channel_username") and source.get("message_id"):
            source_ref = f" • https://t.me/{source['channel_username']}/{source['message_id']}"
        elif source.get("channel") and source.get("message_id"):
            source_ref = f" • {source['channel']}:{source['message_id']}"
        lines.append(f"- Ch {item.get('chapter')} • {status}{source_ref}")
    if len(candidates) > len(preview):
        lines.append(f"...and {len(candidates) - len(preview)} more")
    return "\n".join(lines)


async def _auto_scan_preview(message: Message, state: FSMContext, manhwa_id: str, force_rescan: bool = False) -> None:
    manhwas = processor.get_manhwa_list(MANHWA_PATH)
    manhwa = processor.get_manhwa_by_id(MANHWA_PATH, manhwa_id)
    if not manhwa:
        await message.answer("Manhwa not found.", reply_markup=main_menu_kb(get_user_lang(message.from_user.id)))
        return
    ingest_state = _load_ingest_state()
    manhwa_state = ingest_state.get("manhwas", {}).get(manhwa_id, {})
    existing_queue = manhwa_state.get("queue", [])
    if existing_queue and not force_rescan:
        candidates = existing_queue
        stats = _summarize_candidates(candidates)
    else:
        cache = _load_cache()
        candidates, stats, ingest_state = _build_auto_candidates(manhwa_id, cache, manhwas)
        ingest_state.setdefault("manhwas", {}).setdefault(manhwa_id, {})["queue"] = candidates
        ingest_state["manhwas"][manhwa_id]["updatedAt"] = datetime.utcnow().isoformat(timespec="seconds")
        _save_ingest_state(ingest_state)
    await state.set_state(IngestFlow.auto_preview)
    await message.answer(
        _format_auto_preview(candidates, stats, manhwa.get("title", manhwa_id)),
        reply_markup=_inline_buttons(
            [
                [{"text": "✅ Confirm Auto Ingest", "callback_data": "ingest:auto:confirm"}],
                [{"text": "🔄 Rescan", "callback_data": "ingest:auto:rescan"}],
            ],
            back_data="ingest:auto:back",
            lang=get_user_lang(message.from_user.id),
        ),
    )


def _summarize_candidates(candidates: list[dict]) -> dict:
    stats = {"total": len(candidates), "pending": 0, "exists": 0, "missing_source": 0, "warnings": 0}
    for item in candidates:
        status = item.get("status")
        if status == "pending":
            stats["pending"] += 1
        elif status == "exists":
            stats["exists"] += 1
        elif status == "missing_source":
            stats["missing_source"] += 1
        if (item.get("confidence") or 1) < 0.85:
            stats["warnings"] += 1
    return stats


async def _run_auto_ingest(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    manhwa_id = data.get("manhwa_id")
    if not manhwa_id:
        await message.answer("No manhwa selected.", reply_markup=main_menu_kb(get_user_lang(message.from_user.id)))
        return
    ingest_state = _load_ingest_state()
    manhwa_state = ingest_state.get("manhwas", {}).get(manhwa_id, {})
    queue = manhwa_state.get("queue", [])
    pending = [item for item in queue if item.get("status") == "pending"]
    if not pending:
        await message.answer("No pending chapters to ingest.", reply_markup=main_menu_kb(get_user_lang(message.from_user.id)))
        return

    progress_message = await message.answer(f"Starting auto ingest: {len(pending)} chapters")
    semaphore = asyncio.Semaphore(2)
    progress_lock = asyncio.Lock()
    completed = {"count": 0, "success": 0}
    deploy_batch = 5

    async def _process(candidate: dict) -> None:
        async with semaphore:
            try:
                local_path = await _fetch_candidate_file(message, candidate)
                settings = processor.load_settings(SETTINGS_PATH)
                result = await asyncio.to_thread(
                    processor.process_upload,
                    manhwa_id,
                    candidate["chapter"],
                    local_path,
                    MANHWA_PATH,
                    PUBLIC_DIR,
                    settings,
                    False,
                    None,
                    None,
                    False,
                    "page-",
                    3,
                )
                _write_chapter_manifest(manhwa_id, candidate["chapter"], result["pages"], candidate)
                candidate["status"] = "ingested"
                candidate["pages_count"] = result["pages_count"]
                _mark_ingested_source(candidate)
                completed["success"] += 1
                _log_ingest_event(
                    "chapter_ingested",
                    {"manhwa_id": manhwa_id, "chapter": candidate["chapter"], "pages": result["pages_count"]},
                )
                if local_path.exists():
                    local_path.unlink()
                if completed["success"] % deploy_batch == 0:
                    await asyncio.to_thread(processor.trigger_deploy)
            except Exception as exc:  # noqa: BLE001
                candidate["status"] = "failed"
                candidate["reason"] = str(exc)
                _log_ingest_event(
                    "chapter_failed",
                    {"manhwa_id": manhwa_id, "chapter": candidate.get("chapter"), "error": str(exc)},
                )
            finally:
                completed["count"] += 1
                _update_ingest_queue(manhwa_id, queue)
                async with progress_lock:
                    await progress_message.edit_text(
                        f"Auto ingest {completed['count']}/{len(pending)} • Success {completed['success']}"
                    )

    await asyncio.gather(*[_process(item) for item in pending])
    await asyncio.to_thread(processor.trigger_deploy)
    await progress_message.edit_text(
        f"Auto ingest complete. Success {completed['success']}/{len(pending)}"
    )
    await state.set_state(IngestFlow.auto_manhwa)


def _update_ingest_queue(manhwa_id: str, queue: list[dict]) -> None:
    ingest_state = _load_ingest_state()
    ingest_state.setdefault("manhwas", {}).setdefault(manhwa_id, {})["queue"] = queue
    ingest_state["manhwas"][manhwa_id]["updatedAt"] = datetime.utcnow().isoformat(timespec="seconds")
    _save_ingest_state(ingest_state)


async def _fetch_candidate_file(message: Message, candidate: dict) -> Path:
    source = candidate.get("source") or {}
    if source.get("file_id"):
        file_size = source.get("file_size") or 0
        if file_size > TELEGRAM_SAFE_FILE_BYTES:
            raise ValueError("Telegram file too large; use external URL.")
        file = await message.bot.get_file(source["file_id"])
        filename = source.get("file_name") or f"{candidate['manhwa_id']}_{candidate['chapter']}.pdf"
        local_path = UPLOADS_DIR / filename
        UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
        await message.bot.download_file(file.file_path, destination=local_path)
        return local_path
    if candidate.get("external_url"):
        return await asyncio.to_thread(_download_external_file, candidate["external_url"], UPLOADS_DIR)
    raise ValueError("No source file available.")


def _download_external_file(url: str, dest_dir: Path) -> Path:
    dest_dir.mkdir(parents=True, exist_ok=True)
    filename = Path(urlparse(url).path).name or "upload.pdf"
    filename = Path(filename).name
    target = dest_dir / filename
    request = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(request, timeout=60) as response:  # noqa: S310
        with target.open("wb") as handle:
            shutil.copyfileobj(response, handle, length=1024 * 1024)
    return target


def _safe_chapter_filename(chapter: str) -> str:
    return re.sub(r"[^0-9a-zA-Z._-]+", "_", str(chapter))


def _write_chapter_manifest(manhwa_id: str, chapter: str, pages: list[str], candidate: dict) -> None:
    chapter_dir = PUBLIC_DIR / "manhwa" / manhwa_id / "chapters"
    chapter_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "id": f"{manhwa_id}-chapter-{chapter}",
        "number": str(chapter),
        "pages": pages,
        "updatedAt": datetime.utcnow().isoformat(timespec="seconds"),
        "source": candidate.get("source") or {"external_url": candidate.get("external_url")},
    }
    with (chapter_dir / f"{_safe_chapter_filename(chapter)}.json").open("w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)


def _mark_ingested_source(candidate: dict) -> None:
    ingest_state = _load_ingest_state()
    manhwa_id = candidate.get("manhwa_id")
    if not manhwa_id:
        return
    manhwa_state = ingest_state.setdefault("manhwas", {}).setdefault(manhwa_id, {})
    processed_sources = set(manhwa_state.get("processed_sources", []))
    processed_files = set(manhwa_state.get("processed_files", []))
    source = candidate.get("source") or {}
    source_key = _source_key(source)
    if source_key:
        processed_sources.add(source_key)
    if candidate.get("external_url"):
        processed_sources.add(f"url:{candidate['external_url']}")
    file_unique_id = source.get("file_unique_id")
    if file_unique_id:
        processed_files.add(file_unique_id)
        _mark_ingested(file_unique_id)
    last_ingested = manhwa_state.get("last_ingested_chapter")
    try:
        current_value = float(str(candidate.get("chapter")).replace(",", "."))
        previous_value = float(str(last_ingested).replace(",", ".")) if last_ingested else None
        if previous_value is None or current_value > previous_value:
            manhwa_state["last_ingested_chapter"] = candidate.get("chapter")
    except ValueError:
        if not last_ingested:
            manhwa_state["last_ingested_chapter"] = candidate.get("chapter")
    manhwa_state["processed_sources"] = sorted(processed_sources)
    manhwa_state["processed_files"] = sorted(processed_files)
    _save_ingest_state(ingest_state)


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
    if not manhwas:
        lang = get_user_lang(message.from_user.id)
        await message.answer(
            t("no_manhwa", lang),
            reply_markup=inline_cancel_back_kb(back_data="ingest:back:channel", lang=lang),
        )
        return
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
        await state.update_data(ingest_manhwa_map=_build_id_map(manhwas))
        await message.answer(
            "Select manhwa for this file:",
            reply_markup=inline_manhwa_kb(
                manhwas,
                lang=get_user_lang(message.from_user.id),
                callback_prefix="ingest:manhwa:",
                use_index=True,
                page=0,
                nav_prefix="ingest:manhwa:page:",
            ),
        )


async def _advance_queue(message: Message, state: FSMContext, pages_count: int) -> None:
    data = await state.get_data()
    index = data.get("current_index", 0)
    await message.answer(f"Ingested file {index + 1}. Pages: {pages_count}")
    await state.update_data(current_index=index + 1)
    await _start_next_ingest(message, state)


@router.message(
    StateFilter(
        IngestFlow.channel,
        IngestFlow.files,
        IngestFlow.manhwa,
        IngestFlow.chapter,
        IngestFlow.confirm,
        IngestFlow.mode,
        IngestFlow.auto_manhwa,
        IngestFlow.auto_preview,
        IngestFlow.auto_running,
    ),
    F.text & ~F.text.in_(menu_labels_all()),
)
async def ingest_invalid_message(message: Message, state: FSMContext) -> None:
    await state.clear()
    untrack(message.chat.id, message.from_user.id)
    reset_prompt(message.from_user.id)
    await message.answer("Invalid input. Returning to main menu.", reply_markup=main_menu_kb(get_user_lang(message.from_user.id)))


@router.message(
    StateFilter(
        IngestFlow.channel,
        IngestFlow.files,
        IngestFlow.manhwa,
        IngestFlow.chapter,
        IngestFlow.confirm,
        IngestFlow.mode,
        IngestFlow.auto_manhwa,
        IngestFlow.auto_preview,
        IngestFlow.auto_running,
    ),
    ~F.text,
)
async def ingest_invalid_non_text(message: Message, state: FSMContext) -> None:
    await state.clear()
    untrack(message.chat.id, message.from_user.id)
    reset_prompt(message.from_user.id)
    await message.answer("Invalid input. Returning to main menu.", reply_markup=main_menu_kb(get_user_lang(message.from_user.id)))


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

