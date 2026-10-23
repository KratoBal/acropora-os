import { Prisma, prisma } from "@acropora/database";

import type { DiscoveryInput, DiscoveryResult } from "./discovery-run.js";
import { stricterLicence, type Licence, LICENCES } from "./identifiers.js";
import type { SourceCandidate } from "./records.js";
import { isStorable, versionsFor } from "./store-plan.js";

/**
 * THE DISCOVERY'S DATABASE SIDE. It writes only the knowledge tables: the run
 * record, `KnowledgeSource` and `KnowledgeSourceVersion` rows, and the one
 * status change a retraction forces on the claims built on it. No product,
 * no customer, no Commerce table is read or written here.
 *
 * A known work is found by ANY of its identifiers (DOI, OpenAlex id, PMID,
 * PMCID): the same paper never becomes a second row (S2 acceptance 2). On a
 * known row only empty fields are filled; what an editor wrote stays. The
 * licence is the one exception, and it only ever gets stricter.
 */
export interface StoreSummary {
  runId: string | null;
  created: number;
  matched: number;
  versionsCreated: number;
  claimsDisputed: number;
  /**
   * Candidates that matched two or more rows, or one row holding a DIFFERENT
   * value of an identifier the candidate has (two DOIs for "one" work): not
   * touched, reported, for a person to look at.
   */
  ambiguous: { identifiers: string; rowIds: string[] }[];
  /** Candidates with a DOI the notice check did not cover: not stored. */
  unchecked: number;
  /**
   * Stored works the Crossref retraction check could NOT run on (no DOI):
   * their `retractionCheckedAt` stays NULL, so no later slice may take them
   * as checked (barracuda, #1834 review). Counted apart, not hidden.
   */
  retractionUnchecked: number;
}

export interface DiscoveryRunStart {
  input: DiscoveryInput;
  requestedById: string;
  startedAt: Date;
}

export interface DiscoveryStore {
  /** Read-only: what storing these candidates would do. */
  preview(result: DiscoveryResult): Promise<StoreSummary>;
  /** The run record, RUNNING, before any request goes out. */
  startRun(start: DiscoveryRunStart): Promise<string>;
  /**
   * The run's end. Only a FINISHED result stores sources; any other status
   * records the queries and the reason, and stores nothing.
   */
  finishRun(runId: string, result: DiscoveryResult): Promise<StoreSummary>;
  /** A run that threw: FAILED, with the error's name only (never its text). */
  failRun(runId: string, reason: string): Promise<void>;
  /** The running process's sign of life, every `HEARTBEAT_MS`. */
  heartbeat(runId: string): Promise<void>;
}

function identifierFilter(
  candidate: SourceCandidate,
): Prisma.KnowledgeSourceWhereInput[] {
  const or: Prisma.KnowledgeSourceWhereInput[] = [];
  if (candidate.doi) or.push({ doi: candidate.doi });
  if (candidate.openalexId) or.push({ openalexId: candidate.openalexId });
  if (candidate.pmid) or.push({ pmid: candidate.pmid });
  if (candidate.pmcid) or.push({ pmcid: candidate.pmcid });
  return or;
}

const identifiersOf = (c: SourceCandidate): string =>
  [
    c.doi && `doi:${c.doi}`,
    c.openalexId && `openalex:${c.openalexId}`,
    c.pmid && `pmid:${c.pmid}`,
    c.pmcid && `pmcid:${c.pmcid}`,
  ]
    .filter(Boolean)
    .join(" ");

type Db = Prisma.TransactionClient;

const MATCH_SELECT = {
  id: true,
  doi: true,
  openalexId: true,
  pmid: true,
  pmcid: true,
  url: true,
  year: true,
  venue: true,
  oaUrl: true,
  license: true,
} as const;

async function matchExisting(db: Db, candidate: SourceCandidate) {
  const or = identifierFilter(candidate);
  if (!or.length) return [];
  return db.knowledgeSource.findMany({
    where: { OR: or },
    select: MATCH_SELECT,
    orderBy: { id: "asc" },
  });
}

type MatchRow = Awaited<ReturnType<typeof matchExisting>>[number];

/** One row, but it names the work with another DOI, PMID...: not the same work for sure. */
function contradicts(row: MatchRow, candidate: SourceCandidate): boolean {
  return (["doi", "openalexId", "pmid", "pmcid"] as const).some(
    (field) =>
      row[field] && candidate[field] && row[field] !== candidate[field],
  );
}

const asLicence = (value: string): Licence =>
  (LICENCES as readonly string[]).includes(value)
    ? (value as Licence)
    : "UNKNOWN";

/** The run records as the endpoint shows them (S2, acrobot 35604; the S4 overview reads these). */
export interface DiscoveryRunRow {
  id: string;
  label: string;
  status: string;
  requestCount: number;
  sourcesCreated: number;
  sourcesMatched: number;
  versionsCreated: number;
  claimsDisputed: number;
  startedAt: Date;
  finishedAt: Date | null;
  requestedBy: { id: string; displayName: string };
}

