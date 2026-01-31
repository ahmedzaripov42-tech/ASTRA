from __future__ import annotations

from pathlib import Path
from typing import List

from pdf2image import convert_from_path
from pdf2image.exceptions import PDFInfoNotInstalledError, PDFPageCountError


def pdf_to_images(pdf_path: str | Path, output_folder: str | Path) -> List[Path]:
    output_folder = Path(output_folder)
    output_folder.mkdir(parents=True, exist_ok=True)
    try:
        pages = convert_from_path(
            str(pdf_path),
            dpi=300,
            fmt="jpeg",
            jpegopt={"quality": 100, "optimize": False},
        )
    except PDFInfoNotInstalledError as exc:
        raise RuntimeError("Poppler is not installed or not in PATH.") from exc
    except PDFPageCountError as exc:
        raise RuntimeError("Failed to read PDF page count.") from exc
    output_files: List[Path] = []
    for i, page in enumerate(pages):
        output_path = output_folder / f"{i + 1:03}.jpg"
        page.save(output_path, "JPEG", quality=100)
        output_files.append(output_path)
    return output_files

