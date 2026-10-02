import {
  PRODUCT_ENRICHMENT_FIELDS,
  type ProductEnrichmentFieldKey,
  type ProductFieldReview,
} from "@acropora/types";

import {
  SOURCE_LABEL,
  displayedStatus,
  formatFieldValue,
  isInternalSource,
} from "./jev-presentation";
import type { ReviewLoad } from "./jev-product-review";

/**
 * THE CONFLICT VIEW'S RULES (phase 4 of
 * docs/jev-product-intelligence/v1-discovery.md; Figma 394:196,
 * `/products/[id]/adatellenorzes/[field]`).
 *
 * Pure. JEV never picks a winner: the view only lays the sources side by
 * side and says why a person has to decide. Every decision is disabled
 * (no write contract is authorized), and nothing here invents a reading:
 * with no persisted run the view says so instead.
 */

export function isEnrichmentField(
  value: string,
): value is ProductEnrichmentFieldKey {
  return Object.prototype.hasOwnProperty.call(PRODUCT_ENRICHMENT_FIELDS, value);
}

export function conflictHref(
  productId: string,
  field: ProductEnrichmentFieldKey,
): string {
  return `/products/${encodeURIComponent(productId)}/adatellenorzes/${encodeURIComponent(field)}`;
}

export type ConflictState =
  | "loading"
  | "error"
  | "unavailable"
  | "never-checked"
  | "not-reviewed"
  | "no-conflict"
  | "conflict";

/**
 * Which state the field's conflict view is in. Only a field whose SHOWN
 * status is CONFLICTING_SOURCES is a conflict; anything else says so in
 * words, never as an empty page.
 */
export function conflictState(
  load: ReviewLoad,
  field: ProductEnrichmentFieldKey,
): { state: ConflictState; review: ProductFieldReview | null } {
  if (load.kind === "loading") return { state: "loading", review: null };
  if (load.kind === "error") return { state: "error", review: null };
  const { review } = load;
  if (review.availability === "off")
    return { state: "unavailable", review: null };
  if (!review.lastRun) return { state: "never-checked", review: null };
  const row = review.fields.find((candidate) => candidate.field === field);
  if (!row) return { state: "not-reviewed", review: null };
  return displayedStatus(row) === "CONFLICTING_SOURCES"
    ? { state: "conflict", review: row }
    : { state: "no-conflict", review: row };
}

export const CONFLICT_STATE_MESSAGE: Record<
  Exclude<ConflictState, "loading" | "conflict">,
  string
> = {
  error: "Az ellenőrzés nem tölthető be. A meglévő termékadatok nem változtak.",
  unavailable: "A termékadat-ellenőrzés jelenleg nem elérhető.",
  "never-checked": "Ehhez a termékhez még nem készült JEV adatellenőrzés.",
  "not-reviewed": "Ezt a mezőt a legutóbbi ellenőrzés nem vizsgálta.",
  "no-conflict": "Ennél a mezőnél nincs forrásütközés.",
};

/** The rule, stated even before there is data (Figma 394:333). */
export const CONFLICT_RULE =
  "A forrásalapú szabály szerint eltérő külső forrásoknál emberi döntés szükséges.";
export const NO_SILENT_WRITE =
  "A Jev nem írhatja felül csendben a termékadatot.";

/**
 * "Miért nem döntött automatikusan?": every source's own reading, one line
 * each, and that our own data cannot verify itself. Read from the evidence,
 * never summarized into a winner.
 */
export function explanationLines(review: ProductFieldReview): string[] {
  const lines = review.evidence.map((entry) =>
    isInternalSource(entry.sourceType)
      ? `${SOURCE_LABEL[entry.sourceType]}: ${formatFieldValue(entry.value)} (belső adat, önmagát nem igazolhatja).`
      : `${SOURCE_LABEL[entry.sourceType]}: ${formatFieldValue(entry.value)}.`,
  );
  return [...lines, NO_SILENT_WRITE];
}

/**
 * The decision buttons of Figma 394:349, all disabled: one "elfogadása" per
 * distinct EXTERNAL reading (our own data is the "keep" button, not a
 * candidate), then keep the current value, then "Nem eldönthető".
 */
export function decisionLabels(review: ProductFieldReview | null): string[] {
  const external = review
    ? [
        ...new Set(
          review.evidence
            .filter((entry) => !isInternalSource(entry.sourceType))
            .map((entry) => formatFieldValue(entry.value)),
        ),
      ]
    : [];
  return [
    ...external.map((value) => `${value} elfogadása`),
    "Jelenlegi érték megtartása",
    "Nem eldönthető",
  ];
}
