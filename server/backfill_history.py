from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import shutil
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Iterable, Optional
from urllib.parse import urlparse
from urllib.request import Request, urlopen
import unicodedata

from bot.config import CATALOG_CHANNELS, DATA_DIR, MANHWA_PATH, PUBLIC_DIR, SOURCE_CHANNELS, CHANNEL_CACHE_PATH
from server import processor


BACKFILL_STATE_PATH = DATA_DIR / "backfill_state.json"
BACKFILL_LOG_PATH = DATA_DIR / "backfill_history.log"
DEFAULT_SESSIONS_DIR = DATA_DIR / ".sessions"

CHAPTER_KEYWORDS = (
    "bob",
    "qism",
    "qisim",
    "qsm",
    "part",
    "ch",
    "chapter",
    "глава",
    "гл",
    "часть",
)


@dataclass
class Candidate:
    manhwa_id: Optional[str]
    chapter: Optional[str]
    source_type: str
    source_ref: dict
    status: str
    metadata: dict
    manhwa_source: str
    chapter_source: str
    parsing_reason: str
    pages: list[str]


def _candidate_preview(candidate: Candidate) -> dict:
    source_ref = candidate.source_ref or {}
    safe_source = {}
    if "message" in source_ref:
        msg = source_ref["message"]
        safe_source = {"message_id": getattr(msg, "id", None)}
    elif "messages" in source_ref:
        safe_source = {"message_ids": [getattr(msg, "id", None) for msg in source_ref["messages"]]}
    elif "url" in source_ref:
        safe_source = {"url": source_ref.get("url")}
    return {
        "manhwa_id": candidate.manhwa_id,
        "chapter": candidate.chapter,
        "source_type": candidate.source_type,
        "status": candidate.status,
        "manhwa_source": candidate.manhwa_source,
        "chapter_source": candidate.chapter_source,
        "parsing_reason": candidate.parsing_reason,
        "metadata": candidate.metadata,
        "source_ref": safe_source,
    }


def _log_event(event: str, details: dict) -> None:
    BACKFILL_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "time": datetime.utcnow().isoformat(timespec="seconds"),
        "event": event,
        "details": details,
    }
    with BACKFILL_LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False) + "\n")


