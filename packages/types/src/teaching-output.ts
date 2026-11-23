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

/** At most this many points on one slide (spec v2, the slide frame); a lone last point of a text run is the one exception, see `TEACHING_SLIDE_POINTS_WITH_ORPHAN`. */
export const TEACHING_SLIDE_POINTS = 5;
/** A part without sub-parts: at most this many content slides before "over the frame". */
export const TEACHING_PART_SLIDES = 4;
/** A sub-part: at most this many slides. */
export const TEACHING_SUBPART_SLIDES = 2;
/** A table on a slide: at most this many rows besides the header (spec v2); a longer table continues on the next slide with the header again. */
export const TEACHING_TABLE_ROWS = 6;
/** A lone last point of a part joins the slide before it, which then shows this many points (still readable); it is never a slide of its own. */
export const TEACHING_SLIDE_POINTS_WITH_ORPHAN = TEACHING_SLIDE_POINTS + 1;
/** A caption before a table is at most this many characters (or ends in a colon and is at most `TEACHING_NOTE_MAX`); a note after it at most `TEACHING_NOTE_MAX`. */
export const TEACHING_CAPTION_MAX = 80;
export const TEACHING_NOTE_MAX = 160;

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

/**
 * A table of a source, on one slide: the header and at most `TEACHING_TABLE_ROWS` rows, every row as many cells as the header; and the
 * caption line before it and the one note after it, when the text had them next to the table ("Protokoll", "Fontos: ...").
 */
export interface TeachingSlideTable {
  header: string[];
  rows: string[][];
  before: string[];
  after: string[];
}

export interface TeachingSlide {
  kind: TeachingSlideKind;
  partKey: string | null;
  subpartKey: string | null;
  title: string;
  /**
   * The slide's points. On a table slide they are the caption, the header, the rows and the note as text (the header and the rows as
   * "a | b | c"), for a reader that does not draw the table; a renderer that does draws `table` and leaves the points.
   */
  points: string[];
  table?: TeachingSlideTable;
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
  /** Where a part did not fit its frame (its TEXT slides: a table slide is not counted); the editor splits it or accepts the longer deck. */
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

/** A point of a slide, with what the layout needs to know about it. */
interface TeachingPoint {
  text: string;
  /**
   * The first, short sentence of a list item that has more ("1. Hatalmas felület." and then its explanation): a title-like point
   * never ends a slide, because the slide would end on a title and the explanation start the next one (korall, 2026-11-23, 13th slide).
   */
  keepWithNext: boolean;
}

/** A piece of a part's text: its points, or a table (a run of lines with "|" in them). */
type TeachingBlock =
  | { kind: "points"; points: TeachingPoint[] }
  | { kind: "table"; header: string[]; rows: string[][] };

/** A title-like first sentence: a numbered or bulleted item's short opening sentence (at most this many characters, mark included). */
const TITLE_LIKE_MAX = 60;

/**
 * Sentences, for the slide points. A sentence ends at . ! or ? followed by
 * space and an upper-case letter, so "kb. 4 hét" and "1,026" do not split.
 * A shortened name ("Dr. Kovács") would; the slide then shows two points,
 * and no statement is lost either way.
 *
 * THE LINE STRUCTURE IS KEPT (T5.2, card b731bd4d, acrobot 59390; korall's finding on the stage, version 3 and 4): the paragraph
 * used to be one line, so a numbered list read "... megrepedhet. 3. Kapcsold ki ..." and split into "megrepedhet. 3." and a lone
 * "1.", and a bullet's "-" stood in the middle of a sentence. Each list item is now its own point: a number stays in front of its
 * item's first sentence, a bullet mark is dropped.
 */
function itemPoints(item: string): TeachingPoint[] {
  const mark = LIST_ITEM.exec(item);
  const sentences = (mark ? item.slice(mark[0].length) : item)
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÖŐÚÜŰ])/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (mark?.[1] && sentences.length)
    sentences[0] = `${mark[1]} ${sentences[0]}`;
  return sentences.map((text, i) => ({
    text,
    keepWithNext:
      Boolean(mark) &&
      i === 0 &&
      sentences.length > 1 &&
      text.length <= TITLE_LIKE_MAX,
  }));
}

