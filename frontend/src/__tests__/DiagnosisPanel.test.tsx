import { render, screen } from "@testing-library/react";
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
