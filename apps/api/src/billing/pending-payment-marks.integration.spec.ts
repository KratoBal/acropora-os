import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import {
  PLANNED_IN_FLIGHT_MS,
  PendingPaymentMarkRepository,
} from "./manual-outgoing-payment.service.js";

/**
 * A BERAGADT KIFIZETÉS-JELÖLÉS LEZÁRÁSA (barracuda, #2168 review), valódi Postgresen. MI PIROSÍT: ha a
 * függő lista a WRITTEN vagy FAILED sort is mutatja; ha a lezárás nem a kért állapotot írja; ha egy már
 * lezárt (nem függő) sort még egyszer lezár; ha a lezárás nem kerül az auditnaplóba.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "PENDINGMARK";
const NUMBER = `${PREFIX}/00084`;

async function removeLeftovers() {
  await prisma.auditLog.deleteMany({ where: { entityId: NUMBER } });
  await prisma.outgoingPaymentMark.deleteMany({
    where: { invoiceNumber: NUMBER },
  });
  await prisma.user.deleteMany({
    where: { email: `${PREFIX.toLowerCase()}-actor@example.invalid` },
  });
}

describe("the pending payment marks", { skip: gate.mode === "skip" }, () => {
  const repository = new PendingPaymentMarkRepository();
  let userId = "";
  const ids: Record<string, string> = {};

  before(async () => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
    await removeLeftovers();
    userId = (
      await prisma.user.create({
        data: {
          email: `${PREFIX.toLowerCase()}-actor@example.invalid`,
          displayName: `${PREFIX} aktor`,
          role: "OWNER",
        },
        select: { id: true },
      })
    ).id;
    // "planned" settled long ago (a stopped process); "fresh" may still be inside its call
    const settled = new Date(Date.now() - 2 * PLANNED_IN_FLIGHT_MS);
    for (const [key, state, createdAt] of [
      ["planned", "PLANNED", settled],
      ["unknown", "UNKNOWN", settled],
      ["written", "WRITTEN", settled],
      ["fresh", "PLANNED", new Date()],
    ] as const)
      ids[key] = (
        await prisma.outgoingPaymentMark.create({
          data: {
            source: "MANUAL",
            invoiceNumber: NUMBER,
            markDate: new Date("2026-11-04T00:00:00Z"),
            amount: new Prisma.Decimal(127000),
            sourceRef: `${PREFIX}-${key}`,
            state,
            createdAt,
          },
          select: { id: true },
        })
      ).id;
  });

  after(async () => {
    if (gate.mode === "run") await removeLeftovers();
  });

  it("lists only the pending ones, and resolves each once, with an audit row", async () => {
    assert.deepEqual(
      (await repository.pending(NUMBER)).map((mark) => [
        mark.id,
        mark.state,
        mark.inFlight,
      ]),
      [
        [ids.planned, "PLANNED", false],
        [ids.unknown, "UNKNOWN", false],
        [ids.fresh, "PLANNED", true],
      ],
    );
    // a call that may still run is not closed by hand (barracuda, #2168 v3)
    assert.equal(
      await repository.resolve({ id: ids.fresh!, outcome: "FAILED", userId }),
      "IN_FLIGHT",
    );
    assert.equal(
      await repository.resolve({ id: ids.planned!, outcome: "FAILED", userId }),
      "RESOLVED",
    );
    assert.equal(
      await repository.resolve({
        id: ids.unknown!,
        outcome: "WRITTEN",
        userId,
      }),
      "RESOLVED",
    );
    // a closed one, and a written one, are not pending: no second change
    assert.equal(
      await repository.resolve({
        id: ids.planned!,
        outcome: "WRITTEN",
        userId,
      }),
      "NOT_PENDING",
    );
    assert.equal(
      await repository.resolve({ id: ids.written!, outcome: "FAILED", userId }),
      "NOT_PENDING",
    );
    const states = await prisma.outgoingPaymentMark.findMany({
      where: { invoiceNumber: NUMBER },
      select: { id: true, state: true },
    });
    assert.deepEqual(
      Object.fromEntries(states.map((row) => [row.id, row.state])),
      {
        [ids.planned!]: "FAILED",
        [ids.unknown!]: "WRITTEN",
        [ids.written!]: "WRITTEN",
        [ids.fresh!]: "PLANNED",
      },
    );
    assert.deepEqual(
      (await repository.pending(NUMBER)).map((mark) => mark.id),
      [ids.fresh],
    );
    const audits = await prisma.auditLog.findMany({
      where: {
        entityId: NUMBER,
        action: "billing.outgoing-payment.mark-resolved",
      },
      orderBy: { createdAt: "asc" },
      select: { userId: true, metadata: true },
    });
    assert.deepEqual(
      audits.map((row) => [row.userId, (row.metadata as { to: string }).to]),
      [
        [userId, "FAILED"],
        [userId, "WRITTEN"],
      ],
    );
  });
});
