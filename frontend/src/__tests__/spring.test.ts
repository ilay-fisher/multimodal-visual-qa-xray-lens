import { describe, expect, it } from "vitest";
import { SPRING_SNAPPY, SPRING_SOFT, springCss, springStep, springTrajectory, type SpringState } from "../lib/spring";

const peak = (xs: number[]) => Math.max(...xs);

describe("springStep", () => {
  it("is a no-op for zero or negative dt", () => {
    const s: SpringState = { x: 0.3, v: 1 };
    expect(springStep(s, 1, 0, SPRING_SOFT)).toEqual(s);
    expect(springStep(s, 1, -1, SPRING_SOFT)).toEqual(s);
  });

  it("returns the same object when at rest on the target", () => {
    const s: SpringState = { x: 1, v: 0 };
    expect(springStep(s, 1, 0.016, SPRING_SNAPPY)).toBe(s);
  });

  it("clamps huge dt so a stalled tab cannot explode the spring", () => {
    const s = springStep({ x: 0, v: 0 }, 1, 60, SPRING_SOFT);
    expect(Number.isFinite(s.x)).toBe(true);
    expect(Math.abs(s.x)).toBeLessThan(2);
  });
});

describe("springTrajectory", () => {
  it("SOFT overshoots by about 7% and settles to 1", () => {
    const { values } = springTrajectory(SPRING_SOFT);
    const over = peak(values) - 1;
    expect(over).toBeGreaterThan(0.05);
    expect(over).toBeLessThan(0.09);
    expect(values[values.length - 1]).toBeCloseTo(1, 2);
  });

  it("SNAPPY overshoots under 8% and settles to 1", () => {
    const { values } = springTrajectory(SPRING_SNAPPY);
    expect(peak(values) - 1).toBeGreaterThan(0.03);
    expect(peak(values) - 1).toBeLessThan(0.08);
    expect(values[values.length - 1]).toBeCloseTo(1, 2);
  });

  it("starts at 0 and has strictly increasing time", () => {
    const { values, times } = springTrajectory(SPRING_SOFT);
    expect(values[0]).toBe(0);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
  });
});

describe("springCss", () => {
  it("durations match the spec", () => {
    expect(springCss(SPRING_SOFT).durationMs).toBeGreaterThan(820);
    expect(springCss(SPRING_SOFT).durationMs).toBeLessThan(940);
    expect(springCss(SPRING_SNAPPY).durationMs).toBeGreaterThan(300);
    expect(springCss(SPRING_SNAPPY).durationMs).toBeLessThan(400);
  });

  it("produces a linear() string that starts at 0 and ends exactly at 1", () => {
    const { easing } = springCss(SPRING_SOFT, 24);
    expect(easing).toMatch(/^linear\(0, [-\d., ]+, 1\)$/);
    expect(easing.slice(7, -1).split(", ")).toHaveLength(24);
  });

  it("contains values above 1 (overshoot)", () => {
    const nums = springCss(SPRING_SOFT).easing.slice(7, -1).split(", ").map(Number);
    expect(peak(nums)).toBeGreaterThan(1.04);
  });
});
