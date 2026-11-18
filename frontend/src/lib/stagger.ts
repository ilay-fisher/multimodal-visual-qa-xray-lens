/** Region lock-on: pure helpers for the stagger schedule and the typed label. */

/** Gap between one region locking on and the next. */
export const STAGGER_MS = 90;

/**
 * Start delay (ms) per region, one after another. `null` while the first-run sweep has not
 * settled: only one loud motion at a time, so regions wait for the lens.
 */
export function lockDelays(count: number, sweepSettled: boolean): number[] | null {
  return sweepSettled ? Array.from({ length: count }, (_, i) => i * STAGGER_MS) : null;
}

/** Mono label beside a region, e.g. `R1 · 63×44` (index is 0-based, size in image px). */
export const regionLabel = (index: number, w: number, h: number): string => `R${index + 1} · ${w}×${h}`;

/**
 * Which side of the box the label goes on, from fractions of the image width so it works at any
 * stage size: right by default, left near the right edge, inside for a box that spans the stage.
 */
export function labelSide(box: { x: number; w: number }, imageWidth: number): "right" | "left" | "inside" {
  if ((box.x + box.w) / imageWidth <= 0.68) return "right";
  return box.x / imageWidth >= 0.32 ? "left" : "inside";
}
