import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { CustomerCandidateSource } from "../../aquariums/recommendation/customer-candidate-source.js";
import type { CustomerCandidatesOfMove } from "../../aquariums/recommendation/customer-candidate-source.js";
import { integrationDatabaseGate } from "../../common/integration-database.js";
import type { DoseEffectsService } from "./dose-effects.service.js";
import { DoseProjectionService } from "./dose-projection.service.js";

/**
 * A VEVŐI JELÖLTEK VETÍTÉSE VALÓDI ADATBÁZISON (V3.4 S2b, kártya ce6c5cc9). MI PIROSÍT: a jelöltek nem a termék-adag listával azonos
 * futásban és tranzakcióban épülnek; egy újraépítés a régi sorok mellé ír, nem helyükre; a jelölt-forrás hibája elviszi a termék-adag
 * lista építését is, vagy a régi jelöltek a tábla tartalmai maradnak (egy elavult ajánlás); az adatbázis elfogad egy nem https
 * forrás-hivatkozást vagy a foszfátot; a futás törlése nem viszi a sorait.
 */
const gate = integrationDatabaseGate(process.env);

const candidate = (productId: string, rank: number) => ({
  productId,
  name: `VEVO-PROBA ${productId}`,
  category: "Adalékok",
  effects: [{ parameterCode: "KALCIUM", direction: "EMEL" as const }],
  evidenceRef: "https://gyarto.example/termek",
  shopUrl: `https://shop.example/${productId}`,
  rank,
});

const entries = (ids: string[]): CustomerCandidatesOfMove[] => [
  {
    parameterCode: "KALCIUM",
    direction: "EMEL",
    candidates: ids.map((id, index) => candidate(id, index + 1)),
  },
];

