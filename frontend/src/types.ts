// Types mirroring docs/CONTRACTS.md sections 4 and 5.
export type Severity = "low" | "medium" | "high" | "critical";
export type VlmBackend = "demo" | "local" | "cloud";
export type ErrorCode = "rate_limited" | "budget_exceeded" | "vlm_error" | "invalid_output";

export interface DefectReport {
  defect_category: string;
  severity: Severity;
  confidence: number;
  visual_evidence: string;
  recommended_action: string;
}

export interface BoxOut { id: number; x: number; y: number; w: number; h: number; area: number; est_tokens: number }

export interface InspectResponse {
  preset_id: string | null;
  image_width: number;
  image_height: number;
  baseline_png_b64: string;
  target_png_b64: string;
  overlay_png_b64: string;
  boxes: BoxOut[];
  pixels_filtered_pct: number;
  full_frame_tokens: number;
  roi_tokens: number;
  estimated_token_savings_pct: number;
  cv_time_ms: number;
}

export interface PresetOut { id: string; label: string; domain_context: string }

export interface ResultData { report: DefectReport; vlm_time_ms: number; backend: string; roi_tokens: number; cached: boolean }

/** One parsed server-sent event from POST /api/analyze-roi. */
export type SseEvent =
  | { event: "status"; data: { stage: string; backend: string } }
  | { event: "token"; data: { text: string } }
  | { event: "result"; data: ResultData }
  | { event: "error"; data: { message: string; code: ErrorCode } };
