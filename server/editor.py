from __future__ import annotations

from pathlib import Path
from typing import List

from .processor import load_manhwa, save_manhwa


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
            existing = chapter.get("pages", [])
            if remove:
                for name in remove:
                    if name in existing:
                        existing.remove(name)
                    target = chapter_dir / name
                    if target.exists():
                        target.unlink()
            if pages:
                chapter["pages"] = pages
            else:
                chapter["pages"] = existing
            save_manhwa(manhwa_path, manhwas)
            return chapter["pages"]
    raise ValueError("Chapter not found.")

