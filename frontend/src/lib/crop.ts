import type { BoxOut } from "../types";

type Box = Pick<BoxOut, "x" | "y" | "w" | "h">;
interface Rect { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number }

/** Width in pixels of the neutral gray gap between the baseline and target crops. Never scaled. */
export const GAP_PX = 8;
/** Crops whose short side is below this many pixels are upscaled so the VLM gets enough pixels. */
export const MIN_SIDE = 75;
/** Upper bound on the integer upscale factor applied to small crops. */
export const MAX_SCALE = 4;
const GAP_COLOR = "rgb(128,128,128)";

/** Pure layout math: upscale factor, canvas size and both draw rects (gap stays GAP_PX wide). */
export function pairLayout(box: Box): { scale: number; width: number; height: number; baseline: Rect; target: Rect } {
  const scale = Math.min(MAX_SCALE, Math.max(1, Math.ceil(MIN_SIDE / Math.min(box.w, box.h))));
  const dw = box.w * scale;
  const dh = box.h * scale;
  const rect = (dx: number): Rect => ({ sx: box.x, sy: box.y, sw: box.w, sh: box.h, dx, dy: 0, dw, dh });
  return { scale, width: 2 * dw + GAP_PX, height: dh, baseline: rect(0), target: rect(dw + GAP_PX) };
}

async function load(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

/**
 * Builds the VLM input: baseline crop | gray gap | target crop, same box from both images.
 * Small crops are upscaled (see pairLayout). Returns the PNG blob with its real pixel size.
 */
export async function cropPairToPng(baselineSrc: string, targetSrc: string, box: Box): Promise<{ blob: Blob; width: number; height: number }> {
  const [base, target] = await Promise.all([load(baselineSrc), load(targetSrc)]);
  const layout = pairLayout(box);
  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = GAP_COLOR;
  ctx.fillRect(0, 0, layout.width, layout.height);
  for (const [img, r] of [[base, layout.baseline], [target, layout.target]] as const) {
    ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh);
  }
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))), "image/png"),
  );
  return { blob, width: layout.width, height: layout.height };
}
