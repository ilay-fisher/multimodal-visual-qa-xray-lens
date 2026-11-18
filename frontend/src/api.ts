import { logError } from "./lib/log";
import type { InspectResponse, PresetOut, SseEvent, VlmBackend } from "./types";

const BASE = import.meta.env.VITE_API_BASE_URL ?? "";
const USE_MOCK = import.meta.env.VITE_USE_MOCK === "1";
const EVENTS = new Set(["status", "token", "result", "error"]);

/** Labels used when the presets endpoint is unreachable. */
export const FALLBACK_PRESETS: PresetOut[] = [
  { id: "pcb_board", label: "PCB Hardware Inspection", domain_context: "pcb" },
  { id: "aerial_crop", label: "Aerial Crop Monitoring", domain_context: "aerial" },
  { id: "ui_layout", label: "UI Regression Check", domain_context: "ui" },
];

async function ensureOk(res: Response): Promise<Response> {
  if (res.ok) return res;
  const detail = await res.text().catch(() => "");
  throw new Error(`HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
}

/** Fetches the preset list, falling back to built-in labels on failure. */
export async function getPresets(): Promise<PresetOut[]> {
  try {
    if (USE_MOCK) return (await import("./mocks")).mockPresets;
    const res = await ensureOk(await fetch(`${BASE}/api/presets`));
    return (await res.json()) as PresetOut[];
  } catch (err) {
    logError("getPresets failed, using fallback presets", err);
    return FALLBACK_PRESETS;
  }
}

/** Runs the CV pipeline. Form carries preset_id or baseline+target, plus sensitivity. */
export async function inspect(form: FormData, signal?: AbortSignal): Promise<InspectResponse> {
  try {
    if (USE_MOCK) return await (await import("./mocks")).mockInspect(form);
    const res = await ensureOk(await fetch(`${BASE}/api/inspect`, { method: "POST", body: form, signal }));
    return (await res.json()) as InspectResponse;
  } catch (err) {
    if (!signal?.aborted) logError("inspect failed", err);
    throw err;
  }
}

/**
 * Creates an incremental SSE parser. Feed it raw text chunks (which may split
 * events anywhere); it returns the complete typed events found so far.
 */
export function createSseParser(): (chunk: string) => SseEvent[] {
  let buffer = "";
  return (chunk) => {
    buffer += chunk.replace(/\r\n/g, "\n");
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    const out: SseEvent[] = [];
    for (const frame of frames) {
      let event = "message";
      const data: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trim());
      }
      if (!EVENTS.has(event) || data.length === 0) continue;
      try {
        out.push({ event, data: JSON.parse(data.join("\n")) } as SseEvent);
      } catch (err) {
        logError(`dropping malformed ${event} event`, err);
      }
    }
    return out;
  };
}

/** Streams the VLM diagnosis for a cropped ROI as typed SSE events. Abort via the signal. */
export async function* analyzeRoi(roi: Blob, domainContext: string, backend: VlmBackend, signal?: AbortSignal): AsyncGenerator<SseEvent> {
  if (USE_MOCK) {
    yield* (await import("./mocks")).mockAnalyzeRoi(domainContext, signal);
    return;
  }
  const form = new FormData();
  form.append("roi_image", roi, "roi.png");
  form.append("domain_context", domainContext);
  form.append("backend", backend);
  try {
    const res = await ensureOk(await fetch(`${BASE}/api/analyze-roi`, { method: "POST", body: form, signal }));
    if (!res.body) throw new Error("Response has no body");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parse = createSseParser();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield* parse(decoder.decode(value, { stream: true }));
    }
  } catch (err) {
    if (!signal?.aborted) logError("analyze-roi stream failed", err);
    throw err;
  }
}
