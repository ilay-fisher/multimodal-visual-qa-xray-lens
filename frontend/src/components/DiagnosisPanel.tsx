import { useEffect, useMemo, useState } from "react";
import { flipUniform, inView } from "../lib/flip";
import { partialReport } from "../lib/partialReport";
import { SPRING_SOFT, springCss } from "../lib/spring";
import { useReducedMotion } from "../lib/useLens";
import type { DefectReport, ErrorCode, ResultData } from "../types";
import { Savings, type Telemetry } from "./Savings";

export interface Diagnosis {
  status: "idle" | "streaming" | "done" | "error";
  /** Concatenated raw token text received so far. */
  raw: string;
  result?: ResultData;
  /** The exact composite image (baseline | target) sent to the VLM, and the clicked region's rect it flies from. */
  sent?: { blob: Blob; width: number; height: number; from?: DOMRect };
  error?: { message: string; code: ErrorCode | "network" };
}

const ROWS: [keyof DefectReport, string][] = [
  ["defect_category", "Category"],
  ["severity", "Severity"],
  ["confidence", "Confidence"],
  ["visual_evidence", "Evidence"],
  ["recommended_action", "Action"],
];
const DASH = "–";
/** Display pace for text that arrives faster than a person can follow (the demo backend streams a whole report in ~150 ms). */
const REVEAL_CHARS = 3;
const REVEAL_TICK_MS = 16;

/**
 * How many leading characters of `len` to show. Text already present on mount, or any text under
 * reduced motion, shows at once; text that arrives later is revealed at a readable pace. Pacing
 * is display only: the full `raw` and `result` are already in hand and `result.report` stays the truth.
 */
function useRevealed(len: number, paced: boolean): number {
  const [n, setN] = useState(len);
  useEffect(() => {
    if (n > len) setN(len);
    else if (paced && n < len) {
      const t = setTimeout(() => setN(n + REVEAL_CHARS), REVEAL_TICK_MS);
      return () => clearTimeout(t);
    } else if (n < len) setN(len);
  }, [n, len, paced]);
  return paced ? Math.min(n, len) : len;
}

/**
 * Instrument readout plus the "Full frame vs regions" savings instrument. Rows fill from `partialReport(raw)` while
 * streaming, then from `result.report` (the truth). The sent composite flies in from the clicked
 * region (FLIP, SPRING_SOFT) once its pixels are loaded. Under reduced motion there is no flight,
 * caret or half-typed text: rows show finished values. The live region is polite and busy while
 * streaming, so assistive tech announces the finished readout once rather than every chunk.
 */
export function DiagnosisPanel({ diagnosis, telemetry, simulated = false }: { diagnosis: Diagnosis; telemetry: Telemetry; simulated?: boolean }) {
  const { status, result, sent } = diagnosis;
  const reduced = useReducedMotion();
  const [sentUrl, setSentUrl] = useState<string | null>(null);
  /** True while the specimen flight runs: the savings bars wait for it (one loud motion at a time). */
  const [flying, setFlying] = useState(false);
  useEffect(() => {
    if (!sent) return setSentUrl(null);
    const url = URL.createObjectURL(sent.blob);
    setSentUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [sent]);

  /** Specimen has its real size once loaded: invert it onto the clicked region, then spring home. */
  const fly = (el: HTMLElement) => {
    const last = el.getBoundingClientRect();
    if (!sent?.from || reduced || typeof el.animate !== "function" || !inView(last, window.innerWidth, window.innerHeight)) return;
    const { dx, dy, s } = flipUniform(sent.from, last);
    // Spring easing with the overshoot clamped, so the layer lands inside the well instead of past its edge.
    const { easing, durationMs } = springCss(SPRING_SOFT);
    const landing = easing.replace(/-?\d*\.?\d+/g, (n) => String(Math.min(Number(n), 1)));
    const flight = el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${s})` }, { transform: "none" }], { duration: durationMs, easing: landing });
    if (!flight) return;
    setFlying(true);
    flight.onfinish = flight.oncancel = () => setFlying(false);
  };

  const revealed = useRevealed(diagnosis.raw.length, !reduced && simulated);
  const settling = revealed < diagnosis.raw.length;
  const busy = status === "streaming" || settling;
  const partial = useMemo(() => partialReport(diagnosis.raw.slice(0, revealed)), [diagnosis.raw, revealed]);
  const report = status === "done" && !settling ? result?.report : undefined;
  const fields: Partial<DefectReport> = report ?? partial.fields;
  const activeKey = busy && !report ? (partial.active?.key ?? ROWS.find(([k]) => !(k in fields))?.[0]) : undefined;
  const conf = fields.confidence === undefined ? undefined : Math.round(fields.confidence * 100);

  return (
    <section className="panel diagnosis" aria-live="polite" aria-busy={busy}>
      <header className="panel-head">
        <h2>Diagnosis</h2>
        {result && <span className="chip">{result.backend}</span>}
        {result?.cached && <span className="chip chip-cached">cached</span>}
      </header>

      <figure className="sent">
        <div className="slot" data-filled={Boolean(sent && sentUrl)}>
          {sent && sentUrl ? <img src={sentUrl} alt="Composite sent to the VLM" onLoad={(e) => fly(e.currentTarget)} /> : <span className="slot-empty">awaiting region</span>}
        </div>
        <figcaption>
          <span>Sent to VLM</span>
          {sent && <b>{`baseline | target · ${sent.width}×${sent.height} px`}</b>}
        </figcaption>
      </figure>

      {status === "idle" && <p className="hint">Select a flagged region on the image to send only that crop to the vision model.</p>}

      <dl className="readout-rows" aria-label="Diagnosis readout">
        {ROWS.map(([key, label]) => {
          // Half-typed text is only shown with motion; reduced motion waits for the finished value.
          const live = !reduced && partial.active?.key === key && !(key in fields) ? partial.active.text : "";
          const text = key === "confidence" ? (conf === undefined ? live : `${conf}%`) : key === "severity" ? "" : (fields[key] as string | undefined) ?? live;
          const state = key in fields ? "done" : live ? "live" : "empty";
          const active = key === activeKey;
          // The row's trailing mark: paint caret on the active row, a quiet dash on an empty one.
          const tail = active && !reduced ? <span className="caret" aria-hidden="true" /> : state === "empty" ? <span className="dash">{DASH}</span> : null;
          return (
            <div key={key} className="row" data-row={key} data-state={state} data-active={active || undefined}>
              <dt>{label}</dt>
              <dd>
                {key === "severity" && fields.severity && (
                  <span key={fields.severity} className="badge" data-severity={fields.severity}>{fields.severity}</span>
                )}
                {key === "confidence" && (
                  <div className="bar" role="progressbar" aria-label="Confidence" aria-valuemin={0} aria-valuemax={100} aria-valuenow={conf}>
                    <i style={{ width: `${conf ?? 0}%` }} />
                  </div>
                )}
                {key === "confidence" ? <b>{text}{tail}</b> : <>{text}{tail}</>}
              </dd>
            </div>
          );
        })}
      </dl>

      {status === "error" && (
        <div role="alert" className="error fault">
          <strong>{diagnosis.error?.code === "rate_limited" ? "Rate limited" : "Analysis failed"}</strong>
          <p>{diagnosis.error?.message}</p>
        </div>
      )}

      {diagnosis.raw && (
        <details className="rawbox">
          <summary>raw</summary>
          <pre className="raw" aria-label="Raw model output">{diagnosis.raw}</pre>
        </details>
      )}

      <Savings telemetry={telemetry} vlmMs={result?.vlm_time_ms} simulated={simulated} hold={flying} />
    </section>
  );
}
