import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { XRaySlider } from "../components/XRaySlider";
import { inspectFixture } from "./fixtures";

function setup(selectedId: number | null = null) {
  const onSelectBox = vi.fn();
  render(<XRaySlider data={inspectFixture} selectedId={selectedId} onSelectBox={onSelectBox} />);
  return { onSelectBox };
}

describe("XRaySlider", () => {
  it("renders one button per ROI box", () => {
    setup();
    expect(screen.getAllByRole("button", { name: /^Region \d/ })).toHaveLength(2);
  });

  it("calls onSelectBox with the clicked box", async () => {
    const { onSelectBox } = setup();
    await userEvent.setup().click(screen.getByRole("button", { name: /^Region 2/ }));
    expect(onSelectBox).toHaveBeenCalledWith(inspectFixture.boxes[1]);
  });

  it("marks the selected box as pressed", () => {
    setup(0);
    expect(screen.getByRole("button", { name: /^Region 1/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("moves the split with arrow keys", () => {
    setup();
    const handle = screen.getByRole("slider");
    expect(handle).toHaveAttribute("aria-valuenow", "50");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(handle).toHaveAttribute("aria-valuenow", "52");
    fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true });
    expect(handle).toHaveAttribute("aria-valuenow", "42");
    fireEvent.keyDown(handle, { key: "Home" });
    expect(handle).toHaveAttribute("aria-valuenow", "0");
  });

  it("switches to the circular lens mode", async () => {
    setup();
    const lens = screen.getByRole("button", { name: "Lens" });
    await userEvent.setup().click(lens);
    expect(lens).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("slider", { name: /lens/i })).toBeInTheDocument();
  });
});
