import {
  isFieldKey,
  normalizeFieldValue,
} from "@acropora/jev/product-enrichment";

import type { Parsed } from "./knowledge.policy.js";

/**
 * WHAT A FACT MAY HOLD, BY ITS DEFINITION (SEO P0 PR 3).
 *
 * Until PR 3 an acceptance checked the field key, the status and that a value
 * is there; the value's shape came from the JEV normalizer at run time, and
 * nothing checked it again at the door. Now every fact passes its
 * `AttributeDefinition` before it is stored: the JEV's OWN normalizer for the
 * kind (gtin, quantity, dose, text), and only what the definition adds on top
 * (a pattern, a length, the canonical unit, the unit qualifiers). No second
 * regex for a GTIN or a dose: two parsers of one format drift apart, and the
 * one that disagrees refuses a value the other produced (barracuda, PR 3
 * preview, point 2).
 *
 * What is ALREADY stored is not checked again: no backfill, and no fact falls
 * out when this merges.
 */
export interface FactDefinition {
  key: string;
  dataType: string;
  /** `VARIANT_BARCODE` (SEO P0 PR 4): az elfogadás `ProductBarcode` sort ír, nem tényt. */
  medusaNativeField: string | null;
  canonicalUnit: string | null;
  scope: "PRODUCT" | "VARIANT";
  validation: unknown;
  isActive: boolean;
}

interface Validation {
  pattern?: string;
  maxLength?: number;
  unitQualifiers?: string[];
}

function validationOf(value: unknown): Validation {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Validation)
    : {};
}

/** The data types a definition may have today; the others are refused by name. */
const CHECKED_TYPES = ["STRING", "TEXT", "QUANTITY", "DOSE"];

export function validateFactValue(
  definition: FactDefinition | null,
  field: string,
  fact: { value: string | null; unit: string | null },
): Parsed<true> {
  if (!definition || !definition.isActive)
    return { ok: false, reason: `no active definition for "${field}"` };
  if (!CHECKED_TYPES.includes(definition.dataType))
    return {
      ok: false,
      reason: `"${field}": a ${definition.dataType} definition is not accepted yet`,
    };
  // a conflict carries no value: there is nothing to check
  if (fact.value === null) return { ok: true, value: true };
  if (!isFieldKey(field))
    return { ok: false, reason: `unknown field "${field}"` };

  const rule = validationOf(definition.validation);
  const whole = fact.unit === null ? fact.value : `${fact.value} ${fact.unit}`;
  const normal = normalizeFieldValue(field, whole);
  if (!normal.ok) return { ok: false, reason: `"${field}": ${normal.reason}` };

  if (rule.pattern !== undefined && !new RegExp(rule.pattern).test(fact.value))
    return { ok: false, reason: `"${field}": does not match ${rule.pattern}` };
  if (rule.maxLength !== undefined && fact.value.length > rule.maxLength)
    return {
      ok: false,
      reason: `"${field}": longer than ${rule.maxLength} characters`,
    };

  if (definition.dataType === "QUANTITY") {
    const [unit, ...qualifiers] = (fact.unit ?? "").split(" ").filter(Boolean);
    if (definition.canonicalUnit !== null && unit !== definition.canonicalUnit)
      return {
        ok: false,
        reason: `"${field}": the unit is ${unit ?? "missing"}, not ${definition.canonicalUnit}`,
      };
    const allowed = rule.unitQualifiers ?? [];
    const extra = qualifiers.filter((q) => !allowed.includes(q));
    if (extra.length > 0)
      return {
        ok: false,
        reason: `"${field}": ${extra.join(" ")} is not an allowed qualifier`,
      };
  }
  return { ok: true, value: true };
}

/**
 * WHICH VARIANT A FACT BELONGS TO (SEO P0 PR 3, decisions D1 and D2).
 *
 * D1: the variant comes from the decision (accept / resolve), not from the
 * JEV result, which has no variant. D2: strict, with one rule for the main
 * case: a VARIANT field on a product with ONE variant binds to it without
 * being named. On the stage 1900 of 1909 products have one variant (acrobot,
 * 2026-10-07 16:45), so this is the ordinary path, not an exception.
 */
export function factScope(
  definition: Pick<FactDefinition, "key" | "scope">,
  requested: unknown,
  variantIds: readonly string[],
): Parsed<string | null> {
  if (
    requested !== undefined &&
    requested !== null &&
    typeof requested !== "string"
  )
    return { ok: false, reason: "variantId: a variant id or nothing" };
  const named =
    typeof requested === "string" && requested !== "" ? requested : null;

  if (definition.scope === "PRODUCT") {
    if (named !== null)
      return {
        ok: false,
        reason: `"${definition.key}" is a product-level field: it takes no variant`,
      };
    return { ok: true, value: null };
  }

  if (named !== null) {
    if (!variantIds.includes(named))
      return { ok: false, reason: "variantId: not a variant of this product" };
    return { ok: true, value: named };
  }
  if (variantIds.length === 1) return { ok: true, value: variantIds[0]! };
  return {
    ok: false,
    reason: `"${definition.key}" is per variant and this product has ${variantIds.length}: name the variant (variantId)`,
  };
}
