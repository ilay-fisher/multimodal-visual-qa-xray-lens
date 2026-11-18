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

const BACKENDS: [VlmBackend, string][] = [
  ["demo", "Demo Mode"],
  ["local", "Local MLX/Ollama"],
  ["cloud", "Cloud API"],
];

/** Control bar: preset picker, custom image upload, sensitivity and VLM backend. */
export function Toolbar(props: ToolbarProps) {
  const { presets, presetId, sensitivity, backend } = props;
  const [baseline, setBaseline] = useState<File | null>(null);
  const [target, setTarget] = useState<File | null>(null);
  const pick = (set: (f: File | null) => void) => (e: React.ChangeEvent<HTMLInputElement>) =>
    set(e.target.files?.[0] ?? null);

  return (
    <div className="toolbar">
      <label className="field">
        <span>Preset</span>
        <select aria-label="Preset" value={presetId ?? ""} onChange={(e) => props.onPresetChange(e.target.value)}>
          {presetId === null && <option value="">Custom upload</option>}
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Sensitivity</span>
        <span className="range">
          <input
            type="range"
            aria-label="Sensitivity"
            min={0}
            max={1}
            step={0.05}
            value={sensitivity}
            onChange={(e) => props.onSensitivityChange(Number(e.target.value))}
          />
          <output>{sensitivity.toFixed(2)}</output>
        </span>
      </label>

      <label className="field">
        <span>VLM backend</span>
        <select aria-label="VLM backend" value={backend} onChange={(e) => props.onBackendChange(e.target.value as VlmBackend)}>
          {BACKENDS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="upload">
        <legend>Custom pair</legend>
        {([["Baseline image", "Baseline...", baseline, setBaseline], ["Target image", "Target...", target, setTarget]] as const).map(
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
          onClick={() => baseline && target && props.onUpload(baseline, target)}
        >
          Inspect uploads
        </button>
      </fieldset>
    </div>
  );
}
