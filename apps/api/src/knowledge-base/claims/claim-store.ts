import {
  computeAgreement,
  deriveEvidenceLevel,
  type EvidenceLevel,
  type StudyType,
  type VocabularyKind,
  type VocabularyRow,
} from "@acropora/knowledge-base";

import { labelOf } from "../vocabulary/vocabulary-versions.js";

/**
 * THE CLAIM STORE (S5, Állítás-tár, Figma 3:229): the verified claims, grouped
 * by knowledge layer, each with a title, its species, its source and the
 * evidence level.
 *
 * A claim has NO text column: the title is DERIVED from its normalized fields
 * (effect label, direction, quantity), so it can never drift from what the
 * editor verified. The evidence level is derived too (`deriveEvidenceLevel`),
 * never stored. Pure: no database, no clock.
 */
export const CLAIM_LAYERS = [
  "SCIENTIFIC",
  "HOBBY_EXPERIENCE",
  "MANUFACTURER",
  "OWN_CONCLUSION",
] as const;
export type ClaimLayer = (typeof CLAIM_LAYERS)[number];

export class ClaimStoreInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ClaimStoreInputError";
  }
}

/** `?layer=`: one of the four layers, or none for all of them. */
export function parseLayer(value: unknown): ClaimLayer | null {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "string" ||
    !(CLAIM_LAYERS as readonly string[]).includes(value)
  )
    throw new ClaimStoreInputError("BAD_LAYER", "layer: unknown layer");
  return value as ClaimLayer;
}

/** Vocabulary labels by kind and key; an unknown key is shown as itself. */
export type Labels = (kind: VocabularyKind, key: string) => string;

/**
 * Labels from the approved vocabulary first, then the working rows: a key an
 * editor added from the review (S5, acrobot 35807) is in the draft until
 * Balázs approves it, and it still needs its Hungarian label, never the raw
 * key (acrobot 35807, MICROBIOMECOMPOSITION).
 */
export function labelsFrom(
  approved: readonly VocabularyRow[],
  working: readonly VocabularyRow[],
): Labels {
  const map = new Map<string, string>();
  for (const row of [...working, ...approved])
    if (row.status !== "RETIRED")
      map.set(`${row.kind}:${row.key}`, labelOf(row));
  return (kind, key) => map.get(`${kind}:${key}`) ?? key;
}

export const DIRECTION_WORDS: Record<string, string> = {
  INCREASE: "nő",
  DECREASE: "csökken",
  NONE: "nem változik",
};

const BASIS_TEXT: Record<string, string> = { PO4: "PO₄", P: "P" };

const number = (v: string | number) =>
  Number(v).toLocaleString("hu-HU", { maximumFractionDigits: 6 });

export interface QuantityColumns {
  min: string | null;
  max: string | null;
  unit: string | null;
  basis: "PO4" | "P" | null;
}

/** "1–3 µmol/l PO₄", "≥ 0,5 mg/l P", or null without a quantity. */
export function quantityLabel(q: QuantityColumns): string | null {
  if (!q.unit || (q.min === null && q.max === null)) return null;
  const unit = q.basis ? `${q.unit} ${BASIS_TEXT[q.basis]}` : q.unit;
  if (q.min !== null && q.max !== null)
    return Number(q.min) === Number(q.max)
      ? `${number(q.min)} ${unit}`
      : `${number(q.min)}–${number(q.max)} ${unit}`;
  return q.min !== null
    ? `≥ ${number(q.min)} ${unit}`
    : `≤ ${number(q.max!)} ${unit}`;
}

/**
 * The claim's title, built from its normalized fields: "Kalcifikáció:
 * csökken, 1–3 µmol/l PO₄ mellett". A claim without an effect cannot be
 * verified (the review refuses it), so the fallback only names the gap.
 */
export function claimTitle(
  effect: string | null,
  direction: string | null,
  quantity: QuantityColumns,
  labels: Labels,
): string {
  const head = effect ? labels("EFFECT", effect) : "Hatás nélkül";
  const verb = direction ? (DIRECTION_WORDS[direction] ?? direction) : null;
  const q = quantityLabel(quantity);
  return `${head}${verb ? `: ${verb}` : ""}${q ? `, ${q} mellett` : ""}`;
}

/** One evidence row as the level reads it. */
export interface LevelRow {
  sourceId: string;
  stance: "SUPPORTS" | "CONTRADICTS" | "QUALIFIES";
  studyType: StudyType | null;
  controlled: boolean | null;
  sampleSize: number | null;
  /** The source was retracted: nothing is built on it (plan v4). */
  retracted: boolean;
}

/**
 * The claim's evidence level: its supporting rows through the rule table,
 * contradiction counted from its own CONTRADICTS rows and from the supporting
 * sources of a VERIFIED claim linked to it by a CONTRADICTS relation (either
 * side; the caller passes only those). A retracted source's row counts on
 * neither side: a claim verified before the retraction must not keep the
 * level it gave (barracuda, #1867 note 1).
 */
export function claimEvidenceLevel(
  rows: readonly LevelRow[],
  contradictingClaimSources: readonly string[],
): { level: EvidenceLevel | null; reasons: string[]; rulesVersion: string } {
  const live = rows.filter((r) => !r.retracted);
  const { contradictingSources } = computeAgreement(
    live,
    contradictingClaimSources,
  );
  const result = deriveEvidenceLevel({
    supporting: live
      .filter((r) => r.stance === "SUPPORTS")
      .map((r) => ({
        sourceId: r.sourceId,
        studyType: r.studyType,
        controlled: r.controlled,
        sampleSize: r.sampleSize,
      })),
    contradictingSources,
  });
  const dropped = [
    ...new Set(rows.filter((r) => r.retracted).map((r) => r.sourceId)),
  ];
  return dropped.length === 0
    ? result
    : {
        ...result,
        reasons: [
          ...dropped.map((id) => `retracted source ${id} ignored`),
          ...result.reasons,
        ],
      };
}
