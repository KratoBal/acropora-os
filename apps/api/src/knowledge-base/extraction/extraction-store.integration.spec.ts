import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";
import { vocabularyV1 } from "@acropora/knowledge-base";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import {
  RunAbandoned,
  RunAlreadyRunning,
} from "../discovery/discovery-run.store.js";
import { checkClaims } from "./claim-check.js";
import { PrismaExtractionStore, sha256 } from "./extraction-store.js";
import { JATS, PASSAGE, aiClaim } from "./extraction-test-fixtures.js";
import { jatsSections } from "./jats-text.js";

/**
 * THE EXTRACTION STORE ON A DATABASE (S3 acceptance): every stored passage
 * and anchor is the verbatim, verified text with the model and prompt
 * version; the claim is CANDIDATE and every field anchor PENDING; a study
 * field anchors to the source, a finding field to the evidence; an editor's
 * question has no value, only the model's word; a source is extracted once;
 * one RUNNING extraction at a time (the database's index).
 */
const gate = integrationDatabaseGate(process.env);
const DOI_PREFIX = "10.5555/kb-ext-int-";
const EMAIL_DOMAIN = "knowledge-extraction-integration.invalid";

describe(
  "knowledge claim extraction, stored, on a database",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = Date.now() % 1_000_000;
    const store = new PrismaExtractionStore();
    let userId = "";
    let sourceId = "";

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      userId = (
        await prisma.user.create({
          data: {
            email: `kiolvaso-${suffix}@${EMAIL_DOMAIN}`,
            displayName: "Kitalált Kiolvasó",
            role: "OWNER",
            isActive: true,
          },
        })
      ).id;
      sourceId = (
        await prisma.knowledgeSource.create({
          data: {
            kind: "PEER_REVIEWED",
            doi: `${DOI_PREFIX}${suffix}`,
            pmcid: `PMC${suffix}`,
            title: "Kitalált cikk",
            discoveredVia: "MANUAL",
            versions: {
              create: { versionKind: "ORIGINAL", detectedVia: "MANUAL" },
            },
          },
        })
      ).id;
    });

    after(removeLeftovers);

    async function removeLeftovers() {
      const where = {
        sourceVersion: { source: { doi: { startsWith: DOI_PREFIX } } },
      };
      const claimIds = (
        await prisma.knowledgeClaimEvidence.findMany({
          where: { passage: where },
          select: { claimId: true },
        })
      ).map((e) => e.claimId);
      await prisma.knowledgeFieldAnchor.deleteMany({
        where: { passage: where },
      });
      await prisma.knowledgeClaimEvidence.deleteMany({
        where: { passage: where },
      });
      await prisma.knowledgeClaim.deleteMany({
        where: { id: { in: claimIds } },
      });
      await prisma.knowledgePassage.deleteMany({ where });
      await prisma.knowledgeSourceVersion.deleteMany({
        where: { source: { doi: { startsWith: DOI_PREFIX } } },
      });
      await prisma.knowledgeSource.deleteMany({
        where: { doi: { startsWith: DOI_PREFIX } },
      });
      await prisma.knowledgeExtractionRun.deleteMany({
        where: { requestedBy: { email: { endsWith: `@${EMAIL_DOMAIN}` } } },
      });
      await prisma.user.deleteMany({
        where: { email: { endsWith: `@${EMAIL_DOMAIN}` } },
      });
      nincsMaradek([
        {
          nev: "KnowledgeSource (doi elotag)",
          darab: await prisma.knowledgeSource.count({
            where: { doi: { startsWith: DOI_PREFIX } },
          }),
        },
        {
          nev: "KnowledgePassage (a teszt-forrase)",
          darab: await prisma.knowledgePassage.count({ where }),
        },
        {
          nev: "KnowledgeExtractionRun (teszt-felhasznalo)",
          darab: await prisma.knowledgeExtractionRun.count({
            where: { requestedBy: { email: { endsWith: `@${EMAIL_DOMAIN}` } } },
          }),
        },
      ]);
    }

    it("stores a CANDIDATE claim, PENDING anchors, verified passages and the question", async () => {
      assert.deepEqual(await store.source(sourceId), {
        id: sourceId,
        pmcid: `PMC${suffix}`,
        retracted: false,
        alreadyExtracted: false,
      });
      const { claims } = checkClaims(
        [aiClaim()],
        jatsSections(JATS),
        vocabularyV1(),
      );
      const verifiedAt = new Date("2026-10-23T15:00:00Z");
      const saved = await store.saveSource({
        sourceId,
        contentHash: sha256(JATS),
        extractedBy: "gpt-5.1 claim-extraction/v1",
        claims,
        verifiedAt,
      });
      assert.deepEqual(saved, {
        claimsCreated: 1,
        anchorsCreated: 10,
        questions: 1,
      });

      const version = await prisma.knowledgeSourceVersion.findFirstOrThrow({
        where: { sourceId, versionKind: "ORIGINAL" },
        select: {
          contentHash: true,
          passages: {
            select: {
              text: true,
              locator: true,
              verifiedVerbatimAt: true,
              extractedBy: true,
            },
          },
        },
      });
      assert.equal(version.contentHash, sha256(JATS));
      assert.ok(
        version.passages.some(
          (p) => p.text === PASSAGE && p.locator === "Results",
        ),
      );
      assert.ok(
        version.passages.every(
          (p) => p.verifiedVerbatimAt?.getTime() === verifiedAt.getTime(),
        ),
      );
      assert.ok(
        version.passages.every(
          (p) => p.extractedBy === "gpt-5.1 claim-extraction/v1",
        ),
      );

      const evidence = await prisma.knowledgeClaimEvidence.findFirstOrThrow({
        where: { passage: { sourceVersion: { sourceId } } },
        select: {
          species: true,
          environment: true,
          sampleSize: true,
          uncertainty: true,
          claim: {
            select: {
              status: true,
              layer: true,
              subject: true,
              originalUnit: true,
              normalizedMinMgL: true,
              effect: true,
              direction: true,
            },
          },
          anchors: {
            select: {
              field: true,
              decision: true,
              normalizedValue: true,
              proposedValue: true,
            },
          },
        },
      });
      assert.deepEqual(evidence.species, ["ACROPORA_MILLEPORA"]);
      assert.equal(evidence.environment, "LAB");
      assert.equal(evidence.sampleSize, 12);
      assert.equal(evidence.claim.status, "CANDIDATE");
      assert.equal(evidence.claim.normalizedMinMgL?.toString(), "0.18994");
      assert.ok(evidence.anchors.every((a) => a.decision === "PENDING"));
      const question = evidence.anchors.find((a) => a.proposedValue !== null);
      assert.deepEqual(
        [question?.field, question?.proposedValue, question?.normalizedValue],
        ["species", "Porites lutea", null],
      );
      // the study's fields anchor to the source, not to the finding
      const onSource = await prisma.knowledgeFieldAnchor.findMany({
        where: { sourceId },
        select: { field: true },
      });
      assert.deepEqual(onSource.map((a) => a.field).sort(), [
        "measurementMethod",
        "studyType",
      ]);
      assert.equal(
        (await store.source(sourceId))?.alreadyExtracted,
        true,
        "a second run skips it",
      );
    });

    it("a RETRACTION version marks the source retracted", async () => {
      await prisma.knowledgeSourceVersion.create({
        data: { sourceId, versionKind: "RETRACTION", detectedVia: "MANUAL" },
      });
      assert.equal((await store.source(sourceId))?.retracted, true);
    });

    it("one RUNNING extraction at a time; a silent one is failed; the ledger reads back", async () => {
      const longAgo = new Date(Date.now() - 60 * 60_000);
      const first = await store.startRun({
        sourceIds: [sourceId],
        requestedById: userId,
        startedAt: longAgo,
      });
      await assert.rejects(
        store.startRun({
          sourceIds: [sourceId],
          requestedById: userId,
          startedAt: new Date(),
        }),
        RunAlreadyRunning,
      );
      await store.heartbeat(first);
      assert.equal(
        await store.abandonStale(new Date(Date.now() - 5 * 60_000)),
        0,
      );
      await prisma.knowledgeExtractionRun.update({
        where: { id: first },
        data: { heartbeatAt: longAgo },
      });
      assert.equal(
        await store.abandonStale(new Date(Date.now() - 5 * 60_000)),
        1,
      );
      const second = await store.startRun({
        sourceIds: [sourceId],
        requestedById: userId,
        startedAt: new Date(),
      });
      await store.finishRun(second, { sources: [] }, 0);
      assert.equal((await store.getRun(second))?.status, "FINISHED");
      assert.ok(
        (await store.listRuns(50)).some(
          (r) => r.id === first && r.status === "FAILED",
        ),
      );
    });

    it("a run failed as stale stores nothing more, and its late finish or fail does not overwrite it", async () => {
      const runId = await store.startRun({
        sourceIds: [sourceId],
        requestedById: userId,
        startedAt: new Date(Date.now() - 60 * 60_000),
      });
      await prisma.knowledgeExtractionRun.update({
        where: { id: runId },
        data: { heartbeatAt: new Date(Date.now() - 60 * 60_000) },
      });
      assert.equal(
        await store.abandonStale(new Date(Date.now() - 5 * 60_000)),
        1,
      );
      const before = await prisma.knowledgeClaim.count();
      const { claims } = checkClaims(
        [aiClaim()],
        jatsSections(JATS),
        vocabularyV1(),
      );
      await assert.rejects(
        store.saveSource({
          sourceId,
          contentHash: sha256(JATS),
          extractedBy: "m",
          claims,
          verifiedAt: new Date(),
          runId,
        }),
        RunAbandoned,
      );
      assert.equal(
        await prisma.knowledgeClaim.count(),
        before,
        "the transaction stored nothing",
      );
      await assert.rejects(
        store.finishRun(runId, { sources: [] }, 0),
        RunAbandoned,
      );
      await store.failRun(runId, "Late");
      const row = await prisma.knowledgeExtractionRun.findUniqueOrThrow({
        where: { id: runId },
      });
      assert.deepEqual(
        [row.status, row.report],
        ["FAILED", { error: "STALE_RUNNING" }],
      );
    });
  },
);
