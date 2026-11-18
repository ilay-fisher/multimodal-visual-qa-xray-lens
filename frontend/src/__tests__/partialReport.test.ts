import { partialReport } from "../lib/partialReport";
import type { DefectReport } from "../types";

const full: DefectReport = {
  defect_category: "solder_bridge",
  severity: "high",
  confidence: 0.82,
  visual_evidence: 'Two pads at "U3" are joined.\nTin spans the gap.',
  recommended_action: "Reflow and clean the joint.",
};
const json = JSON.stringify(full);

describe("partialReport", () => {
  it("returns every field and nothing active for a complete payload", () => {
    expect(partialReport(json)).toEqual({ fields: full, active: null });
  });

  it("never loses or invents a field when the payload is split at any index", () => {
    const order = Object.keys(full) as (keyof DefectReport)[];
    for (let i = 0; i <= json.length; i++) {
      const { fields, active } = partialReport(json.slice(0, i));
      for (const k of Object.keys(fields) as (keyof DefectReport)[]) expect(fields[k]).toEqual(full[k]);
      if (active) {
        expect(order).toContain(active.key);
        expect(fields[active.key]).toBeUndefined();
        if (typeof full[active.key] === "string") expect((full[active.key] as string).startsWith(active.text)).toBe(true);
      }
      // Fields only ever appear in payload order.
      const got = order.filter((k) => k in fields);
      expect(got).toEqual(order.slice(0, got.length));
    }
  });

  it("is monotonic: a longer prefix never completes fewer fields", () => {
    let seen = 0;
    for (let i = 0; i <= json.length; i += 12) {
      const n = Object.keys(partialReport(json.slice(0, i)).fields).length;
      expect(n).toBeGreaterThanOrEqual(seen);
      seen = n;
    }
    expect(seen).toBeGreaterThanOrEqual(4);
    expect(Object.keys(partialReport(json).fields)).toHaveLength(5);
  });

  it("reports the string in progress", () => {
    const r = partialReport('{"defect_category":"solder_br');
    expect(r.fields).toEqual({});
    expect(r.active).toEqual({ key: "defect_category", text: "solder_br" });
  });

  it("marks a key whose value has not started as active with empty text", () => {
    expect(partialReport('{"defect_category":').active).toEqual({ key: "defect_category", text: "" });
    expect(partialReport('{"defect_category":"x",').active).toBeNull();
    expect(partialReport('{"defect_cat').active).toBeNull();
  });

  it("decodes escaped quotes and newlines and holds back half an escape", () => {
    const evidence = (raw: string) => partialReport(raw).active?.text;
    expect(evidence('{"visual_evidence":"say \\"hi\\"\\nok')).toBe('say "hi"\nok');
    expect(evidence('{"visual_evidence":"cut\\')).toBe("cut");
    expect(evidence('{"visual_evidence":"snow \\u26')).toBe("snow ");
    expect(evidence('{"visual_evidence":"snow \\u2603')).toBe("snow ☃");
    expect(partialReport('{"visual_evidence":"a\\"}"}').fields.visual_evidence).toBe('a"}');
  });

  it("treats a number as in progress until a delimiter arrives", () => {
    expect(partialReport('{"confidence":0').active).toEqual({ key: "confidence", text: "0" });
    expect(partialReport('{"confidence":0.').active).toEqual({ key: "confidence", text: "0." });
    expect(partialReport('{"confidence":0.8').fields).toEqual({});
    expect(partialReport('{"confidence":0.8,').fields).toEqual({ confidence: 0.8 });
    expect(partialReport('{"confidence":1}').fields).toEqual({ confidence: 1 });
  });

  it("skips leading prose and a json code fence", () => {
    const fenced = "Sure, here is the report:\n```json\n" + json + "\n```";
    expect(partialReport(fenced).fields).toEqual(full);
    expect(partialReport('```json\n{\n  "severity": "low"').active).toBeNull();
    expect(partialReport('```json\n{\n  "severity": "low",').fields).toEqual({ severity: "low" });
  });

  it("ignores unknown keys, wrong types and invalid severities", () => {
    const r = partialReport('{"extra":"x","severity":"catastrophic","confidence":"high","defect_category":null,"visual_evidence":"ok",');
    expect(r.fields).toEqual({ visual_evidence: "ok" });
    expect(partialReport('{"extra":"half').active).toBeNull();
  });

  it("returns empty for an empty string and for garbage, without throwing", () => {
    const empty = { fields: {}, active: null };
    expect(partialReport("")).toEqual(empty);
    expect(partialReport("no json here")).toEqual(empty);
    expect(partialReport("{")).toEqual(empty);
    expect(partialReport("}{]][")).toEqual(empty);
    expect(partialReport('{"a" "b"')).toEqual(empty);
    expect(partialReport("{,,,}")).toEqual(empty);
    expect(partialReport('{"confidence":--}x')).toEqual(empty);
    expect(partialReport(undefined as unknown as string)).toEqual(empty);
  });
});
