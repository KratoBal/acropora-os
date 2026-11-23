import {
  findTeachingReferences,
  type TeachingAudience,
  type TeachingNumber,
  type TeachingPart,
  type TeachingSourceDocument,
} from "./teaching-source.js";

/**
 * THE OUTPUTS OF A TEACHING SOURCE (T5.2, spec v2, point 2): the printable
 * text, the slide outline and the narration, generated from one version of
 * the source and never edited as the source. This module builds their
 * STRUCTURE; drawing a PDF or a PPT file from it is the API's job.
 *
 * Pure: no database, no clock (the generation time comes in), so the same
 * version and the same time give the same output byte for byte.
 *
 * THE NUMBERS COME FROM THE TABLE, in the form the reference names: the
 * written outputs use the written forms, the narration the spoken ones. A
 * number without a spoken form is never made up: its chapter has no
 * narration and says why. An open-question number keeps its value and gets
 * the mark next to it in every written output.
 */

/** The mark next to an open-question number in a written output. */
export const TEACHING_OPEN_MARK = "[nyitott kérdés]";

/** At most this many points on one slide (spec v2, the slide frame). */
export const TEACHING_SLIDE_POINTS = 5;
/** A part without sub-parts: at most this many content slides before "over the frame". */
export const TEACHING_PART_SLIDES = 4;
/** A sub-part: at most this many slides. */
export const TEACHING_SUBPART_SLIDES = 2;

export interface TeachingOutputSource extends TeachingSourceDocument {
  title: string;
  version: number;
}

/** What every output carries in its header or footer, without anyone typing it. */
export interface TeachingOutputStamp {
  title: string;
  author: string;
  editor: string | null;
  audience: TeachingAudience;
  sourceVersion: number;
  generatedAt: string;
  /** "<author> · <N>. verzió · generálva <time>" */
  footer: string;
}

export interface TeachingPrintableNumberRow {
  numberId: string;
  name: string;
  context: string | null;
  value: string;
  open: boolean;
}

export interface TeachingPrintablePart {
  key: string;
  title: string;
  paragraphs: string[];
  subparts: { key: string; title: string; paragraphs: string[] }[];
  /** The numbers the part refers to, for the highlighted table. */
  numbers: TeachingPrintableNumberRow[];
  checklist: string[];
}

export interface TeachingPrintable {
  kind: "PRINTABLE";
  stamp: TeachingOutputStamp;
  subtitle: string | null;
  disclaimer: string | null;
  parts: TeachingPrintablePart[];
}

export type TeachingSlideKind = "TITLE" | "CONTENT" | "CHECKLIST" | "CLOSING";

export interface TeachingSlide {
  kind: TeachingSlideKind;
  partKey: string | null;
  subpartKey: string | null;
  title: string;
  points: string[];
}

export interface TeachingOverFrame {
  partKey: string;
  /** The sub-part, or null for the part's own text. */
  subpartKey: string | null;
  slides: number;
  limit: number;
}

export interface TeachingSlideDeck {
  kind: "SLIDES";
  stamp: TeachingOutputStamp;
  slides: TeachingSlide[];
  /** Where a part did not fit its frame; the editor splits it or accepts the longer deck. */
  overFrame: TeachingOverFrame[];
}

export interface TeachingNarrationChapter {
  partKey: string;
  /** "# N. rész: <title>": the chapter border. */
  heading: string;
  /** null when the part has no narration; `missing` says why. */
  text: string | null;
  missing: "NO_NOTE" | "SUGGESTED_NOTE" | "NO_SPOKEN_FORM" | null;
  /** The numbers whose spoken form is missing (for NO_SPOKEN_FORM). */
  unspeakable: string[];
  /** Open-question numbers the chapter speaks. */
  openNumbers: string[];
}

export interface TeachingNarration {
  kind: "NARRATION";
  stamp: TeachingOutputStamp;
  /** The title, the source and the disclaimer, spoken at the opening. */
  opening: string;
  chapters: TeachingNarrationChapter[];
}

export function teachingOutputStamp(
  source: TeachingOutputSource,
  generatedAt: string,
): TeachingOutputStamp {
  return {
    title: source.title,
    author: source.author,
    editor: source.editor,
    audience: source.audience,
    sourceVersion: source.version,
    generatedAt,
    footer: `${source.author} · ${source.version}. verzió · generálva ${generatedAt}`,
  };
}

type Mode = "written" | "spoken";

