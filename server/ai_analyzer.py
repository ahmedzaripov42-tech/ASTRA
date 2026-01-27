from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from statistics import median
from typing import List

from PIL import Image, ImageStat


@dataclass
class AnalysisResult:
    page_count: int
    orientation: str
    avg_ratio: float
    suggested_mode: str
    blank_pages: List[Path]
    corrupted_pages: List[Path]
    possible_cover: bool


def analyze_images(image_paths: List[Path]) -> AnalysisResult:
    ratios: List[float] = []
    corrupted: List[Path] = []
    blanks: List[Path] = []

    for path in image_paths:
        try:
            with Image.open(path) as img:
                img = img.convert("L")
                ratio = img.height / float(img.width)
                ratios.append(ratio)
                if _is_blank(img):
                    blanks.append(path)
        except Exception:  # noqa: BLE001
            corrupted.append(path)

    valid_count = len(image_paths) - len(corrupted)
    avg_ratio = sum(ratios) / len(ratios) if ratios else 1.0
    orientation = _orientation_label(avg_ratio)
    suggested_mode = "lossless" if avg_ratio >= 1.6 else "webtoon"
    possible_cover = _detect_cover(ratios)

    return AnalysisResult(
        page_count=max(valid_count - len(blanks), 0),
        orientation=orientation,
        avg_ratio=avg_ratio,
        suggested_mode=suggested_mode,
        blank_pages=blanks,
        corrupted_pages=corrupted,
        possible_cover=possible_cover,
    )


def prune_trailing_blanks(image_paths: List[Path], blank_pages: List[Path]) -> List[Path]:
    blank_set = {path.resolve() for path in blank_pages}
    result = list(image_paths)
    while result and result[-1].resolve() in blank_set:
        result.pop()
    return result


def _orientation_label(avg_ratio: float) -> str:
    if avg_ratio >= 1.6:
        return "Vertical"
    if avg_ratio <= 0.9:
        return "Horizontal"
    return "Normal"


def _detect_cover(ratios: List[float]) -> bool:
    if len(ratios) < 3:
        return False
    med = median(ratios)
    return abs(ratios[0] - med) >= 0.35


def _is_blank(img: Image.Image) -> bool:
    stat = ImageStat.Stat(img)
    mean = stat.mean[0]
    rms = stat.rms[0]
    return mean >= 245 and rms <= 5


def _trailing_blank_count(image_paths: List[Path], blank_pages: List[Path]) -> int:
    blank_set = {path.resolve() for path in blank_pages}
    count = 0
    for path in reversed(image_paths):
        if path.resolve() in blank_set:
            count += 1
        else:
            break
    return count

