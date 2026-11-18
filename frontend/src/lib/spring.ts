/** Spring physics shared by the UI: one module owns the maths, CSS gets it as `linear()` easings. */

export interface SpringConfig { stiffness: number; damping: number }
export interface SpringState { x: number; v: number }

/** Things with mass: about 7% overshoot, settles in ~0.88 s. */
export const SPRING_SOFT: SpringConfig = { stiffness: 90, damping: 12 };
/** Controls and snaps: about 6% overshoot, settles in ~0.35 s. */
export const SPRING_SNAPPY: SpringConfig = { stiffness: 520, damping: 30 };

const MAX_DT = 1 / 30;
const SUBSTEP = 1 / 120;

/**
 * Advances a spring toward `target` by `dtSec` (clamped to 1/30 s) with semi-implicit Euler
 * sub-steps. Returns the same object when already at rest on the target.
 */
export function springStep(s: SpringState, target: number, dtSec: number, cfg: SpringConfig): SpringState {
  if (s.x === target && s.v === 0) return s;
  let dt = Math.min(Math.max(dtSec, 0), MAX_DT);
  let { x, v } = s;
  while (dt > 0) {
    const h = Math.min(dt, SUBSTEP);
    v += (-cfg.stiffness * (x - target) - cfg.damping * v) * h;
    x += v * h;
    dt -= h;
  }
  return { x, v };
}

/** Seconds until the oscillation envelope falls under 0.5%. */
export function settleSeconds({ stiffness, damping }: SpringConfig): number {
  const omega = Math.sqrt(stiffness);
  const zeta = Math.min(damping / (2 * omega), 1);
  return Math.log(200) / (zeta * omega);
}

/** Simulated unit step response (0 to 1) from rest, sampled every sub-step until settled. */
export function springTrajectory(cfg: SpringConfig): { times: number[]; values: number[] } {
  const steps = Math.ceil(settleSeconds(cfg) / SUBSTEP);
  const times = [0];
  const values = [0];
  let s: SpringState = { x: 0, v: 0 };
  for (let i = 1; i <= steps; i++) {
    s = springStep(s, 1, SUBSTEP, cfg);
    times.push(i * SUBSTEP);
    values.push(s.x);
  }
  return { times, values };
}

/** CSS `linear()` easing sampled from the simulation, plus the duration it should run for. */
export function springCss(cfg: SpringConfig, points = 32): { easing: string; durationMs: number } {
  const { values, times } = springTrajectory(cfg);
  const last = values.length - 1;
  const samples = Array.from({ length: points }, (_, i) => {
    if (i === 0) return 0;
    if (i === points - 1) return 1;
    return Number(values[Math.round((i / (points - 1)) * last)].toFixed(3));
  });
  return { easing: `linear(${samples.join(", ")})`, durationMs: Math.round(times[last] * 1000) };
}

/**
 * Like `springCss` but monotone: it rises to the target and stays there. The overshoot is clamped and
 * the dip after it is flattened, for things that must never pass (or fall back from) their true value.
 */
export function springCssClamped(cfg: SpringConfig): { easing: string; durationMs: number } {
  const { easing, durationMs } = springCss(cfg);
  let top = 0;
  return { easing: easing.replace(/-?\d*\.?\d+/g, (n) => String((top = Math.max(top, Math.min(Number(n), 1))))), durationMs };
}

/** Publishes `--spring-soft/-dur` and `--spring-snappy/-dur` on the element (the root at startup). */
export function applySpringTokens(el: HTMLElement): void {
  for (const [name, cfg] of [["soft", SPRING_SOFT], ["snappy", SPRING_SNAPPY]] as const) {
    const { easing, durationMs } = springCss(cfg);
    el.style.setProperty(`--spring-${name}`, easing);
    el.style.setProperty(`--spring-${name}-dur`, `${durationMs}ms`);
  }
}
