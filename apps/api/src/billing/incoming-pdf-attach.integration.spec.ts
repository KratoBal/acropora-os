import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import {
  collectedPdfIds,
  loadCollectedPdfIndex,
} from "./incoming-collected-pdf.js";
import {
  ATTACH_PREFIX,
  attachedPdfIds,
  attachIncomingPdf,
} from "./incoming-pdf-attach.js";

/**
 * A CSATOLT PDF A VALÓDI ADATBÁZISON (acrobot 34672). Kitalált sor és fájl.
 * MI PIROSÍT: ha a tárolás egy oszlopon vagy egyediségen elbukik; ha a sor
 * szerinti keresés vagy a szám szerinti index nem találja meg a csatoltat.
 */
const gate = integrationDatabaseGate(process.env);
const EXTERNAL = "attach-it-1";
const EMAIL = "attach-it-actor@example.invalid";

async function removeLeftovers() {
  const rows = await prisma.incomingBillingDocument.findMany({
    where: { externalId: EXTERNAL },
    select: { id: true },
  });
  await prisma.auditLog.deleteMany({
    where: { entityId: { in: rows.map((r) => r.id) } },
  });
  for (const row of rows)
    await prisma.incomingSupplierDocument.deleteMany({
      where: { gmailMessageId: { startsWith: `${ATTACH_PREFIX}${row.id}:` } },
    });
  await prisma.incomingBillingDocument.deleteMany({
    where: { externalId: EXTERNAL },
  });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
}

describe(
  "a csatolt PDF az adatbázisban",
  { skip: gate.mode === "skip" },
  () => {
    let rowId = "";
    let userId = "";

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      ({ id: userId } = await prisma.user.create({
        data: { email: EMAIL, displayName: "Csatoló", role: "OWNER" },
        select: { id: true },
      }));
      ({ id: rowId } = await prisma.incomingBillingDocument.create({
        data: {
          source: "SZAMLAZZ",
          externalId: EXTERNAL,
          feedMessageId: EXTERNAL,
          feedReceivedAt: new Date("2026-10-15T08:00:00Z"),
          kindCode: "SZ",
          documentNumber: "ATT-2026/01452",
          electronic: true,
          issueDate: new Date("2026-10-15T00:00:00Z"),
          currency: "HUF",
          supplierName: "Kitalált Kft.",
          supplierTaxNumber: "87654321-2-13",
          buyerName: "Acropora Kft.",
          netAmount: new Prisma.Decimal(0),
          vatAmount: new Prisma.Decimal(0),
          grossAmount: new Prisma.Decimal(0),
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

    it("stored under the row: found by the row and by number and tax number", async () => {
      const { documentId } = await attachIncomingPdf(prisma, {
        rowId,
        file: {
          originalname: "kompress.pdf",
          buffer: Buffer.from("%PDF-1.4 kitalalt"),
        },
        userId,
        hasPdf: false,
      });
      assert.deepEqual((await attachedPdfIds(prisma, [rowId])).get(rowId), [
        documentId,
      ]);
      const row = await prisma.incomingBillingDocument.findUniqueOrThrow({
        where: { id: rowId },
      });
      assert.deepEqual(
        collectedPdfIds(row, await loadCollectedPdfIndex(prisma)),
        [documentId],
      );
      assert.equal(
        await prisma.auditLog.count({
          where: {
            entityId: rowId,
            action: "billing.incoming-pdf.attached",
            userId,
          },
        }),
        1,
      );
    });
  },
);
