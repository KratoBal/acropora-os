import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { PaidMarkRunRepository } from "./paid-mark-run.repository.js";

const gate = integrationDatabaseGate(process.env);

/*
  A FUTÁSOK NAPLÓJA (acrobot 26101). MI PIROSÍT: ha a „legutóbbi” nem
  forrásonként a legfrissebb futást adná; ha egy kulcs nélkül elbukott futás
  nem hagyna sort; ha a figyelmet kérő tételek elvesznének.
*/
describe("the paid-mark runs", { skip: gate.mode === "skip" }, () => {
  const runs = new PaidMarkRunRepository();
  // csak a saját sorait takarítja: a teszt indulása óta keletkezetteket
  const since = new Date(Date.now() - 1000);
  before(() => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
  });
  after(async () => {
    if (gate.mode === "run")
      await prisma.paidMarkRun.deleteMany({
        where: { startedAt: { gte: since } },
      });
  });

  it("the latest run per source, with its attention items and errors", async () => {
    await runs.save({
      source: "GLS_COD",
      writtenCount: 1,
      failedCount: 0,
      summary: { WRITTEN: 1 },
      attention: [],
    });
    await new Promise((r) => setTimeout(r, 5));
    await runs.save({
      source: "GLS_COD",
      writtenCount: 0,
      failedCount: 0,
      summary: { NO_CREDIT: 1 },
      attention: [{ reference: "2026-10-01", reason: "NO_CREDIT" }],
    });
    await runs.saveFailed("FOXPOST", "SZAMLAZZ_CONNECTION_NOT_CONFIGURED");
    const latest = await runs.latest();
    const by = new Map(latest.map((r) => [r.source, r]));
    assert.deepEqual(by.get("GLS_COD")!.attention, [
      { reference: "2026-10-01", reason: "NO_CREDIT" },
    ]);
    assert.equal(by.get("GLS_COD")!.attentionCount, 1);
    assert.equal(
      by.get("FOXPOST")!.errorCode,
      "SZAMLAZZ_CONNECTION_NOT_CONFIGURED",
    );
  });
});
