from __future__ import annotations

from pathlib import Path


def detect_file(file_path: str | Path) -> str:
    path = Path(file_path)
    ext = path.suffix.lower()
    if ext == ".pdf":
        return "PDF"
    if ext in {".zip", ".cbz"}:
        return "ZIP"
    if ext == ".rar":
        return "RAR"
    if ext in {".jpg", ".jpeg", ".png", ".webp"}:
        return "IMAGES"
    return "UNKNOWN"

