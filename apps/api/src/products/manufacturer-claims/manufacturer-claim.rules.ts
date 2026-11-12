/**
 * THE MANUFACTURER CLAIM RULES (T5.3, korall's spec, Balázs's approval 2026-11-03). Pure functions:
 * the service and the API view read them, and an agent writing content takes the attribution from
 * the claim's `output`, never from memory (spec point 2).
 *
 *   output        may the claim go out, how, and why not
 *   statusChange  who may set which check state (spec point 6, acrobot 48148)
 *   knowledgeLink whether a dosing claim still stands on the Product Knowledge fact it names (point 3)
 */

export const CLAIM_TYPES = [
  "DOSING",
  "EFFECT",
  "COMPOSITION",
  "APPLICABILITY",
  "SAFETY",
  "ADVERTISING",
  "OTHER",
] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const CLAIM_SOURCE_KINDS = [
  "DATASHEET",
  "MANUFACTURER_PAGE",
  "LABEL",
  "MANUFACTURER_GUIDE",
  "AUTHOR_ARTICLE",
] as const;
export type ClaimSourceKind = (typeof CLAIM_SOURCE_KINDS)[number];

export const CLAIM_STATUSES = [
  "UNVERIFIED",
  "MATCHES_MANUFACTURER",
  "INDEPENDENTLY_CONFIRMED",
  "DISPUTED",
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** The marking every manufacturer claim carries in a text, unless independently confirmed. */
export const MANUFACTURER_ATTRIBUTION = "a gyártó szerint";
/** What stays on the content page in place of a disputed claim (spec point 2). */
export const DISPUTED_PLACEHOLDER = "[KITÖLTENDŐ: ellenőrzés]";

/**
 * The Product Knowledge fields that hold a dosing value (`packages/jev/src/product-enrichment/fields.ts`).
 * When a product has an accepted fact in one of them, its dosing claims stand on that fact.
 */
export const DOSING_FACT_FIELDS = [
  "dosing",
  "dosingText",
  "dosingAmount",
  "dosingMode",
  "dosingGuidance",
  "dosingTests",
] as const;

export function isDosingFactField(field: string): boolean {
  return (DOSING_FACT_FIELDS as readonly string[]).includes(field);
}

/**
 * Where a claim stands against the Product Knowledge (point 3):
 *
 *   NONE            not a dosing claim, or a dosing claim on a product with no dosing fact
 *   CURRENT         it names a fact, and the fact is still at the revision it was read at
 *   CHANGED         it names a fact whose revision has moved, or that is gone: the claim was
 *                   checked against an older value
 *   MISSING_LINK    a dosing claim with its own source, but the product now has a dosing fact:
 *                   two places could say two things, so it must be linked
 */
export type KnowledgeLinkState =
  "NONE" | "CURRENT" | "CHANGED" | "MISSING_LINK";

export function knowledgeLinkState(
  claim: {
    claimType: ClaimType;
    knowledgeFactId: string | null;
    knowledgeFactRevision: number | null;
  },
  fact: { revision: number } | null,
  productHasDosingFact: boolean,
): KnowledgeLinkState {
  if (claim.knowledgeFactRevision !== null) {
    // A fact that was named and is gone (the link was set null) counts as changed.
    if (!claim.knowledgeFactId || !fact) return "CHANGED";
    return fact.revision === claim.knowledgeFactRevision
      ? "CURRENT"
      : "CHANGED";
  }
  if (claim.claimType === "DOSING" && productHasDosingFact)
    return "MISSING_LINK";
  return "NONE";
}

/**
 * Why a claim cannot go out as checked, or not word for word:
 *
 *   ARCHIVED                   withdrawn
 *   DISPUTED                   differs or is disputed: never written out, the placeholder stays
 *   UNVERIFIED                 nobody has checked the current version: draft only, marked
 *   KNOWLEDGE_FACT_CHANGED     the Product Knowledge fact it stands on has changed since
 *   KNOWLEDGE_FACT_NOT_LINKED  a dosing claim the product's dosing fact does not back
 *   ADVERTISING_NOT_CONFIRMED  advertising wording, not word for word until independently confirmed
 */
export type ClaimOutputReason =
  | "ARCHIVED"
  | "DISPUTED"
  | "UNVERIFIED"
  | "KNOWLEDGE_FACT_CHANGED"
  | "KNOWLEDGE_FACT_NOT_LINKED"
  | "ADVERTISING_NOT_CONFIRMED";

export interface ClaimOutput {
  /**
   * PUBLISHABLE: may go into a text that is sent out; DRAFT_ONLY: only into a draft, and the draft
   * says it holds an unchecked claim (the T5.1 approval queue); BLOCKED: not written out at all.
   */
  mode: "PUBLISHABLE" | "DRAFT_ONLY" | "BLOCKED";
  /** The check state the rules count with: UNVERIFIED when the knowledge link no longer holds. */
  effectiveStatus: ClaimStatus;
  /** The marking that goes beside the claim; null only when independently confirmed. */
  attribution: string | null;
  /** The text in place of the claim when it is BLOCKED. */
  placeholder: string | null;
  /** Whether the manufacturer's wording may be quoted; advertising only when confirmed. */
  verbatimAllowed: boolean;
  /** Dosing and safety: a mistake harms the customer, so the check is required before sending. */
  checkRequiredBeforeSend: boolean;
  reasons: ClaimOutputReason[];
}

export function claimOutput(
  claim: {
    claimType: ClaimType;
    status: ClaimStatus;
    archivedAt: Date | null;
  },
  link: KnowledgeLinkState,
): ClaimOutput {
  const reasons: ClaimOutputReason[] = [];
  let effectiveStatus = claim.status;
  if (link === "CHANGED" || link === "MISSING_LINK") {
    reasons.push(
      link === "CHANGED"
        ? "KNOWLEDGE_FACT_CHANGED"
        : "KNOWLEDGE_FACT_NOT_LINKED",
    );
    // A disputed claim stays disputed: the fact moving does not make it writable.
    if (effectiveStatus !== "DISPUTED") effectiveStatus = "UNVERIFIED";
  }
  const confirmed = effectiveStatus === "INDEPENDENTLY_CONFIRMED";
  const verbatimAllowed = claim.claimType !== "ADVERTISING" || confirmed;
  if (!verbatimAllowed) reasons.push("ADVERTISING_NOT_CONFIRMED");
  const base = {
    effectiveStatus,
    attribution: confirmed ? null : MANUFACTURER_ATTRIBUTION,
    verbatimAllowed,
    checkRequiredBeforeSend:
      claim.claimType === "DOSING" || claim.claimType === "SAFETY",
  };
  if (claim.archivedAt)
    return {
      ...base,
      mode: "BLOCKED",
      placeholder: DISPUTED_PLACEHOLDER,
      reasons: ["ARCHIVED", ...reasons],
    };
  if (effectiveStatus === "DISPUTED")
    return {
      ...base,
      mode: "BLOCKED",
      placeholder: DISPUTED_PLACEHOLDER,
      reasons: ["DISPUTED", ...reasons],
    };
  if (effectiveStatus === "UNVERIFIED")
    return {
      ...base,
      mode: "DRAFT_ONLY",
      placeholder: null,
      reasons: reasons.length ? reasons : ["UNVERIFIED"],
    };
  return { ...base, mode: "PUBLISHABLE", placeholder: null, reasons };
}

/**
 * WHO MAY SET A CHECK STATE (spec point 6, confirmed by acrobot, 48148, 2026-11-12). The answer is
 * the refusal sentence, or null when allowed:
 *
 *   - back to UNVERIFIED: anyone who may write claims (the safe direction);
 *   - any checked state: not the one who recorded the current version, and the recorder must be
 *     known (an account that is gone cannot be told apart from the checker);
 *   - INDEPENDENTLY_CONFIRMED: only a person (not a machine account) with `content.approve`.
 */
export function statusChangeRefusal(input: {
  target: ClaimStatus;
  current: ClaimStatus;
  recordedById: string | null;
  actor: { id: string; machine: boolean; canApprove: boolean };
}): string | null {
  if (input.target === input.current)
    return "Az állítás már ebben az állapotban van.";
  if (input.target === "UNVERIFIED") return null;
  if (!input.recordedById)
    return "Az állítás rögzítője már nem azonosítható: előbb rögzítsd újra (szerkesztés), és azt ellenőrizze más.";
  if (input.recordedById === input.actor.id)
    return "Az állítást nem az ellenőrizheti, aki rögzítette: ember vagy egy másik ágens kell hozzá.";
  if (
    input.target === "INDEPENDENTLY_CONFIRMED" &&
    (input.actor.machine || !input.actor.canApprove)
  )
    return "Független forrással megerősített állapotot csak ember adhat, jóváhagyási joggal.";
  return null;
}

/** The review queue's order (spec point 4): dosing and safety first, then the oldest. */
export function reviewQueueRank(type: ClaimType): number {
  return type === "DOSING" ? 0 : type === "SAFETY" ? 1 : 2;
}
