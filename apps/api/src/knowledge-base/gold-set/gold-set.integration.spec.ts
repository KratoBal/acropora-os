import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";
import { vocabularyV1 } from "@acropora/knowledge-base";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import type { FieldDecision } from "../claims/claim-review.js";
import {
  ClaimReviewRepository,
  type ClaimReview,
} from "../claims/claim-review.repository.js";
import { checkClaims } from "../extraction/claim-check.js";
import {
  PrismaExtractionStore,
  sha256,
} from "../extraction/extraction-store.js";
import { JATS, aiClaim } from "../extraction/extraction-test-fixtures.js";
import { jatsSections } from "../extraction/jats-text.js";
import {
  GoldSetConflict,
  GoldSetRepository,
  type GoldSetView,
} from "./gold-set.repository.js";

/**
 * THE T3 GOLD SET ON A DATABASE: the proposal counts the machine claims of
 * the included sources; the freeze pins ten sources with their claims, once;
 * a row's verdict is read from the claim review's stored decisions (accepted,
 * a quantity rejected, a discard, a re-extraction); missed claims and the
 * completeness mark write their AuditLog rows; the CHECKs hold.
 */
const gate = integrationDatabaseGate(process.env);
const DOI_PREFIX = "10.5555/kb-gold-int-";
const EMAIL_DOMAIN = "knowledge-gold-integration.invalid";

