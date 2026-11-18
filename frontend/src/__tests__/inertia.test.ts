import { describe, expect, it } from "vitest";
import { followStep } from "../lib/inertia";
import type { SpringState } from "../lib/spring";

function run(from: SpringState, target: number, maxFrames = 400) {
  let s = from;
  const xs: number[] = [];
  let frames = 0;
  while (frames < maxFrames) {
    const next = followStep(s, target, 1 / 60);
    frames++;
    xs.push(next.x);
    if (next === s) break;
    s = next;
  }
  return { s, xs, frames };
}

describe("followStep", () => {
  it("returns the same object when already at rest on the target", () => {
    const s: SpringState = { x: 40, v: 0 };
    expect(followStep(s, 40, 1 / 60)).toBe(s);
  });

  it("overshoots slightly on a big jump, then settles exactly on the target", () => {
    const { s, xs } = run({ x: 10, v: 0 }, 90);
    const peak = Math.max(...xs);
    expect(peak).toBeGreaterThan(90);
    expect(peak).toBeLessThan(90 + 80 * 0.12); // about 7% of the 80 unit travel, with margin
    expect(s).toEqual({ x: 90, v: 0 });
  });

  it("comes to rest within about a second", () => {
    expect(run({ x: 10, v: 0 }, 90).frames).toBeLessThan(80);
  });

  it("snaps instead of creeping forever once close and slow", () => {
    expect(followStep({ x: 49.99, v: 0.01 }, 50, 1 / 60)).toEqual({ x: 50, v: 0 });
  });

  it("keeps momentum when the target sits under a moving knob", () => {
    const moving = followStep({ x: 30, v: 120 }, 30, 1 / 60);
    expect(moving.x).toBeGreaterThan(30);
  });
});