/** One reference's text; null when the spoken form is missing. */
function formText(n: TeachingNumber, form: string, mode: Mode): string | null {
  if (mode === "spoken") {
    if (form === "display" || form === "short" || form === "spoken")
      return n.spoken;
    return n.inflections.find((inf) => inf.name === form)?.spoken ?? null;
  }
  if (form === "display") return n.display;
  if (form === "short") return n.short;
  if (form === "spoken") return n.spoken;
  return n.inflections.find((inf) => inf.name === form)?.written ?? null;
}

function isOpen(n: TeachingNumber, open: ReadonlySet<string>): boolean {
  return n.state === "OPEN_QUESTION" || open.has(n.id);
}

/**
 * A text with its references replaced. The source passed its analysis, so
 * every reference resolves; one that does not is left as written (never
 * dropped silently) and reported in `unresolved`.
 */
export function fillTeachingText(
  text: string,
  numbers: readonly TeachingNumber[],
  mode: Mode,
  openIds: ReadonlySet<string> = new Set(),
): { text: string; unresolved: string[]; used: string[] } {
  const byId = new Map(numbers.map((n) => [n.id, n]));
  const { references } = findTeachingReferences(text);
  let out = "";
  let at = 0;
  const unresolved: string[] = [];
  const used: string[] = [];
  for (const ref of references) {
    out += text.slice(at, ref.start);
    at = ref.end;
    const n = byId.get(ref.numberId);
    const value = n ? formText(n, ref.form, mode) : null;
    if (!n || value === null) {
      unresolved.push(ref.numberId);
      out += ref.raw;
      continue;
    }
    used.push(n.id);
    out +=
      mode === "written" && isOpen(n, openIds)
        ? `${value} ${TEACHING_OPEN_MARK}`
        : value;
  }
  return { text: out + text.slice(at), unresolved, used };
}

/** Paragraphs: blank-line separated, trimmed, empty ones dropped. */
function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** A list item's mark at a line's start: "1." or "1)" (kept with the item), or a bullet "-", "–", "•", "*" (dropped: the slide has its own). */
const LIST_ITEM = /^\s*(?:(\d{1,2}[.)])|[-–•*])\s+/;

/**
 * A paragraph's items: a line that starts with a list mark starts its own item; any other line continues the item before it (a
 * soft-wrapped sentence, or a table row). The Akil pilot source (card b731bd4d) has 29 numbered lines, 37 bulleted ones and 120
 * table rows inside paragraphs, and no soft-wrapped line. TABLE ROWS STAY AS THEY WERE (one run of text): one point a row took the
 * pilot from 100 slides to 128 and from 7 over-frame parts to 20, and how a table belongs on a slide is the editor's question.
 */
function paragraphItems(paragraph: string): string[] {
  const items: string[] = [];
  for (const line of paragraph.split("\n")) {
    if (!line.trim()) continue;
    if (!items.length || LIST_ITEM.test(line)) items.push(line);
    else items[items.length - 1] += ` ${line}`;
  }
  return items;
}

/**
 * Sentences, for the slide points. A sentence ends at . ! or ? followed by
 * space and an upper-case letter, so "kb. 4 hét" and "1,026" do not split.
 * A shortened name ("Dr. Kovács") would; the slide then shows two points,
 * and no statement is lost either way.
 *
 * THE LINE STRUCTURE IS KEPT (T5.2, card b731bd4d, acrobot 59390; korall's finding on the stage, version 3 and 4): the paragraph
 * used to be one line, so a numbered list read "... megrepedhet. 3. Kapcsold ki ..." and split into "megrepedhet. 3." and a lone
 * "1.", and a bullet's "-" stood in the middle of a sentence. Each list item and table row is now its own point: a number stays
 * in front of its item's first sentence, a bullet mark is dropped.
 */
export function teachingSentences(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .flatMap(paragraphItems)
    .flatMap((item) => {
      const mark = LIST_ITEM.exec(item);
      const sentences = (mark ? item.slice(mark[0].length) : item)
        .replace(/\s+/g, " ")
        .trim()
        .split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÖŐÚÜŰ])/u)
        .map((s) => s.trim())
        .filter(Boolean);
      if (mark?.[1] && sentences.length)
        sentences[0] = `${mark[1]} ${sentences[0]}`;
      return sentences;
    });
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

const partNumbers = (part: TeachingPart): string[] => {
  const texts = [
    part.text,
    ...part.subparts.map((s) => s.text),
    ...part.checklist,
  ];
  const ids: string[] = [];
  for (const t of texts)
    for (const ref of findTeachingReferences(t).references)
      if (!ids.includes(ref.numberId)) ids.push(ref.numberId);
  return ids;
};

