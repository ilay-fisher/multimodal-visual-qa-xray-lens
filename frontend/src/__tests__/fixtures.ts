import type { InspectResponse, PresetOut } from "../types";

const PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

export const inspectFixture: InspectResponse = {
  preset_id: "pcb_board",
  image_width: 960,
  image_height: 640,
  baseline_png_b64: PX,
  target_png_b64: PX,
  overlay_png_b64: PX,
  boxes: [
    { id: 0, x: 100, y: 80, w: 120, h: 90, area: 10800, est_tokens: 15 },
    { id: 1, x: 500, y: 300, w: 60, h: 40, area: 2400, est_tokens: 4 },
  ],
  pixels_filtered_pct: 97.8,
  full_frame_tokens: 820,
  roi_tokens: 19,
  estimated_token_savings_pct: 97.7,
  cv_time_ms: 12.4,
};

export const presetsFixture: PresetOut[] = [
  { id: "pcb_board", label: "PCB Hardware Inspection", domain_context: "pcb" },
  { id: "aerial_crop", label: "Aerial Crop Monitoring", domain_context: "aerial" },
  { id: "ui_layout", label: "UI Regression Check", domain_context: "ui" },
];
