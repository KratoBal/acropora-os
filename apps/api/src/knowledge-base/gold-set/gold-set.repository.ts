import { Prisma, prisma } from "@acropora/database";

import {
  GOLD_MAX_CLAIMS_PER_SOURCE,
  GOLD_MIN_CLAIMS,
  MAX_MISSED_PER_SOURCE,
  SOURCE_ROW_FIELDS,
  judgeRow,
  judgeSourceRow,
  placeClaims,
  proposeGoldSet,
  sampleClaims,
  scoreGoldSet,
  type AnchorDecision,
  type GoldProposal,
  type GoldScore,
  type MissedClaimInput,
  type RowJudgement,
  type SourceRowJudgement,
} from "./gold-set.js";

export interface GoldRowView {
  claimId: string;
  /** null: the frozen claim is no longer in the database. */
  status: string | null;
  passage: { text: string; locator: string } | null;
  fields: {
    field: string;
    value: string | null;
    correctedValue: string | null;
    decision: AnchorDecision;
  }[];
  judgement: RowJudgement;
}

export interface GoldSourceView {
  sourceId: string;
  position: number;
  title: string;
  year: number | null;
  doi: string | null;
  rows: GoldRowView[];
  missed: {
    id: string;
    text: string;
    locator: string | null;
    createdAt: Date;
  }[];
  completenessCheckedAt: Date | null;
  /** The source's machine claims the set did not take (the cap): reviewed nowhere here. */
  notInSet: number;
  /** T3b: the source's study fields and their verdict, counted apart. */
  sourceRow: {
    fields: GoldRowView["fields"];
    judgement: SourceRowJudgement;
  };
}

export interface GoldSetView {
  frozen: boolean;
  frozenAt: Date | null;
  sources: GoldSourceView[];
  /** Before the freeze: the fleet's proposal from the extractions. */
  proposal: GoldProposal | null;
  score: GoldScore;
}

export class GoldSetConflict extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GoldSetConflict";
  }
}

export class GoldSetNotFound extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoldSetNotFound";
  }
}

/** The actions after which a withdrawn claim is the editor's judgement. */
const EDITOR_WITHDREW = [
  "KNOWLEDGE_CLAIM_DISCARDED",
  "KNOWLEDGE_CLAIM_WITHDRAWN",
] as const;

type Tx = Prisma.TransactionClient;

async function editorWithdrawn(
  tx: Tx,
  claimIds: readonly string[],
): Promise<Set<string>> {
  if (!claimIds.length) return new Set();
  const rows = await tx.auditLog.findMany({
    where: {
      entityType: "KnowledgeClaim",
      entityId: { in: [...claimIds] },
      action: { in: [...EDITOR_WITHDREW] },
    },
    select: { entityId: true },
  });
  return new Set(
    rows.flatMap((r) => (r.entityId === null ? [] : [r.entityId])),
  );
}

/**
 * The machine claims of these sources a review can score: waiting,
 * accepted, or withdrawn by the editor (not by a re-extraction).
 */
async function scorableClaims(
  tx: Tx,
  sourceIds: readonly string[],
): Promise<Map<string, string[]>> {
  const evidence = await tx.knowledgeClaimEvidence.findMany({
    where: {
      // a claim the extraction wrote: its evidence stands on a machine passage
      passage: {
        extractedBy: { not: null },
        sourceVersion: { sourceId: { in: [...sourceIds] } },
      },
      claim: { status: { in: ["CANDIDATE", "VERIFIED", "WITHDRAWN"] } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      claimId: true,
      claim: { select: { status: true } },
      passage: { select: { sourceVersion: { select: { sourceId: true } } } },
    },
  });
  const withdrawn = await editorWithdrawn(
    tx,
    evidence
      .filter((e) => e.claim.status === "WITHDRAWN")
      .map((e) => e.claimId),
  );
  return placeClaims(
    evidence
      .filter((e) => e.claim.status !== "WITHDRAWN" || withdrawn.has(e.claimId))
      .map((e) => ({
        claimId: e.claimId,
        sourceId: e.passage.sourceVersion.sourceId,
      })),
  );
}

const ROW_SELECT = {
  id: true,
  status: true,
  evidence: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      sampleSize: true,
      passage: { select: { text: true, locator: true } },
      anchors: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          field: true,
          normalizedValue: true,
          correctedValue: true,
          decision: true,
        },
      },
    },
  },
} satisfies Prisma.KnowledgeClaimSelect;

