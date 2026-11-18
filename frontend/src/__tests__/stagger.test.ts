import { labelSide, lockDelays, regionLabel, STAGGER_MS } from "../lib/stagger";

describe("lockDelays", () => {
  it("staggers regions one after another", () => {
    expect(lockDelays(3, true)).toEqual([0, STAGGER_MS, 2 * STAGGER_MS]);
    expect(STAGGER_MS).toBe(90);
  });

  it("is empty for no regions", () => {
    expect(lockDelays(0, true)).toEqual([]);
  });

  it("is gated (null) until the sweep has settled", () => {
    expect(lockDelays(3, false)).toBeNull();
    expect(lockDelays(0, false)).toBeNull();
  });
});

describe("regionLabel", () => {
  it("formats index and pixel size", () => {
    expect(regionLabel(0, 63, 44)).toBe("R1 · 63×44");
    expect(regionLabel(11, 120, 9)).toBe("R12 · 120×9");
  });
});

describe("labelSide", () => {
  const W = 960;
  it("sits right of a box on the left side", () => {
    expect(labelSide({ x: 100, w: 120 }, W)).toBe("right");
  });
  it("flips left near the right edge", () => {
    expect(labelSide({ x: 800, w: 120 }, W)).toBe("left");
  });
  it("goes inside a box that spans the stage", () => {
    expect(labelSide({ x: 40, w: 880 }, W)).toBe("inside");
  });
});
