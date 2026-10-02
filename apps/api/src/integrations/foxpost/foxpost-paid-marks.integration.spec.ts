import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { loadFoxpostSettlements } from "./foxpost-paid-marks.dry-run.js";

const gate = integrationDatabaseGate(process.env);
const MARK = "foxpost-paid-marks-it";
const ACCOUNT = "9999000077776666";
const D = (value: number) => new Prisma.Decimal(value);

async function removeLeftovers() {
  await prisma.bankTransaction.deleteMany({
    where: { transactionKey: { startsWith: MARK } },
  });
  await prisma.bankStatementImport.deleteMany({ where: { fileName: MARK } });
  await prisma.bankAccount.deleteMany({ where: { accountNumber: ACCOUNT } });
  await prisma.foxpostSettlement.deleteMany({
    where: { gmailMessageId: { startsWith: MARK } },
  });
  await prisma.externalBillingDocument.deleteMany({
    where: { customerName: MARK },
  });
}

/*
  A FOXPOST SZÁRAZ FUTÁS BEMENETE AZ ADATBÁZISBÓL (acrobot 25993, 26087). MI PIROSÍT:
  ha egy olvasásnál elbukott elszámolás csendben kimaradna;
  ha a 99H3 elszámoláshoz a 99H35 jóváírása is jönne (a kód utáni szóköz); ha
  a sor rendelésszáma vagy számlaszáma nem hozná a hozzá tartozó kimenő
  számlát; ha a még nem újravetített (null) számla ismert kifizetésűnek
  számítana.
*/
describe(
  "the Foxpost paid marks dry run reads",
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
      const credit = (key: string, amount: number, narrative: string) =>
        prisma.bankTransaction.create({
          data: {
            bankAccountId: account.id,
            importId: imported.id,
            direction: "CREDIT",
            amount: D(amount),
            currency: "HUF",
            bookingDate: new Date("2099-09-23T00:00:00Z"),
            counterpartyName: "FoxPost Kft.",
            narrative,
            transactionKey: `${MARK}-${key}`,
          },
        });
      await credit("h3", 8000, "FOXPOST 99H3 W0166840");
      await credit("h35", 8000, "FOXPOST 99H35 W0166840");
      const bytes = (text: string) => new Uint8Array(Buffer.from(text));
      await prisma.foxpostSettlement.create({
        data: {
          gmailMessageId: `${MARK}-1`,
          xlsxAttachmentId: "x",
          xlsxFileName: "x.xlsx",
          xlsxContent: bytes("xlsx"),
          xlsxSha256: `${MARK}-xlsx`,
          pdfAttachmentId: "p",
          pdfFileName: "p.pdf",
          pdfContent: bytes("pdf"),
          pdfSha256: `${MARK}-pdf`,
          partnerCode: "W0166840",
          settlementCode: "99H3",
          periodStart: new Date("2099-09-15T00:00:00Z"),
          periodEnd: new Date("2099-09-21T00:00:00Z"),
          collectedAmount: D(12000),
          invoiceGrossAmount: D(4000),
          transferredAmount: D(8000),
          status: "COMPLETED",
          lines: {
            create: [
              ["99999-000001", 7000],
              [`${MARK}/0002`, 5000],
            ].map(([referenceCode, amount], index) => ({
              sourceRowNumber: index + 1,
              referenceCode: referenceCode as string,
              transactionDate: new Date("2099-09-16T00:00:00Z"),
              collectedAmount: D(amount as number),
              status: "ORDER_NOT_FOUND" as const,
            })),
          },
        },
      });
      // egy olvasásnál elbukott hét: kód és időszak nélkül, csak a fájlnév
      await prisma.foxpostSettlement.create({
        data: {
          gmailMessageId: `${MARK}-2`,
          xlsxAttachmentId: "x2",
          xlsxFileName: "FOXPOST_W0166840_99H39_Acropora Kft..xlsx",
          xlsxContent: bytes("xlsx2"),
          xlsxSha256: `${MARK}-xlsx2`,
          pdfAttachmentId: "p2",
          pdfFileName: "p2.pdf",
          pdfContent: bytes("pdf2"),
          pdfSha256: `${MARK}-pdf2`,
          status: "ERROR",
          errorCode: "FOXPOST_TRANSFER_TOTAL_MISMATCH",
        },
      });
      const document = (
        externalId: string,
        documentNumber: string,
        orderNumber: string | null,
        gross: number,
        paymentsKnown: boolean | null,
      ) =>
        prisma.externalBillingDocument.create({
          data: {
            externalId,
            documentNumber,
            orderNumber,
            feedMessageId: `${MARK}-${externalId}`,
            feedReceivedAt: new Date("2099-09-16T10:00:00Z"),
            kindCode: "SZ",
            electronic: true,
            issueDate: new Date("2099-09-15T00:00:00Z"),
            currency: "HUF",
            customerName: MARK,
            netAmount: D(gross),
            vatAmount: D(0),
            grossAmount: D(gross),
            lines: [],
            paymentsKnown,
          },
        });
      await document("9981", `${MARK}/0001`, "99999-000001", 7000, false);
      await document("9982", `${MARK}/0002`, null, 5000, null);
    });

    after(async () => {
      if (gate.mode === "run") await removeLeftovers();
    });

    it("a settlement that failed to read is listed by its file's week, with its error", async () => {
      const failed = (await loadFoxpostSettlements("2000-01-01")).find(
        (s) => s.settlement.settlementCode === "99H39",
      );
      assert.ok(failed);
      assert.deepEqual(
        [failed.settlement.status, failed.settlement.errorCode, failed.credits],
        ["ERROR", "FOXPOST_TRANSFER_TOTAL_MISMATCH", []],
      );
    });

    it("the settlement's own credit, and the invoices by order number and by invoice number", async () => {
      const loaded = (await loadFoxpostSettlements("2099-09-01")).find(
        (s) => s.settlement.settlementCode === "99H3",
      );
      assert.ok(loaded);
      assert.deepEqual(
        loaded.credits.map((c) => [c.amount.toFixed(0), c.bookingDate]),
        [["8000", "2099-09-23"]],
      );
      assert.deepEqual(
        loaded.candidates
          .filter((c) => c.invoiceNumber.startsWith(MARK))
          .map((c) => [c.invoiceNumber, c.orderNumber])
          .sort(),
        [
          [`${MARK}/0001`, "99999-000001"],
          [`${MARK}/0002`, null],
        ],
      );
      assert.deepEqual(
        [`${MARK}/0001`, `${MARK}/0002`].map(
          (n) => loaded.invoices.get(n)?.paymentsKnown,
        ),
        [true, false],
      );
    });
  },
);
