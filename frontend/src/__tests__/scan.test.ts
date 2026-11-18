import { describe, expect, it } from "vitest";
import { annotationMask, BASE_DIM, heatColor, scanPixels } from "../lib/scan";

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

  it("desaturates and darkens unchanged pixels to the base level", () => {
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

  it("has no colour on unchanged coloured pixels", () => {
    const [r, g, b] = scanPixels(px(200, 40, 20), px(200, 40, 20));
    expect(r === g && g === b).toBe(true);
  });

  it("works on whole images, one pixel per four bytes", () => {
    const t = new Uint8ClampedArray([100, 100, 100, 255, 10, 20, 30, 255]);
    const out = scanPixels(t, t);
    expect(out).toHaveLength(8);
    expect([...out.slice(4)]).toEqual([6, 6, 6, 255]); // grey: 0.299*10 + 0.587*20 + 0.114*30, times 0.35
  });
});

describe("annotationMask", () => {
  // Backend draws a 2 px rectangle and the box number at (x+3, max(14, y-5)) in pure yellow.
  const box = { x: 20, y: 30, w: 40, h: 20 };
  const W = 100;
  const H = 80;
  const at = (m: Uint8Array, x: number, y: number) => m[y * W + x];

  it("covers the rectangle band and not the interior or the outside", () => {
    const m = annotationMask(W, H, [box]);
    expect(at(m, 20, 40)).toBe(1); // left edge
    expect(at(m, 40, 50)).toBe(1); // bottom edge
    expect(at(m, 60, 40)).toBe(1); // right edge
    expect(at(m, 40, 40)).toBe(0); // interior stays heat
    expect(at(m, 10, 40)).toBe(0); // outside
  });

  it("covers the number's text area above the box", () => {
    const m = annotationMask(W, H, [box]);
    expect(at(m, 24, 21)).toBe(1); // glyph area: x+1..x+3+10, y-5-12..y-5+3
    expect(at(m, 24, 12)).toBe(0); // above the glyph (y 13..28)
  });

  it("clamps the label baseline at 14 for boxes near the top", () => {
    const m = annotationMask(W, H, [{ x: 20, y: 4, w: 30, h: 20 }]);
    expect(at(m, 24, 5)).toBe(1); // baseline 14: y 2..17
  });

  it("widens the text area for two-digit numbers and stays inside the image", () => {
    const boxes = Array.from({ length: 10 }, (_, i) => ({ x: i === 9 ? 90 : 0, y: 30, w: 8, h: 8 }));
    const m = annotationMask(W, H, boxes);
    expect(m).toHaveLength(W * H);
    expect(at(m, 99, 25)).toBe(1);
  });
});

describe("scanPixels with a mask", () => {
  it("shows the grayscale base where the mask is set, even on changed pixels", () => {
    const t = px(100, 100, 100);
    const masked = scanPixels(t, blend(JET_HOT, [100, 100, 100]), new Uint8Array([1]));
    expect([...masked.slice(0, 3)]).toEqual([...scanPixels(t, t).slice(0, 3)]);
  });
});
