from __future__ import annotations

import json
import shutil
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

from .ai_analyzer import analyze_images
from .file_detector import detect_file
from .image_tools import apply_dmca_guard, generate_cover, optimize_image
from .pdf_to_img import pdf_to_images


QUALITY_LABELS = {
    "Original (100%)": "original",
    "Lossless": "lossless",
    "Webtoon Optimized": "webtoon",
    "Smart Compress": "smart",
}


def load_settings(settings_path: Path) -> Dict:
    if not settings_path.exists():
        default = {
            "quality_mode": "lossless",
            "auto_deploy": False,
            "dmca_watermark_text": "",
            "dmca_watermark_opacity": 0.0,
        }
        save_settings(settings_path, default)
        return default
    with settings_path.open("r", encoding="utf-8") as file:
        return json.load(file)


def save_settings(settings_path: Path, data: Dict) -> None:
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    with settings_path.open("w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)


def load_manhwa(manhwa_path: Path) -> List[Dict]:
    if not manhwa_path.exists():
        manhwa_path.parent.mkdir(parents=True, exist_ok=True)
        with manhwa_path.open("w", encoding="utf-8") as file:
            json.dump([], file)
        return []
    with manhwa_path.open("r", encoding="utf-8") as file:
        return json.load(file)


def save_manhwa(manhwa_path: Path, data: List[Dict]) -> None:
    manhwa_path.parent.mkdir(parents=True, exist_ok=True)
    with manhwa_path.open("w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)
    _sync_public_manhwa(manhwa_path, data)


def get_manhwa_list(manhwa_path: Path) -> List[Dict]:
    return load_manhwa(manhwa_path)


def get_manhwa_by_id(manhwa_path: Path, manhwa_id: str) -> Optional[Dict]:
    manhwas = load_manhwa(manhwa_path)
    for item in manhwas:
        if item["id"] == manhwa_id:
            return item
    return None


def get_chapter_numbers(manhwa_path: Path, manhwa_id: str) -> List[str]:
    manhwa = get_manhwa_by_id(manhwa_path, manhwa_id)
    if not manhwa:
        return []
    return [str(ch["number"]) for ch in manhwa.get("chapters", [])]


def add_manhwa(
    title: str,
    genres: List[str],
    status: str,
    cover_path: Optional[Path],
    manhwa_path: Path,
    public_dir: Path,
    settings: Dict,
) -> Dict:
    manhwas = load_manhwa(manhwa_path)
    manhwa_id = _slugify(title)
    if any(item["id"] == manhwa_id for item in manhwas):
        raise ValueError("Manhwa already exists.")

    cover_rel = f"/covers/{manhwa_id}.jpg"
    cover_output = public_dir / cover_rel.lstrip("/")
    generate_cover(title, cover_output, cover_path)

    entry = {
        "id": manhwa_id,
        "title": title,
        "genres": genres,
        "status": status,
        "cover": cover_rel,
        "chapters": [],
    }
    manhwas.append(entry)
    save_manhwa(manhwa_path, manhwas)
    return entry


def add_chapter(
    manhwa_path: Path,
    manhwa_id: str,
    chapter_number: str,
    pages: List[str],
    overwrite: bool = False,
) -> None:
    manhwas = load_manhwa(manhwa_path)
    for item in manhwas:
        if item["id"] == manhwa_id:
            for chapter in item["chapters"]:
                if str(chapter["number"]) == str(chapter_number):
                    if not overwrite:
                        raise ValueError("Chapter already exists.")
                    chapter["pages"] = pages
                    chapter["path"] = f"/manhwa/{manhwa_id}/chapter-{chapter_number}/"
                    save_manhwa(manhwa_path, manhwas)
                    return
            item["chapters"].append(
                {
                    "number": chapter_number,
                    "pages": pages,
                    "path": f"/manhwa/{manhwa_id}/chapter-{chapter_number}/",
                }
            )
            save_manhwa(manhwa_path, manhwas)
            return
    raise ValueError("Manhwa not found.")


def analyze_upload(upload_path: Path) -> Dict:
    if not upload_path:
        raise ValueError("Upload file not found.")
    file_type = detect_file(upload_path)
    if file_type == "UNKNOWN":
        raise ValueError("Unsupported file type.")

    temp_dir = Path(tempfile.mkdtemp(prefix="manhwa_analyze_"))
    try:
        _extract_to_temp(upload_path, file_type, temp_dir)
        images = _gather_images(temp_dir)
        analysis = analyze_images(images)
        cleaned = [img for img in images if img not in analysis.blank_pages and img not in analysis.corrupted_pages]
        return {
            "file_type": file_type,
            "analysis": analysis,
            "pages_count": len(cleaned),
            "cleaned_count": len(cleaned),
        }
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def process_upload(
    manhwa_id: str,
    chapter_number: str,
    upload_path: Path,
    manhwa_path: Path,
    public_dir: Path,
    settings: Dict,
    overwrite: bool = False,
    quality_override: Optional[str] = None,
) -> Dict:
    if not upload_path:
        raise ValueError("Upload file not found.")
    file_type = detect_file(upload_path)
    if file_type == "UNKNOWN":
        raise ValueError("Unsupported file type.")

    chapter_dir = public_dir / "manhwa" / manhwa_id / f"chapter-{chapter_number}"
    if overwrite and chapter_dir.exists():
        shutil.rmtree(chapter_dir, ignore_errors=True)
    chapter_dir.mkdir(parents=True, exist_ok=True)

    temp_dir = Path(tempfile.mkdtemp(prefix="manhwa_upload_"))
    try:
        _extract_to_temp(upload_path, file_type, temp_dir)
        images = _gather_images(temp_dir)
        analysis = analyze_images(images)
        cleaned = [img for img in images if img not in analysis.blank_pages and img not in analysis.corrupted_pages]
        if not cleaned:
            raise ValueError("No valid pages found after cleanup.")

        pages = _process_images(
            cleaned,
            chapter_dir,
            mode=quality_override or settings.get("quality_mode", "lossless"),
            dmca_text=settings.get("dmca_watermark_text", ""),
            dmca_opacity=settings.get("dmca_watermark_opacity", 0.0),
        )
        add_chapter(manhwa_path, manhwa_id, chapter_number, pages, overwrite=overwrite)
        return {"pages_count": len(pages), "pages": pages, "analysis": analysis}
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def log_action(user_id: int, action: str, logs_path: Path) -> None:
    logs_path.parent.mkdir(parents=True, exist_ok=True)
    if logs_path.exists():
        with logs_path.open("r", encoding="utf-8") as file:
            logs = json.load(file)
    else:
        logs = []
    logs.append(
        {
            "time": datetime.utcnow().isoformat(timespec="seconds"),
            "user": user_id,
            "action": action,
        }
    )
    with logs_path.open("w", encoding="utf-8") as file:
        json.dump(logs, file, ensure_ascii=False, indent=2)


def _extract_zip(zip_path: Path, output_dir: Path) -> None:
    import zipfile

    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(output_dir)


def _extract_rar(rar_path: Path, output_dir: Path) -> None:
    try:
        import rarfile
    except ImportError as exc:  # noqa: BLE001
        raise ValueError("RAR support requires 'rarfile' package.") from exc

    with rarfile.RarFile(rar_path) as rf:
        rf.extractall(output_dir)


def _process_images(
    image_paths: List[Path],
    chapter_dir: Path,
    mode: str,
    dmca_text: str,
    dmca_opacity: float,
) -> List[str]:
    if not image_paths:
        raise ValueError("No images found in upload.")
    pages: List[str] = []
    for index, image_path in enumerate(image_paths, start=1):
        output_path = chapter_dir / f"{index:03}.jpg"
        if mode == "original" and image_path.suffix.lower() in {".jpg", ".jpeg"}:
            shutil.copy(image_path, output_path)
        else:
            shutil.copy(image_path, output_path)
            optimize_image(output_path, mode)
        apply_dmca_guard(output_path, dmca_text, dmca_opacity)
        pages.append(output_path.name)
    return pages


def _slugify(text: str) -> str:
    text = text.lower().strip()
    result = []
    prev_dash = False
    for char in text:
        if char.isalnum():
            result.append(char)
            prev_dash = False
        else:
            if not prev_dash:
                result.append("-")
                prev_dash = True
    slug = "".join(result).strip("-")
    return slug or "manhwa"


def _sync_public_manhwa(manhwa_path: Path, data: List[Dict]) -> None:
    if manhwa_path.name != "manhwa.json":
        return
    public_path = manhwa_path.parents[1] / "public" / "data" / "manhwa.json"
    public_path.parent.mkdir(parents=True, exist_ok=True)
    with public_path.open("w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)


def _extract_to_temp(upload_path: Path, file_type: str, temp_dir: Path) -> None:
    if file_type == "PDF":
        pdf_to_images(upload_path, temp_dir)
        return
    if file_type == "ZIP":
        _extract_zip(upload_path, temp_dir)
        return
    if file_type == "RAR":
        _extract_rar(upload_path, temp_dir)
        return
    if file_type == "IMAGES":
        shutil.copy(upload_path, temp_dir / upload_path.name)


def _gather_images(source_dir: Path) -> List[Path]:
    images = [p for p in source_dir.rglob("*") if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}]
    return sorted(images, key=_natural_key)


def _natural_key(path: Path) -> tuple:
    stem = path.stem
    digits = "".join([c if c.isdigit() else " " for c in stem]).split()
    number = int(digits[0]) if digits else 0
    return (number, stem.lower())

