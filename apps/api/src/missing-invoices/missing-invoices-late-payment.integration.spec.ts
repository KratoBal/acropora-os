import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";
import { PDFDocument } from "pdf-lib";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { pdfTextLines } from "../purchasing/supplier-invoice-import/pdf-text-lines.js";
import { SupplierInvoiceImportService } from "../purchasing/supplier-invoice-import/supplier-invoice-import.service.js";
import { BankStatementImportRepository } from "./bank-statement-import.repository.js";
import { BankStatementImportService } from "./bank-statement-import.service.js";
import { MissingInvoicesRepository } from "./missing-invoices.repository.js";
import { MissingInvoicesService } from "./missing-invoices.service.js";

/**
 * AZ OKTÓBERBEN TELJESÍTETT, KIFIZETETLEN, PAPÍRON MEGVAN SZÁMLA DECEMBERI
 * TERHELÉSE (Balázs kérdése, 2026-11-02 22:23 UTC; acrobot 40468).
 *
 * A két állítás, valódi adatbázison:
 *  (a) a decemberi Hiányzó számlák lapon a terhelés MEGVAN (nem hiányzik), és a
 *      papíros jelölés látszik rajta, pedig a jelölés a SZÁMLÁN áll, nem a
 *      terhelésen;
 *  (b) a decemberi csomagban a számla nem szerepel újra, az oktoberiben igen.
 *
 * A KÉT PÁROSÍTÁS, AMIBŐL A KÉSŐBBI HÓNAP TERHELÉSE A KORÁBBI SZÁMLÁHOZ KERÜL:
 *  - A számla SZÁMA a közleményben (1. szabály): nincs dátumablak, bármilyen
 *    régi számla megnevezhető;
 *  - pontos ÖSSZEG + a szállító NEVE + dátumablak (3. szabály): a számla a
 *    fizetés előtt legfeljebb 4 hónappal kelhet (inWindow), az októberi számla
 *    a decemberi fizetéshez belefér.
 *
 * MI PIROSÍT: ha a számlán álló jelölés nem látszana a terhelés tételén (vagy
 * csak a terhelésre tett jelölés látszana); ha a decemberi terhelés Hiányzik
 * maradna; ha a decemberi csomag a számlát másodszor is tartalmazná; ha az
 * októberi csomagból kimaradna; ha a jelölés nélküli társ-számla is „papíron”
 * lenne (a kontroll).
 */
const gate = integrationDatabaseGate(process.env);
const ACCOUNT = "9999000055556666";
const IMPORTER = "missing-invoices-late-it";
const SUPPLIER = "KESEIFIZETES-TESZT Kft.";
const TAX = "88888888-2-41";
const MARKED_BY_NUMBER = "KESEI-A/2026";
const MARKED_BY_AMOUNT = "KESEI-B/2026";
const UNMARKED = "KESEI-C/2026";

async function removeLeftovers() {
  await prisma.incomingBillingDocument.deleteMany({
    where: { supplierName: SUPPLIER },
  });
  await prisma.incomingSupplierDocument.deleteMany({
    where: { gmailMessageId: { startsWith: "szamlazz-feed:kesei-it-" } },
  });
  await prisma.bankTransaction.deleteMany({
    where: { bankAccount: { accountNumber: ACCOUNT } },
  });
  await prisma.bankStatementImport.deleteMany({
    where: { importedByUserId: IMPORTER },
  });
  await prisma.bankAccount.deleteMany({ where: { accountNumber: ACCOUNT } });
}

async function feedInvoice(input: {
  key: string;
  number: string;
  gross: number;
  paper: boolean;
}) {
  const source = await prisma.incomingSupplierDocument.create({
    data: {
      gmailMessageId: `szamlazz-feed:kesei-it-${input.key}`,
      fileName: `${input.key}.xml`,
      sizeBytes: 10,
      sha256: `kesei-it-${input.key}`,
      content: new Uint8Array(Buffer.from("<Szamla/>")),
      status: "READ",
      kind: "INVOICE",
      origin: "SZAMLAZZ_FEED",
      payeeCheck: "COMPANY",
      receivedAt: new Date("2026-10-22T08:00:00Z"),
      textReading: {
        invoiceNumber: input.number,
        numberFrom: null,
        supplierTaxNumber: TAX,
        supplierName: SUPPLIER,
        gross: String(input.gross),
        currency: "HUF",
      },
    },
    select: { id: true },
  });
  await prisma.incomingBillingDocument.create({
    data: {
      source: "SZAMLAZZ",
      externalId: `kesei-it-${input.key}`,
      feedMessageId: `kesei-it-${input.key}`,
      feedReceivedAt: new Date("2026-10-22T08:00:00Z"),
      kindCode: "I",
      documentNumber: input.number,
      electronic: true,
      issueDate: new Date("2026-10-22T00:00:00Z"),
      fulfillmentDate: new Date("2026-10-22T00:00:00Z"),
      dueDate: new Date("2026-12-21T00:00:00Z"),
      currency: "HUF",
      supplierName: SUPPLIER,
      supplierTaxNumber: TAX,
      buyerName: "Acropora Kft.",
      netAmount: Math.round(input.gross / 1.27),
      vatAmount: input.gross - Math.round(input.gross / 1.27),
      grossAmount: input.gross,
      lines: [],
      vatSummary: [],
      payments: [],
      paymentsKnown: false,
      paidAmount: 0,
      sourceDocumentId: source.id,
      paperOriginalAt: input.paper ? new Date("2026-10-23T09:00:00Z") : null,
    },
  });
}

