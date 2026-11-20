import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { loadSetOffPayments } from "./incoming-set-off.loader.js";

const gate = integrationDatabaseGate(process.env);
const MARK = "set-off-it";
const ACCOUNT = "9999000066665555";
const FX_DAY = "2099-04-09";
const GLS_DAY = "2099-04-14";
const FX_CODE = "IT-SETOFF-1";
const D = (value: number) => new Prisma.Decimal(value);
const at = (day: string) => new Date(`${day}T00:00:00Z`);

async function removeLeftovers() {
  await prisma.bankTransaction.deleteMany({
    where: { transactionKey: { startsWith: MARK } },
  });
  await prisma.bankStatementImport.deleteMany({ where: { fileName: MARK } });
  await prisma.bankAccount.deleteMany({ where: { accountNumber: ACCOUNT } });
  await prisma.foxpostSettlement.deleteMany({
    where: { gmailMessageId: { startsWith: MARK } },
  });
  await prisma.glsCompensationLetter.deleteMany({
    where: { fileName: MARK },
  });
  await prisma.glsCodReport.deleteMany({ where: { fileName: MARK } });
}

const row = (documentNumber: string, gross: number) => ({
  documentNumber,
  grossAmount: D(gross),
  currency: "HUF",
});

/*
  A FUTÁR LEVONÁSÁNAK OLVASÓJA AZ ADATBÁZISBÓL (a tiszta szabály a `incoming-set-off.spec.ts`-ben áll). MI PIROSÍT: ha az olvasó nem a számla számára kérdezne
  rá az elszámolásra, illetve a levél hivatkozásaira; ha a Foxpost jóváírását nem a közleményben álló elszámolási kód, a GLS-ét nem a nap és az `COD-` előtag
  választaná ki; ha a másik elszámolás jóváírása (más kód) vagy egy másik napé beleszámítana; ha a duplikátumnak jelölt jóváírás is számítana; ha az
  elszámolás sorainak összege nem a tárolt sorokból jönne.
*/
describe(
  "the set-off payments are read from the stored settlements",
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
          rowCount: 6,
          createdCount: 6,
          skippedCount: 0,
          rejectedCount: 0,
        },
      });
      const credit = (
        key: string,
        day: string,
        amount: number,
        narrative: string,
        duplicate = false,
      ) =>
        prisma.bankTransaction.create({
          data: {
            bankAccountId: account.id,
            importId: imported.id,
            direction: "CREDIT",
            amount: D(amount),
            currency: "HUF",
            bookingDate: at(day),
            narrative,
            transactionKey: `${MARK}-${key}`,
            duplicateMarkedAt: duplicate ? new Date() : null,
          },
        });
      await credit("fx", FX_DAY, 94338, `FOXPOST ${FX_CODE}`);
      // másik elszámolás ugyanakkora jóváírása: nem ennek az elszámolásnak a párja
      await credit("fx-other", FX_DAY, 94338, "FOXPOST IT-SETOFF-OTHER");
      await credit(
        "gls",
        GLS_DAY,
        160880,
        "COD-2099.04.14/Közv.futárpostai szolg. ellenérték",
      );
      // ugyanaznap, ugyanakkora, de nem a GLS utánvét-utalása
      await credit("gls-other", GLS_DAY, 160880, "Visszautalás 2099/0414");
      // a lenti Foxpost-elszámolás (ketto) jóváírása duplikátumnak jelölt
      await credit("fx-dup", FX_DAY, 50000, "FOXPOST IT-SETOFF-2", true);

      await prisma.foxpostSettlement.create({
        data: {
          gmailMessageId: `${MARK}-fx`,
          xlsxAttachmentId: `${MARK}-x`,
          xlsxFileName: "elszamolas.xlsx",
          xlsxContent: new Uint8Array(Buffer.from("PK")),
          xlsxSha256: `${MARK}-xlsx`,
          pdfAttachmentId: `${MARK}-p`,
          pdfFileName: "elszamolas.pdf",
          pdfContent: new Uint8Array(Buffer.from("%PDF-")),
          pdfSha256: `${MARK}-pdf`,
          settlementCode: FX_CODE,
          partnerCode: MARK,
          invoiceNumber: "IT-FX-0001",
          currency: "HUF",
          collectedAmount: D(102141),
          invoiceGrossAmount: D(7803),
          transferredAmount: D(94338),
          status: "COMPLETED",
          lines: {
            create: [
              [1, 50000],
              [2, 52141],
            ].map(([rowNumber, amount]) => ({
              sourceRowNumber: rowNumber!,
              referenceCode: `${MARK}-${rowNumber}`,
              transactionDate: at(FX_DAY),
              collectedAmount: D(amount!),
              status: "MATCHED" as const,
            })),
          },
        },
      });
      // a második elszámolás: csak duplikátumnak jelölt jóváírása van
      await prisma.foxpostSettlement.create({
        data: {
          gmailMessageId: `${MARK}-fx2`,
          xlsxAttachmentId: `${MARK}-x2`,
          xlsxFileName: "elszamolas2.xlsx",
          xlsxContent: new Uint8Array(Buffer.from("PK")),
          xlsxSha256: `${MARK}-xlsx2`,
          pdfAttachmentId: `${MARK}-p2`,
          pdfFileName: "elszamolas2.pdf",
          pdfContent: new Uint8Array(Buffer.from("%PDF-")),
          pdfSha256: `${MARK}-pdf2`,
          settlementCode: "IT-SETOFF-2",
          partnerCode: MARK,
          invoiceNumber: "IT-FX-0002",
          currency: "HUF",
          collectedAmount: D(55000),
          invoiceGrossAmount: D(5000),
          transferredAmount: D(50000),
          status: "COMPLETED",
          lines: {
            create: [
              {
                sourceRowNumber: 1,
                referenceCode: `${MARK}-b1`,
                transactionDate: at(FX_DAY),
                collectedAmount: D(55000),
                status: "MATCHED" as const,
              },
            ],
          },
        },
      });

      await prisma.glsCodReport.create({
        data: {
          fileName: MARK,
          sha256: `${MARK}-report`,
          contentKey: `${MARK}-report`,
          content: new Uint8Array(Buffer.from("xlsx")),
          transferDate: at(GLS_DAY),
          total: D(160880),
          lineCount: 1,
          status: "COMPLETED",
        },
      });
      await prisma.glsCompensationLetter.create({
        data: {
          compensationDate: at(GLS_DAY),
          clientNumber: MARK,
          cod: D(166880),
          compensated: D(6000),
          transferred: D(160880),
          debt: D(6000),
          remaining: D(0),
          references: ["HU99000001", "HU99000002"],
          fileName: MARK,
          sha256: `${MARK}-letter`,
          content: new Uint8Array(Buffer.from("pdf")),
        },
      });
    });

    after(async () => {
      if (gate.mode === "run") await removeLeftovers();
    });

    it("marks the Foxpost fee invoice paid on the day of the credit named by the settlement code", async () => {
      const found = await loadSetOffPayments([row("IT-FX-0001", 7803)]);
      assert.deepEqual(found.get("IT-FX-0001"), {
        day: FX_DAY,
        carrier: "FOXPOST",
        reference: FX_CODE,
      });
    });

    it("does not count a credit marked as a duplicate", async () => {
      const found = await loadSetOffPayments([row("IT-FX-0002", 5000)]);
      assert.equal(found.size, 0);
    });

    it("marks every invoice of the GLS letter paid on the compensation day", async () => {
      const found = await loadSetOffPayments([
        row("HU99000001", 2000),
        row("HU99000002", 4000),
        row("HU99000003", 1000),
      ]);
      assert.deepEqual([...found.keys()].sort(), ["HU99000001", "HU99000002"]);
      assert.equal(found.get("HU99000001")?.day, GLS_DAY);
      assert.equal(found.get("HU99000001")?.carrier, "GLS");
    });

    it("leaves the letter alone when one referenced invoice is not among the given rows", async () => {
      // a levél két számlát nevez meg, a másik ismeretlen: a beszámítás nem bizonyított
      const found = await loadSetOffPayments([row("HU99000001", 2000)]);
      assert.equal(found.size, 0);
    });

    it("reads nothing for numbers no settlement names", async () => {
      assert.equal((await loadSetOffPayments([])).size, 0);
      assert.equal(
        (await loadSetOffPayments([row("MAS-SZAMLA-1", 100)])).size,
        0,
      );
    });
  },
);
