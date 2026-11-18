import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toolbar } from "../components/Toolbar";
import { presetsFixture } from "./fixtures";

function setup(presetId: string | null = "pcb_board") {
  const props = {
    presets: presetsFixture,
    presetId,
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

describe("Tray", () => {
  it("renders one chip per preset, marks the active one and fires onPresetChange", async () => {
    const p = setup();
    expect(screen.getAllByRole("button", { name: /Inspection|Monitoring|Check/ })).toHaveLength(3);
    expect(screen.getByRole("button", { name: "PCB Hardware Inspection" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "UI Regression Check" })).toHaveAttribute("aria-pressed", "false");
    await userEvent.setup().click(screen.getByRole("button", { name: "UI Regression Check" }));
    expect(p.onPresetChange).toHaveBeenCalledWith("ui_layout");
  });

  it("marks the upload chip active for a custom pair", () => {
    setup(null);
    expect(screen.getByRole("button", { name: "+ your pair" })).toHaveAttribute("aria-pressed", "true");
  });

  it("fires onSensitivityChange with a number from a real range input", () => {
    const p = setup();
    const range = screen.getByLabelText("Sensitivity");
    expect(range).toHaveAttribute("type", "range");
    fireEvent.change(range, { target: { value: "0.8" } });
    expect(p.onSensitivityChange).toHaveBeenCalledWith(0.8);
  });

  it("shows the engine chip as Demo with a free tag and offers the three backends", async () => {
    const p = setup();
    const user = userEvent.setup();
    const chip = screen.getByRole("button", { name: /engine/i });
    expect(chip).toHaveTextContent("Demo");
    expect(chip).toHaveTextContent("free");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(chip);
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(3);
    expect(within(menu).getByRole("menuitemradio", { name: /Demo/ })).toBeChecked();
    await user.click(within(menu).getByRole("menuitemradio", { name: /Local/ }));
    expect(p.onBackendChange).toHaveBeenCalledWith("local");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens an upload sheet and submits a baseline and target pair", async () => {
    const p = setup();
    const user = userEvent.setup();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "+ your pair" }));
    const sheet = screen.getByRole("dialog", { name: "Your pair" });
    const button = within(sheet).getByRole("button", { name: "Inspect uploads" });
    expect(button).toBeDisabled();
    const base = new File(["a"], "base.png", { type: "image/png" });
    const target = new File(["b"], "target.png", { type: "image/png" });
    await user.upload(within(sheet).getByLabelText("Baseline image"), base);
    await user.upload(within(sheet).getByLabelText("Target image"), target);
    await user.click(button);
    expect(p.onUpload).toHaveBeenCalledWith(base, target);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
