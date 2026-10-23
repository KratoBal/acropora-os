/**
 * AN OPEN-ACCESS PAPER'S TEXT, BY SECTION (research engine S3).
 *
 * Europe PMC serves an open-access paper's full text as JATS XML. The
 * extraction needs plain text with the section each sentence stands in: the
 * model's passage and every anchor are checked, character for character,
 * against THIS text, and the section a passage stands in is decided here,
 * not by the model. No XML library: the repository has none, and the reading
 * is a few tag rules.
 *
 * - The abstract (a graphical one left out) is the section "Abstract".
 * - The body's top-level sections are the sections, named by their title;
 *   nested sections, figure captions and tables stay inside their parent.
 *   Body text outside any section is "Body".
 * - Left out: the back matter (references, acknowledgements, funding), and
 *   the sections whose title says they are not this study's own findings or
 *   method (introduction, background, references, author notes...): an
 *   introduction reports OTHER papers' findings, and a claim taken from it
 *   would cite this paper for someone else's result.
 * - A table cell ends with " | ", a row, paragraph, title or caption with a
 *   line break; inline markup (italic, sup, xref) leaves no gap.
 */
export interface TextSection {
  locator: string;
  text: string;
}

export const MAX_LOCATOR = 128;
/** One AI call's text, inside the AI service's own cap (40 000). */
export const MAX_CHUNK = 30_000;

const SKIPPED_TITLES =
  /^\s*(?:\d+\.?\s*)?(?:introduction|background|references?|literature cited|acknowledg|author|funding|financial|competing|conflicts? of interest|declaration|supplementary|supporting information|data availability|availability of data|abbreviations|ethics)/i;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decode(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (whole, name: string) => {
      if (name[0] === "#") {
        const code =
          name[1] === "x" || name[1] === "X"
            ? parseInt(name.slice(2), 16)
            : parseInt(name.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : whole;
      }
      return ENTITIES[name.toLowerCase()] ?? whole;
    },
  );
}

/** A JATS fragment as plain text, line by line. */
export function jatsText(fragment: string): string {
  return decode(
    fragment
      .replace(/<(graphic|inline-graphic|media)\b[^>]*?\/>/gi, "")
      .replace(/<(graphic|inline-graphic|media)\b[\s\S]*?<\/\1>/gi, "")
      .replace(/<\/(td|th)>/gi, " | ")
      .replace(
        /<\/(p|title|caption|label|tr|list-item|table-wrap|fig|disp-quote|def-item)>|<break\s*\/?>/gi,
        "\n",
      )
      .replace(/<[^>]+>/g, ""),
  )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** The [start, end) ranges of the top-level `<sec>` elements of a fragment. */
function topLevelSections(fragment: string): [number, number][] {
  const ranges: [number, number][] = [];
  let depth = 0;
  let start = -1;
  for (const m of fragment.matchAll(/<(\/?)sec\b[^>]*?(\/?)>/gi)) {
    if (m[2]) continue; // an empty <sec/>
    if (!m[1]) {
      if (depth === 0) start = m.index;
      depth += 1;
    } else if (depth > 0) {
      depth -= 1;
      if (depth === 0) ranges.push([start, m.index + m[0].length]);
    }
  }
  return ranges;
}

export function jatsSections(xml: string): TextSection[] {
  const clean = xml
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<back\b[\s\S]*?<\/back>/gi, "")
    .replace(/<ref-list\b[\s\S]*?<\/ref-list>/gi, "");
  const sections: TextSection[] = [];
  const used = new Map<string, number>();
  const push = (title: string, text: string) => {
    if (!text) return;
    const base = (title || "Section").slice(0, MAX_LOCATOR - 6);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    sections.push({ locator: n === 1 ? base : `${base} (${n})`, text });
  };

  for (const m of clean.matchAll(/<abstract\b([^>]*)>([\s\S]*?)<\/abstract>/gi))
    if (!/abstract-type\s*=\s*"(?:graphical|teaser|toc)"/i.test(m[1] ?? ""))
      push("Abstract", jatsText(m[2] ?? ""));

  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(clean)?.[1] ?? "";
  const ranges = topLevelSections(body);
  let outside = "";
  let last = 0;
  for (const [start, end] of ranges) {
    outside += body.slice(last, start);
    last = end;
    const sec = body.slice(start, end);
    const title = jatsText(
      /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(sec)?.[1] ?? "",
    );
    if (SKIPPED_TITLES.test(title)) continue;
    push(title.replace(/\n/g, " "), jatsText(sec));
  }
  outside += body.slice(last);
  push("Body", jatsText(outside));
  return sections;
}

/**
 * The sections in AI calls of at most `max` characters: whole sections packed
 * in order; a longer section split at line breaks, each part named
 * "<title> (i/n)". A single line longer than `max` is cut (and its anchors
 * across the cut will not be found: refused, not guessed).
 */
export function chunkSections(
  sections: readonly TextSection[],
  max = MAX_CHUNK,
): TextSection[][] {
  const pieces: TextSection[] = [];
  for (const section of sections) {
    if (section.text.length <= max) {
      pieces.push(section);
      continue;
    }
    const parts: string[] = [];
    let current = "";
    for (const line of section.text.split("\n")) {
      for (let i = 0; i < line.length; i += max) {
        const bit = line.slice(i, i + max);
        if (current && current.length + 1 + bit.length > max) {
          parts.push(current);
          current = "";
        }
        current = current ? `${current}\n${bit}` : bit;
      }
    }
    if (current) parts.push(current);
    parts.forEach((text, i) =>
      pieces.push({
        locator: `${section.locator} (${i + 1}/${parts.length})`.slice(
          0,
          MAX_LOCATOR,
        ),
        text,
      }),
    );
  }
  const chunks: TextSection[][] = [];
  let chunk: TextSection[] = [];
  let size = 0;
  for (const piece of pieces) {
    const cost = piece.locator.length + 2 + piece.text.length;
    if (chunk.length && size + cost > max) {
      chunks.push(chunk);
      chunk = [];
      size = 0;
    }
    chunk.push(piece);
    size += cost;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

/** One chunk as the AI reads it: each section under its own title line. */
export function chunkText(chunk: readonly TextSection[]): string {
  return chunk.map((s) => `${s.locator}\n${s.text}`).join("\n\n");
}
