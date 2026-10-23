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
import { ReviewInputError, type FieldDecision } from "./claim-review.js";
import {
  ClaimReviewConflict,
  ClaimReviewRepository,
  type ClaimReview,
} from "./claim-review.repository.js";

/**
 * THE CLAIM REVIEW ON A DATABASE (S4, Figma 3:137): the claim the S3 store
 * wrote is reviewed field by field in one transaction; an incomplete review
 * changes nothing; every save and discard writes its AuditLog row; and the
 * migration's CHECKs hold the decision rules even against a direct write.
 */
const gate = integrationDatabaseGate(process.env);
const DOI_PREFIX = "10.5555/kb-review-int-";
const EMAIL_DOMAIN = "knowledge-review-integration.invalid";

describe(
  "knowledge claim review, on a database",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = Date.now() % 1_000_000;
    const repository = new ClaimReviewRepository();
    let userId = "";
    let claimId = "";
    let otherClaimId = "";

    async function extractedClaim(tag: string): Promise<string> {
      const sourceId = (
        await prisma.knowledgeSource.create({
          data: {
            kind: "PEER_REVIEWED",
            doi: `${DOI_PREFIX}${suffix}-${tag}`,
            title: `Kitalált cikk ${tag}`,
            discoveredVia: "MANUAL",
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
      const evidence = await prisma.knowledgeClaimEvidence.findFirstOrThrow({
        where: { passage: { sourceVersion: { sourceId } } },
        select: { claimId: true },
      });
      return evidence.claimId;
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
      claimId = await extractedClaim("a");
      otherClaimId = await extractedClaim("b");
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
      await prisma.auditLog.deleteMany({
        where: { user: { email: { endsWith: `@${EMAIL_DOMAIN}` } } },
      });
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
        {
          nev: "AuditLog (teszt-felhasznalo)",
          darab: await prisma.auditLog.count({
            where: { user: { email: { endsWith: `@${EMAIL_DOMAIN}` } } },
          }),
        },
      ]);
    }

    const field = (review: ClaimReview, name: string, question = false) =>
      review.fields.find(
        (f) => f.field === name && (f.question !== null) === question,
      )!;

    /** Every field accepted, the question rejected, then the overrides. */
    const decisions = (
      review: ClaimReview,
      over: Record<string, Omit<FieldDecision, "anchorId">> = {},
    ): FieldDecision[] =>
      review.fields
        .filter((f) => f.owner === "CLAIM" || f.decision === "PENDING")
        .map((f) => ({
          anchorId: f.anchorId,
          ...(over[f.anchorId] ??
            (f.value === null
              ? { decision: "REJECT" as const }
              : { decision: "ACCEPT" as const })),
        }));

    it("the queue holds the candidates; the detail shows every field in the screen's order, the question flagged", async () => {
      const queue = await repository.queue();
      assert.ok(
        queue.ids.includes(claimId) && queue.ids.includes(otherClaimId),
      );
      const review = await repository.detail(claimId);
      assert.equal(review.status, "CANDIDATE");
      assert.equal(review.passage.locator, "Results");
      assert.deepEqual(
        review.fields.map((f) => f.field),
        [
          "species",
          "species",
          "environment",
          "quantity",
          "effect",
          "direction",
          "studyType",
          "sampleSize",
          "measurementMethod",
          "uncertainty",
        ],
      );
      assert.equal(field(review, "species", true).question, "Porites lutea");
      assert.equal(field(review, "species", true).value, null);
      assert.equal(field(review, "studyType").owner, "SOURCE");
      assert.equal(review.quantity?.unit, "µmol/l");
      assert.ok(review.options.species.some((o) => o.key === "PORITES"));
    });

    it("an incomplete review changes nothing", async () => {
      const review = await repository.detail(claimId);
      const partial = decisions(review).slice(1);
      await assert.rejects(
        repository.save(
          claimId,
          { decisions: partial, applicability: null },
          userId,
        ),
        (e: unknown) =>
          e instanceof ReviewInputError && e.code === "UNDECIDED_FIELD",
      );
      const after = await repository.detail(claimId);
      assert.equal(after.status, "CANDIDATE");
      assert.ok(after.fields.every((f) => f.decision === "PENDING"));
      assert.equal(
        await prisma.auditLog.count({ where: { entityId: claimId } }),
        0,
      );
    });

    it("the review: decisions stored with their editor, the claim rebuilt from the kept fields, one AuditLog row", async () => {
      const review = await repository.detail(claimId);
      const question = field(review, "species", true);
      const sample = field(review, "sampleSize");
      const saved = await repository.save(
        claimId,
        {
          decisions: decisions(review, {
            [question.anchorId]: { decision: "CORRECT", value: "PORITES" },
            [sample.anchorId]: { decision: "REJECT" },
          }),
          applicability: {
            value: "LIMITED",
            reason: "laborkísérlet, nem akvárium",
          },
        },
        userId,
      );
      assert.equal(saved.status, "VERIFIED");
      assert.equal(field(saved, "species", true).decision, "CORRECTED");
      assert.equal(field(saved, "species", true).correctedValue, "PORITES");
      assert.equal(field(saved, "sampleSize").decision, "REJECTED");
      assert.equal(field(saved, "effect").decision, "ACCEPTED");
      assert.deepEqual(saved.applicability, {
        value: "LIMITED",
        reason: "laborkísérlet, nem akvárium",
      });

      const evidence = await prisma.knowledgeClaimEvidence.findFirstOrThrow({
        where: { claimId },
        select: {
          species: true,
          sampleSize: true,
          applicabilityDecidedById: true,
          passage: {
            select: {
              sourceVersion: {
                select: {
                  source: {
                    select: { studyType: true, measurementMethod: true },
                  },
                },
              },
            },
          },
        },
      });
      assert.deepEqual([...evidence.species].sort(), [
        "ACROPORA_MILLEPORA",
        "PORITES",
      ]);
      assert.equal(evidence.sampleSize, null);
      assert.equal(evidence.applicabilityDecidedById, userId);
      assert.deepEqual(evidence.passage.sourceVersion.source, {
        studyType: "CONTROLLED_LAB",
        measurementMethod: "AUTOANALYZER",
      });
      const decided = await prisma.knowledgeFieldAnchor.findMany({
        where: { claimEvidence: { claimId } },
        select: { decidedById: true, decidedAt: true },
      });
      assert.ok(decided.every((a) => a.decidedById === userId && a.decidedAt));

      const audit = await prisma.auditLog.findMany({
        where: { entityId: claimId },
        select: { action: true, userId: true, metadata: true },
      });
      assert.equal(audit.length, 1);
      assert.equal(audit[0]?.action, "KNOWLEDGE_CLAIM_REVIEWED");
      assert.equal(audit[0]?.userId, userId);
      const meta = audit[0]?.metadata as {
        before: { status: string; sampleSize: unknown };
        after: { status: string; sampleSize: unknown };
        decisions: unknown[];
      };
      assert.equal(meta.before.status, "CANDIDATE");
      assert.deepEqual(meta.before.sampleSize, { value: 12, unit: "colonies" });
      assert.equal(meta.after.status, "VERIFIED");
      assert.equal(meta.after.sampleSize, null);
      assert.equal(meta.decisions.length, 10);
    });

    it("a reviewed claim is not reviewed again", async () => {
      const review = await repository.detail(claimId);
      await assert.rejects(
        repository.save(
          claimId,
          { decisions: decisions(review), applicability: null },
          userId,
        ),
        ClaimReviewConflict,
      );
    });

    it("a discard withdraws the claim, rejects its own fields, leaves the source's, and logs the reason", async () => {
      const saved = await repository.discard(
        otherClaimId,
        "édesvízi kísérlet",
        userId,
      );
      assert.equal(saved.status, "WITHDRAWN");
      assert.ok(
        saved.fields
          .filter((f) => f.owner === "CLAIM")
          .every((f) => f.decision === "REJECTED"),
      );
      assert.ok(
        saved.fields
          .filter((f) => f.owner === "SOURCE")
          .every((f) => f.decision === "PENDING"),
      );
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { entityId: otherClaimId },
        select: { action: true, metadata: true },
      });
      assert.equal(audit.action, "KNOWLEDGE_CLAIM_DISCARDED");
      assert.equal(
        (audit.metadata as { reason: string }).reason,
        "édesvízi kísérlet",
      );
      await assert.rejects(
        repository.discard(otherClaimId, "még egyszer", userId),
        ClaimReviewConflict,
      );
    });

    it("the database holds the decision rules against a direct write", async () => {
      const review = await repository.detail(otherClaimId);
      const pendingSource = review.fields.find(
        (f) => f.decision === "PENDING",
      )!;
      const question = field(review, "species", true);
      const refused = (
        data: Record<string, unknown>,
        id = pendingSource.anchorId,
      ) =>
        assert.rejects(
          prisma.knowledgeFieldAnchor.update({ where: { id }, data }),
          /KnowledgeFieldAnchor_(corrected_value|decided|question_not_accepted)/,
        );
      // a correction without its value, a value without the correction
      await refused({
        decision: "CORRECTED",
        decidedById: userId,
        decidedAt: new Date(),
      });
      await refused({ correctedValue: "LAB" });
      // a decision without its editor, an editor on a pending field
      await refused({ decision: "ACCEPTED" });
      await refused({ decidedById: userId, decidedAt: new Date() });
      // a question accepted as it is
      await refused(
        { decision: "ACCEPTED", decidedById: userId, decidedAt: new Date() },
        question.anchorId,
      );
    });
  },
);
