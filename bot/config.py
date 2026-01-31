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

UPLOADS_DIR = DATA_DIR / "uploads"

QUALITY_MODES = {
    "original": "Original (100%)",
    "lossless": "Lossless",
    "webtoon": "Webtoon Optimized",
    "smart": "Smart Compress",
}

