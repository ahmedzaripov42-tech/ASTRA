from __future__ import annotations

from dataclasses import dataclass
from typing import List


@dataclass
class ChapterConflict:
    exists: bool
    suggested_new: str


def analyze_chapter_conflict(existing_numbers: List[str], desired: str) -> ChapterConflict:
    if desired not in existing_numbers:
        return ChapterConflict(exists=False, suggested_new=desired)
    suggested = _next_available_version(existing_numbers, desired)
    return ChapterConflict(exists=True, suggested_new=suggested)


def _next_available_version(existing: List[str], base: str) -> str:
    try:
        number = float(base)
    except ValueError:
        return f"{base}-v2"
    candidate = number + 0.5
    while _format_number(candidate) in existing:
        candidate += 0.1
    return _format_number(candidate)


def _format_number(value: float) -> str:
    if value.is_integer():
        return str(int(value))
    return f"{value:.1f}".rstrip("0").rstrip(".")

