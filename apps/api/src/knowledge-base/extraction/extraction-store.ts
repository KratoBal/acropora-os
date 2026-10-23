import { createHash } from "node:crypto";

import { Prisma, prisma } from "@acropora/database";

import {
  RunAbandoned,
  RunAlreadyRunning,
} from "../discovery/discovery-run.store.js";
import { SOURCE_FIELDS, type CheckedClaim } from "./claim-check.js";

/**
 * THE EXTRACTION'S DATABASE SIDE (S3). It writes only the knowledge tables:
 * the run record, and per source the passages, the CANDIDATE claims, their
 * evidence and one field anchor per field (or per editor's question). No
 * claim is VERIFIED here: every field is PENDING until the editor (S4)
 * accepts, corrects or rejects it.
 *
 * Every passage and anchor text is a `KnowledgePassage` row of the source's
 * ORIGINAL version, verified verbatim against the downloaded text at
 * `verifiedVerbatimAt`, with the model and prompt version in `extractedBy`.
 * A source is extracted once: a second run skips it (ALREADY_EXTRACTED), so
 * no claim is written twice.
 */
export interface SourceForExtraction {
  id: string;
  pmcid: string | null;
  retracted: boolean;
  /**
   * The editor included it at screening (S4 Forrásszűrés). Only an included
   * source is read: extraction costs an AI call, and the plan's step 3 reads
   * what screening let through (acrobot 35716).
   */
  included: boolean;
  /**
   * Its ORIGINAL version carries a full-text hash: an extraction ran on it,
   * whether it found claims or not (barracuda, #1838: a source with no claim
   * left no passage and was read, and paid for, again on every run).
   */
  alreadyExtracted: boolean;
  /** The Crossref retraction check never ran on it (no DOI): reported, not hidden. */
  retractionUnchecked: boolean;
}

export interface SavedSource {
  claimsCreated: number;
  anchorsCreated: number;
  questions: number;
  /** Re-extraction: the earlier CANDIDATE claims withdrawn. */
  claimsWithdrawn?: number;
}

export interface ExtractionRunRow {
  id: string;
  status: string;
  sourceIds: string[];
  claimsCreated: number;
  startedAt: Date;
  finishedAt: Date | null;
  requestedBy: { id: string; displayName: string };
}

export interface ExtractionRunDetail extends ExtractionRunRow {
  report: unknown;
}

export interface ExtractionStore {
  source(id: string): Promise<SourceForExtraction | null>;
  saveSource(input: {
    sourceId: string;
    /** sha256 of the downloaded full text, on the ORIGINAL version. */
    contentHash: string;
    extractedBy: string;
    claims: readonly CheckedClaim[];
    verifiedAt: Date;
    /** The run storing it: only while its row is RUNNING (a stale-failed run writes nothing). */
    runId?: string;
    /** Re-extraction: withdraw the source's CANDIDATE claims first, in this user's name. */
    replaceCandidatesBy?: string;
  }): Promise<SavedSource>;
  startRun(input: {
    sourceIds: string[];
    requestedById: string;
    startedAt: Date;
  }): Promise<string>;
  finishRun(
    runId: string,
    report: unknown,
    claimsCreated: number,
  ): Promise<void>;
  failRun(runId: string, reason: string): Promise<void>;
  heartbeat(runId: string): Promise<void>;
  abandonStale(before: Date): Promise<number>;
  listRuns(limit: number): Promise<ExtractionRunRow[]>;
  getRun(id: string): Promise<ExtractionRunDetail | null>;
}

export const sha256 = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex");

const RUN_ROW_SELECT = {
  id: true,
  status: true,
  sourceIds: true,
  claimsCreated: true,
  startedAt: true,
  finishedAt: true,
  requestedBy: { select: { id: true, displayName: true } },
} as const;

/** A claim field's value as the Decimal column holds it. */
const decimal = (n: number | null) =>
  n === null ? null : new Prisma.Decimal(n.toString());

