from __future__ import annotations

import asyncio
import logging
import shutil
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from aiogram import F, Router
from aiogram.filters import Command, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, Message

from ..config import (
    LOGS_PATH,
    MANHWA_PATH,
    PUBLIC_DIR,
    SETTINGS_PATH,
    TELEGRAM_SAFE_FILE_BYTES,
    TELEGRAM_SAFE_FILE_MB,
    UPLOADS_DIR,
)
from ..flow_registry import track, untrack
from ..i18n import ensure_access, get_user_lang, menu_labels, menu_labels_all, t
from ..keyboards import (
    inline_cancel_back_kb,
    inline_chapter_kb,
    inline_confirm_kb,
    inline_conflict_kb,
    inline_manhwa_kb,
    inline_quality_choice_kb,
    main_menu_kb,
)
from ..prompt_guard import mark_prompt, reset_prompt
from ..roles import can_upload
from server import processor
from server.decision_engine import analyze_chapter_conflict

router = Router()


class UploadChapter(StatesGroup):
    manhwa_id = State()
    chapter_number = State()
    upload = State()
    review = State()
    delete_confirm = State()


@router.message(Command("upload_chapter"))
@router.message(StateFilter("*"), F.text.in_(menu_labels("upload")))
async def upload_start(message: Message, state: FSMContext) -> None:
    if not await ensure_access(message, can_upload):
        return
    await state.clear()
    track(message.chat.id, message.from_user.id)
    manhwas = _load_public_manhwa()
    if not manhwas:
        lang = get_user_lang(message.from_user.id)
        await message.answer(
            t("no_manhwa", lang),
            reply_markup=inline_cancel_back_kb(back_data="flow:cancel", lang=lang),
        )
        untrack(message.chat.id, message.from_user.id)
        return
    await state.update_data(manhwa_id_map=_build_id_map(manhwas))
    await state.set_state(UploadChapter.manhwa_id)
    lang = get_user_lang(message.from_user.id)
    await message.answer(
        "Select a manhwa to upload:",
        reply_markup=inline_manhwa_kb(
            manhwas,
            lang=lang,
            callback_prefix="upload:manhwa:",
            use_index=True,
            page=0,
            nav_prefix="upload:manhwa:page:",
        ),
    )


@router.callback_query(
    UploadChapter.manhwa_id,
    F.data.startswith("upload:manhwa:") & ~F.data.startswith("upload:manhwa:page:"),
)
async def upload_select_manhwa(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_upload):
        return
    raw_id = callback.data.split("upload:manhwa:")[-1]
    data = await state.get_data()
    manhwa_id = _resolve_manhwa_id(raw_id, data.get("manhwa_id_map"))
    if not manhwa_id:
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
    await state.set_state(UploadChapter.chapter_number)
    await _prompt_chapter(callback.message, manhwa_id)
    await callback.answer()


@router.callback_query(UploadChapter.manhwa_id, F.data.startswith("upload:manhwa:page:"))
async def upload_manhwa_page(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_upload):
        return
    raw_page = callback.data.split("upload:manhwa:page:")[-1]
    try:
        page = int(raw_page)
    except ValueError:
        await callback.answer()
        return
    manhwas = _load_public_manhwa()
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
    await state.update_data(manhwa_id_map=_build_id_map(manhwas))
    lang = get_user_lang(callback.from_user.id)
    await callback.message.edit_reply_markup(
        reply_markup=inline_manhwa_kb(
            manhwas,
            lang=lang,
            callback_prefix="upload:manhwa:",
            use_index=True,
            page=page,
            nav_prefix="upload:manhwa:page:",
        )
    )
    await callback.answer()


async def _prompt_chapter(message: Message, manhwa_id: str) -> None:
    lang = get_user_lang(message.from_user.id)
    existing = processor.get_chapter_numbers(MANHWA_PATH, manhwa_id)
    suggested = _suggest_chapters(existing)
    await message.answer(
        "Choose chapter action:",
        reply_markup=inline_chapter_kb(
            existing=existing,
            suggestions=suggested,
            back_data="upload:back:manhwa",
            lang=lang,
        ),
    )


