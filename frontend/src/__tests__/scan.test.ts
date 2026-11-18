import { describe, expect, it } from "vitest";
import { BASE_DIM, heatColor, scanPixels } from "../lib/scan";

const luma = (c: ArrayLike<number>) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
const px = (...rgb: number[]) => new Uint8ClampedArray([...rgb, 255]);
/** What the backend writes for a changed pixel: 55% jet colour over 45% target (see cv_pipeline._overlay). */
const blend = (jet: number[], target: number[]) => px(...jet.map((c, i) => Math.round(0.55 * c + 0.45 * target[i])));
const JET_HOT = [128, 0, 0]; // strongest change (OpenCV JET at 255, as RGB)
const JET_COLD = [0, 0, 128]; // weakest change that still passed the threshold

describe("heatColor", () => {
  it("runs dark to paint-deep to paint to paint-hi", () => {
    expect(heatColor(1)).toEqual([255, 179, 71]);
    expect(heatColor(2 / 3)).toEqual([255, 90, 31]);
    expect(heatColor(1 / 3)).toEqual([168, 48, 15]);
    expect(luma(heatColor(0))).toBeLessThan(20);
  });

  it("gets brighter as intensity rises", () => {
    let prev = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const l = luma(heatColor(t));
      expect(l).toBeGreaterThanOrEqual(prev);
      prev = l;
    }
  });

  it("clamps out-of-range input", () => {
    expect(heatColor(-3)).toEqual(heatColor(0));
    expect(heatColor(9)).toEqual(heatColor(1));
  });
});

describe("scanPixels", () => {
  const target = [100, 100, 100];

  it("darkens unchanged pixels to the base level", () => {
    const out = scanPixels(px(...target), px(...target));
    expect(BASE_DIM).toBe(0.35);
    expect([...out]).toEqual([35, 35, 35, 255]);
  });

  it("paints changed pixels in the paint colormap, stronger changes brighter", () => {
    const hot = scanPixels(px(...target), blend(JET_HOT, target));
    const cold = scanPixels(px(...target), blend(JET_COLD, target));
    const flat = scanPixels(px(...target), px(...target));
    expect(luma(hot)).toBeGreaterThan(luma(cold));
    expect(luma(cold)).toBeGreaterThan(luma(flat));
    expect(hot[0]).toBeGreaterThan(hot[1]);
    expect(hot[1]).toBeGreaterThan(hot[2]); // warm: red > green > blue
  });

  it("ignores white contour and yellow box annotations drawn by the backend", () => {
    const white = scanPixels(px(...target), px(255, 255, 255));
    const yellow = scanPixels(px(...target), px(255, 255, 0));
    expect([...white]).toEqual([35, 35, 35, 255]);
    expect([...yellow]).toEqual([35, 35, 35, 255]);
  });

  it("works on whole images, one pixel per four bytes", () => {
    const t = new Uint8ClampedArray([100, 100, 100, 255, 10, 20, 30, 255]);
    const out = scanPixels(t, t);
    expect(out).toHaveLength(8);
    expect([...out.slice(4)]).toEqual([4, 7, 11, 255]);
  });
});
