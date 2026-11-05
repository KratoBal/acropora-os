import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { setAttentionClosure } from "./paid-mark-attention-closure.js";
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
  let userId = "";
  after(async () => {
    if (gate.mode !== "run") return;
    await prisma.paidMarkRun.deleteMany({
      where: { startedAt: { gte: since } },
    });
    await prisma.paidMarkAttentionClosure.deleteMany({
      where: { closedAt: { gte: since } },
    });
    if (userId) {
      await prisma.auditLog.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
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

  // e64540fd: WHAT TURNS THIS RED: a dry run without its plan, or marked as a run that wrote; a manual run
  // without the person who pressed the button; a column the database refuses
  it("a dry run keeps its plan, and a manual run who pressed the button", async () => {
    await runs.saveDry(
      {
        source: "SIMPLEPAY",
        writtenCount: 0,
        failedCount: 0,
        summary: { PLANNED: 1 },
        attention: [],
      },
      [
        {
          invoiceNumber: "ACR-2026/00042",
          amount: "12700",
          date: "2026-11-04",
          sourceRef: "credit-1",
        },
      ],
      { kind: "manual", userId: "user-1" },
    );
    const latest = await runs.latest();
    const row = latest.find((r) => r.source === "SIMPLEPAY")!;
    assert.equal(row.mode, "dry");
    assert.equal(row.trigger, "manual");
    assert.equal(row.triggeredById, "user-1");
    assert.equal(row.writtenCount, 0);
    assert.deepEqual(row.planned, [
      {
        invoiceNumber: "ACR-2026/00042",
        amount: "12700",
        date: "2026-11-04",
        sourceRef: "credit-1",
      },
    ]);
    const daily = latest.find((r) => r.source === "GLS_COD")!;
    assert.equal(daily.mode, "auto");
    assert.equal(daily.trigger, "schedule");
    assert.deepEqual(daily.planned, []);
  });

  // 6fd8c574: WHAT TURNS THIS RED: a line closed by hand still in `attention` (or counted), or missing who closed it;
  // the undo not bringing it back at once; a column or a constraint the database refuses
  it("a line closed by hand leaves attention at once, and the undo brings it back", async () => {
    const user = await prisma.user.create({
      data: {
        email: `pmac-${Date.now()}@example.invalid`,
        displayName: "PMAC aktor",
        role: "OWNER",
      },
      select: { id: true },
    });
    userId = user.id;
    await runs.save({
      source: "BANK_TRANSFER",
      writtenCount: 0,
      failedCount: 0,
      summary: { UNRESOLVED: 2 },
      attention: [
        {
          reference: "jóváírás 2026-11-04",
          reason: "UNRESOLVED",
          key: "pmac-1",
        },
        {
          reference: "jóváírás 2026-11-04",
          reason: "UNRESOLVED",
          key: "pmac-2",
        },
      ],
    });
    const closure = {
      source: "BANK_TRANSFER" as const,
      key: "pmac-1",
      reason: "UNRESOLVED",
      userId,
    };
    await setAttentionClosure(prisma, { ...closure, closed: true });
    const closed = (await runs.latest()).find(
      (r) => r.source === "BANK_TRANSFER",
    )!;
    assert.deepEqual(
      closed.attention.map((i) => i.key),
      ["pmac-2"],
    );
    assert.equal(closed.attentionCount, 1);
    assert.deepEqual(
      closed.settled.map((i) => [i.key, i.closedBy]),
      [["pmac-1", "PMAC aktor"]],
    );
    await setAttentionClosure(prisma, { ...closure, closed: false });
    const reopened = (await runs.latest()).find(
      (r) => r.source === "BANK_TRANSFER",
    )!;
    assert.equal(reopened.attentionCount, 2);
    assert.deepEqual(reopened.settled, []);
    assert.equal(
      await prisma.auditLog.count({
        where: { userId, entityType: "PaidMarkAttentionClosure" },
      }),
      2,
    );
  });
});
