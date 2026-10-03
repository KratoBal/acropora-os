import {
  PRODUCT_INTERNAL_SOURCE_TYPES,
  type ProductEnrichmentFieldKey,
  type ProductEvidenceSourceType,
  type ProductFieldReview,
  type ProductFieldStatus,
  type ProductFieldValue,
  type ProductQualityQueueRow,
} from "@acropora/types";

import { formatHuNumber } from "@/lib/format/number";

/**
 * JEV PRODUCT INTELLIGENCE: WHAT A REVIEW MAY SAY, AND HOW
 * (docs/jev-product-intelligence/v1-discovery.md §9, Figma 394:466).
 *
 * Pure rules, so each can be tested without rendering. The one principle:
 * no view shows more than the data backs (owner, 2026-10-02):
 *   - a conflict has no JEV value: the sources are shown, never a winner;
 *   - a Tier C value is shown only when VERIFIED, never as a suggestion;
 *   - confidence is EXTRACTION confidence, shown only when it exists;
 *   - our own data (Acropora OS / UNAS) never verifies itself;
 *   - there is no quality percentage.
 */

export type JevTone = "success" | "info" | "warning" | "neutral" | "danger";

export const FIELD_STATUS_LABEL: Record<ProductFieldStatus, string> = {
  VERIFIED: "ELLENŐRZÖTT",
  SUGGESTED: "JAVASLAT",
  MISSING: "HIÁNYZIK",
  CONFLICTING_SOURCES: "ÜTKÖZÉS",
  UNVERIFIED: "NEM ELLENŐRZÖTT",
  POSSIBLE_WRONG_VALUE: "GYANÚS ÉRTÉK",
};

/** Never colour alone: every tone travels with its label. */
export const FIELD_STATUS_TONE: Record<ProductFieldStatus, JevTone> = {
  VERIFIED: "success",
  SUGGESTED: "info",
  MISSING: "neutral",
  CONFLICTING_SOURCES: "warning",
  UNVERIFIED: "neutral",
  POSSIBLE_WRONG_VALUE: "danger",
};

export const FIELD_LABEL: Record<ProductEnrichmentFieldKey, string> = {
  searchKeywords: "Kulcsszavak",
  seoTitle: "SEO cím",
  metaDescription: "Meta leírás",
  featureBullets: "Jellemzők",
  categorySuggestion: "Kategóriajavaslat",
  shortDescription: "Rövid leírás",
  longDescription: "Hosszú leírás",
  title: "Terméknév",
  category: "Kategória",
  compatibility: "Kompatibilitás",
  application: "Felhasználás",
  dosingText: "Adagolás",
  productFamily: "Termékcsalád",
  ean: "EAN",
  manufacturerSku: "Gyártói cikkszám",
  lengthMm: "Hosszúság",
  widthMm: "Szélesség",
  heightMm: "Magasság",
  volume: "Térfogat / kiszerelés",
  weight: "Tömeg",
  flowRate: "Teljesítmény",
  power: "Teljesítményfelvétel",
  voltage: "Feszültség",
  dosingAmount: "Adagolási mennyiség",
  composition: "Összetétel",
  warranty: "Garancia",
  safetyInformation: "Biztonsági adatok",
  brand: "Márka",
  capacity: "Kapacitás",
  packSize: "Kiszerelés",
  packageContents: "A csomag tartalma",
  dosing: "Adagolási rend",
  manufacturerClaims: "A gyártó állításai",
  manufacturerInfo: "Gyártó (GPSR)",
};

export const SOURCE_LABEL: Record<ProductEvidenceSourceType, string> = {
  MANUFACTURER_PAGE: "Gyártói termékoldal",
  MANUFACTURER_DOCUMENT: "Gyártói adatlap",
  SUPPLIER_PAGE: "Beszállítói oldal",
  OS_PRODUCT_MASTER: "Acropora OS",
  UNAS_CURRENT: "Acropora / UNAS",
  SUPPLIER_DOCUMENT: "Beszállítói dokumentum",
  KNOWLEDGE_BASE: "Tudásbázis",
};

export function isInternalSource(source: ProductEvidenceSourceType): boolean {
  return (PRODUCT_INTERNAL_SOURCE_TYPES as readonly string[]).includes(source);
}

/** A value as text; a quantity in the system's number format ("3000 l/h"). */
export function formatFieldValue(value: ProductFieldValue | null): string {
  if (value === null) return "—";
  if (value.kind === "text") return value.text;
  return `${formatHuNumber(value.amount)} ${value.unit}`.trim();
}

/**
 * The status a row SHOWS. A Tier C field is never a suggestion (the guard
 * rejects that, ACD-021): if one ever arrived, it is shown as not verified,
 * never as JAVASLAT next to an invented value.
 */
export function displayedStatus(
  review: Pick<ProductFieldReview, "tier" | "status">,
): ProductFieldStatus {
  if (review.tier === "C" && review.status === "SUGGESTED") return "UNVERIFIED";
  return review.status;
}

/** The JEV column: a value, "the sources disagree", or nothing. */
export type JevColumn =
  { kind: "value"; text: string } | { kind: "conflict" } | { kind: "none" };

