/** Uniform FLIP: centre-to-centre move and one scale (the smaller ratio), so the layer is never stretched. */
export function flipUniform(first: DOMRect, last: DOMRect): { dx: number; dy: number; s: number } {
  const ratios = [first.width / last.width, first.height / last.height].filter(Number.isFinite);
  return {
    dx: first.left + first.width / 2 - (last.left + last.width / 2),
    dy: first.top + first.height / 2 - (last.top + last.height / 2),
    s: last.width && last.height ? Math.min(...ratios) : 1,
  };
}

/** True when any part of `r` is inside a `vw` x `vh` viewport (the flight is skipped otherwise, never scrolled to). */
export function inView(r: DOMRect, vw: number, vh: number): boolean {
  return r.top + r.height > 0 && r.left + r.width > 0 && r.top < vh && r.left < vw;
}

/** Non-uniform FLIP (first, last, invert, play) maths: the transform that makes `last` look like `first`. */
export interface Flip { dx: number; dy: number; sx: number; sy: number }

/**
 * Inverse transform for an element that now sits at `last` but should start out looking like it
 * is at `first`. Apply as `translate(dx, dy) scale(sx, sy)` with `transform-origin: 0 0`, then
 * animate to `none`. A collapsed `last` axis scales by 1 rather than dividing by zero.
 */
export function flipFrom(first: DOMRect, last: DOMRect): Flip {
  return {
    dx: first.left - last.left,
    dy: first.top - last.top,
    sx: last.width ? first.width / last.width : 1,
    sy: last.height ? first.height / last.height : 1,
  };
}
