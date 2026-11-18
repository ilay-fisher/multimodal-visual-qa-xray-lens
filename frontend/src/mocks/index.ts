// Mock backend used when VITE_USE_MOCK=1. Generates placeholder boards on a canvas.
import type { BoxOut, DefectReport, InspectResponse, PresetOut, SseEvent } from "../types";

const W = 960;
const H = 640;
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

export const mockPresets: PresetOut[] = [
  { id: "pcb_board", label: "PCB Hardware Inspection", domain_context: "pcb" },
  { id: "aerial_crop", label: "Aerial Crop Monitoring", domain_context: "aerial" },
  { id: "ui_layout", label: "UI Regression Check", domain_context: "ui" },
];

const RAW_BOXES = [
  { x: 610, y: 150, w: 150, h: 110 },
  { x: 250, y: 380, w: 190, h: 80 },
  { x: 120, y: 90, w: 70, h: 60 },
];

function board(withDefects: boolean, heat: boolean): string {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  if (!g) return "";
  g.fillStyle = "#12382b";
  g.fillRect(0, 0, W, H);
  g.strokeStyle = "#c9a24a";
  g.lineWidth = 3;
  for (let i = 0; i < 14; i++) {
    g.beginPath();
    g.moveTo(40, 40 + i * 42);
    g.lineTo(300 + (i % 4) * 120, 40 + i * 42);
    g.lineTo(380 + (i % 5) * 110, 80 + i * 40);
    g.stroke();
  }
  g.fillStyle = "#1d1f22";
  g.fillRect(420, 220, 160, 120);
  g.fillStyle = "#8a8f96";
  for (let i = 0; i < 8; i++) g.fillRect(430 + i * 19, 205, 8, 14);
  [[130, 100], [700, 480], [820, 120], [180, 520]].forEach(([x, y]) => {
    g.fillStyle = "#2b2f36";
    g.fillRect(x, y, 56, 34);
    g.fillStyle = "#d8d8d8";
    g.fillRect(x - 4, y + 4, 6, 26);
    g.fillRect(x + 54, y + 4, 6, 26);
  });
  if (withDefects) {
    g.fillStyle = "#c9ccd1";
    g.beginPath();
    g.ellipse(685, 205, 60, 22, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#12382b";
    g.fillRect(120, 90, 70, 60);
    g.fillStyle = "#9c3b2f";
    g.fillRect(300, 400, 90, 40);
  }
  if (heat) {
    g.fillStyle = "rgba(8,10,14,0.55)";
    g.fillRect(0, 0, W, H);
    RAW_BOXES.forEach((b) => {
      const grad = g.createRadialGradient(b.x + b.w / 2, b.y + b.h / 2, 4, b.x + b.w / 2, b.y + b.h / 2, b.w * 0.8);
      grad.addColorStop(0, "rgba(255,240,120,0.95)");
      grad.addColorStop(0.45, "rgba(255,110,30,0.8)");
      grad.addColorStop(1, "rgba(255,40,20,0)");
      g.fillStyle = grad;
      g.fillRect(b.x - 60, b.y - 60, b.w + 120, b.h + 120);
      g.strokeStyle = "#ffd24a";
      g.lineWidth = 2;
      g.strokeRect(b.x, b.y, b.w, b.h);
    });
  }
  return c.toDataURL("image/png").split(",")[1];
}

/** Returns a realistic InspectResponse after a short simulated CV delay. */
export async function mockInspect(form: FormData): Promise<InspectResponse> {
  const sensitivity = Number(form.get("sensitivity") ?? 0.5);
  await sleep(250);
  const count = sensitivity < 0.2 ? 1 : sensitivity < 0.5 ? 2 : 3;
  const boxes: BoxOut[] = RAW_BOXES.slice(0, count).map((b, id) => ({
    ...b,
    id,
    area: b.w * b.h,
    est_tokens: Math.ceil((b.w * b.h) / 750),
  }));
  const roiPx = boxes.reduce((s, b) => s + b.area, 0);
  const roiTokens = boxes.reduce((s, b) => s + b.est_tokens, 0);
  const full = Math.ceil((W * H) / 750);
  return {
    preset_id: (form.get("preset_id") as string | null) ?? null,
    image_width: W,
    image_height: H,
    baseline_png_b64: board(false, false),
    target_png_b64: board(true, false),
    overlay_png_b64: board(true, true),
    boxes,
    pixels_filtered_pct: Math.round((1 - roiPx / (W * H)) * 10000) / 100,
    full_frame_tokens: full,
    roi_tokens: roiTokens,
    estimated_token_savings_pct: Math.round((1 - roiTokens / full) * 10000) / 100,
    cv_time_ms: 11.8,
  };
}

const REPORT: DefectReport = {
  defect_category: "missing_component",
  severity: "high",
  confidence: 0.87,
  visual_evidence: "Pads are exposed where an SMD part should sit, with no solder residue on the lands.",
  recommended_action: "Route the board to rework, place the component and re-inspect.",
};

/** Simulates the SSE stream: status, a few token chunks, then a result. */
export async function* mockAnalyzeRoi(_ctx: string, signal?: AbortSignal): AsyncGenerator<SseEvent> {
  yield { event: "status", data: { stage: "inference", backend: "demo" } };
  const json = JSON.stringify(REPORT, null, 1);
  for (let i = 0; i < json.length; i += 6) {
    await sleep(35, signal);
    yield { event: "token", data: { text: json.slice(i, i + 6) } };
  }
  yield { event: "result", data: { report: REPORT, vlm_time_ms: 640, backend: "demo", roi_tokens: 15, cached: false } };
}
