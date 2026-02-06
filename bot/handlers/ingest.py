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
    DATA_DIR,
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
    AUTO_INGEST_ALLOWED_EXTENSIONS,
    AUTO_INGEST_IMAGE_EXTENSIONS,
    AUTO_INGEST_SANITY_MULTIPLIER,
    AUTO_INGEST_CHANNEL_DEFAULT_MIN_COUNT,
    AUTO_INGEST_CHANNEL_DEFAULT_MIN_SCORE,
)
from ..i18n import button_label, ensure_access, get_user_lang, menu_labels, menu_labels_all, t
from ..keyboards import inline_cancel_back_kb, inline_chapter_kb, inline_manhwa_kb, main_menu_kb
from ..flow_registry import untrack
from ..prompt_guard import reset_prompt
from ..roles import can_upload
from server import processor
from server.ingest_parser import extract_chapter_numbers, guess_from_filename, match_manhwa_fuzzy

router = Router()
BACKFILL_LOG_PATH = DATA_DIR / "backfill_history.log"
_CHANNEL_CACHE_MEMORY: list[dict] = []
_CHANNEL_CACHE_LOADED = False
STRICT_CHAPTER_KEYWORDS = (
    "bob",
    "qism",
    "qisim",
    "qsm",
    "part",
    "ch",
    "chapter",
    "глава",
    "гл",
    "часть",
)
EXCLUDED_POST_KEYWORDS = {
    "cover",
    "edit",
    "rating",
    "announcement",
    "reaksiya",
    "preview",
    "info",
    "poll",
}
CHAPTER_SOURCE_CONFIDENCE = {"hashtag": 1.0, "caption": 0.75, "filename": 0.4}
HASHTAG_CHAPTER_PATTERNS = [
    re.compile(r"^(?P<num>\d+(?:[.,]\d+)?)(?:[-_]?)(?P<kw>bob|qism|qisim|qsm)$", re.IGNORECASE),
    re.compile(r"^(?P<kw>bob|qism|qisim|qsm)(?:[-_]?)(?P<num>\d+(?:[.,]\d+)?)$", re.IGNORECASE),
    re.compile(r"^(?:chapter|ch)(?:[-_]?)(?P<num>\d+(?:[.,]\d+)?)$", re.IGNORECASE),
]
HASHTAG_TRAILING_NUMBER_PATTERN = re.compile(
    r"^(?P<prefix>[a-z][\w\-]{2,})[-_]*(?P<num>\d+(?:[.,]\d+)?)$",
    re.IGNORECASE,
)
AUTO_INGEST_PARSER_VERSION = "plan-b-v4-multi-source"
AUTO_INGEST_DOCUMENT_EXTENSIONS = {".pdf", ".zip", ".rar", ".cbz"}


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
    if not file_name.lower().endswith((".pdf", ".zip", ".rar", ".cbz", ".jpg", ".jpeg", ".png")):
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


def _load_cache_from_disk() -> list[dict]:
    if not CHANNEL_CACHE_PATH.exists():
        _log_auto_preview_trace("cache_missing", {"path": str(CHANNEL_CACHE_PATH)})
        return []
    with CHANNEL_CACHE_PATH.open("r", encoding="utf-8") as file:
        try:
            data = json.load(file)
        except json.JSONDecodeError:
            logging.warning("Channel cache JSON is invalid; treating as empty")
            _log_auto_preview_trace("cache_invalid_json", {"path": str(CHANNEL_CACHE_PATH)})
            return []
    if isinstance(data, list):
        _log_auto_preview_trace("cache_loaded", {"path": str(CHANNEL_CACHE_PATH), "count": len(data)})
        return data
    _log_auto_preview_trace("cache_invalid_shape", {"path": str(CHANNEL_CACHE_PATH)})
    return []


def _hydrate_cache_memory(force: bool = False, data: list[dict] | None = None) -> list[dict]:
    global _CHANNEL_CACHE_MEMORY, _CHANNEL_CACHE_LOADED
    if _CHANNEL_CACHE_LOADED and not force and data is None:
        if _CHANNEL_CACHE_MEMORY:
            _log_auto_preview_trace("cache_memory_hit", {"count": len(_CHANNEL_CACHE_MEMORY)})
            return _CHANNEL_CACHE_MEMORY
        # Memory is empty but marked loaded; re-sync from disk.
        _log_auto_preview_trace("cache_memory_empty_resync", {"count": 0})
        data = _load_cache_from_disk()
    if data is None:
        data = _load_cache_from_disk()
    _CHANNEL_CACHE_MEMORY = data
    _CHANNEL_CACHE_LOADED = True
    _log_auto_preview_trace("cache_memory_set", {"count": len(_CHANNEL_CACHE_MEMORY), "forced": force})
    return _CHANNEL_CACHE_MEMORY


def _load_cache() -> list[dict]:
    return _hydrate_cache_memory()


def _reset_channel_cache_memory() -> None:
    global _CHANNEL_CACHE_MEMORY, _CHANNEL_CACHE_LOADED
    _CHANNEL_CACHE_MEMORY = []
    _CHANNEL_CACHE_LOADED = False


def hydrate_channel_cache_from_disk() -> tuple[list[dict], int]:
    disk_cache = _load_cache_from_disk()
    memory_cache = _hydrate_cache_memory(force=True, data=disk_cache)
    return memory_cache, len(disk_cache)


def _iter_backfill_events() -> list[dict]:
    if not BACKFILL_LOG_PATH.exists():
        _log_auto_preview_trace("backfill_missing", {"path": str(BACKFILL_LOG_PATH)})
        return []
    events: list[dict] = []
    with BACKFILL_LOG_PATH.open("r", encoding="utf-8") as file:
        for line in file:
            line = line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(payload, dict):
                events.append(payload)
    _log_auto_preview_trace("backfill_loaded", {"path": str(BACKFILL_LOG_PATH), "count": len(events)})
    return events


def _load_backfill_channel_map() -> dict[str, dict]:
    channel_map: dict[str, dict] = {}
    for payload in _iter_backfill_events():
        if payload.get("event") != "confidence_used":
            continue
        details = payload.get("details") or {}
        channel = _normalize_channel_username(details.get("channel") or "")
        manhwa_id = details.get("manhwa_id")
        if not channel or not manhwa_id:
            continue
        try:
            score = float(details.get("score") or 0)
        except (TypeError, ValueError):
            score = 0.0
        entry = channel_map.get(channel)
        if not entry:
            channel_map[channel] = {"manhwa_id": manhwa_id, "score": score, "count": 1}
            continue
        if entry.get("manhwa_id") == manhwa_id:
            entry["count"] = entry.get("count", 0) + 1
            entry["score"] = max(entry.get("score", 0.0), score)
            continue
        if score > entry.get("score", 0.0):
            channel_map[channel] = {"manhwa_id": manhwa_id, "score": score, "count": 1}
    return channel_map


def _build_backfill_candidates(manhwa_id: str, existing: set[str]) -> list[dict]:
    candidates: dict[str, dict] = {}
    for payload in _iter_backfill_events():
        if payload.get("event") != "chapter_detected":
            continue
        details = payload.get("details") or {}
        if details.get("manhwa_id") != manhwa_id:
            continue
        chapter = str(details.get("chapter") or "").strip()
        chapter_key = _normalize_chapter_key(chapter)
        if not chapter_key or chapter_key in candidates:
            continue
        status = "exists" if chapter_key in existing else "missing_source"
        reason = "already_in_manhwa_json" if status == "exists" else "backfill_only"
        candidates[chapter_key] = {
            "manhwa_id": manhwa_id,
            "chapter": chapter_key,
            "catalog": None,
            "source": None,
            "external_url": None,
            "confidence": 0.9,
            "status": status,
            "reason": reason,
            "manhwa_source": details.get("manhwa_source") or "backfill",
            "chapter_source": details.get("chapter_source") or "backfill",
        }
    results = sorted(candidates.values(), key=_chapter_sort_key)
    _log_auto_preview_trace("backfill_candidates_built", {"manhwa_id": manhwa_id, "count": len(results)})
    return results


def _merge_backfill_candidates(
    manhwa_id: str, candidates: list[dict], existing: set[str] | None = None
) -> tuple[list[dict], bool]:
    existing = existing or set()
    backfill_candidates = _build_backfill_candidates(manhwa_id, existing)
    if not backfill_candidates:
        _log_auto_preview_trace("backfill_merge_skipped", {"manhwa_id": manhwa_id, "reason": "no_backfill"})
        return candidates, False
    backfill_map = {
        _normalize_chapter_key(item.get("chapter")): item for item in backfill_candidates if item.get("chapter")
    }
    changed = False
    merged = list(candidates)
    for candidate in candidates:
        chapter_key = _normalize_chapter_key(candidate.get("chapter"))
        backfill = backfill_map.get(chapter_key)
        if not backfill:
            continue
        if not candidate.get("manhwa_source"):
            candidate["manhwa_source"] = backfill.get("manhwa_source")
            changed = True
        if not candidate.get("chapter_source"):
            candidate["chapter_source"] = backfill.get("chapter_source")
            changed = True
        backfill_map.pop(chapter_key, None)
    if backfill_map:
        merged.extend(backfill_map.values())
        changed = True
    merged_sorted = sorted(merged, key=_chapter_sort_key)
    _log_auto_preview_trace(
        "backfill_merge_complete",
        {"manhwa_id": manhwa_id, "added": len(backfill_map), "total": len(merged_sorted)},
    )
    return merged_sorted, changed


