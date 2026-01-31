from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import List

from .processor import delete_chapter, load_manhwa, save_manhwa


def update_chapter_pages(
    manhwa_path: Path,
    public_dir: Path,
    manhwa_id: str,
    chapter_number: str,
    pages: List[str],
    remove: List[str],
) -> List[str]:
    manhwas = load_manhwa(manhwa_path)
    chapter_dir = public_dir / "manhwa" / manhwa_id / f"chapter-{chapter_number}"
    for item in manhwas:
        if item["id"] != manhwa_id:
            continue
        for chapter in item.get("chapters", []):
            if str(chapter["number"]) != str(chapter_number):
                continue
            chapter.setdefault("id", f"{manhwa_id}-chapter-{chapter_number}")
            chapter.setdefault("title", f"Chapter {chapter_number}")
            chapter.setdefault("createdAt", datetime.utcnow().isoformat(timespec="seconds"))
            existing = chapter.get("pages", [])
            removed = set()
            if remove:
                for name in remove:
                    if name in existing:
                        existing.remove(name)
                        removed.add(name)
                    target = chapter_dir / name
                    if target.exists():
                        target.unlink()
            if pages:
                removed.update(set(existing) - set(pages))
                chapter["pages"] = pages
            else:
                chapter["pages"] = existing
            for name in removed:
                target = chapter_dir / name
                if target.exists():
                    target.unlink()
            if not chapter["pages"]:
                delete_chapter(manhwa_path, public_dir, manhwa_id, chapter_number)
                return []
            item["updatedAt"] = datetime.utcnow().isoformat(timespec="seconds")
            save_manhwa(manhwa_path, manhwas)
            return chapter["pages"]
    raise ValueError("Chapter not found.")

