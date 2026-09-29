import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { FoxpostSettlementRepository } from "./foxpost-settlement.repository.js";

const gate = integrationDatabaseGate(process.env);

/**
 * THE LAST AUTOMATIC RUN, READ FROM THE TABLE (2026-09-29).
 *
 * The page's "does the Foxpost pull run by itself" line reads
 * `lastRun("SCHEDULED")`. A button run after the timer must not replace it,
 * and a run from before the column existed (trigger NULL) is unknown, so it
 * must never be read as automatic. The unit spec fakes the repository; this
 * one holds the filter against the real table.
 */
describe("Foxpost sync run trigger", { skip: gate.mode === "skip" }, () => {
  const repository = new FoxpostSettlementRepository();
  const created: string[] = [];

  async function removeOurs() {
    await prisma.foxpostSyncRun.deleteMany({ where: { id: { in: created } } });
  }

  before(async () => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
  });

  after(async () => {
    if (gate.mode !== "run") return;
    await removeOurs();
    nincsMaradek([
      {
        nev: "FoxpostSyncRun created by this suite",
        darab: await prisma.foxpostSyncRun.count({
          where: { id: { in: created } },
        }),
      },
    ]);
  });

  it("names the timer's run, not the newer button run nor an unknown one", async () => {
    const counts = {
      messagesSeen: 0,
      createdCount: 0,
      skippedCount: 0,
      needsReviewCount: 0,
      failedCount: 0,
    };
    const scheduled = await repository.createRun("SCHEDULED");
    created.push(scheduled);
    await repository.completeRun(scheduled, counts);
    const manual = await repository.createRun("MANUAL");
    created.push(manual);
    await repository.completeRun(manual, counts);
    // Newer than both, and without a trigger: a run from before the column.
    const unknown = await prisma.foxpostSyncRun.create({
      data: { status: "APPLIED", startedAt: new Date(Date.now() + 60_000) },
    });
    created.push(unknown.id);

    const lastScheduled = await repository.lastRun("SCHEDULED");
    const scheduledRow = await prisma.foxpostSyncRun.findUniqueOrThrow({
      where: { id: scheduled },
    });
    assert.equal(lastScheduled?.trigger, "SCHEDULED");
    assert.equal(
      lastScheduled?.startedAt,
      scheduledRow.startedAt.toISOString(),
    );

    const last = await repository.lastRun();
    assert.equal(last?.trigger, undefined, "the newest row is the unknown one");
  });
});
