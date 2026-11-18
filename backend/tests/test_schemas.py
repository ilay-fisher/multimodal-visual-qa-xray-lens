"""Tests for response/report schemas and Settings."""

import pytest
from pydantic import SecretStr, ValidationError

from app.config import Settings, get_settings
from app.schemas import BoxOut, DefectReport, InspectResponse, PresetOut, Severity

VALID = {
    "defect_category": "missing_component",
    "severity": "high",
    "confidence": 0.9,
    "visual_evidence": "Pads at U3 are empty.",
    "recommended_action": "Reflow and place the part.",
}


def test_valid_report_roundtrip() -> None:
    report = DefectReport(**VALID)
    assert report.severity is Severity.HIGH
    assert DefectReport.model_validate_json(report.model_dump_json()) == report


@pytest.mark.parametrize(
    "override",
    [
        {"severity": "catastrophic"},
        {"confidence": 1.01},
        {"confidence": -0.1},
        {"defect_category": ""},
        {"visual_evidence": ""},
        {"recommended_action": ""},
        {"defect_category": "x" * 65},
        {"visual_evidence": "x" * 501},
        {"recommended_action": "x" * 301},
        {"extra_field": "nope"},
    ],
)
def test_report_rejects_bad_values(override: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        DefectReport(**{**VALID, **override})


def test_report_missing_field_rejected() -> None:
    data = dict(VALID)
    del data["severity"]
    with pytest.raises(ValidationError):
        DefectReport(**data)


def test_response_models_construct() -> None:
    box = BoxOut(id=0, x=1, y=2, w=3, h=4, area=12, est_tokens=1)
    resp = InspectResponse(
        preset_id=None,
        image_width=10,
        image_height=10,
        baseline_png_b64="a",
        target_png_b64="b",
        overlay_png_b64="c",
        boxes=[box],
        pixels_filtered_pct=99.0,
        full_frame_tokens=1,
        roi_tokens=1,
        estimated_token_savings_pct=0.0,
        cv_time_ms=1.5,
    )
    assert resp.boxes[0].area == 12
    assert PresetOut(id="a", label="A", domain_context="pcb").id == "a"


def test_settings_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in ("VLM_MODE", "CORS_ORIGINS", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL"):
        monkeypatch.delenv(key, raising=False)
    s = Settings(_env_file=None)
    assert s.vlm_mode == "demo"
    assert s.local_vlm_base_url == "http://localhost:8000/v1"
    assert s.anthropic_model == "claude-haiku-5-5"
    assert s.openai_model == "gpt-4o-mini"
    assert s.vlm_timeout_s == 45
    assert s.cloud_daily_request_cap == 200
    assert s.rate_limit_per_minute == 30
    assert s.cors_origins == ["http://localhost:5173"]
    assert s.anthropic_api_key is None
    assert s.samples_dir.name == "samples"


def test_settings_reads_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VLM_MODE", "cloud")
    monkeypatch.setenv("CLOUD_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("VLM_TIMEOUT_S", "10")
    monkeypatch.setenv("CORS_ORIGINS", "http://a.test, http://b.test ,")
    s = Settings(_env_file=None)
    assert s.vlm_mode == "cloud"
    assert s.cloud_provider == "openai"
    assert isinstance(s.openai_api_key, SecretStr)
    assert s.openai_api_key.get_secret_value() == "sk-test"
    assert "sk-test" not in repr(s)
    assert s.vlm_timeout_s == 10
    assert s.cors_origins == ["http://a.test", "http://b.test"]


def test_get_settings_is_cached() -> None:
    assert get_settings() is get_settings()
