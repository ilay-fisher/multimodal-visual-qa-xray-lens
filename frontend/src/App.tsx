import { useCallback, useEffect, useRef, useState } from "react";
import { analyzeRoi, getPresets, inspect } from "./api";
import { DiagnosisPanel, type Diagnosis } from "./components/DiagnosisPanel";
import { Toolbar } from "./components/Toolbar";
import { XRaySlider } from "./components/XRaySlider";
import { cropPairToPng } from "./lib/crop";
import { logError } from "./lib/log";
import type { BoxOut, InspectResponse, PresetOut, VlmBackend } from "./types";

const IDLE: Diagnosis = { status: "idle", raw: "" };
const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

/** Application shell: owns inspection, selection and diagnosis streaming state. */
export default function App() {
  const [presets, setPresets] = useState<PresetOut[]>([]);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [upload, setUpload] = useState<{ baseline: File; target: File } | null>(null);
  const [sensitivity, setSensitivity] = useState(0.5);
  const [backend, setBackend] = useState<VlmBackend>("demo");
  const [data, setData] = useState<InspectResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [diagnosis, setDiagnosis] = useState<Diagnosis>(IDLE);
  const stream = useRef<AbortController | null>(null);

  useEffect(() => {
    getPresets().then((list) => {
      setPresets(list);
      setPresetId((cur) => cur ?? list[0]?.id ?? null);
    });
  }, []);

  // Debounced re-inspect whenever the source or sensitivity changes.
  useEffect(() => {
    if (!presetId && !upload) return;
    const ctl = new AbortController();
    const timer = setTimeout(async () => {
      const form = new FormData();
      if (upload) { form.append("baseline", upload.baseline); form.append("target", upload.target); }
      else if (presetId) form.append("preset_id", presetId);
      form.append("sensitivity", String(sensitivity));
      setLoading(true);
      try {
        const res = await inspect(form, ctl.signal);
        stream.current?.abort();
        setData(res);
        setSelectedId(null);
        setDiagnosis(IDLE);
        setFailure(null);
      } catch (err) {
        if (!isAbort(err)) setFailure(err instanceof Error ? err.message : "Inspection failed");
      } finally {
        if (!ctl.signal.aborted) setLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [presetId, upload, sensitivity]);

  const onSelectBox = useCallback(
    async (box: BoxOut) => {
      if (!data) return;
      stream.current?.abort();
      const ctl = new AbortController();
      stream.current = ctl;
      setSelectedId(box.id);
      setDiagnosis({ status: "streaming", raw: "" });
      const context = presets.find((p) => p.id === presetId)?.domain_context ?? "generic";
      try {
        const png = (b64: string) => `data:image/png;base64,${b64}`;
        const sent = await cropPairToPng(png(data.baseline_png_b64), png(data.target_png_b64), box);
        setDiagnosis((d) => ({ ...d, sent }));
        for await (const ev of analyzeRoi(sent.blob, context, backend, ctl.signal)) {
          if (ev.event === "token") setDiagnosis((d) => ({ ...d, raw: d.raw + ev.data.text }));
          else if (ev.event === "result") setDiagnosis((d) => ({ ...d, status: "done", result: ev.data }));
          else if (ev.event === "error") setDiagnosis((d) => ({ ...d, status: "error", error: ev.data }));
        }
      } catch (err) {
        if (isAbort(err)) return;
        logError("diagnosis failed", err);
        setDiagnosis({ status: "error", raw: "", error: { code: "network", message: "Could not reach the analysis service. Try again." } });
      }
    },
    [data, presets, presetId, backend],
  );

  return (
    <div className="app">
      <header className="top">
        <h1><span className="mark" aria-hidden="true" />X-Ray Lens</h1>
        <p>Find what changed with computer vision, then ask a vision model only about those pixels.</p>
      </header>
      <Toolbar
        presets={presets}
        presetId={presetId}
        sensitivity={sensitivity}
        backend={backend}
        onPresetChange={(id) => { setUpload(null); setPresetId(id); }}
        onUpload={(baseline, target) => { setPresetId(null); setUpload({ baseline, target }); }}
        onSensitivityChange={setSensitivity}
        onBackendChange={setBackend}
      />
      <main className="workspace">
        <div className="view" aria-busy={loading}>
          {data ? (
            <XRaySlider data={data} selectedId={selectedId} onSelectBox={onSelectBox} />
          ) : (
            <div className="placeholder">{failure ?? "Loading inspection"}</div>
          )}
          {loading && data && <span className="scan">Re-scanning</span>}
          {failure && data && <p className="error" role="alert">{failure}</p>}
          {data && data.boxes.length === 0 && <p className="hint">No differences found. Raise the sensitivity to catch subtler changes.</p>}
        </div>
        <DiagnosisPanel
          diagnosis={diagnosis}
          telemetry={{ cvTimeMs: data?.cv_time_ms ?? 0, pixelsFilteredPct: data?.pixels_filtered_pct ?? 0, tokenSavingsPct: data?.estimated_token_savings_pct ?? 0 }}
        />
      </main>
    </div>
  );
}