export function jevColumn(review: ProductFieldReview): JevColumn {
  const status = displayedStatus(review);
  if (status === "CONFLICTING_SOURCES") return { kind: "conflict" };
  if ((status === "VERIFIED" || status === "SUGGESTED") && review.value)
    return { kind: "value", text: formatFieldValue(review.value) };
  return { kind: "none" };
}

/** The footer's provenance line. */
export function provenanceLine(review: ProductFieldReview): string {
  const status = displayedStatus(review);
  if (status === "CONFLICTING_SOURCES" || status === "POSSIBLE_WRONG_VALUE") {
    const readings = review.evidence.map(
      (entry) =>
        `${SOURCE_LABEL[entry.sourceType]}: ${formatFieldValue(entry.value)}`,
    );
    return readings.length
      ? `Forrás: ${readings.join(" · ")}`
      : "Forrás: nincs megjeleníthető forrás";
  }
  if (status === "MISSING") return "Forrás: Nem talált hiteles forrás";
  if (status === "UNVERIFIED") return "Forrás: Nincs ellenőrző forrás";
  return review.sourceType
    ? `Forrás: ${SOURCE_LABEL[review.sourceType]}`
    : "Forrás: —";
}

/**
 * "Kinyerési biztonság: 0,96", only for a shown value with a real extraction
 * confidence. `null` means nothing was model-extracted: no line at all.
 */
export function confidenceLine(review: ProductFieldReview): string | null {
  if (review.confidence === null) return null;
  if (jevColumn(review).kind !== "value") return null;
  return `Kinyerési biztonság: ${formatHuNumber(review.confidence, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Statuses a person still has to look at: the "EMBERI JÓVÁHAGYÁS SZÜKSÉGES" pill. */
const NEEDS_REVIEW: readonly ProductFieldStatus[] = [
  "SUGGESTED",
  "CONFLICTING_SOURCES",
  "POSSIBLE_WRONG_VALUE",
];

export function reviewCounts(fields: readonly ProductFieldReview[]): {
  suggestions: number;
  conflicts: number;
  needsHumanReview: boolean;
} {
  const statuses = fields.map(displayedStatus);
  return {
    suggestions: statuses.filter((s) => s === "SUGGESTED").length,
    conflicts: statuses.filter((s) => s === "CONFLICTING_SOURCES").length,
    needsHumanReview: statuses.some((s) => NEEDS_REVIEW.includes(s)),
  };
}

const dateTimeFormatter = new Intl.DateTimeFormat("hu-HU", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** "2026. 10. 01. 22:38" */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateTimeFormatter.format(date);
}

/** "2 perce", "3 órája", else the date and time. */
export function formatAge(iso: string, now: Date): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60000);
  if (minutes < 1) return "most";
  if (minutes < 60) return `${minutes} perce`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} órája`;
  return formatDateTime(iso);
}

/**
 * Only an http(s) reference becomes a link: a stored `javascript:` or
 * `data:` reference must never be clickable.
 */
export function safeSourceHref(ref: string | null): string | null {
  if (!ref) return null;
  try {
    const url = new URL(ref);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The catalogue queue (Figma 394:316).

export const QUEUE_FILTERS = [
  "all",
  "critical",
  "conflict",
  "missing",
  "suggestion",
  "verified",
] as const;
export type QueueFilter = (typeof QUEUE_FILTERS)[number];

export const QUEUE_FILTER_LABEL: Record<QueueFilter, string> = {
  all: "Összes",
  critical: "Kritikus",
  conflict: "Ütközés",
  missing: "Hiányzó adat",
  suggestion: "Javaslat",
  verified: "Ellenőrzött",
};

/**
 * "Kritikus": a value that is probably wrong, or a Tier C fact (EAN, size,
 * power...) the sources disagree on. Defined here once, so the filter and
 * any future count say the same thing.
 */
export function isCritical(
  row: Pick<ProductQualityQueueRow, "status" | "tier">,
): boolean {
  return (
    row.status === "POSSIBLE_WRONG_VALUE" ||
    (row.tier === "C" && row.status === "CONFLICTING_SOURCES")
  );
}

export function filterQueue(
  rows: readonly ProductQualityQueueRow[],
  filter: QueueFilter,
): ProductQualityQueueRow[] {
  return rows.filter((row) => {
    const status = displayedStatus(row);
    switch (filter) {
      case "all":
        return true;
      case "critical":
        return isCritical(row);
      case "conflict":
        return status === "CONFLICTING_SOURCES";
      case "missing":
        return status === "MISSING" || status === "UNVERIFIED";
      case "suggestion":
        return status === "SUGGESTED";
      case "verified":
        return status === "VERIFIED";
    }
  });
}

/** The row action's words, as on the Figma table. */
export function queueActionLabel(status: ProductFieldStatus): string {
  switch (status) {
    case "CONFLICTING_SOURCES":
      return "Megnyitás";
    case "SUGGESTED":
      return "Átnézés";
    case "VERIFIED":
      return "Részletek";
    default:
      return "Ellenőrzés";
  }
}
