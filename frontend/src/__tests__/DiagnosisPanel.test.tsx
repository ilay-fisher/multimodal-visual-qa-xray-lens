import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DiagnosisPanel, type Diagnosis } from "../components/DiagnosisPanel";

const telemetry = { cvTimeMs: 29.4, pixelsFilteredPct: 99.4, fullFrameTokens: 2460, roiTokens: 121 };

const done: Diagnosis = {
  status: "done",
  raw: "{}",
  result: {
    report: {
      defect_category: "missing_component",
      severity: "critical",
      confidence: 0.92,
      visual_evidence: "Pads at U3 are bare.",
      recommended_action: "Reflow and place the part.",
    },
    vlm_time_ms: 412,
    backend: "demo",
    roi_tokens: 15,
    cached: true,
  },
};

describe("DiagnosisPanel", () => {
  it("tags the VLM time as simulated in demo mode only", () => {
    const { rerender } = render(<DiagnosisPanel diagnosis={done} telemetry={telemetry} simulated />);
    expect(screen.getByText("simulated")).toBeInTheDocument();
    rerender(<DiagnosisPanel diagnosis={done} telemetry={telemetry} simulated={false} />);
    expect(screen.queryByText("simulated")).not.toBeInTheDocument();
  });

  it("keeps the sent-to-VLM caption short enough for one line", () => {
    const sent = { blob: new Blob(["x"]), width: 242, height: 75 };
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    render(<DiagnosisPanel diagnosis={{ ...done, sent }} telemetry={telemetry} />);
    expect(screen.getByText("Sent to VLM")).toBeInTheDocument();
    expect(screen.getByText(/^baseline \| target/)).toHaveTextContent("baseline | target · 242×75 px");
  });

  it("renders the parsed report with severity, confidence and cached flag", () => {
    render(<DiagnosisPanel diagnosis={done} telemetry={telemetry} />);
    expect(screen.getByText("missing_component")).toBeInTheDocument();
    const badge = screen.getByText("critical");
    expect(badge).toHaveAttribute("data-severity", "critical");
    expect(screen.getByRole("progressbar", { name: "Confidence" })).toHaveAttribute("aria-valuenow", "92");
    expect(screen.getByText("92%")).toBeInTheDocument();
    expect(screen.getByText("Pads at U3 are bare.")).toBeInTheDocument();
    expect(screen.getByText("Reflow and place the part.")).toBeInTheDocument();
    expect(screen.getByText(/cached/i)).toBeInTheDocument();
  });

  it("shows the raw token stream while streaming", () => {
    render(<DiagnosisPanel diagnosis={{ status: "streaming", raw: '{"defect_cat' }} telemetry={telemetry} />);
    expect(screen.getByText(/defect_cat/)).toBeInTheDocument();
  });

  it("shows an error state", () => {
    const diagnosis: Diagnosis = { status: "error", raw: "", error: { message: "Daily cap reached", code: "budget_exceeded" } };
    render(<DiagnosisPanel diagnosis={diagnosis} telemetry={telemetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Daily cap reached");
  });

  it("shows a thumbnail of the composite sent to the VLM and revokes its URL", () => {
    const create = vi.fn(() => "blob:sent");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const sent = { blob: new Blob(["x"], { type: "image/png" }), width: 108, height: 30 };
    const { unmount } = render(<DiagnosisPanel diagnosis={{ ...done, sent }} telemetry={telemetry} />);
    expect(screen.getByText("baseline | target · 108×30 px")).toBeInTheDocument();
    expect(screen.getByAltText("Composite sent to the VLM")).toHaveAttribute("src", "blob:sent");
    unmount();
    expect(revoke).toHaveBeenCalledWith("blob:sent");
  });
});

const media = (matches: boolean) =>
  (window.matchMedia = vi.fn(() => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia);

describe("instrument readout", () => {
  const rows = () => [...document.querySelectorAll<HTMLElement>("[data-row]")];
  const row = (key: string) => rows().find((r) => r.dataset.row === key)!;
  afterEach(() => media(false));

  it("shows the five labelled rows empty with a dash and keeps the hint while idle", () => {
    render(<DiagnosisPanel diagnosis={{ status: "idle", raw: "" }} telemetry={telemetry} />);
    expect(rows().map((r) => r.dataset.row)).toEqual(["defect_category", "severity", "confidence", "visual_evidence", "recommended_action"]);
    for (const label of ["Category", "Severity", "Confidence", "Evidence", "Action"]) expect(screen.getByText(label)).toBeInTheDocument();
    expect(rows().every((r) => r.dataset.state === "empty" && r.textContent?.includes("–"))).toBe(true);
    expect(screen.getByText(/Select a flagged region/)).toBeInTheDocument();
    expect(document.querySelector(".caret")).toBeNull();
  });

  it("fills rows from the partial raw stream and keeps the caret on the active row only", () => {
    const raw = '{"defect_category":"solder_bridge","severity":"high","confidence":0.8,"visual_evidence":"Two pads are jo';
    render(<DiagnosisPanel diagnosis={{ status: "streaming", raw }} telemetry={telemetry} />);
    expect(within(row("defect_category")).getByText("solder_bridge")).toBeInTheDocument();
    expect(within(row("severity")).getByText("high")).toHaveAttribute("data-severity", "high");
    expect(within(row("confidence")).getByText("80%")).toBeInTheDocument();
    expect(within(row("visual_evidence")).getByText(/Two pads are jo/)).toBeInTheDocument();
    expect(row("recommended_action")).toHaveAttribute("data-state", "empty");
    expect(document.querySelectorAll(".caret")).toHaveLength(1);
    expect(row("visual_evidence").querySelector(".caret")).not.toBeNull();
    expect(row("visual_evidence")).toHaveAttribute("data-active");
  });

  it("puts the caret on the first empty row while waiting for the first token", () => {
    render(<DiagnosisPanel diagnosis={{ status: "streaming", raw: "" }} telemetry={telemetry} />);
    expect(row("defect_category").querySelector(".caret")).not.toBeNull();
  });

  it("uses result.report as the truth once done, with no caret", () => {
    render(<DiagnosisPanel diagnosis={{ ...done, raw: '{"defect_category":"stale"}' }} telemetry={telemetry} />);
    expect(within(row("defect_category")).getByText("missing_component")).toBeInTheDocument();
    expect(within(row("defect_category")).queryByText("stale")).toBeNull();
    expect(document.querySelector(".caret")).toBeNull();
  });

  it("keeps the raw output behind a closed disclosure", () => {
    render(<DiagnosisPanel diagnosis={{ status: "streaming", raw: '{"severity":"low"}' }} telemetry={telemetry} />);
    const details = screen.getByText("raw").closest("details")!;
    expect(details).not.toHaveAttribute("open");
    expect(within(details).getByLabelText("Raw model output")).toHaveTextContent('{"severity":"low"}');
  });

  it("styles errors as a readout fault line and keeps the message", () => {
    const diagnosis: Diagnosis = { status: "error", raw: "", error: { message: "Daily cap reached", code: "budget_exceeded" } };
    render(<DiagnosisPanel diagnosis={diagnosis} telemetry={telemetry} />);
    expect(screen.getByRole("alert")).toHaveClass("fault");
    expect(screen.getByRole("alert")).toHaveTextContent("Daily cap reached");
  });

  it("under reduced motion shows only finished fields and no caret", () => {
    media(true);
    const raw = '{"defect_category":"solder_bridge","severity":"hi';
    render(<DiagnosisPanel diagnosis={{ status: "streaming", raw }} telemetry={telemetry} />);
    expect(within(row("defect_category")).getByText("solder_bridge")).toBeInTheDocument();
    expect(row("severity")).toHaveAttribute("data-state", "empty");
    expect(document.querySelector(".caret")).toBeNull();
  });

  it("never lags a live stream: pacing applies to the simulated demo only", () => {
    const raw = '{"defect_category":"solder_bridge","severity":"high"}';
    const { rerender } = render(<DiagnosisPanel diagnosis={{ status: "streaming", raw: "" }} telemetry={telemetry} simulated={false} />);
    rerender(<DiagnosisPanel diagnosis={{ status: "streaming", raw }} telemetry={telemetry} simulated={false} />);
    expect(within(row("severity")).getByText("high")).toBeInTheDocument();
  });

  it("reveals text that arrives in one burst at a readable pace, then settles on result.report", () => {
    vi.useFakeTimers();
    const full = '{"defect_category":"missing_component","severity":"critical","confidence":0.92,"visual_evidence":"Pads at U3 are bare.","recommended_action":"Reflow and place the part."}';
    const { rerender, container } = render(<DiagnosisPanel diagnosis={{ status: "streaming", raw: "" }} telemetry={telemetry} simulated />);
    rerender(<DiagnosisPanel diagnosis={{ ...done, raw: full }} telemetry={telemetry} simulated />);
    expect(row("recommended_action")).toHaveAttribute("data-state", "empty");
    expect(container.querySelector("[aria-busy]")).toHaveAttribute("aria-busy", "true");
    for (let i = 0; i < 80; i++) act(() => void vi.advanceTimersByTime(16)); // each tick re-arms the next
    expect(within(row("recommended_action")).getByText("Reflow and place the part.")).toBeInTheDocument();
    expect(container.querySelector("[aria-busy]")).toHaveAttribute("aria-busy", "false");
    vi.useRealTimers();
  });

  it("does not announce chunks: the live region stays polite and busy while streaming", () => {
    const { container } = render(<DiagnosisPanel diagnosis={{ status: "streaming", raw: '{"sev' }} telemetry={telemetry} />);
    const live = container.querySelector("[aria-live]")!;
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveAttribute("aria-busy", "true");
  });
});

describe("specimen flight", () => {
  const from = { left: 40, top: 30, width: 60, height: 30 } as DOMRect;
  const sent = { blob: new Blob(["x"]), width: 242, height: 75, from };
  let animate: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    animate = vi.fn();
    Object.assign(HTMLElement.prototype, { animate });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 400, top: 500, width: 240, height: 90 } as DOMRect);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete (HTMLElement.prototype as { animate?: unknown }).animate;
    media(false);
  });

  it("flies the sent composite from the clicked region into the specimen slot", () => {
    render(<DiagnosisPanel diagnosis={{ status: "streaming", raw: "", sent }} telemetry={telemetry} />);
    expect(animate).not.toHaveBeenCalled(); // waits for the pixels so the landing rect is real
    fireEvent.load(screen.getByAltText("Composite sent to the VLM"));
    expect(animate).toHaveBeenCalledTimes(1);
    const [frames, opts] = animate.mock.calls[0];
    // uniform scale (the smaller ratio), centre to centre: no stretch
    expect(frames[0].transform).toBe("translate(-450px, -500px) scale(0.25)");
    expect(frames[1].transform).toBe("none");
    expect(opts.easing).toMatch(/^linear\(/);
    // the landing never overshoots the slot
    const peak = Math.max(...[...opts.easing.matchAll(/-?\d*\.?\d+/g)].map((m) => Number(m[0])));
    expect(peak).toBeLessThanOrEqual(1);
  });

  it("skips the flight when the slot is off screen, without scrolling", () => {
    const scroll = vi.fn();
    Object.assign(window, { scrollTo: scroll });
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(400); // slot top is 500
    render(<DiagnosisPanel diagnosis={{ status: "streaming", raw: "", sent }} telemetry={telemetry} />);
    fireEvent.load(screen.getByAltText("Composite sent to the VLM"));
    expect(animate).not.toHaveBeenCalled();
    expect(scroll).not.toHaveBeenCalled();
  });

  it("does not fly under reduced motion or without a source rect", () => {
    media(true);
    const { unmount } = render(<DiagnosisPanel diagnosis={{ status: "streaming", raw: "", sent }} telemetry={telemetry} />);
    fireEvent.load(screen.getByAltText("Composite sent to the VLM"));
    expect(animate).not.toHaveBeenCalled();
    unmount();
    media(false);
    render(<DiagnosisPanel diagnosis={{ status: "streaming", raw: "", sent: { ...sent, from: undefined } }} telemetry={telemetry} />);
    fireEvent.load(screen.getByAltText("Composite sent to the VLM"));
    expect(animate).not.toHaveBeenCalled();
  });
});

