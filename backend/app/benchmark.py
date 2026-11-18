"""Benchmark: full-frame VLM calls versus ROI-cropped calls on every sample preset.

Usage: python -m app.benchmark [--backend demo|local|cloud] [--sensitivity 0.5]
"""

import argparse
import asyncio
import json
import time
from dataclasses import dataclass
from pathlib import Path

from app.config import get_settings
from app.cv_pipeline import VisualDiffPipeline, crop, decode_image, encode_png
from app.logging_config import configure_logging
from app.vlm_client import VLMClient, estimate_image_tokens, get_vlm_client


@dataclass(frozen=True)
class Row:
    """Measurements for one preset: full-frame versus the sum over its ROI crops."""

    preset_id: str
    boxes: int
    full_bytes: int
    roi_bytes: int
    full_tokens: int
    roi_tokens: int
    full_ms: float
    roi_ms: float

    @staticmethod
    def _saved(full: float, roi: float) -> float:
        return round(100.0 * (1 - roi / full), 1) if full else 0.0

    @property
    def bytes_savings_pct(self) -> float:
        """Payload bytes saved by cropping, in percent."""
        return self._saved(self.full_bytes, self.roi_bytes)

    @property
    def tokens_savings_pct(self) -> float:
        """Estimated image tokens saved by cropping, in percent."""
        return self._saved(self.full_tokens, self.roi_tokens)

    @property
    def latency_savings_pct(self) -> float:
        """Measured VLM latency saved by cropping (negative when slower), in percent."""
        return self._saved(self.full_ms, self.roi_ms)


async def _timed_call(client: VLMClient, png: bytes, context: str) -> float:
    """Stream one VLM call to completion and return its wall time in milliseconds."""
    started = time.perf_counter()
    async for _ in client.stream_analyze(png, context):
        pass
    return (time.perf_counter() - started) * 1000


async def compute_rows(
    client: VLMClient, sensitivity: float = 0.5, samples_dir: Path | None = None
) -> list[Row]:
    """Measure every preset; pure of side effects apart from the VLM calls."""
    directory = samples_dir or get_settings().samples_dir
    presets = json.loads((directory / "presets.json").read_text(encoding="utf-8"))
    pipeline = VisualDiffPipeline(sensitivity=sensitivity)
    rows = []
    for preset in presets:
        pid, context = preset["id"], preset["domain_context"]
        baseline = decode_image((directory / f"{pid}_baseline.png").read_bytes())
        target = decode_image((directory / f"{pid}_target.png").read_bytes())
        boxes = pipeline.run(baseline, target).boxes
        full_png = encode_png(target)
        crops = [encode_png(crop(target, box)) for box in boxes]
        full_ms = await _timed_call(client, full_png, context)
        roi_ms = sum([await _timed_call(client, png, context) for png in crops])
        height, width = target.shape[:2]
        rows.append(
            Row(
                pid,
                len(boxes),
                len(full_png),
                sum(len(png) for png in crops),
                estimate_image_tokens(width, height),
                sum(estimate_image_tokens(b.w, b.h) for b in boxes),
                full_ms,
                roi_ms,
            )
        )
    return rows


# (header, Row attribute, cell format)
COLUMNS = [
    ("preset", "preset_id", "{}"),
    ("boxes", "boxes", "{}"),
    ("bytes full", "full_bytes", "{:,}"),
    ("bytes roi", "roi_bytes", "{:,}"),
    ("saved", "bytes_savings_pct", "{:.1f}%"),
    ("tokens full", "full_tokens", "{:,}"),
    ("tokens roi", "roi_tokens", "{:,}"),
    ("saved", "tokens_savings_pct", "{:.1f}%"),
    ("ms full", "full_ms", "{:.0f}"),
    ("ms roi", "roi_ms", "{:.0f}"),
    ("saved", "latency_savings_pct", "{:.1f}%"),
]


def format_table(rows: list[Row]) -> str:
    """Render rows plus a TOTAL line as an aligned text table."""
    sums = {
        f: sum(getattr(r, f) for r in rows) for f in Row.__dataclass_fields__ if f != "preset_id"
    }
    lines = [[h for h, _, _ in COLUMNS]]
    for r in [*rows, Row("TOTAL", **sums)]:
        lines.append([fmt.format(getattr(r, attr)) for _, attr, fmt in COLUMNS])
    widths = [max(len(line[k]) for line in lines) for k in range(len(COLUMNS))]
    text = [
        "  ".join(
            c.ljust(w) if k == 0 else c.rjust(w)
            for k, (c, w) in enumerate(zip(line, widths, strict=True))
        )
        for line in lines
    ]
    rule = "  ".join("-" * w for w in widths)
    return "\n".join([text[0], rule, *text[1:-1], rule, text[-1]])


def main() -> None:
    """CLI entry point: run the benchmark and print the final table."""
    parser = argparse.ArgumentParser(description="Full-frame vs ROI-cropped VLM benchmark")
    parser.add_argument("--backend", choices=["demo", "local", "cloud"], default="demo")
    parser.add_argument("--sensitivity", type=float, default=0.5)
    args = parser.parse_args()
    settings = get_settings()
    configure_logging("WARNING", settings.log_format)
    rows = asyncio.run(compute_rows(get_vlm_client(args.backend, settings), args.sensitivity))
    print(f"backend={args.backend} sensitivity={args.sensitivity}")  # noqa: T201
    print(format_table(rows))  # noqa: T201


if __name__ == "__main__":
    main()
