/** FNV-1a over canonical JSON: equal values hash equally whatever their key order. */

const OFFSET = 2166136261;

export function fnvNumber(h: number, v: number): number {
  return Math.imul(h ^ v, 16777619) >>> 0;
}

export function fnvString(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

export const fnvStart = () => OFFSET;

/** JSON with object keys sorted, so two equal values always give the same text. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`cannot hash ${value}: state must be finite numbers`);
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).filter((k) => (value as Record<string, unknown>)[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
}
