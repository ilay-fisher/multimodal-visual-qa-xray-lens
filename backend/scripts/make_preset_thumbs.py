"""Build the static preset-chip thumbnails (run from backend/ with the venv active).

The API has no thumbnail endpoint, so the chips use small static files instead:
`frontend/public/presets/<preset id>.webp`, one per entry in `samples/presets.json`.
Each is the centre crop of the preset's `<id>_target.png`, 128x88 px (shown at 64x44 CSS px,
2x), re-encoded at the highest WebP quality that keeps it under 8 KB.

    python scripts/make_preset_thumbs.py

Re-run it after `generate_samples.py` changes the sample images.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import cv2

logger = logging.getLogger("make_preset_thumbs")

ROOT = Path(__file__).resolve().parents[2]
SAMPLES = ROOT / "backend" / "samples"
OUT = ROOT / "frontend" / "public" / "presets"
W, H = 128, 88
MAX_BYTES = 8 * 1024


def centre_crop(img, aspect: float):
    """Largest centred crop of `img` with width / height == `aspect`."""
    h, w = img.shape[:2]
    cw, ch = (w, round(w / aspect)) if w / h < aspect else (round(h * aspect), h)
    x, y = (w - cw) // 2, (h - ch) // 2
    return img[y : y + ch, x : x + cw]


def encode(img) -> bytes:
    """WebP bytes at the best quality under MAX_BYTES (raises if even quality 30 is too big)."""
    for quality in range(90, 29, -5):
        ok, buf = cv2.imencode(".webp", img, [cv2.IMWRITE_WEBP_QUALITY, quality])
        if ok and len(buf) <= MAX_BYTES:
            return buf.tobytes()
    raise ValueError(f"cannot fit under {MAX_BYTES} bytes")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    OUT.mkdir(parents=True, exist_ok=True)
    for preset in json.loads((SAMPLES / "presets.json").read_text()):
        src = SAMPLES / f"{preset['id']}_target.png"
        img = cv2.imread(str(src))
        if img is None:
            raise FileNotFoundError(src)
        thumb = cv2.resize(centre_crop(img, W / H), (W, H), interpolation=cv2.INTER_AREA)
        data = encode(thumb)
        (OUT / f"{preset['id']}.webp").write_bytes(data)
        logger.info("%s.webp  %dx%d  %d bytes", preset["id"], W, H, len(data))


if __name__ == "__main__":
    main()
