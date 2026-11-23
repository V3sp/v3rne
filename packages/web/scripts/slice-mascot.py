#!/usr/bin/env python3
"""Wycina naklejki maskotki z arkusza 5x3 i usuwa białe tło.

Wymaga Pillow, numpy i scipy (uruchamiane z tymczasowego venv, nie z projektu).
Użycie:
    python slice-mascot.py [źródło.jpg] [katalog_wyjściowy]
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

SHEET_W, SHEET_H = 2752, 1536
RIM = 14  # szerokość białego obrysu naklejki w px arkusza
OUT_WIDTH = 512
MARGIN = 60  # zapas wokół komórki, żeby obrys nie został obcięty

# Granice komórek w px arkusza (środki białych rynien między sąsiadami) —
# siatka nie jest idealnie równa, więc mierzone, nie liczone z 2752/5.
COL_SPLITS = [0, 608, 1160, 1714, 2228, 2752]
ROW_SPLITS = [0, 527, 1032, 1536]

# (nazwa, wiersz od 1, kolumna od 1, domykanie szczelin między elementami w px)
STICKERS = [
    ("hello", 1, 1, 24),
    ("sprint", 3, 3, 30),
    ("zzz", 3, 4, 45),
]


def dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    if radius <= 0:
        return mask
    dist = ndimage.distance_transform_edt(~mask)
    return dist <= radius


def erode(mask: np.ndarray, radius: int) -> np.ndarray:
    if radius <= 0:
        return mask
    dist = ndimage.distance_transform_edt(mask)
    return dist > radius


def fill_holes(mask: np.ndarray) -> np.ndarray:
    """Wypełnia tło otoczone artworkiem (oczy, kubek, wnętrza liter)."""
    return ndimage.binary_fill_holes(mask)


def keep_target_components(art: np.ndarray, cell: tuple[int, int, int, int]) -> np.ndarray:
    """Zostawia tylko elementy należące do komórki (bez fragmentów sąsiadów)."""
    x0, y0, x1, y1 = cell
    labels, count = ndimage.label(art, structure=np.ones((3, 3)))
    keep = np.zeros_like(art)
    for idx in range(1, count + 1):
        ys, xs = np.where(labels == idx)
        inside = ((xs >= x0) & (xs < x1) & (ys >= y0) & (ys < y1)).sum()
        if inside * 2 >= len(xs):
            keep |= labels == idx
    return keep


def build_alpha(rgb: np.ndarray, cell: tuple[int, int, int, int], merge: int) -> np.ndarray:
    lum = rgb.astype(np.float32).mean(axis=2)
    art = keep_target_components(lum < 140, cell)
    # zapas na morfologię, żeby domykanie nie zostało obcięte krawędzią kadru
    pad = RIM + merge + 8
    art_p = np.pad(art, pad, constant_values=False)
    sticker = fill_holes(art_p)
    sticker = dilate(sticker, RIM)
    sticker = dilate(sticker, merge)
    sticker = erode(sticker, merge)
    sticker = sticker[pad:-pad, pad:-pad]

    # odrzuca pyłki JPEG i resztki elementów bez własnego atramentu
    labels, count = ndimage.label(sticker)
    for idx in range(1, count + 1):
        piece = labels == idx
        if piece.sum() < 40 or not (piece & art).any():
            sticker &= ~piece

    alpha = (sticker * 255).astype(np.uint8)
    soft = np.asarray(Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(1.0)))
    a = np.clip((soft.astype(np.float32) / 255.0 - 0.45) / 0.25, 0.0, 1.0)

    # czyści pojedyncze wyspy pozostałe po progowaniu rozmycia
    labels, count = ndimage.label(a > 0.03)
    for idx in range(1, count + 1):
        piece = labels == idx
        if piece.sum() < 30:
            a[piece] = 0.0
    return (a * 255).astype(np.uint8)


def crop_to_content(rgba: Image.Image, pad: int = 2) -> Image.Image:
    bbox = rgba.getchannel("A").getbbox()
    if bbox is None:
        return rgba
    left, top, right, bottom = bbox
    return rgba.crop(
        (
            max(0, left - pad),
            max(0, top - pad),
            min(rgba.width, right + pad),
            min(rgba.height, bottom + pad),
        )
    )


def resize_rgba(img: Image.Image, width: int) -> Image.Image:
    height = round(img.height * width / img.width)
    arr = np.asarray(img).astype(np.float32) / 255.0
    alpha = arr[..., 3:4]
    premul = np.concatenate([arr[..., :3] * alpha, alpha], axis=2)
    small = Image.fromarray((premul * 255).round().astype(np.uint8))
    small = small.resize((width, height), Image.LANCZOS)
    out = np.asarray(small).astype(np.float32) / 255.0
    a = out[..., 3:4]
    rgb = np.where(a > 0, out[..., :3] / np.maximum(a, 1e-6), 1.0)
    return Image.fromarray(
        (np.concatenate([np.clip(rgb, 0, 1), a], axis=2) * 255).round().astype(np.uint8)
    )


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else (
        Path(__file__).resolve().parents[4] / "Gemini_Generated_Image_qtal4qtal4qtal4q.jpg"
    )
    out_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else (
        Path(__file__).resolve().parents[1] / "public" / "mascot"
    )
    out_dir.mkdir(parents=True, exist_ok=True)

    sheet = Image.open(src).convert("RGB")
    sheet_arr = np.asarray(sheet)

    for name, row, col, merge in STICKERS:
        cx0, cx1 = COL_SPLITS[col - 1], COL_SPLITS[col]
        cy0, cy1 = ROW_SPLITS[row - 1], ROW_SPLITS[row]
        x0 = max(0, cx0 - MARGIN)
        y0 = max(0, cy0 - MARGIN)
        x1 = min(SHEET_W, cx1 + MARGIN)
        y1 = min(SHEET_H, cy1 + MARGIN)
        cell = sheet_arr[y0:y1, x0:x1]
        bounds = (cx0 - x0, cy0 - y0, cx1 - x0, cy1 - y0)
        alpha = build_alpha(cell, bounds, merge)
        rgba = Image.fromarray(np.dstack([cell, alpha]))
        rgba = crop_to_content(rgba)
        rgba = resize_rgba(rgba, OUT_WIDTH)
        path = out_dir / f"{name}.png"
        rgba.save(path, "PNG", optimize=True)
        print(f"{path.name}: {rgba.width}x{rgba.height}, {path.stat().st_size} B")


if __name__ == "__main__":
    main()
