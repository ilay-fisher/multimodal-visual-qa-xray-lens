import { nextFocus } from "../lib/focus";

describe("nextFocus", () => {
  const list = ["a", "b", "c"];

  it("moves forward and backward through the list", () => {
    expect(nextFocus(list, "a", false)).toBe("b");
    expect(nextFocus(list, "c", true)).toBe("b");
  });

  it("wraps at both ends so focus never leaves the sheet", () => {
    expect(nextFocus(list, "c", false)).toBe("a");
    expect(nextFocus(list, "a", true)).toBe("c");
  });

  it("enters the list at its first (Tab) or last (Shift+Tab) item when focus is outside it", () => {
    expect(nextFocus(list, "outside", false)).toBe("a");
    expect(nextFocus(list, "outside", true)).toBe("c");
    expect(nextFocus(list, null, false)).toBe("a");
    expect(nextFocus(list, undefined, true)).toBe("c");
  });

  it("stays on a single item and returns undefined for an empty list", () => {
    expect(nextFocus(["only"], "only", false)).toBe("only");
    expect(nextFocus(["only"], "only", true)).toBe("only");
    expect(nextFocus([], "x", false)).toBeUndefined();
  });
});
