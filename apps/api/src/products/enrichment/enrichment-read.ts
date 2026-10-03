import {
  fieldSpec,
  isFieldKey,
  normalizeFieldValue,
} from "@acropora/jev/product-enrichment";
import type {
  ProductEnrichmentFieldKey,
  ProductEvidenceEntry,
  ProductEvidenceSourceType,
  ProductFieldReview,
  ProductFieldStatus,
  ProductFieldTier,
  ProductFieldValue,
} from "@acropora/types";
import { PRODUCT_EVIDENCE_SOURCE_TYPES } from "@acropora/types";

/**
 * FROM A STORED FIELD RESULT TO WHAT THE PAGES READ (`ProductFieldReview`).
 * Pure: the stored row in, the contract shape out.
 */
export interface StoredFieldRow {
  id: string;
  field: string;
  tier: string;
  status: string;
  value: string | null;
  sourceType: string | null;
  sourceRef: string | null;
  retrievedAt: Date | null;
  confidence: number | null;
  currentValue: string | null;
  evidence: unknown;
}

interface StoredEvidenceRow {
  sourceType: string;
  sourceRef: string | null;
  retrievedAt: string | null;
  raw: string;
  accepted: boolean;
}

function evidenceSourceType(
  value: string | null,
): ProductEvidenceSourceType | null {
  return (PRODUCT_EVIDENCE_SOURCE_TYPES as readonly (string | null)[]).includes(
    value,
  )
    ? (value as ProductEvidenceSourceType)
    : null;
}

/** A normalised value as the pages show it: a quantity, or text. */
export function fieldValue(
  field: string,
  value: string | null,
): ProductFieldValue | null {
  if (value === null) return null;
  if (isFieldKey(field) && fieldSpec(field).kind.kind === "quantity") {
    const space = value.lastIndexOf(" ");
    if (space > 0)
      return {
        kind: "quantity",
        amount: value.slice(0, space),
        unit: value.slice(space + 1),
      };
  }
  return { kind: "text", text: value };
}

export function toFieldReview(row: StoredFieldRow): ProductFieldReview {
  const evidence = (
    Array.isArray(row.evidence) ? (row.evidence as StoredEvidenceRow[]) : []
  )
    .filter((entry) => entry.accepted)
    .flatMap((entry): ProductEvidenceEntry[] => {
      const sourceType = evidenceSourceType(entry.sourceType);
      if (!sourceType) return [];
      const normal = isFieldKey(row.field)
        ? normalizeFieldValue(row.field, entry.raw)
        : null;
      return [
        {
          sourceType,
          value: fieldValue(row.field, normal?.ok ? normal.value : entry.raw)!,
          sourceRef: entry.sourceRef,
          retrievedAt: entry.retrievedAt,
        },
      ];
    });
  return {
    fieldResultId: row.id,
    field: row.field as ProductEnrichmentFieldKey,
    tier: row.tier as ProductFieldTier,
    status: row.status as ProductFieldStatus,
    currentValue: fieldValue(row.field, row.currentValue),
    value: fieldValue(row.field, row.value),
    sourceType: evidenceSourceType(row.sourceType),
    sourceRef: row.sourceRef,
    retrievedAt: row.retrievedAt?.toISOString() ?? null,
    confidence: row.confidence,
    evidence,
  };
}
