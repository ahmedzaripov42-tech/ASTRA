from __future__ import annotations

import json
import logging
import posixpath
import shutil
import tempfile
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Callable, Dict, List, Optional, Tuple

from .ai_analyzer import analyze_images
from .file_detector import detect_file
from .github import auto_deploy
from .image_tools import apply_dmca_guard, generate_cover, optimize_image
from .pdf_to_img import pdf_to_images


QUALITY_LABELS = {
    "Original (100%)": "original",
    "Lossless": "lossless",
    "Webtoon Optimized": "webtoon",
    "Smart Compress": "smart",
}
STATUS_VALUES = {"ongoing", "completed"}
IMPORT_MARKER_KEY = "legacy_imported"


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


def _read_manhwa_list(manhwa_path: Path, log_errors: bool = True) -> List[Dict]:
    if not manhwa_path.exists():
        return []
    try:
        with manhwa_path.open("r", encoding="utf-8") as file:
            data = json.load(file)
    except Exception:  # noqa: BLE001
        if log_errors:
            logging.exception("Failed to read manhwa.json at %s", manhwa_path.resolve())
        return []
    if not isinstance(data, list):
        if log_errors:
            logging.error("manhwa.json is not a list at %s", manhwa_path.resolve())
        return []
    return data


def load_manhwa(manhwa_path: Path) -> List[Dict]:
    if not manhwa_path.exists():
        manhwa_path.parent.mkdir(parents=True, exist_ok=True)
        with manhwa_path.open("w", encoding="utf-8") as file:
            json.dump([], file)
        logging.error("manhwa.json missing, created empty file at %s", manhwa_path.resolve())
        return []
    data = _read_manhwa_list(manhwa_path)
    if not data:
        logging.error("manhwa.json is empty at %s", manhwa_path.resolve())
        return []
    base_dir = manhwa_path.parents[1]
    public_dir = manhwa_path.parent
    normalized = _ensure_schema(data, base_dir=base_dir, public_dir=public_dir)
    if normalized is not data:
        save_manhwa(manhwa_path, normalized)
        return normalized
    return data