@router.callback_query(UploadChapter.chapter_number, F.data == "upload:back:manhwa")
async def upload_back_manhwa(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_upload):
        return
    await state.clear()
    reset_prompt(callback.from_user.id)
    manhwas = processor.get_manhwa_list(MANHWA_PATH)
    await state.update_data(manhwa_id_map=_build_id_map(manhwas))
    await state.set_state(UploadChapter.manhwa_id)
    lang = get_user_lang(callback.from_user.id)
    if not manhwas:
        await callback.message.answer(
            t("no_manhwa", lang),
            reply_markup=inline_cancel_back_kb(back_data="flow:cancel", lang=lang),
        )
        await callback.answer()
        return
    await callback.message.answer(
        "Select a manhwa to upload:",
        reply_markup=inline_manhwa_kb(
            manhwas,
            lang=lang,
            callback_prefix="upload:manhwa:",
            use_index=True,
            page=0,
            nav_prefix="upload:manhwa:page:",
        ),
    )
    await callback.answer()


@router.callback_query(
    UploadChapter.chapter_number,
    F.data.startswith("upload:chapter:replace:") | F.data.startswith("upload:chapter:new:"),
)
async def upload_select_chapter(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_upload):
        return
    _, _, action, chapter = callback.data.split(":", 3)
    overwrite = action == "replace"
    await state.update_data(chapter_number=chapter, overwrite=overwrite)
    await state.set_state(UploadChapter.upload)
    prompt = "Send file (PDF/ZIP/RAR/IMG) for analysis:"
    count = mark_prompt(callback.from_user.id, prompt)
    lang = get_user_lang(callback.from_user.id)
    await callback.message.answer(prompt, reply_markup=inline_cancel_back_kb("upload:back:chapter", lang=lang))
    if count >= 2:
        await callback.message.answer("Tip: You can cancel or go back at any time.")
    await callback.answer()


@router.callback_query(UploadChapter.chapter_number, F.data.startswith("upload:chapter:delete:"))
async def upload_delete_prompt(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_upload):
        return
    chapter = callback.data.split("upload:chapter:delete:")[-1]
    await state.update_data(chapter_number=chapter)
    await state.set_state(UploadChapter.delete_confirm)
    lang = get_user_lang(callback.from_user.id)
    await callback.message.answer(
        f"Delete chapter {chapter}? This cannot be undone.",
        reply_markup=inline_confirm_kb("upload:delete:confirm", back_data="upload:back:chapter", lang=lang),
    )
    await callback.answer()


@router.callback_query(
    StateFilter(UploadChapter.upload, UploadChapter.review, UploadChapter.delete_confirm),
    F.data == "upload:back:chapter",
)
async def upload_back_chapter(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_upload):
        return
    data = await state.get_data()
    manhwa_id = data.get("manhwa_id")
    await state.clear()
    reset_prompt(callback.from_user.id)
    if manhwa_id:
        await state.update_data(manhwa_id=manhwa_id)
        await state.set_state(UploadChapter.chapter_number)
        await _prompt_chapter(callback.message, manhwa_id)
    else:
        await callback.message.answer(
            "No manhwa selected.",
            reply_markup=main_menu_kb(get_user_lang(callback.from_user.id)),
        )
    await callback.answer()


@router.message(UploadChapter.upload, F.document | F.photo)
async def upload_file(message: Message, state: FSMContext) -> None:
    if not await ensure_access(message, can_upload):
        return
    data = await state.get_data()
    if not data.get("manhwa_id") or not data.get("chapter_number"):
        await state.clear()
        untrack(message.chat.id, message.from_user.id)
        reset_prompt(message.from_user.id)
        await message.answer(
            "Upload session expired. Returning to main menu.",
            reply_markup=main_menu_kb(get_user_lang(message.from_user.id)),
        )
        return
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    local_path = None

    if message.document:
        file_size = message.document.file_size or 0
        if file_size > TELEGRAM_SAFE_FILE_BYTES:
            await message.answer(
                "File too large for Telegram upload.\n"
                f"Size: {_size(file_size)} • Limit: {_size(TELEGRAM_SAFE_FILE_BYTES)}\n\n"
                "Send a direct file URL (http/https) or upload the file to a channel and use the ingest flow."
            )
            return
        file = await message.bot.get_file(message.document.file_id)
        local_path = UPLOADS_DIR / message.document.file_name
        await message.bot.download_file(file.file_path, destination=local_path)
    elif message.photo:
        file = await message.bot.get_file(message.photo[-1].file_id)
        local_path = UPLOADS_DIR / f"chapter_{message.from_user.id}.jpg"
        await message.bot.download_file(file.file_path, destination=local_path)

    await _analyze_upload_path(message, state, local_path)


