"""The synthetic U2 solder bridge must look like solder: gray metal across the gap, pads visible."""

import cv2
import numpy as np

from app.cv_pipeline import VisualDiffPipeline
from tests.test_roi_pair import load


def u2_halves() -> tuple[np.ndarray, np.ndarray]:
    base, target = load("pcb_board")
    box = min(VisualDiffPipeline().run(base, target).boxes, key=lambda b: b.x)
    sl = (slice(box.y, box.y + box.h), slice(box.x, box.x + box.w))
    return base[sl], target[sl]


def pad_fraction(img: np.ndarray) -> float:
    """Fraction of gold pad pixels (BGR near (60, 175, 215))."""
    return float((np.abs(img.astype(int) - (60, 175, 215)).max(axis=2) < 40).mean())


def test_pads_stay_visible_next_to_the_bridge() -> None:
    before, after = u2_halves()
    assert pad_fraction(after) >= 0.7 * pad_fraction(before)


def test_bridge_pixels_are_gray_metal_not_flat_white() -> None:
    before, after = u2_halves()
    changed = np.abs(after.astype(int) - before.astype(int)).max(axis=2) > 40
    hsv = cv2.cvtColor(after, cv2.COLOR_BGR2HSV)
    assert changed.sum() > 40
    assert hsv[..., 1][changed].mean() < 60
    assert (hsv[..., 2][changed] > 235).mean() < 0.3
    assert hsv[..., 2][changed].std() > 15
