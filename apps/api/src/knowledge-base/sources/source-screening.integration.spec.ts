import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import {
  parseSourceListQuery,
  type SourceListQuery,
} from "./source-screening.js";
import { SourceScreeningRepository } from "./source-screening.repository.js";

/**
 * SOURCE SCREENING ON A DATABASE (S4 acceptance: every decision writes an
 * AuditLog row). Also: the filters, the PRISMA counts, and the three CHECK
 * constraints, which refuse a reasonless exclusion even from another path.
 */
const gate = integrationDatabaseGate(process.env);
const DOI_PREFIX = "10.5555/kb-scr-int-";
const EMAIL_DOMAIN = "knowledge-screening-integration.invalid";

const query = (raw: Record<string, unknown>): SourceListQuery => {
  const q = parseSourceListQuery(raw);
  if (!q.ok) throw new Error(q.problems.join(" "));
  return q.value;
};

describe(
  "knowledge source screening, on a database",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = Date.now() % 1_000_000;
    const repo = new SourceScreeningRepository();
    let userId = "";
    const ids: Record<string, string> = {};

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
      const make = async (key: string, over: Record<string, unknown>) => {
        ids[key] = (
          await prisma.knowledgeSource.create({
            data: {
              kind: "PEER_REVIEWED",
              doi: `${DOI_PREFIX}${suffix}-${key}`,
              title: `Kitalált ${key}`,
              discoveredVia: "OPENALEX",
              authors: [
                { name: "A" },
                { name: "B" },
                { name: "C" },
                { name: "D" },
              ],
              ...over,
            },
          })
        ).id;
      };
      await make("old", { year: 2001, retractionCheckedAt: new Date() });
      await make("oa", {
        year: 2022,
        oaUrl: "https://europepmc.org/articles/PMC1",
        kind: "REVIEW",
        versions: {
          create: [{ versionKind: "RETRACTION", detectedVia: "MANUAL" }],
        },
      });
    });

    after(removeLeftovers);

    async function removeLeftovers() {
      const ours = { doi: { startsWith: DOI_PREFIX } };
      await prisma.auditLog.deleteMany({
        where: { user: { email: { endsWith: `@${EMAIL_DOMAIN}` } } },
      });
      await prisma.knowledgeSourceVersion.deleteMany({
        where: { source: ours },
      });
      await prisma.knowledgeSource.deleteMany({ where: ours });
      await prisma.user.deleteMany({
        where: { email: { endsWith: `@${EMAIL_DOMAIN}` } },
      });
      nincsMaradek([
        {
          nev: "KnowledgeSource (doi elotag)",
          darab: await prisma.knowledgeSource.count({ where: ours }),
        },
        {
          nev: "User (teszt-domain)",
          darab: await prisma.user.count({
            where: { email: { endsWith: `@${EMAIL_DOMAIN}` } },
          }),
        },
      ]);
    }

    it("lists with the filters; a row says retracted, open access, the first three authors", async () => {
      const oa = await repo.list(
        query({ openAccess: "true", kind: "REVIEW", yearFrom: "2020" }),
      );
      const mine = oa.items.filter((i) => i.id === ids.oa);
      assert.equal(mine.length, 1);
      const r = mine[0]!;
      assert.deepEqual(
        [
          r.openAccess,
          r.retracted,
          r.corrected,
          r.retractionUnchecked,
          r.authors,
          r.authorCount,
          r.screening.status,
        ],
        [true, true, false, true, ["A", "B", "C"], 4, "PENDING"],
      );
      // each filter on its own, so one cannot hide the other
      const closed = await repo.list(
        query({ openAccess: "false", pageSize: "100" }),
      );
      assert.ok(closed.items.some((i) => i.id === ids.old));
      assert.ok(!closed.items.some((i) => i.id === ids.oa));
      const early = await repo.list(query({ yearTo: "2005", pageSize: "100" }));
      assert.ok(early.items.some((i) => i.id === ids.old));
      assert.ok(!early.items.some((i) => i.id === ids.oa));
    });

    it("a decision writes the source and an AuditLog row; reset brings it back to pending", async () => {
      const excluded = await repo.decide(
        ids.old!,
        { status: "EXCLUDED", reason: "NOT_MARINE", note: "édesvízi" },
        userId,
      );
      assert.deepEqual(
        [
          excluded.screening.status,
          excluded.screening.reason,
          excluded.screening.by?.id,
        ],
        ["EXCLUDED", "NOT_MARINE", userId],
      );
      const audit = await prisma.auditLog.findMany({
        where: { entityType: "KnowledgeSource", entityId: ids.old },
        select: { action: true, userId: true, metadata: true },
      });
      assert.equal(audit.length, 1);
      assert.equal(audit[0]?.action, "KNOWLEDGE_SOURCE_SCREENED");
      assert.equal(audit[0]?.userId, userId);
      assert.deepEqual(audit[0]?.metadata, {
        before: { status: "PENDING", reason: null, note: null },
        after: { status: "EXCLUDED", reason: "NOT_MARINE", note: "édesvízi" },
      });
      const reset = await repo.decide(
        ids.old!,
        { status: "PENDING", reason: null, note: null },
        userId,
      );
      assert.deepEqual(
        [reset.screening.status, reset.screening.by, reset.screening.at],
        ["PENDING", null, null],
      );
      assert.equal(
        await prisma.auditLog.count({
          where: { entityType: "KnowledgeSource", entityId: ids.old },
        }),
        2,
      );
    });

    it("the PRISMA counts: pending, included, excluded by reason", async () => {
      await repo.decide(
        ids.oa!,
        { status: "INCLUDED", reason: null, note: null },
        userId,
      );
      await repo.decide(
        ids.old!,
        { status: "EXCLUDED", reason: "DUPLICATE", note: null },
        userId,
      );
      const s = await repo.summary();
      assert.ok(s.included >= 1 && s.excluded >= 1);
      assert.ok(s.excludedByReason.DUPLICATE >= 1);
      assert.equal(s.unique, s.pending + s.included + s.excluded);
      assert.equal(s.duplicatesRemoved, Math.max(0, s.identified - s.unique));
    });

    it("the database refuses a reasonless exclusion, 'other' without a note, a decision without its owner", async () => {
      for (const data of [
        {
          screeningStatus: "EXCLUDED" as const,
          exclusionReason: null,
          screenedById: userId,
          screenedAt: new Date(),
        },
        {
          screeningStatus: "EXCLUDED" as const,
          exclusionReason: "OTHER" as const,
          screeningNote: null,
          screenedById: userId,
          screenedAt: new Date(),
        },
        {
          screeningStatus: "INCLUDED" as const,
          exclusionReason: null,
          screenedById: null,
          screenedAt: null,
        },
        {
          screeningStatus: "INCLUDED" as const,
          exclusionReason: "NOT_CORAL" as const,
          screenedById: userId,
          screenedAt: new Date(),
        },
      ])
        await assert.rejects(
          prisma.knowledgeSource.update({ where: { id: ids.oa! }, data }),
          /check constraint|violates/i,
          JSON.stringify(data),
        );
    });

    it("an unknown source is reported as such", async () => {
      await assert.rejects(
        repo.decide(
          "nincs-ilyen",
          { status: "INCLUDED", reason: null, note: null },
          userId,
        ),
        { name: "SourceNotFound" },
      );
    });
  },
);
