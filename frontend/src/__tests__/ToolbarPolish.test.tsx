import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toolbar } from "../components/Toolbar";
import { presetsFixture } from "./fixtures";

function setup(presetId: string | null = "pcb_board") {
  render(
    <Toolbar presets={presetsFixture} presetId={presetId} sensitivity={0.5} backend="demo" onPresetChange={vi.fn()} onUpload={vi.fn()} onSensitivityChange={vi.fn()} onBackendChange={vi.fn()} />,
  );
}

describe("Preset thumbnails", () => {
  const thumbs = () => [...document.querySelectorAll<HTMLImageElement>(".chips .chip img")];

  it("shows a static thumbnail (decorative) in each preset chip but not in the upload chip", () => {
    setup();
    expect(thumbs().map((i) => i.getAttribute("src"))).toEqual(["/presets/pcb_board.webp", "/presets/aerial_crop.webp", "/presets/ui_layout.webp"]);
    expect(thumbs().every((i) => i.getAttribute("alt") === "")).toBe(true);
    expect(screen.getByRole("button", { name: "+ your pair" }).querySelector("img")).toBeNull();
    expect(screen.getByRole("button", { name: "PCB Hardware Inspection" })).toHaveClass("has-thumb");
  });

  it("falls back to a text-only chip when a thumbnail fails to load, leaving the others alone", () => {
    setup();
    fireEvent.error(thumbs()[1]);
    expect(thumbs()).toHaveLength(2);
    const chip = screen.getByRole("button", { name: "Aerial Crop Monitoring" });
    expect(chip).not.toHaveClass("has-thumb");
    expect(chip).toHaveTextContent("Aerial Crop Monitoring");
    expect(screen.getByRole("button", { name: "PCB Hardware Inspection" })).toHaveClass("has-thumb");
  });

  it("is text only for a preset id the server does not know", () => {
    render(<Toolbar presets={[{ id: "mystery", label: "Mystery", domain_context: "generic" }]} presetId={null} sensitivity={0.5} backend="demo" onPresetChange={vi.fn()} onUpload={vi.fn()} onSensitivityChange={vi.fn()} onBackendChange={vi.fn()} />);
    fireEvent.error(thumbs()[0]);
    expect(thumbs()).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Mystery" })).toBeInTheDocument();
  });
});

describe("Focus trap in the sheets", () => {
  it("moves focus into the pair sheet and cycles Tab and Shift+Tab inside it", async () => {
    setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "+ your pair" }));
    const sheet = screen.getByRole("dialog", { name: "Your pair" });
    const base = within(sheet).getByLabelText("Baseline image");
    const target = within(sheet).getByLabelText("Target image");
    expect(base).toHaveFocus(); // Inspect uploads is disabled, so two stops
    await user.tab();
    expect(target).toHaveFocus();
    await user.tab();
    expect(base).toHaveFocus();
    await user.tab({ shift: true });
    expect(target).toHaveFocus();
    expect(sheet).toContainElement(document.activeElement as HTMLElement);
  });

  it("includes Inspect uploads once both files are chosen", async () => {
    setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "+ your pair" }));
    const sheet = screen.getByRole("dialog");
    await user.upload(within(sheet).getByLabelText("Baseline image"), new File(["a"], "a.png", { type: "image/png" }));
    await user.upload(within(sheet).getByLabelText("Target image"), new File(["b"], "b.png", { type: "image/png" }));
    const go = within(sheet).getByRole("button", { name: "Inspect uploads" });
    await user.tab();
    expect(go).toHaveFocus();
    await user.tab();
    expect(within(sheet).getByLabelText("Baseline image")).toHaveFocus();
  });

  it("traps focus in the engine menu too", async () => {
    setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /engine/i }));
    const items = within(screen.getByRole("menu")).getAllByRole("menuitemradio");
    expect(items[0]).toHaveFocus();
    await user.tab({ shift: true });
    expect(items[2]).toHaveFocus();
    await user.tab();
    expect(items[0]).toHaveFocus();
  });

  it("returns focus to the chip on Escape and on an outside click", async () => {
    setup();
    const user = userEvent.setup();
    const chip = screen.getByRole("button", { name: "+ your pair" });
    await user.click(chip);
    await user.keyboard("{Escape}");
    expect(chip).toHaveFocus();
    await user.click(chip);
    await user.click(document.body);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(chip).toHaveFocus();
  });
});
