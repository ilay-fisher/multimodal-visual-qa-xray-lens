"""Generate deterministic baseline/target pairs (run from backend/); targets get mild noise."""

from __future__ import annotations

import json
import logging
from functools import partial
from pathlib import Path

import cv2
import numpy as np

logger = logging.getLogger("generate_samples")

W, H = 960, 640
SEED, NOISE_SIGMA = 20260101, 2.5
AA, f32 = cv2.LINE_AA, np.float32
rect = partial(cv2.rectangle, thickness=-1)


def text(
    img: np.ndarray, s: str, org: tuple[int, int], scale: float, color, thick: int = 1
) -> None:
    """Anti-aliased label."""
    cv2.putText(img, s, org, cv2.FONT_HERSHEY_SIMPLEX, scale, color, thick, AA)


def rrect(img: np.ndarray, x: int, y: int, w: int, h: int, r: int, color) -> None:
    """Filled rounded rectangle."""
    rect(img, (x + r, y), (x + w - r, y + h), color)
    rect(img, (x, y + r), (x + w, y + h - r), color)
    for cx, cy in ((x + r, y + r), (x + w - r, y + r), (x + r, y + h - r), (x + w - r, y + h - r)):
        cv2.circle(img, (cx, cy), r, color, -1, AA)


def pcb_board(defect: bool) -> np.ndarray:
    """Green PCB with traces, ICs and SMD parts; defect = missing part + solder bridge."""
    rng = np.random.default_rng(SEED)
    img = np.full((H, W, 3), (62, 112, 28), np.uint8)
    img = cv2.add(img, cv2.GaussianBlur(rng.normal(0, 5, (H, W, 1)).astype(f32), (0, 0), 1.5))
    copper, gold, silver = (70, 130, 160), (60, 175, 215), (205, 212, 218)
    # fmt: off
    traces = [[(40, 90), (300, 90), (340, 130), (700, 130), (740, 90), (920, 90)],
              [(40, 300), (200, 300), (260, 360), (260, 470), (400, 470)],
              [(100, 560), (420, 560), (470, 510)], [(480, 330), (480, 470), (700, 470)],
              [(760, 230), (760, 400), (900, 400)], [(300, 90), (300, 250)]]
    parts = [(120, 420), (200, 420), (280, 420), (360, 420), (640, 180), (720, 200),
             (820, 300), (600, 540), (780, 520)]
    # fmt: on
    for pts in traces:
        cv2.polylines(img, [np.array(pts, np.int32)], False, copper, 5, AA)
    for i, (cx, cy) in enumerate([(200, 180), (420, 300), (700, 340)]):  # SOIC-style ICs
        for side, k in [(s, k) for s in (-1, 1) for k in range(6)]:
            px, py = cx - 55 + k * 22, cy + side * 48
            rect(img, (px, py - 12), (px + 12, py + 12), gold)
        rect(img, (cx - 66, cy - 36), (cx + 66, cy + 36), (28, 28, 32))
        cv2.circle(img, (cx - 54, cy - 24), 5, (90, 90, 95), -1, AA)
        text(img, f"U{i + 1}", (cx - 18, cy + 6), 0.6, (150, 150, 155))
    for i, (px, py) in enumerate(parts):  # SMD resistors/capacitors on gold pads
        for dx in (-22, 22):
            rect(img, (px + dx - 11, py - 15), (px + dx + 11, py + 15), gold)
        if not (defect and (px, py) == (640, 180)):  # defect: component R5 is missing
            body = (32, 32, 36) if i % 3 else (80, 140, 185)
            rect(img, (px - 24, py - 12), (px + 24, py + 12), body)
            for dx in (-24, 24):
                rect(img, (px + dx - 5, py - 12), (px + dx + 5, py + 12), silver)
        text(img, f"R{i + 1}", (px - 14, py + 34), 0.4, (230, 235, 235))
    if defect:  # solder bridge across two adjacent pads on the top row of U2
        cv2.ellipse(img, (387, 252), (19, 13), 0, 0, 360, silver, -1, AA)
    return img


