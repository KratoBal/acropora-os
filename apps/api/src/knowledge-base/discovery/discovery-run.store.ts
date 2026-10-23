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
}

export interface DiscoveryStore {
  /** Read-only: what a save would do with these candidates. */
  preview(result: DiscoveryResult): Promise<StoreSummary>;
  save(run: {
    input: DiscoveryInput;
    result: DiscoveryResult;
    requestedById: string;
    startedAt: Date;
  }): Promise<StoreSummary>;
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

export class PrismaDiscoveryStore implements DiscoveryStore {
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
      else if (rows.length === 1) summary.matched += 1;
      else summary.created += 1;
    }
    return summary;
  }

  async save(run: {
    input: DiscoveryInput;
    result: DiscoveryResult;
    requestedById: string;
    startedAt: Date;
  }): Promise<StoreSummary> {
    const { result } = run;
    const checked = new Set(result.checkedDois);
    return prisma.$transaction(
      async (tx) => {
        const created = await tx.knowledgeDiscoveryRun.create({
          data: {
            label: run.input.label,
            status: result.status,
            input: run.input as unknown as Prisma.InputJsonValue,
            queries: result.queries as unknown as Prisma.InputJsonValue,
            requestCount: result.requestCount,
            report: {
              skipped: result.skipped,
              conflicts: result.conflicts,
              unavailable: result.unavailable,
              crossrefUnknownDois: result.crossrefUnknownDois,
              notFoundDois: result.notFoundDois,
            } as unknown as Prisma.InputJsonValue,
            requestedById: run.requestedById,
            startedAt: run.startedAt,
          },
          select: { id: true },
        });
        const summary = emptySummary();
        summary.runId = created.id;
        for (const candidate of result.candidates) {
          if (!isStorable(candidate, checked)) {
            summary.unchecked += 1;
            continue;
          }
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
          where: { id: created.id },
          data: {
            sourcesCreated: summary.created,
            sourcesMatched: summary.matched,
            versionsCreated: summary.versionsCreated,
            claimsDisputed: summary.claimsDisputed,
            finishedAt: new Date(),
          },
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
  };
}
