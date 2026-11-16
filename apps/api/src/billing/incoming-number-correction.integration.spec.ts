import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { correctIncomingNumber } from "./incoming-number-correction.js";
import { lockIncomingKeys } from "./purchase-incoming.js";

/*
  ON A REAL POSTGRES. WHAT TURNS THIS RED: a correction not waiting on the row while another one is in flight, so it reads
  the number being overwritten: its audit row names that stale number as `from`, and the log loses a step (barracuda on
  #2496). Measured both ways: with the row lock removed this goes red every time, not by luck (the race is held open).
*/
const gate = integrationDatabaseGate(process.env);
const EXTERNAL = "number-lock-it-1";
const EMAIL = "number-lock-it-actor@example.invalid";

async function removeLeftovers() {
  const rows = await prisma.incomingBillingDocument.findMany({
    where: { externalId: EXTERNAL },
    select: { id: true },
  });
  await prisma.auditLog.deleteMany({
    where: { entityId: { in: rows.map((r) => r.id) } },
  });
  await prisma.incomingBillingDocument.deleteMany({
    where: { externalId: EXTERNAL },
  });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
}

describe(
  "a postafiókos sor számának javítása egyszerre kétszer",
  { skip: gate.mode === "skip" },
  () => {
    let rowId = "";
    let userId = "";

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      ({ id: userId } = await prisma.user.create({
        data: { email: EMAIL, displayName: "Javító", role: "OWNER" },
        select: { id: true },
      }));
      ({ id: rowId } = await prisma.incomingBillingDocument.create({
        data: {
          source: "MAILBOX",
          externalId: EXTERNAL,
          feedMessageId: EXTERNAL,
          feedReceivedAt: new Date("2026-11-10T08:00:00Z"),
          kindCode: "MB",
          documentNumber: "LOCK-IT-0001",
          electronic: false,
          issueDate: new Date("2026-11-10T00:00:00Z"),
          currency: "EUR",
          supplierName: "Kitalált GmbH",
          supplierEuTaxNumber: "ATU00000001",
          buyerName: "Acropora Kft.",
          netAmount: new Prisma.Decimal(100),
          vatAmount: new Prisma.Decimal(0),
          grossAmount: new Prisma.Decimal(100),
          lines: [],
          vatSummary: [],
          payments: [],
          paymentsKnown: false,
          paidAmount: new Prisma.Decimal(0),
          hasPdf: false,
        },
        select: { id: true },
      }));
    });

    after(removeLeftovers);

    it("waits on the row for a correction in flight, so its audit names the number it really replaced", async () => {
      // A DETERMINISTIC RACE: a first correction holds the row (it has written the new number and not committed yet)
      // while the second starts. Without the row lock the second reads the committed old number and logs it as `from`.
      let second: Promise<unknown> | undefined;
      await prisma.$transaction(
        async (tx) => {
          const row = await tx.incomingBillingDocument.findUniqueOrThrow({
            where: { id: rowId },
            select: {
              documentNumber: true,
              supplierTaxNumber: true,
              supplierEuTaxNumber: true,
              supplierName: true,
            },
          });
          await lockIncomingKeys(tx, [
            row,
            { ...row, documentNumber: "LOCK-IT-0002" },
          ]);
          await tx.incomingBillingDocument.update({
            where: { id: rowId },
            data: { documentNumber: "LOCK-IT-0002" },
          });
          second = correctIncomingNumber(prisma, {
            rowId,
            documentNumber: "LOCK-IT-0003",
            issueDate: new Date("2026-11-10T00:00:00Z"),
            userId,
          });
          // long enough for the second to have read (or to be waiting on the row) before this commits
          await new Promise((resolve) => setTimeout(resolve, 700));
        },
        { timeout: 15_000 },
      );
      await second;
      const audits = await prisma.auditLog.findMany({
        where: { entityId: rowId, action: "billing.incoming-number.corrected" },
        select: { metadata: true },
      });
      assert.equal(audits.length, 1);
      const metadata = audits[0]!.metadata as {
        from: { documentNumber: string };
        to: { documentNumber: string };
      };
      assert.deepEqual(
        [metadata.from.documentNumber, metadata.to.documentNumber],
        ["LOCK-IT-0002", "LOCK-IT-0003"],
      );
      const stored = await prisma.incomingBillingDocument.findUniqueOrThrow({
        where: { id: rowId },
        select: { documentNumber: true },
      });
      assert.equal(stored.documentNumber, "LOCK-IT-0003");
    });
  },
);
