"""Build 9:16 YouTube Shorts from the feature promos.

    .venv\\Scripts\\python.exe docs/promo/build_feature_shorts.py
    .venv\\Scripts\\python.exe docs/promo/build_feature_shorts.py insert-kanban insert-menu

Writes gallery-short.mp4, games-short.mp4, shop-noteslist-short.mp4,
insert-kanban-short.mp4, and insert-menu-short.mp4 (1080x1920, 25s).
Text stays clear of the Shorts side buttons and the bottom caption bar.
"""

from __future__ import annotations

import math
import struct
import subprocess
import sys
import wave
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
SHOTS = ROOT / "docs" / "screenshots"
OUT_DIR = Path(__file__).resolve().parent

W, H = 1080, 1920
FPS = 30
DURATION = 25.0

# Shorts chrome: channel row on top, like/share on the right, caption below.
SAFE_X = 64
SAFE_R = 900
SAFE_TOP = 280

BG = (11, 18, 32)
INK = (15, 23, 42)
YELLOW = (240, 224, 112)
WHITE = (248, 250, 252)
MUTED = (203, 213, 225)
PAPER = (255, 255, 255)
BLUE = (37, 99, 235)
CARD = (241, 245, 249)

GREEN = (22, 163, 74)
RED = (220, 38, 38)
ORANGE = (234, 88, 12)
SLATE = (100, 116, 139)
LINE = (203, 213, 225)

FONT_BOLD = Path(r"C:\Windows\Fonts\segoeuib.ttf")
FONT_REG = Path(r"C:\Windows\Fonts\segoeui.ttf")
FONT_MONO = Path(r"C:\Windows\Fonts\consola.ttf")
COL_W = SAFE_R - SAFE_X


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_BOLD if bold else FONT_REG), size)


def mono(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_MONO), size)


def smooth(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def base() -> Image.Image:
    img = Image.new("RGB", (W, H), BG)
    ImageDraw.Draw(img).rectangle((0, 0, W, 8), fill=YELLOW)
    return img


def center_text(draw, xy, text, face, fill):
    box = draw.textbbox((0, 0), text, font=face)
    tw, th = box[2] - box[0], box[3] - box[1]
    draw.text((xy[0] - tw / 2, xy[1] - th / 2), text, font=face, fill=fill)


def wrap(draw, text: str, face, max_w: int) -> list[str]:
    lines, cur = [], ""
    for word in text.split():
        trial = word if not cur else f"{cur} {word}"
        if draw.textlength(trial, font=face) <= max_w:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines or [""]


def draw_lines(draw, x, y, lines, face, fill, leading) -> int:
    for line in lines:
        draw.text((x, y), line, font=face, fill=fill)
        y += leading
    return y


def hook(img: Image.Image, kicker: str, headline: str) -> int:
    draw = ImageDraw.Draw(img)
    draw.text((SAFE_X, SAFE_TOP), kicker.upper(), font=font(26, True), fill=YELLOW)
    face = font(52, True)
    lines = wrap(draw, headline, face, COL_W)
    return draw_lines(draw, SAFE_X, SAFE_TOP + 52, lines, face, WHITE, 64)


def title_card(kicker: str, title: str, subtitle: str) -> Image.Image:
    img = base()
    note = Image.new("RGBA", (860, 520), (0, 0, 0, 0))
    nd = ImageDraw.Draw(note)
    nd.rounded_rectangle((20, 48, 840, 490), radius=12, fill=(243, 232, 120, 255), outline=(17, 17, 17, 255), width=4)
    nd.ellipse((394, 8, 466, 80), fill=(227, 27, 35, 255), outline=(17, 17, 17, 255), width=3)
    nd.text((56, 110), kicker.upper(), font=font(26, True), fill=(80, 60, 20, 255))
    title_face = font(64, True)
    y = draw_lines(nd, 56, 164, wrap(nd, title, title_face, 740), title_face, (17, 17, 17, 255), 76)
    sub_face = font(32)
    draw_lines(nd, 56, y + 16, wrap(nd, subtitle, sub_face, 740), sub_face, (30, 30, 30, 255), 42)
    note = note.rotate(-2.0, resample=Image.Resampling.BICUBIC, expand=True)
    img.paste(note, (SAFE_X - 10, 620), note)
    return img


def end_card(title: str, line: str, button: str) -> Image.Image:
    img = base()
    draw = ImageDraw.Draw(img)
    title_face = font(64, True)
    y = 640
    for row in wrap(draw, title, title_face, COL_W):
        draw.text((SAFE_X, y), row, font=title_face, fill=YELLOW)
        y += 78
    y += 24
    url_face = font(32, True)
    for row in wrap(draw, "thgsoft.online/DjangoNotesPro", url_face, COL_W):
        draw.text((SAFE_X, y), row, font=url_face, fill=WHITE)
        y += 46
    y += 16
    line_face = font(30)
    for row in wrap(draw, line, line_face, COL_W):
        draw.text((SAFE_X, y), row, font=line_face, fill=MUTED)
        y += 42
    y += 36
    draw.rounded_rectangle((SAFE_X, y, SAFE_X + 520, y + 92), radius=12, fill=YELLOW)
    center_text(draw, (SAFE_X + 260, y + 46), button, font(32, True), INK)
    return img


def pill_card(kicker: str, headline: str, items: list[str]) -> Image.Image:
    img = base()
    y = hook(img, kicker, headline) + 36
    draw = ImageDraw.Draw(img)
    cell_h = 100
    for label in items:
        draw.rounded_rectangle((SAFE_X, y, SAFE_R, y + cell_h), radius=14, fill=(30, 41, 59))
        draw.text((SAFE_X + 28, y + 28), label, font=font(34, True), fill=WHITE)
        y += cell_h + 16
    return img


def shot_card(filename: str, kicker: str, headline: str) -> Image.Image:
    img = base()
    y = hook(img, kicker, headline) + 28
    src = Image.open(SHOTS / filename).convert("RGB")
    box_w, box_h = COL_W, 980
    scale = min(box_w / src.width, box_h / src.height)
    shot = src.resize((max(1, int(src.width * scale)), max(1, int(src.height * scale))), Image.Resampling.LANCZOS)
    framed = Image.new("RGBA", shot.size, (0, 0, 0, 0))
    framed.paste(shot, (0, 0))
    mask = Image.new("L", shot.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, shot.width - 1, shot.height - 1), radius=16, fill=255)
    framed.putalpha(mask)
    img.paste(framed, (SAFE_X, y), framed)
    return img