export interface DiscoveryRunDetail extends DiscoveryRunRow {
  input: unknown;
  queries: unknown;
  report: unknown;
}

/** Another run is RUNNING: the database's partial unique index said so. */
export class RunAlreadyRunning extends Error {
  constructor() {
    super("a knowledge discovery run is already RUNNING");
    this.name = "RunAlreadyRunning";
  }
}

export interface DiscoveryRunLedger {
  /**
   * RUNNING runs whose last heartbeat is before `before` (the process died
   * under them): FAILED. A long run that still beats is not touched.
   */
  abandonStale(before: Date): Promise<number>;
  /** A run still RUNNING, if any. */
  running(): Promise<{ id: string; startedAt: Date } | null>;
  listRuns(limit: number): Promise<DiscoveryRunRow[]>;
  getRun(id: string): Promise<DiscoveryRunDetail | null>;
}

const RUN_ROW_SELECT = {
  id: true,
  label: true,
  status: true,
  requestCount: true,
  sourcesCreated: true,
  sourcesMatched: true,
  versionsCreated: true,
  claimsDisputed: true,
  startedAt: true,
  finishedAt: true,
  requestedBy: { select: { id: true, displayName: true } },
} as const;

export class PrismaDiscoveryStore
  implements DiscoveryStore, DiscoveryRunLedger
{
  async abandonStale(before: Date): Promise<number> {
    const stale = await prisma.knowledgeDiscoveryRun.updateMany({
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

  async heartbeat(runId: string): Promise<void> {
    await prisma.knowledgeDiscoveryRun.updateMany({
      where: { id: runId, status: "RUNNING" },
      data: { heartbeatAt: new Date() },
    });
  }

  async running(): Promise<{ id: string; startedAt: Date } | null> {
    return prisma.knowledgeDiscoveryRun.findFirst({
      where: { status: "RUNNING" },
      select: { id: true, startedAt: true },
      orderBy: { startedAt: "desc" },
    });
  }

  async listRuns(limit: number): Promise<DiscoveryRunRow[]> {
    return prisma.knowledgeDiscoveryRun.findMany({
      select: RUN_ROW_SELECT,
      orderBy: { startedAt: "desc" },
      take: limit,
    });
  }

  async getRun(id: string): Promise<DiscoveryRunDetail | null> {
    return prisma.knowledgeDiscoveryRun.findUnique({
      where: { id },
      select: { ...RUN_ROW_SELECT, input: true, queries: true, report: true },
    });
  }

  async preview(result: DiscoveryResult): Promise<StoreSummary> {
    const checked = new Set(result.checkedDois);
    const summary = emptySummary();
    for (const candidate of result.candidates) {
      if (!isStorable(candidate, checked)) {
        summary.unchecked += 1;
        continue;
      }
      const rows = await matchExisting(prisma, candidate);
      if (
        rows.length > 1 ||
        (rows.length === 1 && contradicts(rows[0]!, candidate))
      )
        summary.ambiguous.push({
          identifiers: identifiersOf(candidate),
          rowIds: rows.map((r) => r.id),
        });
      else {
        if (rows.length === 1) summary.matched += 1;
        else summary.created += 1;
        if (!candidate.doi) summary.retractionUnchecked += 1;
      }
    }
    return summary;
  }

  async startRun(start: DiscoveryRunStart): Promise<string> {
    try {
      const run = await prisma.knowledgeDiscoveryRun.create({
        data: {
          label: start.input.label,
          status: "RUNNING",
          input: start.input as unknown as Prisma.InputJsonValue,
          requestedById: start.requestedById,
          startedAt: start.startedAt,
          heartbeatAt: start.startedAt,
        },
        select: { id: true },
      });
      return run.id;
    } catch (error) {
      // the one-RUNNING-row index: two api instances cannot both start
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new RunAlreadyRunning();
      throw error;
    }
  }

  async failRun(runId: string, reason: string): Promise<void> {
    await prisma.knowledgeDiscoveryRun.update({
      where: { id: runId },
      data: {
        status: "FAILED",
        report: { error: reason.slice(0, 64) },
        finishedAt: new Date(),
      },
    });
  }

  async finishRun(
    runId: string,
    result: DiscoveryResult,
  ): Promise<StoreSummary> {
    const checked = new Set(result.checkedDois);
    const record = (summary: StoreSummary) => ({
      status: result.status,
      queries: result.queries as unknown as Prisma.InputJsonValue,
      requestCount: result.requestCount,
      report: {
        skipped: result.skipped,
        conflicts: result.conflicts,
        unavailable: result.unavailable,
        crossrefUnknownDois: result.crossrefUnknownDois,
        notFoundDois: result.notFoundDois,
        ambiguous: summary.ambiguous,
        retractionUnchecked: summary.retractionUnchecked,
      } as unknown as Prisma.InputJsonValue,
      sourcesCreated: summary.created,
      sourcesMatched: summary.matched,
      versionsCreated: summary.versionsCreated,
      claimsDisputed: summary.claimsDisputed,
      finishedAt: new Date(),
    });
    if (result.status !== "FINISHED") {
      const summary = { ...emptySummary(), runId };
      await prisma.knowledgeDiscoveryRun.update({
        where: { id: runId },
        data: record(summary),
      });
      return summary;
    }
    return prisma.$transaction(
      async (tx) => {
        const created = { id: runId };
        const summary = emptySummary();
        summary.runId = runId;
        const checkedAt = new Date();
        for (const candidate of result.candidates) {
          if (!isStorable(candidate, checked)) {
            summary.unchecked += 1;
            continue;
          }
          // a work with a DOI is storable only checked (isStorable); one without is never checked
          const retractionCheckedAt = candidate.doi ? checkedAt : null;
          const rows = await matchExisting(tx, candidate);
          if (
            rows.length > 1 ||
            (rows.length === 1 && contradicts(rows[0]!, candidate))
          ) {
            summary.ambiguous.push({
              identifiers: identifiersOf(candidate),
              rowIds: rows.map((r) => r.id),
            });
            continue;
          }
          let sourceId: string;
          if (rows.length === 1) {
            const row = rows[0]!;
            sourceId = row.id;
            summary.matched += 1;
            const licence = stricterLicence(
              asLicence(row.license),
              candidate.licence,
            );
            const fill: Prisma.KnowledgeSourceUpdateInput = {
              ...(row.doi ? {} : candidate.doi ? { doi: candidate.doi } : {}),
              ...(row.openalexId
                ? {}
                : candidate.openalexId
                  ? { openalexId: candidate.openalexId }
                  : {}),
              ...(row.pmid
                ? {}
                : candidate.pmid
                  ? { pmid: candidate.pmid }
                  : {}),
              ...(row.pmcid
                ? {}
                : candidate.pmcid
                  ? { pmcid: candidate.pmcid }
                  : {}),
              ...(row.url ? {} : candidate.url ? { url: candidate.url } : {}),
              ...(row.year !== null
                ? {}
                : candidate.year !== null
                  ? { year: candidate.year }
                  : {}),
              ...(row.venue
                ? {}
                : candidate.venue
                  ? { venue: candidate.venue }
                  : {}),
              ...(row.oaUrl
                ? {}
                : candidate.oaUrl
                  ? { oaUrl: candidate.oaUrl }
                  : {}),
              ...(licence !== row.license ? { license: licence } : {}),
              ...(retractionCheckedAt ? { retractionCheckedAt } : {}),
            };
            if (Object.keys(fill).length)
              await tx.knowledgeSource.update({
                where: { id: row.id },
                data: fill,
              });
          } else {
            const source = await tx.knowledgeSource.create({
              data: {
                kind: candidate.kind,
                doi: candidate.doi,
                openalexId: candidate.openalexId,
                pmid: candidate.pmid,
                pmcid: candidate.pmcid,
                url: candidate.url,
                title: candidate.title,
                authors: candidate.authors as unknown as Prisma.InputJsonValue,
                year: candidate.year,
                venue: candidate.venue,
                license: candidate.licence,
                oaUrl: candidate.oaUrl,
                discoveredVia: candidate.discoveredVia,
                discoveryRunId: created.id,
                retractionCheckedAt,
                versions: {
                  create: {
                    versionKind: "ORIGINAL",
                    detectedVia: candidate.discoveredVia,
                  },
                },
              },
              select: { id: true },
            });
            sourceId = source.id;
            summary.created += 1;
          }
          if (!retractionCheckedAt) summary.retractionUnchecked += 1;
          for (const version of versionsFor(candidate, result.notices)) {
            const exists = await tx.knowledgeSourceVersion.findFirst({
              where: {
                sourceId,
                versionKind: version.versionKind,
                relatedDoi: version.relatedDoi,
              },
              select: { id: true },
            });
            if (exists) continue;
            await tx.knowledgeSourceVersion.create({
              data: {
                sourceId,
                versionKind: version.versionKind,
                relatedDoi: version.relatedDoi,
                noticeDate: version.noticeDate,
                detectedVia: version.detectedVia,
              },
            });
            summary.versionsCreated += 1;
            if (version.versionKind === "RETRACTION") {
              // plan 6: a retraction makes every claim built on the work DISPUTED
              const disputed = await tx.knowledgeClaim.updateMany({
                where: {
                  status: { in: ["CANDIDATE", "VERIFIED"] },
                  evidence: {
                    some: { passage: { sourceVersion: { sourceId } } },
                  },
                },
                data: { status: "DISPUTED" },
              });
              summary.claimsDisputed += disputed.count;
            }
          }
        }
        await tx.knowledgeDiscoveryRun.update({
          where: { id: runId },
          data: record(summary),
        });
        return summary;
      },
      { timeout: 300_000, maxWait: 10_000 },
    );
  }
}

function emptySummary(): StoreSummary {
  return {
    runId: null,
    created: 0,
    matched: 0,
    versionsCreated: 0,
    claimsDisputed: 0,
    ambiguous: [],
    unchecked: 0,
    retractionUnchecked: 0,
  };
}