def _normalize_disk_source(source: dict | None) -> tuple[dict | None, str | None]:
    if not source or not isinstance(source, dict):
        return None, None
    normalized = dict(source)
    external_url = normalized.get("external_url") or normalized.get("url")
    channel_value = normalized.get("channel") or ""
    if channel_value and not normalized.get("channel_username"):
        normalized["channel_username"] = _normalize_channel_username(str(channel_value))
    if normalized.get("channel_username") and not normalized.get("channel"):
        normalized["channel"] = normalized.get("channel_username")
    if not normalized and not external_url:
        return None, None
    return normalized, external_url


def _disk_candidate_confidence(chapter_source: str, has_pages: bool) -> float:
    confidence = _chapter_confidence(chapter_source)
    if confidence > 0:
        return confidence
    return 0.95 if has_pages else 0.4


def _build_disk_candidates(manhwa_id: str, existing: set[str]) -> list[dict]:
    chapter_dir = PUBLIC_DIR / "manhwa" / manhwa_id / "chapters"
    if not chapter_dir.exists():
        _log_auto_preview_trace("disk_candidates_skipped", {"manhwa_id": manhwa_id, "reason": "dir_missing"})
        return []
    candidates: dict[str, dict] = {}
    for manifest_path in sorted(chapter_dir.glob("*.json")):
        try:
            with manifest_path.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
        except json.JSONDecodeError:
            logging.warning("Invalid chapter manifest JSON at %s", manifest_path)
            continue
        except Exception:  # noqa: BLE001
            logging.exception("Failed to read chapter manifest at %s", manifest_path)
            continue
        if not isinstance(payload, dict):
            continue
        chapter_raw = payload.get("number") or payload.get("chapter") or payload.get("id") or manifest_path.stem
        chapter = _normalize_chapter_key(str(chapter_raw).strip())
        if not chapter:
            continue
        pages = payload.get("pages") or []
        if not isinstance(pages, list):
            pages = []
        pages = [str(page) for page in pages if str(page).strip()]
        source_meta = payload.get("source") if isinstance(payload.get("source"), dict) else {}
        source, external_url = _normalize_disk_source(source_meta)
        has_pages = bool(pages)
        if chapter in existing:
            status = "exists"
            reason = "already_in_manhwa_json"
        else:
            status = "pending" if has_pages else "missing_source"
            reason = "disk_manifest" if has_pages else "disk_manifest_missing_pages"
        chapter_source = (source_meta.get("chapter_source") if isinstance(source_meta, dict) else None) or "disk"
        manhwa_source = (source_meta.get("manhwa_source") if isinstance(source_meta, dict) else None) or "disk"
        candidates[chapter] = {
            "manhwa_id": manhwa_id,
            "chapter": chapter,
            "catalog": None,
            "source": source,
            "external_url": external_url,
            "confidence": _disk_candidate_confidence(chapter_source, has_pages),
            "status": status,
            "reason": reason,
            "manhwa_source": manhwa_source,
            "chapter_source": chapter_source,
            "disk_manifest": True,
            "pages": pages,
            "pages_count": len(pages),
        }
    results = sorted(candidates.values(), key=_chapter_sort_key)
    _log_auto_preview_trace("disk_candidates_built", {"manhwa_id": manhwa_id, "count": len(results)})
    return results


def _entry_text_blob(entry: dict) -> str:
    return f"{entry.get('caption', '')} {entry.get('text', '')} {entry.get('file_name', '')}".lower()


def _has_excluded_keywords(text: str) -> bool:
    return any(keyword in text for keyword in EXCLUDED_POST_KEYWORDS)


def _invalid_source_reason(entry: dict) -> str | None:
    media_kind = entry.get("media_kind")
    if media_kind and media_kind not in {"document", "photo"}:
        return "non_document"
    if entry.get("type", "document") != "document":
        return "non_document"
    file_name = entry.get("file_name") or ""
    if file_name.lower().startswith("photo_") and media_kind != "photo":
        return "non_document"
    ext = Path(file_name).suffix.lower()
    if ext not in AUTO_INGEST_ALLOWED_EXTENSIONS:
        return "unsupported_file_type"
    if _has_excluded_keywords(_entry_text_blob(entry)):
        return "excluded_keyword"
    return None


def _is_document_capable_entry(entry: dict) -> bool:
    if entry.get("type", "document") != "document":
        return False
    media_kind = entry.get("media_kind")
    if media_kind and media_kind not in {"document", "photo"}:
        return False
    file_name = entry.get("file_name") or ""
    if not file_name:
        return False
    ext = Path(file_name).suffix.lower()
    if media_kind == "photo":
        return ext in AUTO_INGEST_IMAGE_EXTENSIONS
    if file_name.lower().startswith("photo_"):
        return False
    return ext in AUTO_INGEST_DOCUMENT_EXTENSIONS or ext in AUTO_INGEST_IMAGE_EXTENSIONS


def _is_matchable_cache_entry(entry: dict) -> bool:
    if entry.get("is_cover") is True:
        return False
    if entry.get("is_video") is True:
        return False
    mime_type = entry.get("mime_type") or ""
    if isinstance(mime_type, str) and mime_type.lower().startswith("video"):
        return False
    if not _is_document_capable_entry(entry):
        return False
    if not entry.get("file_name") and not entry.get("file_id"):
        return False
    if not entry.get("message_id"):
        return False
    return True


def _is_valid_source_entry(entry: dict) -> bool:
    return _invalid_source_reason(entry) is None


def _strip_hashtags(text: str) -> str:
    if not text:
        return ""
    return re.sub(r"#\S+", " ", text)


def _normalize_chapter_text(value: str) -> str:
    value = value or ""
    value = value.lower()
    value = re.sub(r"https?://\S+", " ", value)
    value = re.sub(r"[@#]\S+", " ", value)
    value = re.sub(r"[\[\]\(\)\{\}_]+", " ", value)
    value = re.sub(r"[^\w\s\-\.,]", " ", value, flags=re.UNICODE)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def _remove_ranges(value: str) -> str:
    return re.sub(r"\d+(?:[.,]\d+)?\s*[-–—]\s*\d+(?:[.,]\d+)?", " ", value)


def _extract_chapter_numbers_strict(text: str, allow_number_only: bool) -> list[str]:
    if not text:
        return []
    results: list[str] = []
    for value in re.findall(r"[\(\[\{]\s*(\d+(?:[.,]\d+)?)\s*[\)\]\}]", text):
        results.append(value.replace(",", ".").strip())
    normalized = _normalize_chapter_text(text)
    normalized = _remove_ranges(normalized)
    keyword = r"(?:" + "|".join(STRICT_CHAPTER_KEYWORDS) + r")"
    patterns = [
        rf"{keyword}\s*[:#_\-]*\s*(\d+(?:[.,]\d+)?)",
        rf"#?(\d+(?:[.,]\d+)?)\s*[_\-]*\s*{keyword}",
    ]
    for pattern in patterns:
        for value in re.findall(pattern, normalized):
            results.append(value.replace(",", ".").strip())
    if results:
        return _dedupe_chapters(results)
    if allow_number_only:
        if re.search(r"[a-zа-я]", normalized):
            return []
        numbers = [value.replace(",", ".").strip() for value in re.findall(r"\d+(?:[.,]\d+)?", normalized)]
        return _dedupe_chapters(numbers)
    return []


