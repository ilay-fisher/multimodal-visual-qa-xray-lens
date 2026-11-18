"""Tests for the classical CV diff pipeline and the sample generator."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType

import cv2
import numpy as np
import pytest

from app.cv_pipeline import (
    BoundingBox,
    VisualDiffPipeline,
    crop,
    decode_image,
    encode_png,
    merge_boxes,
)

BACKEND_DIR = Path(__file__).resolve().parent.parent
SAMPLES_DIR = BACKEND_DIR / "samples"
H, W = 480, 640


def make_base(seed: int = 0) -> np.ndarray:
    """A textured but deterministic baseline image."""
    rng = np.random.default_rng(seed)
    img = np.full((H, W, 3), (90, 120, 80), dtype=np.uint8)
    cv2.rectangle(img, (40, 40), (300, 200), (60, 60, 160), -1)
    cv2.circle(img, (480, 300), 70, (200, 180, 60), -1)
    cv2.line(img, (0, 400), (W, 380), (230, 230, 230), 3)
    texture = rng.integers(-4, 5, size=img.shape)
    return np.clip(img.astype(int) + texture, 0, 255).astype(np.uint8)


def add_noise(img: np.ndarray, sigma: float = 3.0, seed: int = 1) -> np.ndarray:
    rng = np.random.default_rng(seed)
    noisy = img.astype(np.float32) + rng.normal(0, sigma, img.shape)
    return np.clip(noisy, 0, 255).astype(np.uint8)


def iou(a: BoundingBox, b: tuple[int, int, int, int]) -> float:
    bx, by, bw, bh = b
    ix = max(0, min(a.x + a.w, bx + bw) - max(a.x, bx))
    iy = max(0, min(a.y + a.h, by + bh) - max(a.y, by))
    inter = ix * iy
    union = a.area + bw * bh - inter
    return inter / union if union else 0.0


def load_generator() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "generate_samples", BACKEND_DIR / "scripts" / "generate_samples.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["generate_samples"] = module
    spec.loader.exec_module(module)
    return module


def test_identical_images_yield_nothing() -> None:
    base = make_base()
    result = VisualDiffPipeline().run(base, base.copy())
    assert result.boxes == []
    assert result.roi_pixels == 0
    assert result.pixels_filtered_pct == 100.0
    assert result.total_pixels == H * W
    assert (result.image_width, result.image_height) == (W, H)
    assert result.overlay_png.startswith(b"\x89PNG")


def test_single_defect_localised() -> None:
    base = make_base()
    target = base.copy()
    cv2.rectangle(target, (350, 80), (470, 170), (20, 20, 220), -1)
    result = VisualDiffPipeline().run(base, target)
    assert len(result.boxes) == 1
    assert iou(result.boxes[0], (350, 80, 121, 91)) >= 0.7
    assert 0 < result.roi_pixels < H * W * 0.1


def test_noise_only_is_ignored() -> None:
    base = make_base()
    result = VisualDiffPipeline().run(base, add_noise(base, sigma=3.0))
    assert result.boxes == []
    assert result.pixels_filtered_pct == 100.0


def test_defect_survives_noise() -> None:
    base = make_base()
    target = base.copy()
    cv2.rectangle(target, (100, 300), (220, 390), (30, 200, 240), -1)
    result = VisualDiffPipeline().run(base, add_noise(target))
    assert len(result.boxes) == 1
    assert iou(result.boxes[0], (100, 300, 121, 91)) >= 0.7


def test_two_separate_defects_two_boxes() -> None:
    base = make_base()
    target = base.copy()
    cv2.rectangle(target, (350, 60), (410, 110), (20, 20, 220), -1)
    cv2.rectangle(target, (60, 380), (130, 440), (240, 60, 60), -1)
    result = VisualDiffPipeline().run(base, target)
    assert len(result.boxes) == 2


def test_boxes_sorted_by_area_desc() -> None:
    base = make_base()
    target = base.copy()
    cv2.rectangle(target, (350, 60), (380, 90), (20, 20, 220), -1)
    cv2.rectangle(target, (60, 380), (160, 450), (240, 60, 60), -1)
    boxes = VisualDiffPipeline().run(base, target).boxes
    assert len(boxes) == 2
    assert [b.area for b in boxes] == sorted((b.area for b in boxes), reverse=True)


def test_pixel_savings_math_known_case() -> None:
    base = np.zeros((100, 200, 3), dtype=np.uint8)
    target = base.copy()
    target[30:70, 60:140] = 255
    result = VisualDiffPipeline(padding=0, dilate_iterations=1, min_area=10).run(base, target)
    assert len(result.boxes) == 1
    expected_roi = result.boxes[0].area
    assert result.roi_pixels == expected_roi
    assert result.total_pixels == 20000
    assert result.pixels_filtered_pct == round(100 * (1 - expected_roi / 20000), 2)
    assert 80.0 < result.pixels_filtered_pct < 85.0


def test_overlay_is_png_of_target_size() -> None:
    base = make_base()
    target = base.copy()
    cv2.rectangle(target, (350, 80), (470, 170), (20, 20, 220), -1)
    result = VisualDiffPipeline().run(base, target)
    overlay = decode_image(result.overlay_png)
    assert overlay.shape == target.shape
    assert not np.array_equal(overlay, target)


def test_sensitivity_changes_detection_on_faint_defect() -> None:
    base = make_base()
    target = base.copy()
    patch = target[200:260, 300:380].astype(int) + 16
    target[200:260, 300:380] = np.clip(patch, 0, 255).astype(np.uint8)
    low = VisualDiffPipeline(sensitivity=0.1).run(base, target)
    high = VisualDiffPipeline(sensitivity=0.95).run(base, target)
    assert len(low.boxes) == 0
    assert len(high.boxes) >= 1


def test_mismatched_sizes_are_handled() -> None:
    base = make_base()
    target = cv2.resize(base, (W // 2, H // 2))
    result = VisualDiffPipeline().run(base, target)
    assert (result.image_width, result.image_height) == (W, H)
    assert decode_image(result.overlay_png).shape == base.shape


@pytest.mark.parametrize("kwargs", [{"sensitivity": -0.1}, {"sensitivity": 1.5}, {"min_area": -1}])
def test_invalid_parameters_raise(kwargs: dict[str, float]) -> None:
    with pytest.raises(ValueError):
        VisualDiffPipeline(**kwargs)  # type: ignore[arg-type]


def test_decode_image_rejects_garbage() -> None:
    with pytest.raises(ValueError):
        decode_image(b"definitely not an image")
    with pytest.raises(ValueError):
        decode_image(b"")


def test_encode_decode_roundtrip() -> None:
    img = make_base()
    assert np.array_equal(decode_image(encode_png(img)), img)


def test_crop_clamps_to_bounds() -> None:
    img = make_base()
    assert crop(img, BoundingBox(x=W - 20, y=H - 10, w=100, h=100)).shape[:2] == (10, 20)
    assert crop(img, BoundingBox(x=-5, y=-5, w=15, h=15)).shape[:2] == (10, 10)


def test_bounding_box_helpers() -> None:
    box = BoundingBox(x=1, y=2, w=3, h=4)
    assert box.area == 12
    assert box.to_dict() == {"x": 1, "y": 2, "w": 3, "h": 4, "area": 12}


def test_merge_boxes_overlapping() -> None:
    merged = merge_boxes([BoundingBox(0, 0, 10, 10), BoundingBox(5, 5, 10, 10)])
    assert merged == [BoundingBox(0, 0, 15, 15)]


def test_merge_boxes_disjoint_and_gap() -> None:
    a, b = BoundingBox(0, 0, 10, 10), BoundingBox(12, 0, 10, 10)
    assert sorted(merge_boxes([a, b]), key=lambda x: x.x) == [a, b]
    assert merge_boxes([a, b], gap=3) == [BoundingBox(0, 0, 22, 10)]


def test_merge_boxes_transitive_chain() -> None:
    chain = [BoundingBox(0, 0, 10, 10), BoundingBox(8, 0, 10, 10), BoundingBox(16, 0, 10, 10)]
    assert merge_boxes(chain) == [BoundingBox(0, 0, 26, 10)]


def test_merge_boxes_empty_and_pure() -> None:
    assert merge_boxes([]) == []
    boxes = [BoundingBox(0, 0, 10, 10), BoundingBox(5, 5, 10, 10)]
    merge_boxes(boxes)
    assert len(boxes) == 2


def test_generator_is_deterministic(tmp_path: Path) -> None:
    gen = load_generator()
    gen.generate_all(tmp_path / "a")
    gen.generate_all(tmp_path / "b")
    for name in ("pcb_board_target.png", "ui_layout_baseline.png"):
        assert (tmp_path / "a" / name).read_bytes() == (tmp_path / "b" / name).read_bytes()


@pytest.mark.parametrize("preset_id", ["pcb_board", "aerial_crop", "ui_layout"])
def test_generated_samples_detect_expected_defects(preset_id: str) -> None:
    presets = {p["id"]: p for p in json.loads((SAMPLES_DIR / "presets.json").read_text())}
    meta = presets[preset_id]
    assert set(meta) == {"id", "label", "domain_context", "expected_defects"}
    base = decode_image((SAMPLES_DIR / f"{preset_id}_baseline.png").read_bytes())
    target = decode_image((SAMPLES_DIR / f"{preset_id}_target.png").read_bytes())
    assert base.shape == target.shape == (640, 960, 3)
    result = VisualDiffPipeline().run(base, target)
    assert len(result.boxes) >= meta["expected_defects"]
    assert len(result.boxes) <= meta["expected_defects"] + 3
    assert result.pixels_filtered_pct > 80.0
