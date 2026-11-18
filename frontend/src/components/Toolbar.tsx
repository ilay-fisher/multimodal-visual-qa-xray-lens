import { useEffect, useRef, useState } from "react";
import { nextFocus } from "../lib/focus";
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
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])';

/**
 * Tray under the stage: preset slides, a "+ your pair" upload sheet, a sensitivity range
 * and an engine chip that opens the backend choice. Same state contract as the old form row.
 */
export function Toolbar(props: ToolbarProps) {
  const { presets, presetId, sensitivity, backend } = props;
  const [open, setOpen] = useState<Popover>(null);
  const [baseline, setBaseline] = useState<File | null>(null);
  const [target, setTarget] = useState<File | null>(null);
  /** Presets whose static thumbnail failed to load (unknown id, offline): those chips stay text only. */
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
  const root = useRef<HTMLDivElement>(null);
  const openers = useRef<Record<string, HTMLButtonElement | null>>({});
  /** Closes the open sheet; Escape also returns focus to the chip that opened it. */
  const close = (restoreFocus: boolean) => {
    if (restoreFocus && open) openers.current[open]?.focus();
    setOpen(null);
  };
  useEffect(() => {
    if (!open) return;
    // Focus moves into the sheet when it opens; a click outside closes it and, unless it landed on another control, returns focus to the chip.
    root.current?.querySelector(".sheet")?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const away = (e: MouseEvent) => {
      const t = e.target as Element;
      if (root.current?.contains(t)) return;
      if (!t.closest?.("button, input, a, select, textarea, summary")) openers.current[open]?.focus();
      setOpen(null);
    };
    document.addEventListener("click", away);
    return () => document.removeEventListener("click", away);
  }, [open]);
  // Keep the active slide in view in the horizontally scrolling mobile row.
  useEffect(() => {
    const el = root.current?.querySelector<HTMLElement>(".chips [aria-pressed=true]");
    el?.scrollIntoView?.({ inline: "nearest", block: "nearest" });
  }, [presetId, presets.length]);
  const toggle = (p: Exclude<Popover, null>) => setOpen((cur) => (cur === p ? null : p));
  const pick = (set: (f: File | null) => void) => (e: React.ChangeEvent<HTMLInputElement>) =>
    set(e.target.files?.[0] ?? null);
  /** Focus trap: Tab and Shift+Tab cycle inside the open sheet. */
  const trap = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Tab") return;
    const next = nextFocus([...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)], document.activeElement as HTMLElement, e.shiftKey);
    if (!next) return;
    e.preventDefault();
    next.focus();
  };
  const current = BACKENDS.find((b) => b.id === backend) ?? BACKENDS[0];

  return (
    <div className="tray" ref={root} onKeyDown={(e) => e.key === "Escape" && close(true)}>
      <div className="chips" role="group" aria-label="Presets">
        {presets.map((p) => {
          const thumb = !broken.has(p.id);
          return (
            <button key={p.id} type="button" className={thumb ? "chip has-thumb" : "chip"} aria-pressed={presetId === p.id} onClick={() => props.onPresetChange(p.id)}>
              {thumb && <img src={`${import.meta.env.BASE_URL}presets/${p.id}.webp`} alt="" width={64} height={44} draggable={false} onError={() => setBroken((b) => new Set(b).add(p.id))} />}
              {p.label}
            </button>
          );
        })}
        <button type="button" ref={(el) => { openers.current.pair = el; }} className="chip chip-add" aria-pressed={presetId === null} aria-expanded={open === "pair"} aria-haspopup="dialog" onClick={() => toggle("pair")}>
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
        <button type="button" ref={(el) => { openers.current.engine = el; }} className="chip" aria-expanded={open === "engine"} aria-haspopup="menu" onClick={() => toggle("engine")}>
          <span className="dim">engine</span> {current.short}
          {current.tag && <i className="tag">{current.tag}</i>}
        </button>
        {open === "engine" && (
          <div className="sheet" role="menu" aria-label="Engine" onKeyDown={trap}>
            {BACKENDS.map((b) => (
              <button
                key={b.id}
                type="button"
                role="menuitemradio"
                aria-checked={backend === b.id}
                onClick={() => { props.onBackendChange(b.id); close(true); }}
              >
                {b.label}
                {b.tag && <i className="tag">{b.tag}</i>}
              </button>
            ))}
          </div>
        )}
      </div>

      {open === "pair" && (
        <div className="sheet sheet-pair" role="dialog" aria-label="Your pair" onKeyDown={trap}>
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
              close(true);
            }}
          >
            Inspect uploads
          </button>
        </div>
      )}
    </div>
  );
}
