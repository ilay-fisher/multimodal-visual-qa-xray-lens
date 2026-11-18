import type { BoxOut } from "../types";

type Box = Pick<BoxOut, "x" | "y" | "w" | "h">;
interface Rect { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number }

/** Width in pixels of the neutral gray gap between the baseline and target crops. */
export const GAP_PX = 8;
const GAP_COLOR = "rgb(128,128,128)";

/** Pure layout math for the side-by-side composite: canvas size and both draw rects. */
export function pairLayout(box: Box): { width: number; height: number; baseline: Rect; target: Rect } {
  const rect = (dx: number): Rect => ({ sx: box.x, sy: box.y, sw: box.w, sh: box.h, dx, dy: 0 });
  return { width: 2 * box.w + GAP_PX, height: box.h, baseline: rect(0), target: rect(box.w + GAP_PX) };
}

async function load(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

/**
 * Builds the VLM input: baseline crop | gray gap | target crop, same box from both images.
 * Returns the PNG blob with its pixel size.
 */
export async function cropPairToPng(baselineSrc: string, targetSrc: string, box: Box): Promise<{ blob: Blob; width: number; height: number }> {
  const [base, target] = await Promise.all([load(baselineSrc), load(targetSrc)]);
  const layout = pairLayout(box);
  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.fillStyle = GAP_COLOR;
  ctx.fillRect(0, 0, layout.width, layout.height);
  for (const [img, r] of [[base, layout.baseline], [target, layout.target]] as const) {
    ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.sw, r.sh);
  }
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))), "image/png"),
  );
  return { blob, width: layout.width, height: layout.height };
}
