import { prisma } from "@acropora/database";

import type { OverviewCounts } from "./knowledge-overview.js";

/** The overview's counts, read in one round (S4 Áttekintő). Writes nothing. */
export class KnowledgeOverviewRepository {
  async counts(): Promise<OverviewCounts> {
    const [
      sources,
      sourcesPending,
      sourcesIncluded,
      sourcesExtracted,
      claimsCandidate,
      claimsVerified,
      anchorsPending,
      questionsOpen,
      claimsOnRetracted,
    ] = await prisma.$transaction([
      prisma.knowledgeSource.count(),
      prisma.knowledgeSource.count({ where: { screeningStatus: "PENDING" } }),
      prisma.knowledgeSource.count({ where: { screeningStatus: "INCLUDED" } }),
      prisma.knowledgeSource.count({
        where: {
          screeningStatus: "INCLUDED",
          versions: {
            some: { versionKind: "ORIGINAL", contentHash: { not: null } },
          },
        },
      }),
      prisma.knowledgeClaim.count({ where: { status: "CANDIDATE" } }),
      prisma.knowledgeClaim.count({ where: { status: "VERIFIED" } }),
      prisma.knowledgeFieldAnchor.count({ where: { decision: "PENDING" } }),
      prisma.knowledgeFieldAnchor.count({
        where: { decision: "PENDING", proposedValue: { not: null } },
      }),
      prisma.knowledgeClaim.count({
        where: {
          status: { in: ["CANDIDATE", "VERIFIED"] },
          evidence: {
            some: {
              passage: {
                sourceVersion: {
                  source: { versions: { some: { versionKind: "RETRACTION" } } },
                },
              },
            },
          },
        },
      }),
    ]);
    return {
      sources,
      sourcesPending,
      sourcesIncluded,
      sourcesExtracted,
      claimsCandidate,
      claimsVerified,
      anchorsPending,
      questionsOpen,
      claimsOnRetracted,
    };
  }
}
