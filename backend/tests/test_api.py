"""HTTP API tests: health, presets, inspect, SSE analyze-roi, cost guards, request ids."""

import base64
import json
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from typing import Any

import cv2
import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import main
from app.config import Settings
from app.schemas import DefectReport, InspectResponse

SAMPLES = Path(__file__).resolve().parent.parent / "samples"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
PRESETS = ["pcb_board", "aerial_crop", "ui_layout"]
GOOD_JSON = json.dumps(
    {
        "defect_category": "solder_bridge",
        "severity": "high",
        "confidence": 0.9,
        "visual_evidence": "Pads joined.",
        "recommended_action": "Rework.",
    }
)


def sample(name: str) -> bytes:
    return (SAMPLES / name).read_bytes()


def png(seed: int = 0, size: int = 32) -> bytes:
    rng = np.random.default_rng(seed)
    ok, buf = cv2.imencode(".png", rng.integers(0, 255, (size, size, 3), dtype=np.uint8))
    assert ok
    return bytes(buf.tobytes())


def parse_sse(text: str) -> list[tuple[str, dict[str, Any]]]:
    events = []
    for frame in text.strip().split("\n\n"):
        lines = frame.split("\n")
        name = next(ln[6:].strip() for ln in lines if ln.startswith("event:"))
        data = next(ln[5:].strip() for ln in lines if ln.startswith("data:"))
        events.append((name, json.loads(data)))
    return events


def analyze(
    client: TestClient, image: bytes, context: str = "pcb", backend: str | None = None
) -> httpx.Response:
    data = {"domain_context": context}
    if backend:
        data["backend"] = backend
    return client.post("/api/analyze-roi", files={"roi_image": ("roi.png", image)}, data=data)


class FakeClient:
    name = "cloud:fake"
    calls = 0

    def stream_analyze(self, image_png: bytes, domain_context: str) -> AsyncIterator[str]:
        FakeClient.calls += 1

        async def gen() -> AsyncIterator[str]:
            yield GOOD_JSON

        return gen()


@pytest.fixture
def cloud(monkeypatch: pytest.MonkeyPatch, make_settings: type[Settings]) -> Callable[..., None]:
    FakeClient.calls = 0
    monkeypatch.setattr(main, "get_vlm_client", lambda mode, settings: FakeClient())

    def configure(**overrides: Any) -> None:
        monkeypatch.setattr(main, "settings", make_settings(vlm_mode="cloud", **overrides))

    return configure


def test_health(client: TestClient) -> None:
    body = client.get("/api/health").json()
    assert body["status"] == "ok" and body["vlm_mode"] == "demo" and body["version"]


def test_presets(client: TestClient) -> None:
    items = client.get("/api/presets").json()
    assert [p["id"] for p in items] == PRESETS
    assert set(items[0]) == {"id", "label", "domain_context"}


@pytest.mark.parametrize("preset", PRESETS)
def test_inspect_preset(client: TestClient, preset: str) -> None:
    res = client.post("/api/inspect", data={"preset_id": preset})
    assert res.status_code == 200
    body = InspectResponse.model_validate(res.json())
    assert body.preset_id == preset and body.boxes
    assert [b.id for b in body.boxes] == list(range(1, len(body.boxes) + 1))
    assert body.roi_tokens == sum(b.est_tokens for b in body.boxes)
    assert body.estimated_token_savings_pct > 0 and body.cv_time_ms > 0
    for field in (body.baseline_png_b64, body.target_png_b64, body.overlay_png_b64):
        assert base64.b64decode(field).startswith(PNG_MAGIC)


def test_inspect_uploads_identical_has_no_boxes(client: TestClient) -> None:
    data = sample("pcb_board_baseline.png")
    files = {"baseline": ("a.png", data), "target": ("b.png", data)}
    body = client.post("/api/inspect", files=files).json()
    assert body["boxes"] == [] and body["estimated_token_savings_pct"] == 100.0
    assert body["roi_tokens"] == 0 and body["preset_id"] is None


def test_inspect_uploads_detect_changes(client: TestClient) -> None:
    files = {
        "baseline": ("a.png", sample("ui_layout_baseline.png")),
        "target": ("b.png", sample("ui_layout_target.png")),
    }
    res = client.post("/api/inspect", files=files, data={"sensitivity": "0.5", "min_area": "150"})
    assert res.status_code == 200 and res.json()["boxes"]


@pytest.mark.parametrize(
    "kwargs",
    [
        {"data": {}},
        {"data": {"preset_id": "nope"}},
        {"data": {"preset_id": "pcb_board", "sensitivity": "1.5"}},
        {"data": {"preset_id": "pcb_board", "min_area": "-1"}},
        {"files": {"baseline": ("a.png", b"junk"), "target": ("b.png", b"junk")}},
        {"files": {"baseline": ("a.png", png())}},
    ],
)
def test_inspect_bad_input(client: TestClient, kwargs: dict[str, Any]) -> None:
    assert client.post("/api/inspect", **kwargs).status_code == 400


