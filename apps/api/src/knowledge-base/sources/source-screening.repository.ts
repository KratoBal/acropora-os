import { Prisma, prisma } from "@acropora/database";

import type {
  ExclusionReason,
  ScreeningDecision,
  ScreeningStatus,
  SourceKind,
  SourceListQuery,
} from "./source-screening.js";

/**
 * THE SCREENING'S DATABASE SIDE (S4). Reads the knowledge tables, and writes
 * only a source's screening fields, with an `AuditLog` row in the same
 * transaction (plan 9.2 S4: every decision is logged; the JEV's missing audit
 * is not repeated here).
 */
export interface SourceRow {
  id: string;
  title: string;
  /** The first three names; `authorCount` says how many there are. */
  authors: string[];
  authorCount: number;
  year: number | null;
  venue: string | null;
  kind: SourceKind;
  studyType: string | null;
  licence: string;
  openAccess: boolean;
  doi: string | null;
  url: string | null;
  /** Later versions the discovery recorded (a retraction is red on the screen). */
  retracted: boolean;
  corrected: boolean;
  /** The Crossref retraction check never ran on it (no DOI). */
  retractionUnchecked: boolean;
  screening: {
    status: ScreeningStatus;
    reason: ExclusionReason | null;
    note: string | null;
    by: { id: string; displayName: string } | null;
    at: Date | null;
  };
}