describe("savings instrument", () => {
  const widthOf = (id: string) => parseFloat((document.querySelector<HTMLElement>(`[data-bar="${id}"]`) as HTMLElement).style.width);
  afterEach(() => media(false));

  it("replaces the four-cell telemetry grid", () => {
    render(<DiagnosisPanel diagnosis={done} telemetry={telemetry} />);
    expect(document.querySelector(".telemetry")).toBeNull();
    expect(screen.getByRole("group", { name: "Full frame vs regions" })).toBeInTheDocument();
  });

  it("states the token pair as text for screen readers, with the unit and the saving", () => {
    render(<DiagnosisPanel diagnosis={done} telemetry={telemetry} />);
    expect(screen.getByText("Full frame 2,460 est. tokens, regions 121, 95.1% fewer")).toBeInTheDocument();
  });

  it("draws Regions as its share of Full frame under reduced motion, with no roll", () => {
    media(true);
    render(<DiagnosisPanel diagnosis={done} telemetry={telemetry} />);
    expect(widthOf("tokens-full")).toBe(100);
    expect(widthOf("tokens-regions")).toBeCloseTo(4.92, 1);
    expect(document.querySelector("[data-counter]")).toHaveTextContent("95.1%");
  });

  it("keeps a tiny ratio visible as a sliver while the number stays honest", () => {
    media(true);
    render(<DiagnosisPanel diagnosis={done} telemetry={{ ...telemetry, fullFrameTokens: 100000, roiTokens: 1 }} />);
    expect(widthOf("tokens-regions")).toBeGreaterThan(0);
    expect(screen.getByText("Full frame 100,000 est. tokens, regions 1, 99.9% fewer")).toBeInTheDocument();
  });

  it("shows the measured benchmark, tagged measured, with its source and the README numbers", () => {
    media(true);
    render(<DiagnosisPanel diagnosis={done} telemetry={telemetry} />);
    expect(screen.getByText("measured")).toBeInTheDocument();
    expect(screen.getByText("benchmark · Haiku 5.5 · 4 regions")).toBeInTheDocument();
    expect(screen.getByText(/Full frame 17,838 ms, regions 10,034 ms, 43\.7% faster/)).toBeInTheDocument();
    expect(widthOf("latency-regions")).toBeCloseTo((10034 / 17838) * 100, 1);
  });

  it("tags the token estimate live and keeps the benchmark out of this call's time", () => {
    render(<DiagnosisPanel diagnosis={{ status: "idle", raw: "" }} telemetry={telemetry} />);
    expect(screen.getAllByText("live").length).toBeGreaterThan(0);
    const call = screen.getByText("This call").closest("div")!;
    expect(call).toHaveTextContent("–");
    expect(call).not.toHaveTextContent("10,034");
  });

  it("shows this call's VLM time, simulated in demo and live otherwise", () => {
    const { rerender } = render(<DiagnosisPanel diagnosis={done} telemetry={telemetry} simulated />);
    const call = () => screen.getByText("This call").closest("div")!;
    expect(call()).toHaveTextContent("412 ms");
    expect(within(call()).getByText("simulated")).toBeInTheDocument();
    rerender(<DiagnosisPanel diagnosis={done} telemetry={telemetry} simulated={false} />);
    expect(call()).toHaveTextContent("412 ms");
    expect(within(call()).getByText("live")).toBeInTheDocument();
    expect(within(call()).queryByText("simulated")).toBeNull();
  });

  it("keeps CV time and pixels filtered as one quiet line", () => {
    render(<DiagnosisPanel diagnosis={done} telemetry={telemetry} />);
    expect(screen.getByText(/^CV 29 ms · 99\.4% pixels filtered/)).toBeInTheDocument();
  });

  it("carries the accent on the Regions bars only", () => {
    render(<DiagnosisPanel diagnosis={done} telemetry={telemetry} />);
    const accented = [...document.querySelectorAll<HTMLElement>("[data-bar][data-accent]")].map((e) => e.dataset.bar);
    expect(accented).toEqual(["tokens-regions", "latency-regions"]);
  });

  it("shows nothing invented when there is no data yet, or when regions exceed the frame", () => {
    media(true);
    const { rerender } = render(<DiagnosisPanel diagnosis={done} telemetry={{ ...telemetry, fullFrameTokens: 0, roiTokens: 0 }} />);
    expect(screen.queryByText(/est\. tokens/)).toBeNull();
    rerender(<DiagnosisPanel diagnosis={done} telemetry={{ ...telemetry, fullFrameTokens: 100, roiTokens: 300 }} />);
    expect(screen.getByText("Full frame 100 est. tokens, regions 300")).toBeInTheDocument();
    expect(widthOf("tokens-regions")).toBe(100);
  });

  it("springs Regions down from the full-frame length and rolls the counter, once per new data", async () => {
    const { rerender } = render(<DiagnosisPanel diagnosis={{ status: "idle", raw: "" }} telemetry={telemetry} />);
    expect(widthOf("tokens-regions")).toBe(100);
    expect(document.querySelector("[data-counter]")).toHaveTextContent("0.0%");
    await waitFor(() => expect(widthOf("tokens-regions")).toBeCloseTo(4.92, 1));
    await waitFor(() => expect(document.querySelector("[data-counter]")).toHaveTextContent("95.1%"), { timeout: 3000 });
    // a region click changes the diagnosis, not the data: the bars do not replay
    const same = { ...telemetry };
    rerender(<DiagnosisPanel diagnosis={done} telemetry={{ ...same }} />);
    expect(widthOf("tokens-regions")).toBeCloseTo(4.92, 1);
    // new data replays them
    rerender(<DiagnosisPanel diagnosis={done} telemetry={{ ...same, roiTokens: 60 }} />);
    expect(widthOf("tokens-regions")).toBe(100);
  });
});

