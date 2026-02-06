from __future__ import annotations

import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "data"
PUBLIC_DIR = BASE_DIR / "public"
MANHWA_DIR = PUBLIC_DIR / "manhwa"

BOT_TOKEN = os.getenv("BOT_TOKEN", "8541380057:AAEn5xx1LSYSvt2O7SOLTZC57t8rUETcc3c")
BOT_NAME = os.getenv("BOT_NAME", "Manhwa Admin Bot")

GITHUB_REPO = os.getenv("GITHUB_REPO", "")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")
NETLIFY_HOOK = os.getenv("NETLIFY_HOOK", "")
WEBAPP_URL = os.getenv("WEBAPP_URL", "")

ADMINS_PATH = DATA_DIR / "admins.json"
MANHWA_PATH = PUBLIC_DIR / "manhwa.json"
LOGS_PATH = DATA_DIR / "logs.json"
SETTINGS_PATH = DATA_DIR / "settings.json"
CHANNEL_CACHE_PATH = DATA_DIR / "channel_cache.json"
INGEST_HISTORY_PATH = DATA_DIR / "ingest_history.json"
INGEST_STATE_PATH = DATA_DIR / "ingest_state.json"
INGEST_LOGS_PATH = DATA_DIR / "ingest_channel_logs.json"

UPLOADS_DIR = DATA_DIR / "uploads"

TELEGRAM_SAFE_FILE_MB = int(os.getenv("TELEGRAM_SAFE_FILE_MB", "20"))
TELEGRAM_SAFE_FILE_BYTES = TELEGRAM_SAFE_FILE_MB * 1024 * 1024

AUTO_INGEST_ALLOWED_EXTENSIONS = {
    ext.strip().lower()
    for ext in os.getenv("AUTO_INGEST_ALLOWED_EXTENSIONS", ".pdf,.zip,.rar,.cbz,.jpg,.jpeg,.png").split(",")
    if ext.strip()
}
AUTO_INGEST_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"} & AUTO_INGEST_ALLOWED_EXTENSIONS
AUTO_INGEST_SANITY_MULTIPLIER = float(os.getenv("AUTO_INGEST_SANITY_MULTIPLIER", "3"))
AUTO_INGEST_CHANNEL_DEFAULT_MIN_COUNT = int(os.getenv("AUTO_INGEST_CHANNEL_DEFAULT_MIN_COUNT", "2"))
AUTO_INGEST_CHANNEL_DEFAULT_MIN_SCORE = float(os.getenv("AUTO_INGEST_CHANNEL_DEFAULT_MIN_SCORE", "0.9"))

QUALITY_MODES = {
    "original": "Original (100%)",
    "lossless": "Lossless",
    "webtoon": "Webtoon Optimized",
    "smart": "Smart Compress",
}

INGEST_CACHE_LIMIT = int(os.getenv("INGEST_CACHE_LIMIT", "5000"))

CATALOG_CHANNELS = [
    "webman_olami_katalog",
    "kurokamikatalog",
]

SOURCE_CHANNELS = [
    "kuro_kam1",
    "webman_olami",
]

CATALOG_SOURCE_MAP = {
    "webman_olami_katalog": "webman_olami",
    "kurokamikatalog": "kuro_kam1",
}

