import { Prisma, prisma } from "@acropora/database";
import type { Vocabulary } from "@acropora/knowledge-base";

import { candidateOf } from "../answers/knowledge-answer.repository.js";
import {
  LIST_SELECT,
  sourceOf,
  sourceRef,
  type ListClaim,
} from "../claims/claim-store.repository.js";
import { CLAIM_ON_INCLUDED_SOURCE } from "../included-source.js";
import {
  claimFlagItem,
  conclusionFlagItem,
  judgeFlags,
  pendingItems,
  type Built,
  type CurrentItem,
  type FlagItem,
  type FlagTarget,
  type FlagView,
  type FlagWrite,
  type FlagWriteResult,
  type NotOffered,
} from "./model-flag.js";

type Client = Prisma.TransactionClient | typeof prisma;

const CLAIM_SELECT = { ...LIST_SELECT, subject: true } as const;

const NO_SOURCES = new Map();

/** The items waiting for a flag, per target: the pending list and the write's check read the same rule. */
const PENDING_WHERE = {
  CLAIM: { status: "CANDIDATE" as const, ...CLAIM_ON_INCLUDED_SOURCE },
  CONCLUSION: { status: "DRAFT" as const },
} satisfies Record<FlagTarget, object>;

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === "P2002";

/** The claim's model input: its scope, and its live, verbatim-verified supporting passages. */
function claimItem(c: ListClaim & { subject: string }, vocabulary: Vocabulary) {
  const scope = candidateOf(c, NO_SOURCES).scope;
  const passages = c.evidence
    .filter(
      (e) =>
        e.stance === "SUPPORTS" &&
        !sourceRef(sourceOf(e)).retracted &&
        e.passage.verifiedVerbatimAt !== null,
    )
    .map((e) => e.passage.text);
  return claimFlagItem({
    id: c.id,
    effect: scope.effect,
    direction: scope.direction,
    taxa: scope.taxa,
    passages,
    vocabulary,
  });
}

const CONCLUSION_SELECT = {
  id: true,
  text: true,
  claims: {
    orderBy: { claimId: "asc" },
    select: { claim: { select: CLAIM_SELECT } },
  },
} satisfies Prisma.KnowledgeConclusionSelect;

type ConclusionRow = Prisma.KnowledgeConclusionGetPayload<{
  select: typeof CONCLUSION_SELECT;
}>;

function conclusionItem(c: ConclusionRow, vocabulary: Vocabulary) {
  return conclusionFlagItem({
    id: c.id,
    text: c.text,
    basis: c.claims.map(({ claim }) => {
      const candidate = candidateOf(claim, NO_SOURCES);
      // the statement is built from the scope and the quantity; the citation
      // (null without a verbatim source) is not part of it
      return {
        claim: { ...candidate, citation: candidate.citation ?? "" },
        quantity: candidate.quantity,
      };
    }),
    vocabulary,
  });
}

/**
 * THE SECOND MODEL'S FLAGS (S4, 7a 3.): the items waiting for a flag, the
 * append-only write, and the latest flag per item for the editor's surface.
 * Every input is built by the same function for the list and for the write's
 * check, so the digest the fleet got is the digest the write is held to.
 */
export class ModelFlagRepository {
  constructor(
    /**
     * Runs inside a write after the run's rows are read, before the insert:
     * the integration spec holds two writes here to make their race certain.
     */
    private readonly afterRunRead: () => Promise<void> = async () => {},
  ) {}

  private async built(
    client: Client,
    targetType: FlagTarget,
    where:
      Prisma.KnowledgeClaimWhereInput | Prisma.KnowledgeConclusionWhereInput,
    vocabulary: Vocabulary,
  ): Promise<Built<FlagItem>[]> {
    if (targetType === "CLAIM") {
      const rows = await client.knowledgeClaim.findMany({
        where: where as Prisma.KnowledgeClaimWhereInput,
        orderBy: [{ id: "asc" }],
        select: CLAIM_SELECT,
      });
      return rows.map((c) => claimItem(c, vocabulary));
    }
    const rows = await client.knowledgeConclusion.findMany({
      where: where as Prisma.KnowledgeConclusionWhereInput,
      orderBy: [{ id: "asc" }],
      select: CONCLUSION_SELECT,
    });
    return rows.map((c) => conclusionItem(c, vocabulary));
  }

  /** Every stored digest per item: an item is waiting while its current one has no row. */
  private async storedHashes(
    client: Client,
    targetType: FlagTarget,
    ids: readonly string[],
  ): Promise<Map<string, Set<string>>> {
    const rows = await client.knowledgeModelFlag.findMany({
      where: { targetType, targetId: { in: [...ids] } },
      select: { targetId: true, targetHash: true },
    });
    const out = new Map<string, Set<string>>();
    for (const r of rows) {
      const set = out.get(r.targetId) ?? new Set<string>();
      set.add(r.targetHash);
      out.set(r.targetId, set);
    }
    return out;
  }