export class PrismaExtractionStore implements ExtractionStore {
  async source(id: string): Promise<SourceForExtraction | null> {
    const row = await prisma.knowledgeSource.findUnique({
      where: { id },
      select: {
        id: true,
        pmcid: true,
        screeningStatus: true,
        retractionCheckedAt: true,
        versions: { select: { versionKind: true, contentHash: true } },
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      pmcid: row.pmcid,
      retracted: row.versions.some((v) => v.versionKind === "RETRACTION"),
      included: row.screeningStatus === "INCLUDED",
      alreadyExtracted: row.versions.some(
        (v) => v.versionKind === "ORIGINAL" && v.contentHash !== null,
      ),
      retractionUnchecked: row.retractionCheckedAt === null,
    };
  }

  async saveSource(input: {
    sourceId: string;
    contentHash: string;
    extractedBy: string;
    claims: readonly CheckedClaim[];
    verifiedAt: Date;
    runId?: string;
    replaceCandidatesBy?: string;
  }): Promise<SavedSource> {
    return prisma.$transaction(
      async (tx) => {
        if (input.runId) {
          // the row is still ours, and stays locked until the end (as in the discovery)
          const ours = await tx.knowledgeExtractionRun.updateMany({
            where: { id: input.runId, status: "RUNNING" },
            data: { heartbeatAt: new Date() },
          });
          if (ours.count === 0) throw new RunAbandoned(input.runId);
        }
        const original =
          (await tx.knowledgeSourceVersion.findFirst({
            where: { sourceId: input.sourceId, versionKind: "ORIGINAL" },
            select: { id: true, contentHash: true },
            orderBy: { createdAt: "asc" },
          })) ??
          (await tx.knowledgeSourceVersion.create({
            data: {
              sourceId: input.sourceId,
              versionKind: "ORIGINAL",
              detectedVia: "MANUAL",
            },
            select: { id: true, contentHash: true },
          }));
        if (!original.contentHash)
          await tx.knowledgeSourceVersion.update({
            where: { id: original.id },
            data: { contentHash: input.contentHash },
          });
        const withdrawn = input.replaceCandidatesBy
          ? await this.withdrawCandidates(
              tx,
              input.sourceId,
              input.replaceCandidatesBy,
              input.runId ?? null,
            )
          : 0;

        const passageIds = new Map<string, string>();
        const passageFor = async (text: string, locator: string) => {
          const textHash = sha256(text);
          const key = `${locator}\u0000${textHash}`;
          const known = passageIds.get(key);
          if (known) return known;
          const found = await tx.knowledgePassage.findUnique({
            where: {
              sourceVersionId_locator_textHash: {
                sourceVersionId: original.id,
                locator,
                textHash,
              },
            },
            select: { id: true },
          });
          const id =
            found?.id ??
            (
              await tx.knowledgePassage.create({
                data: {
                  sourceVersionId: original.id,
                  locator,
                  text,
                  textHash,
                  verifiedVerbatimAt: input.verifiedAt,
                  extractedBy: input.extractedBy,
                },
                select: { id: true },
              })
            ).id;
          passageIds.set(key, id);
          return id;
        };

        const saved: SavedSource = {
          claimsCreated: 0,
          anchorsCreated: 0,
          questions: 0,
          claimsWithdrawn: withdrawn,
        };
        for (const c of input.claims) {
          const passageId = await passageFor(c.passage.text, c.passage.locator);
          const claim = await tx.knowledgeClaim.create({
            data: {
              layer: "SCIENTIFIC",
              subject: "PHOSPHATE",
              status: "CANDIDATE",
              originalMin: decimal(c.quantity?.min ?? null),
              originalMax: decimal(c.quantity?.max ?? null),
              originalUnit: c.quantity?.unit ?? null,
              chemicalBasis: c.quantity?.basis ?? null,
              normalizedMinMgL: decimal(c.quantity?.normalizedMinMgL ?? null),
              normalizedMaxMgL: decimal(c.quantity?.normalizedMaxMgL ?? null),
              effect: c.effect,
              direction: c.direction,
            },
            select: { id: true },
          });
          const evidence = await tx.knowledgeClaimEvidence.create({
            data: {
              claimId: claim.id,
              passageId,
              stance: "SUPPORTS",
              sampleSize: c.sampleSize?.value ?? null,
              sampleUnit: c.sampleSize?.unit ?? null,
              uncertainty: c.uncertainty,
              species: c.species ? [c.species] : [],
              environment: c.environment,
              conditions: c.conditions ? { text: c.conditions } : {},
            },
            select: { id: true },
          });
          for (const a of c.anchors) {
            const anchorPassage = await passageFor(a.text, a.locator);
            const onSource = SOURCE_FIELDS.includes(a.field);
            await tx.knowledgeFieldAnchor.create({
              data: {
                claimEvidenceId: onSource ? null : evidence.id,
                sourceId: onSource ? input.sourceId : null,
                field: a.field,
                passageId: anchorPassage,
                normalizedValue: a.normalizedValue,
                proposedValue: a.proposed ?? null,
              },
            });
            saved.anchorsCreated += 1;
            if (a.proposed !== undefined) saved.questions += 1;
          }
          saved.claimsCreated += 1;
        }
        return saved;
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  }

  /**
   * Re-extraction: the source's still CANDIDATE claims are WITHDRAWN and their
   * pending fields REJECTED, as a discard would (the claim review's
   * `discard`), and the source's pending study fields with them; a claim the
   * editor already reviewed stays. One AuditLog row names the counts.
   */
  private async withdrawCandidates(
    tx: Prisma.TransactionClient,
    sourceId: string,
    actorUserId: string,
    runId: string | null,
  ): Promise<number> {
    const onSource = { passage: { sourceVersion: { sourceId } } };
    const claimIds = [
      ...new Set(
        (
          await tx.knowledgeClaimEvidence.findMany({
            where: { ...onSource, claim: { status: "CANDIDATE" } },
            select: { claimId: true },
          })
        ).map((e) => e.claimId),
      ),
    ];
    const now = new Date();
    const fields = await tx.knowledgeFieldAnchor.updateMany({
      where: {
        decision: "PENDING",
        OR: [{ claimEvidence: { claimId: { in: claimIds } } }, { sourceId }],
      },
      data: { decision: "REJECTED", decidedById: actorUserId, decidedAt: now },
    });
    const { count } = await tx.knowledgeClaim.updateMany({
      where: { id: { in: claimIds }, status: "CANDIDATE" },
      data: { status: "WITHDRAWN" },
    });
    if (count > 0 || fields.count > 0)
      await tx.auditLog.create({
        data: {
          userId: actorUserId,
          action: "KNOWLEDGE_CLAIMS_REEXTRACTED",
          entityType: "KnowledgeSource",
          entityId: sourceId,
          metadata: {
            claimsWithdrawn: count,
            fieldsRejected: fields.count,
            runId,
          },
        },
      });
    return count;
  }

  async startRun(input: {
    sourceIds: string[];
    requestedById: string;
    startedAt: Date;
  }): Promise<string> {
    try {
      const run = await prisma.knowledgeExtractionRun.create({
        data: { ...input, status: "RUNNING", heartbeatAt: input.startedAt },
        select: { id: true },
      });
      return run.id;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new RunAlreadyRunning();
      throw error;
    }
  }

  async finishRun(
    runId: string,
    report: unknown,
    claimsCreated: number,
  ): Promise<void> {
    const done = await prisma.knowledgeExtractionRun.updateMany({
      where: { id: runId, status: "RUNNING" },
      data: {
        status: "FINISHED",
        report: report as Prisma.InputJsonValue,
        claimsCreated,
        finishedAt: new Date(),
      },
    });
    if (done.count === 0) throw new RunAbandoned(runId);
  }

  async failRun(runId: string, reason: string): Promise<void> {
    // only its own RUNNING row: a run failed as stale keeps STALE_RUNNING
    await prisma.knowledgeExtractionRun.updateMany({
      where: { id: runId, status: "RUNNING" },
      data: {
        status: "FAILED",
        report: { error: reason.slice(0, 64) },
        finishedAt: new Date(),
      },
    });
  }

  async heartbeat(runId: string): Promise<void> {
    await prisma.knowledgeExtractionRun.updateMany({
      where: { id: runId, status: "RUNNING" },
      data: { heartbeatAt: new Date() },
    });
  }

  async abandonStale(before: Date): Promise<number> {
    const stale = await prisma.knowledgeExtractionRun.updateMany({
      where: {
        status: "RUNNING",
        OR: [
          { heartbeatAt: { lt: before } },
          { heartbeatAt: null, startedAt: { lt: before } },
        ],
      },
      data: {
        status: "FAILED",
        report: { error: "STALE_RUNNING" },
        finishedAt: new Date(),
      },
    });
    return stale.count;
  }

  async listRuns(limit: number): Promise<ExtractionRunRow[]> {
    return prisma.knowledgeExtractionRun.findMany({
      select: RUN_ROW_SELECT,
      orderBy: { startedAt: "desc" },
      take: limit,
    });
  }

  async getRun(id: string): Promise<ExtractionRunDetail | null> {
    return prisma.knowledgeExtractionRun.findUnique({
      where: { id },
      select: { ...RUN_ROW_SELECT, report: true },
    });
  }
}
