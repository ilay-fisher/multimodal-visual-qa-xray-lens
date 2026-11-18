import { GAP_PX, MAX_SCALE, MIN_SIDE, pairLayout } from "../lib/crop";

describe("pairLayout", () => {
  const box = { x: 10, y: 20, w: 100, h: 80 };

  it("exports the documented constants", () => {
    expect(GAP_PX).toBe(8);
    expect(MIN_SIDE).toBe(75);
    expect(MAX_SCALE).toBe(4);
  });

  it("leaves crops with a short side >= 75 px unscaled: 2w + 8 by h", () => {
    const l = pairLayout(box);
    expect(l.scale).toBe(1);
    expect(l.width).toBe(208);
    expect(l.height).toBe(80);
  });

  it("places baseline left and target right of the gap, both from the same source box", () => {
    const l = pairLayout(box);
    expect(l.baseline).toEqual({ sx: 10, sy: 20, sw: 100, sh: 80, dx: 0, dy: 0, dw: 100, dh: 80 });
    expect(l.target).toEqual({ sx: 10, sy: 20, sw: 100, sh: 80, dx: 108, dy: 0, dw: 100, dh: 80 });
  });

  it("upscales a 39x25 box by 3 and keeps the gap at 8 px", () => {
    const l = pairLayout({ x: 5, y: 6, w: 39, h: 25 });
    expect(l.scale).toBe(3);
    expect(l.width).toBe(242);
    expect(l.height).toBe(75);
    expect(l.baseline).toEqual({ sx: 5, sy: 6, sw: 39, sh: 25, dx: 0, dy: 0, dw: 117, dh: 75 });
    expect(l.target.dx).toBe(117 + GAP_PX);
    expect(l.target.dw).toBe(117);
  });

  it("caps the scale at 4 for tiny boxes", () => {
    const l = pairLayout({ x: 0, y: 0, w: 10, h: 10 });
    expect(l.scale).toBe(4);
    expect(l.width).toBe(2 * 40 + 8);
    expect(l.height).toBe(40);
  });

  it("uses scale 1 exactly at the 75 px threshold", () => {
    expect(pairLayout({ x: 0, y: 0, w: 75, h: 200 }).scale).toBe(1);
    expect(pairLayout({ x: 0, y: 0, w: 74, h: 200 }).scale).toBe(2);
  });
});