  async pending(
    targetType: FlagTarget,
    limit: number,
    vocabulary: Vocabulary,
  ): Promise<{
    targetType: FlagTarget;
    items: FlagItem[];
    total: number;
    notOffered: NotOffered[];
  }> {
    const built = await this.built(
      prisma,
      targetType,
      PENDING_WHERE[targetType],
      vocabulary,
    );
    const items = built.flatMap((b) => (b.ok ? [b.item] : []));
    const notOffered = built.flatMap((b) => (b.ok ? [] : [b.notOffered]));
    const stored = await this.storedHashes(
      prisma,
      targetType,
      items.map((i) => i.targetId),
    );
    return { targetType, ...pendingItems(items, stored, limit), notOffered };
  }

  /**
   * The write, in one transaction: each flag is checked against the item's
   * input as it is now and against the pending rule; the accepted ones are
   * inserted, and one AuditLog row names the run, its accepted and its
   * refused items. Nothing is updated or deleted: a second run on the same
   * item is a new row.
   *
   * Two writes of the same run and item at once both read an empty run, and
   * the second insert meets the unique index (barracuda, #1994 review). The
   * transaction is then gone, so the write is read once more from the start:
   * the stored row makes it "already written" or "another verdict in the run",
   * as a retry would, instead of a 500.
   */
  async write(
    input: FlagWrite,
    userId: string,
    vocabulary: Vocabulary,
  ): Promise<FlagWriteResult> {
    try {
      return await this.writeOnce(input, userId, vocabulary);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return this.writeOnce(input, userId, vocabulary);
    }
  }

  private async writeOnce(
    input: FlagWrite,
    userId: string,
    vocabulary: Vocabulary,
  ): Promise<FlagWriteResult> {
    return prisma.$transaction(async (tx) => {
      const current = new Map<string, CurrentItem>();
      for (const targetType of ["CLAIM", "CONCLUSION"] as const) {
        const ids = input.flags
          .filter((f) => f.targetType === targetType)
          .map((f) => f.targetId);
        if (ids.length === 0) continue;
        const built = await this.built(
          tx,
          targetType,
          { id: { in: ids } },
          vocabulary,
        );
        const waiting = new Set(
          (targetType === "CLAIM"
            ? await tx.knowledgeClaim.findMany({
                where: { id: { in: ids }, ...PENDING_WHERE.CLAIM },
                select: { id: true },
              })
            : await tx.knowledgeConclusion.findMany({
                where: { id: { in: ids }, ...PENDING_WHERE.CONCLUSION },
                select: { id: true },
              })
          ).map((r) => r.id),
        );
        for (const b of built)
          if (b.ok)
            current.set(`${targetType}:${b.item.targetId}`, {
              hash: b.item.targetHash,
              pending: waiting.has(b.item.targetId),
            });
      }
      const inRun = await tx.knowledgeModelFlag.findMany({
        where: { runId: input.runId },
        select: { targetType: true, targetId: true, flagged: true },
      });
      await this.afterRunRead();
      const judged = judgeFlags(
        input,
        (t, id) => current.get(`${t}:${id}`) ?? null,
        new Map(inRun.map((r) => [`${r.targetType}:${r.targetId}`, r.flagged])),
      );
      if (judged.toWrite.length > 0)
        await tx.knowledgeModelFlag.createMany({
          data: judged.toWrite.map((f) => ({
            targetType: f.targetType,
            targetId: f.targetId,
            targetHash: f.targetHash,
            source: input.source,
            runId: input.runId,
            model: input.model,
            promptSha256: input.promptSha256,
            flagged: f.flagged,
            createdById: userId,
          })),
        });
      await tx.auditLog.create({
        data: {
          userId,
          action: "KNOWLEDGE_MODEL_FLAGS_WRITTEN",
          entityType: "KnowledgeModelFlag",
          entityId: input.runId,
          metadata: {
            source: input.source,
            model: input.model,
            promptSha256: input.promptSha256,
            written: judged.toWrite.map((f) => ({
              targetType: f.targetType,
              targetId: f.targetId,
              flagged: f.flagged,
            })),
            alreadyWritten: judged.alreadyWritten,
            rejected: judged.rejected,
          },
        },
      });
      return {
        runId: input.runId,
        written: judged.toWrite.length,
        alreadyWritten: judged.alreadyWritten,
        rejected: judged.rejected,
      };
    });
  }

  /** The latest flag per item, and whether the item is still what the model read. */
  async latest(
    targetType: FlagTarget,
    ids: readonly string[],
    vocabulary: Vocabulary,
  ): Promise<Record<string, FlagView | null>> {
    const rows = await prisma.knowledgeModelFlag.findMany({
      where: { targetType, targetId: { in: [...ids] } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        targetId: true,
        targetHash: true,
        flagged: true,
        source: true,
        runId: true,
        model: true,
        createdAt: true,
      },
    });
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows)
      if (!latest.has(r.targetId)) latest.set(r.targetId, r);
    const built =
      latest.size === 0
        ? []
        : await this.built(
            prisma,
            targetType,
            { id: { in: [...latest.keys()] } },
            vocabulary,
          );
    const now = new Map(
      built.flatMap((b) =>
        b.ok ? [[b.item.targetId, b.item.targetHash]] : [],
      ),
    );
    const out: Record<string, FlagView | null> = {};
    for (const id of ids) {
      const r = latest.get(id);
      out[id] = r
        ? {
            flagged: r.flagged,
            source: r.source,
            runId: r.runId,
            model: r.model,
            createdAt: r.createdAt.toISOString(),
            current: now.get(id) === r.targetHash,
          }
        : null;
    }
    return out;
  }
}
