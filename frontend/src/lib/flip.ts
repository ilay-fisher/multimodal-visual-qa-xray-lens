/** FLIP (first, last, invert, play) maths: the transform that makes `last` look like `first`. */
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
