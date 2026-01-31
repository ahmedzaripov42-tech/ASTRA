from __future__ import annotations

from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
    WebAppInfo,
)

from .config import QUALITY_MODES, WEBAPP_URL
from .i18n import button_label, menu_label


def main_menu_kb(lang: str) -> ReplyKeyboardMarkup:
    mini_app_btn = (
        KeyboardButton(text=menu_label("webapp", lang), web_app=WebAppInfo(url=WEBAPP_URL))
        if WEBAPP_URL
        else KeyboardButton(text=menu_label("webapp", lang))
    )
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text=menu_label("manhwa", lang)), KeyboardButton(text=menu_label("upload", lang))],
            [KeyboardButton(text=menu_label("ingest", lang)), mini_app_btn],
            [KeyboardButton(text=menu_label("quality", lang)), KeyboardButton(text=menu_label("rules", lang))],
            [KeyboardButton(text=menu_label("settings", lang)), KeyboardButton(text=menu_label("deploy", lang))],
            [KeyboardButton(text=menu_label("admins", lang)), KeyboardButton(text=menu_label("logs", lang))],
        ],
        resize_keyboard=True,
    )


def quality_kb(lang: str) -> ReplyKeyboardMarkup:
    rows = [[KeyboardButton(text=label)] for label in QUALITY_MODES.values()]
    rows.append([KeyboardButton(text=button_label("back", lang))])
    return ReplyKeyboardMarkup(keyboard=rows, resize_keyboard=True)


def inline_cancel_back_kb(back_data: str | None = None, lang: str = "uz") -> InlineKeyboardMarkup:
    buttons = []
    if back_data:
        buttons.append(InlineKeyboardButton(text=button_label("back", lang), callback_data=back_data))
    buttons.append(InlineKeyboardButton(text=button_label("cancel", lang), callback_data="flow:cancel"))
    return InlineKeyboardMarkup(inline_keyboard=[buttons])


def inline_confirm_kb(
    confirm_data: str,
    change_data: str | None = None,
    back_data: str | None = None,
    lang: str = "uz",
) -> InlineKeyboardMarkup:
    buttons = [InlineKeyboardButton(text=button_label("confirm", lang), callback_data=confirm_data)]
    if change_data:
        buttons.append(InlineKeyboardButton(text=button_label("change", lang), callback_data=change_data))
    if back_data:
        buttons.append(InlineKeyboardButton(text=button_label("back", lang), callback_data=back_data))
    buttons.append(InlineKeyboardButton(text=button_label("cancel", lang), callback_data="flow:cancel"))
    return InlineKeyboardMarkup(inline_keyboard=[buttons])


def inline_manhwa_kb(
    manhwas: list[dict],
    lang: str = "uz",
    callback_prefix: str = "upload:manhwa:",
    use_index: bool = False,
    page: int = 0,
    page_size: int = 30,
    nav_prefix: str | None = None,
) -> InlineKeyboardMarkup:
    rows = []
    total = len(manhwas)
    total_pages = max(1, (total + page_size - 1) // page_size)
    page = max(0, min(page, total_pages - 1))
    start = page * page_size
    end = start + page_size
    for idx, item in enumerate(manhwas[start:end], start=start):
        value = str(idx) if use_index else str(item.get("id") or idx)
        rows.append(
            [InlineKeyboardButton(text=item["title"], callback_data=f"{callback_prefix}{value}")]
        )
    if total_pages > 1 and nav_prefix:
        nav_row = []
        if page > 0:
            nav_row.append(
                InlineKeyboardButton(text="⬅ Prev", callback_data=f"{nav_prefix}{page - 1}")
            )
        nav_row.append(InlineKeyboardButton(text=f"{page + 1}/{total_pages}", callback_data="noop"))
        if page < total_pages - 1:
            nav_row.append(
                InlineKeyboardButton(text="Next ➡", callback_data=f"{nav_prefix}{page + 1}")
            )
        rows.append(nav_row)
    rows.append([InlineKeyboardButton(text=button_label("cancel", lang), callback_data="flow:cancel")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def inline_chapter_kb(
    existing: list[str],
    suggestions: list[str],
    back_data: str,
    lang: str = "uz",
) -> InlineKeyboardMarkup:
    rows = []
    if existing:
        rows.append([InlineKeyboardButton(text="📌 Existing Chapters", callback_data="noop")])
        for chapter in existing:
            rows.append(
                [
                    InlineKeyboardButton(
                        text=f"{button_label('replace', lang)} {chapter}",
                        callback_data=f"upload:chapter:replace:{chapter}",
                    )
                ]
            )
            rows.append(
                [
                    InlineKeyboardButton(
                        text=f"🗑 Delete {chapter}",
                        callback_data=f"upload:chapter:delete:{chapter}",
                    )
                ]
            )
    rows.append([InlineKeyboardButton(text="➕ New Chapter", callback_data="noop")])
    for chapter in suggestions:
        rows.append(
            [
                InlineKeyboardButton(
                    text=f"{button_label('create', lang)} {chapter}",
                    callback_data=f"upload:chapter:new:{chapter}",
                )
            ]
        )
    rows.append(
        [
            InlineKeyboardButton(text=button_label("back", lang), callback_data=back_data),
            InlineKeyboardButton(text=button_label("cancel", lang), callback_data="flow:cancel"),
        ]
    )
    return InlineKeyboardMarkup(inline_keyboard=rows)


def inline_quality_choice_kb(lang: str = "uz") -> InlineKeyboardMarkup:
    rows = []
    for key, label in QUALITY_MODES.items():
        rows.append([InlineKeyboardButton(text=label, callback_data=f"upload:quality:{key}")])
    rows.append([InlineKeyboardButton(text=button_label("cancel", lang), callback_data="flow:cancel")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def inline_conflict_kb(suggested: str, lang: str = "uz") -> InlineKeyboardMarkup:
    rows = [
        [InlineKeyboardButton(text=button_label("replace", lang), callback_data="upload:conflict:replace")],
        [
            InlineKeyboardButton(
                text=f"{button_label('create', lang)} {suggested}",
                callback_data=f"upload:conflict:new:{suggested}",
            )
        ],
        [InlineKeyboardButton(text=button_label("cancel", lang), callback_data="flow:cancel")],
    ]
    return InlineKeyboardMarkup(inline_keyboard=rows)

