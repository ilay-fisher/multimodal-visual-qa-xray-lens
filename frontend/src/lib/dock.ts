import { inView } from "./flip";

/** Height of the fixed "Diagnosis" dock at the bottom of the viewport (px). */
export const DOCK_H = 64;

/** True when the tray is (even partly) inside the band the dock would occupy. */
export function trayCovered(tray: DOMRect | undefined, vh: number): boolean {
  return !!tray && tray.bottom > vh - DOCK_H && tray.top < vh;
}

/** The dock shows once a region is picked and the readout is known to be off screen, unless it would cover the tray. */
export function showDock(picked: boolean, readoutSeen: boolean | null, covered: boolean): boolean {
  return picked && readoutSeen === false && !covered;
}

/** Where the specimen lands: the readout slot if it is visible above the dock band, else the dock, else nowhere (the dock would cover the tray). */
export function dockPlan(slot: DOMRect, tray: DOMRect | undefined, vw: number, vh: number): "slot" | "dock" | "none" {
  if (inView(slot, vw, vh - DOCK_H)) return "slot";
  return trayCovered(tray, vh) ? "none" : "dock";
}

/** The dock's mono status line. */
export function dockStatus(status: "idle" | "streaming" | "done" | "error", category?: string): string {
  return status === "streaming" ? "streaming…" : status === "error" ? "analysis failed" : status === "done" ? (category ?? "done") : "";
}
