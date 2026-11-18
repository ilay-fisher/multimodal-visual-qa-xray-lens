import { labelSide, lockDelays, placeTinyLabel, regionLabel, STAGGER_MS } from "../lib/stagger";

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

describe("placeTinyLabel", () => {
  const stage = { left: 0, top: 0, right: 400, bottom: 300 };
  const box = { left: 300, top: 100, right: 330, bottom: 120 };
  const size = { w: 80, h: 20 };

  it("goes to the side with more free space", () => {
    expect(placeTinyLabel(box, size, [], stage).side).toBe("left");
    expect(placeTinyLabel({ left: 40, top: 100, right: 70, bottom: 120 }, size, [], stage).side).toBe("right");
  });

  it("stays level with the box when nothing is in the way", () => {
    expect(placeTinyLabel(box, size, [], stage).dy).toBe(0);
  });

  it("moves clear of a neighbouring box it would sit on", () => {
    const neighbour = { left: 190, top: 104, right: 215, bottom: 124 }; // under the left-hand label
    const { dy } = placeTinyLabel(box, size, [neighbour], stage);
    expect(dy).toBeLessThan(0); // neighbour is lower, so the label goes up
    expect(110 + dy + 10).toBeLessThanOrEqual(neighbour.top - 4 + 0.001);
  });
});
