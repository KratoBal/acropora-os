import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { KnowledgeOverviewRepository } from "./knowledge-overview.repository.js";

/**
 * THE OVERVIEW'S COUNTS ON A DATABASE (S4): each count moves by exactly what
 * it counts. Measured as differences, so other specs' rows do not matter.
 */
const gate = integrationDatabaseGate(process.env);
const DOI_PREFIX = "10.5555/kb-ovw-int-";
const SUBJECT = "KB_INT_OVERVIEW";

describe(
  "knowledge overview counts, on a database",
  { skip: gate.mode === "skip" },
  () => {
    const repo = new KnowledgeOverviewRepository();
    const suffix = Date.now() % 1_000_000;

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
    });
    after(removeLeftovers);

    async function removeLeftovers() {
      const ours = { source: { doi: { startsWith: DOI_PREFIX } } };
      await prisma.knowledgeFieldAnchor.deleteMany({
        where: { passage: { sourceVersion: ours } },
      });
      await prisma.knowledgeClaimEvidence.deleteMany({
        where: { passage: { sourceVersion: ours } },
      });
      await prisma.knowledgeClaim.deleteMany({ where: { subject: SUBJECT } });
      await prisma.knowledgePassage.deleteMany({
        where: { sourceVersion: ours },
      });
      await prisma.knowledgeSourceVersion.deleteMany({ where: ours });
      await prisma.knowledgeSource.deleteMany({
        where: { doi: { startsWith: DOI_PREFIX } },
      });
      nincsMaradek([
        {
          nev: "KnowledgeSource (doi elotag)",
          darab: await prisma.knowledgeSource.count({
            where: { doi: { startsWith: DOI_PREFIX } },
          }),
        },
        {
          nev: "KnowledgeClaim (teszt-tema)",
          darab: await prisma.knowledgeClaim.count({
            where: { subject: SUBJECT },
          }),
        },
      ]);
    }

    it("a pending source, a retracted one with a candidate claim and an open question move their counts", async () => {
      const before = await repo.counts();
      await prisma.knowledgeSource.create({
        data: {
          kind: "PEER_REVIEWED",
          doi: `${DOI_PREFIX}${suffix}-a`,
          title: "Kitalált a",
          discoveredVia: "MANUAL",
        },
      });
      const retracted = await prisma.knowledgeSource.create({
        data: {
          kind: "PEER_REVIEWED",
          doi: `${DOI_PREFIX}${suffix}-b`,
          title: "Kitalált b",
          discoveredVia: "MANUAL",
          versions: {
            create: [
              {
                versionKind: "ORIGINAL",
                detectedVia: "MANUAL",
                contentHash: "0".repeat(64),
              },
              { versionKind: "RETRACTION", detectedVia: "MANUAL" },
            ],
          },
        },
        select: {
          id: true,
          versions: { select: { id: true, versionKind: true } },
        },
      });
      const original = retracted.versions.find(
        (v) => v.versionKind === "ORIGINAL",
      )!;
      const passage = await prisma.knowledgePassage.create({
        data: {
          sourceVersionId: original.id,
          locator: "Results",
          text: "Kitalált.",
          textHash: "1".repeat(64),
        },
      });
      const claim = await prisma.knowledgeClaim.create({
        data: { layer: "SCIENTIFIC", subject: SUBJECT },
      });
      const evidence = await prisma.knowledgeClaimEvidence.create({
        data: { claimId: claim.id, passageId: passage.id, stance: "SUPPORTS" },
      });
      await prisma.knowledgeFieldAnchor.create({
        data: {
          claimEvidenceId: evidence.id,
          field: "species",
          passageId: passage.id,
          proposedValue: "Porites lutea",
        },
      });
      const after = await repo.counts();
      assert.deepEqual(
        {
          sources: after.sources - before.sources,
          sourcesPending: after.sourcesPending - before.sourcesPending,
          claimsCandidate: after.claimsCandidate - before.claimsCandidate,
          anchorsPending: after.anchorsPending - before.anchorsPending,
          questionsOpen: after.questionsOpen - before.questionsOpen,
          claimsOnRetracted: after.claimsOnRetracted - before.claimsOnRetracted,
          sourcesExtracted: after.sourcesExtracted - before.sourcesExtracted,
        },
        {
          sources: 2,
          sourcesPending: 2,
          claimsCandidate: 1,
          anchorsPending: 1,
          questionsOpen: 1,
          claimsOnRetracted: 1,
          sourcesExtracted: 0,
        },
      );
    });
  },
);
