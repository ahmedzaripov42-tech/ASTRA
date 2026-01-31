from __future__ import annotations

import json
from pathlib import Path
from typing import Callable, Dict

from aiogram.types import CallbackQuery, Message

from .config import DATA_DIR
from .roles import is_blocked, is_owner


USERS_PATH = DATA_DIR / "users.json"
DEFAULT_LANG = "uz"
ACCESS_BYPASS = True

STRINGS: Dict[str, Dict[str, str]] = {
    "welcome": {
        "uz": "Manhwa Admin Paneliga xush kelibsiz.",
        "ru": "Добро пожаловать в панель администратора Manhwa.",
    },
    "access_denied": {
        "uz": "Kirish taqiqlangan.",
        "ru": "Доступ запрещен.",
    },
    "choose_language": {
        "uz": "Tilni tanlang:",
        "ru": "Выберите язык:",
    },
    "language_set": {
        "uz": "Til saqlandi.",
        "ru": "Язык сохранен.",
    },
    "no_manhwa": {
        "uz": "Manhwa topilmadi. Avval platformaga manhwa qo‘shing.",
        "ru": "Манхва не найдена. Сначала добавьте.",
    },
    "flow_canceled": {
        "uz": "Jarayon bekor qilindi. Bosh menyu.",
        "ru": "Процесс отменен. Главное меню.",
    },
    "back_to_menu": {
        "uz": "Bosh menyu.",
        "ru": "Главное меню.",
    },
    "states_reset": {
        "uz": "Barcha holatlar tozalandi.",
        "ru": "Все состояния сброшены.",
    },
    "restart_now": {
        "uz": "Bot qayta ishga tushmoqda...",
        "ru": "Перезапуск бота...",
    },
}

MENU_LABELS = {
    "manhwa": {"uz": "📚 Manhwa Management", "ru": "📚 Управление Манхвой"},
    "upload": {"uz": "📤 Upload Chapter", "ru": "📤 Загрузка Главы"},
    "ingest": {"uz": "📥 Channel Ingest", "ru": "📥 Импорт из Канала"},
    "webapp": {"uz": "🧩 Mini App", "ru": "🧩 Мини Приложение"},
    "quality": {"uz": "🖼 Image & Quality", "ru": "🖼 Изображения и Качество"},
    "rules": {"uz": "📂 File Rules", "ru": "📂 Правила Файлов"},
    "settings": {"uz": "⚙ Platform Settings", "ru": "⚙ Настройки Платформы"},
    "deploy": {"uz": "🚀 GitHub / Deploy", "ru": "🚀 GitHub / Деплой"},
    "admins": {"uz": "👤 Admin Management", "ru": "👤 Управление Админами"},
    "logs": {"uz": "📊 Logs & Stats", "ru": "📊 Логи и Статистика"},
}

BUTTON_LABELS = {
    "cancel": {"uz": "❌ Bekor qilish", "ru": "❌ Отмена"},
    "back": {"uz": "⬅ Orqaga", "ru": "⬅ Назад"},
    "confirm": {"uz": "✅ Tasdiqlash", "ru": "✅ Подтвердить"},
    "change": {"uz": "⚙ Sozlash", "ru": "⚙ Настроить"},
    "replace": {"uz": "🔁 Almashtirish", "ru": "🔁 Заменить"},
    "create": {"uz": "🆕 Yaratish", "ru": "🆕 Создать"},
    "reset": {"uz": "🧹 Holatlarni Tozalash", "ru": "🧹 Сбросить Состояния"},
    "restart": {"uz": "🔁 Botni Qayta Ishga Tushirish", "ru": "🔁 Перезапуск Бота"},
}


def t(key: str, lang: str) -> str:
    return STRINGS.get(key, {}).get(lang, STRINGS.get(key, {}).get(DEFAULT_LANG, key))


def menu_label(key: str, lang: str) -> str:
    return MENU_LABELS.get(key, {}).get(lang, MENU_LABELS.get(key, {}).get(DEFAULT_LANG, key))


def menu_labels_all() -> list[str]:
    labels = []
    for labels_map in MENU_LABELS.values():
        labels.extend(labels_map.values())
    return labels


def menu_labels(key: str) -> list[str]:
    return list(MENU_LABELS.get(key, {}).values())


def button_label(key: str, lang: str) -> str:
    return BUTTON_LABELS.get(key, {}).get(lang, BUTTON_LABELS.get(key, {}).get(DEFAULT_LANG, key))


def button_labels_all(key: str) -> list[str]:
    return list(BUTTON_LABELS.get(key, {}).values())


def get_user_lang(user_id: int) -> str:
    if is_owner(user_id):
        return DEFAULT_LANG
    if not USERS_PATH.exists():
        return DEFAULT_LANG
    with USERS_PATH.open("r", encoding="utf-8") as file:
        data = json.load(file)
    return data.get(str(user_id), DEFAULT_LANG)


def has_user_lang(user_id: int) -> bool:
    if not USERS_PATH.exists():
        return False
    with USERS_PATH.open("r", encoding="utf-8") as file:
        data = json.load(file)
    return str(user_id) in data


def set_user_lang(user_id: int, lang: str) -> None:
    USERS_PATH.parent.mkdir(parents=True, exist_ok=True)
    if USERS_PATH.exists():
        with USERS_PATH.open("r", encoding="utf-8") as file:
            data = json.load(file)
    else:
        data = {}
    data[str(user_id)] = lang
    with USERS_PATH.open("w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)


async def ensure_access(event: Message | CallbackQuery, check: Callable[[int], bool], deny_message: str | None = None) -> bool:
    if ACCESS_BYPASS:
        return True
    user = event.from_user
    if not user:
        return False
    if is_blocked(user.id) or not check(user.id):
        lang = get_user_lang(user.id)
        text = deny_message or t("access_denied", lang)
        if isinstance(event, CallbackQuery):
            await event.message.answer(text)
            await event.answer()
        else:
            await event.answer(text)
        return False
    return True

