import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";
import { vocabularyV1 } from "@acropora/knowledge-base";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { checkClaims } from "../extraction/claim-check.js";
import {
  PrismaExtractionStore,
  sha256,
} from "../extraction/extraction-store.js";
import { JATS, aiClaim } from "../extraction/extraction-test-fixtures.js";
import { jatsSections } from "../extraction/jats-text.js";
import { ClaimReviewRepository } from "./claim-review.repository.js";
import {
  ClaimStoreNotFound,
  ClaimStoreRepository,
} from "./claim-store.repository.js";

/**
 * THE CLAIM STORE ON A DATABASE (S5, Figma 3:229): only VERIFIED claims on
 * included sources are listed, the layer filter and its counts hold, the
 * title and the species come labelled (never a raw key), and a CONTRADICTS
 * relation caps the derived evidence level on both the list and the detail.
 */
const gate = integrationDatabaseGate(process.env);
const DOI_PREFIX = "10.5555/kb-store-int-";
const EMAIL_DOMAIN = "knowledge-store-integration.invalid";

describe(
  "knowledge claim store, on a database",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = Date.now() % 1_000_000;
    const store = new ClaimStoreRepository();
    let userId = "";
    let aId = "";
    let bId = "";
    let candidateId = "";

    async function extractedClaim(tag: string): Promise<string> {
      const sourceId = (
        await prisma.knowledgeSource.create({
          data: {
            kind: "PEER_REVIEWED",
            doi: `${DOI_PREFIX}${suffix}-${tag}`,
            title: `Kitalált cikk ${tag}`,
            year: 2012,
            discoveredVia: "MANUAL",
            screeningStatus: "INCLUDED",
            screenedById: userId,
            screenedAt: new Date(),
            versions: {
              create: { versionKind: "ORIGINAL", detectedVia: "MANUAL" },
            },
          },
        })
      ).id;
      const { claims } = checkClaims(
        [aiClaim()],
        jatsSections(JATS),
        vocabularyV1(),
      );
      await new PrismaExtractionStore().saveSource({
        sourceId,
        contentHash: sha256(JATS),
        extractedBy: "test claim-extraction/v1",
        claims,
        verifiedAt: new Date("2026-10-23T15:00:00Z"),
      });
      return (
        await prisma.knowledgeClaimEvidence.findFirstOrThrow({
          where: { passage: { sourceVersion: { sourceId } } },
          select: { claimId: true },
        })
      ).claimId;
    }

    /** The editor's review: every field accepted, a question rejected. */
    async function verify(claimId: string) {
      const review = await new ClaimReviewRepository().detail(claimId);
      await new ClaimReviewRepository().save(
        claimId,
        {
          decisions: review.fields
            .filter((f) => f.owner === "CLAIM" || f.decision === "PENDING")
            .map((f) => ({
              anchorId: f.anchorId,
              decision: f.value === null ? "REJECT" : "ACCEPT",
            })),
          applicability: null,
        },
        userId,
      );
      // a controlled experiment on six colonies: one SINGLE_EXPERIMENT source
      const evidence = await prisma.knowledgeClaimEvidence.findFirstOrThrow({
        where: { claimId },
        select: { id: true, passage: { select: { sourceVersion: true } } },
      });
      await prisma.knowledgeSource.update({
        where: { id: evidence.passage.sourceVersion.sourceId },
        data: { studyType: "CONTROLLED_LAB", controlled: true },
      });
      await prisma.knowledgeClaimEvidence.update({
        where: { id: evidence.id },
        data: { sampleSize: 6, sampleUnit: "kolónia" },
      });
    }

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      userId = (
        await prisma.user.create({
          data: {
            email: `szerkeszto-${suffix}@${EMAIL_DOMAIN}`,
            displayName: "Kitalált Szerkesztő",
            role: "OWNER",
            isActive: true,
          },
        })
      ).id;
      aId = await extractedClaim("a");
      bId = await extractedClaim("b");
      candidateId = await extractedClaim("c");
      await verify(aId);
      await verify(bId);
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
      await prisma.knowledgeClaimRelation.deleteMany({
        where: {
          OR: [
            { fromClaimId: { in: claimIds } },
            { toClaimId: { in: claimIds } },
          ],
        },
      });
      await prisma.auditLog.deleteMany({
        where: { user: { email: { endsWith: `@${EMAIL_DOMAIN}` } } },
      });
      await prisma.knowledgeFieldAnchor.deleteMany({
        where: {
          OR: [
            { passage: where },
            { source: { doi: { startsWith: DOI_PREFIX } } },
          ],
        },
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
          nev: "KnowledgeClaim (a teszt-forrasoke)",
          darab: await prisma.knowledgeClaim.count({
            where: { id: { in: claimIds } },
          }),
        },
      ]);
    }

    it("lists the verified claims only, labelled, with source and level", async () => {
      const list = await store.list(null);
      const ids = list.claims.map((c) => c.id);
      assert.ok(ids.includes(aId) && ids.includes(bId));
      assert.equal(ids.includes(candidateId), false);
      const a = list.claims.find((c) => c.id === aId)!;
      assert.equal(a.layer, "SCIENTIFIC");
      assert.equal(a.status, "VERIFIED");
      assert.ok(a.effect && a.effect.label !== a.effect.key, a.title);
      assert.ok(a.title.startsWith(`${a.effect!.label}: `), a.title);
      assert.ok(a.species.length > 0);
      for (const s of a.species) assert.notEqual(s.label, s.key);
      assert.deepEqual(
        a.sources.map((s) => [s.title, s.year, s.retracted]),
        [["Kitalált cikk a", 2012, false]],
      );
      assert.equal(a.evidenceLevel.level, "SINGLE_EXPERIMENT");
      assert.equal(a.controlled, true);
      assert.deepEqual(a.sampleSize, { value: 6, unit: "kolónia" });
      assert.ok(list.layers.SCIENTIFIC >= 2);
    });

    it("filters by layer, and counts every layer", async () => {
      await prisma.knowledgeClaim.update({
        where: { id: bId },
        data: { layer: "HOBBY_EXPERIENCE" },
      });
      const scientific = await store.list("SCIENTIFIC");
      const hobby = await store.list("HOBBY_EXPERIENCE");
      assert.ok(scientific.claims.some((c) => c.id === aId));
      assert.equal(
        scientific.claims.some((c) => c.id === bId),
        false,
      );
      assert.ok(hobby.claims.some((c) => c.id === bId));
      assert.equal(hobby.total, hobby.layers.HOBBY_EXPERIENCE);
      assert.equal(scientific.total, scientific.layers.SCIENTIFIC);
    });

    it("a CONTRADICTS relation caps the level, and the detail shows both sides", async () => {
      await prisma.knowledgeClaimRelation.create({
        data: { fromClaimId: bId, toClaimId: aId, kind: "CONTRADICTS" },
      });
      const a = (await store.list(null)).claims.find((c) => c.id === aId)!;
      assert.equal(a.evidenceLevel.level, "OBSERVATIONAL");

      const detail = await store.detail(aId);
      assert.equal(detail.evidenceLevel.level, "OBSERVATIONAL");
      assert.equal(detail.title, a.title);
      assert.deepEqual(
        detail.relationsTo.map((r) => [r.kind, r.claim.id, r.claim.layer]),
        [["CONTRADICTS", bId, "HOBBY_EXPERIENCE"]],
      );
      assert.equal(detail.relationsTo[0]!.claim.title, a.title);
      assert.deepEqual(
        (await store.detail(bId)).relationsFrom.map((r) => r.claim.id),
        [aId],
      );
      const [evidence] = detail.evidence;
      assert.equal(detail.evidence.length, 1);
      assert.equal(evidence!.stance, "SUPPORTS");
      assert.equal(evidence!.passage.locator, "Results");
      assert.equal(evidence!.passage.verifiedVerbatim, true);
      assert.equal(evidence!.source.studyType, "CONTROLLED_LAB");
      // only the kept fields: a rejected question is no part of the claim
      assert.ok(evidence!.anchors.length > 0);
      for (const anchor of evidence!.anchors) {
        assert.ok(["ACCEPTED", "CORRECTED"].includes(anchor.decision));
        assert.notEqual(anchor.value, null);
      }
    });

    it("a missing claim is named", async () => {
      await assert.rejects(store.detail("nincs-ilyen"), ClaimStoreNotFound);
    });
  },
);
