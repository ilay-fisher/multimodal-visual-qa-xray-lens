import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { logDebug } from "../lib/log";
import { labelSide, lockDelays, placeTinyLabel, regionLabel, TINY } from "../lib/stagger";
import { useFirstRunSweep, useLensFollow, useReducedMotion, useScanSrc } from "../lib/useLens";
import type { BoxOut, InspectResponse } from "../types";

const png = (b64: string) => `data:image/png;base64,${b64}`;
const clamp = (v: number) => Math.min(100, Math.max(0, v));
/** How long an unstarted sweep may hold the regions back. */
const IDLE_GRACE_MS = 1200;
const isHoldKey = (e: React.KeyboardEvent) => (e.key === " " || e.key === "Enter") && !e.repeat;

interface Props {
  data: InspectResponse;
  selectedId: number | null;
  onSelectBox: (box: BoxOut) => void;
}

/**
 * The lens: a target image with the machine's view (scan) revealed left of a glowing edge.
 * A native range input spans the stage and owns all input; the knob, rail and edge are
 * decorative and follow its value through a spring (lib/inertia.ts). Hold "baseline" to peek at
 * the reference image. A one-time sweep on first view shows what the lens does.
 * ROI boxes are percentage-positioned buttons above the input so they scale with the image.
 * Once the sweep has settled they lock on one after another (bracket convergence and the typed
 * label are CSS, scheduled per region by `--d`); new regions re-key the group so it replays.
 */
