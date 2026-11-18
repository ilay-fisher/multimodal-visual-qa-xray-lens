/**
 * Machine-vision view of the CV overlay. The backend overlay is the target with a JET heatmap
 * blended in at 55% where the change mask is set, plus white contours and yellow numbered boxes
 * (see cv_pipeline._overlay; annotationMask knows their geometry). We recover each changed pixel's intensity by inverting JET and
 * repaint it in the paint colormap over a darkened grayscale base. Done client side on a canvas because
 * CSS filters cannot express a four-stop colormap keyed on hue; the backend stays unchanged.
 */

import type { BoxOut } from "../types";

export type RGB = [number, number, number];

/** Target brightness on the scan side (after desaturating to grey). */
export const BASE_DIM = 0.35;
const HEAT_ALPHA = 0.55; // mirrors _HEATMAP_ALPHA in cv_pipeline.py
const MIN_HEAT = 0.25; // any masked pixel is at least this visible
const STOPS: readonly (readonly [number, RGB])[] = [
  [0, [12, 16, 20]],
  [1 / 3, [168, 48, 15]], // paint-deep
  [2 / 3, [255, 90, 31]], // paint
  [1, [255, 179, 71]], // paint-hi
];

/** Colormap: dark, paint-deep, paint, paint-hi for intensity 0..1. */
export function heatColor(t: number): RGB {
  const x = Math.min(1, Math.max(0, t));
  let i = 1;
  while (i < STOPS.length - 1 && x > STOPS[i][0]) i++;
  const [t0, c0] = STOPS[i - 1];
  const [t1, c1] = STOPS[i];
  const u = (x - t0) / (t1 - t0);
  return [0, 1, 2].map((k) => Math.round(c0[k] + (c1[k] - c0[k]) * u)) as RGB;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** OpenCV JET sampled at 64 steps, as RGB, for nearest-colour inversion. */
const JET: RGB[] = Array.from({ length: 64 }, (_, i) => {
  const t = i / 63;
  return [clamp01(1.5 - Math.abs(4 * t - 3)), clamp01(1.5 - Math.abs(4 * t - 2)), clamp01(1.5 - Math.abs(4 * t - 1))].map((c) => c * 255) as RGB;
});

function jetIntensity(r: number, g: number, b: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < JET.length; i++) {
    const d = (JET[i][0] - r) ** 2 + (JET[i][1] - g) ** 2 + (JET[i][2] - b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best / (JET.length - 1);
}

/**
 * Where the backend drew its own annotations (1 = not heat): the 2 px box rectangle (padded one pixel
 * for anti-aliasing) and the box number, drawn at (x+3, max(14, y-5)) with ~10 px per digit.
 * Anti-aliased edges of that yellow would otherwise read as heat.
 */
export function annotationMask(width: number, height: number, boxes: readonly { x: number; y: number; w: number; h: number }[]): Uint8Array {
  const mask = new Uint8Array(width * height);
  const fill = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = Math.max(0, y0); y <= Math.min(height - 1, y1); y++) mask.fill(1, y * width + Math.max(0, x0), y * width + Math.min(width - 1, x1) + 1);
  };
  boxes.forEach((b, i) => {
    const base = Math.max(14, b.y - 5);
    const digits = String(i + 1).length;
    fill(b.x - 1, b.y - 1, b.x + b.w + 2, b.y + 2); // top
    fill(b.x - 1, b.y + b.h - 1, b.x + b.w + 2, b.y + b.h + 2); // bottom
    fill(b.x - 1, b.y - 1, b.x + 2, b.y + b.h + 2); // left
    fill(b.x + b.w - 1, b.y - 1, b.x + b.w + 2, b.y + b.h + 2); // right
    fill(b.x + 1, base - 12, b.x + 3 + 10 * digits, base + 3); // number
  });
  return mask;
}

/** RGBA in, RGBA out: darkened target, with changed pixels repainted by intensity. `mask` (one byte per pixel) forces the plain base. */
export function scanPixels(target: Uint8ClampedArray, overlay: Uint8ClampedArray, mask?: Uint8Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(target.length);
  for (let p = 0; p < target.length; p += 4) {
    // Grayscale base: the heat is the only colour on the scan side.
    const grey = Math.round((0.299 * target[p] + 0.587 * target[p + 1] + 0.114 * target[p + 2]) * BASE_DIM);
    const base = [grey, grey, grey];
    const [or, og, ob] = [overlay[p], overlay[p + 1], overlay[p + 2]];
    const changed = or !== target[p] || og !== target[p + 1] || ob !== target[p + 2];
    const annotation = (or >= 250 && og >= 250 && ob >= 250) || (or >= 250 && og >= 250 && ob <= 5);
    let rgb = base;
    if (changed && !annotation && !mask?.[p / 4]) {
      const heat = [0, 1, 2].map((k) => (overlay[p + k] - (1 - HEAT_ALPHA) * target[p + k]) / HEAT_ALPHA);
      const c = heatColor(MIN_HEAT + (1 - MIN_HEAT) * jetIntensity(heat[0], heat[1], heat[2]));
      rgb = base.map((v, k) => Math.round(v * 0.15 + c[k] * 0.85));
    }
    out[p] = rgb[0];
    out[p + 1] = rgb[1];
    out[p + 2] = rgb[2];
    out[p + 3] = 255;
  }
  return out;
}

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image failed to load"));
    img.src = src;
  });
}

function pixelsOf(img: HTMLImageElement) {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2d canvas unavailable");
  ctx.drawImage(img, 0, 0);
  return { data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, ctx, canvas };
}

/** Machine-vision PNG data URL for a target/overlay pair. Rejects if canvas is unavailable. */
export async function renderScan(targetSrc: string, overlaySrc: string, boxes: readonly BoxOut[] = []): Promise<string> {
  const [t, o] = await Promise.all([load(targetSrc), load(overlaySrc)]);
  const target = pixelsOf(t);
  const overlay = pixelsOf(o);
  const out = new ImageData(scanPixels(target.data, overlay.data, annotationMask(target.canvas.width, target.canvas.height, boxes)), target.canvas.width, target.canvas.height);
  target.ctx.putImageData(out, 0, 0);
  return target.canvas.toDataURL("image/png");
}
