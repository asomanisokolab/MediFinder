"""Draws the Android launcher icons and splash screens from the FindCare
Ghana mark (white cross with a pulse line on teal), at every density.

Run from mobile/:  python scripts/make_icons.py
Needs Pillow. Re-run after `npx cap add android` regenerates resources.
"""
from pathlib import Path

from PIL import Image, ImageDraw

RES = Path(__file__).resolve().parent.parent / "android" / "app" / "src" / "main" / "res"
TEAL = (15, 118, 110, 255)
DEEP = (11, 59, 54, 255)
WHITE = (255, 255, 255, 255)
PULSE = (252, 165, 165, 255)
SCALE = 4  # supersampling for smooth edges

# The mark on a 64-unit grid, as in findcareghana-icon.svg.
CROSS = [(27, 12), (37, 12), (37, 27), (52, 27), (52, 37), (37, 37), (37, 52),
         (27, 52), (27, 37), (12, 37), (12, 27), (27, 27)]
LINE = [(8, 41), (20, 41), (25, 33), (32, 48), (39, 36), (44, 41), (56, 41)]


def draw_mark(img, box_px, left, top):
    """Draws the mark scaled so 64 units = box_px, with its grid at left/top."""
    d = ImageDraw.Draw(img)
    u = box_px / 64
    d.polygon([(left + x * u, top + y * u) for x, y in CROSS], fill=WHITE)
    points = [(left + x * u, top + y * u) for x, y in LINE]
    width = max(1, round(3.5 * u))
    d.line(points, fill=PULSE, width=width, joint="curve")
    r = width / 2
    for x, y in (points[0], points[-1]):
        d.ellipse([x - r, y - r, x + r, y + r], fill=PULSE)


def finish(img, size):
    return img.resize((size, size), Image.LANCZOS)


def legacy(size, round_shape):
    big = size * SCALE
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = big * 0.04
    if round_shape:
        d.ellipse([pad, pad, big - pad, big - pad], fill=TEAL)
    else:
        d.rounded_rectangle([pad, pad, big - pad, big - pad], radius=big * 0.22, fill=TEAL)
    draw_mark(img, big * 0.92, big * 0.04, big * 0.04)
    return finish(img, size)


def foreground(size):
    # Adaptive icons: 108dp canvas, only the centre 66dp is always visible.
    big = size * SCALE
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    box = big * 72 / 108
    draw_mark(img, box, (big - box) / 2, (big - box) / 2)
    return finish(img, size)


def splash(width, height):
    big_w, big_h = width * 2, height * 2
    img = Image.new("RGBA", (big_w, big_h), DEEP)
    d = ImageDraw.Draw(img)
    side = min(big_w, big_h) * 0.34
    left, top = (big_w - side) / 2, (big_h - side) / 2
    d.rounded_rectangle([left, top, left + side, top + side], radius=side * 0.22, fill=TEAL)
    draw_mark(img, side, left, top)
    return img.resize((width, height), Image.LANCZOS).convert("RGB")


for folder in sorted(RES.glob("mipmap-*dpi")):
    size = Image.open(folder / "ic_launcher.png").size[0]
    legacy(size, False).save(folder / "ic_launcher.png")
    legacy(size, True).save(folder / "ic_launcher_round.png")
    fg = Image.open(folder / "ic_launcher_foreground.png").size[0]
    foreground(fg).save(folder / "ic_launcher_foreground.png")

for path in sorted(RES.glob("drawable*/splash.png")):
    w, h = Image.open(path).size
    splash(w, h).save(path)

(RES / "values" / "ic_launcher_background.xml").write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
    '    <color name="ic_launcher_background">#0F766E</color>\n</resources>\n',
    encoding="utf-8",
)
print("Icons and splash screens written")
