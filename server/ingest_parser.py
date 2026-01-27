from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Optional


@dataclass
class GuessResult:
    manhwa_id: Optional[str]
    chapter: Optional[str]
    confidence: float


def guess_from_filename(filename: str, manhwas: List[dict]) -> GuessResult:
    name = _normalize(filename)
    manhwa_id = _match_manhwa(name, manhwas)
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
        title = _normalize(item["title"])
        if title and title in name:
            return item["id"]
    return None


def _match_chapter(name: str) -> Optional[str]:
    match = re.search(r"(?:ch|chapter|c)?\s*(\d+(?:\.\d+)?)", name)
    if match:
        return match.group(1)
    return None


def _normalize(value: str) -> str:
    value = value.lower()
    value = re.sub(r"[\[\]\(\)\{\}_-]+", " ", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()

