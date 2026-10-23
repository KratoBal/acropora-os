import { prisma } from "@acropora/database";

import {
  ANCHOR_ON_INCLUDED_SOURCE,
  CLAIM_ON_INCLUDED_SOURCE,
} from "../included-source.js";
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
      prisma.knowledgeClaim.count({
        where: { status: "CANDIDATE", ...CLAIM_ON_INCLUDED_SOURCE },
      }),
      prisma.knowledgeClaim.count({
        where: { status: "VERIFIED", ...CLAIM_ON_INCLUDED_SOURCE },
      }),
      prisma.knowledgeFieldAnchor.count({
        where: { decision: "PENDING", ...ANCHOR_ON_INCLUDED_SOURCE },
      }),
      prisma.knowledgeFieldAnchor.count({
        where: {
          decision: "PENDING",
          proposedValue: { not: null },
          ...ANCHOR_ON_INCLUDED_SOURCE,
        },
      }),
      prisma.knowledgeClaim.count({
        where: {
          status: { in: ["CANDIDATE", "VERIFIED"] },
          // AND, not a spread: both conditions sit on `evidence`, and a second
          // key would silently replace the first
          AND: [
            CLAIM_ON_INCLUDED_SOURCE,
            {
              evidence: {
                some: {
                  passage: {
                    sourceVersion: {
                      source: {
                        versions: { some: { versionKind: "RETRACTION" } },
                      },
                    },
                  },
                },
              },
            },
          ],
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
