import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";
import { vocabularyV1 } from "@acropora/knowledge-base";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { ClaimReviewRepository } from "../claims/claim-review.repository.js";
import { checkClaims } from "../extraction/claim-check.js";
import {
  PrismaExtractionStore,
  sha256,
} from "../extraction/extraction-store.js";
import { JATS, aiClaim } from "../extraction/extraction-test-fixtures.js";
import { jatsSections } from "../extraction/jats-text.js";
import { answerQuestion, type AiAnswerRequest } from "./knowledge-answer.js";
import { KnowledgeAnswerRepository } from "./knowledge-answer.repository.js";

/**
 * MODE A ON A DATABASE (S6, slice 3): the candidates are the VERIFIED claims
 * of the topic on included sources, with their verbatim support, reference
 * and CONTRADICTS partners; a retracted source takes the support away; and a
 * research draft on the same topic never reaches the package or the answer
 * (the S6 acceptance condition). The answer runs end to end with a fake AI.
 */
const gate = integrationDatabaseGate(process.env);
const DOI_PREFIX = "10.5555/kb-answer-int-";
const EMAIL_DOMAIN = "knowledge-answer-integration.invalid";
const DRAFT_MARK = "KITALALT-TERVEZET-SZOVEG";

describe(
  "knowledge answers (mode A), on a database",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = Date.now() % 1_000_000;
    const repository = new KnowledgeAnswerRepository();
    let userId = "";
    let aId = "";
    let bId = "";
    let candidateId = "";
    let draftId = "";

    async function extractedClaim(tag: string): Promise<string> {
      const sourceId = (
        await prisma.knowledgeSource.create({
          data: {
            kind: "PEER_REVIEWED",
            doi: `${DOI_PREFIX}${suffix}-${tag}`,
            title: `Kitalált cikk ${tag}`,
            authors: [{ name: "Kitalált Kutató" }, { name: "Második Szerző" }],
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
      await prisma.knowledgeClaimRelation.create({
        data: { fromClaimId: bId, toClaimId: aId, kind: "CONTRADICTS" },
      });
      // a mode B draft on the very same topic, with a claim-shaped candidate
      draftId = (
        await prisma.knowledgeResearchDraft.create({
          data: {
            question: "Mennyi foszfát jó egy SPS-akváriumban?",
            candidateClaims: [
              {
                id: "draft-claim",
                subject: "PHOSPHATE",
                status: "VERIFIED",
                effect: "CALCIFICATION",
                text: DRAFT_MARK,
              },
            ],
            summary: DRAFT_MARK,
            summaryModel: "test research-draft/v1",
            createdById: userId,
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
      await prisma.knowledgeResearchDraft.deleteMany({
        where: { createdBy: { email: { endsWith: `@${EMAIL_DOMAIN}` } } },
      });
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
          nev: "KnowledgeResearchDraft (a teszt-felhasznaloe)",
          darab: await prisma.knowledgeResearchDraft.count({
            where: { createdBy: { email: { endsWith: `@${EMAIL_DOMAIN}` } } },
          }),
        },
      ]);
    }

    it("the VERIFIED claims of the topic, with support, reference and partners", async () => {
      const candidates = await repository.candidates("PHOSPHATE");
      const ids = candidates.map((c) => c.id);
      assert.ok(ids.includes(aId) && ids.includes(bId));
      assert.equal(ids.includes(candidateId), false);
      const a = candidates.find((c) => c.id === aId)!;
      assert.equal(a.status, "VERIFIED");
      assert.equal(a.verbatimSupport, 1);
      assert.deepEqual(a.uses, ["AI_INTERNAL"]);
      assert.equal(a.citation, "Kutató és Szerző, 2012");
      assert.deepEqual(a.contradicts, [bId]);
      assert.deepEqual(a.quantity, {
        min: "2",
        max: "2",
        unit: "µmol/l",
        basis: null,
      });
      assert.equal(a.scope.evidenceLevel !== null, true);
    });

    it("a research draft on the same topic never reaches the package or the answer", async () => {
      const candidates = await repository.candidates("PHOSPHATE");
      assert.ok(draftId);
      assert.equal(
        candidates.some((c) => c.id === draftId || c.id === "draft-claim"),
        false,
      );
      const asked: AiAnswerRequest[] = [];
      const r = await answerQuestion({
        question: "Mennyi foszfát jó egy SPS-akváriumban?",
        subject: "PHOSPHATE",
        candidates,
        vocabulary: vocabularyV1(),
        ask: async (req) => {
          asked.push(req);
          return {
            kind: "ANSWER",
            sentences: req.claims
              .filter((c) => c.id === aId)
              .map((c) => ({ claimId: c.id, text: c.statement })),
            refused: [],
            answeredBy: "fake",
          };
        },
      });
      assert.equal(asked.length, 1);
      assert.equal(JSON.stringify(asked[0]).includes(DRAFT_MARK), false);
      assert.equal(r.answer.includes(DRAFT_MARK), false);
      // the real claim, stated from the database's fields, passes the gate,
      // and its CONTRADICTS partner is added (T6)
      assert.equal(r.answered, true, JSON.stringify(r.sentences));
      assert.ok(
        r.sentences.some((s) => s.status === "CITED" && s.claimIds[0] === aId),
      );
      assert.deepEqual(r.completed, [bId]);
    });

    it("a retracted source takes the verbatim support away", async () => {
      const source = await prisma.knowledgeSource.findFirstOrThrow({
        where: { doi: `${DOI_PREFIX}${suffix}-b` },
        select: { id: true },
      });
      await prisma.knowledgeSourceVersion.create({
        data: {
          sourceId: source.id,
          versionKind: "RETRACTION",
          detectedVia: "MANUAL",
        },
      });
      const b = (await repository.candidates("PHOSPHATE")).find(
        (c) => c.id === bId,
      )!;
      assert.equal(b.verbatimSupport, 0);
      assert.equal(b.citation, null);
    });
  },
);
