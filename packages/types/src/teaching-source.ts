/**
 * THE TEACHING SOURCE (T5.2, spec v2: exchange/otletek-2026-11-03/
 * t5-2-egy-forras-tobb-kimenet-spec-v2.md). A teaching material is written
 * once, here; the printable text, the slide outline and the narration are
 * generated from it (a later slice). It lives 1:1 with a `ContentItem` on the
 * `TEACHING_SOURCE` channel, the way an article body does, so the approval
 * path, the comments and the manufacturer-claim links stay the item's.
 *
 * THE NUMBERS LIVE IN ONE TABLE, and the text refers to them as
 * `{szám: id, alak}` (the form is optional and defaults to the display form).
 * A number is never typed into the text: the dose, the salinity or the target
 * value that goes wrong in one output and not in another is the error the spec
 * is built against.
 *
 * A CONTRADICTING SOURCE NUMBER IS AN OPEN QUESTION, NEVER A CHOICE: two
 * numbers with the same name and the same context but different values both
 * stay, and both read "open question" until the editor tells them apart by
 * their context (spec v2, point 3). Nothing here picks one or averages them.
 *
 * Pure: no database, no clock. The API parses with `parseTeachingSourceInput`
 * and refuses a save whose `analyzeTeachingSource` reports a problem.
 */

export const TEACHING_AUDIENCES = ["INTERNAL", "PUBLIC"] as const;
/**
 * Who an output may reach. A foreign author's material is INTERNAL until the
 * author or the rights holder allows more; from an internal source no
 * public-channel output is generated (spec v2, point 1).
 */
export type TeachingAudience = (typeof TEACHING_AUDIENCES)[number];

export const TEACHING_NOTE_STATES = ["SOURCE", "SUGGESTED"] as const;
/**
 * A speaker note from the source (its author or editor), or one an agent
 * wrote, which stays a suggestion until the editor accepts it.
 */
export type TeachingNoteState = (typeof TEACHING_NOTE_STATES)[number];

export const TEACHING_NUMBER_STATES = ["OK", "OPEN_QUESTION"] as const;
export type TeachingNumberState = (typeof TEACHING_NUMBER_STATES)[number];

export const TEACHING_SOURCE_LIMITS = {
  shortText: 300,
  text: 20_000,
  parts: 50,
  subparts: 30,
  checklist: 40,
  checklistItem: 1_000,
  numbers: 300,
  pairs: 5,
  inflections: 10,
  unit: 40,
  form: 200,
} as const;

/** A part, sub-part or number id: lower-case letters and digits in hyphen-separated groups. */
export const TEACHING_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KEY_MAX = 64;

export type TeachingValue =
  | { kind: "exact"; value: number }
  | { kind: "range"; min: number; max: number };

/** A value with its unit; the unit may be empty for a bare count. */
export interface TeachingQuantity {
  value: TeachingValue;
  unit: string;
}

/** A written form the sentence needs inflected ("kb. 4 hétig"), with its spoken twin. */
export interface TeachingInflection {
  name: string;
  written: string;
  spoken: string | null;
}

export interface TeachingNumber {
  id: string;
  name: string;
  /** When or for what the value holds ("induláskor"); tells two values of one name apart. */
  context: string | null;
  /** The value is approximate ("kb."). */
  approx: boolean;
  quantity: TeachingQuantity;
  /** The same quantity in another unit (salinity in SG and PSU). */
  pairs: TeachingQuantity[];
  /** `null`: global (it may stand in any part); a part key: only in that part. */
  partKey: string | null;
  /** The written forms every output uses, and the spoken one for the narration. */
  display: string;
  short: string;
  /** Given by the source's author or editor, never made up by a generator. */
  spoken: string | null;
  inflections: TeachingInflection[];
  state: TeachingNumberState;
  /** Why the number is an open question, or any editor's note on it. */
  note: string | null;
}

export interface TeachingSubpart {
  key: string;
  title: string;
  text: string;
}

