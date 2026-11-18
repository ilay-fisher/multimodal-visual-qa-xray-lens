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

export interface Rect { left: number; top: number; right: number; bottom: number }

/** Boxes smaller than this (screen px) get their label placed by measurement. */
export const TINY = { w: 40, h: 28 };

/**
 * Label side and vertical nudge (px) for a tiny box, from screen rects: the side with more free
 * stage, shifted clear of any other region's brackets. `size` is the measured label size.
 */
export function placeTinyLabel(box: Rect, size: { w: number; h: number }, others: Rect[], stage: Rect): { side: "left" | "right"; dy: number } {
  const GAP = 8;
  const PAD = 4;
  const side = box.left - stage.left > stage.right - box.right ? "left" : "right";
  const x0 = side === "right" ? box.right + GAP : box.left - GAP - size.w;
  const cy = (box.top + box.bottom) / 2;
  const home = cy - size.h / 2;
  let top = home;
  for (const o of others) {
    const hit = x0 < o.right + PAD && x0 + size.w > o.left - PAD && top < o.bottom + PAD && top + size.h > o.top - PAD;
    if (hit) top = (o.top + o.bottom) / 2 > cy ? o.top - PAD - size.h : o.bottom + PAD;
  }
  return { side, dy: top - home };
}
