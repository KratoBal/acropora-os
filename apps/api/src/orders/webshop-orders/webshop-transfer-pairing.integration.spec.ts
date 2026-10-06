import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { loadTransferPairing } from "./webshop-transfer-pairing.dry-run.js";

/**
 * AZ ELŐRE UTALÁS PRÓBAFUTÁSA VALÓDI ADATBÁZISON (bb3a6bd5). MI PIROSÍT: a
 * kifizetettnek jelölt díjbekérő is a listán van; egy már párosított
 * jóváírás újra párosul; a terhelés vagy a díjbekérő előtti utalás fizet; a
 * futás bármit ír.
 */
const gate = integrationDatabaseGate(process.env);
const ACCOUNT = "9999000033334444";
const PREFIX = "D-ITPAIR-";
const ORDER = "order_itpair_";

async function removeLeftovers() {
  await prisma.bankTransaction.deleteMany({
    where: { bankAccount: { accountNumber: ACCOUNT } },
  });
  await prisma.bankStatementImport.deleteMany({
    where: { fileName: "webshop-transfer-pairing-it" },
  });
  await prisma.bankAccount.deleteMany({ where: { accountNumber: ACCOUNT } });
  await prisma.invoice.deleteMany({
    where: { invoiceNumber: { startsWith: PREFIX } },
  });
}

describe("the transfer pairing dry run", { skip: gate.mode === "skip" }, () => {
  before(async () => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
    await removeLeftovers();
    const proforma = (n: number, isPaid = false) =>
      prisma.invoice.create({
        data: {
          direction: "OUTBOUND",
          source: "MANUAL",
          partnerName: "Kitalalt Vevo",
          invoiceNumber: `${PREFIX}${n}`,
          documentType: "PROFORMA",
          status: "ISSUED",
          sourceType: "WEBSHOP_ORDER",
          sourceId: `${ORDER}${n}`,
          grossAmount: new Prisma.Decimal("4800"),
          currency: "HUF",
          isPaid,
          createdAt: new Date("2026-10-05T09:00:00Z"),
        },
      });
    await proforma(1);
    await proforma(2);
    await proforma(3, true);
    await proforma(4);
    const account = await prisma.bankAccount.create({
      data: { accountNumber: ACCOUNT, currency: "HUF" },
    });
    const statement = await prisma.bankStatementImport.create({
      data: {
        fileName: "webshop-transfer-pairing-it",
        sha256: "0".repeat(64),
        rowCount: 5,
        createdCount: 5,
        skippedCount: 0,
        rejectedCount: 0,
      },
    });
    const transfer = (
      key: string,
      narrative: string,
      over: Partial<Prisma.BankTransactionUncheckedCreateInput> = {},
    ) =>
      prisma.bankTransaction.create({
        data: {
          bankAccountId: account.id,
          importId: statement.id,
          direction: "CREDIT",
          amount: new Prisma.Decimal("4800"),
          currency: "HUF",
          bookingDate: new Date("2026-10-06T00:00:00Z"),
          narrative,
          transactionKey: `itpair-${key}`,
          ...over,
        },
      });
    await transfer("t1", `${PREFIX}1 Teszt Elek`);
    // a 2-es díjbekérőre csak terhelés és a kiállítás előtti utalás szól
    await transfer("t2", `${PREFIX}2`, { direction: "DEBIT" });
    await transfer("t3", `${PREFIX}2`, {
      bookingDate: new Date("2026-10-01T00:00:00Z"),
    });
    // a kifizetettre hivatkozó utalás: a díjbekérő nincs a listán
    await transfer("t4", `${PREFIX}3`);
    // a 4-esre szóló utalás már párosítva van valamihez
    const matched = await transfer("t5", `${PREFIX}4`);
    await prisma.bankTransactionMatch.create({
      data: {
        bankTransactionId: matched.id,
        documentSource: "ITPAIR",
        documentId: "itpair-doc",
      },
    });
  });

  after(async () => {
    if (gate.mode !== "run") return;
    await removeLeftovers();
    nincsMaradek([
      {
        nev: "Invoice by number prefix",
        darab: await prisma.invoice.count({
          where: { invoiceNumber: { startsWith: PREFIX } },
        }),
      },
      {
        nev: "BankAccount of the suite",
        darab: await prisma.bankAccount.count({
          where: { accountNumber: ACCOUNT },
        }),
      },
    ]);
  });

  it("pairs only an unpaid proforma, with an unmatched credit from its day on, and writes nothing", async () => {
    const before = await prisma.bankTransactionMatch.count();
    const rows = (await loadTransferPairing()).filter((row) =>
      row.orderId.startsWith(ORDER),
    );
    assert.deepEqual(
      rows.map((row) => [row.orderId, row.decision.kind]).sort(),
      [
        [`${ORDER}1`, "paired"],
        [`${ORDER}2`, "none"],
        [`${ORDER}4`, "none"],
      ],
    );
    const paired = rows.find((row) => row.orderId === `${ORDER}1`)!;
    assert.deepEqual(
      paired.transactions.map((t) => [t.bookingDate, t.narrative]),
      [["2026-10-06", `${PREFIX}1 Teszt Elek`]],
    );
    assert.equal(await prisma.bankTransactionMatch.count(), before);
  });
});
