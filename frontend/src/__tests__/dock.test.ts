import { DOCK_H, dockPlan, dockStatus, showDock, trayCovered } from "../lib/dock";

const rect = (top: number, height = 80, left = 20, width = 300) => ({ top, height, left, width, bottom: top + height, right: left + width }) as DOMRect;
const VW = 390;
const VH = 844;

describe("showDock (the show/hide decision)", () => {
  it("shows only when a region is picked and the readout is known to be off screen", () => {
    expect(showDock(true, false, false)).toBe(true);
  });
  it("hides once the readout is in view", () => {
    expect(showDock(true, true, false)).toBe(false);
  });
  it("stays hidden before a region is picked, and while visibility is still unknown", () => {
    expect(showDock(false, false, false)).toBe(false);
    expect(showDock(true, null, false)).toBe(false);
  });
  it("never covers the tray", () => {
    expect(showDock(true, false, true)).toBe(false);
  });
});

describe("trayCovered", () => {
  it("is true when any part of the tray sits in the dock's band at the bottom of the viewport", () => {
    expect(trayCovered(rect(VH - DOCK_H - 10), VH)).toBe(true);
    expect(trayCovered(rect(VH - 20), VH)).toBe(true);
  });
  it("is false when the tray is clear of the band, below the fold or scrolled away", () => {
    expect(trayCovered(rect(VH - DOCK_H - 80), VH)).toBe(false);
    expect(trayCovered(rect(VH + 10), VH)).toBe(false);
    expect(trayCovered(rect(-200), VH)).toBe(false);
    expect(trayCovered(undefined, VH)).toBe(false);
  });
});

describe("dockPlan (where the specimen flies)", () => {
  it("flies into the readout slot when it is visible above the dock", () => {
    expect(dockPlan(rect(500), undefined, VW, VH)).toBe("slot");
  });
  it("flies into the dock when the slot is off screen, or hidden behind the dock band", () => {
    expect(dockPlan(rect(VH + 40), undefined, VW, VH)).toBe("dock");
    expect(dockPlan(rect(VH - DOCK_H + 4), undefined, VW, VH)).toBe("dock");
  });
  it("does not fly at all when the dock would cover the tray", () => {
    expect(dockPlan(rect(VH + 40), rect(VH - 30), VW, VH)).toBe("none");
  });
});

describe("dockStatus", () => {
  it("reads streaming while the report is coming in, then the category, then a fault", () => {
    expect(dockStatus("streaming", undefined)).toBe("streaming…");
    expect(dockStatus("done", "solder_bridge")).toBe("solder_bridge");
    expect(dockStatus("done", undefined)).toBe("done");
    expect(dockStatus("error", undefined)).toBe("analysis failed");
  });
});
