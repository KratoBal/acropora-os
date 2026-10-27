import { Prisma, prisma } from "@acropora/database";

import type { DraftResult } from "./research-draft.js";

/**
 * THE RESEARCH DRAFT'S ROW (S6 mode B). It exists while the chain runs
 * (RUNNING, beating every minute), and ends as DRAFT (with its summary and
 * the model that wrote it) or FAILED (with the reason, the sources and the
 * candidate claims found so far). One RUNNING row at a time: the partial
 * unique index of the migration holds it across api instances.
 *
 * This file writes the draft table only. A claim is never written from here
 * (research-draft-isolation.test.ts reads every source file for that).
 */
export class DraftAlreadyRunning extends Error {
  constructor() {
    super("a research draft is already RUNNING");
    this.name = "DraftAlreadyRunning";
  }
}

export interface DraftRow {
  id: string;
  question: string;
  status: string;
  summaryModel: string | null;
  createdById: string;
  createdAt: Date;
  finishedAt: Date | null;
}

export interface DraftDetail extends DraftRow {
  summary: string | null;
  sources: Prisma.JsonValue;
  candidateClaims: Prisma.JsonValue;
  report: Prisma.JsonValue;
}

export interface DraftStore {
  abandonStale(before: Date): Promise<number>;
  running(): Promise<{ id: string } | null>;
  /** A discovery or an extraction RUNNING: they share the scholarly APIs' keyless budget and the AI. */
  otherRunRunning(): Promise<boolean>;
  start(input: {
    question: string;
    createdById: string;
    startedAt: Date;
  }): Promise<string>;
  heartbeat(id: string): Promise<void>;
  finish(id: string, result: DraftResult, at: Date): Promise<void>;
  fail(id: string, error: string, at: Date): Promise<void>;
  list(limit: number): Promise<DraftRow[]>;
  get(id: string): Promise<DraftDetail | null>;
}

const ROW = {
  id: true,
  question: true,
  status: true,
  summaryModel: true,
  createdById: true,
  createdAt: true,
  finishedAt: true,
} as const;

const json = (value: unknown) => value as Prisma.InputJsonValue;

export class PrismaDraftStore implements DraftStore {
  async abandonStale(before: Date): Promise<number> {
    const stale = await prisma.knowledgeResearchDraft.updateMany({
      where: {
        status: "RUNNING",
        OR: [
          { heartbeatAt: { lt: before } },
          { heartbeatAt: null, createdAt: { lt: before } },
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

  running(): Promise<{ id: string } | null> {
    return prisma.knowledgeResearchDraft.findFirst({
      where: { status: "RUNNING" },
      select: { id: true },
    });
  }

  async otherRunRunning(): Promise<boolean> {
    const [discovery, extraction] = await Promise.all([
      prisma.knowledgeDiscoveryRun.count({ where: { status: "RUNNING" } }),
      prisma.knowledgeExtractionRun.count({ where: { status: "RUNNING" } }),
    ]);
    return discovery + extraction > 0;
  }

  async start(input: {
    question: string;
    createdById: string;
    startedAt: Date;
  }): Promise<string> {
    try {
      const row = await prisma.knowledgeResearchDraft.create({
        data: {
          question: input.question,
          status: "RUNNING",
          createdById: input.createdById,
          createdAt: input.startedAt,
          heartbeatAt: input.startedAt,
        },
        select: { id: true },
      });
      return row.id;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new DraftAlreadyRunning();
      throw error;
    }
  }

  async heartbeat(id: string): Promise<void> {
    await prisma.knowledgeResearchDraft.updateMany({
      where: { id, status: "RUNNING" },
      data: { heartbeatAt: new Date() },
    });
  }

  async finish(id: string, result: DraftResult, at: Date): Promise<void> {
    // only its own RUNNING row: a draft failed as stale meanwhile stays FAILED
    await prisma.knowledgeResearchDraft.updateMany({
      where: { id, status: "RUNNING" },
      data: {
        status: result.status,
        summary: result.summary,
        summaryModel: result.summaryModel,
        sources: json(result.sources),
        candidateClaims: json(result.candidateClaims),
        report: json(result.report),
        finishedAt: at,
      },
    });
  }

  async fail(id: string, error: string, at: Date): Promise<void> {
    await prisma.knowledgeResearchDraft.updateMany({
      where: { id, status: "RUNNING" },
      data: {
        status: "FAILED",
        report: { error: error.slice(0, 64) },
        finishedAt: at,
      },
    });
  }

  list(limit: number): Promise<DraftRow[]> {
    return prisma.knowledgeResearchDraft.findMany({
      select: ROW,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  get(id: string): Promise<DraftDetail | null> {
    return prisma.knowledgeResearchDraft.findUnique({
      where: { id },
      select: {
        ...ROW,
        summary: true,
        sources: true,
        candidateClaims: true,
        report: true,
      },
    });
  }
}