def _save_cache(data: list[dict]) -> None:
    CHANNEL_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with CHANNEL_CACHE_PATH.open("w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)
    _hydrate_cache_memory(force=True, data=data)


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
    media_kind = "post"
    if message.document:
        media_kind = "document"
    elif message.photo:
        media_kind = "photo"
    entry: dict = {
        "type": entry_type,
        "media_kind": media_kind,
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
        return {"manhwas": {}, "channels": {}}
    with INGEST_STATE_PATH.open("r", encoding="utf-8") as file:
        try:
            data = json.load(file)
        except json.JSONDecodeError:
            return {"manhwas": {}, "channels": {}}
    if not isinstance(data, dict):
        return {"manhwas": {}, "channels": {}}
    data.setdefault("manhwas", {})
    data.setdefault("channels", {})
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


def _log_auto_preview_trace(stage: str, details: dict | None = None) -> None:
    payload = {"stage": stage}
    if details:
        payload.update(details)
    _log_ingest_event("auto_preview_trace", payload)


def _log_chapter_decision(
    entry: dict | None,
    chapter: str | None,
    chapter_source: str,
    manhwa_source: str,
    confidence_score: float,
    status: str | None = None,
    ignored_reason: str | None = None,
    detail: str | None = None,
) -> None:
    payload = {
        "chapter": chapter,
        "chapter_source": chapter_source,
        "manhwa_source": manhwa_source,
        "confidence_score": confidence_score,
        "ignored_reason": ignored_reason,
        "status": status,
    }
    if entry:
        payload.update(
            {
                "channel": entry.get("channel_username") or entry.get("channel_title") or entry.get("channel"),
                "channel_username": entry.get("channel_username"),
                "channel_id": entry.get("channel_id"),
                "message_id": entry.get("message_id"),
                "file_name": entry.get("file_name"),
            }
        )
    if detail:
        payload["detail"] = detail
    _log_ingest_event("chapter_decision", payload)


def _log_auto_ingest_debug(
    stage: str,
    entry: dict,
    extracted_hashtags: list[str] | None = None,
    extracted_chapter_numbers: list[str] | None = None,
    detected_manhwa: str | None = None,
    manhwa_source: str | None = None,
    chapter_source: str | None = None,
    rejection_reason: str | None = None,
) -> None:
    file_name = entry.get("file_name") or ""
    payload = {
        "stage": stage,
        "message_id": entry.get("message_id"),
        "has_document": (entry.get("media_kind") == "document") or (entry.get("type") == "document"),
        "document_ext": Path(file_name).suffix.lower(),
        "extracted_hashtags": extracted_hashtags or [],
        "extracted_chapter_numbers": extracted_chapter_numbers or [],
        "detected_manhwa": detected_manhwa,
        "manhwa_source": manhwa_source,
        "chapter_source": chapter_source,
        "rejection_reason": rejection_reason,
    }
    _log_ingest_event("auto_ingest_debug", payload)


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


def _build_source_match_index(
    entries: list[dict],
    manhwas: list[dict],
    manhwa_id: str,
    channel_defaults: dict[str, dict] | None = None,
) -> dict[str, dict]:
    index: dict[str, dict] = {}
    for entry in entries:
        if _invalid_source_reason(entry):
            continue
        manhwa_match, manhwa_score, manhwa_source = _resolve_manhwa_for_source_match(
            entry, manhwas, channel_defaults
        )
        if manhwa_match != manhwa_id:
            continue
        chapter_sources = _entry_chapter_sources(entry)
        if not chapter_sources:
            continue
        for chapter, sources in chapter_sources.items():
            rank = _source_match_rank(entry, sources, manhwa_score)
            existing = index.get(chapter)
            if not existing or rank > existing.get("rank", ()):
                index[chapter] = {
                    "entry": entry,
                    "rank": rank,
                    "manhwa_source": manhwa_source,
                    "chapter_source": _primary_chapter_source(sources),
                }
    return index


def _match_candidates_to_sources(
    manhwa_id: str,
    candidates: list[dict],
    cached_documents: list[dict],
    manhwas: list[dict],
    processed_sources: set[str],
    processed_files: set[str],
    channel_defaults: dict[str, dict] | None = None,
) -> list[dict]:
    if not candidates or not cached_documents:
        return candidates
    index = _build_source_match_index(cached_documents, manhwas, manhwa_id, channel_defaults)
    if not index:
        return candidates
    for candidate in candidates:
        if candidate.get("status") == "exists":
            continue
        if candidate.get("disk_manifest"):
            continue
        if candidate.get("source") or candidate.get("external_url"):
            continue
        chapter_key = _normalize_chapter_key(candidate.get("chapter"))
        if not chapter_key:
            continue
        match = index.get(chapter_key)
        if not match:
            continue
        entry = match["entry"]
        candidate["source"] = _source_summary(entry)
        if not candidate.get("manhwa_source") and match.get("manhwa_source"):
            candidate["manhwa_source"] = match["manhwa_source"]
        if not candidate.get("chapter_source") and match.get("chapter_source"):
            candidate["chapter_source"] = match["chapter_source"]
        file_unique_id = entry.get("file_unique_id")
        source_key = _source_key(entry)
        if file_unique_id and file_unique_id in processed_files:
            candidate["status"] = "exists"
            candidate["reason"] = "already_ingested_file"
        elif source_key and source_key in processed_sources:
            candidate["status"] = "exists"
            candidate["reason"] = "already_ingested_source"
        else:
            candidate["status"] = "ready"
            candidate["reason"] = "source_matched"
    return candidates


def _cache_entry_match_sources(
    entry: dict,
    chapter_key: str,
    manhwa_id: str,
    manhwas: list[dict],
) -> tuple[bool, set[str], float]:
    if not chapter_key:
        return False, set(), 0.0
    info = _extract_chapter_debug_info(entry)
    filename_chapters = _normalized_chapter_set(info.get("filename_chapters") or [])
    caption_chapters = _normalized_chapter_set(info.get("caption_chapters") or [])
    hashtag_chapters = _normalized_chapter_set(info.get("hashtag_chapters") or [])

    filename_match = chapter_key in filename_chapters
    caption_match = chapter_key in caption_chapters or chapter_key in hashtag_chapters

    manhwa_score = 0.0
    hashtag_manhwa_match = False
    if chapter_key in hashtag_chapters:
        hashtags_text = _hashtag_text_from_entry(entry)
        manhwa_match, score = _resolve_manhwa_from_hashtags(hashtags_text, manhwas)
        if manhwa_match == manhwa_id:
            hashtag_manhwa_match = True
            manhwa_score = score

    if not (filename_match or caption_match or hashtag_manhwa_match):
        return False, set(), 0.0

    sources: set[str] = set()
    if filename_match:
        sources.add("filename")
    if caption_match:
        sources.add("caption")
    if hashtag_manhwa_match:
        sources.add("hashtag")
    return True, sources, manhwa_score


def _apply_cache_source_matches(
    manhwa_id: str,
    candidates: list[dict],
    cache_entries: list[dict],
    manhwas: list[dict],
    processed_sources: set[str],
    processed_files: set[str],
) -> list[dict]:
    if not candidates or not cache_entries:
        return candidates
    matchable_entries = [entry for entry in cache_entries if _is_matchable_cache_entry(entry)]
    if not matchable_entries:
        return candidates
    for candidate in candidates:
        if candidate.get("status") == "exists":
            continue
        if candidate.get("disk_manifest"):
            continue
        if candidate.get("source") or candidate.get("external_url"):
            continue
        chapter_key = _normalize_chapter_key(candidate.get("chapter"))
        if not chapter_key:
            continue
        best_entry: dict | None = None
        best_rank: tuple[int, int, float, int] | None = None
        for entry in matchable_entries:
            matched, sources, manhwa_score = _cache_entry_match_sources(entry, chapter_key, manhwa_id, manhwas)
            if not matched:
                continue
            rank = _source_match_rank(entry, sources, manhwa_score)
            if best_rank is None or rank > best_rank:
                best_entry = entry
                best_rank = rank
        if not best_entry:
            continue
        candidate["source"] = _source_summary(best_entry)
        candidate["source_ref"] = {
            "message_id": best_entry.get("message_id"),
            "file_id": best_entry.get("file_id"),
            "path": best_entry.get("path"),
        }
        file_unique_id = best_entry.get("file_unique_id")
        source_key = _source_key(best_entry)
        if file_unique_id and file_unique_id in processed_files:
            candidate["status"] = "exists"
            candidate["reason"] = "already_ingested_file"
        elif source_key and source_key in processed_sources:
            candidate["status"] = "exists"
            candidate["reason"] = "already_ingested_source"
        else:
            candidate["status"] = "ready"
            candidate["reason"] = "cache_matched"
    return candidates


def _bind_sources_to_candidates(
    manhwa_id: str,
    candidates: list[dict],
    cache_entries: list[dict],
    manhwas: list[dict],
    processed_sources: set[str],
    processed_files: set[str],
) -> tuple[list[dict], dict]:
    if not candidates or not cache_entries:
        return candidates, {"total": len(candidates), "matched": 0, "unmatched": len(candidates)}

    entry_index: dict[str, dict] = {}
    for entry in cache_entries:
        source_key = _source_key(entry)
        if source_key and source_key not in entry_index:
            entry_index[source_key] = entry

    prepared: list[dict] = []
    for entry in cache_entries:
        allowed, reason = _entry_allowed_for_binding(entry)
        if not allowed:
            _log_ingest_event(
                "auto_preview_source_rejected",
                {
                    "manhwa_id": manhwa_id,
                    "message_id": entry.get("message_id"),
                    "file_name": entry.get("file_name"),
                    "channel": entry.get("channel_username") or entry.get("channel_id"),
                    "reason": reason,
                },
            )
            continue
        normalized_entry = _normalized_entry_digits(entry)
        identity_ok, identity_reason = _entry_matches_manhwa_identity(normalized_entry, manhwa_id, manhwas)
        if not identity_ok:
            _log_ingest_event(
                "auto_preview_source_rejected",
                {
                    "manhwa_id": manhwa_id,
                    "message_id": entry.get("message_id"),
                    "file_name": entry.get("file_name"),
                    "channel": entry.get("channel_username") or entry.get("channel_id"),
                    "reason": identity_reason,
                },
            )
            continue
        sources_by_chapter = _entry_chapter_sources(normalized_entry)
        if not sources_by_chapter:
            _log_ingest_event(
                "auto_preview_source_rejected",
                {
                    "manhwa_id": manhwa_id,
                    "message_id": entry.get("message_id"),
                    "file_name": entry.get("file_name"),
                    "channel": entry.get("channel_username") or entry.get("channel_id"),
                    "reason": "chapter_not_found",
                },
            )
            continue
        info = _extract_chapter_debug_info(normalized_entry)
        prepared.append(
            {
                "entry": entry,
                "sources_by_chapter": sources_by_chapter,
                "hashtag_chapters": _normalized_chapter_set(info.get("hashtag_chapters") or []),
            }
        )
    if not prepared:
        return candidates, {"total": len(candidates), "matched": 0, "unmatched": len(candidates)}

    matched_count = 0
    for candidate in candidates:
        if candidate.get("status") == "exists":
            continue
        if candidate.get("disk_manifest"):
            continue
        if candidate.get("external_url"):
            continue
        chapter_key = _normalize_chapter_key(candidate.get("chapter"))
        if not chapter_key:
            continue

        existing_source = candidate.get("source") or {}
        if existing_source:
            entry = entry_index.get(_source_key(existing_source) or "")
            if not entry:
                candidate.pop("source", None)
                candidate.pop("source_ref", None)
                candidate.pop("source_type", None)
                candidate["status"] = "missing_source"
                candidate["reason"] = "source_not_in_cache"
                _log_ingest_event(
                    "auto_preview_source_unbound",
                    {
                        "manhwa_id": manhwa_id,
                        "chapter": chapter_key,
                        "reason": "source_not_in_cache",
                    },
                )
            else:
                normalized_entry = _normalized_entry_digits(entry)
                identity_ok, _ = _entry_matches_manhwa_identity(normalized_entry, manhwa_id, manhwas)
                allowed, _ = _entry_allowed_for_binding(entry)
                sources = _entry_chapter_sources(normalized_entry).get(chapter_key, set())
                sources = {source for source in sources if source in {"filename", "caption", "hashtag"}}
                if not (identity_ok and allowed and sources):
                    candidate.pop("source", None)
                    candidate.pop("source_ref", None)
                    candidate.pop("source_type", None)
                    candidate["status"] = "missing_source"
                    candidate["reason"] = "source_rejected"
                    _log_ingest_event(
                        "auto_preview_source_unbound",
                        {
                            "manhwa_id": manhwa_id,
                            "chapter": chapter_key,
                            "message_id": entry.get("message_id"),
                            "file_name": entry.get("file_name"),
                            "reason": "identity_or_chapter_mismatch",
                        },
                    )
                else:
                    if not candidate.get("source_ref"):
                        candidate["source_ref"] = {
                            "message_id": entry.get("message_id"),
                            "file_id": entry.get("file_id"),
                            "file_name": entry.get("file_name"),
                            "url": _entry_message_url(entry),
                            "channel": entry.get("channel_username")
                            or entry.get("channel_title")
                            or entry.get("channel")
                            or entry.get("channel_id"),
                        }
                    if not candidate.get("source_type"):
                        candidate["source_type"] = "document"
                    continue

        best_entry: dict | None = None
        best_rank: tuple[int, int, int, int, int, float, int, int] | None = None
        best_sources: set[str] = set()
        best_primary_source = ""

        for item in prepared:
            sources = item["sources_by_chapter"].get(chapter_key, set()).copy()
            if not sources:
                continue
            sources = {source for source in sources if source in {"filename", "caption", "hashtag"}}
            if not sources:
                continue
            rank = _binding_rank(item["entry"], sources, 1.0)
            if best_rank is None or rank > best_rank:
                best_entry = item["entry"]
                best_rank = rank
                best_sources = sources
                best_primary_source = _primary_chapter_source(sources)

        if not best_entry:
            continue

        candidate["source"] = _source_summary(best_entry)
        candidate["source_ref"] = {
            "message_id": best_entry.get("message_id"),
            "file_id": best_entry.get("file_id"),
            "file_name": best_entry.get("file_name"),
            "url": _entry_message_url(best_entry),
            "channel": best_entry.get("channel_username")
            or best_entry.get("channel_title")
            or best_entry.get("channel")
            or best_entry.get("channel_id"),
        }
        candidate["source_type"] = "document"
        if best_primary_source in {"caption_relaxed", "text"}:
            best_primary_source = "caption"
        if best_primary_source:
            candidate["chapter_source"] = best_primary_source

        file_unique_id = best_entry.get("file_unique_id")
        source_key = _source_key(best_entry)
        if file_unique_id and file_unique_id in processed_files:
            candidate["status"] = "exists"
            candidate["reason"] = "already_ingested_file"
        elif source_key and source_key in processed_sources:
            candidate["status"] = "exists"
            candidate["reason"] = "already_ingested_source"
        else:
            candidate["status"] = "ready"
            candidate["reason"] = "source_bound"
            matched_count += 1
            _log_ingest_event(
                "auto_preview_source_bound",
                {
                    "manhwa_id": manhwa_id,
                    "chapter": chapter_key,
                    "message_id": best_entry.get("message_id"),
                    "file_name": best_entry.get("file_name"),
                    "reason": best_primary_source or "matched",
                },
            )

    unmatched = len([item for item in candidates if item.get("status") == "missing_source"])
    return candidates, {"total": len(candidates), "matched": matched_count, "unmatched": unmatched}


def _extract_hashtag_raw(text: str) -> list[str]:
    if not text:
        return []
    return [tag for tag in re.findall(r"#([\w\-]+)", text) if tag]


def _extract_hashtag_tokens(text: str) -> list[str]:
    tags = _extract_hashtag_raw(text)
    return [tag.replace("-", " ").replace("_", " ") for tag in tags if tag]


def _normalize_match_value(value: str) -> str:
    if not value:
        return ""
    value = value.lower()
    value = value.replace("_", " ").replace("-", " ")
    value = re.sub(r"[^a-z0-9\s]", " ", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


_DIGIT_NORMALIZE_TABLE = str.maketrans(
    {
        "٠": "0",
        "١": "1",
        "٢": "2",
        "٣": "3",
        "٤": "4",
        "٥": "5",
        "٦": "6",
        "٧": "7",
        "٨": "8",
        "٩": "9",
        "۰": "0",
        "۱": "1",
        "۲": "2",
        "۳": "3",
        "۴": "4",
        "۵": "5",
        "۶": "6",
        "۷": "7",
        "۸": "8",
        "۹": "9",
        "０": "0",
        "１": "1",
        "２": "2",
        "３": "3",
        "４": "4",
        "５": "5",
        "６": "6",
        "７": "7",
        "８": "8",
        "９": "9",
    }
)


def _normalize_digits(value: str) -> str:
    if not value:
        return ""
    return value.translate(_DIGIT_NORMALIZE_TABLE)


def _normalized_entry_digits(entry: dict) -> dict:
    if not entry:
        return {}
    normalized = dict(entry)
    for key in ("caption", "text", "file_name"):
        raw = normalized.get(key)
        if raw:
            normalized[key] = _normalize_digits(str(raw))
    return normalized


def _manhwa_identity_tokens(manhwa_id: str, manhwas: list[dict]) -> tuple[set[str], set[str]]:
    tokens: set[str] = set()
    compact_tokens: set[str] = set()

    def _add(value: object) -> None:
        if not value:
            return
        normalized = _normalize_match_value(_normalize_digits(str(value)))
        if not normalized:
            return
        tokens.add(normalized)
        compact_tokens.add(normalized.replace(" ", ""))

    _add(manhwa_id)
    for item in manhwas:
        if item.get("id") != manhwa_id:
            continue
        _add(item.get("slug"))
        _add(item.get("title"))
        for key in ("aliases", "alt_titles", "other_names", "synonyms"):
            values = item.get(key)
            if isinstance(values, list):
                for alias in values:
                    _add(alias)
            elif isinstance(values, str):
                _add(values)
        title = item.get("title") or ""
        words = [word for word in _normalize_match_value(title).split() if word]
        if len(words) >= 2:
            acronym = "".join(word[0] for word in words if word)
            if len(acronym) >= 2:
                _add(acronym)
        break
    return tokens, compact_tokens


def _text_contains_identity(text: str, compact_text: str, token: str, compact_token: str) -> bool:
    if not token and not compact_token:
        return False
    if token:
        if " " in token and token in text:
            return True
        if " " not in token and re.search(rf"\b{re.escape(token)}\b", text):
            return True
    if compact_token and compact_token in compact_text:
        return True
    return False


def _entry_matches_manhwa_identity(entry: dict, manhwa_id: str, manhwas: list[dict]) -> tuple[bool, str]:
    if not manhwa_id:
        return False, "missing_manhwa_id"
    tokens, compact_tokens = _manhwa_identity_tokens(manhwa_id, manhwas)
    if not tokens and not compact_tokens:
        return False, "missing_manhwa_tokens"
    base_text = f"{entry.get('caption', '')} {entry.get('text', '')} {entry.get('file_name', '')}"
    normalized_text = _normalize_match_value(_normalize_digits(base_text))
    compact_text = normalized_text.replace(" ", "")
    for token in tokens:
        compact_token = token.replace(" ", "")
        if _text_contains_identity(normalized_text, compact_text, token, compact_token):
            return True, "text_match"
    raw_tags = _extract_hashtag_raw(f"{entry.get('caption', '')} {entry.get('text', '')}")
    for tag in raw_tags:
        normalized_tag = _normalize_match_value(_normalize_digits(tag))
        compact_tag = normalized_tag.replace(" ", "")
        if normalized_tag in tokens or compact_tag in compact_tokens:
            return True, "hashtag_match"
    return False, "manhwa_identity_missing"


def _entry_allowed_for_binding(entry: dict) -> tuple[bool, str]:
    if not _is_matchable_cache_entry(entry):
        return False, "not_matchable"
    media_kind = entry.get("media_kind")
    if media_kind and media_kind not in {"document", "photo"}:
        return False, "invalid_media_kind"
    if entry.get("type", "document") != "document":
        return False, "invalid_type"
    if _has_excluded_keywords(_entry_text_blob(entry)):
        return False, "excluded_keyword"
    extra_exclusions = {"poster", "trailer", "reaction", "react"}
    if any(keyword in _entry_text_blob(entry) for keyword in extra_exclusions):
        return False, "excluded_keyword"
    file_name = entry.get("file_name") or ""
    ext = Path(file_name).suffix.lower()
    if media_kind == "photo":
        if ext not in AUTO_INGEST_IMAGE_EXTENSIONS:
            return False, "invalid_photo_type"
    elif ext not in AUTO_INGEST_DOCUMENT_EXTENSIONS:
        return False, "invalid_document_type"
    return True, ""


def _entry_date_rank(entry: dict) -> int:
    raw = entry.get("date")
    if not raw:
        return 0
    try:
        return int(datetime.fromisoformat(str(raw)).timestamp())
    except ValueError:
        return 0


def _binding_rank(entry: dict, sources: set[str], manhwa_score: float) -> tuple[int, int, int, int, int, float, int, int]:
    has_filename = "filename" in sources
    has_caption = "caption" in sources
    has_hashtag = "hashtag" in sources
    combo = int(has_filename and has_caption and has_hashtag)
    media_rank = 1 if not _is_photo_entry(entry) else 0
    date_rank = _entry_date_rank(entry)
    file_size = int(entry.get("file_size") or 0)
    return (
        combo,
        int(has_filename),
        int(has_caption),
        int(has_hashtag),
        media_rank,
        float(manhwa_score or 0.0),
        date_rank,
        file_size,
    )


def _entry_message_url(entry: dict) -> str | None:
    channel = _normalize_channel_username(entry.get("channel_username") or entry.get("channel") or "")
    message_id = entry.get("message_id")
    if channel and message_id:
        return f"https://t.me/{channel}/{message_id}"
    return None


def _hashtag_text_from_entry(entry: dict) -> str:
    base = f"{entry.get('caption', '')} {entry.get('text', '')}"
    return " ".join(_extract_hashtag_tokens(base)).strip()


def _resolve_manhwa_from_hashtags(hashtags_text: str, manhwas: list[dict]) -> tuple[str | None, float]:
    if not hashtags_text:
        return None, 0.0
    normalized_hashtags = _normalize_match_value(hashtags_text)
    for item in manhwas:
        manhwa_id = item.get("id", "")
        title = item.get("title", "")
        slug_norm = _normalize_match_value(manhwa_id)
        title_norm = _normalize_match_value(title)
        if slug_norm and slug_norm in normalized_hashtags:
            return manhwa_id, 0.98
        if title_norm and title_norm in normalized_hashtags:
            return manhwa_id, 0.9
    matched_id, score = match_manhwa_fuzzy(hashtags_text, manhwas, min_score=0.5)
    return matched_id, score


def _dominant_hashtag_manhwa(entries: list[dict], manhwas: list[dict]) -> tuple[str | None, float]:
    counts: dict[str, int] = {}
    scores: dict[str, float] = {}
    for entry in entries:
        hashtags_text = _hashtag_text_from_entry(entry)
        if not hashtags_text:
            continue
        manhwa_id, score = _resolve_manhwa_from_hashtags(hashtags_text, manhwas)
        if not manhwa_id:
            continue
        counts[manhwa_id] = counts.get(manhwa_id, 0) + 1
        scores[manhwa_id] = max(scores.get(manhwa_id, 0.0), score)
    if not counts:
        return None, 0.0
    dominant = max(counts.items(), key=lambda item: (item[1], scores.get(item[0], 0.0)))
    return dominant[0], scores.get(dominant[0], 0.0)


def _channel_default_for(channel_key: str, channel_defaults: dict[str, dict]) -> tuple[str | None, float] | None:
    if not channel_key:
        return None
    entry = channel_defaults.get(channel_key)
    if not entry:
        return None
    if entry.get("count", 0) < AUTO_INGEST_CHANNEL_DEFAULT_MIN_COUNT:
        return None
    manhwa_id = entry.get("manhwa_id")
    if not manhwa_id:
        return None
    return manhwa_id, float(entry.get("score") or 0.0)


def _update_channel_default(channel_defaults: dict[str, dict], channel_key: str, manhwa_id: str, score: float) -> bool:
    if not channel_key or not manhwa_id:
        return False
    if score < AUTO_INGEST_CHANNEL_DEFAULT_MIN_SCORE:
        return False
    entry = channel_defaults.get(channel_key)
    if entry and entry.get("manhwa_id") != manhwa_id:
        return False
    if not entry:
        channel_defaults[channel_key] = {"manhwa_id": manhwa_id, "score": score, "count": 1}
        return True
    entry["count"] = entry.get("count", 0) + 1
    entry["score"] = max(entry.get("score", 0.0), score)
    return True


def _expand_hashtag_ranges(text: str) -> list[str]:
    if not text:
        return []
    ranges = []
    pattern = r"(\d{1,4})\s+(\d{1,4})\s*(bob|qism|qisim|qsm|ch|chapter|глава|гл|часть)"
    for start, end, _ in re.findall(pattern, text, flags=re.IGNORECASE):
        if start.isdigit() and end.isdigit():
            start_int = int(start)
            end_int = int(end)
            if end_int >= start_int and (end_int - start_int) <= 250:
                ranges.extend([str(num) for num in range(start_int, end_int + 1)])
    return ranges


def _chapter_confidence(chapter_source: str) -> float:
    return CHAPTER_SOURCE_CONFIDENCE.get(chapter_source, 0.0)


def _extract_chapters_from_hashtags(raw_tags: list[str]) -> list[str]:
    if not raw_tags:
        return []
    results: list[str] = []
    for tag in raw_tags:
        if not tag:
            continue
        cleaned = tag.strip()
        matched = False
        for pattern in HASHTAG_CHAPTER_PATTERNS:
            match = pattern.match(cleaned)
            if not match:
                continue
            value = match.group("num")
            if value:
                results.append(_normalize_chapter_key(value))
            matched = True
            break
        if matched:
            continue
        trailing = HASHTAG_TRAILING_NUMBER_PATTERN.match(cleaned)
        if trailing and re.search(r"[a-z]", trailing.group("prefix"), flags=re.IGNORECASE):
            results.append(_normalize_chapter_key(trailing.group("num")))
    return _dedupe_chapters(results)


def _extract_chapters_from_filename(filename: str) -> list[str]:
    if not filename:
        return []
    stem = Path(filename).stem.lower()
    normalized = stem.replace("_", " ").replace("-", " ")
    normalized = re.sub(r"[^a-z0-9\s\.,]", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    if not normalized:
        return []
    if re.fullmatch(r"\d+(?:[.,]\d+)?", normalized):
        return [_normalize_chapter_key(normalized)]
    strict = _extract_chapter_numbers_strict(normalized, allow_number_only=False)
    if strict:
        return strict
    numbers = [value.replace(",", ".").strip() for value in re.findall(r"\d+(?:[.,]\d+)?", normalized)]
    if len(numbers) == 1:
        return [_normalize_chapter_key(numbers[0])]
    tail = re.search(r"(\d+(?:[.,]\d+)?)\s*$", normalized)
    if tail:
        return [_normalize_chapter_key(tail.group(1))]
    return []


def _extract_chapters_from_filename_relaxed(filename: str) -> list[str]:
    if not filename:
        return []
    stem = Path(filename).stem.lower()
    normalized = stem.replace("_", " ").replace("-", " ")
    normalized = re.sub(r"[^a-z0-9\s\.,]", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    if not normalized:
        return []
    strict = _extract_chapter_numbers_strict(normalized, allow_number_only=True)
    if strict:
        return strict
    numbers = [value.replace(",", ".").strip() for value in re.findall(r"\d+(?:[.,]\d+)?", normalized)]
    if len(numbers) == 1:
        return [_normalize_chapter_key(numbers[0])]
    tail = re.search(r"(\d+(?:[.,]\d+)?)\s*$", normalized)
    if tail:
        return [_normalize_chapter_key(tail.group(1))]
    return []


def _extract_chapter_debug_info(entry: dict) -> dict:
    text_blob = f"{entry.get('caption', '')} {entry.get('text', '')}".strip()
    raw_tags = _extract_hashtag_raw(text_blob)
    hashtag_chapters = _extract_chapters_from_hashtags(raw_tags) if raw_tags else []
    caption_text = _strip_hashtags(text_blob).strip()
    caption_chapters = (
        _extract_chapter_numbers_strict(caption_text, allow_number_only=False) if caption_text else []
    )
    filename_text = entry.get("file_name", "") or ""
    filename_chapters = _extract_chapters_from_filename(filename_text) if filename_text else []

    if hashtag_chapters:
        strict_chapters = hashtag_chapters
        strict_source = "hashtag"
    elif caption_chapters:
        strict_chapters = caption_chapters
        strict_source = "caption"
    elif filename_chapters:
        strict_chapters = filename_chapters
        strict_source = "filename"
    else:
        strict_chapters = []
        strict_source = ""

    return {
        "raw_tags": raw_tags,
        "caption_text": caption_text,
        "hashtag_chapters": hashtag_chapters,
        "caption_chapters": caption_chapters,
        "filename_chapters": filename_chapters,
        "strict_chapters": strict_chapters,
        "strict_source": strict_source,
    }


def _extract_chapters_from_entry(entry: dict) -> tuple[list[str], str]:
    info = _extract_chapter_debug_info(entry)
    return info["strict_chapters"], info["strict_source"]


def _extract_chapters_relaxed(entry: dict, info: dict | None = None) -> tuple[list[str], str]:
    info = info or _extract_chapter_debug_info(entry)
    strict_chapters = info.get("strict_chapters") or []
    if strict_chapters:
        return strict_chapters, info.get("strict_source") or ""
    hashtag_chapters = info.get("hashtag_chapters") or []
    if hashtag_chapters:
        return hashtag_chapters, "hashtag"
    caption_text = info.get("caption_text") or ""
    relaxed_caption = _extract_chapter_numbers_strict(caption_text, allow_number_only=True) if caption_text else []
    if relaxed_caption:
        return relaxed_caption, "caption"
    filename_chapters = _extract_chapters_from_filename_relaxed(entry.get("file_name") or "")
    if filename_chapters:
        return filename_chapters, "filename"
    return [], ""


def _dedupe_chapters(values: list[str]) -> list[str]:
    seen = set()
    ordered: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        ordered.append(value)
    return ordered


def _entry_match_text(entry: dict) -> str:
    base_text = f"{entry.get('caption', '')} {entry.get('text', '')} {entry.get('file_name', '')}"
    hashtags_text = _hashtag_text_from_entry(entry)
    return f"{base_text} {hashtags_text}".strip()


def _is_photo_entry(entry: dict) -> bool:
    media_kind = entry.get("media_kind")
    if media_kind == "photo":
        return True
    file_name = (entry.get("file_name") or "").lower()
    return file_name.startswith("photo_") and Path(file_name).suffix.lower() in AUTO_INGEST_IMAGE_EXTENSIONS


def _normalized_chapter_set(values: list[str]) -> set[str]:
    return {key for key in (_normalize_chapter_key(value) for value in values) if key}


def _entry_chapter_sources(entry: dict) -> dict[str, set[str]]:
    caption_text = f"{entry.get('caption', '')} {entry.get('text', '')}".strip()
    raw_tags = _extract_hashtag_raw(caption_text)
    hashtag_chapters = _normalized_chapter_set(_extract_chapters_from_hashtags(raw_tags))
    caption_body = _strip_hashtags(caption_text).strip()
    caption_chapters = (
        _normalized_chapter_set(_extract_chapter_numbers_strict(caption_body, allow_number_only=False))
        if caption_body
        else set()
    )
    relaxed_caption = (
        _normalized_chapter_set(_extract_chapter_numbers_strict(caption_body, allow_number_only=True))
        if caption_body
        else set()
    )
    file_name = entry.get("file_name") or ""
    use_filename = bool(file_name) and not _is_photo_entry(entry)
    filename_chapters = (
        _normalized_chapter_set(_extract_chapters_from_filename_relaxed(file_name)) if use_filename else set()
    )
    sources: dict[str, set[str]] = {}

    def _add(chapters: set[str], source: str) -> None:
        for chapter in chapters:
            sources.setdefault(chapter, set()).add(source)

    _add(hashtag_chapters, "hashtag")
    _add(caption_chapters, "caption")
    _add(filename_chapters, "filename")
    _add(relaxed_caption, "caption_relaxed")

    if not sources:
        fallback_text = f"{caption_text} {file_name if use_filename else ''}".strip()
        _add(_normalized_chapter_set(extract_chapter_numbers(fallback_text)), "text")
    return sources


def _primary_chapter_source(sources: set[str]) -> str:
    for source in ("filename", "hashtag", "caption", "caption_relaxed", "text"):
        if source in sources:
            return source
    return ""


def _source_match_rank(entry: dict, sources: set[str], manhwa_score: float) -> tuple[int, int, float, int]:
    if "filename" in sources:
        source_rank = 4
    elif "hashtag" in sources:
        source_rank = 3
    elif "caption" in sources:
        source_rank = 2
    elif "caption_relaxed" in sources:
        source_rank = 1
    else:
        source_rank = 0
    media_rank = 1 if not _is_photo_entry(entry) else 0
    file_size = int(entry.get("file_size") or 0)
    return (source_rank, media_rank, manhwa_score, file_size)


def _resolve_manhwa_for_source_match(
    entry: dict, manhwas: list[dict], channel_defaults: dict[str, dict] | None = None
) -> tuple[str | None, float, str]:
    channel_key = _channel_key(entry)
    if channel_defaults:
        channel_default = _channel_default_for(channel_key, channel_defaults)
        if channel_default:
            return channel_default[0], channel_default[1], "channel_default"
    hashtags_text = _hashtag_text_from_entry(entry)
    manhwa_id, score = _resolve_manhwa_from_hashtags(hashtags_text, manhwas)
    if manhwa_id:
        return manhwa_id, score, "hashtag"
    match_text = _entry_match_text(entry)
    if match_text:
        manhwa_id, score = match_manhwa_fuzzy(match_text, manhwas, min_score=0.6)
        if manhwa_id:
            return manhwa_id, score, "filename"
    return None, 0.0, ""


def _resolve_manhwa_for_entry(
    entry: dict,
    manhwas: list[dict],
    channel_defaults: dict[str, dict] | None = None,
) -> tuple[str | None, float, str]:
    channel_key = _channel_key(entry)
    if channel_defaults:
        channel_default = _channel_default_for(channel_key, channel_defaults)
        if channel_default:
            return channel_default[0], channel_default[1], "channel_default"
    hashtags_text = _hashtag_text_from_entry(entry)
    manhwa_id, score = _resolve_manhwa_from_hashtags(hashtags_text, manhwas)
    if manhwa_id:
        return manhwa_id, score, "hashtag"
    caption_text = f"{entry.get('caption', '')} {entry.get('text', '')}".strip()
    if caption_text:
        manhwa_id, score = match_manhwa_fuzzy(caption_text, manhwas, min_score=0.6)
        if manhwa_id:
            return manhwa_id, score, "caption"
    return None, 0.0, ""


def _channel_key(entry: dict) -> str:
    return (
        _normalize_channel_username(entry.get("channel_username"))
        or _normalize_channel_username(entry.get("channel_title"))
        or str(entry.get("channel_id") or "")
    )


def _candidate_rank(candidate: dict) -> tuple[int, int, float]:
    status = candidate.get("status")
    status_rank = {"exists": 3, "pending": 2, "ready": 2, "missing_source": 1}.get(status, 0)
    has_source = 1 if candidate.get("source") or candidate.get("external_url") else 0
    confidence = float(candidate.get("confidence") or 0.0)
    disk_priority = 1 if candidate.get("disk_manifest") and candidate.get("pages") else 0
    return (disk_priority, status_rank, has_source, confidence)


def _merge_candidate_lists(*lists: list[dict]) -> list[dict]:
    merged: dict[str, dict] = {}
    for candidates in lists:
        for candidate in candidates:
            chapter = _normalize_chapter_key(candidate.get("chapter"))
            if not chapter:
                continue
            candidate["chapter"] = chapter
            existing = merged.get(chapter)
            if not existing or _candidate_rank(candidate) > _candidate_rank(existing):
                merged[chapter] = candidate
    return sorted(merged.values(), key=_chapter_sort_key)


def _build_catalog_candidates(
    manhwa_id: str,
    catalog_entries: list[dict],
    cached_documents: list[dict],
    manhwas: list[dict],
    existing: set[str],
    processed_sources: set[str],
    processed_files: set[str],
) -> list[dict]:
    candidates: list[dict] = []
    doc_index = _index_documents_by_link(cached_documents)
    for entry in catalog_entries:
        info = _extract_chapter_debug_info(entry)
        chapters = info["strict_chapters"]
        chapter_source = info["strict_source"]
        raw_tags = info["raw_tags"]
        _log_auto_ingest_debug("catalog_entry_start", entry, extracted_hashtags=raw_tags)
        if not chapters:
            _log_auto_ingest_debug(
                "catalog_rejected",
                entry,
                extracted_hashtags=raw_tags,
                extracted_chapter_numbers=[],
                rejection_reason="no_chapters_detected",
            )
            continue
        manhwa_match, _, manhwa_source = _resolve_manhwa_for_entry(entry, manhwas)
        if not manhwa_match or manhwa_match != manhwa_id:
            reason = "manhwa_not_resolved" if not manhwa_match else "manhwa_mismatch"
            _log_auto_ingest_debug(
                "catalog_rejected",
                entry,
                extracted_hashtags=raw_tags,
                extracted_chapter_numbers=chapters,
                detected_manhwa=manhwa_match,
                manhwa_source=manhwa_source,
                chapter_source=chapter_source,
                rejection_reason=reason,
            )
            continue
        links = entry.get("links") or []
        assignments = _assign_links_to_chapters(chapters, links)
        for chapter, link in assignments:
            chapter = _normalize_chapter_key(chapter)
            if not chapter:
                continue
            doc_entry = _resolve_doc_from_link(link, doc_index)
            external_url = link.get("url") if link and link.get("kind") == "external" else None
            status = "pending"
            reason = ""
            if chapter in existing:
                status = "exists"
                reason = "already_in_manhwa_json"
            else:
                source_key = None
                file_unique_id = None
                if doc_entry:
                    source_key = _source_key(doc_entry)
                    file_unique_id = doc_entry.get("file_unique_id")
                elif external_url:
                    source_key = f"url:{external_url}"
                if file_unique_id and file_unique_id in processed_files:
                    status = "exists"
                    reason = "already_ingested_file"
                elif source_key and source_key in processed_sources:
                    status = "exists"
                    reason = "already_ingested_source"
                elif not doc_entry and not external_url:
                    status = "missing_source"
                    reason = "catalog_link_missing"
            candidates.append(
                {
                    "manhwa_id": manhwa_id,
                    "chapter": chapter,
                    "catalog": _source_summary(entry),
                    "source": _source_summary(doc_entry) if doc_entry else None,
                    "external_url": external_url,
                    "confidence": _chapter_confidence(chapter_source),
                    "status": status,
                    "reason": reason,
                    "manhwa_source": manhwa_source,
                    "chapter_source": chapter_source,
                }
            )
            _log_auto_ingest_debug(
                "catalog_entry_accepted",
                entry,
                extracted_hashtags=raw_tags,
                extracted_chapter_numbers=[chapter],
                detected_manhwa=manhwa_match,
                manhwa_source=manhwa_source,
                chapter_source=chapter_source,
            )
            _log_chapter_decision(
                entry,
                chapter,
                chapter_source,
                manhwa_source,
                _chapter_confidence(chapter_source),
                status=status,
                ignored_reason=reason if status != "pending" else None,
            )
    return candidates


def _build_source_candidates(
    manhwa_id: str,
    entries: list[dict],
    manhwas: list[dict],
    existing: set[str],
    processed_sources: set[str],
    processed_files: set[str],
    channel_defaults: dict[str, dict] | None = None,
    require_source_channel: bool = True,
    relaxed: bool = False,
    dominant_manhwa: str | None = None,
) -> tuple[list[dict], dict, bool]:
    candidates: dict[str, dict] = {}
    skipped_posts = 0
    defaults_changed = False
    channel_defaults = channel_defaults or {}
    for entry in entries:
        if require_source_channel and not _is_source_entry(entry):
            continue
        info = _extract_chapter_debug_info(entry)
        raw_tags = info["raw_tags"]
        if relaxed:
            chapters, chapter_source = _extract_chapters_relaxed(entry, info)
        else:
            chapters = info["strict_chapters"]
            chapter_source = info["strict_source"]
        _log_auto_ingest_debug("entry_start", entry, extracted_hashtags=raw_tags)
        _log_auto_ingest_debug(
            "chapters_extracted",
            entry,
            extracted_hashtags=raw_tags,
            extracted_chapter_numbers=chapters,
            chapter_source=chapter_source,
        )
        manhwa_match, manhwa_score, manhwa_source = _resolve_manhwa_for_entry(entry, manhwas, channel_defaults)
        if relaxed and not manhwa_match and dominant_manhwa == manhwa_id:
            manhwa_match = dominant_manhwa
            manhwa_score = 0.55
            manhwa_source = "dominant_hashtag"
        _log_auto_ingest_debug(
            "manhwa_resolved",
            entry,
            extracted_hashtags=raw_tags,
            extracted_chapter_numbers=chapters,
            detected_manhwa=manhwa_match,
            manhwa_source=manhwa_source,
            chapter_source=chapter_source,
        )
        invalid_reason = _invalid_source_reason(entry)
        if invalid_reason:
            skipped_posts += 1
            _log_auto_ingest_debug(
                "entry_rejected",
                entry,
                extracted_hashtags=raw_tags,
                extracted_chapter_numbers=chapters,
                detected_manhwa=manhwa_match,
                manhwa_source=manhwa_source,
                chapter_source=chapter_source,
                rejection_reason=invalid_reason,
            )
            if chapters:
                for chapter in chapters:
                    _log_chapter_decision(
                        entry,
                        chapter,
                        chapter_source,
                        manhwa_source,
                        _chapter_confidence(chapter_source),
                        ignored_reason="non_chapter_asset",
                        detail=invalid_reason,
                    )
            continue

        fallback_used = False
        if not chapters and manhwa_source == "channel_default" and manhwa_match == manhwa_id:
            fallback_chapters, fallback_source = _fallback_chapter_from_any_source(info)
            if fallback_chapters:
                chapters = fallback_chapters
                chapter_source = fallback_source
                fallback_used = True
                _log_auto_ingest_debug(
                    "fallback_used",
                    entry,
                    extracted_hashtags=raw_tags,
                    extracted_chapter_numbers=chapters,
                    detected_manhwa=manhwa_match,
                    manhwa_source=manhwa_source,
                    chapter_source=chapter_source,
                )

        if not chapters:
            skipped_posts += 1
            _log_auto_ingest_debug(
                "entry_rejected",
                entry,
                extracted_hashtags=raw_tags,
                extracted_chapter_numbers=[],
                detected_manhwa=manhwa_match,
                manhwa_source=manhwa_source,
                chapter_source=chapter_source,
                rejection_reason="no_chapters_detected",
            )
            continue

        if not manhwa_match or manhwa_match != manhwa_id:
            skipped_posts += 1
            reason = "manhwa_not_resolved" if not manhwa_match else "manhwa_mismatch"
            _log_auto_ingest_debug(
                "entry_rejected",
                entry,
                extracted_hashtags=raw_tags,
                extracted_chapter_numbers=chapters,
                detected_manhwa=manhwa_match,
                manhwa_source=manhwa_source,
                chapter_source=chapter_source,
                rejection_reason=reason,
            )
            for chapter in chapters:
                _log_chapter_decision(
                    entry,
                    chapter,
                    chapter_source,
                    manhwa_source,
                    _chapter_confidence(chapter_source),
                    ignored_reason=reason,
                )
            continue

        if manhwa_source == "hashtag" and manhwa_match == manhwa_id:
            if _update_channel_default(channel_defaults, _channel_key(entry), manhwa_match, manhwa_score):
                defaults_changed = True

        file_ext = Path(entry.get("file_name") or "").suffix.lower()
        if file_ext in AUTO_INGEST_IMAGE_EXTENSIONS and chapter_source != "hashtag":
            skipped_posts += 1
            _log_auto_ingest_debug(
                "entry_rejected",
                entry,
                extracted_hashtags=raw_tags,
                extracted_chapter_numbers=chapters,
                detected_manhwa=manhwa_match,
                manhwa_source=manhwa_source,
                chapter_source=chapter_source,
                rejection_reason="image_without_hashtag",
            )
            for chapter in chapters:
                _log_chapter_decision(
                    entry,
                    chapter,
                    chapter_source,
                    manhwa_source,
                    _chapter_confidence(chapter_source),
                    ignored_reason="non_chapter_asset",
                    detail="image_without_hashtag",
                )
            continue

        if not entry.get("message_id"):
            skipped_posts += 1
            _log_auto_ingest_debug(
                "entry_rejected",
                entry,
                extracted_hashtags=raw_tags,
                extracted_chapter_numbers=chapters,
                detected_manhwa=manhwa_match,
                manhwa_source=manhwa_source,
                chapter_source=chapter_source,
                rejection_reason="missing_message_id",
            )
            for chapter in chapters:
                _log_chapter_decision(
                    entry,
                    chapter,
                    chapter_source,
                    manhwa_source,
                    _chapter_confidence(chapter_source),
                    ignored_reason="missing_message_id",
                )
            continue

        for chapter in chapters:
            chapter = _normalize_chapter_key(chapter)
            if not chapter:
                continue
            candidate = candidates.get(chapter)
            confidence = 0.6 if fallback_used else _chapter_confidence(chapter_source)
            if candidate:
                existing_confidence = candidate.get("confidence", 0)
                if existing_confidence > confidence:
                    continue
                if existing_confidence == confidence and candidate.get("status") == "exists":
                    continue
            status = "pending"
            reason = ""
            if chapter in existing:
                status = "exists"
                reason = "already_in_manhwa_json"
            else:
                file_unique_id = entry.get("file_unique_id")
                source_key = _source_key(entry)
                if file_unique_id and file_unique_id in processed_files:
                    status = "exists"
                    reason = "already_ingested_file"
                elif source_key and source_key in processed_sources:
                    status = "exists"
                    reason = "already_ingested_source"
            candidates[chapter] = {
                "manhwa_id": manhwa_id,
                "chapter": chapter,
                "catalog": None,
                "source": _source_summary(entry),
                "external_url": None,
                "confidence": confidence,
                "status": status,
                "reason": reason,
                "manhwa_source": manhwa_source,
                "chapter_source": chapter_source,
            }
            _log_auto_ingest_debug(
                "entry_accepted",
                entry,
                extracted_hashtags=raw_tags,
                extracted_chapter_numbers=[chapter],
                detected_manhwa=manhwa_match,
                manhwa_source=manhwa_source,
                chapter_source=chapter_source,
            )
            _log_chapter_decision(
                entry,
                chapter,
                chapter_source,
                manhwa_source,
                confidence,
                status=status,
            )
    sorted_candidates = sorted(candidates.values(), key=_chapter_sort_key)
    stats = _summarize_candidates(sorted_candidates)
    stats["skipped_posts"] = skipped_posts
    return sorted_candidates, stats, defaults_changed


def _chapter_numeric(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        return float(str(value).replace(",", "."))
    except ValueError:
        return None


def _highest_known_chapter(existing: set[str]) -> float | None:
    numbers = [_chapter_numeric(value) for value in existing]
    numeric = [num for num in numbers if num is not None]
    return max(numeric) if numeric else None


def _apply_sanity_filter(candidates: list[dict], highest_known: float | None) -> list[dict]:
    if not highest_known or highest_known <= 0:
        return candidates
    threshold = highest_known * AUTO_INGEST_SANITY_MULTIPLIER
    filtered: list[dict] = []
    for candidate in candidates:
        if candidate.get("disk_manifest"):
            filtered.append(candidate)
            continue
        chapter_value = candidate.get("chapter")
        chapter_num = _chapter_numeric(str(chapter_value) if chapter_value is not None else None)
        if chapter_num is None:
            filtered.append(candidate)
            continue
        low_confidence = candidate.get("chapter_source") != "hashtag" or (candidate.get("confidence") or 0) < 0.85
        if chapter_num > threshold and low_confidence:
            _log_chapter_decision(
                candidate.get("source"),
                str(chapter_value),
                candidate.get("chapter_source") or "",
                candidate.get("manhwa_source") or "",
                float(candidate.get("confidence") or 0.0),
                ignored_reason="sanity_threshold",
            )
            continue
        filtered.append(candidate)
    return filtered


def _fallback_chapter_from_any_source(info: dict) -> tuple[list[str], str]:
    caption_text = info.get("caption_text") or ""
    relaxed_caption = (
        _extract_chapter_numbers_strict(caption_text, allow_number_only=True) if caption_text else []
    )
    hashtag_chapters = info.get("hashtag_chapters") or []
    filename_chapters = info.get("filename_chapters") or []
    combined = _dedupe_chapters([*hashtag_chapters, *relaxed_caption, *filename_chapters])
    if len(combined) != 1:
        return [], ""
    chapter = combined[0]
    if chapter in hashtag_chapters:
        return [chapter], "hashtag"
    if chapter in relaxed_caption:
        return [chapter], "caption"
    return [chapter], "filename"


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
    processed_files.update(_load_history())
    queued_existing = {
        _normalize_chapter_key(item.get("chapter"))
        for item in manhwa_state.get("queue", [])
        if item.get("status") in {"exists", "ingested"} and item.get("chapter")
    }
    existing |= {value for value in queued_existing if value}
    channel_defaults = ingest_state.get("channels", {})

    cached_entries_count = len(cache)
    cached_documents = [entry for entry in cache if _is_document_capable_entry(entry)]
    cached_documents_count = len(cached_documents)
    catalog_entries = [entry for entry in cache if _is_catalog_entry(entry)]
    catalog_entries_count = len(catalog_entries)
    if cached_entries_count == 0:
        _log_auto_preview_trace("cache_entries_empty", {"manhwa_id": manhwa_id})
    if cached_documents_count == 0:
        _log_auto_preview_trace("cache_documents_empty", {"manhwa_id": manhwa_id, "entries": cached_entries_count})

    catalog_candidates = _build_catalog_candidates(
        manhwa_id,
        catalog_entries,
        cached_documents,
        manhwas,
        existing,
        processed_sources,
        processed_files,
    )
    disk_candidates = _build_disk_candidates(manhwa_id, existing)
    disk_candidates_count = len(disk_candidates)
    source_candidates, source_stats, defaults_changed = _build_source_candidates(
        manhwa_id,
        cached_documents,
        manhwas,
        existing,
        processed_sources,
        processed_files,
        channel_defaults,
        require_source_channel=False,
    )
    source_candidates_count = len(source_candidates)
    skipped_posts = source_stats.get("skipped_posts", 0)
    backfill_candidates = _build_backfill_candidates(manhwa_id, existing)
    backfill_candidates_count = len(backfill_candidates)
    candidates = _merge_candidate_lists(disk_candidates, catalog_candidates, source_candidates, backfill_candidates)
    candidates = _apply_cache_source_matches(
        manhwa_id,
        candidates,
        cache,
        manhwas,
        processed_sources,
        processed_files,
    )
    filtered_candidates = _apply_sanity_filter(candidates, _highest_known_chapter(existing))
    if len(filtered_candidates) != len(candidates):
        candidates = filtered_candidates
    if defaults_changed:
        ingest_state["channels"] = channel_defaults
    if not candidates and cached_documents_count > 0:
        dominant_manhwa, _ = _dominant_hashtag_manhwa(cached_documents, manhwas)
        relaxed_candidates, relaxed_stats, relaxed_defaults_changed = _build_source_candidates(
            manhwa_id,
            cached_documents,
            manhwas,
            existing,
            processed_sources,
            processed_files,
            channel_defaults,
            require_source_channel=False,
            relaxed=True,
            dominant_manhwa=dominant_manhwa,
        )
        if relaxed_defaults_changed:
            ingest_state["channels"] = channel_defaults
        skipped_posts = relaxed_stats.get("skipped_posts", 0)
        candidates = _apply_sanity_filter(relaxed_candidates, _highest_known_chapter(existing))
        source_candidates_count = len(relaxed_candidates)

    candidates = _match_candidates_to_sources(
        manhwa_id,
        candidates,
        cached_documents,
        manhwas,
        processed_sources,
        processed_files,
        channel_defaults,
    )
    candidates, bind_summary = _bind_sources_to_candidates(
        manhwa_id,
        candidates,
        cache,
        manhwas,
        processed_sources,
        processed_files,
    )
    _log_ingest_event(
        "auto_preview_source_binding_summary",
        {
            "manhwa_id": manhwa_id,
            "total_candidates": bind_summary.get("total", 0),
            "matched_sources": bind_summary.get("matched", 0),
            "unmatched_remaining": bind_summary.get("unmatched", 0),
        },
    )

    stats = _summarize_candidates(candidates)
    stats["skipped_posts"] = skipped_posts
    _log_ingest_event(
        "auto_preview_stats",
        {
            "manhwa_id": manhwa_id,
            "cached_entries_count": cached_entries_count,
            "cached_documents_count": cached_documents_count,
            "catalog_entries_count": catalog_entries_count,
            "source_candidates_count": source_candidates_count,
            "final_preview_count": len(candidates),
            "catalog_candidates_count": len(catalog_candidates),
            "disk_candidates_count": disk_candidates_count,
            "backfill_candidates_count": backfill_candidates_count,
        },
    )
    _log_chapter_gaps(manhwa_id, candidates)
    return candidates, stats, ingest_state


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


def _normalize_chapter_key(value: object) -> str:
    if value is None:
        return ""
    raw = str(value).strip()
    if not raw:
        return ""
    try:
        number = float(raw.replace(",", "."))
        if number.is_integer():
            return str(int(number))
        return str(number).rstrip("0").rstrip(".")
    except ValueError:
        return raw


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
        _log_auto_preview_trace("auto_preview_aborted", {"manhwa_id": manhwa_id, "reason": "manhwa_not_found"})
        await message.answer("Manhwa not found.", reply_markup=main_menu_kb(get_user_lang(message.from_user.id)))
        return
    _reset_channel_cache_memory()
    disk_cache = _load_cache_from_disk()
    memory_cache = _hydrate_cache_memory(force=True, data=disk_cache)
    logging.info(
        "Auto preview memory cache count before detection: memory_cache_count=%s",
        len(memory_cache),
    )
    if len(disk_cache) > 0 and len(memory_cache) == 0:
        logging.error("Auto preview cache hydration failed: disk has entries but memory empty")
    ingest_state = _load_ingest_state()
    manhwa_state = ingest_state.get("manhwas", {}).get(manhwa_id, {})
    parser_version = manhwa_state.get("parser_version")
    if parser_version != AUTO_INGEST_PARSER_VERSION:
        _log_auto_preview_trace(
            "parser_version_changed",
            {"manhwa_id": manhwa_id, "previous": parser_version, "current": AUTO_INGEST_PARSER_VERSION},
        )
    if force_rescan:
        _log_auto_preview_trace("force_rescan_requested", {"manhwa_id": manhwa_id})
    elif manhwa_state.get("queue"):
        _log_auto_preview_trace(
            "stale_queue_ignored",
            {"manhwa_id": manhwa_id, "queue_count": len(manhwa_state.get("queue") or [])},
        )
    candidates, stats, ingest_state = _build_auto_candidates(manhwa_id, memory_cache, manhwas)
    existing = set(processor.get_chapter_numbers(MANHWA_PATH, manhwa_id))
    candidates, merged = _merge_backfill_candidates(manhwa_id, candidates, existing=existing)
    if merged:
        stats = _summarize_candidates(candidates)
    ingest_state.setdefault("manhwas", {}).setdefault(manhwa_id, {})["queue"] = candidates
    ingest_state["manhwas"][manhwa_id]["parser_version"] = AUTO_INGEST_PARSER_VERSION
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
        if status in {"pending", "ready"}:
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
    pending = [item for item in queue if item.get("status") in {"pending", "ready"}]
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
                if candidate.get("disk_manifest") and candidate.get("pages"):
                    await asyncio.to_thread(_sync_disk_candidate, candidate)
                    candidate["status"] = "ingested"
                    candidate["pages_count"] = len(candidate.get("pages") or [])
                    _mark_ingested_source(candidate)
                    completed["success"] += 1
                    _log_ingest_event(
                        "chapter_ingested",
                        {
                            "manhwa_id": manhwa_id,
                            "chapter": candidate.get("chapter"),
                            "pages": candidate.get("pages_count"),
                            "source": "disk_manifest",
                        },
                    )
                    return
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


def _sync_disk_candidate(candidate: dict) -> None:
    manhwa_id = candidate.get("manhwa_id")
    chapter = candidate.get("chapter")
    pages = candidate.get("pages") or []
    if not manhwa_id or not chapter or not pages:
        return
    if not isinstance(pages, list):
        pages = []
    pages = [str(page) for page in pages if str(page).strip()]
    if not pages:
        return
    try:
        processor.add_chapter(
            MANHWA_PATH,
            manhwa_id,
            str(chapter),
            pages,
            overwrite=False,
            auto_deploy_enabled=False,
        )
    except ValueError:
        return


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

