import { GAP_PX, pairLayout } from "../lib/crop";

describe("pairLayout", () => {
  const box = { x: 10, y: 20, w: 50, h: 30 };

  it("sizes the canvas as 2w + 8 by h", () => {
    const l = pairLayout(box);
    expect(GAP_PX).toBe(8);
    expect(l.width).toBe(108);
    expect(l.height).toBe(30);
  });

  it("places baseline left and target right of the gap, both from the same source box", () => {
    const l = pairLayout(box);
    expect(l.baseline).toEqual({ sx: 10, sy: 20, sw: 50, sh: 30, dx: 0, dy: 0 });
    expect(l.target).toEqual({ sx: 10, sy: 20, sw: 50, sh: 30, dx: 58, dy: 0 });
  });
});
