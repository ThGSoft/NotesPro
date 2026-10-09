"""Build 25-second 1080p NotesPro feature promos for YouTube.

    .venv\\Scripts\\python.exe -m pip install imageio-ffmpeg
    .venv\\Scripts\\python.exe docs/promo/build_feature_promos.py
    .venv\\Scripts\\python.exe docs/promo/build_feature_promos.py insert-kanban insert-menu

Writes gallery-25s.mp4, games-25s.mp4, shop-noteslist-25s.mp4,
insert-kanban-25s.mp4, and insert-menu-25s.mp4
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

W, H = 1920, 1080
FPS = 30
DURATION = 25.0

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


def caption(img: Image.Image, kicker: str, headline: str) -> None:
    draw = ImageDraw.Draw(img)
    top = H - 168
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(overlay).rectangle((0, top, W, H), fill=(8, 12, 22, 220))
    img.paste(Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB"))
    draw = ImageDraw.Draw(img)
    draw.text((88, top + 28), kicker.upper(), font=font(28, True), fill=YELLOW)
    draw.text((88, top + 72), headline, font=font(52, True), fill=WHITE)


def fit_shot(name: str) -> Image.Image:
    src = Image.open(SHOTS / name).convert("RGB")
    box_w, box_h = 1680, 800
    scale = min(box_w / src.width, box_h / src.height)
    shot = src.resize((max(1, int(src.width * scale)), max(1, int(src.height * scale))), Image.Resampling.LANCZOS)
    framed = Image.new("RGBA", shot.size, (0, 0, 0, 0))
    framed.paste(shot, (0, 0))
    mask = Image.new("L", shot.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, shot.width - 1, shot.height - 1), radius=16, fill=255)
    framed.putalpha(mask)
    canvas = base()
    canvas.paste(framed, ((W - shot.width) // 2, 430 - shot.height // 2), framed)
    return canvas


def title_card(kicker: str, title: str, subtitle: str) -> Image.Image:
    img = base()
    draw = ImageDraw.Draw(img)
    note = Image.new("RGBA", (1100, 460), (0, 0, 0, 0))
    nd = ImageDraw.Draw(note)
    nd.rounded_rectangle((24, 36, 1076, 430), radius=10, fill=(243, 232, 120, 255), outline=(17, 17, 17, 255), width=4)
    nd.ellipse((516, 4, 584, 72), fill=(227, 27, 35, 255), outline=(17, 17, 17, 255), width=3)
    nd.text((70, 110), kicker.upper(), font=font(28, True), fill=(80, 60, 20, 255))
    nd.text((70, 160), title, font=font(78, True), fill=(17, 17, 17, 255))
    nd.text((70, 280), subtitle, font=font(36), fill=(30, 30, 30, 255))
    note = note.rotate(-2.2, resample=Image.Resampling.BICUBIC, expand=True)
    img.paste(note, ((W - note.width) // 2, (H - note.height) // 2 - 10), note)
    return img


def end_card(title: str, line: str, button: str) -> Image.Image:
    img = base()
    draw = ImageDraw.Draw(img)
    draw.text((W // 2, 340), title, font=font(84, True), fill=YELLOW, anchor="mm")
    draw.text((W // 2, 470), "thgsoft.online/DjangoNotesPro", font=font(44, True), fill=WHITE, anchor="mm")
    draw.text((W // 2, 560), line, font=font(32), fill=MUTED, anchor="mm")
    draw.rounded_rectangle((W // 2 - 300, 660, W // 2 + 300, 756), radius=12, fill=YELLOW)
    draw.text((W // 2, 708), button, font=font(34, True), fill=INK, anchor="mm")
    return img


def pill_card(kicker: str, headline: str, items: list[str]) -> Image.Image:
    img = base()
    draw = ImageDraw.Draw(img)
    draw.text((120, 120), kicker.upper(), font=font(28, True), fill=YELLOW)
    draw.text((120, 170), headline, font=font(58, True), fill=WHITE)
    cols = 2
    gap_x, gap_y = 28, 22
    cell_w, cell_h = 800, 88
    origin_x, origin_y = 120, 320
    for i, label in enumerate(items):
        col, row = i % cols, i // cols
        x = origin_x + col * (cell_w + gap_x)
        y = origin_y + row * (cell_h + gap_y)
        draw.rounded_rectangle((x, y, x + cell_w, y + cell_h), radius=12, fill=(30, 41, 59))
        draw.text((x + 28, y + 24), label, font=font(32, True), fill=WHITE)
    return img


def paper_panel(title: str, width: int, height: int) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    panel = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(panel)
    draw.rounded_rectangle((0, 0, width - 1, height - 1), radius=18, fill=PAPER + (255,))
    draw.text((36, 28), title, font=font(40, True), fill=INK + (255,))
    draw.line((36, 88, width - 36, 88), fill=(226, 232, 240, 255), width=2)
    return panel, draw


def shop_card() -> Image.Image:
    img = base()
    panel, draw = paper_panel("Office shop", 980, 640)
    rows = (
        ("Notebook A5", "Lined, 80 pages", "4.50 EUR"),
        ("Pens, pack of 10", "Smooth black ink", "3.20 EUR"),
        ("Coffee beans", "250g medium roast", "12.00 EUR"),
    )
    for i, (name, note, price) in enumerate(rows):
        y = 120 + i * 120
        draw.rounded_rectangle((36, y, 944, y + 100), radius=12, fill=CARD + (255,))
        draw.text((56, y + 16), name, font=font(28, True), fill=INK + (255,))
        draw.text((56, y + 54), note, font=font(22), fill=(71, 85, 105, 255))
        price_face = font(26, True)
        price_w = draw.textbbox((0, 0), price, font=price_face)[2]
        draw.text((792 - price_w, y + 22), price, font=price_face, fill=BLUE + (255,))
        draw.rounded_rectangle((820, y + 28, 920, y + 72), radius=8, fill=BLUE + (255,))
        center_text(draw, (870, y + 50), "Add", font(22, True), WHITE + (255,))
    draw.text((36, 500), "Cart  19.70 EUR", font=font(26, True), fill=INK + (255,))
    for i, label in enumerate(("PayPal", "Visa", "Mastercard")):
        x = 360 + i * 190
        draw.rounded_rectangle((x, 488, x + 170, 540), radius=8, fill=YELLOW + (255,))
        center_text(draw, (x + 85, 514), label, font(20, True), INK + (255,))
    draw.text((36, 575), "Card numbers are never stored.", font=font(22), fill=(71, 85, 105, 255))
    img.paste(panel, ((W - panel.width) // 2, 70), panel)
    caption(img, "Shop", "Catalog, cart, and checkout")
    return img


def menu_card() -> Image.Image:
    img = base()
    panel, draw = paper_panel("Lunch menu", 980, 560)
    draw.rounded_rectangle((760, 24, 944, 72), radius=8, fill=YELLOW + (255,))
    center_text(draw, (852, 48), "Table 2", font(22, True), INK + (255,))
    dishes = (
        ("Soup of the day", "6.50"),
        ("Mixed salad", "7.90"),
        ("Wiener schnitzel", "18.50"),
        ("Garlic spaghetti", "14.00"),
    )
    for i, (name, price) in enumerate(dishes):
        y = 120 + i * 78
        draw.text((48, y), name, font=font(30, True), fill=INK + (255,))
        draw.text((820, y), price, font=font(28, True), fill=BLUE + (255,))
    draw.rounded_rectangle((36, 460, 280, 524), radius=10, fill=BLUE + (255,))
    center_text(draw, (158, 492), "Send bill", font(24, True), WHITE + (255,))
    draw.text((310, 478), "Orders go to mail, chat, or a private message.", font=font(22), fill=(71, 85, 105, 255))
    img.paste(panel, ((W - panel.width) // 2, 80), panel)
    caption(img, "Speisekarte", "Click a dish. Send the bill.")
    return img


def ads_card() -> Image.Image:
    img = base()
    panel, draw = paper_panel("NotesList  ·  Main", 980, 560)
    for i, label in enumerate(("for sale", "housing", "jobs")):
        x = 36 + i * 180
        fill = BLUE if i == 0 else (226, 232, 240)
        ink = WHITE if i == 0 else INK
        draw.rounded_rectangle((x, 110, x + 160, 158), radius=20, fill=fill + (255,))
        center_text(draw, (x + 80, 134), label, font(20, True), ink + (255,))
    listings = (
        ("Desk lamp", "12 EUR", "Downtown  ·  pickup only"),
        ("Road bike", "180 EUR", "Harbor  ·  21-speed"),
        ("Studio loft", "780 EUR", "Old Town  ·  available Oct 1"),
    )
    for i, (name, price, place) in enumerate(listings):
        y = 190 + i * 100
        draw.rounded_rectangle((36, y, 944, y + 84), radius=12, fill=CARD + (255,))
        draw.text((56, y + 12), name, font=font(26, True), fill=INK + (255,))
        draw.text((56, y + 46), place, font=font(20), fill=(71, 85, 105, 255))
        draw.text((760, y + 24), price, font=font(24, True), fill=BLUE + (255,))
    img.paste(panel, ((W - panel.width) // 2, 80), panel)
    caption(img, "NotesList", "Local ads. Reply to the group.")
    return img


def shot_card(filename: str, kicker: str, headline: str) -> Image.Image:
    img = fit_shot(filename)
    caption(img, kicker, headline)
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
    draw = ImageDraw.Draw(img)
    x0, y0, bw, gap = 120, 120, 64, 8
    buttons = ["B", "I", "S", "|", "<>", "```", "|", "\"", "•", "1.", "|", "boards", "#", "menu", "%"]
    draw.rounded_rectangle((x0 - 16, y0 - 12, W - 120, y0 + bw + 12), radius=12, fill=(30, 41, 59))
    x = x0
    active_x = x0
    for label in buttons:
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

    dx, dy = active_x, y0 + bw + 20
    dw, row = 440, 76
    draw.rounded_rectangle((dx, dy, dx + dw, dy + row * len(items) + 24), radius=12, fill=PAPER, outline=LINE, width=2)
    for i, label in enumerate(items):
        ry = dy + 12 + i * row
        if i == pick:
            draw.rounded_rectangle((dx + 10, ry, dx + dw - 10, ry + row - 8), radius=8, fill=BLUE)
        draw.text((dx + 32, ry + (row - 8) // 2), label, font=font(32, True), fill=WHITE if i == pick else INK, anchor="lm")
    draw_cursor(draw, dx + dw - 80, dy + 12 + pick * row + 30, WHITE, INK)

    draw.text((120, 290), statement[0], font=font(56, True), fill=WHITE)
    draw.text((120, 365), statement[1], font=font(56, True), fill=YELLOW)

    top = 572
    draw.rounded_rectangle((120, top, W - 120, 880), radius=14, fill=(30, 41, 59))
    draw.text((152, top + 18), "Inserted into the page", font=font(22, True), fill=SLATE)
    for i, line in enumerate(snippet):
        ink = YELLOW if line.startswith("```") else WHITE if line.startswith("#") else MUTED
        draw.text((152, top + 60 + i * 38), line, font=mono(28), fill=ink)
    caption(img, kicker, headline)
    return img


def kanban_card() -> Image.Image:
    img = base()
    panel, draw = paper_panel("Board", 1500, 680)
    col_w, gap = 460, 24
    columns = (
        ("Todo", [("Design wireframes", "First draft")]),
        ("Doing", [("Build API", "")]),
        ("Done", [("Kickoff", "")]),
    )
    for i, (name, cards) in enumerate(columns):
        x = 36 + i * (col_w + gap)
        draw.rounded_rectangle((x, 112, x + col_w, 640), radius=14, fill=CARD + (255,))
        draw.text((x + 24, 128), name, font=font(30, True), fill=INK + (255,))
        for j, (title, note) in enumerate(cards):
            y = 190 + j * 130
            draw.rounded_rectangle((x + 16, y, x + col_w - 16, y + 112), radius=10, fill=PAPER + (255,), outline=LINE + (255,), width=2)
            draw.text((x + 36, y + 18), title, font=font(28, True), fill=INK + (255,))
            if note:
                draw.text((x + 36, y + 62), note, font=font(22, True), fill=BLUE + (255,))
    draw.rounded_rectangle((52, 320, 36 + col_w - 16, 432), radius=10, outline=(148, 163, 184, 255), width=2)
    draw.text((72, 358), "Write copy", font=font(28, True), fill=(148, 163, 184, 255))

    card = Image.new("RGBA", (448, 132), (0, 0, 0, 0))
    cd = ImageDraw.Draw(card)
    cd.rounded_rectangle((12, 16, 440, 128), radius=10, fill=(15, 23, 42, 70))
    cd.rounded_rectangle((0, 0, 428, 112), radius=10, fill=PAPER + (255,), outline=BLUE + (255,), width=3)
    cd.text((20, 38), "Write copy", font=font(28, True), fill=INK + (255,))
    card = card.rotate(4, resample=Image.Resampling.BICUBIC, expand=True)
    drop_x, drop_y = 36 + col_w + gap + 30, 330
    panel.alpha_composite(card, (drop_x, drop_y))
    draw_cursor(draw, drop_x + 300, drop_y + 70, INK + (255,), WHITE + (255,))
    img.paste(panel, ((W - panel.width) // 2, 60), panel)
    caption(img, "Kanban", "Drag cards between columns")
    return img


def gantt_card() -> Image.Image:
    img = base()
    panel, draw = paper_panel("Project plan", 1500, 600)
    tx0, tx1 = 320, 1450
    span = (tx1 - tx0) / 31
    draw.text((48, 118), "October 2026", font=font(24, True), fill=SLATE + (255,))
    for day in (1, 8, 15, 22, 29):
        x = int(tx0 + (day - 1) * span)
        draw.line((x, 160, x, 540), fill=(226, 232, 240, 255), width=2)
        draw.text((x + 8, 118), str(day), font=font(24, True), fill=SLATE + (255,))
    rows = (
        ("Phase A", 1, 15, BLUE, "Start"),
        ("Phase B", 15, 31, GREEN, "Delivery"),
        ("Review", 22, 29, ORANGE, ""),
    )
    for i, (name, start, end, color, note) in enumerate(rows):
        y = 190 + i * 110
        draw.text((48, y + 14), name, font=font(28, True), fill=INK + (255,))
        xa, xb = int(tx0 + (start - 1) * span), int(tx0 + end * span)
        draw.rounded_rectangle((xa, y, xb, y + 60), radius=10, fill=color + (255,))
        if note:
            draw.text((xa + 20, y + 30), note, font=font(24, True), fill=WHITE + (255,), anchor="lm")
    today = int(tx0 + 5.5 * span)
    for y in range(160, 540, 22):
        draw.line((today, y, today, y + 12), fill=RED + (255,), width=3)
    img.paste(panel, ((W - panel.width) // 2, 100), panel)
    caption(img, "Gantt", "Phases on a timeline")
    return img


def mindmap_card() -> Image.Image:
    img = base()
    panel, draw = paper_panel("Ideas", 1500, 660)

    def width(label: str) -> int:
        box = draw.textbbox((0, 0), label, font=font(28, True))
        return box[2] - box[0] + 56

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
        "root": ((260, 380), "Central topic", YELLOW, INK),
        "a": ((700, 240), "Branch A", BLUE, WHITE),
        "b": ((700, 520), "Branch B", BLUE, WHITE),
        "a1": ((1150, 160), "Detail A1", CARD, INK),
        "a2": ((1150, 320), "Detail A2", CARD, INK),
        "b1": ((1150, 520), "Detail B1", CARD, INK),
    }
    for parent, child in (("root", "a"), ("root", "b"), ("a", "a1"), ("a", "a2"), ("b", "b1")):
        (px, py), plabel, *_ = nodes[parent]
        (cx, cy), clabel, *_ = nodes[child]
        curve((px + width(plabel) // 2, py), (cx - width(clabel) // 2, cy))
    for (cx, cy), label, fill, ink in nodes.values():
        half = width(label) // 2
        draw.rounded_rectangle((cx - half, cy - 36, cx + half, cy + 36), radius=14, fill=fill + (255,), outline=LINE + (255,), width=2)
        draw.text((cx, cy), label, font=font(28, True), fill=ink + (255,), anchor="mm")
    img.paste(panel, ((W - panel.width) // 2, 70), panel)
    caption(img, "Mindmap", "Indent a line, get a branch")
    return img


def kanbangantt_card() -> Image.Image:
    img = base()
    panel, draw = paper_panel("Sprint board", 1500, 660)
    col_w, gap = 343, 18
    columns = (
        ("Todo", "Design wireframes", "00:00:00", "0.00 EUR", "60 EUR/h", "Start", GREEN, False),
        ("Doing", "Build API", "00:42:10", "52.71 EUR", "75 EUR/h", "Stop", RED, True),
        ("Suspended", "On hold task", "00:30:00", "37.50 EUR", "75 EUR/h", "Resume", ORANGE, False),
        ("Done", "Kickoff", "02:00:00", "100.00 EUR", "50 EUR/h", "Done", SLATE, False),
    )
    for i, (name, title, timer, cost, rate, action, color, running) in enumerate(columns):
        x = 36 + i * (col_w + gap)
        draw.rounded_rectangle((x, 112, x + col_w, 560), radius=14, fill=CARD + (255,))
        draw.text((x + 22, 128), name, font=font(28, True), fill=INK + (255,))
        y = 186
        draw.rounded_rectangle((x + 14, y, x + col_w - 14, y + 210), radius=10, fill=PAPER + (255,), outline=LINE + (255,), width=2)
        draw.text((x + 32, y + 16), title, font=font(26, True), fill=INK + (255,))
        draw.text((x + 32, y + 62), timer, font=mono(32), fill=INK + (255,))
        if running:
            draw.ellipse((x + col_w - 58, y + 70, x + col_w - 40, y + 88), fill=GREEN + (255,))
        draw.text((x + 32, y + 112), cost, font=font(24, True), fill=BLUE + (255,))
        draw.text((x + col_w - 32, y + 116), rate, font=font(20), fill=SLATE + (255,), anchor="ra")
        draw.rounded_rectangle((x + 32, y + 156, x + 172, y + 196), radius=8, fill=color + (255,))
        center_text(draw, (x + 102, y + 176), action, font(20, True), WHITE + (255,))
    draw.text((48, 590), "Total  03:12:10", font=font(30, True), fill=INK + (255,))
    draw.text((1452, 590), "190.21 EUR", font=font(30, True), fill=BLUE + (255,), anchor="ra")
    img.paste(panel, ((W - panel.width) // 2, 70), panel)
    caption(img, "Kanban gantt", "Start, stop, and bill each task")
    return img


def swshop_card() -> Image.Image:
    img = base()
    panel, draw = paper_panel("SW Shop", 980, 560)
    rows = (
        ("NotesPro source", "Download the zip from GitHub", "0.00 EUR", "Download"),
        ("NotesPro license", "Single-site, setup notes by mail", "49.00 EUR", "Add"),
    )
    for i, (name, note, price, action) in enumerate(rows):
        y = 120 + i * 130
        draw.rounded_rectangle((36, y, 944, y + 110), radius=12, fill=CARD + (255,))
        draw.text((56, y + 18), name, font=font(28, True), fill=INK + (255,))
        draw.text((56, y + 60), note, font=font(22), fill=(71, 85, 105, 255))
        price_face = font(26, True)
        price_w = draw.textbbox((0, 0), price, font=price_face)[2]
        draw.text((750 - price_w, y + 36), price, font=price_face, fill=BLUE + (255,))
        draw.rounded_rectangle((774, y + 32, 924, y + 80), radius=8, fill=(GREEN if i == 0 else BLUE) + (255,))
        center_text(draw, (849, y + 56), action, font(22, True), WHITE + (255,))
    draw.text((36, 420), "Cart  49.00 EUR", font=font(26, True), fill=INK + (255,))
    for i, label in enumerate(("PayPal", "Visa", "Mastercard")):
        x = 360 + i * 190
        draw.rounded_rectangle((x, 408, x + 170, 460), radius=8, fill=YELLOW + (255,))
        center_text(draw, (x + 85, 434), label, font(20, True), INK + (255,))
    draw.text((36, 495), "Card numbers are never stored.", font=font(22), fill=(71, 85, 105, 255))
    img.paste(panel, ((W - panel.width) // 2, 80), panel)
    caption(img, "SW shop", "Free downloads and paid licenses")
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
    mp4 = OUT_DIR / f"{name}-25s.mp4"
    wav = OUT_DIR / f"{name}-25s.wav"
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
        (3.5, kanbangantt_card()),
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
    chosen = sys.argv[1:] or list(jobs)
    for name in chosen:
        slides, chords = jobs[name]
        build(name, slides(), chords)


if __name__ == "__main__":
    main()
