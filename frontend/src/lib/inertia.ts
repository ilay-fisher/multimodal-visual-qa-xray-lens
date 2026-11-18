import { SPRING_SOFT, springStep, type SpringState } from "./spring";

const REST_DISTANCE = 0.05; // lens percent
const REST_SPEED = 0.4; // lens percent per second

/**
 * One frame of the lens follower: SPRING_SOFT toward `target`, snapping to an exact rest
 * once it is close and slow so the animation loop can stop. Returns the same object when
 * already at rest on the target.
 */
export function followStep(s: SpringState, target: number, dtSec: number): SpringState {
  const next = springStep(s, target, dtSec, SPRING_SOFT);
  if (next === s) return s;
  return Math.abs(next.x - target) < REST_DISTANCE && Math.abs(next.v) < REST_SPEED ? { x: target, v: 0 } : next;
}