describe(
  "knowledge T3 gold set, on a database",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = Date.now() % 1_000_000;
    const repository = new GoldSetRepository();
    const review = new ClaimReviewRepository();
    let userId = "";
    const sourceIds: string[] = [];
    let excludedSourceId = "";

    async function extractedSource(
      tag: string,
      claims: number,
      included = true,
    ): Promise<string> {
      const sourceId = (
        await prisma.knowledgeSource.create({
          data: {
            kind: "PEER_REVIEWED",
            doi: `${DOI_PREFIX}${suffix}-${tag}`,
            title: `Kitalált arany-cikk ${tag}`,
            year: 2020,
            discoveredVia: "MANUAL",
            ...(included
              ? {
                  screeningStatus: "INCLUDED" as const,
                  screenedById: userId,
                  screenedAt: new Date(),
                }
              : {}),
            versions: {
              create: { versionKind: "ORIGINAL", detectedVia: "MANUAL" },
            },
          },
        })
      ).id;
      const checked = checkClaims(
        Array.from({ length: claims }, () => aiClaim()),
        jatsSections(JATS),
        vocabularyV1(),
      ).claims;
      await new PrismaExtractionStore().saveSource({
        sourceId,
        contentHash: sha256(JATS),
        extractedBy: "test claim-extraction/v1",
        claims: checked,
        verifiedAt: new Date("2026-10-28T08:00:00Z"),
      });
      return sourceId;
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
      // nine sources of three claims, and one of eight the set takes three of
      for (let i = 0; i < 7; i++)
        sourceIds.push(await extractedSource(`s${i}`, 3));
      sourceIds.push(await extractedSource("s7", 8));
      for (let i = 8; i < 10; i++)
        sourceIds.push(await extractedSource(`s${i}`, 3));
      excludedSourceId = await extractedSource("x", 3, false);
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
      const gold = { source: { doi: { startsWith: DOI_PREFIX } } };
      await prisma.knowledgeGoldMissedClaim.deleteMany({
        where: { goldSource: gold },
      });
      await prisma.knowledgeGoldSource.deleteMany({ where: gold });
      await prisma.auditLog.deleteMany({
        where: { user: { email: { endsWith: `@${EMAIL_DOMAIN}` } } },
      });
      await prisma.knowledgeFieldAnchor.deleteMany({
        where: { OR: [{ passage: where }, { source: gold.source }] },
      });
      await prisma.knowledgeClaimEvidence.deleteMany({
        where: { passage: where },
      });
      await prisma.knowledgeClaim.deleteMany({
        where: { id: { in: claimIds } },
      });
      await prisma.knowledgePassage.deleteMany({ where });
      await prisma.knowledgeSourceVersion.deleteMany({ where: gold });
      await prisma.knowledgeSource.deleteMany({
        where: { doi: { startsWith: DOI_PREFIX } },
      });
      await prisma.user.deleteMany({
        where: { email: { endsWith: `@${EMAIL_DOMAIN}` } },
      });
      nincsMaradek([
        {
          nev: "KnowledgeGoldSource (a teszt-forrasoke)",
          darab: await prisma.knowledgeGoldSource.count({ where: gold }),
        },
        {
          nev: "KnowledgeSource (doi elotag)",
          darab: await prisma.knowledgeSource.count({
            where: { doi: { startsWith: DOI_PREFIX } },
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

    /** Every claim field and pending source field accepted, the questions rejected, then the overrides. */
    const decisions = (
      r: ClaimReview,
      over: (
        field: string,
        owner: "CLAIM" | "SOURCE",
      ) => FieldDecision["decision"] | null = () => null,
    ): FieldDecision[] =>
      r.fields
        .filter((f) => f.owner === "CLAIM" || f.decision === "PENDING")
        .map((f) => ({
          anchorId: f.anchorId,
          decision:
            over(f.field, f.owner) ?? (f.value === null ? "REJECT" : "ACCEPT"),
        }));

    const row = (view: GoldSetView, claimId: string) =>
      view.sources.flatMap((s) => s.rows).find((r) => r.claimId === claimId)!;

    it("before the freeze: the proposal counts the included sources' machine claims", async () => {
      const view = await repository.view();
      assert.equal(view.frozen, false);
      assert.ok(view.proposal);
      const ours = view.proposal.sources.filter((s) =>
        sourceIds.includes(s.sourceId),
      );
      // other included sources may stand in the database; ours hold three
      // each, the eight-claim one gives three to the set
      assert.ok(ours.length > 0);
      assert.ok(
        ours.every((s) =>
          s.sourceId === sourceIds[7]
            ? s.claims === 8 && s.inSet === 3
            : s.claims === 3 && s.inSet === 3,
        ),
      );
      assert.equal(
        view.proposal.sources.some((s) => s.sourceId === excludedSourceId),
        false,
      );
      assert.deepEqual(view.score.problems, ["NOT_FROZEN"]);
    });

    it("a source not included cannot be frozen; nothing is written", async () => {
      await assert.rejects(
        repository.freeze([...sourceIds.slice(1), excludedSourceId], userId),
        (e: unknown) =>
          e instanceof GoldSetConflict && e.code === "NOT_INCLUDED",
      );
      assert.equal(
        await prisma.knowledgeGoldSource.count({
          where: { sourceId: { in: sourceIds } },
        }),
        0,
      );
    });

    it("the freeze pins the ten sources with at most three claims each, once, with its AuditLog row", async () => {
      await repository.freeze(sourceIds, userId);
      const view = await repository.view();
      assert.equal(view.frozen, true);
      assert.deepEqual(
        view.sources.map((s) => s.sourceId),
        sourceIds,
      );
      // 9 x 3 + 3 of the eight: at most three from one source
      assert.equal(view.score.rows.total, 30);
      assert.equal(view.score.rows.pending, 30);
      const capped = view.sources[7]!;
      assert.equal(capped.rows.length, 3);
      assert.equal(capped.notInSet, 5);
      assert.equal(view.sources[0]!.notInSet, 0);
      assert.equal(view.score.verdict, "NOT_READY");
      assert.ok(view.score.problems.includes("PENDING_ROWS"));
      assert.equal(
        await prisma.auditLog.count({
          where: { userId, action: "KNOWLEDGE_GOLD_SET_FROZEN" },
        }),
        1,
      );
      await assert.rejects(
        repository.freeze(sourceIds, userId),
        (e: unknown) =>
          e instanceof GoldSetConflict && e.code === "ALREADY_FROZEN",
      );
    });

    it("a row's verdict comes from the review: accepted, quantity rejected, discarded, re-extracted", async () => {
      const [accepted, quantity, discarded, reextracted] = (
        await repository.view()
      ).sources[0]!.rows.map((r) => r.claimId).concat(
        (await repository.view()).sources[1]!.rows[0]!.claimId,
      );

      await review.save(
        accepted!,
        {
          decisions: decisions(await review.detail(accepted!)),
          applicability: null,
        },
        userId,
      );
      await review.save(
        quantity!,
        {
          decisions: decisions(await review.detail(quantity!), (f) =>
            f === "quantity" ? "REJECT" : null,
          ),
          applicability: null,
        },
        userId,
      );
      await review.discard(discarded!, "nem állítás", userId);
      // a re-extraction withdraws without the editor: no discard row
      await prisma.knowledgeClaim.update({
        where: { id: reextracted! },
        data: { status: "WITHDRAWN" },
      });

      const view = await repository.view();
      assert.equal(row(view, accepted!).judgement.verdict, "CORRECT");
      const q = row(view, quantity!).judgement;
      assert.equal(q.verdict, "WRONG");
      assert.ok(q.errors.includes("quantity"));
      assert.equal(q.critical, true);
      assert.equal(q.found, true);
      assert.deepEqual(row(view, discarded!).judgement.errors, ["CLAIM"]);
      assert.equal(row(view, discarded!).judgement.found, false);
      assert.equal(row(view, reextracted!).judgement.outReason, "REEXTRACTED");
      assert.equal(view.score.precision.critical, 1);
      assert.equal(view.score.rows.out, 1);
    });

    it("T3b: the source row reads the study fields' stored decisions, counted apart", async () => {
      const before = await repository.view();
      // the first review above accepted source 0's study fields with its claim
      assert.equal(before.sources[0]!.sourceRow.judgement.verdict, "CORRECT");
      assert.equal(before.sources[2]!.sourceRow.judgement.verdict, "PENDING");
      const claimId = before.sources[2]!.rows[0]!.claimId;
      await review.save(
        claimId,
        {
          decisions: decisions(await review.detail(claimId), (f, owner) =>
            owner === "SOURCE" && f === "studyType" ? "REJECT" : null,
          ),
          applicability: null,
        },
        userId,
      );
      const view = await repository.view();
      const row = view.sources[2]!.sourceRow;
      assert.ok(row.fields.some((f) => f.field === "studyType"));
      assert.equal(row.judgement.verdict, "WRONG");
      assert.deepEqual(row.judgement.errors, ["studyType"]);
      // no study type is no design tier: the level moves
      assert.equal(row.judgement.levelChanged, true);
      assert.equal(view.score.sourceFields.wrongFields, 1);
      assert.equal(view.score.sourceFields.levelChanged, 1);
    });

    it("a second evidence row's field decisions count in the row (barracuda, #1948)", async () => {
      const claimId = (await repository.view()).sources[3]!.rows[0]!.claimId;
      await review.save(
        claimId,
        {
          decisions: decisions(await review.detail(claimId)),
          applicability: null,
        },
        userId,
      );
      assert.equal(
        row(await repository.view(), claimId).judgement.verdict,
        "CORRECT",
      );
      // a second evidence row, on another source's machine passage, whose
      // field the editor corrected
      const passage = await prisma.knowledgePassage.findFirstOrThrow({
        where: { sourceVersion: { sourceId: sourceIds[4]! } },
        select: { id: true },
      });
      const evidence = await prisma.knowledgeClaimEvidence.create({
        data: { claimId, passageId: passage.id, stance: "SUPPORTS" },
        select: { id: true },
      });
      await prisma.knowledgeFieldAnchor.create({
        data: {
          claimEvidenceId: evidence.id,
          field: "effect",
          passageId: passage.id,
          normalizedValue: "CALCIFICATION",
          correctedValue: "SKELETAL_DENSITY",
          decision: "CORRECTED",
          decidedById: userId,
          decidedAt: new Date(),
        },
      });
      const judged = row(await repository.view(), claimId).judgement;
      assert.equal(judged.verdict, "WRONG");
      assert.deepEqual(judged.errors, ["effect"]);
    });

    it("missed claims and the completeness mark: a checked source takes no more, each write is logged", async () => {
      const sourceId = sourceIds[0]!;
      await repository.addMissed(
        sourceId,
        {
          text: "PO4 0,02 mg/l alatt nőtt a kalcifikáció",
          locator: "2. tábla",
        },
        userId,
      );
      await repository.setCompleteness(sourceId, true, userId);
      await assert.rejects(
        repository.addMissed(
          sourceId,
          { text: "még egy", locator: null },
          userId,
        ),
        (e: unknown) =>
          e instanceof GoldSetConflict && e.code === "COMPLETENESS_CHECKED",
      );
      let view = await repository.view();
      const first = view.sources[0]!;
      assert.equal(first.missed.length, 1);
      assert.notEqual(first.completenessCheckedAt, null);
      assert.equal(view.score.completeness.missed, 1);
      assert.equal(view.score.completeness.sourcesChecked, 1);

      await assert.rejects(
        repository.removeMissed(first.missed[0]!.id, userId),
        GoldSetConflict,
      );
      await repository.setCompleteness(sourceId, false, userId);
      await repository.removeMissed(first.missed[0]!.id, userId);
      view = await repository.view();
      assert.equal(view.sources[0]!.missed.length, 0);
      assert.equal(view.sources[0]!.completenessCheckedAt, null);
      const actions = (
        await prisma.auditLog.findMany({
          where: { userId, action: { startsWith: "KNOWLEDGE_GOLD_" } },
          orderBy: { createdAt: "asc" },
          select: { action: true },
        })
      ).map((a) => a.action);
      assert.deepEqual(actions, [
        "KNOWLEDGE_GOLD_SET_FROZEN",
        "KNOWLEDGE_GOLD_MISSED_ADDED",
        "KNOWLEDGE_GOLD_COMPLETENESS_CHECKED",
        "KNOWLEDGE_GOLD_COMPLETENESS_REOPENED",
        "KNOWLEDGE_GOLD_MISSED_REMOVED",
      ]);
    });

    it("the CHECKs and the unique position hold against a direct write", async () => {
      const gold = await prisma.knowledgeGoldSource.findUniqueOrThrow({
        where: { sourceId: sourceIds[1]! },
        select: { id: true },
      });
      await assert.rejects(
        prisma.knowledgeGoldSource.update({
          where: { id: gold.id },
          data: { completenessCheckedAt: new Date() },
        }),
      );
      // one place once: the unique index on position
      await assert.rejects(
        prisma.knowledgeGoldSource.update({
          where: { id: gold.id },
          data: { position: 1 },
        }),
      );
      await assert.rejects(
        prisma.knowledgeGoldMissedClaim.create({
          data: { goldSourceId: gold.id, text: "   ", createdById: userId },
        }),
      );
    });
  },
);