def aerial_crop(defect: bool) -> np.ndarray:
    """Top-down crop field with rows and a dirt track; defect = brownish-yellow stress patch."""
    rng = np.random.default_rng(SEED + 1)
    yy, xx = np.mgrid[0:H, 0:W].astype(f32)
    rows = 0.5 + 0.5 * np.sin(2 * np.pi * (xx * np.cos(0.21) + yy * np.sin(0.21)) / 24)
    low = cv2.resize(rng.normal(0, 1, (H // 16, W // 16)).astype(f32), (W, H), interpolation=2)
    fine = cv2.GaussianBlur(rng.normal(0, 1, (H, W)).astype(f32), (0, 0), 1.2)
    t = np.clip(rows * 0.7 + 0.3 + 0.12 * low + 0.18 * fine, 0, 1)[..., None]
    dark, light = np.array((38, 92, 40), f32), np.array((72, 160, 88), f32)
    img = dark + (light - dark) * t
    track = np.abs((yy - 0.18 * xx) - 470) < 16  # dirt track along the bottom
    img[track] = np.array((92, 128, 150), f32) * (0.9 + 0.1 * fine[track][:, None])
    if defect:
        a = np.linspace(0, 2 * np.pi, 40, endpoint=False)
        r = 70 + 14 * np.sin(3 * a + 1) + rng.uniform(-5, 5, a.shape)
        outline = np.stack([620 + 1.25 * r * np.cos(a), 250 + r * np.sin(a)], 1).astype(np.int32)
        patch = np.zeros((H, W), f32)
        cv2.fillPoly(patch, [outline], 1.0)
        patch = cv2.GaussianBlur(patch, (0, 0), 4)[..., None] * 0.9
        stress = np.array((52, 138, 178), f32) * (0.75 + 0.35 * t)
        img = img * (1 - patch) + stress * patch
    return np.clip(img, 0, 255).astype(np.uint8)


def ui_layout(defect: bool) -> np.ndarray:
    """Mock dashboard screen; defect = the last card's button is clipped mid-label."""
    img = np.full((H, W, 3), (247, 246, 244), np.uint8)
    ink, muted, brand, white = (60, 50, 40), (150, 140, 130), (200, 110, 40), (255, 255, 255)
    rect(img, (0, 0), (W, 64), (70, 45, 30))
    cv2.circle(img, (40, 32), 14, (255, 190, 90), -1, AA)
    text(img, "Lumen Analytics", (68, 40), 0.7, white, 2)
    text(img, "Overview      Reports      Billing      Settings", (540, 40), 0.5, (235, 225, 215))
    text(img, "Workspace overview", (40, 110), 0.9, ink, 2)
    cards = [
        ("Active users", "12,480", "Invite team"),
        ("Monthly revenue", "$48.2k", "View report"),
        ("Open tickets", "37", "Export report"),
    ]
    for i, (title, value, action) in enumerate(cards):
        x, y, w, h = 40 + i * 300, 140, 280, 220
        rrect(img, x + 3, y + 5, w, h, 12, (225, 224, 222))  # soft shadow
        rrect(img, x, y, w, h, 12, white)
        text(img, title, (x + 22, y + 44), 0.55, muted)
        text(img, value, (x + 22, y + 108), 1.3, ink, 2)
        cv2.line(img, (x + 22, y + 130), (x + w - 22, y + 130), (235, 233, 230), 1)
        clipped = defect and i == 2  # the button container and its label are cut off
        rrect(img, x + 22, y + 156, 92 if clipped else 150, 42, 8, brand)
        text(img, action, (x + 36, y + 183), 0.55, white)
        if clipped:
            rect(img, (x + 22 + 92, y + 150), (x + 22 + 170, y + 205), white)
    text(img, "Recent activity", (40, 410), 0.75, ink, 2)
    for r in range(4):  # activity feed rows
        y = 440 + r * 46
        cv2.line(img, (40, y + 30), (920, y + 30), (232, 230, 227), 1)
        text(img, f"Report #{2041 + r} was shared with the finance team", (56, y + 16), 0.5, ink)
    return img


PRESETS = [
    ("pcb_board", "PCB Hardware Inspection", "pcb", 2, pcb_board),
    ("aerial_crop", "Aerial Crop Monitoring", "aerial", 1, aerial_crop),
    ("ui_layout", "UI Regression Check", "ui", 1, ui_layout),
]


def generate_all(out_dir: Path) -> list[dict[str, object]]:
    """Write all sample PNGs and presets.json into ``out_dir``; return the preset metadata."""
    out_dir.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(SEED + 99)
    presets: list[dict[str, object]] = []
    for pid, label, context, expected, scene in PRESETS:
        target = scene(True).astype(f32) + rng.normal(0, NOISE_SIGMA, (H, W, 3))
        cv2.imwrite(str(out_dir / f"{pid}_baseline.png"), scene(False))
        cv2.imwrite(str(out_dir / f"{pid}_target.png"), np.clip(target, 0, 255).astype(np.uint8))
        presets.append(
            {"id": pid, "label": label, "domain_context": context, "expected_defects": expected}
        )
        logger.info("wrote %s pair (%dx%d)", pid, W, H)
    (out_dir / "presets.json").write_text(json.dumps(presets, indent=2) + "\n")
    return presets


def main() -> None:
    """CLI entry point: write samples next to backend/app."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    out_dir = Path(__file__).resolve().parent.parent / "samples"
    print(f"Generated {len(generate_all(out_dir))} sample pairs in {out_dir}")


if __name__ == "__main__":
    main()
