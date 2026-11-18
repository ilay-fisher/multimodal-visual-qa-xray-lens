/** First-run guided sweep: a pure timeline from elapsed milliseconds to a target lens position (0..100). */

export const SWEEP_MS = 2600;

/** Waypoints as [elapsed ms, position]: centre, left, right, back to centre. */
const WAYPOINTS: readonly (readonly [number, number])[] = [
  [0, 50],
  [650, 15],
  [1750, 85],
  [SWEEP_MS, 50],
];

/**
 * Target position at `elapsedMs`. Each leg eases in and out (half cosine), so the target
 * has zero velocity at every turning point and the follower spring never sees a kink.
 */
export function sweepAt(elapsedMs: number): { pos: number; done: boolean } {
  if (elapsedMs >= SWEEP_MS) return { pos: 50, done: true };
  const t = Math.max(0, elapsedMs);
  for (let i = 1; i < WAYPOINTS.length; i++) {
    const [t1, p1] = WAYPOINTS[i];
    if (t > t1) continue;
    const [t0, p0] = WAYPOINTS[i - 1];
    const u = (t - t0) / (t1 - t0);
    return { pos: p0 + (p1 - p0) * ((1 - Math.cos(Math.PI * u)) / 2), done: false };
  }
  return { pos: 50, done: true };
}
