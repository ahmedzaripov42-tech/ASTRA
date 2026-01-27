from __future__ import annotations

import json
import os
from pathlib import Path
from typing import List

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .editor import update_chapter_pages
from .processor import load_manhwa, save_manhwa
from .telegram_auth import verify_init_data


BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "data"
PUBLIC_DIR = BASE_DIR / "public"
WEBAPP_DIR = BASE_DIR / "webapp"
MANHWA_PATH = DATA_DIR / "manhwa.json"
ADMINS_PATH = DATA_DIR / "admins.json"

BOT_TOKEN = os.getenv("BOT_TOKEN", "")

app = FastAPI(title="Manhwa Admin WebApp")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/app", StaticFiles(directory=WEBAPP_DIR, html=True), name="webapp")
app.mount("/manhwa", StaticFiles(directory=PUBLIC_DIR / "manhwa"), name="manhwa")


def _require_admin(init_data: str = Header(default="")) -> int:
    if not BOT_TOKEN:
        raise HTTPException(status_code=500, detail="BOT_TOKEN is not configured.")
    try:
        data = verify_init_data(init_data, BOT_TOKEN)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    user_data = json.loads(data.get("user", "{}"))
    user_id = int(user_data.get("id", 0))
    if not _is_admin(user_id):
        raise HTTPException(status_code=403, detail="Not authorized.")
    return user_id


def _is_admin(user_id: int) -> bool:
    if not ADMINS_PATH.exists():
        return False
    with ADMINS_PATH.open("r", encoding="utf-8") as file:
        data = json.load(file)
    return (
        user_id in data.get("owner", [])
        or user_id in data.get("admins", [])
        or user_id in data.get("editors", [])
    )


@app.get("/api/manhwa")
def list_manhwa(user_id: int = Depends(_require_admin)) -> List[dict]:
    return load_manhwa(MANHWA_PATH)


@app.get("/api/manhwa/{manhwa_id}")
def get_manhwa(manhwa_id: str, user_id: int = Depends(_require_admin)) -> dict:
    manhwas = load_manhwa(MANHWA_PATH)
    for item in manhwas:
        if item["id"] == manhwa_id:
            return item
    raise HTTPException(status_code=404, detail="Manhwa not found.")


@app.post("/api/manhwa/{manhwa_id}")
def update_manhwa(manhwa_id: str, payload: dict, user_id: int = Depends(_require_admin)) -> dict:
    manhwas = load_manhwa(MANHWA_PATH)
    for item in manhwas:
        if item["id"] != manhwa_id:
            continue
        item["title"] = payload.get("title", item["title"])
        item["genres"] = payload.get("genres", item["genres"])
        item["status"] = payload.get("status", item["status"])
        save_manhwa(MANHWA_PATH, manhwas)
        return item
    raise HTTPException(status_code=404, detail="Manhwa not found.")


@app.post("/api/manhwa/{manhwa_id}/chapters/{chapter_number}/pages")
def update_pages(
    manhwa_id: str,
    chapter_number: str,
    payload: dict,
    user_id: int = Depends(_require_admin),
) -> dict:
    pages = payload.get("pages", [])
    remove = payload.get("remove", [])
    updated = update_chapter_pages(
        manhwa_path=MANHWA_PATH,
        public_dir=PUBLIC_DIR,
        manhwa_id=manhwa_id,
        chapter_number=chapter_number,
        pages=pages,
        remove=remove,
    )
    return {"pages": updated}

