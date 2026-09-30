import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { InvoiceCollectionRepository } from "./invoice-collection.repository.js";

/**
 * A BEGYŰJTŐ ÉS A VÁRHATÓ BEÉRKEZÉSEK FIGYELŐJE UGYANAZT AZ INFO@ FIÓKOT
 * OLVASSA, ugyanabba a táblába, amelynek egyedi kulcsa
 * `(gmailMessageId, fileName)`. Ha a begyűjtő a levél saját azonosítójával
 * írna, a figyelő későbbi beszúrása elhasalna, és a bevételezésből kimaradna a
 * számla. Ez a teszt ezt méri az adatbázison, nem a kódot olvasva.
 */
const gate = integrationDatabaseGate(process.env);
const MESSAGE = "collect-it-message-1";
const FILE = "SZ-IT-1.pdf";

async function removeLeftovers() {
  await prisma.invoiceCollectionItem.deleteMany({
    where: { externalId: { startsWith: "collect-it-" } },
  });
  await prisma.incomingSupplierDocument.deleteMany({
    where: {
      OR: [
        { gmailMessageId: MESSAGE },
        { gmailMessageId: { startsWith: "collect:INFO_MAIL:collect-it-" } },
      ],
    },
  });
  await prisma.invoiceCollectionRun.deleteMany({
    where: { errorCode: "COLLECT_IT" },
  });
}

describe("a számla-begyűjtés tárolása", { skip: gate.mode === "skip" }, () => {
  const repository = new InvoiceCollectionRepository();

  before(async () => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
    await removeLeftovers();
  });

  after(async () => {
    await removeLeftovers();
    nincsMaradek([
      {
        nev: "a begyűjtés teszt-dokumentuma bent maradt",
        darab: await prisma.incomingSupplierDocument.count({
          where: { gmailMessageId: { contains: "collect-it-" } },
        }),
      },
    ]);
  });

  it("stores outside the receipt chain, and the mailbox watcher can still store the same mail after it", async () => {
    const documentId = await repository.store({
      source: "INFO_MAIL",
      externalId: MESSAGE,
      fileName: FILE,
      sender: "szamla@szallito.hu",
      subject: "Számla",
      receivedAt: new Date("2026-08-05T10:00:00Z"),
      content: Buffer.from("%PDF-1.4 teszt"),
      sha256: "collect-it-sha",
      read: false,
      kind: "INVOICE",
      importResult: null,
      textReading: {
        invoiceNumber: "SZ-IT-1",
        numberFrom: "NAV",
        supplierTaxNumber: "12345678-2-42",
      },
      payee: "COMPANY",
    });
    const stored = await prisma.incomingSupplierDocument.findUniqueOrThrow({
      where: { id: documentId },
      select: { origin: true, expectedArrivalId: true, gmailMessageId: true },
    });
    assert.deepEqual(stored, {
      origin: "COLLECTED_MAIL",
      expectedArrivalId: null,
      gmailMessageId: `collect:INFO_MAIL:${MESSAGE}`,
    });
    // a figyelő a levél SAJÁT azonosítójával ír: ennek sikerülnie kell
    await prisma.incomingSupplierDocument.create({
      data: {
        gmailMessageId: MESSAGE,
        fileName: FILE,
        sizeBytes: 14,
        sha256: "collect-it-sha",
        content: new Uint8Array(Buffer.from("%PDF-1.4 teszt")),
        status: "READ",
      },
    });
    assert.deepEqual(
      await repository.seen("INFO_MAIL", [MESSAGE, "x"]),
      new Set([MESSAGE]),
    );
  });

  it("lets one run at a time", async () => {
    const first = await repository.startRun("MANUAL");
    await assert.rejects(repository.startRun("MANUAL"), /ALREADY_RUNNING/);
    await repository.finishRun(
      first,
      {
        filesSeen: 0,
        storedCount: 0,
        notInvoiceCount: 0,
        unmatchedCount: 0,
        duplicateCount: 0,
        failedCount: 0,
      },
      "COLLECT_IT",
    );
    const second = await repository.startRun("MANUAL");
    await repository.finishRun(
      second,
      {
        filesSeen: 0,
        storedCount: 0,
        notInvoiceCount: 0,
        unmatchedCount: 0,
        duplicateCount: 0,
        failedCount: 0,
      },
      "COLLECT_IT",
    );
  });
});