/** A table row as text: its cells joined with " | ", trimmed (the form a .pptx table row reads back as). */
const tableRowText = (row: readonly string[]): string => row.join(" | ").trim();

/** A table row's cells: split at "|", trimmed; the empty first or last cell of " | x" and "x |" is a cell. */
const tableCells = (line: string): string[] =>
  line.split("|").map((cell) => cell.trim());

/**
 * A paragraph's blocks. A run of two or more lines that all hold a "|" is a TABLE (T5.2, card b731bd4d, korall 2026-11-23: a table is
 * one unit of a slide, its header and rows together, and a row is not a sentence): the first line is the header, every row has as many
 * cells as the widest line. The other lines are items as before.
 */
function paragraphBlocks(paragraph: string): TeachingBlock[] {
  const blocks: TeachingBlock[] = [];
  const lines = paragraph.split("\n").filter((line) => line.trim());
  let at = 0;
  const textRun: string[] = [];
  const flushText = () => {
    if (!textRun.length) return;
    const items: string[] = [];
    for (const line of textRun)
      if (!items.length || LIST_ITEM.test(line)) items.push(line);
      else items[items.length - 1] += ` ${line}`;
    const points = items.flatMap(itemPoints);
    if (points.length) blocks.push({ kind: "points", points });
    textRun.length = 0;
  };
  while (at < lines.length) {
    let end = at;
    while (end < lines.length && (lines[end] ?? "").includes("|")) end += 1;
    if (end - at >= 2) {
      flushText();
      const rows = lines.slice(at, end).map(tableCells);
      const width = Math.max(...rows.map((row) => row.length));
      const padded = rows.map((row) => [
        ...row,
        ...Array<string>(width - row.length).fill(""),
      ]);
      blocks.push({
        kind: "table",
        header: padded[0] ?? [],
        rows: padded.slice(1),
      });
      at = end;
    } else {
      textRun.push(lines[at] ?? "");
      at += 1;
    }
  }
  flushText();
  return blocks;
}

/** A part's text as blocks: its paragraphs' points and tables, in order. */
function teachingBlocks(text: string): TeachingBlock[] {
  return text.split(/\n\s*\n/).flatMap(paragraphBlocks);
}