def paper_panel(title: str, width: int, height: int) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    panel = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(panel)
    draw.rounded_rectangle((0, 0, width - 1, height - 1), radius=18, fill=PAPER + (255,))
    face = font(36, True)
    lines = wrap(draw, title, face, width - 72)
    y = draw_lines(draw, 32, 28, lines, face, INK + (255,), 46)
    draw.line((32, y + 8, width - 32, y + 8), fill=(226, 232, 240, 255), width=2)
    return panel, draw


def shop_card() -> Image.Image:
    img = base()
    top = hook(img, "Shop", "Catalog, cart, and checkout") + 28
    width = COL_W
    panel, draw = paper_panel("Office shop", width, 760)
    rows = (
        ("Notebook A5", "Lined, 80 pages", "4.50 EUR"),
        ("Pens, pack of 10", "Smooth black ink", "3.20 EUR"),
        ("Coffee beans", "250g medium roast", "12.00 EUR"),
    )
    for i, (name, note, price) in enumerate(rows):
        y = 130 + i * 128
        draw.rounded_rectangle((28, y, width - 28, y + 112), radius=12, fill=CARD + (255,))
        draw.text((48, y + 18), name, font=font(28, True), fill=INK + (255,))
        draw.text((48, y + 60), note, font=font(22), fill=(71, 85, 105, 255))
        price_face = font(24, True)
        price_w = draw.textbbox((0, 0), price, font=price_face)[2]
        add_x = width - 132
        draw.text((add_x - 20 - price_w, y + 36), price, font=price_face, fill=BLUE + (255,))
        draw.rounded_rectangle((add_x, y + 32, width - 44, y + 80), radius=8, fill=BLUE + (255,))
        center_text(draw, ((add_x + width - 44) // 2, y + 56), "Add", font(22, True), WHITE + (255,))
    draw.text((32, 530), "Cart  19.70 EUR", font=font(26, True), fill=INK + (255,))
    labels = ("PayPal", "Visa", "Mastercard")
    btn_w = (width - 64 - 16 * 2) // 3
    for i, label in enumerate(labels):
        x = 32 + i * (btn_w + 16)
        draw.rounded_rectangle((x, 580, x + btn_w, 636), radius=8, fill=YELLOW + (255,))
        center_text(draw, (x + btn_w // 2, 608), label, font(20, True), INK + (255,))
    draw.text((32, 670), "Card numbers are never stored.", font=font(22), fill=(71, 85, 105, 255))
    img.paste(panel, (SAFE_X, top), panel)
    return img


def menu_card() -> Image.Image:
    img = base()
    top = hook(img, "Menu", "Click a dish. Send the bill.") + 28
    width = COL_W
    panel, draw = paper_panel("Lunch menu", width, 700)
    draw.rounded_rectangle((width - 196, 24, width - 28, 76), radius=8, fill=YELLOW + (255,))
    center_text(draw, (width - 112, 50), "Table 2", font(22, True), INK + (255,))
    dishes = (
        ("Soup of the day", "6.50"),
        ("Mixed salad", "7.90"),
        ("Wiener schnitzel", "18.50"),
        ("Garlic spaghetti", "14.00"),
    )
    for i, (name, price) in enumerate(dishes):
        y = 140 + i * 88
        draw.text((36, y), name, font=font(30, True), fill=INK + (255,))
        price_face = font(28, True)
        price_w = draw.textbbox((0, 0), price, font=price_face)[2]
        draw.text((width - 36 - price_w, y), price, font=price_face, fill=BLUE + (255,))
    draw.rounded_rectangle((32, 520, 280, 584), radius=10, fill=BLUE + (255,))
    center_text(draw, (156, 552), "Send bill", font(24, True), WHITE + (255,))
    note = "Orders go to mail, chat, or a private message."
    draw_lines(draw, 32, 610, wrap(draw, note, font(22), width - 64), font(22), (71, 85, 105, 255), 30)
    img.paste(panel, (SAFE_X, top), panel)
    return img


def ads_card() -> Image.Image:
    img = base()
    top = hook(img, "NotesList", "Local ads. Reply to the group.") + 28
    width = COL_W
    panel, draw = paper_panel("NotesList  ·  Main", width, 700)
    for i, label in enumerate(("for sale", "housing", "jobs")):
        x = 32 + i * 168
        fill = BLUE if i == 0 else (226, 232, 240)
        ink = WHITE if i == 0 else INK
        draw.rounded_rectangle((x, 120, x + 152, 168), radius=20, fill=fill + (255,))
        center_text(draw, (x + 76, 144), label, font(20, True), ink + (255,))
    listings = (
        ("Desk lamp", "12 EUR", "Downtown  ·  pickup only"),
        ("Road bike", "180 EUR", "Harbor  ·  21-speed"),
        ("Studio loft", "780 EUR", "Old Town  ·  available Oct 1"),
    )
    for i, (name, price, place) in enumerate(listings):
        y = 200 + i * 140
        draw.rounded_rectangle((28, y, width - 28, y + 120), radius=12, fill=CARD + (255,))
        draw.text((48, y + 18), name, font=font(28, True), fill=INK + (255,))
        draw.text((48, y + 64), place, font=font(22), fill=(71, 85, 105, 255))
        price_face = font(24, True)
        price_w = draw.textbbox((0, 0), price, font=price_face)[2]
        draw.text((width - 48 - price_w, y + 40), price, font=price_face, fill=BLUE + (255,))
    img.paste(panel, (SAFE_X, top), panel)
    return img


def draw_cursor(draw, px: int, py: int, fill, outline) -> None:
    draw.polygon(
        [(px, py), (px, py + 42), (px + 11, py + 31), (px + 19, py + 48), (px + 27, py + 44), (px + 19, py + 28), (px + 33, py + 28)],
        fill=fill,
        outline=outline,
    )


def draw_grid_icon(draw, cx: int, cy: int, fill) -> None:
    for x in (cx - 13, cx + 2):
        for y in (cy - 13, cy + 2):
            draw.rectangle((x, y, x + 11, y + 11), fill=fill)


def draw_cutlery_icon(draw, cx: int, cy: int, fill) -> None:
    for x in (cx - 13, cx - 9, cx - 5):
        draw.line((x, cy - 15, x, cy - 4), fill=fill, width=2)
    draw.line((cx - 13, cy - 4, cx - 5, cy - 4), fill=fill, width=3)
    draw.line((cx - 9, cy - 4, cx - 9, cy + 15), fill=fill, width=4)
    draw.polygon([(cx + 5, cy - 15), (cx + 13, cy - 9), (cx + 13, cy + 1), (cx + 5, cy + 1)], fill=fill)
    draw.line((cx + 8, cy, cx + 8, cy + 15), fill=fill, width=4)


def toolbar_card(active: str, items: list[str], pick: int, statement: tuple[str, str], snippet: list[str], kicker: str, headline: str) -> Image.Image:
    img = base()
    y = hook(img, kicker, headline) + 40
    draw = ImageDraw.Draw(img)
    bw, gap = 64, 8
    draw.rounded_rectangle((SAFE_X, y, SAFE_R, y + bw + 24), radius=12, fill=(30, 41, 59))
    x, y0 = SAFE_X + 16, y + 12
    active_x = x
    for label in ["B", "I", "S", "|", "<>", "```", "|", "boards", "#", "menu", "%"]:
        if label == "|":
            draw.line((x + 2, y0 + 12, x + 2, y0 + bw - 12), fill=(71, 85, 105), width=2)
            x += 14
            continue
        is_active = label == active
        if is_active:
            draw.rounded_rectangle((x, y0, x + bw, y0 + bw), radius=10, fill=(51, 65, 85), outline=YELLOW, width=3)
            active_x = x
        cx, cy = x + bw // 2, y0 + bw // 2
        ink = WHITE if is_active else MUTED
        if label == "boards":
            draw_grid_icon(draw, cx, cy, ink)
        elif label == "menu":
            draw_cutlery_icon(draw, cx, cy, ink)
        else:
            draw.text((cx, cy), label, font=font(26, True), fill=ink, anchor="mm")
        x += bw + gap

    dw, row = 440, 84
    dx, dy = min(active_x, SAFE_R - dw), y0 + bw + 24
    draw.rounded_rectangle((dx, dy, dx + dw, dy + row * len(items) + 24), radius=12, fill=PAPER, outline=LINE, width=2)
    for i, label in enumerate(items):
        ry = dy + 12 + i * row
        if i == pick:
            draw.rounded_rectangle((dx + 10, ry, dx + dw - 10, ry + row - 8), radius=8, fill=BLUE)
        draw.text((dx + 32, ry + (row - 8) // 2), label, font=font(34, True), fill=WHITE if i == pick else INK, anchor="lm")
    draw_cursor(draw, dx + dw - 80, dy + 12 + pick * row + 32, WHITE, INK)

    y = dy + row * len(items) + 24 + 44
    draw.text((SAFE_X, y), statement[0], font=font(56, True), fill=WHITE)
    draw.text((SAFE_X, y + 68), statement[1], font=font(56, True), fill=YELLOW)
    y += 68 * 2 + 36

    size = 26
    while size > 16 and max(draw.textlength(line, font=mono(size)) for line in snippet) > COL_W - 64:
        size -= 1
    leading = size + 12
    draw.rounded_rectangle((SAFE_X, y, SAFE_R, y + 84 + leading * len(snippet)), radius=14, fill=(30, 41, 59))
    draw.text((SAFE_X + 32, y + 18), "Inserted into the page", font=font(22, True), fill=SLATE)
    for i, line in enumerate(snippet):
        ink = YELLOW if line.startswith("```") else WHITE if line.startswith("#") else MUTED
        draw.text((SAFE_X + 32, y + 60 + i * leading), line, font=mono(size), fill=ink)
    return img


def kanban_card() -> Image.Image:
    img = base()
    top = hook(img, "Kanban", "Drag cards between columns") + 28
    panel, draw = paper_panel("Board", COL_W, 900)
    col_w, gap = 251, 14
    columns = (
        ("Todo", [("Design wireframes", "First draft")]),
        ("Doing", [("Build API", "")]),
        ("Done", [("Kickoff", "")]),
    )
    for i, (name, cards) in enumerate(columns):
        x = 28 + i * (col_w + gap)
        draw.rounded_rectangle((x, 110, x + col_w, 870), radius=14, fill=CARD + (255,))
        draw.text((x + 18, 124), name, font=font(26, True), fill=INK + (255,))
        for j, (title, note) in enumerate(cards):
            y = 180 + j * 130
            draw.rounded_rectangle((x + 12, y, x + col_w - 12, y + 112), radius=10, fill=PAPER + (255,), outline=LINE + (255,), width=2)
            draw.text((x + 26, y + 18), title, font=font(22, True), fill=INK + (255,))
            if note:
                draw.text((x + 26, y + 60), note, font=font(20, True), fill=BLUE + (255,))
    draw.rounded_rectangle((40, 310, 28 + col_w - 12, 422), radius=10, outline=(148, 163, 184, 255), width=2)
    draw.text((54, 328), "Write copy", font=font(22, True), fill=(148, 163, 184, 255))

    card = Image.new("RGBA", (col_w - 12, 132), (0, 0, 0, 0))
    cd = ImageDraw.Draw(card)
    cd.rounded_rectangle((12, 16, col_w - 12, 128), radius=10, fill=(15, 23, 42, 70))
    cd.rounded_rectangle((0, 0, col_w - 24, 112), radius=10, fill=PAPER + (255,), outline=BLUE + (255,), width=3)
    cd.text((16, 40), "Write copy", font=font(22, True), fill=INK + (255,))
    card = card.rotate(4, resample=Image.Resampling.BICUBIC, expand=True)
    drop_x, drop_y = 28 + col_w + gap + 16, 330
    panel.alpha_composite(card, (drop_x, drop_y))
    draw_cursor(draw, drop_x + 150, drop_y + 70, INK + (255,), WHITE + (255,))
    img.paste(panel, (SAFE_X, top), panel)
    return img


def gantt_card() -> Image.Image:
    img = base()
    top = hook(img, "Gantt", "Phases on a timeline") + 28
    panel, draw = paper_panel("Project plan", COL_W, 620)
    tx0, tx1 = 200, 800
    span = (tx1 - tx0) / 31
    draw.text((28, 112), "Oct 2026", font=font(22, True), fill=SLATE + (255,))
    for day in (1, 8, 15, 22, 29):
        x = int(tx0 + (day - 1) * span)
        draw.line((x, 150, x, 560), fill=(226, 232, 240, 255), width=2)
        draw.text((x + 6, 112), str(day), font=font(22, True), fill=SLATE + (255,))
    rows = (
        ("Phase A", 1, 15, BLUE, "Start"),
        ("Phase B", 15, 31, GREEN, "Delivery"),
        ("Review", 22, 29, ORANGE, ""),
    )
    for i, (name, start, end, color, note) in enumerate(rows):
        y = 180 + i * 120
        draw.text((28, y + 14), name, font=font(26, True), fill=INK + (255,))
        xa, xb = int(tx0 + (start - 1) * span), int(tx0 + end * span)
        draw.rounded_rectangle((xa, y, xb, y + 60), radius=10, fill=color + (255,))
        if note:
            draw.text((xa + 16, y + 30), note, font=font(22, True), fill=WHITE + (255,), anchor="lm")
    today = int(tx0 + 5.5 * span)
    for y in range(150, 560, 22):
        draw.line((today, y, today, y + 12), fill=RED + (255,), width=3)
    img.paste(panel, (SAFE_X, top), panel)
    return img


def mindmap_card() -> Image.Image:
    img = base()
    top = hook(img, "Mindmap", "Indent a line, get a branch") + 28
    panel, draw = paper_panel("Ideas", COL_W, 760)
    face = font(24, True)

    def width(label: str) -> int:
        box = draw.textbbox((0, 0), label, font=face)
        return box[2] - box[0] + 48

    def curve(a, b) -> None:
        mx = (a[0] + b[0]) / 2
        pts = []
        for i in range(31):
            t = i / 30
            u = 1 - t
            x = u ** 3 * a[0] + 3 * u * u * t * mx + 3 * u * t * t * mx + t ** 3 * b[0]
            y = u ** 3 * a[1] + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t ** 3 * b[1]
            pts.append((x, y))
        draw.line(pts, fill=(148, 163, 184, 255), width=4)

    nodes = {
        "root": ((150, 420), "Central topic", YELLOW, INK),
        "a": ((420, 250), "Branch A", BLUE, WHITE),
        "b": ((420, 590), "Branch B", BLUE, WHITE),
        "a1": ((690, 170), "Detail A1", CARD, INK),
        "a2": ((690, 330), "Detail A2", CARD, INK),
        "b1": ((690, 590), "Detail B1", CARD, INK),
    }
    for parent, child in (("root", "a"), ("root", "b"), ("a", "a1"), ("a", "a2"), ("b", "b1")):
        (px, py), plabel, *_ = nodes[parent]
        (cx, cy), clabel, *_ = nodes[child]
        curve((px + width(plabel) // 2, py), (cx - width(clabel) // 2, cy))
    for (cx, cy), label, fill, ink in nodes.values():
        half = width(label) // 2
        draw.rounded_rectangle((cx - half, cy - 32, cx + half, cy + 32), radius=14, fill=fill + (255,), outline=LINE + (255,), width=2)
        draw.text((cx, cy), label, font=face, fill=ink + (255,), anchor="mm")
    img.paste(panel, (SAFE_X, top), panel)
    return img


def sprintboard_card() -> Image.Image:
    img = base()
    top = hook(img, "Kanban gantt", "Start, stop, and bill each task") + 28
    width = COL_W
    panel, draw = paper_panel("Sprint board", width, 860)
    cell_w = (width - 56 - 20) // 2
    columns = (
        ("Todo", "Design wireframes", "00:00:00", "0.00 EUR", "60 EUR/h", "Start", GREEN, False),
        ("Doing", "Build API", "00:42:10", "52.71 EUR", "75 EUR/h", "Stop", RED, True),
        ("Suspended", "On hold task", "00:30:00", "37.50 EUR", "75 EUR/h", "Resume", ORANGE, False),
        ("Done", "Kickoff", "02:00:00", "100.00 EUR", "50 EUR/h", "Done", SLATE, False),
    )
    for i, (name, title, timer, cost, rate, action, color, running) in enumerate(columns):
        cx = 28 + (i % 2) * (cell_w + 20)
        cy = 110 + (i // 2) * 330
        draw.rounded_rectangle((cx, cy, cx + cell_w, cy + 310), radius=14, fill=CARD + (255,))
        draw.text((cx + 20, cy + 14), name, font=font(26, True), fill=INK + (255,))
        y = cy + 64
        draw.rounded_rectangle((cx + 14, y, cx + cell_w - 14, y + 230), radius=10, fill=PAPER + (255,), outline=LINE + (255,), width=2)
        draw.text((cx + 32, y + 16), title, font=font(24, True), fill=INK + (255,))
        draw.text((cx + 32, y + 58), timer, font=mono(30), fill=INK + (255,))
        if running:
            draw.ellipse((cx + cell_w - 58, y + 66, cx + cell_w - 40, y + 84), fill=GREEN + (255,))
        draw.text((cx + 32, y + 108), cost, font=font(24, True), fill=BLUE + (255,))
        draw.text((cx + cell_w - 32, y + 112), rate, font=font(20), fill=SLATE + (255,), anchor="ra")
        draw.rounded_rectangle((cx + 32, y + 166, cx + 172, y + 208), radius=8, fill=color + (255,))
        center_text(draw, (cx + 102, y + 187), action, font(20, True), WHITE + (255,))
    draw.text((28, 785), "Total  03:12:10", font=font(28, True), fill=INK + (255,))
    draw.text((width - 28, 785), "190.21 EUR", font=font(28, True), fill=BLUE + (255,), anchor="ra")
    img.paste(panel, (SAFE_X, top), panel)
    return img


def swshop_card() -> Image.Image:
    img = base()
    top = hook(img, "SW shop", "Free downloads and paid licenses") + 28
    width = COL_W
    panel, draw = paper_panel("SW Shop", width, 640)
    rows = (
        ("NotesPro source", "Download the zip from GitHub", "0.00 EUR", "Download", GREEN),
        ("NotesPro license", "Single-site, setup notes by mail", "49.00 EUR", "Add", BLUE),
    )
    for i, (name, note, price, action, color) in enumerate(rows):
        y = 130 + i * 140
        draw.rounded_rectangle((28, y, width - 28, y + 120), radius=12, fill=CARD + (255,))
        draw.text((48, y + 18), name, font=font(28, True), fill=INK + (255,))
        draw.text((48, y + 62), note, font=font(22), fill=(71, 85, 105, 255))
        price_face = font(24, True)
        price_w = draw.textbbox((0, 0), price, font=price_face)[2]
        btn_x = width - 210
        draw.text((btn_x - 20 - price_w, y + 22), price, font=price_face, fill=BLUE + (255,))
        draw.rounded_rectangle((btn_x, y + 36, width - 44, y + 84), radius=8, fill=color + (255,))
        center_text(draw, ((btn_x + width - 44) // 2, y + 60), action, font(22, True), WHITE + (255,))
    draw.text((32, 430), "Cart  49.00 EUR", font=font(26, True), fill=INK + (255,))
    btn_w = (width - 64 - 16 * 2) // 3
    for i, label in enumerate(("PayPal", "Visa", "Mastercard")):
        x = 32 + i * (btn_w + 16)
        draw.rounded_rectangle((x, 480, x + btn_w, 536), radius=8, fill=YELLOW + (255,))
        center_text(draw, (x + btn_w // 2, 508), label, font(20, True), INK + (255,))
    draw.text((32, 570), "Card numbers are never stored.", font=font(22), fill=(71, 85, 105, 255))
    img.paste(panel, (SAFE_X, top), panel)
    return img


def write_bed(path: Path, chords: tuple[tuple[float, float, float], ...]) -> None:
    sr = 44100
    n = int(DURATION * sr)
    span = DURATION / len(chords)
    frames = []
    for i in range(n):
        sec = i / sr
        chord = chords[min(int(sec / span), len(chords) - 1)]
        local = (sec % span) / span
        env = smooth(min(1.0, local / 0.08)) * (1 - smooth(max(0.0, (local - 0.82) / 0.18)))
        master = 0.12 * env
        if sec < 0.08:
            master *= smooth(sec / 0.08)
        if sec > DURATION - 0.8:
            master *= smooth((DURATION - sec) / 0.8)
        sample = 0.0
        for freq in chord:
            sample += math.sin(2 * math.pi * freq * sec)
            sample += 0.35 * math.sin(2 * math.pi * freq * 2 * sec)
        sample = max(-1.0, min(1.0, sample / 4.2 * master))
        frames.append(struct.pack("<h", int(sample * 32767)))
    with wave.open(str(path), "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(b"".join(frames))


def encode(frames, wav: Path, mp4: Path) -> None:
    import imageio_ffmpeg

    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    cmd = [
        ffmpeg, "-y",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "pipe:0",
        "-i", str(wav),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium",
        "-c:a", "aac", "-b:a", "160k",
        "-movflags", "+faststart",
        "-shortest",
        str(mp4),
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    assert proc.stdin is not None
    total = len(frames)
    for i, frame in enumerate(frames, start=1):
        proc.stdin.write(frame.tobytes())
        if i % 150 == 0 or i == total:
            print(f"  {i}/{total}", flush=True)
    proc.stdin.close()
    err = proc.stderr.read().decode("utf-8", errors="replace") if proc.stderr else ""
    if proc.wait() != 0:
        raise SystemExit(err[-2000:])


def timeline(slides: list[tuple[float, Image.Image]]) -> list[Image.Image]:
    lengths = [int(round(sec * FPS)) for sec, _ in slides]
    if sum(lengths) != int(DURATION * FPS):
        lengths[-1] += int(DURATION * FPS) - sum(lengths)
    fade = 10
    out = []
    for i, ((_sec, image), length) in enumerate(zip(slides, lengths)):
        nxt = slides[i + 1][1] if i + 1 < len(slides) else None
        for frame_i in range(length):
            if nxt is not None and frame_i >= length - fade:
                t = smooth((frame_i - (length - fade) + 1) / fade)
                out.append(Image.blend(image, nxt, t))
            else:
                out.append(image)
    return out[: int(DURATION * FPS)]


def build(name: str, slides: list[tuple[float, Image.Image]], chords) -> None:
    mp4 = OUT_DIR / f"{name}-short.mp4"
    wav = OUT_DIR / f"{name}-short.wav"
    print(f"Building {mp4.name}...")
    write_bed(wav, chords)
    frames = timeline(slides)
    encode(frames, wav, mp4)
    wav.unlink(missing_ok=True)
    print(f"Wrote {mp4}")


def main() -> None:
    gallery = lambda: [
        (6.5, shot_card("Gallery.png", "Gallery", "A corridor you can walk through")),
        (6.0, shot_card("PhotoCube.png", "Photo cube", "Cube, book, and carousel")),
        (6.5, pill_card("Also in the page", "Photos on the ride", [
            "Photo book",
            "Photo carousel",
            "Roller coaster",
            "Scooter rink",
            "Ghost train",
            "Photo labyrinth",
        ])),
        (6.0, end_card("Photo gallery", "Paste a picture. Walk the corridor.", "Open the live demo")),
    ]
    games = lambda: [
        (6.5, shot_card("Tetris.png", "Tetris", "Hold, next piece, and a high score")),
        (6.0, shot_card("Pacman.png", "Pac-Man", "Click the maze and steer")),
        (6.5, pill_card("More boards", "All in the same note", [
            "Chess",
            "Tic-tac-toe",
            "Connect Four",
            "Reversi",
            "Mario",
            "Lemmings",
            "Sokoban",
            "Pinball",
        ])),
        (6.0, end_card("Games", "Play without leaving the workspace.", "Open the live demo")),
    ]
    shop = lambda: [
        (7.0, shop_card()),
        (6.0, menu_card()),
        (6.0, ads_card()),
        (6.0, end_card("Shop and NotesList", "Checkout, bills, and local ads.", "Open the live demo")),
    ]
    insert_kanban = lambda: [
        (3.0, title_card("Editor toolbar", "Insert kanban", "Gantt, kanban, mindmap, kanban gantt")),
        (4.0, toolbar_card(
            "boards",
            ["Gantt", "Kanban", "Mindmap", "Kanban gantt"],
            1,
            ("One button.", "Four boards."),
            [
                "```kanban{cols=Todo,Doing,Done;col=info}",
                "# Board",
                "Todo | Design wireframes | **First draft**",
                "Todo | Write copy",
                "Doing | Build API",
                "```",
            ],
            "Insert kanban",
            "Pick a board from one toolbar button",
        )),
        (4.0, kanban_card()),
        (3.5, gantt_card()),
        (3.5, mindmap_card()),
        (3.5, sprintboard_card()),
        (3.5, end_card("Insert kanban", "Gantt, kanban, mindmap, and kanban gantt.", "Open the live demo")),
    ]
    insert_menu = lambda: [
        (3.0, title_card("Editor toolbar", "Insert menu", "Menu, shop, SW shop, NotesList")),
        (4.0, toolbar_card(
            "menu",
            ["Menu", "Shop", "SW shop", "NotesList"],
            0,
            ("One button.", "Menu, shop, ads."),
            [
                "```menu{to=demo;title=Lunch menu;col=warning;tables=1-4}",
                "# Starters",
                "Soup of the day | 6.50",
                "Mixed salad | 7.90",
                "# Mains",
                "```",
            ],
            "Insert menu",
            "Sell from the page with one toolbar button",
        )),
        (3.5, menu_card()),
        (3.5, shop_card()),
        (3.5, swshop_card()),
        (3.5, ads_card()),
        (4.0, end_card("Insert menu", "Menu, shop, SW shop, and NotesList.", "Open the live demo")),
    ]
    pad_a = ((220.0, 261.63, 329.63), (174.61, 220.0, 261.63), (261.63, 329.63, 392.0), (196.0, 246.94, 293.66), (220.0, 261.63, 329.63))
    pad_b = ((196.0, 246.94, 293.66), (220.0, 277.18, 329.63), (174.61, 220.0, 261.63), (246.94, 311.13, 370.0), (196.0, 246.94, 293.66))
    pad_c = ((174.61, 220.0, 261.63), (196.0, 246.94, 293.66), (220.0, 261.63, 329.63), (164.81, 196.0, 246.94), (174.61, 220.0, 261.63))
    jobs = {
        "gallery": (gallery, pad_a),
        "games": (games, pad_b),
        "shop-noteslist": (shop, pad_c),
        "insert-kanban": (insert_kanban, pad_a),
        "insert-menu": (insert_menu, pad_b),
    }
    chosen = [arg for arg in sys.argv[1:] if not arg.startswith("-")] or list(jobs)
    for name in chosen:
        slides, chords = jobs[name]
        build(name, slides(), chords)


if __name__ == "__main__":
    main()
