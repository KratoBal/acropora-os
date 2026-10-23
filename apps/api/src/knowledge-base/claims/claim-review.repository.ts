import { Prisma, prisma } from "@acropora/database";
import {
  VOCABULARY_V1_ROWS,
  vocabularyV1,
  type VocabularyKind,
} from "@acropora/knowledge-base";

import type { FieldName } from "../extraction/claim-check.js";
import {
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

function columnsOf(claim: LoadedClaim): ClaimColumns {
  const e = claim.evidence[0]!;
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
          normalizedMinMgL: num(claim.normalizedMinMgL),
          normalizedMaxMgL: num(claim.normalizedMaxMgL),
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

const capitalised = (s: string) =>
  s.charAt(0).toLocaleUpperCase("hu-HU") + s.slice(1);

/** The approved vocabulary keys a correction may choose from, with a label. */
export function reviewOptions(): ClaimReview["options"] {
  const of = (kind: VocabularyKind) =>
    VOCABULARY_V1_ROWS.filter(
      (r) => r.kind === kind && r.status === "APPROVED",
    ).map((r) => ({
      key: r.key,
      label:
        r.forms[0] === undefined
          ? r.key
          : kind === "TAXON" && r.forms[0].length <= 3
            ? r.forms[0].toUpperCase()
            : capitalised(r.forms[0]),
    }));
  return {
    species: of("TAXON"),
    environment: of("ENVIRONMENT"),
    effect: of("EFFECT"),
  };
}

export class ClaimReviewRepository {
  /** The candidate claims in a stable order: the screen's Előző / Következő. */
  async queue(): Promise<{ ids: string[]; total: number }> {
    const [rows, total] = await prisma.$transaction([
      prisma.knowledgeClaim.findMany({
        where: { status: "CANDIDATE" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true },
        take: QUEUE_LIMIT,
      }),
      prisma.knowledgeClaim.count({ where: { status: "CANDIDATE" } }),
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
    const sourceAnchors = await tx.knowledgeFieldAnchor.findMany({
      where: { sourceId: source.id },
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
              normalizedMinMgL: claim.normalizedMinMgL?.toString() ?? null,
              normalizedMaxMgL: claim.normalizedMaxMgL?.toString() ?? null,
            }
          : null,
        applicability: evidence.homeReefApplicability
          ? {
              value: evidence.homeReefApplicability,
              reason: evidence.applicabilityReason,
            }
          : null,
        options: reviewOptions(),
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
      const before = columnsOf(claim);
      const plan = planReview(
        anchors,
        before,
        {
          studyType: source.studyType,
          measurementMethod: source.measurementMethod,
        },
        input,
        vocabularyV1(),
      );
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