const GOLD_SELECT = {
  sourceId: true,
  position: true,
  claimIds: true,
  frozenAt: true,
  completenessCheckedAt: true,
  source: {
    select: { title: true, year: true, doi: true, controlled: true },
  },
  missed: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, text: true, locator: true, createdAt: true },
  },
} satisfies Prisma.KnowledgeGoldSourceSelect;

/**
 * THE T3 GOLD SET ON THE DATABASE. Reading assembles the rows from the
 * claim review's stored decisions; the writes are the freeze, a missed
 * claim (added or removed) and the completeness mark, each in one
 * transaction with its AuditLog row.
 */
export class GoldSetRepository {
  async view(): Promise<GoldSetView> {
    return prisma.$transaction(async (tx) => {
      const gold = await tx.knowledgeGoldSource.findMany({
        orderBy: { position: "asc" },
        select: GOLD_SELECT,
      });
      if (!gold.length) {
        const proposal = await this.proposal(tx);
        return {
          frozen: false,
          frozenAt: null,
          sources: [],
          proposal,
          score: scoreGoldSet([]),
        };
      }
      const claimIds = gold.flatMap((g) => g.claimIds);
      const claims = await tx.knowledgeClaim.findMany({
        where: { id: { in: claimIds } },
        select: ROW_SELECT,
      });
      const byId = new Map(claims.map((c) => [c.id, c]));
      const studyAnchors = await tx.knowledgeFieldAnchor.findMany({
        where: {
          sourceId: { in: gold.map((g) => g.sourceId) },
          field: { in: [...SOURCE_ROW_FIELDS] },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          sourceId: true,
          field: true,
          normalizedValue: true,
          correctedValue: true,
          decision: true,
        },
      });
      const withdrawn = await editorWithdrawn(
        tx,
        claims.filter((c) => c.status === "WITHDRAWN").map((c) => c.id),
      );
      const scorable = await scorableClaims(
        tx,
        gold.map((g) => g.sourceId),
      );
      const sources: GoldSourceView[] = gold.map((g) => {
        const fields = studyAnchors
          .filter((a) => a.sourceId === g.sourceId)
          .map((a) => ({
            field: a.field,
            value: a.normalizedValue,
            correctedValue: a.correctedValue,
            decision: a.decision as AnchorDecision,
          }));
        return {
          sourceId: g.sourceId,
          position: g.position,
          title: g.source.title,
          year: g.source.year,
          doi: g.source.doi,
          rows: g.claimIds.map((id) => rowOf(id, byId.get(id), withdrawn)),
          missed: g.missed,
          completenessCheckedAt: g.completenessCheckedAt,
          notInSet: (scorable.get(g.sourceId) ?? []).filter(
            (id) => !g.claimIds.includes(id),
          ).length,
          sourceRow: {
            fields,
            judgement: judgeSourceRow({
              fields: fields.map((f) => ({
                field: f.field,
                machineValue: f.value,
                correctedValue: f.correctedValue,
                decision: f.decision,
              })),
              controlled: g.source.controlled,
              sampleSizes: g.claimIds.flatMap(
                (id) => byId.get(id)?.evidence.map((e) => e.sampleSize) ?? [],
              ),
            }),
          },
        };
      });
      return {
        frozen: true,
        frozenAt: gold[0]!.frozenAt,
        sources,
        proposal: null,
        score: scoreGoldSet(
          sources.map((s) => ({
            sourceId: s.sourceId,
            rows: s.rows.map((r) => r.judgement),
            missed: s.missed.length,
            completenessChecked: s.completenessCheckedAt !== null,
            sourceRow: s.sourceRow.judgement,
          })),
        ),
      };
    });
  }

