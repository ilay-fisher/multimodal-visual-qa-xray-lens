"""Wave 3: baseline|target composites, pair-aware prompt and demo categories, benchmark footer."""

import asyncio
import logging
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import main
from app.benchmark import compute_rows, format_table
from app.cv_pipeline import BoundingBox, VisualDiffPipeline, compose_pair, decode_image, encode_png
from app.schemas import DefectReport
from app.vlm_client import DemoVLMClient, build_prompt, parse_report

SAMPLES = Path(__file__).resolve().parent.parent / "samples"
CONTEXTS = {"pcb_board": "pcb", "aerial_crop": "aerial", "ui_layout": "ui"}


def load(preset: str) -> tuple[np.ndarray, np.ndarray]:
    base = decode_image((SAMPLES / f"{preset}_baseline.png").read_bytes())
    target = decode_image((SAMPLES / f"{preset}_target.png").read_bytes())
    return base, target


def test_compose_pair_layout() -> None:
    rng = np.random.default_rng(0)
    base = rng.integers(0, 255, (50, 80, 3), dtype=np.uint8)
    target = rng.integers(0, 255, (50, 80, 3), dtype=np.uint8)
    out = compose_pair(base, target, BoundingBox(10, 5, 20, 15))
    assert out.shape == (15, 2 * 20 + 8, 3)
    assert (out[:, 20:28] == 128).all()
    assert np.array_equal(out[:, :20], base[5:20, 10:30])
    assert np.array_equal(out[:, 28:], target[5:20, 10:30])


def test_compose_pair_clamps_to_image() -> None:
    img = np.zeros((20, 20, 3), dtype=np.uint8)
    out = compose_pair(img, img, BoundingBox(15, 15, 30, 30))
    assert out.shape == (5, 2 * 5 + 8, 3)


def test_prompt_explains_pair_layout() -> None:
    prompt = build_prompt("pcb").lower()
    assert "left" in prompt and "baseline" in prompt and "right" in prompt and "target" in prompt


CASES = [
    ("pcb_board", 0, "missing_component"),
    ("pcb_board", 1, "solder_bridge"),
    ("aerial_crop", 0, "irrigation_stress"),
    ("ui_layout", 0, "clipped_element"),
]


async def demo_report(preset: str, index: int) -> tuple[DefectReport, bytes, str]:
    base, target = load(preset)
    boxes = VisualDiffPipeline().run(base, target).boxes
    if preset == "pcb_board":  # R5 is the right-most box, U2 the left-most
        boxes = sorted(boxes, key=lambda b: b.x, reverse=True)
    png = encode_png(compose_pair(base, target, boxes[index]))
    ctx = CONTEXTS[preset]
    raw = "".join([c async for c in DemoVLMClient().stream_analyze(png, ctx)])
    return parse_report(raw), png, ctx


@pytest.mark.asyncio
@pytest.mark.parametrize(("preset", "index", "category"), CASES)
async def test_demo_category_on_sample_pairs(preset: str, index: int, category: str) -> None:
    report, png, ctx = await demo_report(preset, index)
    assert report.defect_category == category
    assert not any(ch.isdigit() for ch in report.visual_evidence)
    again = "".join([c async for c in DemoVLMClient().stream_analyze(png, ctx)])
    assert parse_report(again) == report


def test_benchmark_uses_composites_and_flags_simulated_latency() -> None:
    rows = asyncio.run(compute_rows(DemoVLMClient(), sensitivity=0.5))
    assert all(r.roi_bytes < r.full_bytes for r in rows)
    table = format_table(rows, simulated=True)
    assert "simulated" in table.splitlines()[-1].lower()
    assert "simulated" not in format_table(rows).lower()


def test_unhandled_error_logs_one_error_line(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    main.app.state.presets = None
    broken = TestClient(main.app, raise_server_exceptions=False)
    with caplog.at_level(logging.INFO, logger="app.main"):
        res = broken.get("/api/presets")
    assert res.status_code == 500
    errors = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert len(errors) == 1
    assert "/api/presets" in errors[0].getMessage() and "500" in errors[0].getMessage()
