"""Draw Surveyr's app icon source (icons/source.png, 1024x1024).

Full-bleed and opaque on purpose: macOS 26+ applies its own rounded-square
mask, and an icon with its own rounded corners / transparent margin gets put
on a light backing plate instead ("icon inside an icon").

    ../../../backend/.venv/bin/python make_icon.py
    npx tauri icon src-tauri/icons/source.png -o src-tauri/icons   # from frontend/
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 1024
SUPERSAMPLE = 2  # draw at 2x and downscale for smooth dots
BG_TOP = (36, 39, 46)
BG_BOTTOM = (22, 24, 29)
GRID = (58, 70, 88)
AMBER = (245, 180, 0)
ROWS = 9
DOTS_PER_ROW = 70
MARGIN = 0.15  # artwork inset as a fraction of the canvas; keeps it clear of the corner mask


def ridge(t: float) -> float:
    """Terrain profile height (0 = top of artwork box) along t in 0..1."""
    return (
        0.55
        - 0.30 * math.exp(-(((t - 0.38) / 0.13) ** 2))
        - 0.18 * math.exp(-(((t - 0.72) / 0.10) ** 2))
        + 0.04 * math.sin(t * 18)
    )


def dot_colour(t: float) -> tuple:
    """Low ground cyan → high ground amber, matching the app's elevation feel."""
    h = 1 - (ridge(t) - 0.2) / 0.45
    if h >= 0.75:
        return AMBER
    return (int(40 + 205 * h), int(210 - 30 * h), int(230 - 230 * h))


def draw() -> Image.Image:
    s = SIZE * SUPERSAMPLE
    img = Image.new("RGB", (s, s))
    d = ImageDraw.Draw(img)
    for y in range(s):  # subtle vertical gradient, edge to edge
        f = y / (s - 1)
        d.line([(0, y), (s, y)], fill=tuple(round(a + (b - a) * f) for a, b in zip(BG_TOP, BG_BOTTOM)))

    m = s * MARGIN
    box = s - 2 * m
    for i in range(1, 6):  # survey grid lines
        y = m + i * box / 6
        d.line([(m, y), (s - m, y)], fill=GRID, width=3 * SUPERSAMPLE)

    row_gap = box * 0.033
    for row in range(ROWS):
        alpha = 1.0 if row == 0 else max(0.25, 0.86 - row * 0.09)
        r = (9 if row == 0 else 6) * SUPERSAMPLE
        for k in range(DOTS_PER_ROW):
            t = k / (DOTS_PER_ROW - 1)
            x = m + t * box
            y = m + ridge(t) * box + row * row_gap
            c = dot_colour(t)
            bg = img.getpixel((int(x), int(min(y, s - 1))))
            fill = tuple(round(bc + (cc - bc) * alpha) for bc, cc in zip(bg, c))
            d.ellipse([x - r, y - r, x + r, y + r], fill=fill)

    return img.resize((SIZE, SIZE), Image.LANCZOS)


if __name__ == "__main__":
    out = Path(__file__).with_name("source.png")
    draw().save(out)
    print(f"wrote {out}")
