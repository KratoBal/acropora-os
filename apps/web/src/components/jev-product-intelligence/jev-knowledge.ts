import {
  PRODUCT_KNOWLEDGE_ACCEPTABLE_STATUSES,
  type ProductCopyBlock,
  type ProductCopyEntry,
  type ProductFieldReview,
  type ProductKnowledgeFact,
  type ProductEnrichmentFieldKey,
  type ProductManualEvidenceSourceType,
} from "@acropora/types";

import { formatFieldValue } from "./jev-presentation";

/**
 * PRODUCT KNOWLEDGE ON THE JEV REVIEW PAGE (#1431): what a reviewer may do
 * with a field, and how the accepted state reads. Pure, so each rule can be
 * tested without rendering.
 */

export const COPY_BLOCK_LABEL: Record<ProductCopyBlock, string> = {
  lead: "Bevezető",
  body: "Leírás",
  seoTitle: "SEO cím",
  metaDescription: "Meta leírás",
};

export const MANUAL_SOURCE_LABEL: Record<
  ProductManualEvidenceSourceType,
  string
> = {
  MANUFACTURER_PAGE: "Gyártói termékoldal",
  MANUFACTURER_DOCUMENT: "Gyártói dokumentum",
  SUPPLIER_PAGE: "Beszállítói oldal",
};

/** Can this field's result be accepted as knowledge at all? */
export function isAcceptable(
  review: Pick<ProductFieldReview, "status">,
): boolean {
  return (PRODUCT_KNOWLEDGE_ACCEPTABLE_STATUSES as readonly string[]).includes(
    review.status,
  );
}

/** The fact of this field, if one was accepted. */
export function factFor(
  facts: readonly ProductKnowledgeFact[],
  review: Pick<ProductFieldReview, "field">,
): ProductKnowledgeFact | null {
  return facts.find((fact) => fact.field === review.field) ?? null;
}

/**
 * WHAT THE ROW SAYS ABOUT THE ACCEPTED STATE.
 *
 * A fact accepted from an OLDER result than the one shown says so: newer
 * evidence arrived after the acceptance, and the reviewer must see that the
 * row and the knowledge no longer describe the same result.
 */
export function acceptedLine(
  fact: ProductKnowledgeFact | null,
  review: Pick<ProductFieldReview, "fieldResultId">,
): string | null {
  if (!fact) return null;
  const what =
    fact.status === "CONFLICTING_SOURCES"
      ? "Elfogadva ütközésként, érték nélkül"
      : `Elfogadva: ${fact.value ?? "—"}${fact.unit ? ` ${fact.unit}` : ""}`;
  const line =
    fact.fieldResultId === review.fieldResultId
      ? `${what} (${fact.revision}. változat)`
      : `${what}, egy korábbi ellenőrzésből. Újabb bizonyíték érkezett azóta.`;
  return `${line}${webshopNote(fact.status, fact.public ?? true)}`;
}

/**
 * D5 (kártya 4622f1ac): a vásárló csak ellenőrzött tényt lát. Az elfogadás az
 * OS-ben tárol, de egy javaslat vagy egy ütközés nem jut a webshopba; ezt a
 * sornak ki kell mondania, különben az elfogadás publikálásnak látszik.
 */
function webshopNote(status: string, kiadhato: boolean): string {
  // SEO P0 PR 2: a mezo definicioja nem `public`, tehat ellenorzotten sem megy ki.
  // A `?? true` a regi API-valaszra: a ket alkalmazas egymas utan telepul.
  if (!kiadhato)
    return " A webshopban nem jelenik meg: ez a mező nem nyilvános.";
  if (status === "VERIFIED") return "";
  return status === "CONFLICTING_SOURCES"
    ? " A webshopban nem jelenik meg, amíg az ütközés nincs feloldva."
    : " Csak javaslat: a webshopban nem jelenik meg, amíg egy újabb forrás meg nem erősíti.";
}

/** The label of a copy block's state, stale before anything else. */
export function copyStateLabel(entry: ProductCopyEntry | undefined): string {
  if (!entry) return "Még nincs szöveg";
  if (entry.stale) return "Elavult: a tények változtak a mentés óta";
  return entry.status === "APPROVED" ? "Jóváhagyva" : "Piszkozat";
}

/** Approval needs a saved, fresh draft; an approved fresh block has nothing left. */
export function canApproveCopy(entry: ProductCopyEntry | undefined): boolean {
  return entry !== undefined && !entry.stale && entry.status === "DRAFT";
}

/** A field whose sources disagree, with every value they state. */
export interface ConflictingField {
  field: ProductEnrichmentFieldKey;
  values: string[];
}

/**
 * THE FIELDS THE COPY MUST NOT STATE A VALUE OF: the ones whose sources
 * disagree, by the latest result or by the accepted fact. The values are the
 * ones the review shows, so a warning quotes what the reviewer can see.
 */
export function conflictingFields(
  reviews: readonly ProductFieldReview[],
  facts: readonly ProductKnowledgeFact[],
): ConflictingField[] {
  return reviews
    .filter(
      (review) =>
        review.status === "CONFLICTING_SOURCES" ||
        factFor(facts, review)?.status === "CONFLICTING_SOURCES",
    )
    .map((review) => ({
      field: review.field,
      values: [
        ...new Set(
          review.evidence
            .map((entry) => formatFieldValue(entry.value))
            .filter((value) => value !== "—"),
        ),
      ],
    }));
}

function comparable(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("hu");
}

/**
 * WHICH CONFLICTING VALUES THE TEXT NAMES, field by field (KZ Amino stage
 * run, #1431 comment 5972125293, finding 7: the first approved body named
 * both dosing frequencies, and the copy carried the conflict into the shop).
 * A warning, never a block: the editor decides. Letter case and spacing do
 * not hide a value; a paraphrase in other words does, which is why the panel
 * also names the conflicting fields when nothing matches.
 */
export function conflictMentions(
  text: string,
  conflicts: readonly ConflictingField[],
): ConflictingField[] {
  const haystack = comparable(text);
  if (haystack === "") return [];
  return conflicts
    .map((conflict) => ({
      field: conflict.field,
      values: conflict.values.filter((value) => {
        const needle = comparable(value);
        return needle !== "" && haystack.includes(needle);
      }),
    }))
    .filter((conflict) => conflict.values.length > 0);
}
