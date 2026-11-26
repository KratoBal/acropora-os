/**
 * THE AI SERVICE'S AQUARIUM GLOSSARY, AS THE OS EDITOR SEES IT (card 7a5ea203, part C).
 *
 * The glossary (the abbreviations the model expands, with their original expression, source language and Hungarian name) is stored,
 * versioned data in the AI service (acropora-ai-agent, #146 to #150). This module is the OS side's shape of it: what the editor reads,
 * what it saves, and the rules it checks BEFORE the AI service does (the service repeats them under its lock).
 *
 * A version is the WHOLE list; a save writes a new version, a restore is a copy of an old one saved as a new one. `approved` only marks
 * a Hungarian name somebody confirmed; it filters nothing in the prompt (acrobot 63253). WHO approved and WHEN is computed by the AI
 * service at save time and shown next to the mark (acrobot 63288).
 */

export const AI_GLOSSARY_LANGUAGES = ["en", "de"] as const;
export type AiGlossaryLanguage = (typeof AI_GLOSSARY_LANGUAGES)[number];

/** The same limits the AI service holds; they also protect the model's instructions, where these texts go unchanged. */
export const AI_GLOSSARY_LIMITS = {
  entries: 100,
  abbreviation: 16,
  original: 120,
  hungarian: 200,
  note: 300,
} as const;

/** One row as the editor saves it. */
export type AiGlossaryEntryInput = {
  abbreviation: string;
  original: string;
  language: AiGlossaryLanguage;
  hungarian: string;
  approved: boolean;
};

/** One row as the editor reads it: the approval's person is a NAME (the OS resolved the id), `null` when not approved. */
export type AiGlossaryEntry = AiGlossaryEntryInput & {
  approvedBy: string | null;
  approvedAt: string | null;
};

/** A stored version's header, for the history list. `createdBy` is a name. */
export type AiGlossaryVersionInfo = {
  version: number;
  createdAt: string;
  createdBy: string;
  note: string;
  entryCount: number;
  active: boolean;
};

export type AiGlossaryVersion = Omit<AiGlossaryVersionInfo, "entryCount"> & {
  entries: AiGlossaryEntry[];
};

/** What the editor sends: the version it started from (`null`: no stored version yet), the whole list and a short note. */
export type AiGlossarySaveInput = {
  expectedVersion: number | null;
  entries: AiGlossaryEntryInput[];
  note: string;
};

/** The answer to a save: the new version and how long the other service instances may still serve the old list. */
export type AiGlossarySaveResult = {
  version: number;
  takesEffectWithinSeconds: number;
};

export type AiGlossaryParse =
  { ok: true; value: AiGlossarySaveInput } | { ok: false; message: string };

/**
 * ONE LINE WITHOUT CONTROL CHARACTERS (barracuda, ai#149): the texts go unchanged into the model's instructions, so a line break or a
 * control, zero-width, separator or writing-direction character could split the rendered list. Tab and line breaks, C0 and C1 controls,
 * the zero-width marks, the line and paragraph separators, the direction controls and the byte order mark are refused.
 */
export function hasAiGlossaryControlCharacter(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f) ||
      (code >= 0x200b && code <= 0x200f) ||
      code === 0x2028 ||
      code === 0x2029 ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069) ||
      code === 0xfeff
    )
      return true;
  }
  return false;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * The save body, strictly. `expectedVersion` is REQUIRED (a number, or `null`): a missing base would silently switch the lost-update
 * guard off. A field this side does not own is refused (`createdBy`, `approvedBy`, `approvedAt` come from the server). The texts are
 * trimmed, then checked: not empty, within the limits, one line, a language of the two, no duplicate abbreviation, at least one row.
 * Messages are Hungarian: they reach the person at the editor.
 */
