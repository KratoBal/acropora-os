import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { decideGlsTransfer } from "./gls-cod-paid-marks.js";
import {
  dryRunReport,
  loadGlsTransfers,
} from "./gls-cod-paid-marks.dry-run.js";

const gate = integrationDatabaseGate(process.env);
const MARK = "gls-paid-marks-it";
const ACCOUNT = "9999000077778888";
const DAY = "2099-03-17";
const D = (value: number) => new Prisma.Decimal(value);

async function removeLeftovers() {
  await prisma.bankTransaction.deleteMany({
    where: { transactionKey: { startsWith: MARK } },
  });
  await prisma.bankStatementImport.deleteMany({ where: { fileName: MARK } });
  await prisma.bankAccount.deleteMany({ where: { accountNumber: ACCOUNT } });
  await prisma.glsCodReport.deleteMany({ where: { fileName: MARK } });
  await prisma.externalBillingDocument.deleteMany({
    where: { externalId: { startsWith: "99" }, customerName: MARK },
  });
}

/*
  A SZÁRAZ FUTÁS BEMENETE AZ ADATBÁZISBÓL (plan, slice 2). MI PIROSÍT: ha egy
  más közleményű, ugyanakkora jóváírás is GLS-utalásnak számítana; ha a még nem
  újravetített (null) számla ismert kifizetésűnek, vagy a vetített, elem nélküli
  ismeretlennek számítana; ha a sorok vagy a számlák nem a tárolt adatból jönnének.
*/
describe(
  "the GLS paid marks dry run reads",
  { skip: gate.mode === "skip" },
  () => {
    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      const account = await prisma.bankAccount.create({
        data: { accountNumber: ACCOUNT, currency: "HUF" },
      });
      const imported = await prisma.bankStatementImport.create({
        data: {
          fileName: MARK,
          sha256: MARK,
          rowCount: 2,
          createdCount: 2,
          skippedCount: 0,
          rejectedCount: 0,
        },
      });
      const credit = (key: string, narrative: string) =>
        prisma.bankTransaction.create({
          data: {
            bankAccountId: account.id,
            importId: imported.id,
            direction: "CREDIT",
            amount: D(160880),
            currency: "HUF",
            bookingDate: new Date(`${DAY}T00:00:00Z`),
            counterpartyName: "GLS GENERAL LOG.SYSTEMS HUNG.CSO",
            narrative,
            transactionKey: `${MARK}-${key}`,
          },
        });
      await credit("cod", "COD-2099.03.17/Közv.futárpostai szolg. ellenérték");
      // ugyanakkora, ugyanaznap, de nem a GLS utánvét-utalása
      await credit("other", "Visszautalás 2099/0317");
      await prisma.glsCodReport.create({
        data: {
          fileName: MARK,
          sha256: MARK,
          contentKey: MARK,
          content: new Uint8Array(Buffer.from("xlsx")),
          transferDate: new Date(`${DAY}T00:00:00Z`),
          total: D(160880),
          lineCount: 3,
          status: "COMPLETED",
          lines: {
            create: [
              ["IT-99/00479", 27450],
              ["IT-99/00485", 27600],
              ["IT-99/00481", 105830],
            ].map(([number, amount], index) => ({
              rowNumber: index + 1,
              parcelNumber: `${MARK}-${index}`,
              amount: D(amount as number),
              invoiceNumbers: [number as string],
              status: "RESOLVED" as const,
            })),
          },
        },
      });
      const document = (
        externalId: string,
        documentNumber: string,
        gross: number,
        paymentsKnown: boolean | null,
        paid: number,
      ) =>
        prisma.externalBillingDocument.create({
          data: {
            externalId,
            documentNumber,
            feedMessageId: `${MARK}-${externalId}`,
            feedReceivedAt: new Date(`${DAY}T10:00:00Z`),
            kindCode: "SZ",
            electronic: true,
            issueDate: new Date("2099-03-01T00:00:00Z"),
            currency: "HUF",
            customerName: MARK,
            netAmount: D(gross),
            vatAmount: D(0),
            grossAmount: D(gross),
            lines: [],
            paymentsKnown,
            paidAmount: D(paid),
          },
        });
      // vetítve, elem nélkül: nem fizetett
      await document("9901", "IT-99/00479", 27450, false, 0);
      // még nem újravetítve: nem bizonyítható, hogy nincs fizetve
      await document("9902", "IT-99/00485", 27600, null, 0);
      // vetítve, a Számlázz.hu saját banki párosítása már rögzítette
      await document("9903", "IT-99/00481", 105831, true, 105831);
    });

    after(async () => {
      if (gate.mode === "run") await removeLeftovers();
    });

    it("the day's COD credit by its narrative, the lines, and the invoices with what is known of their payments", async () => {
      const transfer = (await loadGlsTransfers("2099-03-01")).find(
        (t) => t.report.transferDate === DAY,
      );
      assert.ok(transfer);
      assert.equal(transfer.credits.length, 1);
      assert.deepEqual(
        transfer.report.lines.map((l) => l.invoiceNumbers[0]),
        ["IT-99/00479", "IT-99/00485", "IT-99/00481"],
      );
      assert.deepEqual(
        ["IT-99/00479", "IT-99/00485", "IT-99/00481"].map(
          (n) => transfer.invoices.get(n)?.paymentsKnown,
        ),
        [true, false, true],
      );
      const report = dryRunReport([decideGlsTransfer(transfer)]);
      assert.match(report, /IT-99\/00479\t27450 Ft\t2099-03-17\tutánvét/);
      assert.match(
        report,
        /IT-99\/00485\tkimarad: a kifizetései még nem ismertek/,
      );
      assert.match(report, /IT-99\/00481\tkimarad: már kifizetett/);
      assert.match(report, /összesen: 1 számla jelölhető, 1 utalásból/);
    });
  },
);
