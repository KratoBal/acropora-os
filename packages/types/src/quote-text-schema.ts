import type { QuoteRichText } from "./quotes.js";

/**
 * THE QUOTE TEXT SUBSET, IN ONE PLACE (#1582 C9, P1 decision 5).
 *
 * Customer-facing quote text is never stored as HTML: it is a narrow subset of
 * TipTap JSON (paragraph, bold, italic, lists, hard break). The editor (web),
 * the write validator (API) and the read mapper (API) all use THIS list, so a
 * node the editor can produce is exactly a node the server accepts and the PDF
 * renders. Headings, quotes, underline and links are deliberately absent: the
 * TipTap StarterKit allows them by shortcut and by paste, and the editor must
 * strip them, not the server silently.
 */
export const QUOTE_RICH_TEXT_NODES = [
  "doc",
  "paragraph",
  "text",
  "bulletList",
  "orderedList",
  "listItem",
  "hardBreak",
] as const;

export const QUOTE_RICH_TEXT_MARKS = ["bold", "italic"] as const;

/** Nesting deeper than this is not a real quote text. */
export const QUOTE_RICH_TEXT_MAX_DEPTH = 24;

/** The longest text one block may carry (all text nodes together). */
export const QUOTE_RICH_TEXT_MAX_CHARS = 20_000;

const record = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;

/**
 * Parses one node of the subset. Anything outside it (an unknown node or mark,
 * an extra key such as `attrs`, a non-string text) makes the WHOLE value
 * invalid: `null`. The read side uses this to never reflect arbitrary JSON;
 * the write side (`validateQuoteRichText`) rejects instead.
 */
export function parseQuoteRichText(
  value: unknown,
  depth = 0,
): QuoteRichText | null {
  const n = record(value);
  if (!n || depth > QUOTE_RICH_TEXT_MAX_DEPTH || typeof n.type !== "string")
    return null;
  if (
    !(QUOTE_RICH_TEXT_NODES as readonly string[]).includes(n.type) ||
    Object.keys(n).some(
      (k) => !["type", "text", "marks", "content"].includes(k),
    )
  )
    return null;
  const result: QuoteRichText = { type: n.type as QuoteRichText["type"] };
  if (result.type === "text") {
    if (typeof n.text !== "string") return null;
    result.text = n.text;
    if (n.marks !== undefined) {
      if (!Array.isArray(n.marks)) return null;
      const marks = n.marks.map((m) => {
        const r = record(m);
        return r &&
          Object.keys(r).every((k) => k === "type") &&
          (QUOTE_RICH_TEXT_MARKS as readonly unknown[]).includes(r.type)
          ? { type: r.type as (typeof QUOTE_RICH_TEXT_MARKS)[number] }
          : null;
      });
      if (marks.some((m) => m === null)) return null;
      if (marks.length)
        result.marks = marks as NonNullable<QuoteRichText["marks"]>;
    }
  } else if (n.text !== undefined || n.marks !== undefined) return null;
  if (n.content !== undefined) {
    if (!Array.isArray(n.content)) return null;
    const children = n.content.map((c) => parseQuoteRichText(c, depth + 1));
    if (children.some((c) => c === null)) return null;
    result.content = children as QuoteRichText[];
  }
  return result;
}

function textLength(node: QuoteRichText): number {
  return (
    (node.text?.length ?? 0) +
    (node.content ?? []).reduce((sum, child) => sum + textLength(child), 0)
  );
}

/**
 * The write-side check: a stored quote text is a `doc` root within the
 * subset and the length limit. Returns the parsed value, or a Hungarian
 * reason the API can show.
 */
export function validateQuoteRichText(
  value: unknown,
): { ok: true; value: QuoteRichText } | { ok: false; reason: string } {
  const parsed = parseQuoteRichText(value);
  if (!parsed)
    return {
      ok: false,
      reason:
        "A szöveg nem megengedett formázást tartalmaz (csak bekezdés, félkövér, dőlt, felsorolás és sortörés lehet).",
    };
  if (parsed.type !== "doc")
    return { ok: false, reason: "A szöveg gyökere nem dokumentum." };
  if (textLength(parsed) > QUOTE_RICH_TEXT_MAX_CHARS)
    return {
      ok: false,
      reason: `A szöveg legfeljebb ${QUOTE_RICH_TEXT_MAX_CHARS} karakter lehet.`,
    };
  return { ok: true, value: parsed };
}

/** An empty quote text: one empty paragraph. */
export const EMPTY_QUOTE_RICH_TEXT: QuoteRichText = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

/**
 * THE EDITOR'S TipTap JSON, REDUCED TO THE SUBSET'S SHAPE (P1). TipTap adds
 * `attrs` the subset does not carry (an ordered list's `start` and `type`), and
 * may add `attrs` to a mark; those are dropped here. Everything else is kept AS
 * IS, an unknown node included: the validator must still see it and name it,
 * so this is a shape adapter, not a filter.
 */
export function quoteRichTextFromEditor(value: unknown, depth = 0): unknown {
  const n = record(value);
  if (!n || depth > QUOTE_RICH_TEXT_MAX_DEPTH) return value;
  const out: Record<string, unknown> = { type: n.type };
  if (n.text !== undefined) out.text = n.text;
  if (Array.isArray(n.marks) && n.marks.length)
    out.marks = n.marks.map((m) => {
      const r = record(m);
      return r ? { type: r.type } : m;
    });
  if (Array.isArray(n.content))
    out.content = n.content.map((c) => quoteRichTextFromEditor(c, depth + 1));
  return out;
}