export function buildTeachingPrintable(
  source: TeachingOutputSource,
  generatedAt: string,
  openIds: ReadonlySet<string> = new Set(),
): TeachingPrintable {
  const fill = (t: string) =>
    paragraphs(fillTeachingText(t, source.numbers, "written", openIds).text);
  const byId = new Map(source.numbers.map((n) => [n.id, n]));
  return {
    kind: "PRINTABLE",
    stamp: teachingOutputStamp(source, generatedAt),
    subtitle: source.subtitle,
    disclaimer: source.disclaimer,
    parts: source.parts.map((part) => ({
      key: part.key,
      title: part.title,
      paragraphs: fill(part.text),
      subparts: part.subparts.map((s) => ({
        key: s.key,
        title: s.title,
        paragraphs: fill(s.text),
      })),
      numbers: partNumbers(part).flatMap((id) => {
        const n = byId.get(id);
        return n
          ? [
              {
                numberId: n.id,
                name: n.name,
                context: n.context,
                value: n.display,
                open: isOpen(n, openIds),
              },
            ]
          : [];
      }),
      checklist: part.checklist.map(
        (item) =>
          fillTeachingText(item, source.numbers, "written", openIds).text,
      ),
    })),
  };
}

export function buildTeachingSlides(
  source: TeachingOutputSource,
  generatedAt: string,
  openIds: ReadonlySet<string> = new Set(),
): TeachingSlideDeck {
  const fill = (t: string) =>
    teachingSentences(
      fillTeachingText(t, source.numbers, "written", openIds).text,
    );
  const slides: TeachingSlide[] = [
    {
      kind: "TITLE",
      partKey: null,
      subpartKey: null,
      title: source.title,
      points: [source.subtitle, source.author, source.disclaimer].filter(
        (p): p is string => Boolean(p),
      ),
    },
  ];
  const overFrame: TeachingOverFrame[] = [];
  const content = (
    partKey: string,
    subpartKey: string | null,
    title: string,
    points: string[],
    limit: number,
  ) => {
    const groups = chunk(points, TEACHING_SLIDE_POINTS);
    groups.forEach((group, i) =>
      slides.push({
        kind: "CONTENT",
        partKey,
        subpartKey,
        title:
          groups.length > 1 ? `${title} (${i + 1}/${groups.length})` : title,
        points: group,
      }),
    );
    if (groups.length > limit)
      overFrame.push({ partKey, subpartKey, slides: groups.length, limit });
  };

  for (const part of source.parts) {
    if (part.subparts.length) {
      // the part's own text is its opening slide; each sub-part is its own
      const intro = fill(part.text);
      if (intro.length) content(part.key, null, part.title, intro, 1);
      for (const sub of part.subparts)
        content(
          part.key,
          sub.key,
          `${part.title}: ${sub.title}`,
          fill(sub.text),
          TEACHING_SUBPART_SLIDES,
        );
    } else
      content(
        part.key,
        null,
        part.title,
        fill(part.text),
        TEACHING_PART_SLIDES,
      );

    const items = part.checklist.map(
      (item) => fillTeachingText(item, source.numbers, "written", openIds).text,
    );
    const lists = chunk(items, TEACHING_SLIDE_POINTS);
    lists.forEach((group, i) =>
      slides.push({
        kind: "CHECKLIST",
        partKey: part.key,
        subpartKey: null,
        title:
          lists.length > 1
            ? `${part.title}: ellenőrzőlista (${i + 1}/${lists.length})`
            : `${part.title}: ellenőrzőlista`,
        points: group,
      }),
    );
  }

  const stamp = teachingOutputStamp(source, generatedAt);
  slides.push({
    kind: "CLOSING",
    partKey: null,
    subpartKey: null,
    title: source.title,
    points: [stamp.footer],
  });
  return { kind: "SLIDES", stamp, slides, overFrame };
}

