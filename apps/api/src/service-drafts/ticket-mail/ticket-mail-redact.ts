/**
 * THE REDACTION BEFORE ANY TEXT GOES TO THE AI (Acropora OS card ec7b947b, S3b; Balázs, 2026-11-16: the model gets only FILTERED text, no name and no
 * identifier; the PD-001 principle stands).
 *
 * Pure: a function of the text and the names we know. It runs BEFORE the call and is tested here; the AI service cannot tell whether a text it gets
 * was redacted. What it replaces, in this order:
 *   e-mail addresses            -> [E-MAIL]
 *   links (http, https, www)    -> [LINK]
 *   tax numbers, bank accounts, IBANs -> [SZÁM]
 *   phone numbers (HU and international) -> [TELEFON]
 *   any run of five or more digits (an order number, a serial, an id) -> [SZÁM]
 *   a greeting or a closing followed by a name ("Szia Anna", "Üdvözlettel,\nKovács Anna") -> the name -> [NÉV]
 *   every NAME WE KNOW (the sender's, every user's first and last name, with the Hungarian endings: "Annának", "Kovácsékkal") -> [NÉV]
 *
 * WHAT IT CANNOT DO, said plainly: a person's name that we do not know and that follows neither a greeting nor a closing stays in the text. A rule
 * cannot tell an unknown person's name from a product or a place; the unknown names are the residue, and that is why the AI step has a switch of
 * its own, off by default, and why a human reads every draft. Measurements, short numbers, dates and words are left alone.
 */
export interface RedactionCounts {
  names: number;
  emails: number;
  links: number;
  phones: number;
  numbers: number;
}

export interface RedactedMail {
  subject: string;
  text: string;
  counts: RedactionCounts;
}

const NAME = "[NÉV]";

/** A name token worth matching: at least three letters, starting with a capital in the source (a word in lower case is not a name). */
function nameTokens(names: readonly (string | null | undefined)[]): string[] {
  const seen = new Map<string, string>();
  for (const name of names) {
    if (!name) continue;
    for (const part of name.split(/[\s,;()/_-]+/u)) {
      const token = part.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
      if ([...token].length < 3) continue;
      if (!/^\p{Lu}/u.test(token)) continue;
      if (/^(?:kft|zrt|bt|nyrt|rt|és|vagy)$/iu.test(token)) continue;
      const key = token.toLowerCase();
      if (!seen.has(key)) seen.set(key, token);
      // a name that ends in a or e takes the long vowel before an ending: Anna -> Annának, Béla -> Bélával
      const lengthened = token
        .replace(/a$/iu, (v) => (v === "a" ? "á" : "Á"))
        .replace(/e$/iu, (v) => (v === "e" ? "é" : "É"));
      if (lengthened !== token && !seen.has(lengthened.toLowerCase()))
        seen.set(lengthened.toLowerCase(), lengthened);
    }
  }
  return [...seen.values()].sort((a, b) => b.length - a.length);
}

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function namePattern(tokens: readonly string[]): RegExp | null {
  if (tokens.length === 0) return null;
  // a name at the START of a word, with up to six letters of ending after it ("Annának", "Kovácsékkal", "Péterrel"); never inside a word. The
  // price is that a longer name that STARTS with a known one ("Péterfi") is redacted as a name too, which is the safe side of the error.
  return new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${tokens.map(escapeRegex).join("|")})\\p{L}{0,6}(?![\\p{L}\\p{N}])`,
    "giu",
  );
}

const GREETING =
  /((?<![\p{L}\p{N}])(?:Szia|Sziasztok|Szió|Hali|Hello|Helló|Kedves|Tisztelt|Üdv|Üdvözlöm|Jó\s+napot|Dear)[,:!]?[ \t]+)(\p{Lu}[\p{L}.'-]*(?:[ \t]+\p{Lu}[\p{L}.'-]*){0,2})/gu;
const CLOSING =
  /((?<![\p{L}\p{N}])(?:Üdvözlettel|Üdv|Köszönettel|Köszönöm|Köszi|Tisztelettel|Barátsággal|Regards|Best\s+regards|Thanks)[,!.]?[ \t]*\r?\n+[ \t]*)(\p{Lu}[\p{L}.'-]*(?:[ \t]+\p{Lu}[\p{L}.'-]*){0,3})/gu;

function redactText(
  value: string,
  pattern: RegExp | null,
  counts: RedactionCounts,
): string {
  let text = value;
  const count = (
    re: RegExp,
    placeholder: string,
    key: keyof RedactionCounts,
  ) => {
    text = text.replace(re, () => {
      counts[key]++;
      return placeholder;
    });
  };
  count(
    /[^\s@<>()[\]",;:]+@[^\s@<>()[\],;"]+\.[^\s@<>()[\],;"]+/g,
    "[E-MAIL]",
    "emails",
  );
  count(/\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi, "[LINK]", "links");
  count(/(?<![\d-])\d{8}-\d-\d{2}(?![\d-])/g, "[SZÁM]", "numbers");
  count(/(?<![\d-])\d{8}-\d{8}(?:-\d{8})?(?![\d-])/g, "[SZÁM]", "numbers");
  count(
    /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,4})?\b/g,
    "[SZÁM]",
    "numbers",
  );
  count(
    /(?<![\d.])(?:\+36|0036|06)[\s/().-]*\d{1,2}(?:[\s/().-]*\d){6,8}(?!\d)/g,
    "[TELEFON]",
    "phones",
  );
  count(
    /(?<![\d.])\+\d{1,3}(?:[\s().-]*\d){7,12}(?!\d)/g,
    "[TELEFON]",
    "phones",
  );
  count(/(?<![\d.,])\d{5,}(?!\d)/g, "[SZÁM]", "numbers");
  for (const re of [GREETING, CLOSING])
    text = text.replace(re, (_whole, lead: string) => {
      counts.names++;
      return `${lead}${NAME}`;
    });
  if (pattern)
    text = text.replace(pattern, (match) => {
      // a name starts with a capital: the same letters in a lower case word are a word
      if (!/^\p{Lu}/u.test(match)) return match;
      counts.names++;
      return NAME;
    });
  return text;
}

/**
 * THE REDACTED SUBJECT AND TEXT, and what was replaced (counts only: never the text, so a log line can carry them). `knownNames` is every name we
 * know that could appear in a mail: the sender's, every user's.
 */
export function redactForAi(input: {
  subject: string;
  text: string;
  knownNames: readonly (string | null | undefined)[];
}): RedactedMail {
  const counts: RedactionCounts = {
    names: 0,
    emails: 0,
    links: 0,
    phones: 0,
    numbers: 0,
  };
  const pattern = namePattern(nameTokens(input.knownNames));
  return {
    subject: redactText(input.subject, pattern, counts),
    text: redactText(input.text, pattern, counts),
    counts,
  };
}

/** Whether anything is left to read once the placeholders are taken away: a mail that was only names and numbers is not worth a call. */
export function hasReadableText(text: string): boolean {
  return /\p{L}{3,}/u.test(
    text.replace(/\[(?:NÉV|E-MAIL|TELEFON|SZÁM|LINK)\]/g, " "),
  );
}
