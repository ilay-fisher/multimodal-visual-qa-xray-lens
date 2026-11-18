import { useRef, useState } from "react";
import type { BoxOut, InspectResponse } from "../types";

type Mode = "split" | "lens";
const LENS_RADIUS = 0.16; // fraction of image width
const png = (b64: string) => `data:image/png;base64,${b64}`;
const clamp = (v: number) => Math.min(1, Math.max(0, v));

interface Props {
  data: InspectResponse;
  selectedId: number | null;
  onSelectBox: (box: BoxOut) => void;
}

/**
 * Target image with a draggable X-Ray lens. Split mode reveals the CV overlay to the
 * left of the handle; lens mode reveals it inside a circle that follows the pointer.
 * ROI boxes are percentage-positioned buttons so they scale with the image.
 */
export function XRaySlider({ data, selectedId, onSelectBox }: Props) {
  const [mode, setMode] = useState<Mode>("split");
  const [pos, setPos] = useState({ x: 0.5, y: 0.5 });
  const [peek, setPeek] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const { image_width: W, image_height: H } = data;

  const moveTo = (e: React.PointerEvent) => {
    const r = stage.current?.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0) return;
    setPos({ x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const dx = e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0;
    const dy = mode === "lens" ? (e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0) : 0;
    if (e.key === "Home") setPos((p) => ({ ...p, x: 0 }));
    else if (e.key === "End") setPos((p) => ({ ...p, x: 1 }));
    else if (dx || dy) setPos((p) => ({ x: clamp(p.x + dx), y: clamp(p.y + dy) }));
    else return;
    e.preventDefault();
  };

  const clip =
    mode === "split"
      ? `inset(0 ${(1 - pos.x) * 100}% 0 0)`
      : `circle(${LENS_RADIUS * 100}cqw at ${pos.x * 100}% ${pos.y * 100}%)`;

  return (
    <div className="xray">
      <div className="xray-bar">
        <div className="seg" role="group" aria-label="Lens mode">
          {(["split", "lens"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>
              {m === "split" ? "Split" : "Lens"}
            </button>
          ))}
        </div>
        <button type="button" className="seg-solo" aria-pressed={peek} onClick={() => setPeek((v) => !v)}>
          Baseline
        </button>
        <span className="readout">
          {W} x {H} px | lens {Math.round(pos.x * 100)}%
        </span>
      </div>

      <div
        ref={stage}
        className="stage"
        data-mode={mode}
        style={{ aspectRatio: `${W} / ${H}` }}
        onPointerDown={(e) => {
          setDragging(true);
          e.currentTarget.setPointerCapture?.(e.pointerId);
          moveTo(e);
        }}
        onPointerMove={(e) => (dragging || (mode === "lens" && e.pointerType === "mouse")) && moveTo(e)}
        onPointerUp={() => setDragging(false)}
      >
        <img src={png(data.target_png_b64)} alt="Target" draggable={false} />
        <img className="overlay" src={png(data.overlay_png_b64)} alt="CV difference overlay" draggable={false} style={{ clipPath: clip }} />
        {peek && <img className="peek" src={png(data.baseline_png_b64)} alt="Baseline" draggable={false} />}

        {mode === "split" ? (
          <div className="rail" style={{ left: `${pos.x * 100}%` }} />
        ) : (
          <div className="ring" style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%` }} />
        )}
        <div
          className="grip"
          role="slider"
          tabIndex={0}
          aria-label={mode === "split" ? "X-ray split position" : "X-ray lens position"}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pos.x * 100)}
          style={{ left: `${pos.x * 100}%`, top: mode === "lens" ? `${pos.y * 100}%` : "50%" }}
          onKeyDown={onKeyDown}
        />

        {data.boxes.map((b, i) => (
          <button
            key={b.id}
            type="button"
            className="roi"
            data-hover={hovered === b.id || undefined}
            aria-pressed={selectedId === b.id}
            aria-label={`Region ${i + 1}, ${b.w} by ${b.h} pixels`}
            style={{ left: `${(b.x / W) * 100}%`, top: `${(b.y / H) * 100}%`, width: `${(b.w / W) * 100}%`, height: `${(b.h / H) * 100}%` }}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerEnter={() => setHovered(b.id)}
            onPointerLeave={() => setHovered(null)}
            onClick={() => onSelectBox(b)}
          >
            <span>{i + 1}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
