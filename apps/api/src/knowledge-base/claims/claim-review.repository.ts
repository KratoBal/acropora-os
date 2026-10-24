import { Prisma, prisma } from "@acropora/database";
import {
  VOCABULARY_V1_ROWS,
  phosphateNamed,
  type VocabularyKind,
  type VocabularyRow,
} from "@acropora/knowledge-base";

import type { FieldName } from "../extraction/claim-check.js";
import { CLAIM_ON_INCLUDED_SOURCE } from "../included-source.js";
import {
  editorsWorkingCopy,
  labelOf,
  parseNewEntry,
  workingRows,
  type NewEntry,
} from "../vocabulary/vocabulary-versions.js";
import { VocabularyRepository } from "../vocabulary/vocabulary.repository.js";
import {
  ADDABLE_FIELDS,
  ReviewInputError,
  planReview,
  type Applicability,
  type ClaimColumns,
  type ReviewAnchor,
  type ReviewInput,
} from "./claim-review.js";

/** The fields in the order the screen shows them (Figma 3:137). */
export const FIELD_ORDER: readonly FieldName[] = [
  "species",
  "environment",
  "quantity",
  "effect",
  "direction",
  "studyType",
  "sampleSize",
  "measurementMethod",
  "uncertainty",
  "conditions",
];

export interface ReviewField {
  anchorId: string;
  field: string;
  owner: "CLAIM" | "SOURCE";
  /** The machine's value; null for an editor's question. */
  value: string | null;
  /** The model's word the vocabulary does not hold (an editor's question). */
  question: string | null;
  anchor: { text: string; locator: string };
  decision: ReviewAnchor["decision"];
  correctedValue: string | null;
}

export interface ClaimReview {
  id: string;
  status: string;
  source: {
    id: string;
    title: string;
    year: number | null;
    doi: string | null;
    url: string | null;
    retracted: boolean;
    corrected: boolean;
    /** The Crossref retraction check never ran on it (no DOI): accept with care. */
    retractionUnchecked: boolean;
  };
  passage: { text: string; locator: string };
  fields: ReviewField[];
  quantity: {
    min: string | null;
    max: string | null;
    unit: string | null;
    basis: "PO4" | "P" | null;
    normalizedMinMgL: string | null;
    normalizedMaxMgL: string | null;
  } | null;
  applicability: { value: Applicability; reason: string | null } | null;
  options: Record<
    "species" | "environment" | "effect",
    { key: string; label: string }[]
  >;
}

export class ClaimNotFound extends Error {
  constructor(id: string) {
    super(`no claim ${id}`);
    this.name = "ClaimNotFound";
  }
}

/** The claim is no longer a candidate, or a field changed under the editor. */
export class ClaimReviewConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaimReviewConflict";
  }
}

/** The screen reads one claim with exactly one evidence row (S3 writes one). */
export class ClaimShapeUnsupported extends Error {
  constructor(id: string) {
    super(`claim ${id} has more than one evidence row`);
    this.name = "ClaimShapeUnsupported";
  }
}

export const QUEUE_LIMIT = 500;

const ANCHOR_SELECT = {
  id: true,
  field: true,
  normalizedValue: true,
  proposedValue: true,
  decision: true,
  correctedValue: true,
  passage: { select: { text: true, locator: true } },
} satisfies Prisma.KnowledgeFieldAnchorSelect;

