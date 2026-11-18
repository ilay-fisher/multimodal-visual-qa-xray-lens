import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiagnosisPanel, type Diagnosis } from "../components/DiagnosisPanel";

const telemetry = { cvTimeMs: 29.4, pixelsFilteredPct: 99.4, fullFrameTokens: 2460, roiTokens: 121 };
const done: Diagnosis = {
  status: "done",
  raw: "{}",
  result: {
    report: { defect_category: "missing_component", severity: "critical", confidence: 0.9, visual_evidence: "e", recommended_action: "a" },
    backend: "demo",
    cached: false,
    vlm_time_ms: 415,
  } as unknown as Diagnosis["result"],
};
const media = (matches: boolean) =>
  (window.matchMedia = vi.fn(() => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia);

describe("savings roll vs flight", () => {
  const widthOf = () => parseFloat(document.querySelector<HTMLElement>('[data-bar="tokens-regions"]')!.style.width);
  afterEach(() => {
    media(false);
    vi.restoreAllMocks();
    delete (HTMLElement.prototype as { animate?: unknown }).animate;
  });

  it("snaps the token bars and counter to their final values the moment a region is picked mid-roll", async () => {
    const { rerender } = render(<DiagnosisPanel diagnosis={{ status: "idle", raw: "" }} telemetry={telemetry} />);
    await waitFor(() => expect(widthOf()).toBeLessThan(97)); // rolling
    expect(widthOf()).toBeGreaterThan(5);
    rerender(<DiagnosisPanel diagnosis={{ status: "streaming", raw: "" }} telemetry={telemetry} />);
    expect(widthOf()).toBeCloseTo(4.92, 1);
    expect(document.querySelector("[data-counter]")).toHaveTextContent("95.1%");
    await new Promise((r) => setTimeout(r, 120));
    expect(widthOf()).toBeCloseTo(4.92, 1); // no restart, no further movement
  });

  it("does not restart the roll when the flight ends after the snap", async () => {
    const flight: { onfinish?: () => void } = {};
    Object.assign(HTMLElement.prototype, { animate: vi.fn(() => flight) });
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 400, top: 500, width: 240, height: 90 } as DOMRect);
    const sent = { blob: new Blob(["x"]), width: 242, height: 75, from: { left: 40, top: 30, width: 60, height: 30 } as DOMRect };
    const { rerender } = render(<DiagnosisPanel diagnosis={{ status: "idle", raw: "" }} telemetry={telemetry} />);
    await waitFor(() => expect(widthOf()).toBeLessThan(97));
    rerender(<DiagnosisPanel diagnosis={{ status: "streaming", raw: "", sent }} telemetry={telemetry} />);
    fireEvent.load(screen.getByAltText("Composite sent to the VLM"));
    expect(widthOf()).toBeCloseTo(4.92, 1);
    act(() => flight.onfinish?.());
    await new Promise((r) => setTimeout(r, 120));
    expect(widthOf()).toBeCloseTo(4.92, 1);
  });
});

describe("Diagnosis dock", () => {
  const from = { left: 40, top: 30, width: 60, height: 30 } as DOMRect;
  const sent = { blob: new Blob(["x"]), width: 242, height: 75, from };
  let observe: (isIntersecting: boolean) => void;
  let animate: ReturnType<typeof vi.fn>;
  let scrollIntoView: ReturnType<typeof vi.fn>;
  const dock = () => screen.queryByRole("button", { name: /show readout/i });

  beforeEach(() => {
    let cb: IntersectionObserverCallback = () => {};
    vi.stubGlobal("IntersectionObserver", class { constructor(c: IntersectionObserverCallback) { cb = c; } observe() {} unobserve() {} disconnect() {} });
    observe = (isIntersecting) => act(() => cb([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver));
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    animate = vi.fn();
    scrollIntoView = vi.fn();
    Object.assign(HTMLElement.prototype, { animate, scrollIntoView });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 400, top: 500, width: 240, height: 90, bottom: 590, right: 640 } as DOMRect);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(400); // slot top is 500: below the fold
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (HTMLElement.prototype as { animate?: unknown }).animate;
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    media(false);
  });

  it("is absent before a region is picked, whatever the scroll position", () => {
    render(<DiagnosisPanel diagnosis={{ status: "idle", raw: "" }} telemetry={telemetry} />);
    observe(false);
    expect(dock()).toBeNull();
  });

  it("appears with a streaming status once a region is picked and the readout is off screen, then hides when it is in view", () => {
    render(<DiagnosisPanel diagnosis={{ status: "streaming", raw: "", sent }} telemetry={telemetry} />);
    expect(dock()).toBeNull(); // visibility not known yet
    observe(false);
    expect(dock()).toHaveTextContent("streaming…");
    expect(dock()).toHaveAttribute("aria-label", expect.stringContaining("Diagnosis"));
    observe(true);
    expect(dock()).toBeNull();
  });

  it("shows the category when the diagnosis is done", () => {
    render(<DiagnosisPanel diagnosis={{ ...done, sent }} telemetry={telemetry} />);
    observe(false);
    expect(dock()).toHaveTextContent("missing_component");
  });

  it("flies the specimen into the dock (same FLIP, clamped spring) instead of the off-screen slot", () => {
    render(<DiagnosisPanel diagnosis={{ status: "streaming", raw: "", sent }} telemetry={telemetry} />);
    observe(false);
    fireEvent.load(screen.getByAltText("Composite sent to the VLM"));
    expect(animate).not.toHaveBeenCalled(); // the slot is not where it lands
    const mini = document.querySelector<HTMLImageElement>(".dock img")!;
    expect(mini).not.toBeNull();
    fireEvent.load(mini);
    expect(animate).toHaveBeenCalledTimes(1);
    const [frames, opts] = animate.mock.calls[0];
    expect(frames[0].transform).toBe("translate(-450px, -500px) scale(0.25)");
    expect(frames[1].transform).toBe("none");
    expect(Math.max(...[...opts.easing.matchAll(/-?\d*\.?\d+/g)].map((m) => Number(m[0])))).toBeLessThanOrEqual(1);
  });

  it("scrolls the readout into view smoothly on tap, or instantly under reduced motion", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<DiagnosisPanel diagnosis={{ status: "streaming", raw: "", sent }} telemetry={telemetry} />);
    observe(false);
    await user.click(dock()!);
    expect(scrollIntoView).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "smooth", block: "start" }));
    unmount();
    media(true);
    render(<DiagnosisPanel diagnosis={{ status: "streaming", raw: "", sent }} telemetry={telemetry} />);
    observe(false);
    await user.click(dock()!);
    expect(scrollIntoView).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "auto" }));
  });
});
