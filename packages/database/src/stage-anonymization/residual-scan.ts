import { createHmac } from "node:crypto";

import { normalizePhone } from "./pseudonymizer.js";
import { foldText } from "./text-scrubber.js";

/**
 * THE RESIDUAL-PERSONAL-DATA SCAN (stage anonymization chain, slice S4; card 07b56a1f; plan 2026-10-12 section 3.5 point 3: "maradek
 * szemelyes adat = 0"). PURE: a dictionary of the REAL personal values and a stream of ANONYMIZED rows in, a report of WHERE a
 * real value was found out. This is the net under the S2 scrubber and the S3 transformer: they replace what they recognise, this
 * looks for what they let through, by the real values themselves, wherever they sit (any column, any JSON depth).
 *
 * THE DICTIONARY HOLDS NO VALUE: only keyed HMAC-SHA256 digests of the normalized real values (e-mail, phone, tax number, IBAN,
 * full name), made with a key that lives for one run. Building it from the source is the runner's job (S5), and it feeds in
 * NATURAL PERSONS' values only (a company's kept name and tax number would be false hits). The report names the model, the field
 * and the KIND of the value that was found, plus a count: never the value, never the row, never a position.
 *
 * WHAT IT FINDS, and what it cannot (said plainly):
 *   e-mail        any address, case-folded;
 *   phone         any digit run that reads as a phone number, by its national digits (so "+36 30 123 4567", "06301234567" and a bare
 *                 "301234567" are one number): the case the S2 pattern scrubber cannot see, a number written without a prefix;
 *   tax number    a 10- or 11-digit run or an 8-digit core, with or without separators, a "HU" prefix;
 *   IBAN          compact, upper case;
 *   full name     two to five words in a row, ignoring case, accents and the order of a two-word name.
 * A surname or a given name ALONE is not in the dictionary (a single word is too common to be a finding), so a name that
 * survives only as one word is not found. A fake that happens to equal a real value (a synthetic name is drawn from a small list)
 * IS reported: that is a true collision worth a look, and the report counts it like any other hit.
 */

export type ResidualKind = "email" | "phone" | "taxNumber" | "iban" | "name";

const TITLES = new Set(["dr", "id", "ifj", "ozv", "prof"]);
const MIN_PHONE_DIGITS = 7;
const MAX_NAME_WORDS = 5;

const nameWords = (value: string): string[] => {
  const words = foldText(value)
    .replace(/\./g, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 1 && TITLES.has(words[0]!)) words.shift();
  return words;
};

export interface ResidualDictionary {
  /** Whether a normalized value of this kind was in the source. */
  has(kind: ResidualKind, normalized: string): boolean;
  /** How many digests per kind (counts only). */
  readonly sizes: Readonly<Record<ResidualKind, number>>;
}

export interface ResidualDictionaryBuilder {
  /** Adds a real value; one that is too short, or not of the kind's shape, is ignored. */
  add(kind: ResidualKind, real: string): void;
  build(): ResidualDictionary;
}

const digitsOf = (value: string): string => value.replace(/\D/g, "");

/** The normalized form(s) of a value that the scan compares on. */
function normalizations(kind: ResidualKind, value: string): string[] {
  switch (kind) {
    case "email": {
      const email = value.trim().toLowerCase();
      return /^[^\s@]+@[^\s@]+$/.test(email) ? [email] : [];
    }
    case "phone": {
      const national = normalizePhone(value);
      return national.length >= MIN_PHONE_DIGITS ? [national] : [];
    }
    case "taxNumber": {
      const digits = digitsOf(value);
      // an 11-digit adoszam also appears as its 8-digit core (an EU VAT number, "HU12345678")
      if (digits.length === 11) return [digits, digits.slice(0, 8)];
      return digits.length === 8 || digits.length === 10 ? [digits] : [];
    }
    case "iban": {
      const compact = value.replace(/\s+/g, "").toUpperCase();
      return /^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(compact) ? [compact] : [];
    }
    case "name": {
      const words = nameWords(value);
      if (words.length < 2 || words.length > MAX_NAME_WORDS) return [];
      return words.length === 2
        ? [words.join(" "), `${words[1]} ${words[0]}`]
        : [words.join(" ")];
    }
  }
}

