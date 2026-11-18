import type { ErrorCode, ResultData } from "../types";

export interface Diagnosis {
  status: "idle" | "streaming" | "done" | "error";
  /** Concatenated raw token text received so far. */
  raw: string;
  result?: ResultData;
  error?: { message: string; code: ErrorCode | "network" };
}

export interface Telemetry {
  cvTimeMs: number;
  pixelsFilteredPct: number;
  tokenSavingsPct: number;
}

/** Streaming diagnosis card plus the four-cell telemetry bar. */
export function DiagnosisPanel({ diagnosis, telemetry }: { diagnosis: Diagnosis; telemetry: Telemetry }) {
  const { status, result } = diagnosis;
  const report = result?.report;
  const cells: [string, string][] = [
    ["CV preprocess time", `${telemetry.cvTimeMs.toFixed(1)} ms`],
    ["Pixels filtered out", `${telemetry.pixelsFilteredPct.toFixed(1)}%`],
    ["Estimated token savings", `${telemetry.tokenSavingsPct.toFixed(1)}%`],
    ["VLM inference time", result ? `${Math.round(result.vlm_time_ms)} ms` : "--"],
  ];

  return (
    <section className="panel diagnosis" aria-live="polite" aria-busy={status === "streaming"}>
      <header className="panel-head">
        <h2>Diagnosis</h2>
        {result && <span className="chip">{result.backend}</span>}
        {result?.cached && <span className="chip chip-cached">cached</span>}
      </header>

      {status === "idle" && <p className="hint">Select a flagged region on the image to send only that crop to the vision model.</p>}

      {status === "streaming" && (
        <pre className="raw" aria-label="Raw model output">
          {diagnosis.raw || "Waiting for first token"}
          <span className="caret" aria-hidden="true" />
        </pre>
      )}

      {status === "error" && (
        <div role="alert" className="error">
          <strong>{diagnosis.error?.code === "rate_limited" ? "Rate limited" : "Analysis failed"}</strong>
          <p>{diagnosis.error?.message}</p>
        </div>
      )}

      {report && (
        <div className="report">
          <div className="report-top">
            <h3>{report.defect_category}</h3>
            <span className="badge" data-severity={report.severity}>
              {report.severity}
            </span>
          </div>
          <div className="conf">
            <span>Confidence</span>
            <div
              className="bar"
              role="progressbar"
              aria-label="Confidence"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(report.confidence * 100)}
            >
              <i style={{ width: `${report.confidence * 100}%` }} />
            </div>
            <b>{Math.round(report.confidence * 100)}%</b>
          </div>
          <dl>
            <dt>Visual evidence</dt>
            <dd>{report.visual_evidence}</dd>
            <dt>Recommended action</dt>
            <dd>{report.recommended_action}</dd>
          </dl>
        </div>
      )}

      <dl className="telemetry">
        {cells.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
