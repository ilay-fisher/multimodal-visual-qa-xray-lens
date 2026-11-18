"""Pydantic models shared by the VLM client and the HTTP API."""

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class Severity(StrEnum):
    """Defect severity levels."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class DefectReport(BaseModel):
    """Structured verdict a VLM must return for one region of interest."""

    model_config = ConfigDict(extra="forbid")

    defect_category: str = Field(min_length=1, max_length=64)
    severity: Severity
    confidence: float = Field(ge=0.0, le=1.0)
    visual_evidence: str = Field(min_length=1, max_length=500)
    recommended_action: str = Field(min_length=1, max_length=300)


class BoxOut(BaseModel):
    """One detected region with its estimated VLM token cost."""

    id: int
    x: int
    y: int
    w: int
    h: int
    area: int
    est_tokens: int


class InspectResponse(BaseModel):
    """Response of the inspect endpoint."""

    preset_id: str | None
    image_width: int
    image_height: int
    baseline_png_b64: str
    target_png_b64: str
    overlay_png_b64: str
    boxes: list[BoxOut]
    pixels_filtered_pct: float
    full_frame_tokens: int
    roi_tokens: int
    estimated_token_savings_pct: float
    cv_time_ms: float


class PresetOut(BaseModel):
    """A sample preset exposed to the UI."""

    id: str
    label: str
    domain_context: str
