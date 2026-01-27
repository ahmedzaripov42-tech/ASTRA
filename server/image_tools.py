from __future__ import annotations

from pathlib import Path
from typing import Optional, Tuple

from PIL import Image, ImageDraw, ImageFont


def optimize_image(image_path: Path, mode: str) -> Path:
    image_path = Path(image_path)
    with Image.open(image_path) as img:
        img = img.convert("RGB")
        if mode == "webtoon":
            img = _resize_width(img, 900)
            img.save(image_path, "JPEG", quality=88, optimize=True, progressive=True)
            return image_path
        if mode == "smart":
            img.save(image_path, "JPEG", quality=85, optimize=True, progressive=True)
            return image_path
        if mode == "lossless":
            img.save(image_path, "JPEG", quality=100, optimize=False, progressive=False)
            return image_path
        img.save(image_path, "JPEG", quality=100, optimize=False, progressive=False)
    return image_path


def apply_dmca_guard(image_path: Path, text: str, opacity: float) -> None:
    if not text or opacity <= 0:
        return
    image_path = Path(image_path)
    with Image.open(image_path) as img:
        img = img.convert("RGBA")
        watermark = Image.new("RGBA", img.size, (255, 255, 255, 0))
        draw = ImageDraw.Draw(watermark)
        font = ImageFont.load_default()
        text_width, text_height = draw.textsize(text, font=font)
        position = (img.width - text_width - 12, img.height - text_height - 12)
        alpha = int(255 * min(max(opacity, 0.0), 1.0))
        draw.text(position, text, fill=(255, 255, 255, alpha), font=font)
        combined = Image.alpha_composite(img, watermark).convert("RGB")
        combined.save(image_path, "JPEG", quality=95, optimize=True)


def generate_cover(
    title: str,
    output_path: Path,
    source_image: Optional[Path] = None,
    size: Tuple[int, int] = (600, 900),
) -> Path:
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if source_image and source_image.exists():
        with Image.open(source_image) as img:
            img = img.convert("RGB")
            img = img.resize(size, Image.LANCZOS)
            img.save(output_path, "JPEG", quality=95, optimize=True)
            return output_path

    cover = Image.new("RGB", size, (20, 20, 20))
    draw = ImageDraw.Draw(cover)
    font = ImageFont.load_default()
    text = title.strip() or "New Manhwa"
    text_width, text_height = draw.textsize(text, font=font)
    position = ((size[0] - text_width) // 2, (size[1] - text_height) // 2)
    draw.text(position, text, fill=(235, 235, 235), font=font)
    cover.save(output_path, "JPEG", quality=95, optimize=True)
    return output_path


def _resize_width(img: Image.Image, target_width: int) -> Image.Image:
    if img.width <= target_width:
        return img
    ratio = target_width / float(img.width)
    height = int(img.height * ratio)
    return img.resize((target_width, height), Image.LANCZOS)

