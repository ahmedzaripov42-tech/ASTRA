from __future__ import annotations

from pathlib import Path

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, Message

from ..config import LOGS_PATH, MANHWA_PATH, PUBLIC_DIR, SETTINGS_PATH, UPLOADS_DIR
from ..flow_registry import track, untrack
from ..i18n import get_user_lang, menu_labels, t
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
from ..roles import can_upload, is_blocked
from server import processor
from server.decision_engine import analyze_chapter_conflict

router = Router()


class UploadChapter(StatesGroup):
    manhwa_id = State()
    chapter_number = State()
    upload = State()
    review = State()


@router.message(Command("upload_chapter"))
@router.message(F.text.in_(menu_labels("upload")))
async def upload_start(message: Message, state: FSMContext) -> None:
    if is_blocked(message.from_user.id):
        lang = get_user_lang(message.from_user.id)
        await message.answer(t("access_denied", lang))
        return
    if not can_upload(message.from_user.id):
        lang = get_user_lang(message.from_user.id)
        await message.answer(t("access_denied", lang))
        return
    await state.clear()
    track(message.chat.id, message.from_user.id)
    manhwas = processor.get_manhwa_list(MANHWA_PATH)
    if not manhwas:
        lang = get_user_lang(message.from_user.id)
        await message.answer(t("no_manhwa", lang))
        untrack(message.chat.id, message.from_user.id)
        return
    await state.set_state(UploadChapter.manhwa_id)
    lang = get_user_lang(message.from_user.id)
    await message.answer(
        "Select a manhwa to upload:",
        reply_markup=inline_manhwa_kb(manhwas, lang=lang),
    )


@router.callback_query(F.data.startswith("upload:manhwa:"))
async def upload_select_manhwa(callback: CallbackQuery, state: FSMContext) -> None:
    if await state.get_state() != UploadChapter.manhwa_id.state:
        await callback.answer()
        return
    manhwa_id = callback.data.split("upload:manhwa:")[-1]
    await state.update_data(manhwa_id=manhwa_id)
    await state.set_state(UploadChapter.chapter_number)
    await _prompt_chapter(callback.message, manhwa_id)
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


@router.callback_query(F.data == "upload:back:manhwa")
async def upload_back_manhwa(callback: CallbackQuery, state: FSMContext) -> None:
    manhwas = processor.get_manhwa_list(MANHWA_PATH)
    await state.set_state(UploadChapter.manhwa_id)
    lang = get_user_lang(callback.from_user.id)
    await callback.message.answer("Select a manhwa to upload:", reply_markup=inline_manhwa_kb(manhwas, lang=lang))
    await callback.answer()


@router.callback_query(F.data.startswith("upload:chapter:"))
async def upload_select_chapter(callback: CallbackQuery, state: FSMContext) -> None:
    if await state.get_state() != UploadChapter.chapter_number.state:
        await callback.answer()
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


@router.callback_query(F.data == "upload:back:chapter")
async def upload_back_chapter(callback: CallbackQuery, state: FSMContext) -> None:
    data = await state.get_data()
    manhwa_id = data.get("manhwa_id")
    if manhwa_id:
        await state.set_state(UploadChapter.chapter_number)
        await _prompt_chapter(callback.message, manhwa_id)
    await callback.answer()


