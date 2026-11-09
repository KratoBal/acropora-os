import type { Pseudonymizer } from "./pseudonymizer.js";

/**
 * THE FREE-TEXT SCRUBBER (stage anonymization chain, slice S2; card 07b56a1f; plan 2026-10-12 section 3.2, the "Szabad szoveg" row).
 * PURE: text in, text out; no database, no file. Human-written text (notes, job entries, ticket descriptions, mail subjects)
 * can carry what the structured columns carry, so the same fakes must stand in it: the same real e-mail becomes the same fake
 * e-mail, the same real person the same fake name, as in the column of that person.
 *
 * TWO KINDS OF MATCH, found on the ORIGINAL text and applied in one pass (so a fake is never scanned again, and a fake that
 * happens to equal another real name is not replaced twice):
 *   1. PATTERNS: e-mail addresses, IBANs (a valid mod-97 one, or a Hungarian one of the right shape: a typo'd real IBAN must not
 *      survive), Hungarian account numbers (`8-8` and `8-8-8`), company tax numbers (`8-1-2`, and `HU` plus eight digits),
 *      a personal tax id ONLY next to the words "adoazonosito" (a bare ten-digit number starting with 8 is far more often an
 *      order or a ticket number), and phone numbers written with a country prefix (+36, 0036, 06, or another +CC). A phone
 *      number written without a prefix ("30 123 4567") is NOT caught here: nothing in the text says it is a phone number; the
 *      residual check of the chain (S4) looks for the real digits.
 *   2. NAMES from a dictionary of REAL FULL NAMES (two or more words) given by the caller: matched ignoring case and accents
 *      ("kovacs anna"), in either order for a two-word name, and with a Hungarian suffix on the last word ("Kovács Annának":
 *      up to six letters). A single word (a bare surname) is NOT matched: "Kiss" and "Balogh" are also ordinary words, and
 *      "Anna" is a given name of thousands of people. The plan's own risk table says what this leaves: a name that is not in
 *      the dictionary, or written alone, survives.
 * The dictionary holds real names, in memory only, and is never returned.
 */

export interface ScrubStats {
  email: number;
  iban: number;
  bankAccount: number;
  taxNumber: number;
  personalTaxId: number;
  phone: number;
  name: number;
}

export interface TextScrubber {
  scrubText(text: string): string;
  /** Counts of replacements since the scrubber was made, by kind. Counts only: never a value. */
  readonly stats: Readonly<ScrubStats>;
}

const TITLES = new Set(["dr", "id", "ifj", "özv", "ozv", "prof"]);
const MAX_NAME_WORDS = 5;
const MAX_SUFFIX_LETTERS = 6;

export const foldText = (value: string): string =>
  value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** The words of a real name, without leading titles and trailing dots. */
function nameWords(real: string): string[] {
  const words = real
    .normalize("NFC")
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/\.+$/, ""))
    .filter(Boolean);
  while (words.length > 1 && TITLES.has(foldText(words[0]!))) words.shift();
  return words;
}

const ibanChecksumValid = (compact: string): boolean => {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{4,30}$/.test(compact)) return false;
  const moved = compact.slice(4) + compact.slice(0, 4);
  const numeric = [...moved]
    .map((c) => (/\d/.test(c) ? c : String(c.charCodeAt(0) - 55)))
    .join("");
  return BigInt(numeric) % 97n === 1n;
};

interface Span {
  start: number;
  end: number;
  kind: keyof ScrubStats;
  fake: string;
  /** Pattern spans win over name spans that start at the same place. */
  priority: number;
}