export function XRaySlider({ data, selectedId, onSelectBox }: Props) {
  const [value, setValue] = useState(50);
  const [peek, setPeek] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [picked, setPicked] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const valueRef = useRef(50);
  const reduced = useReducedMotion();
  const follow = useLensFollow(root, reduced);
  const sweep = useFirstRunSweep(root, reduced, follow, () => valueRef.current);
  const scanSrc = useScanSrc(png(data.target_png_b64), png(data.overlay_png_b64), data.boxes);
  const { image_width: W, image_height: H } = data;

  const commit = (v: number) => {
    valueRef.current = clamp(v);
    setValue(valueRef.current);
    follow(valueRef.current);
  };

  const onRangeKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const step = e.shiftKey ? 10 : 1;
    if (e.key === "b" || e.key === "B") return void (!e.repeat && setPeek(true));
    const next =
      e.key === "ArrowRight" || e.key === "ArrowUp" ? value + step : e.key === "ArrowLeft" || e.key === "ArrowDown" ? value - step : e.key === "Home" ? 0 : e.key === "End" ? 100 : null;
    if (next === null) return;
    e.preventDefault();
    commit(next);
  };

  // Never hide regions on a stage that is on screen: if the sweep has not started shortly after
  // mount (no observer callback, off screen), lock on anyway.
  const [patient, setPatient] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setPatient(true), IDLE_GRACE_MS);
    return () => clearTimeout(t);
  }, []);
  const settled = ["done", "cancelled", "skipped"].includes(sweep) || (sweep === "idle" && patient);
  const delays = lockDelays(data.boxes.length, settled);
  const lock = !delays ? "wait" : reduced ? "rest" : "lock";
  const roiKey = data.boxes.map((b) => `${b.x},${b.y},${b.w},${b.h}`).join("|");
  // Tiny boxes: put the label where there is room and clear of neighbouring brackets (measured, not guessed).
  useLayoutEffect(() => {
    const place = () => {
      const stage = root.current?.querySelector(".stage")?.getBoundingClientRect();
      const rois = [...(root.current?.querySelectorAll<HTMLElement>(".roi") ?? [])];
      const rects = rois.map((el) => el.getBoundingClientRect());
      rois.forEach((el, i) => {
        const r = rects[i];
        const lbl = el.querySelector(".lbl")?.getBoundingClientRect();
        if (!stage || !lbl || !r.width || (r.width >= TINY.w && r.height >= TINY.h)) return;
        const p = placeTinyLabel(r, { w: lbl.width, h: lbl.height }, rects.filter((_, j) => j !== i), stage);
        el.dataset.side = p.side;
        el.style.setProperty("--ny", `${p.dy}px`);
      });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [roiKey]);

  const count = data.boxes.length;
  useEffect(() => {
    if (lock === "lock") logDebug(`lock-on start: ${count} regions`);
  }, [lock, roiKey, count]);

  const showHint = settled && !picked && selectedId === null && data.boxes.length > 0;

  return (
    <div ref={root} className="xray" data-sweep={sweep} style={{ "--ar": W / H } as React.CSSProperties}>
      <div className="xray-bar">
        <button
          type="button"
          className="hold"
          aria-pressed={peek}
          aria-keyshortcuts="B"
          onPointerDown={() => setPeek(true)}
          onPointerUp={() => setPeek(false)}
          onPointerCancel={() => setPeek(false)}
          onPointerLeave={() => setPeek(false)}
          onKeyDown={(e) => isHoldKey(e) && setPeek(true)}
          onKeyUp={(e) => isHoldKey(e) && setPeek(false)}
          onBlur={() => setPeek(false)}
          onContextMenu={(e) => e.preventDefault()}
        >
          Hold for baseline
        </button>
        {showHint && (
          <p className="pick-hint" role="status" style={{ animationDelay: `${(delays?.at(-1) ?? 0) + 450}ms` }}>
            Pick a region
          </p>
        )}
        <span className="readout">
          {W} x {H} px | scan {value}%
        </span>
      </div>

      <div className="stage" data-press={pressed || undefined} style={{ aspectRatio: `${W} / ${H}` }}>
        <img src={png(data.target_png_b64)} alt="Target" draggable={false} />
        <div className="machine">
          {scanSrc && <img src={scanSrc} alt="CV difference overlay" draggable={false} />}
          <span className="legend">
            <i aria-hidden="true" />
            CV diff · {Math.round(data.cv_time_ms)} ms
          </span>
        </div>
        {peek && <img className="peek" src={png(data.baseline_png_b64)} alt="Baseline" draggable={false} />}
        {peek && <span className="peek-tag">Baseline</span>}
        <i className="edge" aria-hidden="true" />

        <input
          className="lens-range"
          type="range"
          min={0}
          max={100}
          step={1}
          value={value}
          aria-label="Scan position"
          aria-valuetext={`Scan ${value}%`}
          onChange={(e) => commit(Number(e.target.value))}
          onKeyDown={onRangeKey}
          onKeyUp={(e) => (e.key === "b" || e.key === "B") && setPeek(false)}
          onBlur={() => (setPeek(false), setPressed(false))}
          onPointerDown={() => setPressed(true)}
          onPointerUp={() => setPressed(false)}
          onPointerCancel={() => setPressed(false)}
        />
        <div className="rail" aria-hidden="true">
          <i className="knob" />
        </div>

        <Fragment key={roiKey}>
          {data.boxes.map((b, i) => {
            const text = regionLabel(i, b.w, b.h);
            const style = {
              left: `${(b.x / W) * 100}%`,
              top: `${(b.y / H) * 100}%`,
              width: `${(b.w / W) * 100}%`,
              height: `${(b.h / H) * 100}%`,
              "--d": `${delays?.[i] ?? 0}ms`,
              "--n": text.length,
            } as React.CSSProperties;
            return (
              <button
                key={b.id}
                type="button"
                className="roi"
                data-roi={b.id}
                data-lock={lock}
                data-side={labelSide(b, W)}
                aria-pressed={selectedId === b.id}
                aria-label={`Region ${i + 1}, ${b.w} by ${b.h} pixels`}
                style={style}
                onClick={() => {
                  setPicked(true);
                  onSelectBox(b);
                }}
              >
                <span className="brk" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                <span className="lbl" aria-hidden="true">
                  {text}
                </span>
              </button>
            );
          })}
        </Fragment>
      </div>
    </div>
  );
}
