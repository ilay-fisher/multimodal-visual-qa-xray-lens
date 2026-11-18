import { useState } from "react";
import type { PresetOut, VlmBackend } from "../types";

export interface ToolbarProps {
  presets: PresetOut[];
  presetId: string | null;
  sensitivity: number;
  backend: VlmBackend;
  onPresetChange: (id: string) => void;
  onUpload: (baseline: File, target: File) => void;
  onSensitivityChange: (value: number) => void;
  onBackendChange: (backend: VlmBackend) => void;
}

const BACKENDS: { id: VlmBackend; label: string; short: string; tag?: string }[] = [
  { id: "demo", label: "Demo Mode", short: "Demo", tag: "free" },
  { id: "local", label: "Local MLX/Ollama", short: "Local" },
  { id: "cloud", label: "Cloud API", short: "Cloud" },
];

type Popover = "pair" | "engine" | null;

/**
 * Tray under the stage: preset slides, a "+ your pair" upload sheet, a sensitivity range
 * and an engine chip that opens the backend choice. Same state contract as the old form row.
 */
export function Toolbar(props: ToolbarProps) {
  const { presets, presetId, sensitivity, backend } = props;
  const [open, setOpen] = useState<Popover>(null);
  const [baseline, setBaseline] = useState<File | null>(null);
  const [target, setTarget] = useState<File | null>(null);
  const toggle = (p: Exclude<Popover, null>) => setOpen((cur) => (cur === p ? null : p));
  const pick = (set: (f: File | null) => void) => (e: React.ChangeEvent<HTMLInputElement>) =>
    set(e.target.files?.[0] ?? null);
  const current = BACKENDS.find((b) => b.id === backend) ?? BACKENDS[0];

  return (
    <div className="tray" onKeyDown={(e) => e.key === "Escape" && setOpen(null)}>
      <div className="chips" role="group" aria-label="Presets">
        {presets.map((p) => (
          <button key={p.id} type="button" className="chip" aria-pressed={presetId === p.id} onClick={() => props.onPresetChange(p.id)}>
            {p.label}
          </button>
        ))}
        <button type="button" className="chip chip-add" aria-pressed={presetId === null} aria-expanded={open === "pair"} aria-haspopup="dialog" onClick={() => toggle("pair")}>
          + your pair
        </button>
      </div>

      <label className="sens">
        <span>Sensitivity</span>
        <input
          type="range"
          aria-label="Sensitivity"
          min={0}
          max={1}
          step={0.05}
          value={sensitivity}
          style={{ "--fill": `${sensitivity * 100}%` } as React.CSSProperties}
          onChange={(e) => props.onSensitivityChange(Number(e.target.value))}
        />
        <output className="num">{sensitivity.toFixed(2)}</output>
      </label>

      <div className="engine">
        <button type="button" className="chip" aria-expanded={open === "engine"} aria-haspopup="menu" onClick={() => toggle("engine")}>
          <span className="dim">engine</span> {current.short}
          {current.tag && <i className="tag">{current.tag}</i>}
        </button>
        {open === "engine" && (
          <div className="sheet" role="menu" aria-label="Engine">
            {BACKENDS.map((b) => (
              <button
                key={b.id}
                type="button"
                role="menuitemradio"
                aria-checked={backend === b.id}
                onClick={() => { props.onBackendChange(b.id); setOpen(null); }}
              >
                {b.label}
                {b.tag && <i className="tag">{b.tag}</i>}
              </button>
            ))}
          </div>
        )}
      </div>

      {open === "pair" && (
        <div className="sheet sheet-pair" role="dialog" aria-label="Your pair">
          {([["Baseline image", "Baseline", baseline, setBaseline], ["Target image", "Target", target, setTarget]] as const).map(
            ([aria, hint, file, set]) => (
              <label key={aria} className="file">
                <input type="file" accept="image/*" aria-label={aria} onChange={pick(set)} />
                <span>{file?.name ?? hint}</span>
              </label>
            ),
          )}
          <button
            type="button"
            className="btn"
            disabled={!baseline || !target}
            onClick={() => {
              if (!baseline || !target) return;
              props.onUpload(baseline, target);
              setOpen(null);
            }}
          >
            Inspect uploads
          </button>
        </div>
      )}
    </div>
  );
}
