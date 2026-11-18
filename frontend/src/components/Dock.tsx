import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { DOCK_H, showDock, trayCovered } from "../lib/dock";
import { logDebug } from "../lib/log";

/** The tray the dock must never cover (see lib/dock.ts). */
export const TRAY_SELECTOR = ".tray";
/** The readout counts as in view when this much of it clears the dock band. */
const READOUT_ROOM = DOCK_H + 96;

/**
 * Whether the dock should show. The readout's visibility comes from an IntersectionObserver
 * (null until it first reports); the tray check is measured on scroll and resize.
 */
export function useDockGate(readout: RefObject<HTMLElement>, picked: boolean): boolean {
  const [seen, setSeen] = useState<boolean | null>(null);
  const [covered, setCovered] = useState(false);
  useEffect(() => {
    const el = readout.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") return logDebug("dock disabled: no IntersectionObserver");
    const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting), { rootMargin: `0px 0px -${READOUT_ROOM}px 0px` });
    io.observe(el);
    const measure = () => setCovered(trayCovered(document.querySelector(TRAY_SELECTOR)?.getBoundingClientRect(), window.innerHeight));
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [readout]);
  return showDock(picked, seen, covered);
}

/** Fixed "Diagnosis" dock: a mini specimen and a mono status. A real button; tapping it scrolls the readout into view. */
export function Dock({ url, status, onTap, onLoad }: { url: string | null; status: string; onTap: () => void; onLoad: (img: HTMLImageElement) => void }) {
  return createPortal(
    <button type="button" className="dock" aria-label={`Diagnosis, ${status}. Show readout`} onClick={onTap}>
      <span className="dock-well">{url && <img src={url} alt="" draggable={false} onLoad={(e) => onLoad(e.currentTarget)} />}</span>
      <span className="dock-text">
        <b>Diagnosis</b>
        <span className="num">{status}</span>
      </span>
    </button>,
    document.body,
  );
}
