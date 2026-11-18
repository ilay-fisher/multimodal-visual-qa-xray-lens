import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toolbar } from "../components/Toolbar";
import { presetsFixture } from "./fixtures";

function setup() {
  const props = {
    presets: presetsFixture,
    presetId: "pcb_board",
    sensitivity: 0.5,
    backend: "demo" as const,
    onPresetChange: vi.fn(),
    onUpload: vi.fn(),
    onSensitivityChange: vi.fn(),
    onBackendChange: vi.fn(),
  };
  render(<Toolbar {...props} />);
  return props;
}

describe("Toolbar", () => {
  it("lists the presets and fires onPresetChange", () => {
    const p = setup();
    expect(screen.getByRole("option", { name: "UI Regression Check" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Preset"), { target: { value: "ui_layout" } });
    expect(p.onPresetChange).toHaveBeenCalledWith("ui_layout");
  });

  it("fires onSensitivityChange with a number", () => {
    const p = setup();
    fireEvent.change(screen.getByLabelText("Sensitivity"), { target: { value: "0.8" } });
    expect(p.onSensitivityChange).toHaveBeenCalledWith(0.8);
  });

  it("fires onBackendChange and offers the three backends", () => {
    const p = setup();
    expect(screen.getByRole("option", { name: "Demo Mode" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Local MLX/Ollama" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Cloud API" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("VLM backend"), { target: { value: "local" } });
    expect(p.onBackendChange).toHaveBeenCalledWith("local");
  });

  it("uploads a custom baseline and target pair", async () => {
    const p = setup();
    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: "Inspect uploads" });
    expect(button).toBeDisabled();
    const base = new File(["a"], "base.png", { type: "image/png" });
    const target = new File(["b"], "target.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Baseline image"), base);
    await user.upload(screen.getByLabelText("Target image"), target);
    await user.click(button);
    expect(p.onUpload).toHaveBeenCalledWith(base, target);
  });
});