export function createTextScrubber(
  engine: Pseudonymizer,
  realNames: readonly string[] = [],
): TextScrubber {
  const stats: ScrubStats = {
    email: 0,
    iban: 0,
    bankAccount: 0,
    taxNumber: 0,
    personalTaxId: 0,
    phone: 0,
    name: 0,
  };

  // the dictionary: folded words joined by one space, to the fake name of that real person
  const dictionary = new Map<string, string>();
  let longest = 2;
  for (const real of realNames) {
    const words = nameWords(real);
    if (words.length < 2 || words.length > MAX_NAME_WORDS) continue;
    const fake = engine.personName(words.join(" "));
    const keys = [words.map(foldText).join(" ")];
    if (words.length === 2) keys.push(foldText(`${words[1]} ${words[0]}`));
    for (const key of keys) if (!dictionary.has(key)) dictionary.set(key, fake);
    longest = Math.max(longest, words.length);
  }

  const patternSpans = (text: string): Span[] => {
    const spans: Span[] = [];
    const add = (
      rx: RegExp,
      kind: keyof ScrubStats,
      fake: (match: RegExpExecArray) => string | null,
      group = 0,
    ) => {
      for (const match of text.matchAll(rx)) {
        const made = fake(match as RegExpExecArray);
        if (made === null) continue;
        const indices = (
          match as RegExpMatchArray & { indices?: [number, number][] }
        ).indices;
        const [start, end] =
          group === 0 || !indices
            ? [match.index!, match.index! + match[0].length]
            : indices[group]!;
        spans.push({ start, end, kind, fake: made, priority: 0 });
      }
    };

    add(
      /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu,
      "email",
      (m) => engine.email(m[0]),
    );

    add(
      /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g,
      "iban",
      (m) => {
        const compact = m[0].replace(/\s+/g, "");
        const huShape = /^HU\d{26}$/.test(compact);
        return huShape || ibanChecksumValid(compact) ? engine.iban(m[0]) : null;
      },
    );

    add(/(?<!\d)\d{8}-\d{8}(?:-\d{8})?(?!\d)/g, "bankAccount", (m) =>
      engine.bankAccountNumber(m[0]),
    );

    add(/(?<!\d)\d{8}-\d-\d{2}(?!\d)/g, "taxNumber", (m) =>
      engine.companyTaxNumber(m[0]),
    );
    add(/(?<![A-Za-z0-9])HU ?\d{8}(?!\d)/gi, "taxNumber", (m) =>
      engine.euTaxNumber(m[0]),
    );

    add(
      /(adóazonosító(?: jel(?:e)?)?|adoazonosito(?: jel(?:e)?)?|adóazonosítója)[^\d\n]{0,12}(8\d{9})(?!\d)/dgi,
      "personalTaxId",
      (m) => engine.personalTaxId(m[2]!),
      2,
    );

    add(
      /(?<![\w+])(?:\+36|0036|06)[ .-]?\(?\d{1,2}\)?[ .-]?\d{3}[ .-]?\d{3,4}(?!\d)/g,
      "phone",
      (m) => engine.phone(m[0]),
    );
    add(
      /(?<![\w+])\+(?!36)\d{1,3}(?:[ .-]?\d{2,4}){2,4}(?!\d)/g,
      "phone",
      (m) => engine.phone(m[0]),
    );
    return spans;
  };

  const nameSpans = (text: string): Span[] => {
    if (dictionary.size === 0) return [];
    const spans: Span[] = [];
    const tokens = [...text.matchAll(/\p{L}+(?:[-'’]\p{L}+)*/gu)].map((m) => ({
      start: m.index!,
      end: m.index! + m[0].length,
      word: m[0],
    }));
    let i = 0;
    while (i < tokens.length) {
      let matched = false;
      for (
        let len = Math.min(longest, tokens.length - i);
        len >= 2 && !matched;
        len -= 1
      ) {
        // the words must be separated by whitespace only
        let adjacent = true;
        for (let k = i; k < i + len - 1; k += 1) {
          if (!/^\s+$/.test(text.slice(tokens[k]!.end, tokens[k + 1]!.start)))
            adjacent = false;
        }
        if (!adjacent) continue;
        const words = tokens.slice(i, i + len).map((t) => foldText(t.word));
        const last = words[len - 1]!;
        let fake = dictionary.get(words.join(" "));
        let suffix = "";
        if (fake === undefined) {
          for (
            let cut = 1;
            cut <= MAX_SUFFIX_LETTERS &&
            last.length - cut >= 2 &&
            fake === undefined;
            cut += 1
          ) {
            const trimmed = [
              ...words.slice(0, -1),
              last.slice(0, last.length - cut),
            ].join(" ");
            const found = dictionary.get(trimmed);
            if (found !== undefined) {
              fake = found;
              suffix = tokens[i + len - 1]!.word.slice(last.length - cut);
            }
          }
        }
        if (fake !== undefined) {
          spans.push({
            start: tokens[i]!.start,
            end: tokens[i + len - 1]!.end,
            kind: "name",
            fake: fake + suffix,
            priority: 1,
          });
          i += len;
          matched = true;
        }
      }
      if (!matched) i += 1;
    }
    return spans;
  };

  return {
    scrubText(text) {
      if (!text) return text;
      const spans = [...patternSpans(text), ...nameSpans(text)].sort(
        (a, b) =>
          a.start - b.start ||
          b.end - b.start - (a.end - a.start) ||
          a.priority - b.priority,
      );
      let out = "";
      let cursor = 0;
      for (const span of spans) {
        if (span.start < cursor) continue; // overlaps a span already taken
        out += text.slice(cursor, span.start) + span.fake;
        cursor = span.end;
        stats[span.kind] += 1;
      }
      return out + text.slice(cursor);
    },
    get stats() {
      return { ...stats };
    },
  };
}
