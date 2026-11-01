import { Prisma, prisma } from "@acropora/database";

import type {
  ExclusionReason,
  ScreeningDecision,
  ScreeningStatus,
  SourceKind,
  SourceListQuery,
  StudyTypeDecision,
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
  /** The source's text was read once (its ORIGINAL version has a full-text hash): no manual PDF is taken then (research-kezi-pdf). */
  fullTextRead: boolean;
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
 * `unique` every source row (hand-added ones too); `notNew` the found records
 * that did NOT become a new source row: identified minus the rows a discovery
 * run created.
 *
 * `notNew` is NOT a duplicate count, and the screen does not call it one
 * (barracuda, #1841): besides the works found twice (two queries, two APIs, a
 * later run) it holds the candidates not stored (a DOI the notice check did
 * not cover, an ambiguous match) and the skipped records. The runs do not
 * store those apart today, so the honest number is the sum, named as such. A
 * hand-added source is outside it on both sides.
 */
export interface ScreeningSummary {
  identified: number;
  unique: number;
  notNew: number;
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

/** Why a source cannot be classified by hand: the editor's words for each. */
export const CLASSIFY_REFUSALS = {
  NOT_INCLUDED: "Csak befogadott forrás sorolható be.",
  RETRACTED: "Visszavont forrásra nem épülhet semmi: nem sorolható be.",
  ALREADY_CLASSIFIED:
    "A forrásnak már van vizsgálati típusa; egy állítás ellenőrzésénél dől el, nem itt.",
  PENDING_ANCHOR:
    "A forrásnak van függő vizsgálati-típus horgonya: azt egy állítás ellenőrzésénél döntsd el, a szöveghellyel együtt.",
} as const;

export class SourceClassifyRefused extends Error {
  constructor(readonly code: keyof typeof CLASSIFY_REFUSALS) {
    super(CLASSIFY_REFUSALS[code]);
    this.name = "SourceClassifyRefused";
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
  versions: { select: { versionKind: true, contentHash: true } },
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
    fullTextRead: s.versions.some(
      (v) => v.versionKind === "ORIGINAL" && v.contentHash !== null,
    ),
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
    const [runs, unique, discovered, byStatus, byReason] = await Promise.all([
      prisma.knowledgeDiscoveryRun.findMany({
        where: { status: "FINISHED" },
        select: { queries: true },
      }),
      prisma.knowledgeSource.count(),
      prisma.knowledgeSource.count({
        where: { discoveryRunId: { not: null } },
      }),
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
      notNew: Math.max(0, identified - discovered),
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
      // the row is locked before its "before" is read: two decisions at once
      // queue here, and each AuditLog row holds the state it really replaced
      // (barracuda, #1841 note a)
      await tx.$queryRaw`SELECT 1 FROM "KnowledgeSource" WHERE "id" = ${sourceId} FOR UPDATE`;
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

  /**
   * The study type of an included source no anchor classifies, by the editor,
   * with a reason, in one transaction with its AuditLog row. Only the gap is
   * filled: a type already set, or one a pending anchor would set from the
   * text, is the claim review's to decide (the anchor shows the passage).
   */
  async classify(
    sourceId: string,
    decision: StudyTypeDecision,
    actorUserId: string,
  ): Promise<SourceRow> {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "KnowledgeSource" WHERE "id" = ${sourceId} FOR UPDATE`;
      const before = await tx.knowledgeSource.findUnique({
        where: { id: sourceId },
        select: {
          screeningStatus: true,
          studyType: true,
          controlled: true,
          versions: { select: { versionKind: true } },
        },
      });
      if (!before) throw new SourceNotFound(sourceId);
      if (before.screeningStatus !== "INCLUDED")
        throw new SourceClassifyRefused("NOT_INCLUDED");
      // the screen hides the form on a retracted work; the server says the same
      // to a direct call (barracuda on #1986)
      if (before.versions.some((v) => v.versionKind === "RETRACTION"))
        throw new SourceClassifyRefused("RETRACTED");
      if (before.studyType !== null)
        throw new SourceClassifyRefused("ALREADY_CLASSIFIED");
      const pending = await tx.knowledgeFieldAnchor.count({
        where: { sourceId, field: "studyType", decision: "PENDING" },
      });
      if (pending > 0) throw new SourceClassifyRefused("PENDING_ANCHOR");
      const updated = await tx.knowledgeSource.update({
        where: { id: sourceId },
        data: {
          studyType: decision.studyType,
          ...(decision.controlled === null
            ? {}
            : { controlled: decision.controlled }),
        },
        select: SELECT,
      });
      await tx.auditLog.create({
        data: {
          userId: actorUserId,
          action: "KNOWLEDGE_SOURCE_CLASSIFIED",
          entityType: "KnowledgeSource",
          entityId: sourceId,
          metadata: {
            before: {
              studyType: before.studyType,
              controlled: before.controlled,
            },
            after: {
              studyType: decision.studyType,
              controlled: decision.controlled ?? before.controlled,
            },
            note: decision.note,
          } satisfies Prisma.JsonObject,
        },
      });
      return row(updated);
    });
  }
}