  private async proposal(tx: Tx): Promise<GoldProposal> {
    const included = await tx.knowledgeSource.findMany({
      where: { screeningStatus: "INCLUDED" },
      select: { id: true, title: true, year: true },
    });
    const claims = await scorableClaims(
      tx,
      included.map((s) => s.id),
    );
    return proposeGoldSet(
      included.map((s) => ({
        sourceId: s.id,
        title: s.title,
        year: s.year,
        claims: claims.get(s.id)?.length ?? 0,
      })),
    );
  }

  /**
   * Freezes the set once: every source INCLUDED with at least one machine
   * claim, thirty claims together. A second freeze is a conflict.
   */
  async freeze(sourceIds: readonly string[], userId: string): Promise<void> {
    await prisma.$transaction(
      async (tx) => {
        if (await tx.knowledgeGoldSource.count())
          throw new GoldSetConflict(
            "ALREADY_FROZEN",
            "the gold set is already frozen",
          );
        const included = await tx.knowledgeSource.findMany({
          where: { id: { in: [...sourceIds] }, screeningStatus: "INCLUDED" },
          select: { id: true },
        });
        const ok = new Set(included.map((s) => s.id));
        const notIncluded = sourceIds.filter((id) => !ok.has(id));
        if (notIncluded.length)
          throw new GoldSetConflict(
            "NOT_INCLUDED",
            `not an included source: ${notIncluded.join(", ")}`,
          );
        const all = await scorableClaims(tx, sourceIds);
        // at most six from one source, an even spread over the extraction order
        const claims = new Map(
          sourceIds.map((id) => [id, sampleClaims(all.get(id) ?? [])]),
        );
        const empty = sourceIds.filter((id) => !claims.get(id)?.length);
        if (empty.length)
          throw new GoldSetConflict(
            "NO_MACHINE_CLAIMS",
            `no machine claim on: ${empty.join(", ")}`,
          );
        const total = sourceIds.reduce(
          (n, id) => n + (claims.get(id)?.length ?? 0),
          0,
        );
        if (total < GOLD_MIN_CLAIMS)
          throw new GoldSetConflict(
            "TOO_FEW_CLAIMS",
            `the sources give ${total} machine claims to the set (at most ${GOLD_MAX_CLAIMS_PER_SOURCE} from one), the gold set needs ${GOLD_MIN_CLAIMS}`,
          );
        const frozenAt = new Date();
        await tx.knowledgeGoldSource.createMany({
          data: sourceIds.map((sourceId, i) => ({
            sourceId,
            position: i + 1,
            claimIds: claims.get(sourceId)!,
            frozenById: userId,
            frozenAt,
          })),
        });
        await tx.auditLog.create({
          data: {
            userId,
            action: "KNOWLEDGE_GOLD_SET_FROZEN",
            entityType: "KnowledgeGoldSource",
            entityId: sourceIds[0]!,
            metadata: {
              after: {
                sources: sourceIds.map((id) => ({
                  sourceId: id,
                  claimIds: claims.get(id)!,
                  notInSet: (all.get(id)?.length ?? 0) - claims.get(id)!.length,
                })),
                claims: total,
              },
            },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async addMissed(
    sourceId: string,
    input: MissedClaimInput,
    userId: string,
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const gold = await this.goldSource(tx, sourceId);
      if (gold.completenessCheckedAt)
        throw new GoldSetConflict(
          "COMPLETENESS_CHECKED",
          "the source is marked complete; reopen it first",
        );
      if (
        (await tx.knowledgeGoldMissedClaim.count({
          where: { goldSourceId: gold.id },
        })) >= MAX_MISSED_PER_SOURCE
      )
        throw new GoldSetConflict(
          "TOO_MANY_MISSED",
          `at most ${MAX_MISSED_PER_SOURCE} missed claims per source`,
        );
      const created = await tx.knowledgeGoldMissedClaim.create({
        data: { goldSourceId: gold.id, ...input, createdById: userId },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: "KNOWLEDGE_GOLD_MISSED_ADDED",
          entityType: "KnowledgeGoldMissedClaim",
          entityId: created.id,
          metadata: { after: { sourceId, ...input } },
        },
      });
    });
  }

  async removeMissed(missedId: string, userId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const missed = await tx.knowledgeGoldMissedClaim.findUnique({
        where: { id: missedId },
        select: {
          id: true,
          text: true,
          locator: true,
          goldSource: {
            select: { sourceId: true, completenessCheckedAt: true },
          },
        },
      });
      if (!missed) throw new GoldSetNotFound("no such missed claim");
      if (missed.goldSource.completenessCheckedAt)
        throw new GoldSetConflict(
          "COMPLETENESS_CHECKED",
          "the source is marked complete; reopen it first",
        );
      await tx.knowledgeGoldMissedClaim.delete({ where: { id: missed.id } });
      await tx.auditLog.create({
        data: {
          userId,
          action: "KNOWLEDGE_GOLD_MISSED_REMOVED",
          entityType: "KnowledgeGoldMissedClaim",
          entityId: missed.id,
          metadata: {
            before: {
              sourceId: missed.goldSource.sourceId,
              text: missed.text,
              locator: missed.locator,
            },
          },
        },
      });
    });
  }

  async setCompleteness(
    sourceId: string,
    checked: boolean,
    userId: string,
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const gold = await this.goldSource(tx, sourceId);
      if ((gold.completenessCheckedAt !== null) === checked) return;
      await tx.knowledgeGoldSource.update({
        where: { id: gold.id },
        data: checked
          ? {
              completenessCheckedById: userId,
              completenessCheckedAt: new Date(),
            }
          : { completenessCheckedById: null, completenessCheckedAt: null },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: checked
            ? "KNOWLEDGE_GOLD_COMPLETENESS_CHECKED"
            : "KNOWLEDGE_GOLD_COMPLETENESS_REOPENED",
          entityType: "KnowledgeGoldSource",
          entityId: gold.id,
          metadata: { sourceId },
        },
      });
    });
  }

  private async goldSource(tx: Tx, sourceId: string) {
    const gold = await tx.knowledgeGoldSource.findUnique({
      where: { sourceId },
      select: { id: true, completenessCheckedAt: true },
    });
    if (!gold) throw new GoldSetNotFound("the source is not in the gold set");
    return gold;
  }
}

type LoadedRow = Prisma.KnowledgeClaimGetPayload<{
  select: typeof ROW_SELECT;
}>;

function rowOf(
  claimId: string,
  claim: LoadedRow | undefined,
  withdrawn: ReadonlySet<string>,
): GoldRowView {
  const evidence = claim?.evidence[0];
  // every evidence row's fields: a second row's decisions count too (barracuda, #1948)
  const fields = (claim?.evidence ?? [])
    .flatMap((e) => e.anchors)
    .map((a) => ({
      field: a.field,
      value: a.normalizedValue,
      correctedValue: a.correctedValue,
      decision: a.decision as AnchorDecision,
    }));
  return {
    claimId,
    status: claim?.status ?? null,
    passage: evidence ? evidence.passage : null,
    fields,
    judgement: judgeRow({
      id: claimId,
      status: claim?.status ?? null,
      fields: fields.map((f) => ({
        field: f.field,
        machineValue: f.value,
        decision: f.decision,
      })),
      editorWithdrew: withdrawn.has(claimId),
    }),
  };
}
