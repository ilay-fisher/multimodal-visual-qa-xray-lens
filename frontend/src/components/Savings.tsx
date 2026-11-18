import { useEffect, useState } from "react";
import { logError } from "../lib/log";
import { BENCHMARK, barFraction, formatCount, formatSaving, provenance, savingPct } from "../lib/savings";
import { SPRING_SOFT, springCssClamped, springStep, type SpringState } from "../lib/spring";
import { useReducedMotion } from "../lib/useLens";

export interface Telemetry {
  cvTimeMs: number;
  pixelsFilteredPct: number;
  /** Heuristic image-token estimates for this image, from /api/inspect. 0 when nothing is inspected yet. */
  fullFrameTokens: number;
  roiTokens: number;
}

/**
 * Drives the one entrance motion: `go` flips the Regions bar from full length to its share (a CSS
 * transition on SPRING_SOFT) and `value` rolls the counter up to `target` on the same spring.
 * Reduced motion, or `still`, shows the final state at once. `hold` delays the start only: a roll
 * already under way is not interrupted.
 */
function useSpringIn(still: boolean, hold: boolean, target: number): { go: boolean; value: number } {
  const [go, setGo] = useState(still);
  const [value, setValue] = useState(still ? target : 0);
  const release = !hold || go;
  useEffect(() => {
    if (still) {
      setGo(true);
      setValue(target);
      return;
    }
    if (!release) return;
    let s: SpringState = { x: 0, v: 0 };
    let last: number | null = null;
    let raf = 0;
    const tick = (now: number) => {
      setGo(true);
      s = springStep(s, target, last === null ? 0 : (now - last) / 1000, SPRING_SOFT);
      last = now;
      const rest = Math.abs(s.x - target) < 0.05 && Math.abs(s.v) < 1;
      setValue(rest ? target : Math.min(target, Math.max(0, s.x)));
      if (!rest) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [still, release, target]);
  return { go, value };
}

/** The bar settles on its true share without dipping past it, on the same spring as the counter. */
const SETTLE = springCssClamped(SPRING_SOFT);
const GLIDE = `width ${SETTLE.durationMs}ms ${SETTLE.easing}`;

interface PairProps {
  id: string; title: string; unit: string; tag: string; source?: string;
  full: number; roi: number; format: (n: number) => string;
  /** Words after the saving ("fewer", "saved"), the sentence a screen reader gets for the pair, and whether it springs in. */
  noun: string; spoken: string; animated: boolean; hold: boolean;
}

/** One Full frame / Regions bar pair. Mount it with a `key` of its data so new data replays the entrance. */
function Pair({ id, title, unit, tag, source, full, roi, format, noun, spoken, animated, hold }: PairProps) {
  const reduced = useReducedMotion();
  const saving = savingPct(full, roi);
  const { go, value } = useSpringIn(reduced || !animated, hold, saving ?? 0);
  const regions = go ? barFraction(roi, full) : barFraction(full, full);
  const bars: [string, string, number, boolean][] = [
    ["Full frame", format(full), barFraction(full, full), false],
    ["Regions", format(roi), regions, true],
  ];
  return (
    <section className="pair" aria-label={title}>
      <p className="pair-head">
        <span>{unit}</span>
        <i className="tag">{tag}</i>
        {saving !== null && (
          <span className="saved" aria-hidden="true"><b data-counter>{value === saving ? formatSaving(full, roi) : `${value.toFixed(1)}%`}</b> {noun}</span>
        )}
        {source && <small>{source}</small>}
      </p>
      <div aria-hidden="true">
        {bars.map(([label, text, frac, accent]) => (
          <div key={label} className="pair-row">
            <span>{label}</span>
            <div className="bar"><i data-bar={`${id}-${accent ? "regions" : "full"}`} data-accent={accent || undefined} style={{ width: `${frac * 100}%`, transition: GLIDE }} /></div>
            <b>{text}</b>
          </div>
        ))}
      </div>
      <p className="sr">{spoken}</p>
    </section>
  );
}

/**
 * "Full frame vs regions": the token saving for this image (live estimate), the benchmarked latency
 * saving (measured, never this request's time), then this call's VLM time and the CV line. Only the
 * Regions bars carry the paint accent. `hold` keeps the entrance still while the region flight runs.
 */
export function Savings({ telemetry, vlmMs, simulated, hold }: { telemetry: Telemetry; vlmMs?: number; simulated: boolean; hold: boolean }) {
  const { fullFrameTokens: full, roiTokens: roi } = telemetry;
  const hasTokens = full > 0;
  useEffect(() => {
    if (roi > full) logError(`regions (${roi}) exceed full frame (${full}) tokens`);
  }, [full, roi]);
  const tokenSaving = formatSaving(full, roi);
  const latencySaving = formatSaving(BENCHMARK.fullMs, BENCHMARK.roiMs);

  return (
    <div className="savings" role="group" aria-label="Full frame vs regions">
      {hasTokens && (
        <Pair
          key={`${full}:${roi}`}
          id="tokens" title="Image tokens" unit="est. tokens" tag={provenance("estimate", simulated)}
          full={full} roi={roi} format={formatCount} noun="fewer"
          spoken={`Full frame ${formatCount(full)} est. tokens, regions ${formatCount(roi)}${tokenSaving ? `, ${tokenSaving} fewer` : ""}`}
          animated
          hold={hold}
        />
      )}
      <Pair
        id="latency" title="Latency" unit="latency · ms" tag={provenance("benchmark", simulated)}
        source={`benchmark · ${BENCHMARK.model} · ${BENCHMARK.regions} regions`}
        full={BENCHMARK.fullMs} roi={BENCHMARK.roiMs} format={formatCount} noun="saved"
        spoken={`Full frame ${formatCount(BENCHMARK.fullMs)} ms, regions ${formatCount(BENCHMARK.roiMs)} ms, ${latencySaving} faster. Measured benchmark, ${BENCHMARK.model}, ${BENCHMARK.regions} regions.`}
        animated={false}
        hold={hold}
      />
      <dl className="call">
        <div>
          <dt>This call</dt>
          <dd>
            {vlmMs === undefined ? "–" : <>{`${Math.round(vlmMs)} ms VLM`}<i className="tag">{provenance("call", simulated)}</i></>}
          </dd>
        </div>
      </dl>
      {hasTokens && (
        <p className="cvline">
          {`CV ${Math.round(telemetry.cvTimeMs)} ms · ${telemetry.pixelsFilteredPct.toFixed(1)}% pixels filtered`}
          <i className="tag">live</i>
        </p>
      )}
    </div>
  );
}
