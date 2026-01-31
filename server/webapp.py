from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import List

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .editor import update_chapter_pages
from .processor import load_manhwa, normalize_status, save_manhwa
from .telegram_auth import verify_init_data


BASE_DIR = Path(__file__).resolve().parents[1]
PUBLIC_DIR = BASE_DIR / "public"
WEBAPP_DIR = BASE_DIR / "webapp"
MANHWA_PATH = PUBLIC_DIR / "manhwa.json"

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
    if not init_data or not BOT_TOKEN:
        return 0
    try:
        data = verify_init_data(init_data, BOT_TOKEN)
        user_data = json.loads(data.get("user", "{}"))
        return int(user_data.get("id", 0))
    except Exception:  # noqa: BLE001
        return 0


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
        item["status"] = normalize_status(payload.get("status", item["status"]))
        item["updatedAt"] = datetime.utcnow().isoformat(timespec="seconds")
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

