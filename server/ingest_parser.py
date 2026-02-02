from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import List, Optional
import unicodedata

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

STOP_TOKENS = {
    "manhwa",
    "manga",
    "comic",
    "chapter",
    "ch",
    "part",
    "bob",
    "qism",
    "qisim",
    "qsm",
    "глава",
    "гл",
    "часть",
}


@dataclass
class GuessResult:
    manhwa_id: Optional[str]
    chapter: Optional[str]
    confidence: float


def guess_from_filename(filename: str, manhwas: List[dict]) -> GuessResult:
    name = normalize_title(filename)
    manhwa_id = match_manhwa_fuzzy(name, manhwas, min_score=0.6)[0]
    chapter = _match_chapter(name)
    confidence = 0.0
    if manhwa_id:
        confidence += 0.5
    if chapter:
        confidence += 0.5
    return GuessResult(manhwa_id=manhwa_id, chapter=chapter, confidence=confidence)


def _match_manhwa(name: str, manhwas: List[dict]) -> Optional[str]:
    for item in manhwas:
        if item["id"] in name:
            return item["id"]
        title = normalize_title(item["title"])
        if title and title in name:
            return item["id"]
    return None


def _match_chapter(name: str) -> Optional[str]:
    match = re.search(r"(?:ch|chapter|c)?\s*(\d+(?:\.\d+)?)", name)
    if match:
        return match.group(1)
    return None


def normalize_title(value: str) -> str:
    value = value or ""
    value = _strip_accents(value.lower())
    value = re.sub(r"https?://\S+", " ", value)
    value = re.sub(r"[@#]\S+", " ", value)
    value = re.sub(r"[\[\]\(\)\{\}_-]+", " ", value)
    value = re.sub(r"[^\w\s]", " ", value, flags=re.UNICODE)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def tokenize(value: str) -> set[str]:
    normalized = normalize_title(value)
    tokens = {token for token in normalized.split() if token and token not in STOP_TOKENS}
    return tokens


def match_manhwa_fuzzy(text: str, manhwas: List[dict], min_score: float = 0.78) -> tuple[Optional[str], float]:
    if not text:
        return None, 0.0
    best_id: Optional[str] = None
    best_score = 0.0
    runner_up = 0.0
    normalized_text = normalize_title(text)
    text_tokens = tokenize(text)
    for item in manhwas:
        title = item.get("title", "")
        manhwa_id = item.get("id", "")
        normalized_title = normalize_title(title)
        if not normalized_title:
            continue
        title_tokens = tokenize(normalized_title)
        ratio = SequenceMatcher(None, normalized_text, normalized_title).ratio()
        token_score = 0.0
        if text_tokens and title_tokens:
            overlap = len(text_tokens & title_tokens)
            union = len(text_tokens | title_tokens)
            token_score = overlap / union if union else 0.0
        score = ratio * 0.6 + token_score * 0.4
        if manhwa_id and manhwa_id in normalized_text:
            score = max(score, 0.85)
        if score > best_score:
            runner_up = best_score
            best_score = score
            best_id = manhwa_id
        elif score > runner_up:
            runner_up = score
    if best_score < min_score or (best_score - runner_up) < 0.08:
        return None, best_score
    return best_id, best_score


def extract_chapter_numbers(text: str) -> List[str]:
    if not text:
        return []
    normalized = _normalize_for_chapters(text)
    normalized = normalized.replace("—", "-").replace("–", "-").replace("to", "-")
    normalized = normalized.replace("_", " ")
    results: List[str] = []
    keyword = r"(?:" + "|".join(CHAPTER_KEYWORDS) + r")"

    def _norm_number(value: str) -> str:
        return value.replace(",", ".").strip()

    range_patterns = [
        rf"{keyword}\s*#?(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)",
        rf"#?(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)\s*{keyword}",
    ]
    for pattern in range_patterns:
        for start, end in re.findall(pattern, normalized):
            start_norm = _norm_number(start)
            end_norm = _norm_number(end)
            if start_norm.isdigit() and end_norm.isdigit():
                start_int = int(start_norm)
                end_int = int(end_norm)
                if end_int >= start_int and (end_int - start_int) <= 250:
                    results.extend([str(num) for num in range(start_int, end_int + 1)])
                    continue
            results.append(start_norm)
            results.append(end_norm)

    single_patterns = [
        rf"{keyword}\s*#?(\d+(?:[.,]\d+)?)",
        rf"#?(\d+(?:[.,]\d+)?)\s*{keyword}",
    ]
    for pattern in single_patterns:
        for value in re.findall(pattern, normalized):
            results.append(_norm_number(value))

    seen = set()
    ordered: List[str] = []
    for value in results:
        if not value:
            continue
        if value in seen:
            continue
        seen.add(value)
        ordered.append(value)
    return ordered


def _normalize_for_chapters(value: str) -> str:
    value = value or ""
    value = _strip_accents(value.lower())
    value = re.sub(r"https?://\S+", " ", value)
    value = re.sub(r"[@#]\S+", " ", value)
    value = re.sub(r"[\[\]\(\)\{\}_]+", " ", value)
    value = re.sub(r"[^\w\s\-\.,]", " ", value, flags=re.UNICODE)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def _strip_accents(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    return "".join(char for char in normalized if not unicodedata.combining(char))