export interface TeachingSpeakerNote {
  text: string;
  state: TeachingNoteState;
}

export interface TeachingPart {
  key: string;
  title: string;
  text: string;
  subparts: TeachingSubpart[];
  checklist: string[];
  speakerNote: TeachingSpeakerNote | null;
}

/** What the editor writes; the title is the content item's. */
export interface TeachingSourceInput {
  /**
   * The version this edit was made on, `null` for the first save. A save on
   * an older version is refused: two editors (or an editor and the content
   * agent) do not overwrite each other silently.
   */
  baseVersion: number | null;
  subtitle: string | null;
  /** Author and source, e.g. "Akil, Modern Reef blog, 2026. 10. 15.". */
  author: string;
  /** The translator or editor. */
  editor: string | null;
  audience: TeachingAudience;
  /** What allows a PUBLIC audience (the author's or rights holder's permission); required for it. */
  publicBasis: string | null;
  /** The source-level statement valid for the whole material (spec v2, point 1). */
  disclaimer: string | null;
  parts: TeachingPart[];
  numbers: TeachingNumber[];
}

/** The stored document: the input without its version guard. */
export type TeachingSourceDocument = Omit<TeachingSourceInput, "baseVersion">;

export type TeachingSourceParse =
  { ok: true; value: TeachingSourceInput } | { ok: false; message: string };

/** Where a reference stands. */
export interface TeachingLocation {
  partKey: string;
  subpartKey: string | null;
  field: "text" | "checklist" | "speakerNote";
  /** The checklist item's index, for `checklist`. */
  index: number | null;
}

export type TeachingFormKey = "display" | "short" | "spoken";

export interface TeachingReference {
  /** The reference as written. */
  raw: string;
  numberId: string;
  /** `display`, `short`, `spoken`, or an inflection's name. */
  form: string;
  start: number;
  end: number;
}

export type TeachingProblemCode =
  | "MALFORMED_REFERENCE"
  | "UNKNOWN_NUMBER"
  | "UNKNOWN_FORM"
  | "NO_SPOKEN_FORM"
  | "OUT_OF_SCOPE"
  | "UNKNOWN_PART";

export interface TeachingProblem {
  code: TeachingProblemCode;
  message: string;
  location: TeachingLocation | null;
}

export interface TeachingOpenQuestion {
  numberId: string;
  /** MARKED: the editor set it; CONFLICT: another number has its name and context with a different value. */
  reasons: ("MARKED" | "CONFLICT")[];
  /** The numbers it contradicts. */
  conflictsWith: string[];
  note: string | null;
}

export interface TeachingSourceAnalysis {
  /** A save with any of these is refused. */
  problems: TeachingProblem[];
  /** Every number, in table order, with where it stands (generated, never written by hand). */
  usages: { numberId: string; locations: TeachingLocation[] }[];
  openQuestions: TeachingOpenQuestion[];
  /** Numbers no text refers to. Not an error: a table may hold a number before its sentence. */
  unused: string[];
}

export interface TeachingSourceVersionSummary {
  version: number;
  contentHash: string;
  createdById: string | null;
  createdAt: string;
}

export interface TeachingSourceDetail extends TeachingSourceDocument {
  contentId: string;
  version: number;
  contentHash: string;
  /** The version the approval fixed; `null` while there is none. */
  approvedVersion: number | null;
  versions: TeachingSourceVersionSummary[];
  updatedAt: string;
}

export interface TeachingSourceEditorData {
  source: TeachingSourceDetail | null;
  analysis: TeachingSourceAnalysis | null;
  editable: boolean;
}

const FIELDS = [
  "baseVersion",
  "subtitle",
  "author",
  "editor",
  "audience",
  "publicBasis",
  "disclaimer",
  "parts",
  "numbers",
];
const PART_FIELDS = [
  "key",
  "title",
  "text",
  "subparts",
  "checklist",
  "speakerNote",
];
const SUBPART_FIELDS = ["key", "title", "text"];
const NUMBER_FIELDS = [
  "id",
  "name",
  "context",
  "approx",
  "quantity",
  "pairs",
  "partKey",
  "display",
  "short",
  "spoken",
  "inflections",
  "state",
  "note",
];

