import { describe, expect, it } from "vitest";
import { SWEEP_MS, sweepAt } from "../lib/sweep";

describe("sweepAt", () => {
  it("is a 2.6 s timeline", () => {
    expect(SWEEP_MS).toBe(2600);
  });

  it("starts and ends at the centre", () => {
    expect(sweepAt(0).pos).toBe(50);
    expect(sweepAt(SWEEP_MS).pos).toBe(50);
  });

  it("visits 15, then 85, then returns to 50", () => {
    const peaks = [0, 650, 1750, 2600].map((t) => sweepAt(t).pos);
    expect(peaks).toEqual([50, 15, 85, 50]);
  });

  it("is only done once the full duration has elapsed", () => {
    expect(sweepAt(SWEEP_MS - 1).done).toBe(false);
    expect(sweepAt(SWEEP_MS).done).toBe(true);
    expect(sweepAt(60_000)).toEqual({ pos: 50, done: true });
  });

  it("clamps negative time to the start", () => {
    expect(sweepAt(-100)).toEqual({ pos: 50, done: false });
  });

  it("moves monotonically within the first leg and never leaves 15..85", () => {
    let prev = sweepAt(0).pos;
    for (let t = 10; t <= 650; t += 10) {
      const p = sweepAt(t).pos;
      expect(p).toBeLessThanOrEqual(prev);
      prev = p;
    }
    for (let t = 0; t <= SWEEP_MS; t += 13) {
      const { pos } = sweepAt(t);
      expect(pos).toBeGreaterThanOrEqual(15);
      expect(pos).toBeLessThanOrEqual(85);
    }
  });

  it("eases into each waypoint instead of kinking", () => {
    // Near a turning point the target barely moves, so the spring never sees a velocity jump.
    expect(Math.abs(sweepAt(660).pos - sweepAt(650).pos)).toBeLessThan(0.1);
  });
});
