import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";
import PDFKitDocument from "pdfkit";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { registerEmbeddedPdfFont } from "../documents/pdf/branded-document.js";
import { pdfTextLines } from "../purchasing/supplier-invoice-import/pdf-text-lines.js";
import type { FillPlan } from "./supplier-bank-account-fill.js";
import {
  planSupplierFills,
  writeFills,
} from "./supplier-bank-account-fill.loader.js";

const gate = integrationDatabaseGate(process.env);
const NAME = "FILL-IT";
const ACCOUNT_NUMBER = "9999000055554444";
const D = (value: number) => new Prisma.Decimal(value);
const day = (value: string) => new Date(`${value}T00:00:00Z`);
const TAX = (n: number) => `9910000${n}-2-13`;
const KEY = (n: number) => `hu:9910000${n}`;

async function removeLeftovers() {
  await prisma.bankTransaction.deleteMany({
    where: { transactionKey: { startsWith: "fill-it" } },
  });
  await prisma.bankStatementImport.deleteMany({
    where: { fileName: "fill-it" },
  });
  await prisma.bankAccount.deleteMany({
    where: { accountNumber: ACCOUNT_NUMBER },
  });
  await prisma.navIncomingInvoice.deleteMany({
    where: { supplierName: { startsWith: NAME } },
  });
  await prisma.supplierBankAccountFill.deleteMany({
    where: { supplierKey: { startsWith: "hu:9910000" } },
  });
  await prisma.incomingBillingDocument.deleteMany({
    where: { supplierName: { startsWith: NAME } },
  });
  await prisma.incomingSupplierDocument.deleteMany({
    where: { gmailMessageId: { startsWith: "fill-it" } },
  });
  await prisma.supplier.deleteMany({
    where: { code: { startsWith: "FILLIT" } },
  });
}

function invoicePdf(accountLine: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFKitDocument({ size: "A4", margin: 40 });
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    registerEmbeddedPdfFont(doc);
    doc
      .fontSize(10)
      .text("Példa szállító számlája", 40, 40, { lineBreak: false });
    doc.text("Bankszámlaszám:", 40, 200, { lineBreak: false });
    doc.text(accountLine, 160, 200, { lineBreak: false });
    doc.end();
  });
}

const billingRow = (
  id: string,
  supplier: number,
  over: {
    supplierBankAccount?: string | null;
    noTax?: boolean;
    sourceDocumentId?: string;
  } = {},
) => ({
  source: "SZAMLAZZ",
  externalId: `fill-it-${id}`,
  feedMessageId: `fill-it-${id}`,
  feedReceivedAt: day("2099-04-01"),
  kindCode: "SZ",
  documentNumber: `FILLIT-${id}`,
  electronic: true,
  issueDate: day("2099-04-01"),
  currency: "HUF",
  supplierName: `${NAME} ${supplier}`,
  supplierTaxNumber: over.noTax ? null : TAX(supplier),
  sourceDocumentId: over.sourceDocumentId ?? null,
  supplierBankAccount: over.supplierBankAccount ?? null,
  buyerName: "Acropora Kft.",
  netAmount: 100,
  vatAmount: 27,
  grossAmount: 127,
  lines: [],
  vatSummary: [],
  payments: [],
  paymentsKnown: false,
  paidAmount: 0,
});

const pdfDocument = async (id: string, supplier: number, accountLine: string) =>
  prisma.incomingSupplierDocument.create({
    data: {
      gmailMessageId: `fill-it-${id}`,
      fileName: `${id}.pdf`,
      sizeBytes: 1,
      sha256: `fill-it-${id}`,
      content: new Uint8Array(await invoicePdf(accountLine)),
      status: "READ",
      origin: "COLLECTED_MAIL",
      textReading: {
        invoiceNumber: `FILLIT-${id}`,
        supplierTaxNumber: TAX(supplier),
      },
    },
    select: { id: true },
  });

