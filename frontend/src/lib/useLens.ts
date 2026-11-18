import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { followStep } from "./inertia";
import { logDebug } from "./log";
import { renderScan } from "./scan";
import type { SpringState } from "./spring";
import { sweepAt } from "./sweep";

const SWEEP_FLAG = "xray.sweep";
const clampPct = (v: number) => Math.min(100, Math.max(0, v));

export type SweepState = "idle" | "running" | "done" | "cancelled" | "skipped";

/** True when the user asks for reduced motion. Tracks changes of the media query. */
export function useReducedMotion(): boolean {
  const query = () => window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const [reduced, setReduced] = useState(() => query()?.matches ?? false);
  useEffect(() => {
    const mq = query();
    const on = () => setReduced(mq?.matches ?? false);
    mq?.addEventListener?.("change", on);
    return () => mq?.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

/**
 * Publishes the visual lens position (percent, 0..100) as `--lens` on `host`. `setTarget` moves it:
 * through SPRING_SOFT in a rAF loop that stops at rest, or straight there when motion is reduced.
 * Writes the CSS variable directly so a drag does not re-render React every frame.
 */
export function useLensFollow(host: RefObject<HTMLElement>, reduced: boolean, initial = 50) {
  const state = useRef<SpringState>({ x: initial, v: 0 });
  const target = useRef(initial);
  const raf = useRef(0);
  const last = useRef<number | null>(null);
  const paint = useCallback((x: number) => host.current?.style.setProperty("--lens", String(Number(clampPct(x).toFixed(2)))), [host]);

  const tick = useCallback(
    (now: number) => {
      const dt = last.current === null ? 0 : (now - last.current) / 1000;
      last.current = now;
      state.current = followStep(state.current, target.current, dt);
      paint(state.current.x);
      const rest = state.current.x === target.current && state.current.v === 0;
      raf.current = rest ? 0 : requestAnimationFrame(tick);
      if (rest) last.current = null;
    },
    [paint],
  );

  useLayoutEffect(() => paint(initial), [paint, initial]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  return useCallback(
    (value: number) => {
      target.current = value;
      if (reduced) {
        state.current = { x: value, v: 0 };
        paint(value);
      } else if (!raf.current) raf.current = requestAnimationFrame(tick);
    },
    [reduced, paint, tick],
  );
}

/** True if the sweep already ran this session; marks it as run otherwise. Storage may be blocked: then it just runs. */
function seenThenMark(): boolean {
  try {
    if (sessionStorage.getItem(SWEEP_FLAG) !== null) return true;
    sessionStorage.setItem(SWEEP_FLAG, "1");
  } catch {
    /* blocked */
  }
  return false;
}

/**
 * Runs the guided sweep once per session, the first time `host` scrolls into view. Any pointer,
 * key or focus input inside `host` cancels it at once and hands the lens back to `current()`.
 */
export function useFirstRunSweep(host: RefObject<HTMLElement>, reduced: boolean, setTarget: (v: number) => void, current: () => number): SweepState {
  const [state, setState] = useState<SweepState>("idle");
  const latest = useRef({ setTarget, current });
  latest.current = { setTarget, current };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    if (reduced) {
      setState("skipped");
      return;
    }
    let raf = 0;
    let t0: number | null = null;
    const inputs = ["pointerdown", "keydown", "focusin"];
    const finish = (next: SweepState) => {
      cancelAnimationFrame(raf);
      inputs.forEach((e) => el.removeEventListener(e, cancel, true));
      logDebug(`sweep ${next}`);
      setState(next);
    };
    const cancel = () => {
      finish("cancelled");
      latest.current.setTarget(latest.current.current());
    };
    const frame = (now: number) => {
      t0 ??= now;
      const { pos, done } = sweepAt(now - t0);
      latest.current.setTarget(pos);
      if (done) finish("done");
      else raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (seenThenMark()) return setState("skipped");
      logDebug("sweep running");
      setState("running");
      inputs.forEach((e) => el.addEventListener(e, cancel, true));
      raf = requestAnimationFrame(frame);
    };
    let io: IntersectionObserver | undefined;
    if (typeof IntersectionObserver === "undefined") start();
    else {
      io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io?.disconnect();
          start();
        }
      }, { threshold: 0.4 });
      io.observe(el);
    }
    return () => {
      io?.disconnect();
      cancelAnimationFrame(raf);
      inputs.forEach((e) => el.removeEventListener(e, cancel, true));
    };
  }, [host, reduced]);

  return state;
}

/**
 * Machine-vision image for the scan side (see lib/scan.ts). `null` while it renders;
 * falls back to the raw overlay if canvas is unavailable.
 */
export function useScanSrc(target: string, overlay: string): string | null {
  const [done, setDone] = useState<{ key: string; src: string } | null>(null);
  useEffect(() => {
    let live = true;
    renderScan(target, overlay)
      .then((src) => live && setDone({ key: overlay, src }))
      .catch((err) => {
        logDebug("scan colormap unavailable, using raw overlay", err);
        if (live) setDone({ key: overlay, src: overlay });
      });
    return () => {
      live = false;
    };
  }, [target, overlay]);
  return done?.key === overlay ? done.src : null;
}
