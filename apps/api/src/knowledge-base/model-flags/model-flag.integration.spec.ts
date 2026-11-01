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
import {
  JATS,
  PASSAGE,
  aiClaim,
} from "../extraction/extraction-test-fixtures.js";
import { jatsSections } from "../extraction/jats-text.js";
import type { ClaimFlagItem, FlagWrite } from "./model-flag.js";
import { ModelFlagRepository } from "./model-flag.repository.js";

/**
 * THE SECOND MODEL'S FLAGS ON A DATABASE (S4, 7a 3.): an extracted CANDIDATE
 * claim waits for a flag; the write is held to the digest the fleet got,
 * appends one row and one AuditLog row, and a retry adds nothing; an edit
 * after the flag shows it as stale and puts the claim back in the queue;
 * and the database itself keeps one verdict per item in a run.
 */
const gate = integrationDatabaseGate(process.env);
const DOI_PREFIX = "10.5555/kb-model-flag-int-";
const EMAIL_DOMAIN = "knowledge-model-flag-integration.invalid";
const PROMPT = "b".repeat(64);

describe(
  "knowledge model flags, on a database",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = Date.now() % 1_000_000;
    const repository = new ModelFlagRepository();
    const vocabulary = vocabularyV1();
    let userId = "";
    let claimId = "";
    let conclusionId = "";

    async function extractedClaim(tag: string): Promise<string> {
      const sourceId = (
        await prisma.knowledgeSource.create({
          data: {
            kind: "PEER_REVIEWED",
            doi: `${DOI_PREFIX}${suffix}-${tag}`,
            title: `Kitalált cikk ${tag}`,
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
        vocabulary,
      );
      await new PrismaExtractionStore().saveSource({
        sourceId,
        contentHash: sha256(JATS),
        extractedBy: "test claim-extraction/v1",
        claims,
        verifiedAt: new Date("2026-11-01T10:00:00Z"),
      });
      return (
        await prisma.knowledgeClaimEvidence.findFirstOrThrow({
          where: { passage: { sourceVersion: { sourceId } } },
          select: { claimId: true },
        })
      ).claimId;
    }

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      userId = (
        await prisma.user.create({
          data: {
            email: `futtato-${suffix}@${EMAIL_DOMAIN}`,
            displayName: "Kitalált Futtató",
            role: "OWNER",
            isActive: true,
          },
        })
      ).id;
      claimId = await extractedClaim("a");
      conclusionId = (
        await prisma.knowledgeConclusion.create({
          data: {
            text: "Kitalált következtetés.",
            reasoning: "Mert.",
            createdById: userId,
            claims: { create: [{ claimId }] },
          },
        })
      ).id;
    });

    after(removeLeftovers);

    async function removeLeftovers() {
      const users = { email: { endsWith: `@${EMAIL_DOMAIN}` } };
      const where = {
        sourceVersion: { source: { doi: { startsWith: DOI_PREFIX } } },
      };
      const claimIds = (
        await prisma.knowledgeClaimEvidence.findMany({
          where: { passage: where },
          select: { claimId: true },
        })
      ).map((e) => e.claimId);
      await prisma.knowledgeModelFlag.deleteMany({
        where: { createdBy: users },
      });
      await prisma.auditLog.deleteMany({ where: { user: users } });
      await prisma.knowledgeConclusion.deleteMany({
        where: { createdBy: users },
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
      await prisma.user.deleteMany({ where: users });
      nincsMaradek([
        {
          nev: "KnowledgeSource (doi elotag)",
          darab: await prisma.knowledgeSource.count({
            where: { doi: { startsWith: DOI_PREFIX } },
          }),
        },
        {
          nev: "KnowledgeModelFlag (teszt-felhasznalo)",
          darab: await prisma.knowledgeModelFlag.count({
            where: { createdBy: users },
          }),
        },
        {
          nev: "AuditLog (teszt-felhasznalo)",
          darab: await prisma.auditLog.count({ where: { user: users } }),
        },
      ]);
    }

    const ours = async (): Promise<ClaimFlagItem | undefined> =>
      (await repository.pending("CLAIM", 50, vocabulary)).items.find(
        (i): i is ClaimFlagItem => i.targetId === claimId,
      );

    const run = (
      runId: string,
      flags: Partial<FlagWrite["flags"][number]>[],
    ): FlagWrite => ({
      source: "gpt-runner",
      runId: `${runId}-${suffix}`,
      model: "gpt-test",
      promptSha256: PROMPT,
      flags: flags.map((f) => ({
        targetType: "CLAIM",
        targetId: claimId,
        targetHash: "0".repeat(64),
        flagged: true,
        ...f,
      })),
    });

    it("an extracted CANDIDATE claim waits, with its verbatim passage and fields", async () => {
      const item = await ours();
      assert.ok(item, "the claim is among the pending items");
      assert.deepEqual(item.passages, [PASSAGE]);
      assert.deepEqual(
        {
          effect: item.claim.effect,
          direction: item.claim.direction,
          taxa: item.claim.taxa,
        },
        {
          effect: "CALCIFICATION",
          direction: "DECREASE",
          taxa: ["ACROPORA_MILLEPORA"],
        },
      );
    });

    it("a DRAFT conclusion is in the conclusion queue, offered or with its reason", async () => {
      const p = await repository.pending("CONCLUSION", 50, vocabulary);
      const ids = [
        ...p.items.map((i) => i.targetId),
        ...p.notOffered.map((n) => n.targetId),
      ];
      assert.ok(ids.includes(conclusionId));
    });

    it("writes against the current digest: one row, one AuditLog row, out of the queue", async () => {
      const item = (await ours())!;
      const r = await repository.write(
        run("r1", [{ targetHash: item.targetHash, flagged: true }]),
        userId,
        vocabulary,
      );
      assert.deepEqual(
        {
          written: r.written,
          alreadyWritten: r.alreadyWritten,
          rejected: r.rejected,
        },
        { written: 1, alreadyWritten: 0, rejected: [] },
      );
      const rows = await prisma.knowledgeModelFlag.findMany({
        where: { targetId: claimId },
        select: {
          flagged: true,
          source: true,
          targetHash: true,
          createdById: true,
        },
      });
      assert.deepEqual(rows, [
        {
          flagged: true,
          source: "gpt-runner",
          targetHash: item.targetHash,
          createdById: userId,
        },
      ]);
      const audit = await prisma.auditLog.count({
        where: {
          userId,
          action: "KNOWLEDGE_MODEL_FLAGS_WRITTEN",
          entityId: `r1-${suffix}`,
        },
      });
      assert.equal(audit, 1);
      assert.equal(await ours(), undefined);
      const latest = await repository.latest("CLAIM", [claimId], vocabulary);
      assert.equal(latest[claimId]?.flagged, true);
      assert.equal(latest[claimId]?.current, true);
    });

    it("a retry adds nothing; another verdict in the run, a stale digest and an unknown item are refused", async () => {
      const hash = (
        await prisma.knowledgeModelFlag.findFirstOrThrow({
          where: { targetId: claimId },
          select: { targetHash: true },
        })
      ).targetHash;
      const retry = await repository.write(
        run("r1", [{ targetHash: hash, flagged: true }]),
        userId,
        vocabulary,
      );
      assert.deepEqual([retry.written, retry.alreadyWritten], [0, 1]);
      const other = await repository.write(
        run("r1", [{ targetHash: hash, flagged: false }]),
        userId,
        vocabulary,
      );
      assert.deepEqual(
        other.rejected.map((x) => x.reason),
        ["OTHER_VERDICT_IN_RUN"],
      );
      const stale = await repository.write(
        run("r2", [
          { flagged: false },
          { targetId: "nincs-ilyen", flagged: false },
        ]),
        userId,
        vocabulary,
      );
      assert.deepEqual(
        {
          written: stale.written,
          reasons: stale.rejected.map((x) => x.reason),
        },
        { written: 0, reasons: ["STALE_HASH", "UNKNOWN_TARGET"] },
      );
      assert.equal(
        await prisma.knowledgeModelFlag.count({ where: { targetId: claimId } }),
        1,
      );
    });

    it("an edit after the flag: the flag is stale, the claim waits again under a new digest", async () => {
      const before = (
        await prisma.knowledgeModelFlag.findFirstOrThrow({
          where: { targetId: claimId },
          select: { targetHash: true },
        })
      ).targetHash;
      await prisma.knowledgeClaim.update({
        where: { id: claimId },
        data: { direction: "INCREASE" },
      });
      const latest = await repository.latest("CLAIM", [claimId], vocabulary);
      assert.equal(latest[claimId]?.current, false);
      const again = await ours();
      assert.ok(again);
      assert.notEqual(again.targetHash, before);
    });

    it("the database keeps one verdict per item in a run", async () => {
      const row = await prisma.knowledgeModelFlag.findFirstOrThrow({
        where: { targetId: claimId },
      });
      const { id: _id, createdAt: _at, ...copy } = row;
      await assert.rejects(
        prisma.knowledgeModelFlag.create({
          data: { ...copy, flagged: !copy.flagged },
        }),
        (e: { code?: string }) => e.code === "P2002",
      );
    });
  },
);