export interface SourceList {
  items: SourceRow[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * The PRISMA-like counts on top of the screen. `identified` is what the
 * discovery runs fetched (every FINISHED run's queries, re-finds included);
 * `unique` the sources kept; `duplicatesRemoved` the difference: the works
 * found more than once (by two queries, two APIs, or a later run).
 */
export interface ScreeningSummary {
  identified: number;
  unique: number;
  duplicatesRemoved: number;
  pending: number;
  included: number;
  excluded: number;
  excludedByReason: Record<ExclusionReason, number>;
}

export class SourceNotFound extends Error {
  constructor(readonly sourceId: string) {
    super(`knowledge source ${sourceId} not found`);
    this.name = "SourceNotFound";
  }
}

const SELECT = {
  id: true,
  title: true,
  authors: true,
  year: true,
  venue: true,
  kind: true,
  studyType: true,
  license: true,
  oaUrl: true,
  doi: true,
  url: true,
  retractionCheckedAt: true,
  screeningStatus: true,
  exclusionReason: true,
  screeningNote: true,
  screenedAt: true,
  screenedBy: { select: { id: true, displayName: true } },
  versions: { select: { versionKind: true } },
} as const;

type Selected = Prisma.KnowledgeSourceGetPayload<{ select: typeof SELECT }>;

function row(s: Selected): SourceRow {
  const names = (Array.isArray(s.authors) ? s.authors : [])
    .map((a) =>
      a && typeof a === "object" && "name" in a && typeof a.name === "string"
        ? a.name
        : null,
    )
    .filter((n): n is string => !!n);
  return {
    id: s.id,
    title: s.title,
    authors: names.slice(0, 3),
    authorCount: names.length,
    year: s.year,
    venue: s.venue,
    kind: s.kind as SourceKind,
    studyType: s.studyType,
    licence: s.license,
    openAccess: s.oaUrl !== null,
    doi: s.doi,
    url: s.url,
    retracted: s.versions.some((v) => v.versionKind === "RETRACTION"),
    corrected: s.versions.some((v) =>
      ["CORRECTION", "ERRATUM", "EXPRESSION_OF_CONCERN"].includes(
        v.versionKind,
      ),
    ),
    retractionUnchecked: s.retractionCheckedAt === null,
    screening: {
      status: s.screeningStatus as ScreeningStatus,
      reason: (s.exclusionReason as ExclusionReason | null) ?? null,
      note: s.screeningNote,
      by: s.screenedBy,
      at: s.screenedAt,
    },
  };
}

function where(q: SourceListQuery): Prisma.KnowledgeSourceWhereInput {
  return {
    ...(q.status ? { screeningStatus: q.status } : {}),
    ...(q.kind ? { kind: q.kind } : {}),
    ...(q.yearFrom !== null || q.yearTo !== null
      ? {
          year: {
            ...(q.yearFrom !== null ? { gte: q.yearFrom } : {}),
            ...(q.yearTo !== null ? { lte: q.yearTo } : {}),
          },
        }
      : {}),
    ...(q.openAccess === true ? { oaUrl: { not: null } } : {}),
    ...(q.openAccess === false ? { oaUrl: null } : {}),
  };
}

export class SourceScreeningRepository {
  async list(q: SourceListQuery): Promise<SourceList> {
    const filter = where(q);
    const [rows, total] = await prisma.$transaction([
      prisma.knowledgeSource.findMany({
        where: filter,
        select: SELECT,
        // the newest first, then a stable order: a page does not reshuffle
        orderBy: [{ year: { sort: "desc", nulls: "last" } }, { id: "asc" }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.knowledgeSource.count({ where: filter }),
    ]);
    return { items: rows.map(row), total, page: q.page, pageSize: q.pageSize };
  }

  async summary(): Promise<ScreeningSummary> {
    const [runs, unique, byStatus, byReason] = await Promise.all([
      prisma.knowledgeDiscoveryRun.findMany({
        where: { status: "FINISHED" },
        select: { queries: true },
      }),
      prisma.knowledgeSource.count(),
      prisma.knowledgeSource.groupBy({
        by: ["screeningStatus"],
        _count: { _all: true },
      }),
      prisma.knowledgeSource.groupBy({
        by: ["exclusionReason"],
        where: { screeningStatus: "EXCLUDED" },
        _count: { _all: true },
      }),
    ]);
    const identified = runs.reduce((sum, run) => {
      const queries = Array.isArray(run.queries) ? run.queries : [];
      return (
        sum +
        queries.reduce<number>((n, q) => {
          const fetched =
            q && typeof q === "object" && "fetched" in q
              ? Number(q.fetched)
              : 0;
          return n + (Number.isFinite(fetched) ? fetched : 0);
        }, 0)
      );
    }, 0);
    const status = (s: ScreeningStatus) =>
      byStatus.find((b) => b.screeningStatus === s)?._count._all ?? 0;
    const excludedByReason = Object.fromEntries(
      (
        [
          "NOT_MARINE",
          "NOT_CORAL",
          "NOT_RELEVANT",
          "DUPLICATE",
          "OTHER",
        ] as const
      ).map((r) => [
        r,
        byReason.find((b) => b.exclusionReason === r)?._count._all ?? 0,
      ]),
    ) as Record<ExclusionReason, number>;
    return {
      identified,
      unique,
      duplicatesRemoved: Math.max(0, identified - unique),
      pending: status("PENDING"),
      included: status("INCLUDED"),
      excluded: status("EXCLUDED"),
      excludedByReason,
    };
  }

  async decide(
    sourceId: string,
    decision: ScreeningDecision,
    actorUserId: string,
  ): Promise<SourceRow> {
    return prisma.$transaction(async (tx) => {
      const before = await tx.knowledgeSource.findUnique({
        where: { id: sourceId },
        select: {
          screeningStatus: true,
          exclusionReason: true,
          screeningNote: true,
        },
      });
      if (!before) throw new SourceNotFound(sourceId);
      const decided = decision.status !== "PENDING";
      const updated = await tx.knowledgeSource.update({
        where: { id: sourceId },
        data: {
          screeningStatus: decision.status,
          exclusionReason: decision.reason,
          screeningNote: decision.note,
          screenedById: decided ? actorUserId : null,
          screenedAt: decided ? new Date() : null,
        },
        select: SELECT,
      });
      await tx.auditLog.create({
        data: {
          userId: actorUserId,
          action: "KNOWLEDGE_SOURCE_SCREENED",
          entityType: "KnowledgeSource",
          entityId: sourceId,
          metadata: {
            before: {
              status: before.screeningStatus,
              reason: before.exclusionReason,
              note: before.screeningNote,
            },
            after: {
              status: decision.status,
              reason: decision.reason,
              note: decision.note,
            },
          } satisfies Prisma.JsonObject,
        },
      });
      return row(updated);
    });
  }
}
