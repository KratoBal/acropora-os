import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import type { DraftResult } from "./research-draft.js";
import {
  DraftAlreadyRunning,
  PrismaDraftStore,
  researchDraftRunning,
} from "./research-draft.store.js";

/**
 * THE RESEARCH DRAFT'S ROW ON A DATABASE (S6 slice 4b): one RUNNING row at a
 * time (the partial unique index), a DRAFT cannot be stored without its
 * summary and the model that wrote it (the CHECK), a FAILED row keeps its
 * sources and candidate claims, and a stale RUNNING row is failed.
 */
const gate = integrationDatabaseGate(process.env);
const EMAIL_DOMAIN = "research-draft-integration.invalid";

const result = (over: Partial<DraftResult> = {}): DraftResult => ({
  status: "DRAFT",
  reason: null,
  sources: [
    {
      doi: "10.5555/x",
      pmcid: "PMC1",
      pmid: null,
      title: "Kitalált",
      authors: ["Kitalált K"],
      year: 2013,
      venue: null,
      url: null,
      licence: "CC_BY",
      read: "READ",
      retractionUnchecked: false,
      claims: 1,
    },
  ],
  candidateClaims: [],
  summary: "Kitalált összefoglaló [[claim:c1]].",
  summaryModel: "test research-summary/v1",
  report: {
    queries: ["q"],
    queriesRefused: [],
    read: [],
    claims: 1,
    claimsSent: 1,
    summaryDroppedByAi: [],
    summaryDroppedHere: [],
  },
  ...over,
});

describe(
  "research drafts (mode B), on a database",
  { skip: gate.mode === "skip" },
  () => {
    const store = new PrismaDraftStore();
    let userId = "";

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      userId = (
        await prisma.user.create({
          data: {
            email: `szerkeszto-${Date.now() % 1_000_000}@${EMAIL_DOMAIN}`,
            displayName: "Kitalált Szerkesztő",
            role: "OWNER",
            isActive: true,
          },
        })
      ).id;
    });
    after(removeLeftovers);

    async function removeLeftovers() {
      const mine = { createdBy: { email: { endsWith: `@${EMAIL_DOMAIN}` } } };
      await prisma.knowledgeResearchDraft.deleteMany({ where: mine });
      await prisma.user.deleteMany({
        where: { email: { endsWith: `@${EMAIL_DOMAIN}` } },
      });
      nincsMaradek([
        {
          nev: "KnowledgeResearchDraft (a teszt-felhasznaloe)",
          darab: await prisma.knowledgeResearchDraft.count({ where: mine }),
        },
      ]);
    }

    it("one RUNNING row at a time; finished, it is a DRAFT with its summary, and the next may start", async () => {
      const id = await store.start({
        question: "Mennyi foszfát?",
        createdById: userId,
        startedAt: new Date(),
      });
      assert.deepEqual(await store.running(), { id });
      await assert.rejects(
        store.start({
          question: "Még egy?",
          createdById: userId,
          startedAt: new Date(),
        }),
        DraftAlreadyRunning,
      );
      await store.finish(id, result(), new Date());
      const row = await store.get(id);
      assert.equal(row?.status, "DRAFT");
      assert.equal(row?.summaryModel, "test research-summary/v1");
      assert.ok(row?.finishedAt);
      assert.equal(await store.running(), null);
      const next = await store.start({
        question: "A következő",
        createdById: userId,
        startedAt: new Date(),
      });
      await store.finish(
        next,
        result({
          status: "FAILED",
          reason: "NO_CLAIMS",
          summary: null,
          summaryModel: null,
        }),
        new Date(),
      );
      const failed = await store.get(next);
      assert.equal(failed?.status, "FAILED");
      assert.equal(failed?.summary, null);
      assert.equal(
        (failed?.sources as unknown[]).length,
        1,
        "the sources stay on a FAILED row",
      );
      assert.deepEqual(
        (await store.list(20)).slice(0, 2).map((r) => r.id),
        [next, id],
      );
    });

    it("a DRAFT without its summary or its model cannot be stored (CHECK)", async () => {
      await assert.rejects(
        prisma.knowledgeResearchDraft.create({
          data: {
            question: "k",
            status: "DRAFT",
            summary: null,
            summaryModel: "m",
            createdById: userId,
          },
        }),
        /KnowledgeResearchDraft_draft_has_summary|check constraint/i,
      );
      await assert.rejects(
        prisma.knowledgeResearchDraft.create({
          data: {
            question: "k",
            status: "DRAFT",
            summary: "s",
            summaryModel: null,
            createdById: userId,
          },
        }),
        /KnowledgeResearchDraft_draft_has_summary|check constraint/i,
      );
    });

    it("only a RUNNING draft with a fresh heartbeat holds the discovery and the extraction back (barracuda on #1932)", async () => {
      // a process that died under its draft: RUNNING, its heartbeat an hour old
      const old = new Date(Date.now() - 60 * 60_000);
      const dead = await store.start({
        question: "Beragadt",
        createdById: userId,
        startedAt: old,
      });
      assert.equal(await researchDraftRunning(), false);
      await prisma.knowledgeResearchDraft.update({
        where: { id: dead },
        data: { status: "FAILED", finishedAt: new Date() },
      });
      const live = await store.start({
        question: "Él",
        createdById: userId,
        startedAt: new Date(),
      });
      assert.equal(await researchDraftRunning(), true);
      await store.finish(live, result(), new Date());
      assert.equal(await researchDraftRunning(), false);
    });

    it("a RUNNING row silent too long is failed; a row finished meanwhile is not overwritten", async () => {
      const old = new Date(Date.now() - 60 * 60_000);
      const id = await store.start({
        question: "Régi",
        createdById: userId,
        startedAt: old,
      });
      assert.equal(
        await store.abandonStale(new Date(Date.now() - 5 * 60_000)),
        1,
      );
      const row = await store.get(id);
      assert.deepEqual(
        [row?.status, row?.report],
        ["FAILED", { error: "STALE_RUNNING" }],
      );
      // the process that was thought dead finishes after all: the FAILED row stays
      await store.finish(id, result(), new Date());
      assert.equal((await store.get(id))?.status, "FAILED");
    });
  },
);
