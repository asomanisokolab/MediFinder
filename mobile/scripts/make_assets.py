"""Draws the app icon, Android adaptive-icon layers and splash image from the
FindCare Ghana mark (white cross with a pulse line on teal).

Run from mobile/:  python scripts/make_assets.py   (needs Pillow)
"""
from pathlib import Path

from PIL import Image, ImageDraw

ASSETS = Path(__file__).resolve().parent.parent / "assets"
TEAL = (15, 118, 110, 255)
WHITE = (255, 255, 255, 255)
PULSE = (252, 165, 165, 255)
SIZE = 1024
SS = 2  # supersampling

# The mark on a 64-unit grid, as in frontend/images/findcareghana-icon.svg.
CROSS = [(27, 12), (37, 12), (37, 27), (52, 27), (52, 37), (37, 37), (37, 52),
         (27, 52), (27, 37), (12, 37), (12, 27), (27, 27)]
LINE = [(8, 41), (20, 41), (25, 33), (32, 48), (39, 36), (44, 41), (56, 41)]


def mark(img, box, left, top, cross=WHITE, pulse=PULSE):
    d = ImageDraw.Draw(img)
    u = box / 64
    d.polygon([(left + x * u, top + y * u) for x, y in CROSS], fill=cross)
    pts = [(left + x * u, top + y * u) for x, y in LINE]
    w = round(3.5 * u)
    d.line(pts, fill=pulse, width=w, joint="curve")
    for x, y in (pts[0], pts[-1]):
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=pulse)


def canvas(color=(0, 0, 0, 0)):
    return Image.new("RGBA", (SIZE * SS, SIZE * SS), color)


def save(img, name, rgb=False):
    out = img.resize((SIZE, SIZE), Image.LANCZOS)
    (out.convert("RGB") if rgb else out).save(ASSETS / name)


big = SIZE * SS

# Store icon: full-bleed teal square (stores and launchers round the corners).
icon = canvas(TEAL)
mark(icon, big * 0.86, big * 0.07, big * 0.07)
save(icon, "icon.png", rgb=True)

# Adaptive foreground: only the centre 66/108 is guaranteed to show.
fg = canvas()
box = big * 66 / 108
mark(fg, box, (big - box) / 2, (big - box) / 2)
save(fg, "android-icon-foreground.png")

# Android 13+ themed icon: one colour, the system tints it.
mono = canvas()
mark(mono, box, (big - box) / 2, (big - box) / 2, cross=WHITE, pulse=WHITE)
save(mono, "android-icon-monochrome.png")

# Splash: the icon tile on transparent; app.json sets the dark teal backdrop.
splash = canvas()
d = ImageDraw.Draw(splash)
d.rounded_rectangle([0, 0, big - 1, big - 1], radius=big * 0.22, fill=TEAL)
mark(splash, big * 0.86, big * 0.07, big * 0.07)
save(splash, "splash-icon.png")

# Web favicon (expo start --web).
icon.resize((48, 48), Image.LANCZOS).convert("RGB").save(ASSETS / "favicon.png")

for stale in ("android-icon-background.png",):
    (ASSETS / stale).unlink(missing_ok=True)
print("Assets written to", ASSETS)
