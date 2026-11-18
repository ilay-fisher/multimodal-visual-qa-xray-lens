import { flipFrom } from "../lib/flip";

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height }) as DOMRect;

describe("flipFrom", () => {
  it("is the identity when nothing moved", () => {
    expect(flipFrom(rect(10, 20, 100, 50), rect(10, 20, 100, 50))).toEqual({ dx: 0, dy: 0, sx: 1, sy: 1 });
  });

  it("translates the destination's top-left back onto the source's", () => {
    expect(flipFrom(rect(100, 40, 50, 25), rect(400, 300, 50, 25))).toEqual({ dx: -300, dy: -260, sx: 1, sy: 1 });
  });

  it("scales from the destination size to the source size", () => {
    expect(flipFrom(rect(0, 0, 60, 30), rect(0, 0, 240, 90))).toEqual({ dx: 0, dy: 0, sx: 0.25, sy: 1 / 3 });
    expect(flipFrom(rect(0, 0, 480, 90), rect(0, 0, 240, 45))).toMatchObject({ sx: 2, sy: 2 });
  });

  it("falls back to scale 1 for a collapsed destination", () => {
    expect(flipFrom(rect(5, 5, 40, 40), rect(9, 9, 0, 0))).toEqual({ dx: -4, dy: -4, sx: 1, sy: 1 });
  });
});