const CLAIM_SELECT = {
  id: true,
  status: true,
  originalMin: true,
  originalMax: true,
  originalUnit: true,
  chemicalBasis: true,
  normalizedMinMgL: true,
  normalizedMaxMgL: true,
  effect: true,
  direction: true,
  evidence: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      species: true,
      environment: true,
      sampleSize: true,
      sampleUnit: true,
      uncertainty: true,
      conditions: true,
      homeReefApplicability: true,
      applicabilityReason: true,
      anchors: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: ANCHOR_SELECT,
      },
      passage: {
        select: {
          text: true,
          locator: true,
          sourceVersion: {
            select: {
              source: {
                select: {
                  id: true,
                  title: true,
                  year: true,
                  doi: true,
                  url: true,
                  studyType: true,
                  measurementMethod: true,
                  retractionCheckedAt: true,
                  versions: { select: { versionKind: true } },
                },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.KnowledgeClaimSelect;

type Tx = Prisma.TransactionClient;
type LoadedClaim = Prisma.KnowledgeClaimGetPayload<{
  select: typeof CLAIM_SELECT;
}>;
type LoadedAnchor = Prisma.KnowledgeFieldAnchorGetPayload<{
  select: typeof ANCHOR_SELECT;
}>;

const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));
const conditionsText = (v: Prisma.JsonValue) =>
  v && typeof v === "object" && !Array.isArray(v) && typeof v.text === "string"
    ? v.text
    : null;

function anchorOf(a: LoadedAnchor, owner: "CLAIM" | "SOURCE"): ReviewAnchor {
  return {
    id: a.id,
    field: a.field,
    owner,
    text: a.passage.text,
    locator: a.passage.locator,
    normalizedValue: a.normalizedValue,
    proposedValue: a.proposedValue,
    decision: a.decision,
    correctedValue: a.correctedValue,
  };
}

/**
 * Whether the claim's stored mg/l PO4 values may be shown and kept: only when
 * its quantity anchor is about phosphate. Rows extracted before that rule
 * (a nitrate of 9 µmol/l stored as 0.85 mg/l PO4, acrobot 35808) are read by
 * it too, so the false number is neither shown nor verified.
 */
function phosphateQuantity(
  anchors: readonly Pick<ReviewAnchor, "field" | "text">[],
): boolean {
  return anchors.some((a) => a.field === "quantity" && phosphateNamed(a.text));
}

function columnsOf(
  claim: LoadedClaim,
  anchors: readonly Pick<ReviewAnchor, "field" | "text">[],
): ClaimColumns {
  const e = claim.evidence[0]!;
  const phosphate = phosphateQuantity(anchors);
  return {
    species: e.species,
    environment: e.environment,
    effect: claim.effect,
    direction: claim.direction,
    quantity: claim.originalUnit
      ? {
          min: num(claim.originalMin),
          max: num(claim.originalMax),
          unit: claim.originalUnit,
          basis: claim.chemicalBasis,
          normalizedMinMgL: phosphate ? num(claim.normalizedMinMgL) : null,
          normalizedMaxMgL: phosphate ? num(claim.normalizedMaxMgL) : null,
        }
      : null,
    sampleSize:
      e.sampleSize === null
        ? null
        : { value: e.sampleSize, unit: e.sampleUnit },
    uncertainty: e.uncertainty,
    conditions: conditionsText(e.conditions),
  };
}

/**
 * The vocabulary keys a correction may choose from, with their label: the
 * editor's working rows (the draft when there is one), so a key added from
 * one claim answers the same question on the next (acrobot 35807).
 */
export function reviewOptions(
  rows: readonly VocabularyRow[] = VOCABULARY_V1_ROWS,
): ClaimReview["options"] {
  const of = (kind: VocabularyKind) =>
    rows
      .filter((r) => r.kind === kind && r.status !== "RETIRED")
      .map((r) => ({ key: r.key, label: labelOf(r) }));
  return {
    species: of("TAXON"),
    environment: of("ENVIRONMENT"),
    effect: of("EFFECT"),
  };
}

export class ClaimReviewRepository {
  private readonly vocabulary = new VocabularyRepository();

  /**
   * The candidate claims on INCLUDED sources, in a stable order: the screen's
   * Előző / Következő. A pending or excluded source's claims are not the
   * editor's work (barracuda, #1848 note b); the overview counts the same set.
   */
  async queue(): Promise<{ ids: string[]; total: number }> {
    const [rows, total] = await prisma.$transaction([
      prisma.knowledgeClaim.findMany({
        where: { status: "CANDIDATE", ...CLAIM_ON_INCLUDED_SOURCE },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true },
        take: QUEUE_LIMIT,
      }),
      prisma.knowledgeClaim.count({
        where: { status: "CANDIDATE", ...CLAIM_ON_INCLUDED_SOURCE },
      }),
    ]);
    return { ids: rows.map((r) => r.id), total };
  }

  private async load(tx: Tx, claimId: string) {
    const claim = await tx.knowledgeClaim.findUnique({
      where: { id: claimId },
      select: CLAIM_SELECT,
    });
    if (!claim || claim.evidence.length === 0) throw new ClaimNotFound(claimId);
    if (claim.evidence.length > 1) throw new ClaimShapeUnsupported(claimId);
    const evidence = claim.evidence[0]!;
    const source = evidence.passage.sourceVersion.source;
    // a rejected source field decides nothing (planReview skips it), and the
    // ones a re-extraction rejected crowd out the live ones (acrobot 35941:
    // nine rows per claim, seven of them the old run's)
    const sourceAnchors = await tx.knowledgeFieldAnchor.findMany({
      where: { sourceId: source.id, decision: { not: "REJECTED" } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: ANCHOR_SELECT,
    });
    const anchors = [
      ...evidence.anchors.map((a) => anchorOf(a, "CLAIM")),
      ...sourceAnchors.map((a) => anchorOf(a, "SOURCE")),
    ];
    return { claim, evidence, source, anchors };
  }

  async detail(claimId: string): Promise<ClaimReview> {
    return prisma.$transaction(async (tx) => {
      const { claim, evidence, source, anchors } = await this.load(tx, claimId);
      const rank = (f: string) => {
        const i = FIELD_ORDER.indexOf(f as FieldName);
        return i < 0 ? FIELD_ORDER.length : i;
      };
      const fields = anchors
        .map((a, i) => ({ a, i }))
        .sort((x, y) => rank(x.a.field) - rank(y.a.field) || x.i - y.i)
        .map(({ a }) => ({
          anchorId: a.id,
          field: a.field,
          owner: a.owner,
          value: a.normalizedValue,
          question: a.proposedValue,
          anchor: { text: a.text, locator: a.locator },
          decision: a.decision,
          correctedValue: a.correctedValue,
        }));
      return {
        id: claim.id,
        status: claim.status,
        source: {
          id: source.id,
          title: source.title,
          year: source.year,
          doi: source.doi,
          url: source.url,
          retracted: source.versions.some(
            (v) => v.versionKind === "RETRACTION",
          ),
          corrected: source.versions.some((v) =>
            ["CORRECTION", "ERRATUM", "EXPRESSION_OF_CONCERN"].includes(
              v.versionKind,
            ),
          ),
          retractionUnchecked: source.retractionCheckedAt === null,
        },
        passage: {
          text: evidence.passage.text,
          locator: evidence.passage.locator,
        },
        fields,
        quantity: claim.originalUnit
          ? {
              min: claim.originalMin?.toString() ?? null,
              max: claim.originalMax?.toString() ?? null,
              unit: claim.originalUnit,
              basis: claim.chemicalBasis,
              normalizedMinMgL: phosphateQuantity(anchors)
                ? (claim.normalizedMinMgL?.toString() ?? null)
                : null,
              normalizedMaxMgL: phosphateQuantity(anchors)
                ? (claim.normalizedMaxMgL?.toString() ?? null)
                : null,
            }
          : null,
        applicability: evidence.homeReefApplicability
          ? {
              value: evidence.homeReefApplicability,
              reason: evidence.applicabilityReason,
            }
          : null,
        options: reviewOptions(workingRows(await this.vocabulary.versions(tx))),
      };
    });
  }

  /**
   * The editor's review, in one transaction: every anchor's decision, the
   * claim rebuilt from the kept anchors, the source fields they decide, the
   * claim VERIFIED, and one AuditLog row with the before and after.
   */
  async save(
    claimId: string,
    input: ReviewInput,
    actorUserId: string,
  ): Promise<ClaimReview> {
    await prisma.$transaction(async (tx) => {
      const { claim, evidence, source, anchors } = await this.load(tx, claimId);
      if (claim.status !== "CANDIDATE")
        throw new ClaimReviewConflict(
          "the claim is no longer waiting for review",
        );
      // nothing is built on a retracted work (plan v4): such a claim is
      // discarded, never verified (barracuda, #1848 note a; acrobot 35765)
      if (source.versions.some((v) => v.versionKind === "RETRACTION"))
        throw new ReviewInputError(
          "RETRACTED_SOURCE",
          "the source was retracted: a claim on it can only be discarded",
        );
      const before = columnsOf(claim, anchors);
      // a question answered with a new key: the draft vocabulary gets it, and
      // the field is a correction to it, through the same anchor check (S5)
      let rows: VocabularyRow[] = workingRows(
        await this.vocabulary.versions(tx),
      );
      const additions: { anchorId: string; entry: NewEntry }[] = [];
      const decisions = input.decisions.map((d) => {
        if (d.decision !== "ADD_TO_VOCABULARY") return d;
        const a = anchors.find((x) => x.id === d.anchorId);
        const kind = a ? ADDABLE_FIELDS[a.field] : undefined;
        if (!a || !kind || a.normalizedValue !== null || a.owner !== "CLAIM")
          throw new ReviewInputError(
            "ADD_NOT_A_QUESTION",
            "only a species or an effect the vocabulary does not hold is added to it",
          );
        const entry = parseNewEntry({ ...d.entry, kind }, rows);
        rows = [
          ...rows,
          {
            kind: entry.kind,
            key: entry.key,
            forms: entry.forms,
            parentKey: entry.parentKey,
            rank: entry.rank,
            note: entry.note,
            status: "DRAFT",
            version: rows[0]?.version ?? 1,
          },
        ];
        additions.push({ anchorId: a.id, entry });
        return { ...d, value: entry.key };
      });
      const plan = planReview(
        anchors,
        before,
        {
          studyType: source.studyType,
          measurementMethod: source.measurementMethod,
        },
        { ...input, decisions },
        editorsWorkingCopy(rows),
      );
      for (const { anchorId, entry } of additions)
        await this.vocabulary.addEntryIn(tx, entry, actorUserId, {
          claimId: claim.id,
          anchorId,
        });
      const now = new Date();
      for (const a of plan.anchors) {
        const { count } = await tx.knowledgeFieldAnchor.updateMany({
          where: { id: a.id, decision: "PENDING" },
          data: {
            decision: a.decision,
            correctedValue: a.correctedValue,
            decidedById: actorUserId,
            decidedAt: now,
          },
        });
        if (count !== 1)
          throw new ClaimReviewConflict("a field was decided meanwhile");
      }
      const q = plan.claim.quantity;
      const { count } = await tx.knowledgeClaim.updateMany({
        where: { id: claim.id, status: "CANDIDATE" },
        data: {
          status: "VERIFIED",
          effect: plan.claim.effect,
          direction: plan.claim.direction,
          originalMin: q?.min ?? null,
          originalMax: q?.max ?? null,
          originalUnit: q?.unit ?? null,
          chemicalBasis: q?.basis ?? null,
          normalizedMinMgL: q?.normalizedMinMgL ?? null,
          normalizedMaxMgL: q?.normalizedMaxMgL ?? null,
        },
      });
      if (count !== 1)
        throw new ClaimReviewConflict("the claim was reviewed meanwhile");
      await tx.knowledgeClaimEvidence.update({
        where: { id: evidence.id },
        data: {
          species: plan.claim.species,
          environment: plan.claim
            .environment as Prisma.KnowledgeClaimEvidenceUpdateInput["environment"],
          sampleSize: plan.claim.sampleSize?.value ?? null,
          sampleUnit: plan.claim.sampleSize?.unit ?? null,
          uncertainty: plan.claim.uncertainty,
          conditions: plan.claim.conditions
            ? { text: plan.claim.conditions }
            : {},
          ...(input.applicability
            ? {
                homeReefApplicability: input.applicability.value,
                applicabilityReason: input.applicability.reason,
                applicabilityDecidedById: actorUserId,
                applicabilityDecidedAt: now,
              }
            : {}),
        },
      });
      if (Object.keys(plan.source).length > 0)
        await tx.knowledgeSource.update({
          where: { id: source.id },
          data: plan.source as Prisma.KnowledgeSourceUpdateInput,
        });
      await tx.auditLog.create({
        data: {
          userId: actorUserId,
          action: "KNOWLEDGE_CLAIM_REVIEWED",
          entityType: "KnowledgeClaim",
          entityId: claim.id,
          metadata: {
            before: { status: claim.status, ...before },
            after: {
              status: "VERIFIED",
              ...plan.claim,
              source: plan.source,
              applicability: input.applicability,
            },
            decisions: plan.anchors.map((a) => ({
              anchorId: a.id,
              decision: a.decision,
              correctedValue: a.correctedValue,
            })),
          } as unknown as Prisma.InputJsonValue,
        },
      });
    });
    return this.detail(claimId);
  }

  /**
   * A VERIFIED claim the editor accepted by mistake (acrobot 35960: a light
   * effect accepted as a phosphate one): it is WITHDRAWN, so the claim store
   * and everything built on VERIFIED claims drop it, with the editor's reason
   * in the log. Its field decisions stay as they were: they are the history
   * of the mistake, and a withdrawn claim is never reviewed again.
   */
  async withdraw(
    claimId: string,
    reason: string,
    actorUserId: string,
  ): Promise<{ id: string; status: "WITHDRAWN" }> {
    await prisma.$transaction(async (tx) => {
      const claim = await tx.knowledgeClaim.findUnique({
        where: { id: claimId },
        select: { id: true, status: true },
      });
      if (!claim) throw new ClaimNotFound(claimId);
      const { count } = await tx.knowledgeClaim.updateMany({
        where: { id: claim.id, status: "VERIFIED" },
        data: { status: "WITHDRAWN" },
      });
      if (count !== 1)
        throw new ClaimReviewConflict(
          "only a verified claim is withdrawn; a candidate is discarded",
        );
      await tx.auditLog.create({
        data: {
          userId: actorUserId,
          action: "KNOWLEDGE_CLAIM_WITHDRAWN",
          entityType: "KnowledgeClaim",
          entityId: claim.id,
          metadata: {
            before: { status: "VERIFIED" },
            after: { status: "WITHDRAWN" },
            reason,
          },
        },
      });
    });
    return { id: claimId, status: "WITHDRAWN" };
  }

  /**
   * The whole claim is wrong (the effect or the direction cannot stand): it is
   * WITHDRAWN, its pending fields rejected, with the editor's reason in the log.
   */
  async discard(
    claimId: string,
    reason: string,
    actorUserId: string,
  ): Promise<ClaimReview> {
    await prisma.$transaction(async (tx) => {
      const { claim, evidence } = await this.load(tx, claimId);
      if (claim.status !== "CANDIDATE")
        throw new ClaimReviewConflict(
          "the claim is no longer waiting for review",
        );
      const { count } = await tx.knowledgeClaim.updateMany({
        where: { id: claim.id, status: "CANDIDATE" },
        data: { status: "WITHDRAWN" },
      });
      if (count !== 1)
        throw new ClaimReviewConflict("the claim was reviewed meanwhile");
      const now = new Date();
      // only the claim's own fields: a source field belongs to the source, not to this claim
      const rejected = await tx.knowledgeFieldAnchor.updateMany({
        where: { claimEvidenceId: evidence.id, decision: "PENDING" },
        data: {
          decision: "REJECTED",
          decidedById: actorUserId,
          decidedAt: now,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actorUserId,
          action: "KNOWLEDGE_CLAIM_DISCARDED",
          entityType: "KnowledgeClaim",
          entityId: claim.id,
          metadata: {
            before: { status: claim.status },
            after: { status: "WITHDRAWN" },
            reason,
            fieldsRejected: rejected.count,
          },
        },
      });
    });
    return this.detail(claimId);
  }
}
