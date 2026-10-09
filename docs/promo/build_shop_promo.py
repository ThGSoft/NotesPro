"""Build a 25-second 1080p NotesPro shop promo for YouTube.

Requires imageio-ffmpeg (bundled ffmpeg):

    .venv\\Scripts\\python.exe -m pip install imageio-ffmpeg
    .venv\\Scripts\\python.exe docs/promo/build_shop_promo.py

Writes docs/promo/shop-25s.mp4
"""

from __future__ import annotations

import math
import struct
import subprocess
import wave
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT_DIR = Path(__file__).resolve().parent
OUT_MP4 = OUT_DIR / "shop-25s.mp4"
OUT_WAV = OUT_DIR / "shop-25s.wav"

W, H = 1920, 1080
FPS = 30
DURATION = 25.0

BG = (11, 18, 32)
INK = (15, 23, 42)
YELLOW = (240, 224, 112)
WHITE = (248, 250, 252)
MUTED = (203, 213, 225)
PAYPAL = (0, 48, 135)
VISA = (26, 31, 113)
MASTER_A = (235, 0, 27)

FONT_BOLD = Path(r"C:\Windows\Fonts\segoeuib.ttf")
FONT_REG = Path(r"C:\Windows\Fonts\segoeui.ttf")

PRODUCTS = (
    ("Desk lamp", "Pickup downtown", "12 EUR"),
    ("City bike", "Harbor, recently serviced", "80 EUR"),
    ("NotesPro license", "Single-site", "49 EUR"),
)


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size)


