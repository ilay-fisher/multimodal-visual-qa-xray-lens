import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { DiagnosisPanel, type Diagnosis } from "../components/DiagnosisPanel";

const telemetry = { cvTimeMs: 12.4, pixelsFilteredPct: 97.8, tokenSavingsPct: 97.7 };

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

  it("renders all four telemetry values", () => {
    render(<DiagnosisPanel diagnosis={done} telemetry={telemetry} />);
    expect(screen.getByText("12.4 ms")).toBeInTheDocument();
    expect(screen.getByText("97.8%")).toBeInTheDocument();
    expect(screen.getByText("97.7%")).toBeInTheDocument();
    expect(screen.getByText("412 ms")).toBeInTheDocument();
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
