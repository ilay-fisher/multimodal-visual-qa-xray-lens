import type { DefectReport, Severity } from "../types";

export interface PartialReport {
  /** DefectReport fields whose value is complete, typed. */
  fields: Partial<DefectReport>;
  /** The key being written right now with its value so far (numbers as raw text), if any. */
  active: { key: keyof DefectReport; text: string } | null;
}

const KEYS: readonly string[] = ["defect_category", "severity", "confidence", "visual_evidence", "recommended_action"];
const SEVERITIES: readonly string[] = ["low", "medium", "high", "critical"];
const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" };

/** Reads the JSON string starting at the quote `s[start]`; a half-finished escape is held back. */
function readString(s: string, start: number): { value: string; end: number; done: boolean } {
  let value = "";
  let i = start + 1;
  while (i < s.length) {
    const c = s[i];
    if (c === '"') return { value, end: i + 1, done: true };
    if (c !== "\\") {
      value += c;
      i++;
    } else if (s[i + 1] === "u") {
      const hex = s.slice(i + 2, i + 6);
      if (!/^[0-9a-f]{4}$/i.test(hex)) break;
      value += String.fromCharCode(parseInt(hex, 16));
      i += 6;
    } else if (i + 1 < s.length) {
      value += ESCAPES[s[i + 1]] ?? s[i + 1];
      i += 2;
    } else break;
  }
  return { value, end: i, done: false };
}

/**
 * Tolerant parse of the streamed diagnosis JSON. `raw` is whatever has arrived so far, split
 * anywhere, possibly preceded by prose or a code fence. Never throws; unparseable input yields
 * no fields. Unknown keys, wrong value types and unknown severities are skipped silently.
 */
export function partialReport(raw: string): PartialReport {
  const out: PartialReport = { fields: {}, active: null };
  const s = typeof raw === "string" ? raw : "";
  let i = s.indexOf("{") + 1;
  if (i === 0) return out;
  const skip = (re: RegExp) => {
    while (i < s.length && re.test(s[i])) i++;
  };
  for (;;) {
    skip(/[\s,]/);
    if (s[i] !== '"') return out;
    const k = readString(s, i);
    i = k.end;
    if (!k.done) return out;
    skip(/\s/);
    if (s[i++] !== ":") return out;
    skip(/\s/);
    const key = KEYS.includes(k.value) ? (k.value as keyof DefectReport) : null;
    if (i >= s.length) return key ? { ...out, active: { key, text: "" } } : out;

    let value: string | number | null = null;
    if (s[i] === '"') {
      const v = readString(s, i);
      i = v.end;
      if (!v.done) return key ? { ...out, active: { key, text: v.value } } : out;
      value = v.value;
    } else {
      const token = /^[^\s,}\]]*/.exec(s.slice(i))![0];
      i += token.length;
      if (i >= s.length) return key ? { ...out, active: { key, text: token } } : out;
      const n = Number(token);
      value = token !== "" && Number.isFinite(n) ? n : null;
    }
    const ok = key === "confidence" ? typeof value === "number" : typeof value === "string" && (key !== "severity" || SEVERITIES.includes(value));
    if (key && ok) (out.fields as Record<string, unknown>)[key] = value as Severity | string | number;
  }
}