def smooth(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def base() -> Image.Image:
    img = Image.new("RGB", (W, H), BG)
    ImageDraw.Draw(img).rectangle((0, 0, W, 8), fill=YELLOW)
    return img


def panel(width: int, height: int) -> Image.Image:
    card = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(card)
    draw.rounded_rectangle((0, 0, width - 1, height - 1), radius=22, fill=(255, 253, 245, 245))
    draw.rounded_rectangle((0, 0, width - 1, height - 1), radius=22, outline=(17, 17, 17, 255), width=4)
    return card


def button(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], label: str, fill, text) -> None:
    draw.rounded_rectangle(box, radius=10, fill=fill)
    draw.text(((box[0] + box[2]) // 2, (box[1] + box[3]) // 2), label, font=font(FONT_BOLD, 26), fill=text, anchor="mm")


def render_title(t: float) -> Image.Image:
    img = base()
    note = Image.new("RGBA", (980, 460), (0, 0, 0, 0))
    nd = ImageDraw.Draw(note)
    nd.rounded_rectangle((20, 40, 960, 440), radius=8, fill=YELLOW + (255,), outline=(17, 17, 17, 255), width=4)
    nd.ellipse((458, 8, 522, 72), fill=(227, 27, 35, 255), outline=(17, 17, 17, 255), width=3)
    nd.text((70, 120), "NotesPro Shop", font=font(FONT_BOLD, 84), fill=(17, 17, 17, 255))
    nd.text((74, 250), "A catalog in the page.", font=font(FONT_REG, 40), fill=(30, 30, 30, 255))
    nd.text((74, 312), "Checkout asks how to pay.", font=font(FONT_REG, 40), fill=(30, 30, 30, 255))
    pop = lerp(0.94, 1.0, smooth(min(1.0, t / 0.35)))
    angle = lerp(-5.5, -2.2, smooth(min(1.0, t / 0.45)))
    note = note.resize((int(note.width * pop), int(note.height * pop)), Image.Resampling.LANCZOS)
    note = note.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)
    img.paste(note, ((W - note.width) // 2, (H - note.height) // 2 - 10), note)
    return img


def render_catalog(t: float) -> Image.Image:
    img = base()
    card = panel(1500, 720)
    draw = ImageDraw.Draw(card)
    draw.text((48, 36), "OFFICE SHOP", font=font(FONT_BOLD, 28), fill=(37, 99, 235, 255))
    draw.text((48, 78), "Add to cart, then checkout", font=font(FONT_BOLD, 42), fill=INK + (255,))
    for i, (name, detail, price) in enumerate(PRODUCTS):
        y = 170 + i * 160
        reveal = smooth(min(1.0, max(0.0, (t - i * 0.12) / 0.3)))
        draw.rounded_rectangle((48, y, 1452, y + 140), radius=16, fill=(255, 255, 255, 255), outline=(203, 213, 225, 255), width=2)
        draw.text((80, y + 28), name, font=font(FONT_BOLD, 36), fill=INK + (int(255 * reveal),))
        draw.text((80, y + 80), detail, font=font(FONT_REG, 26), fill=(71, 85, 105, int(255 * reveal)))
        draw.text((980, y + 70), price, font=font(FONT_BOLD, 32), fill=INK + (int(255 * reveal),), anchor="lm")
        added = i == 0 or (i == 1 and t > 0.4)
        button(draw, (1180, y + 40, 1380, y + 100), "Added" if added else "Add", (37, 99, 235, 255) if not added else (22, 163, 74, 255), WHITE + (255,))
    img.paste(card, ((W - card.width) // 2, 120), card)
    return img


def render_cart(t: float) -> Image.Image:
    img = base()
    card = panel(980, 640)
    draw = ImageDraw.Draw(card)
    draw.text((48, 36), "Cart", font=font(FONT_BOLD, 40), fill=INK + (255,))
    draw.text((880, 48), "Clear", font=font(FONT_BOLD, 24), fill=(37, 99, 235, 255), anchor="mt")
    draw.rounded_rectangle((48, 110, 932, 210), radius=14, fill=(255, 255, 255, 255), outline=(203, 213, 225, 255), width=2)
    draw.text((72, 140), "Desk lamp", font=font(FONT_BOLD, 32), fill=INK + (255,))
    draw.text((860, 148), "12 EUR", font=font(FONT_BOLD, 28), fill=INK + (255,), anchor="rm")
    draw.text((48, 250), "Note", font=font(FONT_BOLD, 22), fill=(71, 85, 105, 255))
    draw.rounded_rectangle((48, 286, 932, 350), radius=10, fill=(255, 255, 255, 255), outline=(203, 213, 225, 255), width=2)
    draw.text((68, 306), "Delivery or desk", font=font(FONT_REG, 26), fill=(100, 116, 139, 255))
    draw.text((48, 400), "Total", font=font(FONT_BOLD, 32), fill=INK + (255,))
    draw.text((932, 400), "12.00 EUR", font=font(FONT_BOLD, 32), fill=INK + (255,), anchor="ra")
    pulse = 0.5 + 0.5 * math.sin(t * math.pi * 2)
    checkout = (37, 99, 235, 255) if pulse < 0.65 else (29, 78, 216, 255)
    button(draw, (48, 480, 932, 570), "Checkout", checkout, WHITE + (255,))
    img.paste(card, ((W - card.width) // 2, 150), card)
    return img


def render_pay(t: float) -> Image.Image:
    img = base()
    card = panel(1180, 640)
    draw = ImageDraw.Draw(card)
    draw.text((590, 48), "How would you like to pay?", font=font(FONT_BOLD, 40), fill=INK + (255,), anchor="mt")
    methods = (
        ("PayPal", PAYPAL + (255,), 80),
        ("Visa", VISA + (255,), 440),
        ("Mastercard", MASTER_A + (255,), 800),
    )
    chosen = 1 if t < 0.42 else 2
    for i, (label, fill, x) in enumerate(methods):
        outline = (17, 17, 17, 255) if i == chosen else fill
        draw.rounded_rectangle((x, 140, x + 300, 230), radius=12, fill=fill, outline=outline, width=6 if i == chosen else 0)
        draw.text((x + 150, 185), label, font=font(FONT_BOLD, 28), fill=WHITE + (255,), anchor="mm")
    if t >= 0.42:
        draw.text((80, 280), "Transfer from your Konto", font=font(FONT_BOLD, 28), fill=INK + (255,))
        draw.rounded_rectangle((80, 340, 1100, 420), radius=12, fill=(255, 255, 255, 255), outline=(203, 213, 225, 255), width=2)
        typed = "DE89 3704"[: int(lerp(0, 9, smooth(min(1.0, (t - 0.42) / 0.4))))]
        draw.text((104, 366), typed or "IBAN or account", font=font(FONT_REG, 28), fill=INK + (255,) if typed else (148, 163, 184, 255))
        button(draw, (80, 470, 1100, 560), "Transfer", (22, 163, 74, 255), WHITE + (255,))
    else:
        draw.text((590, 420), "Settings stays with the shop owner.", font=font(FONT_REG, 28), fill=(71, 85, 105, 255), anchor="mm")
        draw.text((590, 470), "Visitors only choose how to pay.", font=font(FONT_REG, 28), fill=(71, 85, 105, 255), anchor="mm")
    img.paste(card, ((W - card.width) // 2, 150), card)
    return img


def render_end(t: float) -> Image.Image:
    img = base()
    draw = ImageDraw.Draw(img)
    rise = lerp(24, 0, smooth(min(1.0, t / 0.3)))
    draw.text((W // 2, 280 - rise), "NotesPro Shop", font=font(FONT_BOLD, 96), fill=YELLOW, anchor="mm")
    draw.text((W // 2, 420), "thgsoft.online/DjangoNotesPro", font=font(FONT_BOLD, 42), fill=WHITE, anchor="mm")
    draw.text((W // 2, 500), "Public page. No card numbers stored.", font=font(FONT_REG, 32), fill=MUTED, anchor="mm")
    draw.rounded_rectangle((W // 2 - 280, 620, W // 2 + 280, 716), radius=12, fill=YELLOW)
    draw.text((W // 2, 668), "Open the shop", font=font(FONT_BOLD, 36), fill=INK, anchor="mm")
    return img


def segments():
    return [
        (6.0, render_cart),
        (6.0, render_catalog),
        (7.0, render_pay),
        (6.0, render_end),
    ]


def blend(a: Image.Image, b: Image.Image, t: float) -> Image.Image:
    return Image.blend(a.convert("RGB"), b.convert("RGB"), smooth(t))


def write_bed(path: Path) -> None:
    """Original shop-counter pulse. No third-party music."""
    sr = 44100
    n = int(DURATION * sr)
    roots = (196.00, 246.94, 220.00, 174.61, 196.00)
    frames = []
    for i in range(n):
        sec = i / sr
        root = roots[min(int(sec / 5), len(roots) - 1)]
        beat = (sec * 2) % 1.0
        tick = max(0.0, 1.0 - beat / 0.08) ** 2
        bell = math.sin(2 * math.pi * root * 4 * sec) * tick * 0.18
        pad = math.sin(2 * math.pi * root * sec) * 0.08
        fifth = math.sin(2 * math.pi * root * 1.5 * sec) * 0.05
        master = 0.7
        if sec < 0.08:
            master *= smooth(sec / 0.08)
        if sec > DURATION - 0.8:
            master *= smooth((DURATION - sec) / 0.8)
        sample = max(-1.0, min(1.0, (bell + pad + fifth) * master))
        frames.append(struct.pack("<h", int(sample * 32767)))
    with wave.open(str(path), "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(b"".join(frames))


def encode(frames_iter, total: int) -> None:
    import imageio_ffmpeg

    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    cmd = [
        ffmpeg, "-y",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "pipe:0",
        "-i", str(OUT_WAV),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium",
        "-c:a", "aac", "-b:a", "160k",
        "-movflags", "+faststart",
        "-shortest",
        str(OUT_MP4),
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    assert proc.stdin is not None
    for i, frame in enumerate(frames_iter, start=1):
        proc.stdin.write(frame.tobytes())
        if i % 60 == 0 or i == total:
            print(f"  {i}/{total} frames", flush=True)
    proc.stdin.close()
    err = proc.stderr.read().decode("utf-8", errors="replace") if proc.stderr else ""
    code = proc.wait()
    if code != 0:
        raise SystemExit(err[-2000:])


def main() -> None:
    parts = segments()
    lengths = [int(round(sec * FPS)) for sec, _ in parts]
    if sum(lengths) != int(DURATION * FPS):
        lengths[-1] += int(DURATION * FPS) - sum(lengths)
    starts = []
    cursor = 0
    for length in lengths:
        starts.append(cursor)
        cursor += length
    total = cursor
    fade = 12

    def frame_at(index: int) -> Image.Image:
        seg = 0
        while seg < len(starts) - 1 and index >= starts[seg] + lengths[seg]:
            seg += 1
        local = (index - starts[seg]) / max(1, lengths[seg] - 1)
        current = parts[seg][1](local)
        boundary = starts[seg] + lengths[seg]
        if seg < len(parts) - 1 and index >= boundary - fade:
            nxt = parts[seg + 1][1](0.0)
            current = blend(current, nxt, (index - (boundary - fade)) / fade)
        return current

    print("Writing audio bed...")
    write_bed(OUT_WAV)
    print(f"Encoding {total} frames to {OUT_MP4.name}...")
    encode((frame_at(i).convert("RGB") for i in range(total)), total)
    OUT_WAV.unlink(missing_ok=True)
    print(f"Wrote {OUT_MP4}")


if __name__ == "__main__":
    main()