def test_inspect_oversize(client: TestClient) -> None:
    big = b"\0" * (8 * 1024 * 1024 + 1)
    files = {"baseline": ("a.png", big), "target": ("b.png", png())}
    assert client.post("/api/inspect", files=files).status_code == 413


def test_analyze_demo_stream(client: TestClient) -> None:
    res = analyze(client, png(1))
    assert res.headers["content-type"].startswith("text/event-stream")
    assert res.headers["cache-control"] == "no-cache"
    assert res.headers["x-accel-buffering"] == "no"
    events = parse_sse(res.text)
    names = [n for n, _ in events]
    assert names[0] == "status" and names[-1] == "result" and names.count("token") >= 1
    assert events[0][1] == {"stage": "inference", "backend": "demo"}
    result = events[-1][1]
    report = DefectReport.model_validate(result["report"])
    assert result["backend"] == "demo" and result["cached"] is False
    assert result["roi_tokens"] >= 1 and result["vlm_time_ms"] >= 0
    streamed = "".join(d["text"] for n, d in events if n == "token")
    assert DefectReport.model_validate_json(streamed) == report


def test_analyze_cache_hit(client: TestClient) -> None:
    first = parse_sse(analyze(client, png(2)).text)[-1][1]
    second = parse_sse(analyze(client, png(2)).text)
    assert second[-1][0] == "result" and second[-1][1]["cached"] is True
    assert second[-1][1]["report"] == first["report"]
    other = parse_sse(analyze(client, png(2), context="ui").text)[-1][1]
    assert other["cached"] is False


def test_analyze_validation(client: TestClient) -> None:
    assert analyze(client, png(), context="x" * 201).status_code == 400
    assert analyze(client, b"", context="pcb").status_code == 400
    assert analyze(client, png(), backend="bogus").status_code == 400


def test_analyze_invalid_output(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    class Bad(FakeClient):
        def stream_analyze(self, image_png: bytes, domain_context: str) -> AsyncIterator[str]:
            async def gen() -> AsyncIterator[str]:
                yield "not json at all"

            return gen()

    monkeypatch.setattr(main, "get_vlm_client", lambda mode, settings: Bad())
    events = parse_sse(analyze(client, png(3)).text)
    assert events[-1][0] == "error" and events[-1][1]["code"] == "invalid_output"


def test_analyze_vlm_error_hides_details(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def boom(mode: str, settings: Settings) -> Any:
        raise main.VLMError("secret-key-sk-123 leaked")

    monkeypatch.setattr(main, "get_vlm_client", boom)
    events = parse_sse(analyze(client, png(4)).text)
    assert events[-1][0] == "error" and events[-1][1]["code"] == "vlm_error"
    assert "secret" not in events[-1][1]["message"]


def test_rate_limit_emits_sse_error(client: TestClient, cloud: Callable[..., None]) -> None:
    cloud(rate_limit_per_minute=2, cloud_daily_request_cap=100)
    for seed in (10, 11):
        assert parse_sse(analyze(client, png(seed), backend="cloud").text)[-1][0] == "result"
    last = parse_sse(analyze(client, png(12), backend="cloud").text)[-1]
    assert last[0] == "error" and last[1]["code"] == "rate_limited"
    assert FakeClient.calls == 2


def test_daily_cap_emits_sse_error(client: TestClient, cloud: Callable[..., None]) -> None:
    cloud(rate_limit_per_minute=100, cloud_daily_request_cap=1)
    assert parse_sse(analyze(client, png(20), backend="cloud").text)[-1][0] == "result"
    last = parse_sse(analyze(client, png(21), backend="cloud").text)[-1]
    assert last[0] == "error" and last[1]["code"] == "budget_exceeded"
    # Cached replays do not consume budget.
    assert parse_sse(analyze(client, png(20), backend="cloud").text)[-1][1]["cached"] is True


def test_demo_is_not_rate_limited(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    limited = main.settings.model_copy(update={"rate_limit_per_minute": 1})
    monkeypatch.setattr(main, "settings", limited)
    for seed in (30, 31, 32):
        assert parse_sse(analyze(client, png(seed)).text)[-1][0] == "result"


def test_request_id_echo_and_generation(client: TestClient) -> None:
    echoed = client.get("/api/health", headers={"X-Request-ID": "abc123"})
    assert echoed.headers["x-request-id"] == "abc123"
    assert len(client.get("/api/health").headers["x-request-id"]) == 32


def test_access_log_line(client: TestClient, caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level("INFO", logger="app.main"):
        client.get("/api/health")
    assert any("/api/health" in r.getMessage() and "200" in r.getMessage() for r in caplog.records)


def test_cors_header(client: TestClient) -> None:
    res = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
    assert res.headers["access-control-allow-origin"] == "http://localhost:5173"
