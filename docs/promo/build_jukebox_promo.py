"""Build a 25-second 1080p Livia's Jukebox promo for YouTube.

Requires imageio-ffmpeg (bundled ffmpeg):

    .venv\\Scripts\\python.exe -m pip install imageio-ffmpeg
    .venv\\Scripts\\python.exe docs/promo/build_jukebox_promo.py

Writes docs/promo/jukebox-25s.mp4
"""

from __future__ import annotations

import math
import struct
import subprocess
import wave
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFont

ROOT = Path(__file__).resolve().parents[2]
PHOTO = ROOT / "docs" / "screenshots" / "jukebox.png"
OUT_DIR = Path(__file__).resolve().parent
OUT_MP4 = OUT_DIR / "jukebox-25s.mp4"
OUT_WAV = OUT_DIR / "jukebox-25s.wav"

W, H = 1920, 1080
FPS = 30
DURATION = 25.0

ORANGE = (255, 87, 51)
BLUE = (101, 172, 247)
BLUE_DEEP = (9, 88, 141)
WHITE = (248, 250, 252)
MUTED = (203, 213, 225)
INK = (18, 11, 22)

FONT_DISPLAY = Path(r"C:\Windows\Fonts\impact.ttf")
FONT_BOLD = Path(r"C:\Windows\Fonts\segoeuib.ttf")
FONT_REG = Path(r"C:\Windows\Fonts\segoeui.ttf")

SONGS = (
    ("Night Drive", False),
    ("Side Street", True),
    ("Late Window", False),
    ("Paper Lantern", False),
    ("Warm Static", False),
    ("Last Call", False),
)


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size)