export function parseAiGlossarySaveInput(body: unknown): AiGlossaryParse {
  if (!isRecord(body)) return { ok: false, message: "A kérés törzse hibás." };
  for (const key of Object.keys(body))
    if (!["expectedVersion", "entries", "note"].includes(key))
      return { ok: false, message: `Ismeretlen mező: ${key}.` };
  if (!("expectedVersion" in body))
    return {
      ok: false,
      message: "Hiányzik, hogy melyik verzióból indultál ki.",
    };
  const expected = body.expectedVersion;
  if (
    expected !== null &&
    !(
      typeof expected === "number" &&
      Number.isInteger(expected) &&
      expected >= 1
    )
  )
    return { ok: false, message: "A kiinduló verzió száma hibás." };
  const noteRaw = body.note ?? "";
  if (typeof noteRaw !== "string")
    return { ok: false, message: "A megjegyzés szöveg legyen." };
  const note = noteRaw.trim();
  if (note.length > AI_GLOSSARY_LIMITS.note)
    return {
      ok: false,
      message: `A megjegyzés legfeljebb ${AI_GLOSSARY_LIMITS.note} karakter lehet.`,
    };
  if (hasAiGlossaryControlCharacter(note))
    return {
      ok: false,
      message: "A megjegyzés egy sorban legyen, vezérlőkarakter nélkül.",
    };
  if (!Array.isArray(body.entries))
    return { ok: false, message: "A szójegyzék sorainak listája hiányzik." };
  if (body.entries.length === 0)
    return { ok: false, message: "A szójegyzék nem lehet üres." };
  if (body.entries.length > AI_GLOSSARY_LIMITS.entries)
    return {
      ok: false,
      message: `A szójegyzék legfeljebb ${AI_GLOSSARY_LIMITS.entries} sor lehet.`,
    };
  const entries: AiGlossaryEntryInput[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of body.entries.entries()) {
    const row = `${index + 1}. sor`;
    if (!isRecord(raw)) return { ok: false, message: `A(z) ${row} hibás.` };
    for (const key of Object.keys(raw))
      if (
        ![
          "abbreviation",
          "original",
          "language",
          "hungarian",
          "approved",
        ].includes(key)
      )
        return { ok: false, message: `A(z) ${row} ismeretlen mezője: ${key}.` };
    const { abbreviation, original, language, hungarian, approved } = raw;
    if (
      typeof abbreviation !== "string" ||
      typeof original !== "string" ||
      typeof hungarian !== "string"
    )
      return { ok: false, message: `A(z) ${row} szövegei hibásak.` };
    if (!(AI_GLOSSARY_LANGUAGES as readonly unknown[]).includes(language))
      return {
        ok: false,
        message: `A(z) ${row} nyelve angol vagy német lehet.`,
      };
    if (typeof approved !== "boolean")
      return { ok: false, message: `A(z) ${row} jóváhagyás jelölője hibás.` };
    const trimmed = {
      abbreviation: abbreviation.trim(),
      original: original.trim(),
      hungarian: hungarian.trim(),
    };
    if (!trimmed.abbreviation || !trimmed.original || !trimmed.hungarian)
      return { ok: false, message: `A(z) ${row} egyik szövege üres.` };
    if (
      trimmed.abbreviation.length > AI_GLOSSARY_LIMITS.abbreviation ||
      trimmed.original.length > AI_GLOSSARY_LIMITS.original ||
      trimmed.hungarian.length > AI_GLOSSARY_LIMITS.hungarian
    )
      return { ok: false, message: `A(z) ${row} szövege túl hosszú.` };
    if (
      hasAiGlossaryControlCharacter(trimmed.abbreviation) ||
      hasAiGlossaryControlCharacter(trimmed.original) ||
      hasAiGlossaryControlCharacter(trimmed.hungarian)
    )
      return {
        ok: false,
        message: `A(z) ${row} szövege egy sorban legyen, vezérlőkarakter nélkül.`,
      };
    if (seen.has(trimmed.abbreviation))
      return {
        ok: false,
        message: `A(z) ${trimmed.abbreviation} rövidítés kétszer szerepel.`,
      };
    seen.add(trimmed.abbreviation);
    entries.push({
      ...trimmed,
      language: language as AiGlossaryLanguage,
      approved,
    });
  }
  return { ok: true, value: { expectedVersion: expected, entries, note } };
}
