/** Pure maths and provenance for the "Full frame vs regions" instrument. */

/**
 * Measured benchmark, cloud Claude Haiku 5.5, 3 sample presets / 4 regions in total.
 * Source: README.md "Benchmark results", row "Total time, full vs ROI" (17,838 ms vs 10,034 ms, 43.7% saved).
 * These are a past measurement, never this request's time: show them tagged `measured`.
 */
export const BENCHMARK = { model: "Haiku 5.5", regions: 4, fullMs: 17838, roiMs: 10034 } as const;

/** Smallest visual share (of the track) a non-zero bar gets, so a tiny ratio is still a visible sliver. The printed number is never rounded up to match. */
export const MIN_SLIVER = 0.03;

export type Provenance = "live" | "measured" | "simulated";

const ok = (n: number | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;

/** Visual length (0..1) of `value` against `full`. Zero for missing/invalid data, 1 when value >= full, a sliver at minimum otherwise. */
export function barFraction(value: number | undefined, full: number | undefined): number {
  if (!ok(value) || !ok(full) || full === 0 || value === 0) return 0;
  return value >= full ? 1 : Math.max(value / full, MIN_SLIVER);
}

/** Saving in percent, or null when it cannot be told: missing data, full = 0, or regions larger than the frame. */
export function savingPct(full: number | undefined, roi: number | undefined): number | null {
  if (!ok(full) || !ok(roi) || full === 0 || roi > full) return null;
  return (1 - roi / full) * 100;
}

/** One-decimal saving ("95.1%"). Shows 100.0% only when regions are exactly zero, and never 0.0% for a real saving. */
export function formatSaving(full: number | undefined, roi: number | undefined): string | null {
  const pct = savingPct(full, roi);
  if (pct === null) return null;
  const rounded = Number(pct.toFixed(1));
  const shown = rounded >= 100 && roi !== 0 ? 99.9 : rounded <= 0 && roi !== full ? 0.1 : rounded;
  return `${shown.toFixed(1)}%`;
}

/** Which tag a number carries: estimates are computed live for this image, the benchmark was measured, this call's time is simulated in demo. */
export function provenance(source: "estimate" | "benchmark" | "call", simulated: boolean): Provenance {
  return source === "benchmark" ? "measured" : source === "call" && simulated ? "simulated" : "live";
}

export const formatCount = (n: number): string => n.toLocaleString("en-US");