@router.message(UploadChapter.upload, F.text & ~F.text.in_(menu_labels_all()))
async def upload_text_or_invalid(message: Message, state: FSMContext) -> None:
    if not await ensure_access(message, can_upload):
        return
    text = (message.text or "").strip()
    if not _is_url(text):
        await state.clear()
        untrack(message.chat.id, message.from_user.id)
        reset_prompt(message.from_user.id)
        lang = get_user_lang(message.from_user.id)
        await message.answer(
            "Please send a file (PDF/ZIP/RAR/IMG) or a direct file URL.",
            reply_markup=main_menu_kb(lang),
        )
        return

    data = await state.get_data()
    if not data.get("manhwa_id") or not data.get("chapter_number"):
        await state.clear()
        untrack(message.chat.id, message.from_user.id)
        reset_prompt(message.from_user.id)
        await message.answer(
            "Upload session expired. Returning to main menu.",
            reply_markup=main_menu_kb(get_user_lang(message.from_user.id)),
        )
        return

    try:
        status_message = await message.answer("Downloading file")
        local_path = await asyncio.to_thread(_download_external_file, text, UPLOADS_DIR)
        await status_message.edit_text("Analyzing file")
        await _analyze_upload_path(message, state, local_path, status_message=status_message)
    except Exception as exc:  # noqa: BLE001
        logging.exception("URL upload failed")
        await state.clear()
        untrack(message.chat.id, message.from_user.id)
        reset_prompt(message.from_user.id)
        lang = get_user_lang(message.from_user.id)
        await message.answer(
            f"Upload failed: {exc}",
            reply_markup=main_menu_kb(lang),
        )


@router.callback_query(UploadChapter.review, F.data == "upload:change")
async def upload_change_settings(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_upload):
        return
    lang = get_user_lang(callback.from_user.id)
    await callback.message.answer(
        "Select quality mode for this upload:", reply_markup=inline_quality_choice_kb(lang=lang)
    )
    await callback.answer()


@router.callback_query(UploadChapter.review, F.data.startswith("upload:quality:"))
async def upload_quality_select(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_upload):
        return
    mode = callback.data.split("upload:quality:")[-1]
    await state.update_data(quality_override=mode)
    lang = get_user_lang(callback.from_user.id)
    await callback.message.answer(
        f"Quality set to: {mode}. Confirm upload?",
        reply_markup=inline_confirm_kb("upload:confirm", "upload:change", "upload:back:chapter", lang=lang),
    )
    await callback.answer()


@router.callback_query(UploadChapter.review, F.data == "upload:confirm")
async def upload_confirm(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_upload):
        return
    data = await state.get_data()
    manhwa_id = data.get("manhwa_id")
    chapter_number = data.get("chapter_number")
    upload_path = data.get("upload_path")
    if not manhwa_id or not chapter_number or not upload_path:
        await state.clear()
        untrack(callback.message.chat.id, callback.from_user.id)
        reset_prompt(callback.from_user.id)
        await callback.message.answer(
            "Upload session expired. Returning to main menu.",
            reply_markup=main_menu_kb(get_user_lang(callback.from_user.id)),
        )
        await callback.answer()
        return
    try:
        existing = processor.get_chapter_numbers(MANHWA_PATH, manhwa_id)
        conflict = analyze_chapter_conflict(existing, chapter_number)
        if conflict.exists and not data.get("overwrite", False):
            await callback.message.answer(
                f"Chapter {chapter_number} already exists. What should I do?",
                reply_markup=inline_conflict_kb(conflict.suggested_new, lang=get_user_lang(callback.from_user.id)),
            )
            await state.update_data(conflict_suggested=conflict.suggested_new)
            await callback.answer()
            return
        progress_message = await callback.message.answer("Converting pages...")
        loop = asyncio.get_running_loop()
        last_text = {"value": ""}

        def progress_callback(stage: str, current: int | None = None, total: int | None = None) -> None:
            if stage == "converting" and current is not None and total is not None:
                text = f"Converting pages {current}/{total}"
            else:
                text = stage
            if text == last_text["value"]:
                return
            last_text["value"] = text
            asyncio.run_coroutine_threadsafe(progress_message.edit_text(text), loop)

        settings = processor.load_settings(SETTINGS_PATH)
        result = await asyncio.to_thread(
            processor.process_upload,
            manhwa_id,
            chapter_number,
            Path(upload_path),
            MANHWA_PATH,
            PUBLIC_DIR,
            settings,
            data.get("overwrite", False),
            data.get("quality_override") or data.get("suggested_mode"),
            progress_callback,
            False,
        )
        await progress_message.edit_text("Deploying")
        await asyncio.to_thread(processor.trigger_deploy)
        processor.log_action(
            user_id=callback.from_user.id,
            action=f"Uploaded chapter {chapter_number} - {manhwa_id}",
            logs_path=LOGS_PATH,
        )
        await state.clear()
        reset_prompt(callback.from_user.id)
        await state.update_data(manhwa_id=manhwa_id)
        await state.set_state(UploadChapter.chapter_number)
        await callback.message.answer(
            f"Upload complete. Pages: {result['pages_count']}",
        )
        await _prompt_chapter(callback.message, manhwa_id)
    except Exception as exc:  # noqa: BLE001
        logging.exception("Upload confirm failed")
        await state.clear()
        untrack(callback.message.chat.id, callback.from_user.id)
        reset_prompt(callback.from_user.id)
        lang = get_user_lang(callback.from_user.id)
        await callback.message.answer(
            f"Upload failed: {exc}",
            reply_markup=main_menu_kb(lang),
        )
    await callback.answer()


