import { createSseParser } from "../api";

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

describe("createSseParser", () => {
  it("parses several events delivered in one chunk", () => {
    const parse = createSseParser();
    const out = parse(
      frame("status", { stage: "inference", backend: "demo" }) +
        frame("token", { text: "{\"a\"" }) +
        frame("token", { text: ": 1}" }),
    );
    expect(out.map((e) => e.event)).toEqual(["status", "token", "token"]);
    expect(out[1]).toEqual({ event: "token", data: { text: "{\"a\"" } });
  });

  it("handles an event split in the middle across chunks", () => {
    const parse = createSseParser();
    const full = frame("token", { text: "hello world" });
    const cut = 25;
    expect(parse(full.slice(0, cut))).toEqual([]);
    expect(parse(full.slice(cut))).toEqual([{ event: "token", data: { text: "hello world" } }]);
  });

  it("handles a split between the event line and the data line and CRLF endings", () => {
    const parse = createSseParser();
    expect(parse("event: token\r\n")).toEqual([]);
    const out = parse('data: {"text":"x"}\r\n\r\n');
    expect(out).toEqual([{ event: "token", data: { text: "x" } }]);
  });

  it("emits typed error events", () => {
    const parse = createSseParser();
    const out = parse(frame("error", { message: "slow down", code: "rate_limited" }));
    expect(out).toEqual([{ event: "error", data: { message: "slow down", code: "rate_limited" } }]);
  });

  it("ignores malformed json and unknown events", () => {
    const parse = createSseParser();
    const out = parse("event: token\ndata: {oops\n\n" + frame("ping", {}) + frame("token", { text: "ok" }));
    expect(out).toEqual([{ event: "token", data: { text: "ok" } }]);
  });
});