@router.message(UploadChapter.upload, F.document | F.photo)
async def upload_file(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    local_path = None

    if message.document:
        file = await message.bot.get_file(message.document.file_id)
        local_path = UPLOADS_DIR / message.document.file_name
        await message.bot.download_file(file.file_path, destination=local_path)
    elif message.photo:
        file = await message.bot.get_file(message.photo[-1].file_id)
        local_path = UPLOADS_DIR / f"chapter_{message.from_user.id}.jpg"
        await message.bot.download_file(file.file_path, destination=local_path)

    try:
        analysis_result = processor.analyze_upload(local_path)
        analysis = analysis_result["analysis"]
        suggested_mode = analysis.suggested_mode
        await state.update_data(
            upload_path=str(local_path),
            suggested_mode=suggested_mode,
        )
        await state.set_state(UploadChapter.review)
        summary = _format_analysis(analysis)
        lang = get_user_lang(message.from_user.id)
        await message.answer(
            summary,
            reply_markup=inline_confirm_kb("upload:confirm", "upload:change", "upload:back:chapter", lang=lang),
        )
    except Exception as exc:  # noqa: BLE001
        lang = get_user_lang(message.from_user.id)
        await message.answer(
            f"Upload failed: {exc}",
            reply_markup=inline_cancel_back_kb("upload:back:chapter", lang=lang),
        )


@router.message(UploadChapter.upload)
async def upload_invalid(message: Message) -> None:
    lang = get_user_lang(message.from_user.id)
    await message.answer(
        "Please send a file (PDF/ZIP/RAR/IMG).",
        reply_markup=inline_cancel_back_kb("upload:back:chapter", lang=lang),
    )


@router.callback_query(F.data == "upload:change")
async def upload_change_settings(callback: CallbackQuery, state: FSMContext) -> None:
    lang = get_user_lang(callback.from_user.id)
    await callback.message.answer(
        "Select quality mode for this upload:", reply_markup=inline_quality_choice_kb(lang=lang)
    )
    await callback.answer()


@router.callback_query(F.data.startswith("upload:quality:"))
async def upload_quality_select(callback: CallbackQuery, state: FSMContext) -> None:
    mode = callback.data.split("upload:quality:")[-1]
    await state.update_data(quality_override=mode)
    lang = get_user_lang(callback.from_user.id)
    await callback.message.answer(
        f"Quality set to: {mode}. Confirm upload?",
        reply_markup=inline_confirm_kb("upload:confirm", "upload:change", "upload:back:chapter", lang=lang),
    )
    await callback.answer()


@router.callback_query(F.data == "upload:confirm")
async def upload_confirm(callback: CallbackQuery, state: FSMContext) -> None:
    data = await state.get_data()
    try:
        existing = processor.get_chapter_numbers(MANHWA_PATH, data["manhwa_id"])
        conflict = analyze_chapter_conflict(existing, data["chapter_number"])
        if conflict.exists and not data.get("overwrite", False):
            await callback.message.answer(
                f"Chapter {data['chapter_number']} already exists. What should I do?",
                reply_markup=inline_conflict_kb(conflict.suggested_new, lang=get_user_lang(callback.from_user.id)),
            )
            await state.update_data(conflict_suggested=conflict.suggested_new)
            await callback.answer()
            return
        settings = processor.load_settings(SETTINGS_PATH)
        result = processor.process_upload(
            manhwa_id=data["manhwa_id"],
            chapter_number=data["chapter_number"],
            upload_path=Path(data["upload_path"]),
            manhwa_path=MANHWA_PATH,
            public_dir=PUBLIC_DIR,
            settings=settings,
            overwrite=data.get("overwrite", False),
            quality_override=data.get("quality_override") or data.get("suggested_mode"),
        )
        processor.log_action(
            user_id=callback.from_user.id,
            action=f"Uploaded chapter {data['chapter_number']} - {data['manhwa_id']}",
            logs_path=LOGS_PATH,
        )
        await state.clear()
        reset_prompt(callback.from_user.id)
        await callback.message.answer(
            f"Upload complete. Pages: {result['pages_count']}",
            reply_markup=main_menu_kb(get_user_lang(callback.from_user.id)),
        )
        untrack(callback.message.chat.id, callback.from_user.id)
    except Exception as exc:  # noqa: BLE001
        lang = get_user_lang(callback.from_user.id)
        await callback.message.answer(
            f"Upload failed: {exc}",
            reply_markup=inline_cancel_back_kb("upload:back:chapter", lang=lang),
        )
    await callback.answer()


@router.message(UploadChapter.review)
async def upload_review_invalid(message: Message, state: FSMContext) -> None:
    lang = get_user_lang(message.from_user.id)
    await message.answer(
        "Please confirm, change settings, or cancel.",
        reply_markup=inline_confirm_kb("upload:confirm", "upload:change", "upload:back:chapter", lang=lang),
    )


@router.callback_query(F.data == "upload:conflict:replace")
async def upload_conflict_replace(callback: CallbackQuery, state: FSMContext) -> None:
    await state.update_data(overwrite=True)
    lang = get_user_lang(callback.from_user.id)
    await callback.message.answer(
        "Replace selected. Confirm upload?",
        reply_markup=inline_confirm_kb("upload:confirm", "upload:change", "upload:back:chapter", lang=lang),
    )
    await callback.answer()


@router.callback_query(F.data.startswith("upload:conflict:new:"))
async def upload_conflict_new(callback: CallbackQuery, state: FSMContext) -> None:
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