describe("one loud motion at a time", () => {
  const from = { left: 40, top: 30, width: 60, height: 30 } as DOMRect;
  const sent = { blob: new Blob(["x"]), width: 242, height: 75, from };
  afterEach(() => {
    vi.restoreAllMocks();
    delete (HTMLElement.prototype as { animate?: unknown }).animate;
  });

  it("holds the bars at full length while the region flight runs, then lets them spring", async () => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const flight: { onfinish?: () => void } = {};
    Object.assign(HTMLElement.prototype, { animate: vi.fn(() => flight) });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 400, top: 500, width: 240, height: 90 } as DOMRect);
    const bar = () => parseFloat(document.querySelector<HTMLElement>('[data-bar="tokens-regions"]')!.style.width);
    const { rerender } = render(<DiagnosisPanel diagnosis={{ status: "streaming", raw: "", sent }} telemetry={{ ...telemetry, roiTokens: 200 }} />);
    fireEvent.load(screen.getByAltText("Composite sent to the VLM"));
    rerender(<DiagnosisPanel diagnosis={{ status: "streaming", raw: "", sent }} telemetry={telemetry} />);
    await new Promise((r) => setTimeout(r, 80));
    expect(bar()).toBe(100);
    act(() => flight.onfinish?.());
    await waitFor(() => expect(bar()).toBeCloseTo(4.92, 1));
  });
});
