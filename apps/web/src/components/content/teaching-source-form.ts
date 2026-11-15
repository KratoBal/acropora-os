import type {
  TeachingInflection,
  TeachingQuantity,
  TeachingValue,
} from "@acropora/types";

/**
 * THE NUMBER FIELDS OF THE TEACHING SOURCE EDITOR AS TEXT (T5.2, slice 3).
 * A value, a range, the paired units and the inflected forms are edited as
 * one short line each, and turned back into the structure before the save.
 * The server parses the result strictly again; these only say early, next to
 * the field, what would not be taken.
 */

const NUMBER = "-?\\d+(?:[.,]\\d+)?";
const VALUE = new RegExp(`^\\s*(${NUMBER})\\s*(?:[-–]\\s*(${NUMBER}))?\\s*$`);
const QUANTITY = new RegExp(
  `^\\s*(${NUMBER})\\s*(?:[-–]\\s*(${NUMBER}))?\\s*(.*?)\\s*$`,
);

const toNumber = (text: string) => Number(text.replace(",", "."));
/**
 * Never in exponent form: `String(1e-7)` is "1e-7", which the value pattern
 * would not read back (barracuda on #2581). No grouping either, so "10000"
 * stays one number; a comma for the decimal point.
 */
const fromNumber = (n: number) =>
  n
    .toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 12 })
    .replace(".", ",");

/** "50", "1,026", "2-4" or "2–4" (a range); null when it is neither. */
export function parseTeachingValue(text: string): TeachingValue | null {
  const match = VALUE.exec(text);
  if (!match) return null;
  const a = toNumber(match[1] as string);
  if (match[2] === undefined) return { kind: "exact", value: a };
  const b = toNumber(match[2]);
  return a < b ? { kind: "range", min: a, max: b } : null;
}

export function teachingValueText(value: TeachingValue): string {
  return value.kind === "exact"
    ? fromNumber(value.value)
    : `${fromNumber(value.min)}-${fromNumber(value.max)}`;
}

/** "35 PSU; 2-3 ppt": the same quantity in other units, separated by ";". */
export function parseTeachingPairs(text: string): TeachingQuantity[] | null {
  const parts = text
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
  const out: TeachingQuantity[] = [];
  for (const part of parts) {
    const match = QUANTITY.exec(part);
    if (!match) return null;
    const value = parseTeachingValue(
      match[2] === undefined ? (match[1] as string) : `${match[1]}-${match[2]}`,
    );
    if (!value) return null;
    out.push({ value, unit: (match[3] ?? "").trim() });
  }
  return out;
}

export function teachingPairsText(pairs: readonly TeachingQuantity[]): string {
  return pairs
    .map((p) => `${teachingValueText(p.value)}${p.unit ? ` ${p.unit}` : ""}`)
    .join("; ");
}

/**
 * One inflected form per line: "hétig = 4 hétig | négy hétig" (the spoken
 * form after the bar may be left out).
 */
export function parseTeachingInflections(
  text: string,
): TeachingInflection[] | null {
  const out: TeachingInflection[] = [];
  for (const line of text.split("\n").map((l) => l.trim())) {
    if (!line) continue;
    const eq = line.indexOf("=");
    if (eq < 1) return null;
    const name = line.slice(0, eq).trim();
    const [written, spoken] = line
      .slice(eq + 1)
      .split("|")
      .map((s) => s.trim());
    if (!name || !written) return null;
    out.push({ name, written, spoken: spoken ? spoken : null });
  }
  return out;
}

export function teachingInflectionsText(
  inflections: readonly TeachingInflection[],
): string {
  return inflections
    .map((i) => `${i.name} = ${i.written}${i.spoken ? ` | ${i.spoken}` : ""}`)
    .join("\n");
}

/** A number id suggested from its name: "Nitri-Bac indító adag" -> "nitri-bac-indito-adag". */
export function suggestTeachingKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}
