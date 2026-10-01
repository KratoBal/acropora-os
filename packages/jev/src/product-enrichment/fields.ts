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
 *
 * FACTUAL CLAIMS ARE A SEPARATE AXIS FROM THE TIER. The tier says who may
 * write a field; `claims` says whether its content asserts product facts. A
 * Tier B "compatibility" or a Tier A "long description" can state a fact as
 * surely as a Tier C EAN, and an unsupported one is the same failure:
 *   none:  editorial / classification; no product fact is asserted.
 *   value: the value itself is a fact (every Tier C field, compatibility,
 *          application, dosing text), checked against what the sources state.
 *   prose: free text that may contain facts (feature bullets, descriptions).
 *          V0 does no sentence-level extraction: the field is checked against
 *          the gold label (no supported facts at all, or a labeller's
 *          `unsupportedClaim` mark).
 */

import { validateGtin } from "./gtin.js";
import { parseQuantity, type Dimension } from "./units.js";

export type Tier = "A" | "B" | "C";

export type FieldKind =
  | { kind: "gtin" }
  | { kind: "identifier" }
  | { kind: "quantity"; dimension: Dimension }
  | { kind: "text" };

export type ClaimPolicy = "none" | "value" | "prose";

export interface FieldSpec {
  tier: Tier;
  kind: FieldKind;
  claims: ClaimPolicy;
  /** The decision placed it in this tier; `false` = the safe default. */
  tierFromDecision: boolean;
}

const text = { kind: "text" } as const;
const q = (dimension: Dimension) => ({ kind: "quantity", dimension }) as const;

export const FIELD_SPECS = {
  // Tier A
  searchKeywords: {
    tier: "A",
    kind: text,
    claims: "none",
    tierFromDecision: true,
  },
  seoTitle: { tier: "A", kind: text, claims: "none", tierFromDecision: true },
  metaDescription: {
    tier: "A",
    kind: text,
    claims: "none",
    tierFromDecision: true,
  },
  featureBullets: {
    tier: "A",
    kind: text,
    claims: "prose",
    tierFromDecision: true,
  },
  categorySuggestion: {
    tier: "A",
    kind: text,
    claims: "none",
    tierFromDecision: true,
  },
  shortDescription: {
    tier: "A",
    kind: text,
    claims: "prose",
    tierFromDecision: true,
  },
  longDescription: {
    tier: "A",
    kind: text,
    claims: "prose",
    tierFromDecision: true,
  },
  // Tier B
  title: { tier: "B", kind: text, claims: "none", tierFromDecision: true },
  category: { tier: "B", kind: text, claims: "none", tierFromDecision: true },
  compatibility: {
    tier: "B",
    kind: text,
    claims: "value",
    tierFromDecision: true,
  },
  application: {
    tier: "B",
    kind: text,
    claims: "value",
    tierFromDecision: true,
  },
  dosingText: {
    tier: "B",
    kind: text,
    claims: "value",
    tierFromDecision: true,
  },
  productFamily: {
    tier: "B",
    kind: text,
    claims: "none",
    tierFromDecision: true,
  },
  // Tier C
  ean: {
    tier: "C",
    kind: { kind: "gtin" },
    claims: "value",
    tierFromDecision: true,
  },
  manufacturerSku: {
    tier: "C",
    kind: { kind: "identifier" },
    claims: "value",
    tierFromDecision: true,
  },
  lengthMm: {
    tier: "C",
    kind: q("length"),
    claims: "value",
    tierFromDecision: true,
  },
  widthMm: {
    tier: "C",
    kind: q("length"),
    claims: "value",
    tierFromDecision: true,
  },
  heightMm: {
    tier: "C",
    kind: q("length"),
    claims: "value",
    tierFromDecision: true,
  },
  volume: {
    tier: "C",
    kind: q("volume"),
    claims: "value",
    tierFromDecision: true,
  },
  weight: {
    tier: "C",
    kind: q("mass"),
    claims: "value",
    tierFromDecision: true,
  },
  flowRate: {
    tier: "C",
    kind: q("flow"),
    claims: "value",
    tierFromDecision: true,
  },
  power: {
    tier: "C",
    kind: q("power"),
    claims: "value",
    tierFromDecision: true,
  },
  voltage: {
    tier: "C",
    kind: q("voltage"),
    claims: "value",
    tierFromDecision: true,
  },
  dosingAmount: {
    tier: "C",
    kind: text,
    claims: "value",
    tierFromDecision: true,
  },
  composition: {
    tier: "C",
    kind: text,
    claims: "value",
    tierFromDecision: true,
  },
  warranty: { tier: "C", kind: text, claims: "value", tierFromDecision: true },
  safetyInformation: {
    tier: "C",
    kind: text,
    claims: "value",
    tierFromDecision: true,
  },
  // Not placed by the decision: strictest tier by default.
  brand: { tier: "C", kind: text, claims: "value", tierFromDecision: false },
  capacity: {
    tier: "C",
    kind: q("volume"),
    claims: "value",
    tierFromDecision: false,
  },
  packSize: { tier: "C", kind: text, claims: "value", tierFromDecision: false },
  packageContents: {
    tier: "C",
    kind: text,
    claims: "value",
    tierFromDecision: false,
  },
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

/** Structured codes for failures a caller may need to act on, not just print. */
export const RESTRICTED_CIRCULATION_GTIN = "RESTRICTED_CIRCULATION_GTIN";
export type NormalizeFailureCode = typeof RESTRICTED_CIRCULATION_GTIN;

export type NormalizeResult =
  | { ok: true; value: string }
  | { ok: false; reason: string; code?: NormalizeFailureCode };

/** Does the field's content assert product facts (see `ClaimPolicy`)? */
export function containsFactualClaims(field: FieldKey): boolean {
  return fieldSpec(field).claims !== "none";
}

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
      if (!r.ok) return r;
      // A restricted-circulation (in-store) number is a valid GTIN but not a
      // manufacturer's EAN. As the `ean` field's value it is never accepted,
      // so it can never become VERIFIED; the code keeps the signal.
      if (r.restrictedCirculation)
        return {
          ok: false,
          code: RESTRICTED_CIRCULATION_GTIN,
          reason: `restricted-circulation (in-store) GTIN ${r.code}: not evidence of a manufacturer EAN`,
        };
      return { ok: true, value: r.gtin14 };
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
