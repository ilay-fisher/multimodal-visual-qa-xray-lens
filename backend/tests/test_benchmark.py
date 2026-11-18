"""Benchmark tests: row computation and table rendering."""

import asyncio

import pytest

from app.benchmark import Row, compute_rows, format_table
from app.vlm_client import DemoVLMClient

PRESETS = ["pcb_board", "aerial_crop", "ui_layout"]


@pytest.fixture(scope="module")
def rows() -> list[Row]:
    return asyncio.run(compute_rows(DemoVLMClient(), sensitivity=0.5))


def test_one_row_per_preset(rows: list[Row]) -> None:
    assert [r.preset_id for r in rows] == PRESETS
    assert all(r.boxes > 0 for r in rows)


def test_savings_positive_for_every_sample(rows: list[Row]) -> None:
    for r in rows:
        assert r.roi_bytes < r.full_bytes and r.bytes_savings_pct > 0
        assert r.roi_tokens < r.full_tokens and r.tokens_savings_pct > 0
        assert r.full_ms >= 0 and r.roi_ms >= 0


def test_savings_math() -> None:
    row = Row("x", 1, 1000, 250, 100, 25, 10.0, 5.0)
    assert row.bytes_savings_pct == 75.0 and row.tokens_savings_pct == 75.0
    assert row.latency_savings_pct == 50.0


def test_format_table_has_rows_and_totals(rows: list[Row]) -> None:
    lines = format_table(rows).splitlines()
    text = "\n".join(lines)
    for preset in PRESETS:
        assert preset in text
    assert "TOTAL" in lines[-1] and "%" in lines[-1]
    widths = {len(ln) for ln in lines if ln and not set(ln) <= {"-", " "}}
    assert len(widths) == 1
