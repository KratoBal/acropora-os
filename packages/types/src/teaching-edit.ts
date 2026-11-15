import type { TeachingSlideDeck } from "./teaching-output.js";

/**
 * AN OUTPUT EDITED OUTSIDE THE SOURCE (T5.2, spec v2, points 3 and 6). When
 * someone edits a generated file directly (Luca a slide deck in PowerPoint),
 * the output "differs from the source", and the difference has to be visible.
 * Carrying it back into the source is not automatic: the editor marks whether
 * the change goes back, the content agent carries it over, the editor approves
 * the source again (acrobot, 2026-11-04).
 *
 * This module compares the TEXT of the slides: the generated deck's titles and
 * points against the text read out of the edited file. Layout, colour and
 * images are no difference here; a reworded point, a dropped or a new point,
 * a slide added or removed are. Pure: no file reading (the API extracts the
 * text), no database.
 */

/** One slide's text as read from a file: the first paragraph is the title. */
export interface TeachingSlideText {
  title: string;
  points: string[];
}

export type TeachingSlideChange = "SAME" | "CHANGED" | "ADDED" | "REMOVED";

export interface TeachingSlideDiff {
  /** The slide's place in the edited deck, or in the generated one when removed (1-based). */
  position: number;
  change: TeachingSlideChange;
  generated: TeachingSlideText | null;
  edited: TeachingSlideText | null;
  /** Points of the generated slide not found on the edited one. */
  removedPoints: string[];
  /** Points of the edited slide not found on the generated one. */
  addedPoints: string[];
  titleChanged: boolean;
}

export interface TeachingDeckDiff {
  slides: TeachingSlideDiff[];
  /** How many slides differ in any way. */
  changed: number;
}

/** Whitespace and case aside, the way a reader sees two lines as the same. */
const norm = (text: string) =>
  text.replace(/\s+/g, " ").trim().toLocaleLowerCase("hu");

/** The generated deck's slides as text, the footer stamp left out (it is no content). */
export function teachingDeckText(deck: TeachingSlideDeck): TeachingSlideText[] {
  return deck.slides.map((slide) => ({
    title: slide.title,
    points: slide.points.filter((p) => norm(p) !== norm(deck.stamp.footer)),
  }));
}

/**
 * The edited file's slides, cleaned: blank lines dropped, and a line equal to
 * the generated footer stamp dropped (it is on every slide and says nothing
 * about the content).
 */
export function cleanEditedSlides(
  slides: readonly TeachingSlideText[],
  footer: string,
): TeachingSlideText[] {
  const f = norm(footer);
  return slides.map((s) => ({
    title: s.title.trim(),
    points: s.points.map((p) => p.trim()).filter((p) => p && norm(p) !== f),
  }));
}

function slideDiff(
  position: number,
  generated: TeachingSlideText | null,
  edited: TeachingSlideText | null,
): TeachingSlideDiff {
  if (!generated || !edited)
    return {
      position,
      change: generated ? "REMOVED" : "ADDED",
      generated,
      edited,
      removedPoints: generated?.points ?? [],
      addedPoints: edited?.points ?? [],
      titleChanged: false,
    };
  const has = (list: readonly string[]) => {
    const set = new Set(list.map(norm));
    return (p: string) => set.has(norm(p));
  };
  const inEdited = has(edited.points);
  const inGenerated = has(generated.points);
  const removedPoints = generated.points.filter((p) => !inEdited(p));
  const addedPoints = edited.points.filter((p) => !inGenerated(p));
  const titleChanged = norm(generated.title) !== norm(edited.title);
  // the same points in another order is a change too: the reader sees it
  const reordered =
    !removedPoints.length &&
    !addedPoints.length &&
    generated.points.map(norm).join("\n") !==
      edited.points.map(norm).join("\n");
  return {
    position,
    change:
      titleChanged || removedPoints.length || addedPoints.length || reordered
        ? "CHANGED"
        : "SAME",
    generated,
    edited,
    removedPoints,
    addedPoints,
    titleChanged,
  };
}

/**
 * The generated deck against the edited one, slide by slide in order. A
 * slide the editor inserted in the middle shows as changes on every slide
 * after it: no guess is made about which slide "moved", because a wrong guess
 * would hide a real change.
 */
export function compareTeachingDecks(
  generated: readonly TeachingSlideText[],
  edited: readonly TeachingSlideText[],
): TeachingDeckDiff {
  const count = Math.max(generated.length, edited.length);
  const slides: TeachingSlideDiff[] = [];
  for (let i = 0; i < count; i++)
    slides.push(slideDiff(i + 1, generated[i] ?? null, edited[i] ?? null));
  return {
    slides,
    changed: slides.filter((s) => s.change !== "SAME").length,
  };
}

/** What the editor decided about an edited output. */
export interface TeachingEditDecision {
  /** true: the change goes back into the source (the content agent carries it over). */
  toSource: boolean;
  note: string | null;
}

export interface TeachingOutputEditSummary {
  id: string;
  outputId: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  uploadedById: string | null;
  uploadedAt: string;
  changedSlides: number;
  decision: (TeachingEditDecision & { byId: string | null; at: string }) | null;
}

export interface TeachingOutputEditDetail extends TeachingOutputEditSummary {
  diff: TeachingDeckDiff;
}

export const TEACHING_EDIT_NOTE_MAX = 1_000;

export function parseTeachingEditDecision(
  body: unknown,
): { ok: true; value: TeachingEditDecision } | { ok: false; message: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body))
    return { ok: false, message: "the decision is an object" };
  const record = body as Record<string, unknown>;
  const stray = Object.keys(record).find(
    (k) => k !== "toSource" && k !== "note",
  );
  if (stray) return { ok: false, message: `unknown field ${stray}` };
  if (typeof record.toSource !== "boolean")
    return { ok: false, message: "toSource: true or false" };
  const note = record.note ?? null;
  if (
    note !== null &&
    (typeof note !== "string" || note.length > TEACHING_EDIT_NOTE_MAX)
  )
    return {
      ok: false,
      message: `note: a string, at most ${TEACHING_EDIT_NOTE_MAX} characters`,
    };
  return {
    ok: true,
    value: {
      toSource: record.toSource,
      note: typeof note === "string" && note.trim() ? note.trim() : null,
    },
  };
}