/*
  A SZÁLLÍTÓI BANKSZÁMLASZÁM KITÖLTÉSE AZ ADATBÁZISBÓL (acrobot 58553; a döntés tiszta, ez az olvasó és az író). MI PIROSÍT: ha a számla PDF-jéből nem olvasódna a számlaszám; ha a már
  meglévő számlaszám (a szállító másik során, a szállító-törzsben, egy korábbi kitöltésben) nem tartana vissza az írástól; ha két különböző PDF-es számlaszám nem ellentmondás lenne; ha a
  NAV-számlához párosított terhelés partner-számlaszáma nem forrás lenne; ha az írás felülírna egy meglévő kitöltést; ha a második futás újat írna.
*/
describe(
  "the supplier bank account fill reads and writes the database",
  { skip: gate.mode === "skip" },
  () => {
    const ids: Record<string, string> = {};
    const readers = { lines: (content: Uint8Array) => pdfTextLines(content) };
    const mine = (plan: FillPlan): FillPlan => ({
      ...plan,
      rows: plan.rows.filter(
        (row) =>
          row.supplier.key.startsWith("hu:9910000") ||
          row.supplier.key === "name:fill-it 8",
      ),
    });
    const verdictOf = (plan: FillPlan, n: number) =>
      plan.rows.find((row) => row.supplier.key === KEY(n))?.verdict;

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      // 8: csak a NÉV azonosítja a szállítót (nincs adószám), a sor saját PDF-jében van számlaszám
      ids.g = (await pdfDocument("g1", 8, "11773016-11111018-00000000")).id;
      // 1: két célsor, egy PDF a számlaszámmal
      await prisma.incomingBillingDocument.createMany({
        data: [
          billingRow("a1", 1),
          billingRow("a2", 1),
          // 2: egy célsor, és a szállító MÁSIK során már áll számlaszám
          billingRow("b1", 2),
          billingRow("b2", 2, { supplierBankAccount: "10918001-00000017" }),
          // 3: két célsor, két különböző számlaszám a két PDF-ben
          billingRow("c1", 3),
          billingRow("c2", 3),
          // 4: a PDF nélküli célsor, a számlaszám egy korábbi, NAV-számlához párosított terhelésből
          billingRow("d1", 4),
          // 5: már van kitöltés
          billingRow("e1", 5),
          // 6: a szállító-törzsben van számlaszám
          billingRow("f1", 6),
          // 7: egyetlen NAV-párosított terhelés, PDF nélkül
          billingRow("h1", 7),
          // 8: név-kulcsú szállító
          billingRow("g1", 8, { noTax: true, sourceDocumentId: ids.g }),
        ].map((row, index) => ({ ...row, externalId: `fill-it-row-${index}` })),
      });
      ids.a = (await pdfDocument("a1", 1, "11773016-11111018-00000000")).id;
      ids.c1 = (await pdfDocument("c1", 3, "11773016-11111018-00000000")).id;
      ids.c2 = (await pdfDocument("c2", 3, "10918001-00000017")).id;
      // a 4-es szállító: KÉT NAV-számla, mindkettőhöz párosított terhelés; a 7-es szállítónak egy
      const account = await prisma.bankAccount.create({
        data: { accountNumber: ACCOUNT_NUMBER, currency: "HUF" },
      });
      const imported = await prisma.bankStatementImport.create({
        data: {
          fileName: "fill-it",
          sha256: "fill-it",
          rowCount: 3,
          createdCount: 3,
          skippedCount: 0,
          rejectedCount: 0,
        },
      });
      const paired = async (supplier: number, key: string) => {
        const nav = await prisma.navIncomingInvoice.create({
          data: {
            navInvoiceNumber: `FILLIT-NAV-${key}`,
            supplierTaxNumber: TAX(supplier),
            supplierName: `${NAME} ${supplier}`,
            invoiceIssueDate: day("2099-03-01"),
            insDate: new Date("2099-03-01T08:00:00Z"),
            invoiceNetAmount: 1000,
            invoiceVatAmount: 270,
          },
          select: { id: true },
        });
        const debit = await prisma.bankTransaction.create({
          data: {
            bankAccountId: account.id,
            importId: imported.id,
            direction: "DEBIT",
            amount: D(1270),
            currency: "HUF",
            bookingDate: day("2099-03-10"),
            counterpartyAccount: "10918001-00000017",
            counterpartyName: `${NAME} ${supplier}`,
            narrative: `FILLIT-NAV-${key}`,
            transactionKey: `fill-it-debit-${key}`,
          },
          select: { id: true },
        });
        await prisma.bankTransactionMatch.create({
          data: {
            bankTransactionId: debit.id,
            documentSource: "NAV",
            documentId: nav.id,
          },
        });
        return debit.id;
      };
      ids.debit1 = await paired(4, "4a");
      ids.debit2 = await paired(4, "4b");
      ids.debit7 = await paired(7, "7a");
      await prisma.supplierBankAccountFill.create({
        data: {
          supplierKey: KEY(5),
          supplierName: `${NAME} 5`,
          supplierTaxNumber: TAX(5),
          account: "1091800100000017",
          source: "INVOICE_PDF",
          evidenceIds: ["x"],
        },
      });
      await prisma.supplier.create({
        data: {
          code: "FILLIT-6",
          name: `${NAME} 6`,
          taxNumber: TAX(6),
          bankAccountNumber: "11773016-11111018",
        },
      });
    });

    after(async () => {
      if (gate.mode === "run") await removeLeftovers();
    });

    it("reads each supplier: the PDF writes, an existing account (row, master, fill) holds back, two accounts conflict, a paired NAV debit is a source", async () => {
      const plan = mine(await planSupplierFills(prisma, readers));
      assert.deepEqual(verdictOf(plan, 1), {
        state: "WRITE",
        account: "1177301611111018",
        source: "INVOICE_PDF",
        evidenceIds: [ids.a],
      });
      assert.deepEqual(verdictOf(plan, 2), {
        state: "HAS_ACCOUNT",
        distinct: 1,
      });
      assert.deepEqual(verdictOf(plan, 3), { state: "CONFLICT", count: 2 });
      assert.deepEqual(verdictOf(plan, 4), {
        state: "WRITE",
        account: "1091800100000017",
        source: "PAIRED_DEBIT",
        evidenceIds: [ids.debit1, ids.debit2],
      });
      // 7: egyetlen terhelés PDF nélkül: tartva; 8: csak a név azonosítja: tartva, bár a PDF-ben van számlaszám
      assert.deepEqual(verdictOf(plan, 7), {
        state: "HOLD",
        reason: "SINGLE_DEBIT",
        account: "1091800100000017",
        source: "PAIRED_DEBIT",
        evidenceIds: [ids.debit7],
      });
      assert.deepEqual(
        plan.rows.find((row) => row.supplier.key === "name:fill-it 8")?.verdict,
        {
          state: "HOLD",
          reason: "NAME_KEY",
          account: "1177301611111018",
          source: "INVOICE_PDF",
          evidenceIds: [ids.g],
        },
      );
      assert.deepEqual(verdictOf(plan, 5), {
        state: "HAS_ACCOUNT",
        distinct: 1,
      });
      assert.deepEqual(verdictOf(plan, 6), {
        state: "HAS_ACCOUNT",
        distinct: 1,
      });
      assert.equal(
        plan.rows.find((row) => row.supplier.key === KEY(1))?.supplier
          .targetRows,
        2,
      );
    });

    it("writes one row per supplier, never overwrites, and a second run writes nothing new", async () => {
      const plan = mine(await planSupplierFills(prisma, readers));
      const first = await writeFills(prisma, plan);
      assert.equal(first.created, 2);
      const rows = await prisma.supplierBankAccountFill.findMany({
        where: { supplierKey: { in: [KEY(1), KEY(4)] } },
        orderBy: { supplierKey: "asc" },
      });
      assert.deepEqual(
        rows.map((row) => [
          row.supplierKey,
          row.account,
          row.source,
          row.supplierTaxNumber,
        ]),
        [
          [KEY(1), "1177301611111018", "INVOICE_PDF", TAX(1)],
          [KEY(4), "1091800100000017", "PAIRED_DEBIT", TAX(4)],
        ],
      );
      assert.equal((await writeFills(prisma, plan)).created, 0);
      // a tartott szállítók (egyetlen terhelés, név-kulcs) nem kerülnek a táblába
      assert.equal(
        await prisma.supplierBankAccountFill.count({
          where: { supplierKey: { in: [KEY(7), "name:fill-it 8"] } },
        }),
        0,
      );
      // egy másik számlaszámmal erőltetett írás a MEGLÉVŐ kitöltést nem írja felül
      const forced: FillPlan = {
        ...plan,
        rows: [
          {
            supplier: plan.rows.find((row) => row.supplier.key === KEY(1))!
              .supplier,
            verdict: {
              state: "WRITE",
              account: "1091800100000017",
              source: "PAIRED_DEBIT",
              evidenceIds: ["z"],
            },
          },
        ],
      };
      assert.equal((await writeFills(prisma, forced)).created, 0);
      assert.equal(
        (
          await prisma.supplierBankAccountFill.findUniqueOrThrow({
            where: { supplierKey: KEY(1) },
          })
        ).account,
        "1177301611111018",
      );
      // az új futás már számlaszámosnak látja őket
      const again = mine(await planSupplierFills(prisma, readers));
      assert.equal(verdictOf(again, 1)?.state, "HAS_ACCOUNT");
      assert.equal(verdictOf(again, 4)?.state, "HAS_ACCOUNT");
    });
  },
);