def _load_dotenv() -> None:
    root = Path(__file__).resolve().parents[1]
    env_paths = (root / ".env", root / ".env.local", DATA_DIR / ".env")
    try:
        from dotenv import load_dotenv  # type: ignore

        for env_path in env_paths:
            if env_path.exists():
                load_dotenv(env_path, override=False)
        return
    except Exception:
        pass

    for env_path in env_paths:
        if not env_path.exists():
            continue
        with env_path.open("r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value


def _get_env(*keys: str) -> str | None:
    for key in keys:
        value = os.getenv(key)
        if value:
            return value
    return None


def _auth_env_report() -> dict:
    api_id_raw = os.getenv("TELEGRAM_API_ID")
    api_id_alt = os.getenv("API_ID")
    api_hash_raw = os.getenv("TELEGRAM_API_HASH")
    api_hash_alt = os.getenv("API_HASH")
    def _mask(value: str | None) -> dict:
        if not value:
            return {"present": False}
        return {"present": True, "length": len(value), "last4": value[-4:]}

    report = {
        "TELEGRAM_API_ID": {
            "present": bool(api_id_raw),
            "length": len(api_id_raw) if api_id_raw else 0,
            "is_int": api_id_raw.isdigit() if api_id_raw else False,
        },
        "API_ID": {
            "present": bool(api_id_alt),
            "length": len(api_id_alt) if api_id_alt else 0,
            "is_int": api_id_alt.isdigit() if api_id_alt else False,
        },
        "TELEGRAM_API_HASH": _mask(api_hash_raw),
        "API_HASH": _mask(api_hash_alt),
        "conflict": {
            "api_id": bool(api_id_raw and api_id_alt and api_id_raw != api_id_alt),
            "api_hash": bool(api_hash_raw and api_hash_alt and api_hash_raw != api_hash_alt),
        },
    }
    return report


def _strip_accents(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    return "".join(char for char in normalized if not unicodedata.combining(char))


def _normalize_text(value: str) -> str:
    value = value or ""
    value = _strip_accents(value.lower())
    value = re.sub(r"https?://\S+", " ", value)
    value = re.sub(r"[@#]\S+", " ", value)
    value = re.sub(r"[^\w\s\-\.,]", " ", value, flags=re.UNICODE)
    value = re.sub(r"[\[\]\(\)\{\}]+", " ", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def _normalize_match_value(value: str) -> str:
    value = _normalize_text(value)
    value = value.replace("_", " ").replace("-", " ")
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def _extract_hashtags_raw(text: str) -> list[str]:
    if not text:
        return []
    return [tag for tag in re.findall(r"#([\w\-]+)", text) if tag]


def _extract_hashtags_text(text: str) -> str:
    tags = _extract_hashtags_raw(text)
    return " ".join(tag.replace("-", " ").replace("_", " ") for tag in tags)


def _normalize_channel_username(value: str | None) -> str:
    if not value:
        return ""
    value = value.strip().lower()
    if value.startswith("@"):
        value = value[1:]
    if value.startswith("https://t.me/") or value.startswith("http://t.me/"):
        value = value.split("t.me/")[-1].split("/")[0]
    return value


def _parse_link(link: str) -> dict | None:
    if not link:
        return None
    if link.startswith("t.me/"):
        link = f"https://{link}"
    if link.startswith("http://t.me/"):
        link = link.replace("http://", "https://", 1)
    if not link.startswith("http"):
        return None
    parsed = urlparse(link)
    if parsed.netloc not in {"t.me", "telegram.me"}:
        return {"url": link, "kind": "external"}
    parts = parsed.path.strip("/").split("/")
    if len(parts) >= 2 and parts[0] == "c":
        return {"url": link, "kind": "tme", "channel_internal_id": parts[1], "message_id": parts[2] if len(parts) > 2 else None}
    if len(parts) >= 2:
        return {"url": link, "kind": "tme", "channel_username": _normalize_channel_username(parts[0]), "message_id": parts[1]}
    return {"url": link, "kind": "tme"}


def _extract_links(text: str) -> list[dict]:
    if not text:
        return []
    links = set(re.findall(r"(https?://\S+|t\.me/\S+)", text))
    parsed_links: list[dict] = []
    for link in links:
        parsed = _parse_link(link)
        if parsed:
            parsed_links.append(parsed)
    return parsed_links


def _build_cache_entry(message, entry_type: str) -> dict:
    chat = getattr(message, "chat", None)
    channel_username = _normalize_channel_username(getattr(chat, "username", ""))
    channel_title = getattr(chat, "title", "") or "Unknown"
    channel_id = getattr(chat, "id", None) or getattr(message, "chat_id", None)
    text = message.message or ""
    caption = text if (message.document or message.photo) else ""
    body_text = "" if (message.document or message.photo) else text
    links = _extract_links(text)
    entry: dict = {
        "type": entry_type,
        "channel_id": channel_id,
        "channel_title": channel_title,
        "channel_username": channel_username,
        "message_id": message.id,
        "date": message.date.isoformat() if message.date else "",
        "text": body_text,
        "caption": caption,
        "links": links,
    }
    if message.document or message.photo:
        filename = getattr(message.file, "name", "") or f"media_{message.id}.bin"
        entry.update(
            {
                "file_id": str(getattr(message.file, "id", "")),
                "file_unique_id": str(getattr(message.file, "id", "")),
                "file_name": filename,
                "file_size": getattr(message.file, "size", None),
            }
        )
    return entry


def _load_cache() -> list[dict]:
    if not CHANNEL_CACHE_PATH.exists():
        return []
    with CHANNEL_CACHE_PATH.open("r", encoding="utf-8") as handle:
        try:
            data = json.load(handle)
        except json.JSONDecodeError:
            return []
    return data if isinstance(data, list) else []


def _merge_cache(existing: list[dict], new_entries: list[dict]) -> list[dict]:
    index = {(item.get("channel_id"), item.get("message_id"), item.get("type")) for item in existing}
    for entry in new_entries:
        key = (entry.get("channel_id"), entry.get("message_id"), entry.get("type"))
        if key in index:
            continue
        existing.append(entry)
        index.add(key)
    return existing


def _collect_cache_entry(message, entries: list[dict]) -> None:
    if message.document or message.photo:
        entries.append(_build_cache_entry(message, "document"))
        return
    if message.message:
        entries.append(_build_cache_entry(message, "post"))


def _normalize_chapter_value(value: str) -> str:
    value = value.replace(",", ".").strip()
    try:
        number = float(value)
        if number.is_integer():
            return str(int(number))
        return str(number).rstrip("0").rstrip(".")
    except ValueError:
        return value


def _expand_ranges(values: Iterable[str], reason: str, context: dict) -> list[str]:
    expanded: list[str] = []
    for value in values:
        normalized = value.replace("–", "-").replace("—", "-").replace("_", "-").replace("to", "-")
        if "-" in normalized:
            parts = [part for part in normalized.split("-") if part]
            if len(parts) >= 2 and parts[0].isdigit() and parts[1].isdigit():
                start = int(parts[0])
                end = int(parts[1])
                if end >= start and (end - start) <= 250:
                    expanded.extend([str(num) for num in range(start, end + 1)])
                    _log_event("range_split", {"reason": reason, "range": value, **context})
                    continue
        expanded.append(_normalize_chapter_value(value))
    return expanded


def _extract_chapters_from_text(text: str) -> list[str]:
    if not text:
        return []
    normalized = _normalize_text(text)
    normalized = normalized.replace("—", "-").replace("–", "-").replace("_", " ")
    keyword = r"(?:" + "|".join(CHAPTER_KEYWORDS) + r")"
    results: list[str] = []

    range_patterns = [
        rf"{keyword}\s*#?(\d+)\s*-\s*(\d+)",
        rf"#?(\d+)\s*-\s*(\d+)\s*{keyword}",
        rf"(\d+)\s*-\s*(\d+)",
    ]
    for pattern in range_patterns:
        for start, end in re.findall(pattern, normalized):
            if start.isdigit() and end.isdigit():
                start_int = int(start)
                end_int = int(end)
                if end_int >= start_int and (end_int - start_int) <= 250:
                    results.extend([str(num) for num in range(start_int, end_int + 1)])
                    continue
            results.append(start)
            results.append(end)

    single_patterns = [
        rf"{keyword}\s*#?(\d+(?:[.,]\d+)?)",
        rf"#?(\d+(?:[.,]\d+)?)\s*{keyword}",
        r"#?(\d{1,4})",
    ]
    for pattern in single_patterns:
        for value in re.findall(pattern, normalized):
            results.append(_normalize_chapter_value(value))

    return _dedupe_values(results)


def _extract_chapters_from_hashtags(raw_tags: list[str], context: dict) -> list[str]:
    if not raw_tags:
        return []
    results: list[str] = []
    for tag in raw_tags:
        cleaned = tag.replace("-", " ").replace("_", " ")
        parts = re.findall(r"\d+(?:[.,]\d+)?(?:\s*-\s*\d+(?:[.,]\d+)?)?", cleaned)
        if parts:
            results.extend(_expand_ranges(parts, "hashtag", context))
        results.extend(_extract_chapters_from_text(cleaned))
    return _dedupe_values(results)


def _dedupe_values(values: Iterable[str]) -> list[str]:
    seen = set()
    ordered: list[str] = []
    for value in values:
        if not value:
            continue
        if value in seen:
            continue
        seen.add(value)
        ordered.append(value)
    return ordered


def _best_fuzzy_match(text: str, manhwas: list[dict]) -> tuple[Optional[str], float]:
    if not text:
        return None, 0.0
    normalized_text = _normalize_match_value(text)
    best_id: Optional[str] = None
    best_score = 0.0
    for item in manhwas:
        manhwa_id = item.get("id", "")
        title = item.get("title", "")
        title_norm = _normalize_match_value(title)
        slug_norm = _normalize_match_value(manhwa_id)
        score = 0.0
        if slug_norm and slug_norm in normalized_text:
            score = 0.98
        elif title_norm and title_norm in normalized_text:
            score = 0.9
        else:
            score = SequenceMatcher(None, normalized_text, title_norm).ratio()
        if score > best_score:
            best_id = manhwa_id
            best_score = score
    return best_id, best_score


def _resolve_manhwa(
    text: str,
    hashtags_text: str,
    filename: str,
    channel_key: str,
    manhwas: list[dict],
    channel_map: dict,
) -> tuple[Optional[str], float, str]:
    if hashtags_text:
        manhwa_id, score = _best_fuzzy_match(hashtags_text, manhwas)
        if manhwa_id:
            return manhwa_id, score, "hashtag"
    if text:
        manhwa_id, score = _best_fuzzy_match(text, manhwas)
        if manhwa_id and score >= 0.6:
            return manhwa_id, score, "caption"
    if filename:
        manhwa_id, score = _best_fuzzy_match(filename, manhwas)
        if manhwa_id and score >= 0.6:
            return manhwa_id, score, "filename"
    channel_info = channel_map.get(channel_key)
    if channel_info:
        return channel_info.get("manhwa_id"), channel_info.get("score", 0.5), "channel_map"
    return None, 0.0, ""


def _update_channel_map(channel_map: dict, channel_key: str, manhwa_id: str, score: float) -> None:
    if not channel_key or not manhwa_id:
        return
    entry = channel_map.setdefault(channel_key, {"manhwa_id": manhwa_id, "score": score, "count": 0})
    if entry["manhwa_id"] != manhwa_id:
        return
    entry["count"] += 1
    entry["score"] = max(entry.get("score", 0.0), score)


def _load_state() -> dict:
    if not BACKFILL_STATE_PATH.exists():
        return {"channels": {}, "channel_map": {}}
    with BACKFILL_STATE_PATH.open("r", encoding="utf-8") as handle:
        try:
            data = json.load(handle)
        except json.JSONDecodeError:
            return {"channels": {}, "channel_map": {}}
    data.setdefault("channels", {})
    data.setdefault("channel_map", {})
    return data


def _save_state(state: dict) -> None:
    BACKFILL_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with BACKFILL_STATE_PATH.open("w", encoding="utf-8") as handle:
        json.dump(state, handle, ensure_ascii=False, indent=2)


def _format_channel(channel: str) -> str:
    if channel.startswith("https://t.me/"):
        return channel.split("t.me/")[-1]
    if channel.startswith("@"):
        return channel[1:]
    return channel


def _extract_file_links(text: str) -> list[str]:
    if not text:
        return []
    links = re.findall(r"(https?://\S+)", text)
    return [link for link in links if re.search(r"\.(pdf|zip|rar|jpg|jpeg|png)(\?|$)", link, re.I)]


def _chapter_sort_key(value: str) -> tuple[int, float, str]:
    try:
        number = float(str(value).replace(",", "."))
        return (0, number, str(value))
    except ValueError:
        return (1, 0.0, str(value))


def _write_chapter_manifest(manhwa_id: str, chapter: str, pages: list[str], metadata: dict) -> None:
    chapter_dir = PUBLIC_DIR / "manhwa" / manhwa_id / "chapters"
    chapter_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "id": f"{manhwa_id}-chapter-{chapter}",
        "number": str(chapter),
        "pages": pages,
        "updatedAt": datetime.utcnow().isoformat(timespec="seconds"),
        "source": metadata,
    }
    safe_name = re.sub(r"[^0-9a-zA-Z._-]+", "_", str(chapter))
    with (chapter_dir / f"{safe_name}.json").open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)


async def _download_external(url: str, dest_dir: Path) -> Path:
    dest_dir.mkdir(parents=True, exist_ok=True)
    filename = Path(url.split("?")[0]).name or "download.bin"
    target = dest_dir / filename
    request = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(request, timeout=60) as response:  # noqa: S310
        with target.open("wb") as handle:
            shutil.copyfileobj(response, handle, length=1024 * 1024)
    return target


async def _download_message_media(client, message, dest_dir: Path) -> Path:
    dest_dir.mkdir(parents=True, exist_ok=True)
    return await client.download_media(message, file=dest_dir)


async def _process_candidate(
    candidate: Candidate,
    manhwa_id: str,
    chapter: str,
    client,
    settings: dict,
    dry_run: bool,
) -> None:
    if dry_run:
        return
    source_ref = candidate.source_ref
    source_type = candidate.source_type
    temp_dir = Path(tempfile.mkdtemp(prefix="manhwa_backfill_"))
    try:
        upload_path: Optional[Path] = None
        if source_type in {"pdf", "zip", "rar", "image"}:
            message = source_ref.get("message")
            if message is None:
                raise ValueError("Missing message reference.")
            upload_path = await _download_message_media(client, message, temp_dir)
        elif source_type == "images":
            messages = source_ref.get("messages", [])
            image_dir = temp_dir / "images"
            image_dir.mkdir(parents=True, exist_ok=True)
            for idx, message in enumerate(messages, start=1):
                await _download_message_media(client, message, image_dir / f"{idx:03}.jpg")
            zip_path = temp_dir / "images.zip"
            shutil.make_archive(str(zip_path.with_suffix("")), "zip", image_dir)
            upload_path = zip_path
        elif source_type == "external":
            upload_path = await _download_external(source_ref.get("url", ""), temp_dir)
        else:
            raise ValueError("Unsupported source type.")

        result = await asyncio.to_thread(
            processor.process_upload,
            manhwa_id,
            chapter,
            upload_path,
            MANHWA_PATH,
            PUBLIC_DIR,
            settings,
            False,
            "original",
            None,
            False,
            "page-",
            3,
        )
        _write_chapter_manifest(manhwa_id, chapter, result["pages"], candidate.metadata)
        _log_event(
            "chapter_ingested",
            {"manhwa_id": manhwa_id, "chapter": chapter, "pages": result["pages_count"]},
        )
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


async def _scan_channel(
    client,
    channel: str,
    manhwas: list[dict],
    existing_chapters: dict[str, set[str]],
    channel_state: dict,
    channel_map: dict,
    candidates: list[Candidate],
    cache_entries: list[dict],
    dry_run: bool,
    progress_every: int,
    sleep_every: int,
    sleep_seconds: float,
) -> int:
    last_id = int(channel_state.get("last_message_id", 0))
    total_scanned = 0
    grouped_id = None
    grouped_messages = []

    async def _flush_group() -> None:
        nonlocal grouped_messages
        if not grouped_messages:
            return
        await _process_message_group(
            grouped_messages,
            manhwas,
            existing_chapters,
            channel_map,
            candidates,
        )
        grouped_messages = []

    async for message in client.iter_messages(channel, reverse=True, min_id=last_id):
        total_scanned += 1
        _collect_cache_entry(message, cache_entries)
        if message.grouped_id:
            if grouped_id and message.grouped_id != grouped_id:
                await _flush_group()
            grouped_id = message.grouped_id
            grouped_messages.append(message)
        else:
            await _flush_group()
            grouped_id = None
            await _process_message(
                message,
                manhwas,
                existing_chapters,
                channel_map,
                candidates,
            )

        if total_scanned % progress_every == 0:
            _log_event("progress", {"channel": channel, "scanned": total_scanned})
            print(f"[{channel}] scanned {total_scanned}")
        if total_scanned % sleep_every == 0:
            await asyncio.sleep(sleep_seconds)
        if not dry_run:
            channel_state["last_message_id"] = max(channel_state.get("last_message_id", 0), message.id)

    await _flush_group()
    return total_scanned


async def _process_message_group(
    messages: list,
    manhwas: list[dict],
    existing_chapters: dict[str, set[str]],
    channel_map: dict,
    candidates: list[Candidate],
) -> None:
    if not messages:
        return
    base_message = next((msg for msg in messages if msg.message), messages[0])
    text = base_message.message or ""
    hashtags_text = _extract_hashtags_text(text)
    raw_tags = _extract_hashtags_raw(text)
    channel_key = _format_channel(getattr(base_message.chat, "username", "") or "")
    filename = ""
    manhwa_id, score, manhwa_source = _resolve_manhwa(
        text, hashtags_text, filename, channel_key, manhwas, channel_map
    )
    if manhwa_id:
        _log_event(
            "confidence_used",
            {
                "manhwa_id": manhwa_id,
                "score": score,
                "source": manhwa_source,
                "channel": channel_key,
                "message_id": base_message.id,
            },
        )
    chapters = _extract_chapters_from_hashtags(raw_tags, {"channel": channel_key, "message_id": base_message.id})
    chapter_source = "hashtag" if chapters else ""
    if not chapters:
        chapters = _extract_chapters_from_text(text)
        chapter_source = "caption" if chapters else ""
    if manhwa_id and score >= 0.9:
        _update_channel_map(channel_map, channel_key, manhwa_id, score)

    if not chapters:
        _log_event(
            "unresolved_chapter",
            {"channel": channel_key, "message_id": base_message.id, "reason": "no_chapters_detected"},
        )
        return
    if not manhwa_id:
        _log_event(
            "unresolved_manhwa",
            {"channel": channel_key, "message_id": base_message.id, "reason": "no_manhwa_detected"},
        )
    for chapter in chapters:
        status = "ready" if manhwa_id else "unresolved_manhwa"
        if manhwa_id and chapter in existing_chapters.get(manhwa_id, set()):
            _log_event(
                "chapter_skipped_duplicate",
                {"manhwa_id": manhwa_id, "chapter": chapter, "reason": "already_in_manhwa_json"},
            )
            continue
        candidates.append(
            Candidate(
                manhwa_id=manhwa_id,
                chapter=chapter,
                source_type="images",
                source_ref={"messages": messages},
                status=status,
                metadata={
                    "channel": channel_key,
                    "message_id": base_message.id,
                    "date": base_message.date.isoformat() if base_message.date else "",
                    "manhwa_source": manhwa_source,
                    "chapter_source": chapter_source,
                    "parsing_reason": "media_group",
                },
                manhwa_source=manhwa_source,
                chapter_source=chapter_source,
                parsing_reason="media_group",
                pages=[],
            )
        )
        _log_event(
            "chapter_detected",
            {
                "manhwa_id": manhwa_id,
                "chapter": chapter,
                "source_type": "images",
                "manhwa_source": manhwa_source,
                "chapter_source": chapter_source,
            },
        )


async def _process_message(
    message,
    manhwas: list[dict],
    existing_chapters: dict[str, set[str]],
    channel_map: dict,
    candidates: list[Candidate],
) -> None:
    text = message.message or ""
    hashtags_text = _extract_hashtags_text(text)
    raw_tags = _extract_hashtags_raw(text)
    channel_key = _format_channel(getattr(message.chat, "username", "") or "")
    filename = getattr(getattr(message, "file", None), "name", "") or ""
    manhwa_id, score, manhwa_source = _resolve_manhwa(
        text, hashtags_text, filename, channel_key, manhwas, channel_map
    )
    if manhwa_id:
        _log_event(
            "confidence_used",
            {
                "manhwa_id": manhwa_id,
                "score": score,
                "source": manhwa_source,
                "channel": channel_key,
                "message_id": message.id,
            },
        )
    chapters = _extract_chapters_from_hashtags(raw_tags, {"channel": channel_key, "message_id": message.id})
    chapter_source = "hashtag" if chapters else ""
    if not chapters:
        chapters = _extract_chapters_from_text(text)
        chapter_source = "caption" if chapters else ""
    if not chapters and filename:
        chapters = _extract_chapters_from_text(filename)
        chapter_source = "filename" if chapters else ""

    if manhwa_id and score >= 0.9:
        _update_channel_map(channel_map, channel_key, manhwa_id, score)

    source_type = "unknown"
    source_ref = {}
    if message.document:
        ext = (filename or "").lower()
        if ext.endswith(".pdf"):
            source_type = "pdf"
        elif ext.endswith(".zip"):
            source_type = "zip"
        elif ext.endswith(".rar"):
            source_type = "rar"
        else:
            source_type = "image"
        source_ref = {"message": message}
    elif message.photo:
        source_type = "image"
        source_ref = {"message": message}
    else:
        links = _extract_file_links(text)
        if links:
            source_type = "external"
            source_ref = {"url": links[0]}

    if not chapters:
        _log_event(
            "unresolved_chapter",
            {"channel": channel_key, "message_id": message.id, "reason": "no_chapters_detected"},
        )
        return
    if not manhwa_id:
        _log_event(
            "unresolved_manhwa",
            {"channel": channel_key, "message_id": message.id, "reason": "no_manhwa_detected"},
        )
    for chapter in chapters:
        if manhwa_id and chapter in existing_chapters.get(manhwa_id, set()):
            _log_event(
                "chapter_skipped_duplicate",
                {"manhwa_id": manhwa_id, "chapter": chapter, "reason": "already_in_manhwa_json"},
            )
            continue
        status = "ready" if manhwa_id and source_type != "unknown" else "missing_source"
        if not manhwa_id:
            status = "unresolved_manhwa"
        if status == "missing_source":
            _log_event(
                "missing_source",
                {"manhwa_id": manhwa_id, "chapter": chapter, "channel": channel_key, "message_id": message.id},
            )
        candidates.append(
            Candidate(
                manhwa_id=manhwa_id,
                chapter=chapter,
                source_type=source_type,
                source_ref=source_ref,
                status=status,
                metadata={
                    "channel": channel_key,
                    "message_id": message.id,
                    "date": message.date.isoformat() if message.date else "",
                    "manhwa_source": manhwa_source,
                    "chapter_source": chapter_source,
                    "parsing_reason": "message",
                },
                manhwa_source=manhwa_source,
                chapter_source=chapter_source,
                parsing_reason="message",
                pages=[],
            )
        )
        _log_event(
            "chapter_detected",
            {
                "manhwa_id": manhwa_id,
                "chapter": chapter,
                "source_type": source_type,
                "manhwa_source": manhwa_source,
                "chapter_source": chapter_source,
            },
        )


async def run_backfill(dry_run: bool, apply: bool) -> None:
    _load_dotenv()
    try:
        from telethon import TelegramClient  # type: ignore
    except ImportError:
        print("Telethon is required for backfill. Install with: pip install telethon")
        sys.exit(1)

    api_id = _get_env("TELEGRAM_API_ID", "API_ID")
    api_hash = _get_env("TELEGRAM_API_HASH", "API_HASH")
    session = _get_env("TELEGRAM_SESSION", "SESSION_NAME") or "backfill-history"
    env_report = _auth_env_report()
    print("[AUTH] Env report (safe):", json.dumps(env_report, ensure_ascii=False))
    _log_event("auth_env", env_report)
    if not api_id or not api_hash:
        print("TELEGRAM_API_ID/TELEGRAM_API_HASH (or API_ID/API_HASH) are required.")
        sys.exit(1)
    try:
        api_id_int = int(api_id)
    except (TypeError, ValueError):
        print("TELEGRAM_API_ID must be an integer.")
        _log_event("auth_env_error", {"reason": "api_id_not_int", "value": api_id})
        sys.exit(1)

    manhwas = processor.load_manhwa(MANHWA_PATH)
    existing_chapters = {item["id"]: set(processor.get_chapter_numbers(MANHWA_PATH, item["id"])) for item in manhwas}

    channels = [*SOURCE_CHANNELS, *CATALOG_CHANNELS]
    channels = [_format_channel(channel) for channel in channels if channel]

    state = _load_state()
    channel_map = state.get("channel_map", {})
    candidates: list[Candidate] = []

    DEFAULT_SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    if "/" in session or "\\" in session:
        session_path = session
    else:
        session_path = str(DEFAULT_SESSIONS_DIR / session)

    cache_entries: list[dict] = []
    total_scanned = 0

    print(f"[AUTH] Using session path: {session_path}")
    _log_event("auth_session_path", {"path": session_path})

    async with TelegramClient(session_path, api_id_int, api_hash) as client:
        for channel in channels:
            channel_state = state.setdefault("channels", {}).setdefault(channel, {})
            scanned = await _scan_channel(
                client,
                channel,
                manhwas,
                existing_chapters,
                channel_state,
                channel_map,
                candidates,
                cache_entries,
                dry_run,
                progress_every=200,
                sleep_every=100,
                sleep_seconds=0.3,
            )
            total_scanned += scanned

        state["channel_map"] = channel_map

        deduped: dict[tuple[str | None, str | None], Candidate] = {}
        for candidate in candidates:
            key = (candidate.manhwa_id, candidate.chapter)
            existing = deduped.get(key)
            if not existing:
                deduped[key] = candidate
                continue
            if existing.status != "ready" and candidate.status == "ready":
                deduped[key] = candidate

        candidates = list(deduped.values())
        summary = {
            "total_scanned": total_scanned,
            "candidates": len(candidates),
            "resolved": len([c for c in candidates if c.manhwa_id and c.chapter]),
            "unresolved": len([c for c in candidates if not c.manhwa_id or not c.chapter]),
            "ready": len([c for c in candidates if c.status == "ready"]),
        }
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        if candidates:
            sample = [_candidate_preview(c) for c in candidates[:10]]
            print(json.dumps(sample, ensure_ascii=False, indent=2))

        if apply:
            existing_cache = _load_cache()
            merged_cache = _merge_cache(existing_cache, cache_entries)
            CHANNEL_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
            with CHANNEL_CACHE_PATH.open("w", encoding="utf-8") as handle:
                json.dump(merged_cache, handle, ensure_ascii=False, indent=2)
            settings = processor.load_settings(DATA_DIR / "settings.json")
            for candidate in sorted(candidates, key=lambda c: _chapter_sort_key(c.chapter or "")):
                if candidate.status != "ready" or not candidate.manhwa_id or not candidate.chapter:
                    continue
                await _process_candidate(
                    candidate,
                    candidate.manhwa_id,
                    candidate.chapter,
                    client,
                    settings,
                    dry_run=False,
                )
                existing_chapters.setdefault(candidate.manhwa_id, set()).add(candidate.chapter)

    if apply:
        _save_state(state)


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill Telegram channel history.")
    parser.add_argument("--dry-run", action="store_true", help="Scan and report without writing.")
    parser.add_argument("--apply", action="store_true", help="Apply backfill and write chapters.")
    args = parser.parse_args()

    if not args.dry_run and not args.apply:
        print("Use --dry-run or --apply.")
        sys.exit(2)

    asyncio.run(run_backfill(dry_run=args.dry_run, apply=args.apply))


if __name__ == "__main__":
    main()

