"""Build a 9:16 YouTube Short from the Livia's Jukebox promo.

    .venv\\Scripts\\python.exe docs/promo/build_jukebox_short.py

Writes docs/promo/jukebox-short.mp4 (1080x1920, 25s).
Opens on the jukebox already playing, then the Drive steps.
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
OUT_MP4 = OUT_DIR / "jukebox-short.mp4"
OUT_WAV = OUT_DIR / "jukebox-short.wav"

W, H = 1080, 1920
FPS = 30
DURATION = 25.0
SAFE_X = 64
SAFE_R = 900
COL_W = SAFE_R - SAFE_X

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


def center_text(draw, xy, text, face, fill) -> None:
    box = draw.textbbox((0, 0), text, font=face)
    tw, th = box[2] - box[0], box[3] - box[1]
    draw.text((xy[0] - tw / 2, xy[1] - th / 2), text, font=face, fill=fill)


def backdrop() -> Image.Image:
    src = Image.open(PHOTO).convert("RGB")
    scale = max(W / src.width, H / src.height)
    plate = src.resize((int(src.width * scale), int(src.height * scale)), Image.Resampling.LANCZOS)
    left = (plate.width - W) // 2
    top = (plate.height - H) // 2
    frame = plate.crop((left, top, left + W, top + H))
    frame = ImageEnhance.Color(frame).enhance(1.08)
    dim = Image.new("RGB", (W, H), (8, 4, 12))
    frame = Image.blend(frame, dim, 0.46)
    shade = Image.new("L", (W, H), 0)
    sd = ImageDraw.Draw(shade)
    sd.rectangle((0, 0, W, 220), fill=120)
    sd.rectangle((0, H - 420, W, H), fill=150)
    dark = Image.new("RGB", (W, H), (6, 3, 10))
    return Image.composite(dark, frame, shade)


def glass(width: int, height: int) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    panel = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(panel)
    draw.rounded_rectangle((0, 0, width - 1, height - 1), radius=18, fill=(18, 11, 22, 220))
    draw.rounded_rectangle((0, 0, width - 1, height - 1), radius=18, outline=ORANGE + (190,), width=3)
    return panel, draw


def player_card(active: str = "Side Street", progress: float = 0.48, bars: tuple[float, ...] = (0.45, 0.9, 0.6, 0.8)) -> Image.Image:
    """Jukebox already mid-song. progress is how far the track has played."""
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    kicker = font(FONT_BOLD, 26)
    label = "PLAYING NOW  ·  GOOGLE DRIVE ALBUM"
    box = draw.textbbox((SAFE_X, 292), label, font=kicker)
    draw.rounded_rectangle((box[0] - 16, box[1] - 10, box[2] + 16, box[3] + 12), radius=8, fill=(8, 4, 12, 230))
    draw.text((SAFE_X, 292), label, font=kicker, fill=ORANGE + (255,))
    panel, pdraw = glass(COL_W, 760)
    pdraw.text((36, 28), "Livia's Jukebox", font=font(FONT_BOLD, 36), fill=WHITE + (255,))
    pdraw.text((36, 82), f"{active}  —  Jazz", font=font(FONT_BOLD, 26), fill=WHITE + (255,))
    track_r = COL_W - 160
    pdraw.rounded_rectangle((36, 136, track_r, 168), radius=8, fill=(255, 255, 255, 28))
    fill_w = max(18, int((track_r - 52) * max(0.04, min(0.96, progress))))
    pdraw.rounded_rectangle((44, 144, 44 + fill_w, 160), radius=6, fill=ORANGE + (255,))
    bx = COL_W - 36 - 18
    for height in reversed(bars):
        bh = int(8 + 28 * max(0.15, min(1.0, height)))
        pdraw.rounded_rectangle((bx, 148 - bh // 2, bx + 10, 156 + bh // 2), radius=3, fill=ORANGE + (255,))
        bx -= 16
    pdraw.text((36, 190), "Album", font=font(FONT_BOLD, 20), fill=WHITE + (255,))
    pdraw.rounded_rectangle((140, 178, 360, 222), radius=6, fill=(255, 255, 255, 235))
    pdraw.text((156, 188), "Jazz", font=font(FONT_BOLD, 22), fill=INK + (255,))
    for i, (name, _on) in enumerate(SONGS):
        y = 250 + i * 76
        fill = BLUE_DEEP if name == active else BLUE
        pdraw.rounded_rectangle((36, y, COL_W - 36, y + 64), radius=8, fill=fill + (255,))
        pdraw.text((56, y + 16), name, font=font(FONT_BOLD, 26), fill=WHITE + (255,))
    layer.paste(panel, (SAFE_X, 340), panel)
    return layer


def drive_card() -> Image.Image:
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    panel, draw = glass(COL_W, 720)
    draw.text((36, 28), "GOOGLE DRIVE", font=font(FONT_BOLD, 24), fill=BLUE + (255,))
    face = font(FONT_DISPLAY, 52)
    y = draw_lines(draw, 36, 72, wrap(draw, "Folders stay albums", face, COL_W - 72), face, WHITE + (255,), 62)
    steps = (
        ("1", "Share the folder", "Anyone with the link can view."),
        ("2", "Paste the link", "Add Drive on the jukebox."),
        ("3", "Pick an album", "Jazz, Jazz / Bebop, Late Night."),
    )
    y += 16
    for num, heading, body in steps:
        draw.rounded_rectangle((28, y, COL_W - 28, y + 130), radius=14, fill=(255, 255, 255, 28), outline=BLUE + (180,), width=2)
        draw.ellipse((48, y + 28, 108, y + 88), fill=ORANGE + (255,))
        center_text(draw, (78, y + 58), num, font(FONT_BOLD, 26), WHITE + (255,))
        draw.text((128, y + 24), heading, font=font(FONT_BOLD, 28), fill=WHITE + (255,))
        body_face = font(FONT_REG, 22)
        draw_lines(draw, 128, y + 68, wrap(draw, body, body_face, COL_W - 180), body_face, MUTED + (255,), 28)
        y += 146
    layer.paste(panel, (SAFE_X, 340), panel)
    return layer


def modes_card() -> Image.Image:
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    panel, draw = glass(COL_W, 820)
    face = font(FONT_DISPLAY, 44)
    y = draw_lines(draw, 36, 28, wrap(draw, "Play it like a diner cabinet", face, COL_W - 72), face, WHITE + (255,), 52)
    labels = (
        ("Play Continuous Album", True),
        ("Play Random Album", False),
        ("Play Continuous All", False),
        ("Play Random All", False),
    )
    y += 16
    for label, pressed in labels:
        fill = (33, 161, 241, 255) if pressed else ORANGE + (255,)
        draw.rounded_rectangle((36, y, COL_W - 36, y + 64), radius=8, fill=fill)
        center_text(draw, (COL_W // 2, y + 32), label, font(FONT_BOLD, 24), WHITE + (255,))
        y += 76
    y += 8
    btn_w = (COL_W - 72 - 24) // 3
    for i, label in enumerate(("30 s", "60 s", "90 s")):
        x = 36 + i * (btn_w + 12)
        fill = (33, 161, 241, 255) if i == 1 else ORANGE + (255,)
        draw.rounded_rectangle((x, y, x + btn_w, y + 64), radius=8, fill=fill)
        center_text(draw, (x + btn_w // 2, y + 32), label, font(FONT_BOLD, 24), WHITE + (255,))
    y += 88
    note = font(FONT_REG, 24)
    draw_lines(draw, 36, y, wrap(draw, "Change notes. The song keeps playing.", note, COL_W - 72), note, MUTED + (255,), 32)
    layer.paste(panel, (SAFE_X, 320), panel)
    return layer


def end_card() -> Image.Image:
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    face = font(FONT_DISPLAY, 68)
    y = draw_lines(draw, SAFE_X, 620, wrap(draw, "Livia's Jukebox", face, COL_W), face, WHITE + (255,), 80)
    url = font(FONT_BOLD, 30)
    y = draw_lines(draw, SAFE_X, y + 20, wrap(draw, "thgsoft.online/DjangoNotesPro", url, COL_W), url, WHITE + (255,), 40)
    note = font(FONT_REG, 28)
    y = draw_lines(draw, SAFE_X, y + 16, wrap(draw, "No ads. Albums from your Drive folder.", note, COL_W), note, MUTED + (255,), 36)
    y += 28
    draw.rounded_rectangle((SAFE_X, y, SAFE_X + 460, y + 88), radius=10, fill=ORANGE + (255,))
    center_text(draw, (SAFE_X + 230, y + 44), "Play in NotesPro", font(FONT_BOLD, 30), WHITE + (255,))
    return layer


def compose(base: Image.Image, overlay: Image.Image) -> Image.Image:
    return Image.alpha_composite(base.convert("RGBA"), overlay).convert("RGB")


def write_bed(path: Path) -> None:
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


def encode(frames) -> None:
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
    total = len(frames)
    for i, frame in enumerate(frames, start=1):
        proc.stdin.write(frame.tobytes())
        if i % 150 == 0 or i == total:
            print(f"  {i}/{total}", flush=True)
    proc.stdin.close()
    err = proc.stderr.read().decode("utf-8", errors="replace") if proc.stderr else ""
    if proc.wait() != 0:
        raise SystemExit(err[-2000:])


def timeline(slides: list[tuple[float, Image.Image]], target: int | None = None) -> list[Image.Image]:
    lengths = [int(round(sec * FPS)) for sec, _ in slides]
    want = int(DURATION * FPS) if target is None else target
    if sum(lengths) != want:
        lengths[-1] += want - sum(lengths)
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


def opening_frames(base: Image.Image, count: int) -> list[Image.Image]:
    """First frames are the jukebox mid-song, then the next track starts."""
    frames = []
    switch = 3.2
    for i in range(count):
        t = i / FPS
        if t < switch:
            active = "Side Street"
            progress = 0.46 + 0.22 * (t / switch)
        else:
            active = "Late Window"
            progress = 0.08 + 0.40 * ((t - switch) / max(0.1, count / FPS - switch))
        phase = t * 7.5
        bars = tuple(0.25 + 0.75 * abs(math.sin(phase + k)) for k in (0.0, 1.1, 2.0, 2.8))
        frames.append(compose(base, player_card(active, progress, bars)))
    return frames


def main() -> None:
    print("Composing frames...")
    base = backdrop()
    fade = 10
    open_len = int(7.0 * FPS)
    opening = opening_frames(base, open_len)
    drive = compose(base, drive_card())
    for i in range(fade):
        t = smooth((i + 1) / fade)
        opening[open_len - fade + i] = Image.blend(opening[open_len - fade + i], drive, t)
    slides = [
        (6.0, drive),
        (6.0, compose(base, modes_card())),
        (6.0, compose(base, end_card())),
    ]
    print("Writing audio bed...")
    write_bed(OUT_WAV)
    print(f"Encoding {OUT_MP4.name}...")
    encode(opening + timeline(slides, target=int(DURATION * FPS) - len(opening)))
    OUT_WAV.unlink(missing_ok=True)
    print(f"Wrote {OUT_MP4}")


if __name__ == "__main__":
    main()