@router.callback_query(UploadChapter.delete_confirm, F.data == "upload:delete:confirm")
async def upload_delete_confirm(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_upload):
        return
    data = await state.get_data()
    manhwa_id = data.get("manhwa_id")
    chapter_number = data.get("chapter_number")
    if not manhwa_id or not chapter_number:
        await state.clear()
        untrack(callback.message.chat.id, callback.from_user.id)
        reset_prompt(callback.from_user.id)
        await callback.message.answer(
            "No chapter selected.",
            reply_markup=main_menu_kb(get_user_lang(callback.from_user.id)),
        )
        await callback.answer()
        return
    try:
        processor.delete_chapter(MANHWA_PATH, PUBLIC_DIR, manhwa_id, chapter_number)
        processor.log_action(
            user_id=callback.from_user.id,
            action=f"Deleted chapter {chapter_number} - {manhwa_id}",
            logs_path=LOGS_PATH,
        )
        await state.clear()
        untrack(callback.message.chat.id, callback.from_user.id)
        reset_prompt(callback.from_user.id)
        await callback.message.answer(
            f"Chapter deleted: {chapter_number}",
            reply_markup=main_menu_kb(get_user_lang(callback.from_user.id)),
        )
    except Exception:  # noqa: BLE001
        logging.exception("Failed to delete chapter %s %s", manhwa_id, chapter_number)
        await state.clear()
        untrack(callback.message.chat.id, callback.from_user.id)
        reset_prompt(callback.from_user.id)
        await callback.message.answer(
            "Failed to delete chapter.",
            reply_markup=main_menu_kb(get_user_lang(callback.from_user.id)),
        )
    await callback.answer()


@router.message(UploadChapter.review, F.text & ~F.text.in_(menu_labels_all()))
async def upload_review_invalid(message: Message, state: FSMContext) -> None:
    await state.clear()
    untrack(message.chat.id, message.from_user.id)
    reset_prompt(message.from_user.id)
    lang = get_user_lang(message.from_user.id)
    await message.answer(
        "Please confirm, change settings, or cancel.",
        reply_markup=main_menu_kb(lang),
    )


@router.message(
    StateFilter(UploadChapter.manhwa_id, UploadChapter.chapter_number, UploadChapter.review, UploadChapter.delete_confirm),
    ~F.text,
)
async def upload_invalid_non_text(message: Message, state: FSMContext) -> None:
    await state.clear()
    untrack(message.chat.id, message.from_user.id)
    reset_prompt(message.from_user.id)
    lang = get_user_lang(message.from_user.id)
    await message.answer("Invalid input. Returning to main menu.", reply_markup=main_menu_kb(lang))


@router.message(
    StateFilter(UploadChapter.manhwa_id, UploadChapter.chapter_number, UploadChapter.delete_confirm),
    F.text & ~F.text.in_(menu_labels_all()),
)
async def upload_invalid_text_select(message: Message, state: FSMContext) -> None:
    await state.clear()
    untrack(message.chat.id, message.from_user.id)
    reset_prompt(message.from_user.id)
    lang = get_user_lang(message.from_user.id)
    await message.answer("Invalid input. Returning to main menu.", reply_markup=main_menu_kb(lang))


