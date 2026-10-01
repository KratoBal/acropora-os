/**
 * The fields of P-031 with their authority tier (ACD-021 "Safety / authority
 * tiers") and the deterministic normalizer each one is compared with.
 *
 * TIERS, AS THE DECISION LISTS THEM:
 *   A: Jev may propose freely (still reviewable).
 *   B: human-confirmed before an authoritative write.
 *   C: never invent; copy or verify from evidence only. Without a trustworthy
 *      source the outcome is MISSING or UNVERIFIED.
 *
 * Fields P-031 names but the tier list does not (brand, capacity, pack size,
 * package contents) are placed in Tier C: the strictest tier is the safe
 * default until the Council places them (open question in the design doc).
 */

import { validateGtin } from "./gtin.js";
import { parseQuantity, type Dimension } from "./units.js";

export type Tier = "A" | "B" | "C";

export type FieldKind =
  | { kind: "gtin" }
  | { kind: "identifier" }
  | { kind: "quantity"; dimension: Dimension }
  | { kind: "text" };

export interface FieldSpec {
  tier: Tier;
  kind: FieldKind;
  /** The decision placed it in this tier; `false` = the safe default. */
  tierFromDecision: boolean;
}

const text = { kind: "text" } as const;
const q = (dimension: Dimension) => ({ kind: "quantity", dimension }) as const;

export const FIELD_SPECS = {
  // Tier A
  searchKeywords: { tier: "A", kind: text, tierFromDecision: true },
  seoTitle: { tier: "A", kind: text, tierFromDecision: true },
  metaDescription: { tier: "A", kind: text, tierFromDecision: true },
  featureBullets: { tier: "A", kind: text, tierFromDecision: true },
  categorySuggestion: { tier: "A", kind: text, tierFromDecision: true },
  shortDescription: { tier: "A", kind: text, tierFromDecision: true },
  longDescription: { tier: "A", kind: text, tierFromDecision: true },
  // Tier B
  title: { tier: "B", kind: text, tierFromDecision: true },
  category: { tier: "B", kind: text, tierFromDecision: true },
  compatibility: { tier: "B", kind: text, tierFromDecision: true },
  application: { tier: "B", kind: text, tierFromDecision: true },
  dosingText: { tier: "B", kind: text, tierFromDecision: true },
  productFamily: { tier: "B", kind: text, tierFromDecision: true },
  // Tier C
  ean: { tier: "C", kind: { kind: "gtin" }, tierFromDecision: true },
  manufacturerSku: {
    tier: "C",
    kind: { kind: "identifier" },
    tierFromDecision: true,
  },
  lengthMm: { tier: "C", kind: q("length"), tierFromDecision: true },
  widthMm: { tier: "C", kind: q("length"), tierFromDecision: true },
  heightMm: { tier: "C", kind: q("length"), tierFromDecision: true },
  volume: { tier: "C", kind: q("volume"), tierFromDecision: true },
  weight: { tier: "C", kind: q("mass"), tierFromDecision: true },
  flowRate: { tier: "C", kind: q("flow"), tierFromDecision: true },
  power: { tier: "C", kind: q("power"), tierFromDecision: true },
  voltage: { tier: "C", kind: q("voltage"), tierFromDecision: true },
  dosingAmount: { tier: "C", kind: text, tierFromDecision: true },
  composition: { tier: "C", kind: text, tierFromDecision: true },
  warranty: { tier: "C", kind: text, tierFromDecision: true },
  safetyInformation: { tier: "C", kind: text, tierFromDecision: true },
  // Not placed by the decision: strictest tier by default.
  brand: { tier: "C", kind: text, tierFromDecision: false },
  capacity: { tier: "C", kind: q("volume"), tierFromDecision: false },
  packSize: { tier: "C", kind: text, tierFromDecision: false },
  packageContents: { tier: "C", kind: text, tierFromDecision: false },
} as const satisfies Record<string, FieldSpec>;

export type FieldKey = keyof typeof FIELD_SPECS;

export function isFieldKey(value: unknown): value is FieldKey {
  return typeof value === "string" && Object.hasOwn(FIELD_SPECS, value);
}

/**
 * An unknown field name is a data or programming error, and it is said in words:
 * without this, a typo in a dataset or a caller surfaced as a bare TypeError
 * ("Cannot read properties of undefined") from deep inside the reconciler.
 */
export class UnknownFieldError extends Error {
  readonly field: unknown;
  constructor(field: unknown) {
    super(`unknown product field "${String(field)}"`);
    this.name = "UnknownFieldError";
    this.field = field;
  }
}

/** The field's spec; throws `UnknownFieldError` for a name that is not a field. */
export function fieldSpec(field: FieldKey): FieldSpec {
  if (!isFieldKey(field)) throw new UnknownFieldError(field);
  return FIELD_SPECS[field];
}

export type NormalizeResult =
  { ok: true; value: string } | { ok: false; reason: string };

/**
 * The comparison form of a value. Two sources agree exactly when their
 * normalized values are equal; nothing fuzzier is ever called agreement.
 */
export function normalizeFieldValue(
  field: FieldKey,
  raw: string,
): NormalizeResult {
  const kind = fieldSpec(field).kind;
  switch (kind.kind) {
    case "gtin": {
      const r = validateGtin(raw);
      return r.ok ? { ok: true, value: r.gtin14 } : r;
    }
    case "quantity": {
      const r = parseQuantity(raw, kind.dimension);
      return r.ok ? { ok: true, value: r.canonical } : r;
    }
    case "identifier": {
      // Case and spacing are formatting; a hyphen is not (AB-12 vs AB12 is
      // a conflict for a human to settle, not for this function).
      const v = collapse(raw).toUpperCase();
      if (v === "") return { ok: false, reason: "empty" };
      if (v.length > 64)
        return { ok: false, reason: "longer than 64 characters" };
      return { ok: true, value: v };
    }
    case "text": {
      const v = collapse(raw);
      return v === "" ? { ok: false, reason: "empty" } : { ok: true, value: v };
    }
  }
}

function collapse(raw: string): string {
  return raw.normalize("NFC").trim().replace(/\s+/g, " ");
}
