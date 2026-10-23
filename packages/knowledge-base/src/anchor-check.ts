/**
 * WHAT A VERBATIM ANCHOR MUST SHOW FOR A FIELD VALUE (plan v4, 7a.1; S3).
 *
 * The AI service's guard (acropora-ai-agent `claim-extraction.ts`) reads the
 * same rules, and the OS does not trust it: these run again here, on the text
 * the OS downloaded itself, before anything is stored. Deterministic, no
 * model: a value that does not show in its anchor is not a field.
 *
 * - A quantity's number stands DIRECTLY BEFORE its unit: "0.5 µM", a range
 *   "0.5-2 µM" / "0.5 to 2 µM" / "between 0.5 and 2 µM", or with its own
 *   error "1.5 ± 0.2 µM" (the error is not a value). In "after 30 days at
 *   0.5 µM" the 30 is days, and in "pH 8.1 and 0.5 µM" the 8.1 is the pH
 *   (barracuda, ai#47, ai#48).
 * - "µM" is read case-sensitively: "µm" is a micrometre.
 * - A mass unit names its basis: a P-basis word (phosphorus, SRP, PO4-P)
 *   means P even next to "phosphate"; a bare "p" is not read (p-values).
 * - A taxon key shows in the anchor by one of its vocabulary forms, or, for a
 *   species, as the usual abbreviation ("A. millepora").
 */

import { normaliseText, splitWords, type Vocabulary } from "./vocabulary.js";

export const PHOSPHATE_UNITS = [
  "µmol/l",
  "mg/l",
  "µg/l",
  "ppm",
  "ppb",
] as const;
export type AnchorUnit = (typeof PHOSPHATE_UNITS)[number];
export const MASS_UNITS: readonly AnchorUnit[] = ["mg/l", "µg/l", "ppm", "ppb"];

/** Spacing squashed: the downloaded text and an anchor meet on it. */
export const squash = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

/** Accents off, the micro sign "u", case kept (for "µM" against "µm"). */
const cased = (value: string) =>
  value.normalize("NFKD").replace(/\p{M}/gu, "").replace(/[µμ]/g, "u");
const folded = (value: string) => cased(value).toLowerCase();

type UnitToken = { pattern: string; cased: boolean };
const UNIT_TOKENS: Record<AnchorUnit, UnitToken[]> = {
  "µmol/l": [
    { pattern: "u ?M(?![A-Za-z])", cased: true },
    {
      pattern:
        "(?:u ?mol(?:es)?|umol|micromol(?:ar|e|es)?|mmol ?m ?-?3)(?![a-z])",
      cased: false,
    },
  ],
  "mg/l": [
    {
      pattern:
        "mg ?(?:\\/|per |\\. ?|·)? ?(?:l|liter|litre|dm-?3)(?![a-z])|mg ?l ?(?:-|−|–)?1(?![0-9])",
      cased: false,
    },
  ],
  "µg/l": [
    {
      pattern:
        "u ?g ?(?:\\/|per |\\. ?|·)? ?(?:l|liter|litre)(?![a-z])|u ?g ?l ?(?:-|−|–)?1(?![0-9])|micrograms? ?(?:\\/|per) ?(?:l|liter|litre)(?![a-z])",
      cased: false,
    },
  ],
  ppm: [{ pattern: "ppm(?![a-z])|parts per million", cased: false }],
  ppb: [{ pattern: "ppb(?![a-z])|parts per billion", cased: false }],
};

const NUMBER = "(\\d+(?:[.,]\\d+)?)";
const ERROR = "(?:\\s*(?:±|\\+\\/-)\\s*\\d+(?:[.,]\\d+)?)?";
const RANGE = "(?:\\s*(?:-|–|—|to)\\s*";
const BETWEEN = `(?<![A-Za-z])[Bb]etween\\s+${NUMBER}${ERROR}\\s+and\\s+${NUMBER}${ERROR}`;

/** Every number of a text, a decimal comma read as a point. */
export function numbersOf(text: string): Set<number> {
  return new Set(
    (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) =>
      Number(n.replace(",", ".")),
    ),
  );
}

export function unitWritten(unit: AnchorUnit, anchor: string): boolean {
  return UNIT_TOKENS[unit].some((t) =>
    new RegExp(`(?<![A-Za-z])(?:${t.pattern})`).test(
      t.cased ? cased(anchor) : folded(anchor),
    ),
  );
}

/** The numbers that stand directly before the unit, ranges and errors included. */
export function numbersAtUnit(unit: AnchorUnit, anchor: string): Set<number> {
  const found = new Set<number>();
  for (const t of UNIT_TOKENS[unit]) {
    const re = new RegExp(
      `(?:${BETWEEN}|(?<![\\d.,])${NUMBER}${ERROR}${RANGE}${NUMBER}${ERROR})?)\\s*(?:${t.pattern})`,
      "g",
    );
    for (const m of (t.cased ? cased(anchor) : folded(anchor)).matchAll(re))
      for (const n of m.slice(1))
        if (n !== undefined) found.add(Number(n.replace(",", ".")));
  }
  return found;
}

const P_BASIS =
  /phosphorus|(?<![a-z])srp(?![a-z])|po ?4 ?[-–]? ?p(?![a-z])|(?<![a-z])p ?[-–] ?po ?4/;
const PO4_BASIS = /phosphate|(?<![a-z])po ?4/;

export function basisWritten(basis: "PO4" | "P", anchor: string): boolean {
  const text = folded(anchor);
  return basis === "P"
    ? P_BASIS.test(text)
    : PO4_BASIS.test(text) && !P_BASIS.test(text);
}

/**
 * Whether the anchor names the taxon: one of its forms as consecutive words,
 * or a species as "<genus initial>. <epithet>". The vocabulary's forms are
 * lower-case Latin names for genera and species, so they meet an English text
 * too; a group form (Hungarian, "kőkorall") will not, and that taxon becomes
 * an editor's question rather than a field.
 */
export function taxonInText(
  vocabulary: Vocabulary,
  key: string,
  anchor: string,
): boolean {
  const taxon = vocabulary.taxa.find((t) => t.key === key);
  if (!taxon) return false;
  const words = splitWords(normaliseText(anchor));
  const has = (form: string[]) =>
    words.some((_, i) => form.every((w, j) => words[i + j] === w));
  if (taxon.forms.some(has)) return true;
  if (taxon.extra.rank !== "SPECIES") return false;
  const text = normaliseText(anchor);
  return taxon.forms.some(
    (form) =>
      form.length === 2 &&
      new RegExp(
        `(?<![\\p{L}])${form[0]![0]}\\.\\s?${form[1]}(?![\\p{L}])`,
        "u",
      ).test(text),
  );
}