describe(
  "a vevői jelöltek vetítése (V3.4 S2b)",
  { skip: gate.mode === "skip" },
  () => {
    const suiteStartedAt = new Date();
    const doseEffects = {
      list: async () => [],
    } as unknown as DoseEffectsService;
    const projectionOf = (source: Partial<CustomerCandidateSource>) =>
      new DoseProjectionService(doseEffects, source as CustomerCandidateSource);

    before(() => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await prisma.reefClubCustomerCandidate.deleteMany({});
      await prisma.reefClubDoseProjectionRun.deleteMany({
        where: { startedAt: { gte: suiteStartedAt } },
      });
    });

    it("builds the rows in the SAME run as the dose list, with the rank and the fields", async () => {
      const outcome = await projectionOf({
        candidatesByMove: async () => entries(["a", "b"]),
      }).rebuild("SCHEDULE");
      assert.equal(outcome.ok, true);
      const run = await prisma.reefClubDoseProjectionRun.findFirstOrThrow({
        where: { status: "SUCCEEDED", startedAt: { gte: suiteStartedAt } },
        orderBy: { finishedAt: "desc" },
      });
      const rows = await prisma.reefClubCustomerCandidate.findMany({
        orderBy: { rank: "asc" },
      });
      assert.deepEqual(
        rows.map((row) => [
          row.productId,
          row.rank,
          row.parameterCode,
          row.direction,
          row.runId,
        ]),
        [
          ["a", 1, "KALCIUM", "EMEL", run.id],
          ["b", 2, "KALCIUM", "EMEL", run.id],
        ],
      );
      assert.equal(rows[0]!.shopUrl, "https://shop.example/a");
      assert.equal(rows[0]!.evidenceRef, "https://gyarto.example/termek");
    });

    it("a rebuild REPLACES the rows (nothing of the old state stays), and the old run's rows are not left beside the new", async () => {
      await projectionOf({
        candidatesByMove: async () => entries(["c"]),
      }).rebuild("SCHEDULE");
      const rows = await prisma.reefClubCustomerCandidate.findMany();
      assert.deepEqual(
        rows.map((row) => row.productId),
        ["c"],
      );
      assert.equal(new Set(rows.map((row) => row.runId)).size, 1);
    });

    it("an empty source empties the table: no recommendation is the safe state", async () => {
      await projectionOf({ candidatesByMove: async () => [] }).rebuild(
        "SCHEDULE",
      );
      assert.equal(await prisma.reefClubCustomerCandidate.count(), 0);
    });

    it("a source that FAILS does not fail the run: the dose list is rebuilt, and the candidate table is EMPTY (never the old, stale list)", async () => {
      await projectionOf({
        candidatesByMove: async () => entries(["old"]),
      }).rebuild("SCHEDULE");
      assert.equal(await prisma.reefClubCustomerCandidate.count(), 1);
      const outcome = await projectionOf({
        candidatesByMove: async () => {
          throw new Error("a JEV nem olvasható (próba)");
        },
      }).rebuild("SCHEDULE");
      assert.equal(outcome.ok, true);
      assert.equal(await prisma.reefClubCustomerCandidate.count(), 0);
      const latest = await prisma.reefClubDoseProjectionRun.findFirstOrThrow({
        where: { startedAt: { gte: suiteStartedAt } },
        orderBy: { finishedAt: "desc" },
      });
      assert.equal(latest.status, "SUCCEEDED");
    });

    it("rows the rules refuse (phosphate, an http reference) are never written, whatever the source hands over", async () => {
      await projectionOf({
        candidatesByMove: async () => [
          {
            parameterCode: "FOSZFAT",
            direction: "CSOKKENT",
            candidates: [candidate("po4", 1)],
          },
          {
            parameterCode: "KALCIUM",
            direction: "EMEL",
            candidates: [
              {
                ...candidate("plain", 1),
                evidenceRef: "http://gyarto.example/x",
              },
              candidate("ok", 2),
            ],
          },
        ],
      }).rebuild("SCHEDULE");
      const rows = await prisma.reefClubCustomerCandidate.findMany();
      assert.deepEqual(
        rows.map((row) => [row.productId, row.rank]),
        [["ok", 1]],
      );
    });

    it("the database refuses a non-https reference and an unapproved parameter when the rules are bypassed", async () => {
      const run = await prisma.reefClubDoseProjectionRun.findFirstOrThrow({
        where: { startedAt: { gte: suiteStartedAt } },
        orderBy: { finishedAt: "desc" },
      });
      const base = {
        runId: run.id,
        parameterCode: "KH",
        direction: "EMEL" as const,
        productId: "x",
        productName: "x",
        category: "x",
        rank: 1,
      };
      for (const bad of [
        { ...base, evidenceRef: "http://gyarto.example/x" },
        { ...base, evidenceRef: "" },
        { ...base, evidenceRef: "https://a b" },
        {
          ...base,
          parameterCode: "FOSZFAT",
          evidenceRef: "https://gyarto.example/x",
        },
      ])
        await assert.rejects(
          prisma.reefClubCustomerCandidate.create({ data: bad }),
          /check constraint|ReefClubCustomerCandidate_/i,
          JSON.stringify(bad),
        );
    });

    it("the same product may not be listed twice for one move, and deleting a run takes its rows with it", async () => {
      await projectionOf({
        candidatesByMove: async () => entries(["u"]),
      }).rebuild("SCHEDULE");
      const [row] = await prisma.reefClubCustomerCandidate.findMany();
      await assert.rejects(
        prisma.reefClubCustomerCandidate.create({
          data: {
            runId: row!.runId,
            parameterCode: row!.parameterCode,
            direction: row!.direction,
            productId: row!.productId,
            productName: "másolat",
            category: "x",
            evidenceRef: "https://gyarto.example/x",
            rank: 2,
          },
        }),
        /Unique constraint/i,
      );
      await prisma.reefClubDoseProjectionRun.delete({
        where: { id: row!.runId },
      });
      assert.equal(await prisma.reefClubCustomerCandidate.count(), 0);
    });
  },
);