describe(
  "az októberi, kifizetetlen, papíron megvan számla decemberi terhelése",
  { skip: gate.mode === "skip" },
  () => {
    const missing = new MissingInvoicesService(
      new MissingInvoicesRepository(),
      new SupplierInvoiceImportService(),
    );

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      await feedInvoice({
        key: "a",
        number: MARKED_BY_NUMBER,
        gross: 56420,
        paper: true,
      });
      await feedInvoice({
        key: "b",
        number: MARKED_BY_AMOUNT,
        gross: 12700,
        paper: true,
      });
      await feedInvoice({
        key: "c",
        number: UNMARKED,
        gross: 8890,
        paper: false,
      });
      // a decemberi fizetések: az első a számla számát írja a közleménybe (1.
      // szabály), a második csak az összeget és a nevet (3. szabály), a harmadik
      // a jelöletlen számláé, a kontroll
      await new BankStatementImportService(
        new BankStatementImportRepository(),
      ).import(
        {
          originalname: "export.csv",
          buffer: Buffer.from(
            [
              `"${ACCOUNT}";T;-56420;HUF;20261215;20261215;;;"${SUPPLIER}";"${MARKED_BY_NUMBER}";;;ÁTUTALÁS;;`,
              `"${ACCOUNT}";T;-12700;HUF;20261216;20261216;;;"${SUPPLIER}";"szamla";;;ÁTUTALÁS;;`,
              `"${ACCOUNT}";T;-8890;HUF;20261217;20261217;;;"${SUPPLIER}";"${UNMARKED}";;;ÁTUTALÁS;;`,
            ].join("\r\n"),
          ),
        },
        { id: IMPORTER } as AuthenticatedUser,
      );
    });

    after(async () => {
      await removeLeftovers();
    });

    const december = async () =>
      (await missing.month("2026-12", { tab: "ALL" })).items.filter((item) =>
        item.account.name.startsWith(ACCOUNT),
      );

    it("(a) the December debits are Megvan, and the paper mark of the invoice shows on the debit; the unmarked control does not", async () => {
      const items = await december();
      const byAmount = new Map(items.map((item) => [item.amount, item]));
      const named = byAmount.get("56420")!;
      const exact = byAmount.get("12700")!;
      const control = byAmount.get("8890")!;
      // a megnevezett számla száma a közleményben, az összeg+név ablakon belül
      assert.deepEqual(
        [
          named.state,
          named.matchedBy,
          named.document?.number,
          named.paperOriginal,
        ],
        ["FOUND", "RULE", MARKED_BY_NUMBER, true],
      );
      assert.deepEqual(
        [exact.state, exact.document?.number, exact.paperOriginal],
        ["FOUND", MARKED_BY_AMOUNT, true],
      );
      assert.deepEqual(
        [control.state, control.document?.number, control.paperOriginal],
        ["FOUND", UNMARKED, false],
      );
    });

    const coverOf = async (month: string) => {
      const { content } = await missing.accountantPackage(month);
      await PDFDocument.load(content);
      return (await pdfTextLines(new Uint8Array(content))).join(" ");
    };

    it("(b) the October package holds the invoices (paper ones as papíron megvan, the control with its PDF line), the December package none of them", async () => {
      const october = await coverOf("2026-10");
      assert.ok(
        october.includes(`${MARKED_BY_NUMBER}: papíron megvan`),
        october,
      );
      assert.ok(
        october.includes(`${MARKED_BY_AMOUNT}: papíron megvan`),
        october,
      );
      assert.ok(october.includes(UNMARKED), october);
      assert.ok(!october.includes(`${UNMARKED}: papíron megvan`), october);
      const december = await coverOf("2026-12");
      for (const number of [MARKED_BY_NUMBER, MARKED_BY_AMOUNT, UNMARKED])
        assert.ok(!december.includes(number), `${number} again in December`);
    });
  },
);
