import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";
import { VOCABULARY_V1_ROWS, vocabularyV1 } from "@acropora/knowledge-base";

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
import { VocabularyInputError, parseNewEntry } from "./vocabulary-versions.js";
import {
  VocabularyConflict,
  VocabularyRepository,
} from "./vocabulary.repository.js";

/**
 * THE VOCABULARY ON A DATABASE (S5, K4; acrobot 35807, 35810). The first edit
 * copies the approved version into a draft of the next one; the claim review
 * adds a missing species to that draft and decides its field in one
 * transaction; the gate keeps reading the approved version until the approver
 * approves the draft, whole; every write leaves its AuditLog row.
 *
 * The vocabulary is one table for the whole system: this spec needs it empty
 * at the start (the code's version 1 is then the approved one), stops if it is
 * not, and so removes only rows it wrote itself (the integration gate's rule:
 * no spec empties a table unfiltered).
 */
const gate = integrationDatabaseGate(process.env);
const DOI_PREFIX = "10.5555/kb-vocabulary-int-";
const EMAIL_DOMAIN = "knowledge-vocabulary-integration.invalid";

describe(
  "the knowledge vocabulary, on a database",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = Date.now() % 1_000_000;
    // version 1 lives in code, so every database row is version 2 or later;
    // with the table empty at the start (asserted below) and the specs run one
    // at a time, every such row at the end is this spec's
    const ours = { version: { gte: 2 } };
    const vocabulary = new VocabularyRepository();
    const review = new ClaimReviewRepository();
    let userId = "";
    let claimId = "";

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      assert.equal(
        await prisma.knowledgeVocabularyEntry.count(),
        0,
        "the vocabulary table is not empty: this spec does not run on a database with a vocabulary",
      );
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
      const sourceId = (
        await prisma.knowledgeSource.create({
          data: {
            kind: "PEER_REVIEWED",
            doi: `${DOI_PREFIX}${suffix}`,
            title: "Kitalált cikk a szótárhoz",
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
      claimId = (
        await prisma.knowledgeClaimEvidence.findFirstOrThrow({
          where: { passage: { sourceVersion: { sourceId } } },
          select: { claimId: true },
        })
      ).claimId;
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
      await prisma.knowledgeVocabularyEntry.deleteMany({ where: ours });
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
          nev: "KnowledgeVocabularyEntry (2. változattól)",
          darab: await prisma.knowledgeVocabularyEntry.count({ where: ours }),
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

    it("empty table: version 1 from code is approved, nothing in draft", async () => {
      const state = await vocabulary.state();
      assert.deepEqual(state.approved, {
        version: 1,
        origin: "CODE",
        approvedAt: null,
        approvedBy: null,
      });
      assert.equal(state.draft, null);
      assert.equal(state.entries.length, VOCABULARY_V1_ROWS.length);
    });

    it("the review adds the missing species and decides its field in one transaction; the gate does not see it yet", async () => {
      const detail = await review.detail(claimId);
      const question = detail.fields.find((f) => f.question !== null)!;
      assert.equal(question.question, "Porites lutea");
      const decisions = detail.fields
        .filter((f) => f.owner === "CLAIM" || f.decision === "PENDING")
        .map((f) =>
          f.anchorId === question.anchorId
            ? {
                anchorId: f.anchorId,
                decision: "ADD_TO_VOCABULARY" as const,
                entry: {
                  forms: ["porites lutea"],
                  rank: "SPECIES",
                  parentKey: "PORITES",
                },
              }
            : { anchorId: f.anchorId, decision: "ACCEPT" as const },
        );
      const saved = await review.save(
        claimId,
        { decisions, applicability: null },
        userId,
      );
      assert.equal(saved.status, "VERIFIED");
      const field = saved.fields.find((f) => f.anchorId === question.anchorId)!;
      assert.equal(field.decision, "CORRECTED");
      assert.equal(field.correctedValue, "PORITES_LUTEA");
      // the draft: version 2, the copy of version 1 plus the new row
      const state = await vocabulary.state();
      assert.equal(state.approved.version, 1);
      assert.deepEqual(state.draft, {
        version: 2,
        changes: [
          { kind: "TAXON", key: "PORITES_LUTEA", change: "ADDED", fields: [] },
        ],
      });
      assert.equal(
        await prisma.knowledgeVocabularyEntry.count({ where: { version: 2 } }),
        VOCABULARY_V1_ROWS.length + 1,
      );
      // the gate still reads version 1
      const approved = await vocabulary.approvedVocabulary();
      assert.equal(approved.version, 1);
      assert.equal(
        approved.taxa.some((t) => t.key === "PORITES_LUTEA"),
        false,
      );
      // the next claim's correction may already choose it
      assert.ok(
        (await review.detail(claimId)).options.species.some(
          (o) => o.key === "PORITES_LUTEA" && o.label === "Porites lutea",
        ),
      );
      const audit = await prisma.auditLog.findMany({
        where: { userId, action: "KNOWLEDGE_VOCABULARY_ENTRY_ADDED" },
        select: { entityId: true, metadata: true },
      });
      assert.equal(audit.length, 1);
      assert.equal(audit[0]!.entityId, "TAXON/PORITES_LUTEA/2");
      assert.equal(
        (audit[0]!.metadata as Record<string, unknown>).claimId,
        claimId,
      );
    });

    it("an effect added on the screen, an edit of a draft row; a form under two keys is refused and writes nothing", async () => {
      const rows = (await vocabulary.versions()).draft!.rows;
      await vocabulary.addEntry(
        parseNewEntry(
          {
            kind: "EFFECT",
            key: "MICROBIOMECOMPOSITION",
            forms: ["mikrobiom-összetétel"],
          },
          rows,
        ),
        userId,
      );
      const edited = await vocabulary.editEntry(
        "TAXON",
        "ACROPORA_MURICATA",
        { forms: ["acropora muricata", "acropora formosa", "a. muricata"] },
        userId,
      );
      assert.deepEqual(
        edited.draft?.changes.map((c) => [c.change, c.key]),
        [
          // by kind as the enum orders it (TAXON before EFFECT), then key
          ["CHANGED", "ACROPORA_MURICATA"],
          ["ADDED", "PORITES_LUTEA"],
          ["ADDED", "MICROBIOMECOMPOSITION"],
        ],
      );
      const count = await prisma.knowledgeVocabularyEntry.count();
      await assert.rejects(
        vocabulary.editEntry(
          "TAXON",
          "PORITES_LUTEA",
          { forms: ["acropora formosa"] },
          userId,
        ),
        (e: unknown) =>
          e instanceof VocabularyInputError && e.code === "VOCABULARY_INVALID",
      );
      assert.equal(await prisma.knowledgeVocabularyEntry.count(), count);
    });

    it("approval: only of the version seen; then the draft is the approved version, and the gate reads it", async () => {
      // the version check names the draft; the row count would stop it too
      await assert.rejects(
        vocabulary.approve(3, userId),
        (e: unknown) =>
          e instanceof VocabularyConflict &&
          /the draft is version 2, not 3/.test(e.message),
      );
      const state = await vocabulary.approve(2, userId);
      assert.equal(state.approved.version, 2);
      assert.equal(state.approved.origin, "DATABASE");
      assert.equal(state.approved.approvedBy, "Kitalált Szerkesztő");
      assert.equal(state.draft, null);
      const approved = await vocabulary.approvedVocabulary();
      assert.equal(approved.version, 2);
      assert.equal(approved.status, "APPROVED");
      assert.ok(approved.taxa.some((t) => t.key === "PORITES_LUTEA"));
      const log = await prisma.auditLog.findFirstOrThrow({
        where: { userId, action: "KNOWLEDGE_VOCABULARY_APPROVED" },
        select: { entityId: true, metadata: true },
      });
      assert.equal(log.entityId, "2");
      assert.equal(
        ((log.metadata as Record<string, unknown>).changes as unknown[]).length,
        3,
      );
      // nothing to approve now; the next edit opens version 3 from version 2
      await assert.rejects(
        vocabulary.approve(2, userId),
        (e: unknown) => e instanceof VocabularyConflict,
      );
      const next = await vocabulary.editEntry(
        "EFFECT",
        "GROWTH",
        { forms: ["növekedés", "növekedési ütem"] },
        userId,
      );
      assert.equal(next.draft?.version, 3);
      assert.equal(next.approved.version, 2);
    });

    it("the probe: what a sentence is recognised as, by the approved version", async () => {
      const probe = await vocabulary.probe(
        "A Porites lutea növekedése 0,05 mg/l foszfát mellett csökkent.",
        "APPROVED",
      );
      assert.equal(probe.version, 2);
      assert.ok(probe.parts.taxa.includes("PORITES_LUTEA"));
      assert.ok(probe.parts.effects.includes("GROWTH"));
    });
  },
);
