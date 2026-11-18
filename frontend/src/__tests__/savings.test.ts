import { BENCHMARK, MIN_SLIVER, barFraction, formatCount, formatSaving, provenance, savingPct } from "../lib/savings";

describe("barFraction", () => {
  it("is the plain ratio when it is big enough to see", () => {
    expect(barFraction(121, 2460)).toBeCloseTo(0.0492, 4);
    expect(barFraction(2460, 2460)).toBe(1);
    expect(barFraction(1230, 2460)).toBe(0.5);
  });
  it("keeps a tiny non-zero ratio visible as a sliver, never exactly empty", () => {
    expect(barFraction(1, 100000)).toBe(MIN_SLIVER);
    expect(MIN_SLIVER).toBeGreaterThan(0);
    expect(MIN_SLIVER).toBeLessThanOrEqual(0.05);
  });
  it("is empty for zero, so the sliver never claims there is something", () => {
    expect(barFraction(0, 2460)).toBe(0);
  });
  it("guards full = 0, missing, negative and non-finite input", () => {
    for (const [v, f] of [[5, 0], [undefined, 100], [5, undefined], [NaN, 100], [5, Infinity], [-3, 100], [5, -1]] as const) expect(barFraction(v, f)).toBe(0);
  });
  it("clamps roi > full to a full bar", () => {
    expect(barFraction(300, 100)).toBe(1);
  });
});

describe("savingPct and formatSaving", () => {
  it("computes the saving from the two counts", () => {
    expect(savingPct(2460, 121)).toBeCloseTo(95.08, 1);
    expect(formatSaving(2460, 121)).toBe("95.1%");
  });
  it("matches the README benchmark: 17,838 vs 10,034 ms is 43.7% saved", () => {
    expect(formatSaving(BENCHMARK.fullMs, BENCHMARK.roiMs)).toBe("43.7%");
  });
  it("never says 100.0% unless the saving is exact", () => {
    expect(formatSaving(1_000_000, 1)).toBe("99.9%");
    expect(formatSaving(1000, 0)).toBe("100.0%");
  });
  it("never says 0.0% for a real, if tiny, saving", () => {
    expect(formatSaving(1_000_000, 999_999)).toBe("0.1%");
    expect(formatSaving(100, 100)).toBe("0.0%");
  });
  it("returns null, not a made-up number, for missing, zero or inverted data", () => {
    expect(formatSaving(0, 0)).toBeNull();
    expect(formatSaving(undefined, 5)).toBeNull();
    expect(formatSaving(100, undefined)).toBeNull();
    expect(formatSaving(100, 300)).toBeNull();
    expect(savingPct(100, 300)).toBeNull();
    expect(savingPct(NaN, 1)).toBeNull();
  });
});

describe("provenance", () => {
  it("tags token estimates live: they are computed for this image, in demo too", () => {
    expect(provenance("estimate", false)).toBe("live");
    expect(provenance("estimate", true)).toBe("live");
  });
  it("tags the benchmark measured whatever the backend", () => {
    expect(provenance("benchmark", false)).toBe("measured");
    expect(provenance("benchmark", true)).toBe("measured");
  });
  it("tags this call's time simulated in demo, live otherwise", () => {
    expect(provenance("call", true)).toBe("simulated");
    expect(provenance("call", false)).toBe("live");
  });
});

describe("constants and counts", () => {
  it("carry the README benchmark numbers exactly", () => {
    expect(BENCHMARK).toMatchObject({ fullMs: 17838, roiMs: 10034, regions: 4 });
  });
  it("groups thousands", () => {
    expect(formatCount(2460)).toBe("2,460");
    expect(formatCount(121)).toBe("121");
  });
});
