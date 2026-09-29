/**
 * WHAT THE JEV READS ABOUT A CANDIDATE, PER SUPPLIER.
 *
 * Measured on De Jong (PD, 2026-09-29, `a008/p026/dejong/PD-KUSZOB-VAZLAT.md`):
 * the product's short description next to its name lifts coverage by 6-9
 * points at every threshold with the same precision (DEV), and the frozen
 * setting (p3-final, name + description, shown from 0.80) held on HOLDOUT:
 * 98.4% of shown suggestions right, 1.8% shown on lines with no product.
 *
 * The text is built exactly as it was measured: the description as plain
 * text (no tags, no control bytes, whitespace collapsed), its first 200
 * characters, after the name and a full stop. A product without a
 * description is sent by its name alone, as it was in the measurement.
 */

export type CandidateCriteria = "name" | "name+description";

export const DESCRIPTION_CHARS = 200;

const ENTITIES: Readonly<Record<string, string>> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

/** The short description as the measurement read it: plain, one line. */
export function plainDescription(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(nbsp|amp|lt|gt|quot|#39);/g,
      (entity) => ENTITIES[entity] ?? " ",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, DESCRIPTION_CHARS)
    .trim();
}

export function candidateCriterion(
  name: string,
  description: string | null | undefined,
  criteria: CandidateCriteria,
): string {
  if (criteria === "name") return name;
  const text = plainDescription(description);
  return text ? `${name}. ${text}` : name;
}
