import { act, fireEvent, render, screen } from "@testing-library/react";
import { XRaySlider } from "../components/XRaySlider";
import { inspectFixture } from "./fixtures";

const FLAG = "xray.sweep";
let visible: (() => void) | null = null;

/** Controllable IntersectionObserver: call `visible()` to report the stage on screen. */
function mockObserver() {
  class IO {
    constructor(private cb: IntersectionObserverCallback) {
      visible = () => this.cb([{ isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal("IntersectionObserver", IO);
}

function mockReducedMotion(reduced: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: reduced && q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }));
}

function setup(selectedId: number | null = null) {
  const onSelectBox = vi.fn();
  const view = render(<XRaySlider data={inspectFixture} selectedId={selectedId} onSelectBox={onSelectBox} />);
  const stage = view.container.querySelector(".xray") as HTMLElement;
  return { onSelectBox, stage, ...view };
}

const range = () => screen.getByRole("slider", { name: "Scan position" }) as HTMLInputElement;
const lens = (stage: HTMLElement) => Number(stage.style.getPropertyValue("--lens"));
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  sessionStorage.setItem(FLAG, "1"); // most tests are about the static instrument, not the sweep
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout", "performance"] });
  mockObserver();
  mockReducedMotion(false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
  visible = null;
});

describe("XRaySlider: regions", () => {
  it("renders one button per ROI box", () => {
    setup();
    expect(screen.getAllByRole("button", { name: /^Region \d/ })).toHaveLength(2);
  });

  it("calls onSelectBox with the clicked box",  () => {
    const { onSelectBox } = setup();
    fireEvent.click(screen.getByRole("button", { name: /^Region 2/ }));
    expect(onSelectBox).toHaveBeenCalledWith(inspectFixture.boxes[1]);
  });

  it("marks the selected box as pressed", () => {
    setup(0);
    expect(screen.getByRole("button", { name: /^Region 1/ })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("XRaySlider: native range", () => {
  it("is a real range input with a label and value text", () => {
    setup();
    const r = range();
    expect(r.tagName).toBe("INPUT");
    expect(r).toHaveAttribute("type", "range");
    expect(r).toHaveAttribute("min", "0");
    expect(r).toHaveAttribute("max", "100");
    expect(r).toHaveAttribute("step", "1");
    expect(r.value).toBe("50");
    expect(r).toHaveAttribute("aria-valuetext", "Scan 50%");
  });

  it("changes value with the keyboard", () => {
    setup();
    const r = range();
    fireEvent.keyDown(r, { key: "ArrowRight" });
    expect(r.value).toBe("51");
    fireEvent.keyDown(r, { key: "ArrowLeft", shiftKey: true });
    expect(r.value).toBe("41");
    fireEvent.keyDown(r, { key: "Home" });
    expect(r.value).toBe("0");
    expect(r).toHaveAttribute("aria-valuetext", "Scan 0%");
    fireEvent.keyDown(r, { key: "End" });
    expect(r.value).toBe("100");
  });

  it("follows drags and keeps the visual knob out of the accessibility tree", () => {
    const { stage } = setup();
    fireEvent.change(range(), { target: { value: "73" } });
    expect(range()).toHaveAttribute("aria-valuetext", "Scan 73%");
    expect(stage.querySelector(".rail")).toHaveAttribute("aria-hidden", "true");
  });

  it("no longer has a circle lens mode", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Lens" })).toBeNull();
    expect(screen.queryByRole("group", { name: /lens mode/i })).toBeNull();
    expect(screen.getAllByRole("slider")).toHaveLength(1);
  });

  it("shows the CV time on the scan side", () => {
    setup();
    expect(screen.getByText("CV diff · 12 ms")).toBeInTheDocument();
  });
});

describe("XRaySlider: hold for baseline", () => {
  it("shows the baseline while the button is held and releases on pointer up", () => {
    setup();
    const hold = screen.getByRole("button", { name: /hold for baseline/i });
    expect(screen.queryByAltText("Baseline")).toBeNull();
    fireEvent.pointerDown(hold);
    expect(screen.getByAltText("Baseline")).toBeInTheDocument();
    fireEvent.pointerUp(hold);
    expect(screen.queryByAltText("Baseline")).toBeNull();
  });

  it("releases when the pointer leaves the button", () => {
    setup();
    const hold = screen.getByRole("button", { name: /hold for baseline/i });
    fireEvent.pointerDown(hold);
    fireEvent.pointerLeave(hold);
    expect(screen.queryByAltText("Baseline")).toBeNull();
  });

  it("works with the B key while the range has focus", () => {
    setup();
    const r = range();
    r.focus();
    fireEvent.keyDown(r, { key: "b" });
    expect(screen.getByAltText("Baseline")).toBeInTheDocument();
    fireEvent.keyUp(r, { key: "b" });
    expect(screen.queryByAltText("Baseline")).toBeNull();
  });

  it("releases when focus leaves while B is held", () => {
    setup();
    const r = range();
    fireEvent.keyDown(r, { key: "B" });
    fireEvent.blur(r);
    expect(screen.queryByAltText("Baseline")).toBeNull();
  });

  it("is reachable by keyboard: Space holds, release returns", () => {
    setup();
    const hold = screen.getByRole("button", { name: /hold for baseline/i });
    expect(hold).toHaveAttribute("aria-keyshortcuts", "B");
    fireEvent.keyDown(hold, { key: " " });
    expect(screen.getByAltText("Baseline")).toBeInTheDocument();
    fireEvent.keyUp(hold, { key: " " });
    expect(screen.queryByAltText("Baseline")).toBeNull();
  });
});

describe("XRaySlider: first-run sweep", () => {
  beforeEach(() => sessionStorage.clear());

  it("waits until the stage is visible, then sweeps and finishes at 50", () => {
    const { stage } = setup();
    expect(stage).toHaveAttribute("data-sweep", "idle");
    act(() => visible?.());
    expect(stage).toHaveAttribute("data-sweep", "running");
    advance(900);
    expect(lens(stage)).toBeLessThan(45); // heading left towards 15
    advance(900);
    expect(lens(stage)).toBeGreaterThan(55); // heading right towards 85
    advance(3500);
    expect(stage).toHaveAttribute("data-sweep", "done");
    expect(lens(stage)).toBe(50);
    expect(range().value).toBe("50");
  });

  it("runs once per session", () => {
    const first = setup();
    act(() => visible?.());
    expect(sessionStorage.getItem(FLAG)).toBeTruthy();
    first.unmount();
    const again = setup();
    act(() => visible?.());
    expect(again.stage).toHaveAttribute("data-sweep", "skipped");
  });

  it("still sweeps when sessionStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { stage } = setup();
    act(() => visible?.());
    expect(stage).toHaveAttribute("data-sweep", "running");
  });

  it.each([
    ["pointer", (r: HTMLElement) => fireEvent.pointerDown(r)],
    ["key", (r: HTMLElement) => fireEvent.keyDown(r, { key: "ArrowRight" })],
    ["focus", (r: HTMLElement) => act(() => r.focus())],
  ])("is cancelled immediately by %s input", (_name, input) => {
    const { stage } = setup();
    act(() => visible?.());
    advance(300);
    input(range());
    expect(stage).toHaveAttribute("data-sweep", "cancelled");
  });

  it("hands the lens back to the user after cancelling", () => {
    const { stage } = setup();
    act(() => visible?.());
    advance(500);
    fireEvent.pointerDown(range());
    fireEvent.change(range(), { target: { value: "30" } });
    advance(3000);
    expect(lens(stage)).toBe(30);
  });

  it("shows the Pick a region hint once the sweep ends, and hides it after a region click", async () => {
    const { stage } = setup();
    act(() => visible?.());
    expect(screen.queryByText("Pick a region")).toBeNull();
    advance(3500);
    expect(screen.getByText("Pick a region")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Region 1/ }));
    expect(screen.queryByText("Pick a region")).toBeNull();
    expect(stage).toHaveAttribute("data-sweep", "done");
  });
});

describe("XRaySlider: inertia", () => {
  it("lets the divider trail the input, overshoot a little and settle", () => {
    const { stage } = setup();
    fireEvent.change(range(), { target: { value: "90" } });
    advance(48);
    const early = lens(stage);
    expect(early).toBeGreaterThan(50);
    expect(early).toBeLessThan(80);
    let peak = early;
    for (let i = 0; i < 90; i++) {
      advance(16);
      peak = Math.max(peak, lens(stage));
    }
    expect(peak).toBeGreaterThan(90);
    expect(lens(stage)).toBe(90);
  });
});

describe("XRaySlider: reduced motion", () => {
  beforeEach(() => {
    sessionStorage.clear();
    mockReducedMotion(true);
  });

  it("skips the sweep and shows the finished hint", () => {
    const { stage } = setup();
    act(() => visible?.());
    expect(stage).toHaveAttribute("data-sweep", "skipped");
    expect(lens(stage)).toBe(50);
    expect(screen.getByText("Pick a region")).toBeInTheDocument();
  });

  it("tracks the input directly with no inertia", () => {
    const { stage } = setup();
    fireEvent.change(range(), { target: { value: "88" } });
    expect(lens(stage)).toBe(88);
  });
});