def save_manhwa(manhwa_path: Path, data: List[Dict], auto_deploy_enabled: bool = True) -> None:
    manhwa_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = manhwa_path.with_suffix(".tmp")
    with temp_path.open("w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)
    temp_path.replace(manhwa_path)
    _sync_public_manhwa(manhwa_path, data)
    if auto_deploy_enabled:
        trigger_deploy()


def trigger_deploy() -> tuple[str, str]:
    git_result, netlify_result = auto_deploy("Manhwa update")
    logging.info("Auto deploy result: %s | %s", git_result, netlify_result)
    return git_result, netlify_result


def get_manhwa_list(manhwa_path: Path) -> List[Dict]:
    manhwas = load_manhwa(manhwa_path)
    try:
        resolved = manhwa_path.resolve()
    except OSError:
        resolved = manhwa_path
    ids = [item.get("id") for item in manhwas]
    logging.info("manhwa source path=%s ids=%s", resolved, ids)
    return manhwas


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

    now = datetime.utcnow().isoformat(timespec="seconds")
    entry = {
        "id": manhwa_id,
        "title": title,
        "slug": manhwa_id,
        "genres": genres,
        "description": "",
        "status": _normalize_status(status),
        "cover": cover_rel,
        "chapters": [],
        "updatedAt": now,
    }
    manhwas.append(entry)
    save_manhwa(manhwa_path, manhwas)
    return entry


def delete_manhwa(manhwa_path: Path, public_dir: Path, manhwa_id: str) -> Dict:
    manhwas = load_manhwa(manhwa_path)
    target = None
    remaining = []
    for item in manhwas:
        if item["id"] == manhwa_id:
            target = item
        else:
            remaining.append(item)
    if not target:
        raise ValueError("Manhwa not found.")
    cover_rel = target.get("cover")
    if cover_rel:
        cover_path = public_dir / cover_rel.lstrip("/")
        if cover_path.exists():
            cover_path.unlink()
    chapter_dir = public_dir / "manhwa" / manhwa_id
    if chapter_dir.exists():
        shutil.rmtree(chapter_dir, ignore_errors=True)
    save_manhwa(manhwa_path, remaining)
    return target


def clear_all_manhwa(manhwa_path: Path, public_dir: Path) -> int:
    manhwas = load_manhwa(manhwa_path)
    for item in manhwas:
        cover_rel = item.get("cover")
        if cover_rel:
            cover_path = public_dir / cover_rel.lstrip("/")
            if cover_path.exists():
                cover_path.unlink()
        chapter_dir = public_dir / "manhwa" / item["id"]
        if chapter_dir.exists():
            shutil.rmtree(chapter_dir, ignore_errors=True)
    manhwa_root = public_dir / "manhwa"
    if manhwa_root.exists():
        shutil.rmtree(manhwa_root, ignore_errors=True)
    save_manhwa(manhwa_path, [])
    return len(manhwas)


def add_chapter(
    manhwa_path: Path,
    manhwa_id: str,
    chapter_number: str,
    pages: List[str],
    overwrite: bool = False,
    auto_deploy_enabled: bool = True,
) -> None:
    manhwas = load_manhwa(manhwa_path)
    now = datetime.utcnow().isoformat(timespec="seconds")
    for item in manhwas:
        if item["id"] == manhwa_id:
            if "chapters" not in item or not isinstance(item["chapters"], list):
                item["chapters"] = []
            for chapter in item["chapters"]:
                if str(chapter.get("number")) == str(chapter_number):
                    if not overwrite:
                        raise ValueError("Chapter already exists.")
                    chapter_id = chapter.get("id") or f"{manhwa_id}-chapter-{chapter_number}"
                    chapter_title = chapter.get("title") or f"Chapter {chapter_number}"
                    created_at = _normalize_updated_at(chapter.get("createdAt"), now)
                    chapter.update(
                        {
                            "id": chapter_id,
                            "number": str(chapter_number),
                            "title": chapter_title,
                            "pages": pages,
                            "createdAt": created_at,
                        }
                    )
                    item["updatedAt"] = now
                    save_manhwa(manhwa_path, manhwas, auto_deploy_enabled=auto_deploy_enabled)
                    return
            item["chapters"].append(
                {
                    "id": f"{manhwa_id}-chapter-{chapter_number}",
                    "number": str(chapter_number),
                    "title": f"Chapter {chapter_number}",
                    "pages": pages,
                    "createdAt": now,
                }
            )
            item["updatedAt"] = now
            save_manhwa(manhwa_path, manhwas, auto_deploy_enabled=auto_deploy_enabled)
            return
    raise ValueError("Manhwa not found.")


def delete_chapter(manhwa_path: Path, public_dir: Path, manhwa_id: str, chapter_number: str) -> None:
    manhwas = load_manhwa(manhwa_path)
    now = datetime.utcnow().isoformat(timespec="seconds")
    for item in manhwas:
        if item["id"] != manhwa_id:
            continue
        chapters = item.get("chapters", [])
        remaining = [ch for ch in chapters if str(ch.get("number")) != str(chapter_number)]
        if len(remaining) == len(chapters):
            raise ValueError("Chapter not found.")
        item["chapters"] = remaining
        item["updatedAt"] = now
        chapter_dir = public_dir / "manhwa" / manhwa_id / f"chapter-{chapter_number}"
        if chapter_dir.exists():
            shutil.rmtree(chapter_dir, ignore_errors=True)
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


def _notify_progress(
    callback: Optional[Callable[[str, Optional[int], Optional[int]], None]],
    stage: str,
    current: Optional[int] = None,
    total: Optional[int] = None,
) -> None:
    if not callback:
        return
    try:
        callback(stage, current, total)
    except Exception:  # noqa: BLE001
        logging.exception("Progress callback failed for stage %s", stage)


def process_upload(
    manhwa_id: str,
    chapter_number: str,
    upload_path: Path,
    manhwa_path: Path,
    public_dir: Path,
    settings: Dict,
    overwrite: bool = False,
    quality_override: Optional[str] = None,
    progress_callback: Optional[Callable[[str, Optional[int], Optional[int]], None]] = None,
    auto_deploy_enabled: bool = True,
    page_prefix: str = "",
    page_padding: int = 3,
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
            progress_callback=progress_callback,
            page_prefix=page_prefix,
            page_padding=page_padding,
        )
        _notify_progress(progress_callback, "Updating manhwa.json")
        add_chapter(
            manhwa_path,
            manhwa_id,
            chapter_number,
            pages,
            overwrite=overwrite,
            auto_deploy_enabled=auto_deploy_enabled,
        )
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
    progress_callback: Optional[Callable[[str, Optional[int], Optional[int]], None]] = None,
    page_prefix: str = "",
    page_padding: int = 3,
) -> List[str]:
    if not image_paths:
        raise ValueError("No images found in upload.")
    pages: List[str] = []
    total = len(image_paths)
    for index, image_path in enumerate(image_paths, start=1):
        if progress_callback and (index == 1 or index == total or index % 5 == 0):
            _notify_progress(progress_callback, "converting", index, total)
        output_name = f"{page_prefix}{index:0{page_padding}d}.jpg"
        output_path = chapter_dir / output_name
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
    public_path = manhwa_path.parents[1] / "public" / "manhwa.json"
    public_path.parent.mkdir(parents=True, exist_ok=True)
    with public_path.open("w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)


def _import_legacy_manhwa(legacy_path: Path, manhwa_path: Path) -> Optional[List[Dict]]:
    if not legacy_path.exists():
        logging.info("Legacy manhwa.json not found at %s; skipping import", legacy_path.resolve())
        return None
    try:
        with legacy_path.open("r", encoding="utf-8") as file:
            legacy = json.load(file)
    except Exception:  # noqa: BLE001
        logging.exception("Failed to read legacy manhwa.json at %s", legacy_path.resolve())
        return None
    if not isinstance(legacy, list):
        logging.error("Legacy manhwa.json is not a list at %s", legacy_path.resolve())
        return None
    base_dir = manhwa_path.parents[1]
    now = datetime.utcnow().isoformat(timespec="seconds")
    used_ids: set[str] = set()
    imported: List[Dict] = []
    for entry in legacy:
        if not isinstance(entry, dict):
            continue
        title = str(entry.get("title") or entry.get("name") or "Untitled").strip()
        slug = str(entry.get("slug") or entry.get("id") or _slugify(title)).strip()
        manhwa_id = _unique_id(slug, used_ids)
        used_ids.add(manhwa_id)
        genres = _normalize_genres(entry.get("genres"))
        description = str(entry.get("description") or entry.get("desc") or "").strip()
        status = _normalize_status(entry.get("status"))
        cover = entry.get("cover") or entry.get("coverUrl") or entry.get("image") or entry.get("thumbnail") or ""
        updated_at = str(entry.get("updatedAt") or entry.get("updated_at") or entry.get("updated") or now)
        chapters = _extract_legacy_chapters(entry, base_dir, manhwa_id)
        imported.append(
            {
                "id": manhwa_id,
                "title": title,
                "slug": manhwa_id,
                "genres": genres,
                "description": description,
                "chapters": chapters,
                "cover": cover,
                "status": status,
                "updatedAt": updated_at,
            }
        )
    logging.info("Imported %s manhwa from legacy %s", len(imported), legacy_path.resolve())
    return imported


def _ensure_schema(data: List[Dict], base_dir: Path, public_dir: Path) -> List[Dict]:
    now = datetime.utcnow().isoformat(timespec="seconds")
    used_ids: set[str] = set()
    normalized: List[Dict] = []
    changed = False
    for entry in data:
        if not isinstance(entry, dict):
            changed = True
            continue
        title = str(entry.get("title") or "Untitled").strip()
        raw_id = str(entry.get("id") or entry.get("slug") or _slugify(title)).strip()
        manhwa_id = _unique_id(raw_id, used_ids)
        used_ids.add(manhwa_id)
        normalized_entry = {
            "id": manhwa_id,
            "title": title,
            "slug": manhwa_id,
            "cover": _normalize_cover(entry.get("cover"), manhwa_id, base_dir, public_dir),
            "description": str(entry.get("description") or ""),
            "genres": _normalize_genres(entry.get("genres")),
            "chapters": _normalize_chapters(entry.get("chapters"), manhwa_id, now),
            "status": _normalize_status(entry.get("status")),
            "updatedAt": _normalize_updated_at(entry.get("updatedAt"), now),
        }
        normalized.append(normalized_entry)
        if not isinstance(entry.get("updatedAt"), str):
            changed = True
        if set(entry.keys()) != set(normalized_entry.keys()):
            changed = True
        else:
            for key, value in normalized_entry.items():
                if entry.get(key) != value:
                    changed = True
                    break
    return normalized if changed else data


def _unique_id(base: str, used: set[str]) -> str:
    candidate = base
    counter = 2
    while candidate in used:
        candidate = f"{base}-{counter}"
        counter += 1
    return candidate


def _normalize_genres(value) -> List[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        parts = [part.strip() for part in value.replace("|", ",").split(",")]
        return [part for part in parts if part]
    return []


def _normalize_status(value) -> str:
    if not value:
        return "ongoing"
    status = str(value).strip().lower()
    if status in STATUS_VALUES:
        return status
    if "complete" in status or "finished" in status or "done" in status:
        return "completed"
    return "ongoing"


def normalize_status(value) -> str:
    return _normalize_status(value)


def _normalize_cover(value, manhwa_id: str, base_dir: Path, public_dir: Path) -> str:
    cover = str(value or "").strip()
    if not cover:
        candidate = public_dir / "covers" / f"{manhwa_id}.jpg"
        if candidate.exists():
            return f"/covers/{candidate.name}"
        return ""
    normalized = cover.replace("\\", "/")
    filename = Path(normalized).name
    if "assets/covers/" in normalized:
        source = base_dir / "assets" / "covers" / filename
        target = public_dir / "covers" / filename
        if source.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.exists():
                shutil.copy(source, target)
        return f"/covers/{filename}"
    if "covers/" in normalized:
        if normalized.startswith("covers/"):
            return f"/{normalized}"
        if normalized.startswith("/covers/"):
            return normalized
    if normalized.startswith("http://") or normalized.startswith("https://"):
        return normalized
    return f"/{normalized.lstrip('/')}"


def _normalize_chapters(value, manhwa_id: str, now: str) -> List[Dict]:
    if not isinstance(value, list):
        return []
    chapters: List[Dict] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        number = item.get("number") or item.get("chapter") or item.get("id")
        if number is None:
            continue
        number_str = str(number)
        pages = item.get("pages") or item.get("images") or []
        if not isinstance(pages, list):
            pages = []
        pages = [str(page) for page in pages if str(page).strip()]
        chapter_id = str(item.get("id") or f"{manhwa_id}-chapter-{number_str}")
        chapter_title = str(item.get("title") or item.get("name") or f"Chapter {number_str}").strip()
        if not chapter_title:
            chapter_title = f"Chapter {number_str}"
        created_at = _normalize_updated_at(item.get("createdAt") or item.get("created_at"), now)
        chapters.append(
            {
                "id": chapter_id,
                "number": number_str,
                "title": chapter_title,
                "pages": pages,
                "createdAt": created_at,
            }
        )
    return chapters


def _normalize_updated_at(value, default: str) -> str:
    if isinstance(value, str):
        text = value.strip()
        if text:
            try:
                if text.endswith("Z"):
                    datetime.fromisoformat(text.replace("Z", "+00:00"))
                else:
                    datetime.fromisoformat(text)
                return text
            except ValueError:
                return default
    return default


def _extract_legacy_chapters(entry: Dict, base_dir: Path, manhwa_id: str) -> List[Dict]:
    chapters_data = entry.get("chapters")
    chapters_path = entry.get("chaptersPath") or entry.get("chapters_path")
    if chapters_data is None and chapters_path:
        candidate = str(chapters_path).lstrip("/")
        path = base_dir / candidate
        if path.exists():
            try:
                with path.open("r", encoding="utf-8") as file:
                    chapters_data = json.load(file)
            except Exception:  # noqa: BLE001
                logging.exception("Failed to read chapters JSON at %s", path.resolve())
                chapters_data = []
        else:
            logging.warning("Legacy chapters file missing at %s; using empty chapters", path.resolve())
            chapters_data = []
    if not isinstance(chapters_data, list):
        return []
    chapters: List[Dict] = []
    for item in chapters_data:
        if not isinstance(item, dict):
            continue
        number = item.get("number") or item.get("chapter") or item.get("id")
        if number is None:
            continue
        pages = item.get("pages") or item.get("images") or []
        path = item.get("path") or ""
        if pages and isinstance(pages, list):
            if not path:
                path, pages = _split_pages(pages)
            if not path:
                path = f"/manhwa/{manhwa_id}/chapter-{number}/"
            pages = [str(page) for page in pages if str(page).strip()]
        else:
            pages = []
            path = path or f"/manhwa/{manhwa_id}/chapter-{number}/"
        chapters.append({"number": str(number), "pages": pages, "path": path})
    return chapters


def _legacy_import_done(settings_path: Path) -> bool:
    if not settings_path.exists():
        return False
    try:
        with settings_path.open("r", encoding="utf-8") as file:
            data = json.load(file)
    except Exception:  # noqa: BLE001
        return False
    return bool(data.get(IMPORT_MARKER_KEY))


def _mark_legacy_import_done(settings_path: Path) -> None:
    settings = load_settings(settings_path)
    if settings.get(IMPORT_MARKER_KEY):
        return
    settings[IMPORT_MARKER_KEY] = True
    save_settings(settings_path, settings)
    logging.info("Legacy import marked complete in %s", settings_path.resolve())


def _manhwa_has_data(manhwa_path: Path) -> bool:
    data = _read_manhwa_list(manhwa_path, log_errors=False)
    return bool(data)


def _merge_manhwa_lists(existing: List[Dict], imported: List[Dict]) -> List[Dict]:
    merged: List[Dict] = []
    imported_ids = set()
    for item in imported:
        if not isinstance(item, dict):
            continue
        manhwa_id = str(item.get("id") or item.get("slug") or "")
        if manhwa_id:
            imported_ids.add(manhwa_id)
        merged.append(item)
    for item in existing:
        if not isinstance(item, dict):
            continue
        manhwa_id = str(item.get("id") or item.get("slug") or "")
        if manhwa_id and manhwa_id in imported_ids:
            continue
        merged.append(item)
    return merged


def _split_pages(pages: List[str]) -> Tuple[str, List[str]]:
    paths = [PurePosixPath(str(page)) for page in pages if isinstance(page, str)]
    if not paths:
        return "", []
    common = posixpath.commonpath([path.as_posix() for path in paths])
    base = "/" + common.strip("/") + "/"
    filenames = [path.name for path in paths]
    return base, filenames




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