export function buildTeachingNarration(
  source: TeachingOutputSource,
  generatedAt: string,
  openIds: ReadonlySet<string> = new Set(),
): TeachingNarration {
  const byId = new Map(source.numbers.map((n) => [n.id, n]));
  const opening = [
    source.title,
    source.subtitle,
    source.author,
    source.disclaimer,
  ]
    .filter((p): p is string => Boolean(p))
    .map((p) => (/[.!?]$/.test(p.trim()) ? p.trim() : `${p.trim()}.`))
    .join(" ");
  return {
    kind: "NARRATION",
    stamp: teachingOutputStamp(source, generatedAt),
    opening,
    chapters: source.parts.map((part, i) => {
      const heading = `# ${i + 1}. rész: ${part.title}`;
      const empty = {
        partKey: part.key,
        heading,
        text: null,
        unspeakable: [] as string[],
        openNumbers: [] as string[],
      };
      if (!part.speakerNote) return { ...empty, missing: "NO_NOTE" as const };
      if (part.speakerNote.state === "SUGGESTED")
        return { ...empty, missing: "SUGGESTED_NOTE" as const };
      const filled = fillTeachingText(
        part.speakerNote.text,
        source.numbers,
        "spoken",
      );
      if (filled.unresolved.length)
        return {
          ...empty,
          missing: "NO_SPOKEN_FORM" as const,
          unspeakable: [...new Set(filled.unresolved)],
        };
      return {
        partKey: part.key,
        heading,
        text: paragraphs(filled.text).join("\n\n"),
        missing: null,
        unspeakable: [],
        openNumbers: [...new Set(filled.used)].filter((id) => {
          const n = byId.get(id);
          return n ? isOpen(n, openIds) : false;
        }),
      };
    }),
  };
}

export const TEACHING_OUTPUT_KINDS = [
  "PRINTABLE",
  "SLIDES",
  "NARRATION",
] as const;
export type TeachingOutputKind = (typeof TEACHING_OUTPUT_KINDS)[number];

export type TeachingOutputBody =
  TeachingPrintable | TeachingSlideDeck | TeachingNarration;

/** One output of a kind, from one source version, at one time. */
export function buildTeachingOutput(
  kind: TeachingOutputKind,
  source: TeachingOutputSource,
  generatedAt: string,
  openIds: ReadonlySet<string> = new Set(),
): TeachingOutputBody {
  if (kind === "PRINTABLE")
    return buildTeachingPrintable(source, generatedAt, openIds);
  if (kind === "SLIDES")
    return buildTeachingSlides(source, generatedAt, openIds);
  return buildTeachingNarration(source, generatedAt, openIds);
}

/** What an output needs the editor's eye for, read off its body. */
export function teachingOutputFlags(body: TeachingOutputBody): {
  overFrame: number;
  chaptersWithoutNarration: number;
} {
  return {
    overFrame: body.kind === "SLIDES" ? body.overFrame.length : 0,
    chaptersWithoutNarration:
      body.kind === "NARRATION"
        ? body.chapters.filter((c) => c.text === null).length
        : 0,
  };
}

export interface TeachingOutputSent {
  to: string;
  /** Whether the place is a public channel (newsletter, social post, product page). */
  public: boolean;
  byId: string | null;
  at: string;
}

export interface TeachingOutputSummary {
  id: string;
  kind: TeachingOutputKind;
  sourceVersion: number;
  generatedById: string | null;
  generatedAt: string;
  /** The source has a newer version than this output was made from. */
  stale: boolean;
  /** This output was made from the version approved now. */
  approved: boolean;
  overFrame: number;
  chaptersWithoutNarration: number;
  sent: TeachingOutputSent | null;
  /** Edited copies uploaded: the output "differs from the source" (T5.2, spec v2, point 3). */
  edits: number;
  /** Of those, how many still wait for the editor's decision. */
  undecidedEdits: number;
}

export interface TeachingOutputDetail extends TeachingOutputSummary {
  body: TeachingOutputBody;
}

export const TEACHING_SENT_TO_MAX = 300;

/** Where an output went: a named place and whether it is public. */
export function parseTeachingSentInput(
  body: unknown,
):
  | { ok: true; value: { to: string; public: boolean } }
  | { ok: false; message: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body))
    return { ok: false, message: "the record is an object" };
  const record = body as Record<string, unknown>;
  const stray = Object.keys(record).find((k) => k !== "to" && k !== "public");
  if (stray) return { ok: false, message: `unknown field ${stray}` };
  if (
    typeof record.to !== "string" ||
    !record.to.trim() ||
    record.to.length > TEACHING_SENT_TO_MAX
  )
    return {
      ok: false,
      message: `to: where it went, at most ${TEACHING_SENT_TO_MAX} characters`,
    };
  if (typeof record.public !== "boolean")
    return { ok: false, message: "public: true or false" };
  return { ok: true, value: { to: record.to.trim(), public: record.public } };
}