/**
 * THE FORM NAMES A REFERENCE MAY USE, as the spec writes them (with or
 * without accents). An inflection may not take one of these names.
 */
const FORM_ALIASES: Record<string, TeachingFormKey> = {
  display: "display",
  megjelenítési: "display",
  megjelenitesi: "display",
  megjelenítés: "display",
  megjelenites: "display",
  short: "short",
  rövid: "short",
  rovid: "short",
  spoken: "spoken",
  kimondott: "spoken",
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

type Check<T> = { ok: true; value: T } | { ok: false; message: string };
const fail = (message: string): { ok: false; message: string } => ({
  ok: false,
  message,
});

function strayField(
  record: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
): string | null {
  const stray = Object.keys(record).find((key) => !allowed.includes(key));
  return stray ? `${where}: unknown field ${stray}` : null;
}

function text(
  v: unknown,
  where: string,
  max: number,
  required: boolean,
): Check<string> {
  if (typeof v !== "string" || v.length > max)
    return fail(`${where}: a string, at most ${max} characters`);
  if (required && !v.trim()) return fail(`${where}: required`);
  return { ok: true, value: v };
}

/** An optional text: empty or blank is stored as null. */
function optionalText(
  v: unknown,
  where: string,
  max: number,
): Check<string | null> {
  if (v === null || v === undefined) return { ok: true, value: null };
  const checked = text(v, where, max, false);
  if (!checked.ok) return checked;
  return { ok: true, value: checked.value.trim() ? checked.value : null };
}

function key(v: unknown, where: string): Check<string> {
  if (typeof v !== "string" || v.length > KEY_MAX || !TEACHING_KEY.test(v))
    return fail(
      `${where}: lower-case letters and digits, separated by hyphens, at most ${KEY_MAX}`,
    );
  return { ok: true, value: v };
}

function list(v: unknown, where: string, max: number): Check<unknown[]> {
  if (!Array.isArray(v) || v.length > max)
    return fail(`${where}: a list of at most ${max}`);
  return { ok: true, value: v };
}

function quantity(v: unknown, where: string): Check<TeachingQuantity> {
  if (!isRecord(v)) return fail(`${where}: an object`);
  const stray = strayField(v, ["value", "unit"], where);
  if (stray) return fail(stray);
  const unit = text(
    v.unit,
    `${where}.unit`,
    TEACHING_SOURCE_LIMITS.unit,
    false,
  );
  if (!unit.ok) return unit;
  const value = v.value;
  if (!isRecord(value)) return fail(`${where}.value: an object`);
  const finite = (n: unknown): n is number =>
    typeof n === "number" && Number.isFinite(n);
  if (value.kind === "exact") {
    const s = strayField(value, ["kind", "value"], `${where}.value`);
    if (s) return fail(s);
    if (!finite(value.value)) return fail(`${where}.value.value: a number`);
    return {
      ok: true,
      value: {
        value: { kind: "exact", value: value.value },
        unit: unit.value.trim(),
      },
    };
  }
  if (value.kind === "range") {
    const s = strayField(value, ["kind", "min", "max"], `${where}.value`);
    if (s) return fail(s);
    if (!finite(value.min) || !finite(value.max) || value.min >= value.max)
      return fail(`${where}.value: a range is two numbers, min below max`);
    return {
      ok: true,
      value: {
        value: { kind: "range", min: value.min, max: value.max },
        unit: unit.value.trim(),
      },
    };
  }
  return fail(`${where}.value.kind: exact or range`);
}

function parseNumber(v: unknown, where: string): Check<TeachingNumber> {
  const L = TEACHING_SOURCE_LIMITS;
  if (!isRecord(v)) return fail(`${where}: an object`);
  const stray = strayField(v, NUMBER_FIELDS, where);
  if (stray) return fail(stray);
  const id = key(v.id, `${where}.id`);
  if (!id.ok) return id;
  const name = text(v.name, `${where}.name`, L.shortText, true);
  if (!name.ok) return name;
  const context = optionalText(v.context, `${where}.context`, L.shortText);
  if (!context.ok) return context;
  if (typeof v.approx !== "boolean")
    return fail(`${where}.approx: true or false`);
  const q = quantity(v.quantity, `${where}.quantity`);
  if (!q.ok) return q;
  const pairList = list(v.pairs ?? [], `${where}.pairs`, L.pairs);
  if (!pairList.ok) return pairList;
  const pairs: TeachingQuantity[] = [];
  for (const [i, p] of pairList.value.entries()) {
    const parsed = quantity(p, `${where}.pairs[${i}]`);
    if (!parsed.ok) return parsed;
    pairs.push(parsed.value);
  }
  let partKey: string | null = null;
  if (v.partKey !== null && v.partKey !== undefined) {
    const k = key(v.partKey, `${where}.partKey`);
    if (!k.ok) return k;
    partKey = k.value;
  }
  const display = text(v.display, `${where}.display`, L.form, true);
  if (!display.ok) return display;
  const short = text(v.short, `${where}.short`, L.form, true);
  if (!short.ok) return short;
  const spoken = optionalText(v.spoken, `${where}.spoken`, L.form);
  if (!spoken.ok) return spoken;
  const infList = list(
    v.inflections ?? [],
    `${where}.inflections`,
    L.inflections,
  );
  if (!infList.ok) return infList;
  const inflections: TeachingInflection[] = [];
  for (const [i, raw] of infList.value.entries()) {
    const w = `${where}.inflections[${i}]`;
    if (!isRecord(raw)) return fail(`${w}: an object`);
    const s = strayField(raw, ["name", "written", "spoken"], w);
    if (s) return fail(s);
    const n = text(raw.name, `${w}.name`, 40, true);
    if (!n.ok) return n;
    const infName = n.value.trim();
    if (/[,{}]/.test(infName))
      return fail(
        `${w}.name: no comma or brace (it is written in a reference)`,
      );
    if (FORM_ALIASES[infName.toLowerCase()])
      return fail(`${w}.name: "${infName}" is a base form's name`);
    if (inflections.some((other) => other.name === infName))
      return fail(`${w}.name: "${infName}" twice`);
    const written = text(raw.written, `${w}.written`, L.form, true);
    if (!written.ok) return written;
    const sp = optionalText(raw.spoken, `${w}.spoken`, L.form);
    if (!sp.ok) return sp;
    inflections.push({
      name: infName,
      written: written.value,
      spoken: sp.value,
    });
  }
  if (
    typeof v.state !== "string" ||
    !(TEACHING_NUMBER_STATES as readonly string[]).includes(v.state)
  )
    return fail(`${where}.state: ${TEACHING_NUMBER_STATES.join(" or ")}`);
  const note = optionalText(v.note, `${where}.note`, L.shortText);
  if (!note.ok) return note;
  return {
    ok: true,
    value: {
      id: id.value,
      name: name.value.trim(),
      context: context.value?.trim() ?? null,
      approx: v.approx,
      quantity: q.value,
      pairs,
      partKey,
      display: display.value,
      short: short.value,
      spoken: spoken.value,
      inflections,
      state: v.state as TeachingNumberState,
      note: note.value,
    },
  };
}

function parsePart(v: unknown, where: string): Check<TeachingPart> {
  const L = TEACHING_SOURCE_LIMITS;
  if (!isRecord(v)) return fail(`${where}: an object`);
  const stray = strayField(v, PART_FIELDS, where);
  if (stray) return fail(stray);
  const k = key(v.key, `${where}.key`);
  if (!k.ok) return k;
  const title = text(v.title, `${where}.title`, L.shortText, true);
  if (!title.ok) return title;
  const body = text(v.text, `${where}.text`, L.text, false);
  if (!body.ok) return body;
  const subList = list(v.subparts ?? [], `${where}.subparts`, L.subparts);
  if (!subList.ok) return subList;
  const subparts: TeachingSubpart[] = [];
  for (const [i, raw] of subList.value.entries()) {
    const w = `${where}.subparts[${i}]`;
    if (!isRecord(raw)) return fail(`${w}: an object`);
    const s = strayField(raw, SUBPART_FIELDS, w);
    if (s) return fail(s);
    const sk = key(raw.key, `${w}.key`);
    if (!sk.ok) return sk;
    const st = text(raw.title, `${w}.title`, L.shortText, true);
    if (!st.ok) return st;
    const sb = text(raw.text, `${w}.text`, L.text, false);
    if (!sb.ok) return sb;
    subparts.push({ key: sk.value, title: st.value.trim(), text: sb.value });
  }
  const checkList = list(v.checklist ?? [], `${where}.checklist`, L.checklist);
  if (!checkList.ok) return checkList;
  const checklist: string[] = [];
  for (const [i, raw] of checkList.value.entries()) {
    const item = text(raw, `${where}.checklist[${i}]`, L.checklistItem, true);
    if (!item.ok) return item;
    checklist.push(item.value);
  }
  let speakerNote: TeachingSpeakerNote | null = null;
  if (v.speakerNote !== null && v.speakerNote !== undefined) {
    const w = `${where}.speakerNote`;
    if (!isRecord(v.speakerNote)) return fail(`${w}: an object or null`);
    const s = strayField(v.speakerNote, ["text", "state"], w);
    if (s) return fail(s);
    const nt = text(v.speakerNote.text, `${w}.text`, L.text, true);
    if (!nt.ok) return nt;
    const state = v.speakerNote.state;
    if (
      typeof state !== "string" ||
      !(TEACHING_NOTE_STATES as readonly string[]).includes(state)
    )
      return fail(`${w}.state: ${TEACHING_NOTE_STATES.join(" or ")}`);
    speakerNote = { text: nt.value, state: state as TeachingNoteState };
  }
  return {
    ok: true,
    value: {
      key: k.value,
      title: title.value.trim(),
      text: body.value,
      subparts,
      checklist,
      speakerNote,
    },
  };
}

/**
 * The editor's input, strictly: an unknown field, a bad key, a doubled key or
 * id, an over-long text or a PUBLIC audience without its basis is refused. The
 * references are not checked here (`analyzeTeachingSource` does that against
 * the table).
 */
export function parseTeachingSourceInput(body: unknown): TeachingSourceParse {
  const L = TEACHING_SOURCE_LIMITS;
  if (!isRecord(body)) return fail("the teaching source is an object");
  const stray = strayField(body, FIELDS, "source");
  if (stray) return fail(stray);
  const base = body.baseVersion;
  if (
    base !== null &&
    !(typeof base === "number" && Number.isInteger(base) && base >= 1)
  )
    return fail("baseVersion: the version the edit was made on, or null");
  const subtitle = optionalText(body.subtitle, "subtitle", L.shortText);
  if (!subtitle.ok) return subtitle;
  const author = text(body.author, "author", L.shortText, true);
  if (!author.ok) return author;
  const editor = optionalText(body.editor, "editor", L.shortText);
  if (!editor.ok) return editor;
  if (
    typeof body.audience !== "string" ||
    !(TEACHING_AUDIENCES as readonly string[]).includes(body.audience)
  )
    return fail(`audience: ${TEACHING_AUDIENCES.join(" or ")}`);
  const audience = body.audience as TeachingAudience;
  const publicBasis = optionalText(
    body.publicBasis,
    "publicBasis",
    L.shortText,
  );
  if (!publicBasis.ok) return publicBasis;
  if (audience === "PUBLIC" && !publicBasis.value)
    return fail(
      "publicBasis: a public material names what allows it (the author's or the rights holder's permission)",
    );
  const disclaimer = optionalText(
    body.disclaimer,
    "disclaimer",
    L.checklistItem,
  );
  if (!disclaimer.ok) return disclaimer;

  const partList = list(body.parts, "parts", L.parts);
  if (!partList.ok) return partList;
  const parts: TeachingPart[] = [];
  const keys = new Set<string>();
  for (const [i, raw] of partList.value.entries()) {
    const part = parsePart(raw, `parts[${i}]`);
    if (!part.ok) return part;
    // part and sub-part keys share one space: a location names either
    for (const k of [
      part.value.key,
      ...part.value.subparts.map((s) => s.key),
    ]) {
      if (keys.has(k)) return fail(`parts[${i}]: the key ${k} twice`);
      keys.add(k);
    }
    parts.push(part.value);
  }

  const numberList = list(body.numbers, "numbers", L.numbers);
  if (!numberList.ok) return numberList;
  const numbers: TeachingNumber[] = [];
  const ids = new Set<string>();
  for (const [i, raw] of numberList.value.entries()) {
    const n = parseNumber(raw, `numbers[${i}]`);
    if (!n.ok) return n;
    if (ids.has(n.value.id))
      return fail(`numbers[${i}]: the id ${n.value.id} twice`);
    ids.add(n.value.id);
    numbers.push(n.value);
  }

  return {
    ok: true,
    value: {
      baseVersion: base as number | null,
      subtitle: subtitle.value,
      author: author.value.trim(),
      editor: editor.value,
      audience,
      publicBasis: publicBasis.value,
      disclaimer: disclaimer.value,
      parts,
      numbers,
    },
  };
}

/** `{szám: id}` or `{szám: id, alak}`; "szam" without the accent too. */
const REFERENCE = /\{\s*sz[aá]m\s*:\s*([^,{}]*?)\s*(?:,\s*([^,{}]*?)\s*)?\}/giu;
/** Anything that starts like a reference, to catch the ones the pattern does not take. */
const REFERENCE_START = /\{\s*sz[aá]m(?![\p{L}\p{N}])/giu;

/**
 * The references in a text, and the places where something starts like one
 * but is not (a missing brace, a third part): those would print as they are.
 */
export function findTeachingReferences(value: string): {
  references: TeachingReference[];
  malformed: { start: number; raw: string }[];
} {
  const references: TeachingReference[] = [];
  const taken = new Set<number>();
  for (const match of value.matchAll(REFERENCE)) {
    const start = match.index ?? 0;
    taken.add(start);
    const form = (match[2] ?? "").trim();
    references.push({
      raw: match[0],
      numberId: (match[1] ?? "").trim(),
      form: form ? (FORM_ALIASES[form.toLowerCase()] ?? form) : "display",
      start,
      end: start + match[0].length,
    });
  }
  const malformed: { start: number; raw: string }[] = [];
  for (const match of value.matchAll(REFERENCE_START)) {
    const start = match.index ?? 0;
    if (!taken.has(start))
      malformed.push({ start, raw: value.slice(start, start + 40) });
  }
  return { references, malformed };
}

/** Two numbers that state the same quantity: same name and same context, case and spacing aside. */
function quantityKey(n: TeachingNumber): string {
  const norm = (s: string | null) =>
    (s ?? "").toLocaleLowerCase("hu").replace(/\s+/g, " ").trim();
  return `${norm(n.name)}\u0000${norm(n.context)}`;
}

function valueKey(n: TeachingNumber): string {
  const v = n.quantity.value;
  return JSON.stringify([
    n.approx,
    v.kind === "exact" ? [v.value] : [v.min, v.max],
    n.quantity.unit.toLocaleLowerCase("hu"),
  ]);
}

/**
 * EVERYTHING THE TABLE AND THE TEXT SAY ABOUT EACH OTHER: the problems that
 * refuse a save, where each number stands (generated, spec v2 1/A), the open
 * questions (marked, or two values for one quantity), and the unused numbers.
 */
export function analyzeTeachingSource(
  source: Pick<TeachingSourceDocument, "parts" | "numbers">,
): TeachingSourceAnalysis {
  const problems: TeachingProblem[] = [];
  const byId = new Map(source.numbers.map((n) => [n.id, n]));
  const locations = new Map<string, TeachingLocation[]>(
    source.numbers.map((n) => [n.id, []]),
  );
  const partKeys = new Set(source.parts.map((p) => p.key));

  for (const n of source.numbers)
    if (n.partKey !== null && !partKeys.has(n.partKey))
      problems.push({
        code: "UNKNOWN_PART",
        message: `A(z) ${n.id} szám a(z) ${n.partKey} részhez kötött, de ilyen rész nincs.`,
        location: null,
      });

  const scan = (value: string, location: TeachingLocation) => {
    const { references, malformed } = findTeachingReferences(value);
    for (const bad of malformed)
      problems.push({
        code: "MALFORMED_REFERENCE",
        message: `Hibás szám-hivatkozás: "${bad.raw}". Az alak: {szám: azonosító, alak}.`,
        location,
      });
    for (const ref of references) {
      const n = byId.get(ref.numberId);
      if (!n) {
        problems.push({
          code: "UNKNOWN_NUMBER",
          message: `Nincs ilyen szám a táblában: ${ref.numberId} (${ref.raw}).`,
          location,
        });
        continue;
      }
      const base = ref.form === "display" || ref.form === "short";
      if (ref.form === "spoken" && n.spoken === null)
        problems.push({
          code: "NO_SPOKEN_FORM",
          message: `A(z) ${n.id} számnak nincs kimondott alakja (${ref.raw}); azt a szerző vagy a szerkesztő adja meg.`,
          location,
        });
      else if (
        !base &&
        ref.form !== "spoken" &&
        !n.inflections.some((inf) => inf.name === ref.form)
      )
        problems.push({
          code: "UNKNOWN_FORM",
          message: `A(z) ${n.id} számnak nincs "${ref.form}" alakja (${ref.raw}).`,
          location,
        });
      if (n.partKey !== null && n.partKey !== location.partKey)
        problems.push({
          code: "OUT_OF_SCOPE",
          message: `A(z) ${n.id} szám a(z) ${n.partKey} részhez kötött, itt nem állhat (${ref.raw}). Ha több részben is kell, legyen globális.`,
          location,
        });
      locations.get(n.id)?.push(location);
    }
  };

  for (const part of source.parts) {
    const at = (
      field: TeachingLocation["field"],
      subpartKey: string | null = null,
      index: number | null = null,
    ): TeachingLocation => ({ partKey: part.key, subpartKey, field, index });
    scan(part.text, at("text"));
    for (const sub of part.subparts) scan(sub.text, at("text", sub.key));
    part.checklist.forEach((item, i) => scan(item, at("checklist", null, i)));
    if (part.speakerNote) scan(part.speakerNote.text, at("speakerNote"));
  }

  const groups = new Map<string, TeachingNumber[]>();
  for (const n of source.numbers) {
    const k = quantityKey(n);
    groups.set(k, [...(groups.get(k) ?? []), n]);
  }
  const openQuestions: TeachingOpenQuestion[] = [];
  for (const n of source.numbers) {
    const conflictsWith = (groups.get(quantityKey(n)) ?? [])
      .filter((other) => other.id !== n.id && valueKey(other) !== valueKey(n))
      .map((other) => other.id);
    const reasons: TeachingOpenQuestion["reasons"] = [];
    if (n.state === "OPEN_QUESTION") reasons.push("MARKED");
    if (conflictsWith.length) reasons.push("CONFLICT");
    if (reasons.length)
      openQuestions.push({
        numberId: n.id,
        reasons,
        conflictsWith,
        note: n.note,
      });
  }

  const usages = source.numbers.map((n) => ({
    numberId: n.id,
    locations: locations.get(n.id) ?? [],
  }));
  return {
    problems,
    usages,
    openQuestions,
    unused: usages.filter((u) => !u.locations.length).map((u) => u.numberId),
  };
}
