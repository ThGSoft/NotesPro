"""Build a 25-second 1080p NotesPro promo for YouTube.

Requires imageio-ffmpeg (bundled ffmpeg):

    .venv\\Scripts\\python.exe -m pip install imageio-ffmpeg
    .venv\\Scripts\\python.exe docs/promo/build_youtube_promo.py

Writes docs/promo/notespro-25s.mp4
"""

from __future__ import annotations

import math
import struct
import subprocess
import wave
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
SHOTS = ROOT / "docs" / "screenshots"
OUT_DIR = Path(__file__).resolve().parent
OUT_MP4 = OUT_DIR / "notespro-25s.mp4"
OUT_WAV = OUT_DIR / "notespro-25s.wav"

W, H = 1920, 1080
FPS = 30
DURATION = 25.0

BG = (11, 18, 32)
INK = (15, 23, 42)
YELLOW = (240, 224, 112)
WHITE = (248, 250, 252)
MUTED = (203, 213, 225)
PIN = (227, 27, 35)

FONT_BOLD = Path(r"C:\Windows\Fonts\segoeuib.ttf")
FONT_REG = Path(r"C:\Windows\Fonts\segoeui.ttf")


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size)


def smooth(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def fit(img: Image.Image, box_w: int, box_h: int, zoom: float) -> Image.Image:
    scale = min(box_w / img.width, box_h / img.height) * zoom
    size = (max(1, int(img.width * scale)), max(1, int(img.height * scale)))
    return img.resize(size, Image.Resampling.LANCZOS)


def rounded_mask(size: tuple[int, int], radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius=radius, fill=255)
    return mask


def paste_center(canvas: Image.Image, img: Image.Image, cx: int, cy: int) -> None:
    canvas.paste(img, (cx - img.width // 2, cy - img.height // 2), img if img.mode == "RGBA" else None)


def load_shot(name: str) -> Image.Image:
    img = Image.open(SHOTS / name).convert("RGB")
    max_w = 1600
    if img.width > max_w:
        img = img.resize((max_w, int(img.height * max_w / img.width)), Image.Resampling.LANCZOS)
    return img


def base() -> Image.Image:
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)
    draw.rectangle((0, 0, W, 8), fill=YELLOW)
    return img


def draw_caption(img: Image.Image, kicker: str, headline: str) -> None:
    draw = ImageDraw.Draw(img)
    bar_top = H - 168
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(overlay).rectangle((0, bar_top, W, H), fill=(8, 12, 22, 210))
    img.paste(Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB"))
    draw = ImageDraw.Draw(img)
    draw.text((88, bar_top + 28), kicker.upper(), font=font(FONT_BOLD, 28), fill=YELLOW)
    draw.text((88, bar_top + 70), headline, font=font(FONT_BOLD, 54), fill=WHITE)


def render_title(t: float) -> Image.Image:
    img = base()
    note = Image.new("RGBA", (980, 460), (0, 0, 0, 0))
    nd = ImageDraw.Draw(note)
    nd.rounded_rectangle((20, 40, 960, 440), radius=8, fill=(243, 232, 120, 255), outline=(17, 17, 17, 255), width=4)
    nd.ellipse((458, 8, 522, 72), fill=PIN, outline=(17, 17, 17, 255), width=3)
    nd.text((70, 130), "NotesPro", font=font(FONT_BOLD, 108), fill=(17, 17, 17, 255))
    nd.text((74, 270), "Notes, boards, and chat", font=font(FONT_REG, 42), fill=(30, 30, 30, 255))
    nd.text((74, 330), "in one workspace.", font=font(FONT_REG, 42), fill=(30, 30, 30, 255))
    pop = lerp(0.94, 1.0, smooth(min(1.0, t / 0.35)))
    angle = lerp(-5.5, -2.2, smooth(min(1.0, t / 0.45)))
    note = note.resize((int(note.width * pop), int(note.height * pop)), Image.Resampling.LANCZOS)
    note = note.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)
    paste_center(img, note, W // 2, H // 2 - 10)
    return img


def render_shot(src: Image.Image, t: float, kicker: str, headline: str) -> Image.Image:
    img = base()
    zoom = lerp(1.0, 1.045, smooth(t))
    shot = fit(src, 1680, 820, zoom)
    framed = Image.new("RGBA", shot.size, (0, 0, 0, 0))
    framed.paste(shot, (0, 0))
    mask = rounded_mask(shot.size, 18)
    framed.putalpha(mask)
    border = Image.new("RGBA", (shot.width + 8, shot.height + 8), (0, 0, 0, 0))
    ImageDraw.Draw(border).rounded_rectangle(
        (0, 0, border.width - 1, border.height - 1), radius=22, outline=(255, 255, 255, 40), width=2
    )
    paste_center(img, border, W // 2, 470)
    paste_center(img, framed, W // 2, 470)
    draw_caption(img, kicker, headline)
    return img


def render_end(t: float) -> Image.Image:
    img = base()
    draw = ImageDraw.Draw(img)
    rise = lerp(24, 0, smooth(min(1.0, t / 0.3)))
    draw.text((W // 2, 300 - rise), "NotesPro", font=font(FONT_BOLD, 120), fill=YELLOW, anchor="mm")
    draw.text((W // 2, 470), "thgsoft.online/DjangoNotesPro", font=font(FONT_BOLD, 48), fill=WHITE, anchor="mm")
    draw.text((W // 2, 560), "Open the live demo", font=font(FONT_REG, 36), fill=MUTED, anchor="mm")
    draw.rounded_rectangle((W // 2 - 280, 680, W // 2 + 280, 776), radius=12, fill=YELLOW)
    draw.text((W // 2, 728), "Try it in the browser", font=font(FONT_BOLD, 36), fill=INK, anchor="mm")
    return img


def segments():
    dashboard = load_shot("dashboard-full.png")
    kanban = load_shot("Kanban.png")
    sheets = load_shot("Sheet-Charts.png")
    gallery = load_shot("Gallery.png")
    return [
        (6.0, lambda t: render_shot(dashboard, t, "Notes", "Markdown with a live preview")),
        (5.0, lambda t: render_shot(kanban, t, "Boards", "Kanban that lives in the page")),
        (4.5, lambda t: render_shot(sheets, t, "Numbers", "Sheets and charts, side by side")),
        (4.5, lambda t: render_shot(gallery, t, "Photos", "Walk through a 3D gallery")),
        (5.0, render_end),
    ]


def blend(a: Image.Image, b: Image.Image, t: float) -> Image.Image:
    return Image.blend(a, b, smooth(t))


def write_bed(path: Path) -> None:
    """Original soft pad. No third-party music."""
    sr = 44100
    n = int(DURATION * sr)
    # A minor, F, C, G, back to A — one chord per five seconds.
    chords = [
        (220.00, 261.63, 329.63),
        (174.61, 220.00, 261.63),
        (261.63, 329.63, 392.00),
        (196.00, 246.94, 293.66),
        (220.00, 261.63, 329.63),
    ]
    frames = []
    for i in range(n):
        sec = i / sr
        chord = chords[min(int(sec / 5), len(chords) - 1)]
        local = (sec % 5) / 5
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
            nxt_t = (index - (boundary - fade)) / fade
            nxt = parts[seg + 1][1](0.0)
            return blend(current, nxt, nxt_t)
        return current

    print("Writing audio bed...")
    write_bed(OUT_WAV)
    print(f"Encoding {total} frames to {OUT_MP4.name}...")
    encode((frame_at(i).convert("RGB") for i in range(total)), total)
    OUT_WAV.unlink(missing_ok=True)
    print(f"Wrote {OUT_MP4}")


if __name__ == "__main__":
    main()
