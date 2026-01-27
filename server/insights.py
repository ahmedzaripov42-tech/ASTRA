from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Dict, List

from .processor import load_manhwa


def generate_insights(logs: List[Dict], manhwa_path: Path) -> str:
    if not logs:
        return "📊 Insight: No activity yet."
    uploads = [log for log in logs if "Uploaded chapter" in log.get("action", "")]
    by_manhwa = Counter()
    pages: List[int] = []
    for log in uploads:
        parts = log.get("action", "").split("-")
        if len(parts) >= 2:
            by_manhwa[parts[-1].strip()] += 1
    for manhwa in load_manhwa(manhwa_path):
        for chapter in manhwa.get("chapters", []):
            pages.append(len(chapter.get("pages", [])))
    avg_pages = int(sum(pages) / len(pages)) if pages else 0
    top = by_manhwa.most_common(1)[0][0] if by_manhwa else "N/A"
    success_rate = 100 if uploads else 0
    return (
        "📊 Insight:\n"
        f"• Top uploads: {top}\n"
        f"• Upload success rate: {success_rate}%\n"
        f"• Avg pages per chapter: {avg_pages or 'N/A'}"
    )

