import { richHtmlToText } from "@acropora/rich-text";
import {
  ARTICLE_DIFF_FIELDS,
  type ArticleDiffBlock,
  type ArticleDiffField,
  type ArticleDiffSegment,
} from "@acropora/types";

/**
 * TWO VERSIONS OF AN ARTICLE, COMPARED (research plan v4, 9.2 S5). The body is
 * compared as the reader reads it: the plain text of the cleaned HTML
 * (`richHtmlToText`), paragraph by paragraph, and inside a changed paragraph
 * word by word. Markup that changes no text (a bold word) is no difference
 * here; the image's address and the other public fields are compared as
 * fields. Pure: no database.
 */

/** The fields a comparison reads from either side. */
export interface ArticleSnapshot {
  title: string;
  excerpt: string;
  bodyHtml: string;
  byline: string | null;
  seoTitle: string | null;
  metaDescription: string | null;
  coverImageUrl: string | null;
  coverImageAlt: string | null;
  ogImageUrl: string | null;
  channels: readonly string[];
  noindex: boolean;
}

type Op<T> = { kind: "same" | "added" | "removed"; value: T };

// Above this many cells the table would not fit a request's memory; the
// comparison then says "everything changed", which is true if not precise.
const MAX_CELLS = 4_000_000;

/** A longest-common-subsequence diff, in order: removed before added at each step. */
export function sequenceDiff<T>(a: readonly T[], b: readonly T[]): Op<T>[] {
  if (a.length * b.length > MAX_CELLS)
    return [
      ...a.map((value) => ({ kind: "removed" as const, value })),
      ...b.map((value) => ({ kind: "added" as const, value })),
    ];
  // lcs[i][j]: the common length of a[i..] and b[j..]
  const lcs = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1)
    for (let j = b.length - 1; j >= 0; j -= 1)
      lcs[i]![j] =
        a[i] === b[j]
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: Op<T>[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", value: a[i]! });
      i += 1;
      j += 1;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ kind: "removed", value: a[i]! });
      i += 1;
    } else {
      out.push({ kind: "added", value: b[j]! });
      j += 1;
    }
  }
  for (; i < a.length; i += 1) out.push({ kind: "removed", value: a[i]! });
  for (; j < b.length; j += 1) out.push({ kind: "added", value: b[j]! });
  return out;
}

/** Words with the spaces kept, so the segments put back give the text. */
function words(text: string): string[] {
  return text.split(/(\s+)/u).filter((w) => w !== "");
}

/** Adjacent segments of one kind joined. */
function segmentsOf(ops: Op<string>[]): ArticleDiffSegment[] {
  const out: ArticleDiffSegment[] = [];
  for (const op of ops) {
    const last = out[out.length - 1];
    if (last && last.kind === op.kind) last.text += op.value;
    else out.push({ kind: op.kind, text: op.value });
  }
  return out;
}

/** The plain-text paragraphs of a body, as the reader reads them. */
export function bodyBlocks(bodyHtml: string): string[] {
  return richHtmlToText(bodyHtml, { profile: "full" })
    .split(/\n{2,}/u)
    .map((block) => block.trim())
    .filter((block) => block !== "");
}

/**
 * The paragraphs compared. A run of removed paragraphs directly followed by a
 * run of added ones is paired in order: each pair is one CHANGED paragraph,
 * the rest stays removed or added.
 */
export function blockDiff(
  before: readonly string[],
  after: readonly string[],
): ArticleDiffBlock[] {
  const ops = sequenceDiff(before, after);
  const out: ArticleDiffBlock[] = [];
  let k = 0;
  while (k < ops.length) {
    const op = ops[k]!;
    if (op.kind !== "removed") {
      out.push({ kind: op.kind, text: op.value });
      k += 1;
      continue;
    }
    const removed: string[] = [];
    while (k < ops.length && ops[k]!.kind === "removed")
      removed.push(ops[k++]!.value);
    const added: string[] = [];
    while (k < ops.length && ops[k]!.kind === "added")
      added.push(ops[k++]!.value);
    const pairs = Math.min(removed.length, added.length);
    for (let p = 0; p < pairs; p += 1)
      out.push({
        kind: "changed",
        segments: segmentsOf(
          sequenceDiff(words(removed[p]!), words(added[p]!)),
        ),
      });
    for (const text of removed.slice(pairs))
      out.push({ kind: "removed", text });
    for (const text of added.slice(pairs)) out.push({ kind: "added", text });
  }
  return out;
}

function fieldText(snapshot: ArticleSnapshot, field: ArticleDiffField): string {
  const value = snapshot[field];
  if (field === "channels")
    return [...(value as readonly string[])].sort().join(", ");
  if (field === "noindex") return value ? "igen" : "nem";
  return (value as string | null) ?? "";
}

export function articleDiff(
  before: ArticleSnapshot,
  after: ArticleSnapshot,
): {
  fields: { field: ArticleDiffField; before: string; after: string }[];
  body: ArticleDiffBlock[];
  identical: boolean;
} {
  const fields = ARTICLE_DIFF_FIELDS.map((field) => ({
    field,
    before: fieldText(before, field),
    after: fieldText(after, field),
  })).filter((f) => f.before !== f.after);
  const body = blockDiff(
    bodyBlocks(before.bodyHtml),
    bodyBlocks(after.bodyHtml),
  );
  return {
    fields,
    body,
    identical: fields.length === 0 && body.every((b) => b.kind === "same"),
  };
}