/** The points of a text as plain sentences (a table's header and rows as "a | b | c" lines, for a reader that has no table). */
export function teachingSentences(text: string): string[] {
  return teachingBlocks(text).flatMap((block) =>
    block.kind === "points"
      ? block.points.map((point) => point.text)
      : [block.header, ...block.rows].map(tableRowText),
  );
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

/** What one slide holds: its points, and a table when the slide is a table. */
interface SlideBody {
  points: string[];
  table?: TeachingSlideTable;
}

/**
 * The points of a text run, cut into slides of at most `TEACHING_SLIDE_POINTS` (T5.2, card b731bd4d, korall 2026-11-23):
 *  - a title-like point (`keepWithNext`) never ends a slide: it moves to the start of the next one, with its explanation;
 *  - a last slide of ONE point is not a slide: the point joins the slide before it, which then shows
 *    `TEACHING_SLIDE_POINTS_WITH_ORPHAN` points. (A run of one point is a slide.)
 */
function pointSlides(points: readonly TeachingPoint[]): SlideBody[] {
  const groups: TeachingPoint[][] = [];
  let current: TeachingPoint[] = [];
  for (const point of points) {
    current.push(point);
    if (current.length === TEACHING_SLIDE_POINTS) {
      if (point.keepWithNext) {
        current.pop();
        groups.push(current);
        current = [point];
      } else {
        groups.push(current);
        current = [];
      }
    }
  }
  if (current.length) groups.push(current);
  const orphan = groups.length > 1 ? groups[groups.length - 1] : undefined;
  if (orphan?.length === 1) {
    groups.pop();
    groups[groups.length - 1]?.push(...orphan);
  }
  return groups.map((group) => ({ points: group.map((point) => point.text) }));
}

/** A caption of a table: a short last point before it ("Protokoll"), or one that ends in a colon. */
const isCaption = (text: string): boolean =>
  text.length <= TEACHING_CAPTION_MAX ||
  (text.endsWith(":") && text.length <= TEACHING_NOTE_MAX);

type LayoutItem =
  | { kind: "run"; points: TeachingPoint[] }
  | {
      kind: "table";
      header: string[];
      rows: string[][];
      before: string[];
      after: string[];
    };

/**
 * A text's slides, in the order of its blocks: points are cut as `pointSlides` says; a table is its own slide, its header and at most
 * `TEACHING_TABLE_ROWS` rows (a longer table goes on with the header again). The rows are not sentences: they do not fill a slide's
 * points, and a table is one slide of the frame however many cells it has. A caption line right before a table, and one short note
 * right after it, stay on the table's slide (a slide with only the caption, or only the note, is the orphan the layout avoids).
 */
function layoutBlocks(blocks: readonly TeachingBlock[]): SlideBody[] {
  const items: LayoutItem[] = [];
  for (const block of blocks) {
    const last = items[items.length - 1];
    if (block.kind === "points") {
      if (last?.kind === "run") last.points.push(...block.points);
      else items.push({ kind: "run", points: [...block.points] });
    } else
      items.push({
        kind: "table",
        header: block.header,
        rows: block.rows,
        before: [],
        after: [],
      });
  }
  // the caption first (the last point of the run before a table), then the note (the whole run after it, when it is one short point)
  items.forEach((item, i) => {
    const before = items[i - 1];
    if (item.kind !== "table" || before?.kind !== "run") return;
    const caption = before.points[before.points.length - 1];
    if (caption && isCaption(caption.text)) {
      before.points.pop();
      item.before.push(caption.text);
    }
  });
  items.forEach((item, i) => {
    const next = items[i + 1];
    if (item.kind !== "table" || next?.kind !== "run") return;
    const [note] = next.points;
    if (
      next.points.length === 1 &&
      note &&
      note.text.length <= TEACHING_NOTE_MAX
    ) {
      next.points.shift();
      item.after.push(note.text);
    }
  });
  const out: SlideBody[] = [];
  for (const item of items) {
    if (item.kind === "run") {
      out.push(...pointSlides(item.points));
      continue;
    }
    const groups = chunk(item.rows, TEACHING_TABLE_ROWS);
    if (!groups.length) groups.push([]);
    groups.forEach((rows, i) => {
      const before = i === 0 ? item.before : [];
      const after = i === groups.length - 1 ? item.after : [];
      out.push({
        points: [
          ...before,
          ...[item.header, ...rows].map(tableRowText),
          ...after,
        ],
        table: { header: item.header, rows, before, after },
      });
    });
  }
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
    teachingBlocks(
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
    blocks: readonly TeachingBlock[],
    limit: number,
  ) => {
    const bodies = layoutBlocks(blocks);
    bodies.forEach((body, i) =>
      slides.push({
        kind: "CONTENT",
        partKey,
        subpartKey,
        title:
          bodies.length > 1 ? `${title} (${i + 1}/${bodies.length})` : title,
        points: body.points,
        ...(body.table ? { table: body.table } : {}),
      }),
    );
    // THE FRAME COUNTS THE TEXT SLIDES (acrobot 59522, technical decision, korall 59519): a table slide is a table, and a table is not the
    // length the frame limits; the title's "(i/n)" still numbers every slide of the text
    const counted = bodies.filter((body) => !body.table).length;
    if (counted > limit)
      overFrame.push({ partKey, subpartKey, slides: counted, limit });
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