def smooth(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def text_size(draw: ImageDraw.ImageDraw, text: str, face: ImageFont.FreeTypeFont) -> tuple[int, int]:
    box = draw.textbbox((0, 0), text, font=face)
    return box[2] - box[0], box[3] - box[1]


def prepare_plate() -> Image.Image:
    src = Image.open(PHOTO).convert("RGB")
    scale = 1.18 * max(W / src.width, H / src.height)
    size = (int(src.width * scale), int(src.height * scale))
    plate = src.resize(size, Image.Resampling.LANCZOS)
    plate = ImageEnhance.Color(plate).enhance(1.12)
    plate = ImageEnhance.Contrast(plate).enhance(1.05)
    return plate


def backdrop(plate: Image.Image, t: float) -> Image.Image:
    zoom = lerp(1.0, 1.08, smooth(t))
    crop_w = int(W / zoom)
    crop_h = int(H / zoom)
    max_x = max(0, plate.width - crop_w)
    max_y = max(0, plate.height - crop_h)
    left = int(max_x * lerp(0.42, 0.58, smooth(t)))
    top = int(max_y * lerp(0.18, 0.36, smooth(t)))
    frame = plate.crop((left, top, left + crop_w, top + crop_h)).resize((W, H), Image.Resampling.BILINEAR)
    dim = Image.new("RGB", (W, H), (8, 4, 12))
    frame = Image.blend(frame, dim, 0.38)
    vignette = Image.new("L", (W, H), 0)
    vd = ImageDraw.Draw(vignette)
    vd.rectangle((0, 0, W, 150), fill=150)
    vd.rectangle((0, H - 220, W, H), fill=170)
    dark = Image.new("RGB", (W, H), (6, 3, 10))
    return Image.composite(dark, frame, vignette)


def glass_panel(width: int, height: int) -> Image.Image:
    panel = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(panel)
    draw.rounded_rectangle((0, 0, width - 1, height - 1), radius=18, fill=(18, 11, 22, 214))
    draw.rounded_rectangle((0, 0, width - 1, height - 1), radius=18, outline=(255, 87, 51, 180), width=3)
    return panel


def draw_centered(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, face: ImageFont.FreeTypeFont, fill) -> None:
    tw, th = text_size(draw, text, face)
    draw.text((xy[0] - tw / 2, xy[1] - th / 2), text, font=face, fill=fill)


def song_grid(panel: Image.Image, origin: tuple[int, int]) -> None:
    draw = ImageDraw.Draw(panel)
    x0, y0 = origin
    cell_w, cell_h, gap = 360, 54, 12
    face = font(FONT_BOLD, 22)
    for i, (name, active) in enumerate(SONGS):
        col, row = i % 2, i // 2
        x = x0 + col * (cell_w + gap)
        y = y0 + row * (cell_h + gap)
        fill = BLUE_DEEP if active else BLUE
        draw.rounded_rectangle((x, y, x + cell_w, y + cell_h), radius=5, fill=fill + (255,))
        draw_centered(draw, (x + cell_w // 2, y + cell_h // 2 + 1), name, face, WHITE + (255,))


def mode_button(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], label: str, pressed: bool = False) -> None:
    fill = (33, 161, 241, 255) if pressed else ORANGE + (255,)
    draw.rounded_rectangle(box, radius=6, fill=fill)
    face = font(FONT_BOLD, 20)
    draw_centered(draw, ((box[0] + box[2]) // 2, (box[1] + box[3]) // 2 + 1), label, face, WHITE + (255,))


def overlay_title(t: float) -> Image.Image:
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    rise = lerp(30, 0, smooth(min(1.0, t / 0.28)))
    alpha = int(255 * smooth(min(1.0, t / 0.22)))
    plate_a = int(210 * alpha / 255)
    top = int(300 - rise)
    draw.rounded_rectangle((W // 2 - 640, top, W // 2 + 640, top + 360), radius=22, fill=(8, 4, 12, plate_a))
    kicker = font(FONT_BOLD, 28)
    title = font(FONT_DISPLAY, 108)
    sub = font(FONT_REG, 40)
    draw.text((W // 2, top + 70), "NOTESPRO  ·  NO ADS", font=kicker, fill=BLUE + (alpha,), anchor="mm")
    draw.text((W // 2, top + 175), "Livia's Jukebox", font=title, fill=WHITE + (alpha,), anchor="mm")
    draw.text((W // 2, top + 275), "Google Drive music, played in the page.", font=sub, fill=MUTED + (alpha,), anchor="mm")
    return layer


def overlay_player(t: float) -> Image.Image:
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    panel = glass_panel(860, 620)
    draw = ImageDraw.Draw(panel)
    draw.text((430, 36), "Livia's Jukebox", font=font(FONT_BOLD, 36), fill=WHITE + (255,), anchor="mt")
    draw.text((430, 92), "Side Street  —  Jazz", font=font(FONT_BOLD, 26), fill=WHITE + (255,), anchor="mt")
    draw.rounded_rectangle((80, 140, 780, 188), radius=8, fill=(255, 255, 255, 28))
    draw.rounded_rectangle((80, 148, 80 + int(700 * lerp(0.42, 0.86, t)), 180), radius=6, fill=ORANGE + (255,))
    draw.text((90, 214), "Album", font=font(FONT_BOLD, 20), fill=WHITE + (255,))
    draw.rounded_rectangle((180, 200, 520, 248), radius=6, fill=(255, 255, 255, 235))
    draw.text((196, 212), "Jazz", font=font(FONT_BOLD, 22), fill=INK + (255,))
    song_grid(panel, (70, 276))
    pop = lerp(0.96, 1.0, smooth(min(1.0, t / 0.25)))
    panel = panel.resize((int(panel.width * pop), int(panel.height * pop)), Image.Resampling.BILINEAR)
    top = (H - panel.height) // 2 - 10
    layer.paste(panel, ((W - panel.width) // 2, top), panel)
    draw = ImageDraw.Draw(layer)
    label = "PLAYING NOW"
    face = font(FONT_BOLD, 28)
    tw, th = text_size(draw, label, face)
    x = (W - tw) // 2
    y = max(28, top - 58)
    draw.rounded_rectangle((x - 22, y - 8, x + tw + 22, y + th + 10), radius=8, fill=(8, 4, 12, 230))
    draw.text((x, y), label, font=face, fill=ORANGE + (255,))
    return layer


def overlay_drive(t: float) -> Image.Image:
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    panel = glass_panel(1080, 560)
    draw = ImageDraw.Draw(panel)
    draw.text((48, 36), "GOOGLE DRIVE", font=font(FONT_BOLD, 24), fill=BLUE + (255,))
    draw.text((48, 78), "Folders stay albums", font=font(FONT_DISPLAY, 64), fill=WHITE + (255,))
    steps = (
        ("1", "Share the folder", "Anyone with the link can view."),
        ("2", "Paste the link", "Add Drive on the jukebox."),
        ("3", "Pick an album", "Jazz, Jazz / Bebop, Late Night."),
    )
    for i, (num, heading, body) in enumerate(steps):
        x = 48 + i * 340
        y = 220
        reveal = smooth(min(1.0, max(0.0, (t - i * 0.12) / 0.28)))
        card = Image.new("RGBA", (310, 250), (0, 0, 0, 0))
        cd = ImageDraw.Draw(card)
        cd.rounded_rectangle((0, 0, 309, 249), radius=14, fill=(255, 255, 255, int(28 * reveal)), outline=BLUE + (int(180 * reveal),), width=2)
        cd.ellipse((18, 22, 74, 78), fill=ORANGE + (int(255 * reveal),))
        cd.text((46, 50), num, font=font(FONT_BOLD, 26), fill=WHITE + (int(255 * reveal),), anchor="mm")
        cd.text((18, 108), heading, font=font(FONT_BOLD, 26), fill=WHITE + (int(255 * reveal),))
        cd.text((18, 156), body, font=font(FONT_REG, 22), fill=MUTED + (int(255 * reveal),))
        panel.paste(card, (x, y), card)
    layer.paste(panel, ((W - panel.width) // 2, (H - panel.height) // 2 - 8), panel)
    return layer


def overlay_modes(t: float) -> Image.Image:
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    panel = glass_panel(1040, 520)
    draw = ImageDraw.Draw(panel)
    draw.text((520, 42), "Play it like a diner cabinet", font=font(FONT_DISPLAY, 48), fill=WHITE + (255,), anchor="mt")
    labels = (
        ("Play Continuous Album", True),
        ("Play Random Album", False),
        ("Play Continuous All", False),
        ("Play Random All", False),
    )
    for i, (label, pressed) in enumerate(labels):
        col, row = i % 2, i // 2
        x = 48 + col * 480
        y = 140 + row * 78
        mode_button(draw, (x, y, x + 456, y + 62), label, pressed)
    for i, label in enumerate(("30 s", "60 s", "90 s")):
        x = 48 + i * 320
        mode_button(draw, (x, 320, x + 296, 382), label, i == 1 and t > 0.45)
    draw.text((520, 430), "Change notes. The song keeps playing.", font=font(FONT_REG, 28), fill=MUTED + (255,), anchor="mt")
    layer.paste(panel, ((W - panel.width) // 2, (H - panel.height) // 2), panel)
    return layer


def overlay_end(t: float) -> Image.Image:
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    rise = lerp(24, 0, smooth(min(1.0, t / 0.3)))
    draw.text((W // 2, 340 - rise), "Livia's Jukebox", font=font(FONT_DISPLAY, 92), fill=WHITE + (255,), anchor="mm")
    draw.text((W // 2, 460), "thgsoft.online/DjangoNotesPro", font=font(FONT_BOLD, 42), fill=WHITE + (255,), anchor="mm")
    draw.text((W // 2, 530), "No ads. Albums from your Drive folder.", font=font(FONT_REG, 32), fill=MUTED + (255,), anchor="mm")
    draw.rounded_rectangle((W // 2 - 250, 620, W // 2 + 250, 712), radius=10, fill=ORANGE + (255,))
    draw.text((W // 2, 666), "Play in NotesPro", font=font(FONT_BOLD, 36), fill=WHITE + (255,), anchor="mm")
    return layer


def segments():
    return [
        (7.0, overlay_player),
        (6.0, overlay_drive),
        (6.0, overlay_modes),
        (6.0, overlay_end),
    ]


def blend(a: Image.Image, b: Image.Image, t: float) -> Image.Image:
    return Image.blend(a.convert("RGBA"), b.convert("RGBA"), smooth(t))


def compose(plate: Image.Image, index: int, total: int, overlay: Image.Image) -> Image.Image:
    frame = backdrop(plate, index / max(1, total - 1)).convert("RGBA")
    return Image.alpha_composite(frame, overlay).convert("RGB")


def write_bed(path: Path) -> None:
    """Original soft blues pulse. No third-party recording."""
    sr = 44100
    n = int(DURATION * sr)
    roots = (110.0, 110.0, 146.83, 146.83, 164.81, 164.81, 110.0, 110.0)
    frames = []
    for i in range(n):
        sec = i / sr
        beat = sec * 2.0
        root = roots[min(int(sec / 3.125), len(roots) - 1)]
        pulse = max(0.0, 1.0 - (beat % 1.0) / 0.22)
        pulse = pulse * pulse
        bass = math.sin(2 * math.pi * root * sec) * (0.22 + 0.35 * pulse)
        fifth = math.sin(2 * math.pi * root * 1.5 * sec) * 0.08
        high = math.sin(2 * math.pi * root * 4 * sec) * 0.05 * pulse
        master = 0.55
        if sec < 0.08:
            master *= smooth(sec / 0.08)
        if sec > DURATION - 0.9:
            master *= smooth((DURATION - sec) / 0.9)
        sample = max(-1.0, min(1.0, (bass + fifth + high) * master))
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
    plate = prepare_plate()
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
        return compose(plate, index, total, current)

    print("Writing audio bed...")
    write_bed(OUT_WAV)
    print(f"Encoding {total} frames to {OUT_MP4.name}...")
    encode((frame_at(i) for i in range(total)), total)
    OUT_WAV.unlink(missing_ok=True)
    print(f"Wrote {OUT_MP4}")


if __name__ == "__main__":
    main()
