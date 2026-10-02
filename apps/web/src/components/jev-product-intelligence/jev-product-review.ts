import type { ProductDetail, ProductEnrichmentReview } from "@acropora/types";

import { formatHuNumber } from "@/lib/format/number";

import type { JevReviewState } from "./jev-review-summary";
import { reviewCounts } from "./jev-presentation";

/**
 * THE PRODUCT'S JEV REVIEW, AS THE PAGE READS IT (phase 3 of
 * docs/jev-product-intelligence/v1-discovery.md; Figma 394:18).
 *
 * Pure, so every state is tested without rendering. Nothing here invents a
 * run, a value or a percentage: with no persisted run (today, always) the
 * honest states are "unavailable" (switch off) and "never checked".
 */

export type ReviewLoad =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; review: ProductEnrichmentReview };

/**
 * Which sentence stands instead of the review panel; `null` when there is a
 * run with something to look at (the summary and the rows take over). An
 * error is never a calm, empty-looking state.
 */
export function reviewState(load: ReviewLoad): JevReviewState | null {
  if (load.kind === "loading") return "loading";
  if (load.kind === "error") return "error";
  const { review } = load;
  if (review.availability === "off") return "unavailable";
  if (!review.lastRun) return "never-checked";
  const { suggestions, conflicts, needsHumanReview } = reviewCounts(
    review.fields,
  );
  return suggestions || conflicts || needsHumanReview ? null : "no-issues";
}

/** The product page card's one line, for each state. */
export function cardLine(load: ReviewLoad): string {
  const state = reviewState(load);
  switch (state) {
    case "loading":
      return "Betöltés…";
    case "error":
      return "Az ellenőrzés állapota nem tölthető be.";
    case "unavailable":
      return "A termékadat-ellenőrzés jelenleg nem elérhető.";
    case "never-checked":
      return "Ehhez a termékhez még nem készült JEV adatellenőrzés.";
    case "no-issues":
      return "Nem találtunk ellenőrzést igénylő termékadatot.";
    case null: {
      if (load.kind !== "ready") return "";
      const { suggestions, conflicts } = reviewCounts(load.review.fields);
      const parts = [];
      if (suggestions) parts.push(`${suggestions} javaslat`);
      if (conflicts) parts.push(`${conflicts} ütközés`);
      return parts.length
        ? `${parts.join(" · ")} vár emberi döntésre.`
        : "Emberi jóváhagyás szükséges.";
    }
  }
}

export function reviewHref(productId: string): string {
  return `/products/${encodeURIComponent(productId)}/adatellenorzes`;
}

const ORIGIN_LABEL: Record<NonNullable<ProductDetail["origin"]>, string> = {
  UNAS: "UNAS-termék",
  LOCAL: "Helyi Acropora OS-termék",
};

/** The product header's second line (Figma 394:72): "SKU: X · UNAS-termék · 1 változat". */
export function productReviewSubtitle(product: ProductDetail): string {
  const active = product.variants.filter((variant) => variant.isActive);
  return [
    `SKU: ${product.primarySku ?? "nincs"}`,
    product.origin ? ORIGIN_LABEL[product.origin] : "Eredet ellenőrzendő",
    `${active.length} változat`,
  ].join(" · ");
}

export interface CurrentDataRow {
  label: string;
  value: string;
}

/** Distinct, non-empty values; several variants' values joined. */
function joined(values: readonly (string | null | undefined)[]): string {
  const distinct = [
    ...new Set(values.map((value) => value?.trim()).filter(Boolean)),
  ];
  return distinct.length ? distinct.join(", ") : "—";
}

/**
 * "Jelenlegi termékadatok" (Figma 394:20): what the product holds today, from
 * the product detail the page already reads. An empty value is "—", never a
 * guess.
 */
export function currentProductData(product: ProductDetail): CurrentDataRow[] {
  const active = product.variants.filter((variant) => variant.isActive);
  const primaryCategory =
    product.categories.find((category) => category.isPrimary) ??
    product.primaryCategory;
  return [
    { label: "Márka", value: product.brand?.name ?? "—" },
    {
      label: "Gyártói cikkszám",
      value: joined(active.map((variant) => variant.manufacturerPartNumber)),
    },
    {
      label: "EAN",
      value: joined(
        active.flatMap((variant) =>
          variant.barcodes.map((barcode) => barcode.code),
        ),
      ),
    },
    { label: "Kategória", value: primaryCategory?.name ?? "—" },
    {
      label: "OS készlet",
      value: product.unasMirror?.isPackageProduct
        ? "Csomagtermék"
        : product.stockOnHand == null
          ? "—"
          : formatHuNumber(product.stockOnHand, { maximumFractionDigits: 2 }),
    },
  ];
}