export function createResidualDictionary(
  runKey: string | Uint8Array,
): ResidualDictionaryBuilder {
  const key = Buffer.from(runKey);
  if (key.length < 32)
    throw new Error("the residual-scan key must be at least 32 bytes");
  const digests = new Map<ResidualKind, Set<string>>();
  const digest = (kind: ResidualKind, normalized: string): string =>
    createHmac("sha256", key)
      .update(`${kind}\u0000${normalized}`)
      .digest("hex");
  return {
    add(kind, real) {
      for (const normalized of normalizations(kind, real)) {
        const set = digests.get(kind) ?? new Set<string>();
        set.add(digest(kind, normalized));
        digests.set(kind, set);
      }
    },
    build() {
      const sizes = {
        email: 0,
        phone: 0,
        taxNumber: 0,
        iban: 0,
        name: 0,
      } as Record<ResidualKind, number>;
      for (const [kind, set] of digests) sizes[kind] = set.size;
      return {
        has: (kind, normalized) =>
          digests.get(kind)?.has(digest(kind, normalized)) ?? false,
        sizes,
      };
    },
  };
}

/** The kinds of real value found in one text (each kind at most once per call; the report counts calls with a find). */
export function scanText(
  dictionary: ResidualDictionary,
  text: string,
): ResidualKind[] {
  const found = new Set<ResidualKind>();

  for (const match of text.matchAll(
    /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu,
  )) {
    if (dictionary.has("email", match[0].toLowerCase())) found.add("email");
  }

  for (const match of text.matchAll(
    /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g,
  )) {
    if (dictionary.has("iban", match[0].replace(/\s+/g, ""))) found.add("iban");
  }

  // a phone number: a digit run with the usual separators, compared by its national digits
  for (const match of text.matchAll(/(?<![\d])\+?\d[\d\s().-]{5,}\d(?!\d)/g)) {
    const national = normalizePhone(match[0]);
    if (
      national.length >= MIN_PHONE_DIGITS &&
      dictionary.has("phone", national)
    )
      found.add("phone");
    // a tax number written with its dashes, or a run of digits that is one
    const digits = digitsOf(match[0]);
    if (
      [8, 10, 11].includes(digits.length) &&
      dictionary.has("taxNumber", digits)
    )
      found.add("taxNumber");
  }
  for (const match of text.matchAll(/(?<![\d])HU ?(\d{8})(?!\d)/gi)) {
    if (dictionary.has("taxNumber", match[1]!)) found.add("taxNumber");
  }

  const tokens = [...text.matchAll(/\p{L}+(?:[-'’]\p{L}+)*/gu)].map((m) => ({
    start: m.index!,
    end: m.index! + m[0].length,
    word: foldText(m[0]),
  }));
  for (let i = 0; i < tokens.length; i += 1) {
    const words: string[] = [tokens[i]!.word];
    for (
      let len = 2;
      len <= MAX_NAME_WORDS && i + len <= tokens.length;
      len += 1
    ) {
      if (
        !/^\s+$/.test(
          text.slice(tokens[i + len - 2]!.end, tokens[i + len - 1]!.start),
        )
      )
        break;
      words.push(tokens[i + len - 1]!.word);
      if (dictionary.has("name", words.join(" "))) found.add("name");
    }
  }
  return [...found];
}

/** Every string inside a JSON-like value, at any depth, arrays included (object KEYS are not values and are not scanned). */
function* strings(value: unknown): Generator<string> {
  if (typeof value === "string") yield value;
  else if (
    value &&
    typeof value === "object" &&
    !Buffer.isBuffer(value) &&
    !(value instanceof Date)
  ) {
    for (const child of Object.values(value)) yield* strings(child);
  }
}

export interface ResidualFinding {
  model: string;
  field: string;
  kind: ResidualKind;
  /** How many values of this column held a real value of this kind. */
  count: number;
}

export interface ResidualReport {
  /** True only when nothing was found. */
  clean: boolean;
  rowsScanned: number;
  findings: ResidualFinding[];
}

/** Scans anonymized rows. Names the column and the kind, and counts: never the value, the row or a position. */
export function scanRows(
  dictionary: ResidualDictionary,
  rows: Iterable<{ model: string; row: Readonly<Record<string, unknown>> }>,
): ResidualReport {
  const counts = new Map<string, ResidualFinding>();
  let rowsScanned = 0;
  for (const { model, row } of rows) {
    rowsScanned += 1;
    for (const [field, value] of Object.entries(row)) {
      for (const text of strings(value)) {
        for (const kind of scanText(dictionary, text)) {
          const id = `${model}.${field}\u0000${kind}`;
          const finding = counts.get(id) ?? { model, field, kind, count: 0 };
          finding.count += 1;
          counts.set(id, finding);
        }
      }
    }
  }
  const findings = [...counts.values()].sort(
    (a, b) =>
      a.model.localeCompare(b.model) ||
      a.field.localeCompare(b.field) ||
      a.kind.localeCompare(b.kind),
  );
  return { clean: findings.length === 0, rowsScanned, findings };
}