@router.message(UploadChapter.upload, ~F.document & ~F.photo & ~F.text)
async def upload_invalid_media(message: Message, state: FSMContext) -> None:
    await state.clear()
    untrack(message.chat.id, message.from_user.id)
    reset_prompt(message.from_user.id)
    lang = get_user_lang(message.from_user.id)
    await message.answer("Invalid file type. Returning to main menu.", reply_markup=main_menu_kb(lang))


@router.callback_query(UploadChapter.review, F.data == "upload:conflict:replace")
async def upload_conflict_replace(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_upload):
        return
    await state.update_data(overwrite=True)
    lang = get_user_lang(callback.from_user.id)
    await callback.message.answer(
        "Replace selected. Confirm upload?",
        reply_markup=inline_confirm_kb("upload:confirm", "upload:change", "upload:back:chapter", lang=lang),
    )
    await callback.answer()


@router.callback_query(UploadChapter.review, F.data.startswith("upload:conflict:new:"))
async def upload_conflict_new(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_access(callback, can_upload):
        return
    new_number = callback.data.split("upload:conflict:new:")[-1]
    await state.update_data(chapter_number=new_number, overwrite=False)
    lang = get_user_lang(callback.from_user.id)
    await callback.message.answer(
        f"New chapter set to {new_number}. Confirm upload?",
        reply_markup=inline_confirm_kb("upload:confirm", "upload:change", "upload:back:chapter", lang=lang),
    )
    await callback.answer()


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


def _load_public_manhwa() -> list[dict]:
    return processor.load_manhwa(MANHWA_PATH)


def _build_id_map(manhwas: list[dict]) -> dict[str, str]:
    return {str(idx): str(item.get("id", "")) for idx, item in enumerate(manhwas) if item.get("id")}


def _resolve_manhwa_id(raw_id: str, id_map: dict | None) -> str | None:
    if id_map and raw_id in id_map:
        return id_map[raw_id]
    if processor.get_manhwa_by_id(MANHWA_PATH, raw_id):
        return raw_id
    return None


def _format_analysis(analysis) -> str:
    warnings = []
    if analysis.blank_pages:
        warnings.append(f"Blank pages removed: {len(analysis.blank_pages)}")
    if analysis.corrupted_pages:
        warnings.append(f"Corrupted pages skipped: {len(analysis.corrupted_pages)}")
    if analysis.possible_cover:
        warnings.append("Possible cover page detected")
    warn_text = "\n".join([f"• {item}" for item in warnings]) or "• No issues detected"
    return (
        "🤖 AI Analysis:\n"
        f"• Pages: {analysis.page_count}\n"
        f"• Format: {analysis.orientation}\n"
        f"• Suggested mode: {analysis.suggested_mode}\n"
        f"{warn_text}\n\n"
        "Proceed?"
    )


async def _analyze_upload_path(
    message: Message,
    state: FSMContext,
    local_path: Path | None,
    status_message: Message | None = None,
) -> None:
    try:
        if status_message is None:
            status_message = await message.answer("Analyzing file")
        analysis_result = await asyncio.to_thread(processor.analyze_upload, local_path)
        analysis = analysis_result["analysis"]
        suggested_mode = analysis.suggested_mode
        await state.update_data(
            upload_path=str(local_path),
            suggested_mode=suggested_mode,
        )
        await state.set_state(UploadChapter.review)
        summary = _format_analysis(analysis)
        lang = get_user_lang(message.from_user.id)
        await status_message.edit_text("Analysis complete")
        await message.answer(
            summary,
            reply_markup=inline_confirm_kb("upload:confirm", "upload:change", "upload:back:chapter", lang=lang),
        )
    except Exception as exc:  # noqa: BLE001
        logging.exception("Upload analysis failed")
        await state.clear()
        untrack(message.chat.id, message.from_user.id)
        reset_prompt(message.from_user.id)
        lang = get_user_lang(message.from_user.id)
        await message.answer(
            f"Upload failed: {exc}",
            reply_markup=main_menu_kb(lang),
        )


def _is_url(value: str) -> bool:
    try:
        parsed = urlparse(value)
    except Exception:  # noqa: BLE001
        return False
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


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


def _size(size: int) -> str:
    if size < 1024:
        return f"{size} B"
    if size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    return f"{size / (1024 * 1024):.1f} MB"

