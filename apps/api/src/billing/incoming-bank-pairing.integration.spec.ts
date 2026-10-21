import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { BankStatementImportRepository } from "../missing-invoices/bank-statement-import.repository.js";
import { BankStatementImportService } from "../missing-invoices/bank-statement-import.service.js";
import { MissingInvoicesRepository } from "../missing-invoices/missing-invoices.repository.js";
import { MissingInvoicesService } from "../missing-invoices/missing-invoices.service.js";
import { SzamlazzFeedsRepository } from "../missing-invoices/szamlazz-feeds.repository.js";
import { SupplierInvoiceImportService } from "../purchasing/supplier-invoice-import/supplier-invoice-import.service.js";
import { diagnoseUnpaired } from "./incoming-bank-diagnose.js";
import { incomingListItems } from "./purchase-incoming.js";

/**
 * A FIZETETT, DE PÁROSÍTATLANNAK LÁTSZÓ FEED-SOR (acrobot 34637, 34658). Élesben
 * 20 Számlázz.hu-sor fizetett, és a lista szerint nem párosodott a bankkal;
 * 11-hez van pontosan illő terhelés, 9-nél a közlemény maga a számlaszám
 * (AKN-2026/692 alakú). Kitalált szállító és számok, az éles alakban: a feed
 * XML-je a Hiányzó számlák forrásai között (ahogy a feed tárolja), a NAV-sor,
 * és egy terhelés, amelynek a közleménye a számlaszám.
 */
const gate = integrationDatabaseGate(process.env);
const ACCOUNT = "9999000055556666";
const IMPORTER = "incoming-bank-pairing-it";
const SUPPLIER = "PAROSITASTESZT Kft.";
const TAX = "88990011-2-41";
const NUMBER = "PRT-2026/692";
const EXTERNAL = "parositas-it-1";

async function removeLeftovers() {
  await prisma.bankTransaction.deleteMany({
    where: { bankAccount: { accountNumber: ACCOUNT } },
  });
  await prisma.bankStatementImport.deleteMany({
    where: { importedByUserId: IMPORTER },
  });
  await prisma.bankAccount.deleteMany({ where: { accountNumber: ACCOUNT } });
  await prisma.navIncomingInvoice.deleteMany({
    where: { supplierName: SUPPLIER },
  });
  await prisma.incomingBillingDocument.deleteMany({
    where: { externalId: EXTERNAL },
  });
  await prisma.incomingSupplierDocument.deleteMany({
    where: { gmailMessageId: `szamlazz:szamlabe:${EXTERNAL}` },
  });
  await prisma.szamlazzFeedMessage.deleteMany({
    where: { externalId: EXTERNAL },
  });
  await prisma.incomingSupplierDocument.deleteMany({
    where: { gmailMessageId: "collect:INFO_MAIL:parositas-it-mail" },
  });
}

describe(
  "a fizetett feed-sor banki párosítása",
  { skip: gate.mode === "skip" },
  () => {
    const missing = new MissingInvoicesService(
      new MissingInvoicesRepository(),
      new SupplierInvoiceImportService(),
    );

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      await new BankStatementImportService(
        new BankStatementImportRepository(),
      ).import(
        {
          originalname: "export.csv",
          buffer: Buffer.from(
            `"${ACCOUNT}";T;-117099;HUF;20260916;20260916;;;"${SUPPLIER}";"${NUMBER}";;;ÁTUTALÁS;;`,
          ),
        },
        { id: IMPORTER } as AuthenticatedUser,
      );
      await prisma.navIncomingInvoice.create({
        data: {
          navInvoiceNumber: NUMBER,
          supplierTaxNumber: "88990011",
          supplierName: SUPPLIER,
          invoiceIssueDate: new Date("2026-09-04T00:00:00Z"),
          currency: "HUF",
          invoiceNetAmount: 92204,
          invoiceVatAmount: 24895,
          insDate: new Date("2026-09-04T10:00:00Z"),
        },
      });
      const feed = new SzamlazzFeedsRepository();
      await feed.storeRaw({
        kind: "SZAMLABE",
        externalId: EXTERNAL,
        sha256: "parositas-it-raw",
        body: "<szamlabe/>",
      });
      await feed.storeInvoice({
        externalId: EXTERNAL,
        fileName: "PRT-2026_692.xml",
        content: Buffer.from("<szamlabe/>"),
        sha256: "parositas-it-xml",
        receivedAt: new Date("2026-09-04T00:00:00Z"),
        payee: "COMPANY",
        textReading: {
          invoiceNumber: NUMBER,
          numberFrom: "SZAMLAZZ",
          supplierTaxNumber: TAX,
          supplierName: SUPPLIER,
          gross: "117099",
          currency: "HUF",
        },
      });
      await feed.projectIncoming({
        externalId: EXTERNAL,
        sha256: "parositas-it-raw",
        contentSha256: "parositas-it-xml",
        projection: {
          externalId: EXTERNAL,
          kindCode: "SZ",
          documentNumber: NUMBER,
          electronic: true,
          issueDate: "2026-09-04",
          fulfillmentDate: null,
          dueDate: "2026-09-09",
          paymentMethod: "átutalás",
          currency: "HUF",
          exchangeRate: null,
          exchangeBank: null,
          supplierName: SUPPLIER,
          supplierTaxNumber: TAX,
          supplierEuTaxNumber: null,
          supplierAddress: null,
          supplierBankAccount: null,
          buyerName: "Acropora Kft.",
          buyerTaxNumber: null,
          netAmount: "92204",
          vatAmount: "24895",
          grossAmount: "117099",
          lines: [],
          vatSummary: [],
          paymentsKnown: true,
          payments: [{ date: "2026-09-16", amount: "117099" }],
          note: null,
          orderNumber: null,
          referencedInvoiceNumber: null,
          referencedProformaNumber: null,
          cancelled: false,
        } as never,
      });
    });

    after(removeLeftovers);

    it("WITH a collected mail PDF of the same invoice too (the KS26/12106 shape)", async () => {
      await prisma.incomingSupplierDocument.create({
        data: {
          gmailMessageId: "collect:INFO_MAIL:parositas-it-mail",
          fileName: "PRT2026692.pdf",
          sizeBytes: 9,
          sha256: "parositas-it-mail",
          content: new Uint8Array(Buffer.from("%PDF-1.4 ")),
          status: "FAILED",
          kind: "INVOICE",
          origin: "COLLECTED_MAIL",
          receivedAt: new Date("2026-09-03T00:00:00Z"),
          textReading: {
            invoiceNumber: NUMBER,
            numberFrom: "NAV",
            supplierTaxNumber: TAX,
            gross: "117099",
            currency: "HUF",
          },
        },
      });
      const month = await missing.month("2026-09", { tab: "ALL" });
      const mine = month.items.filter((item) =>
        item.account.name.startsWith(ACCOUNT),
      );
      const row = await prisma.incomingBillingDocument.findFirstOrThrow({
        where: { externalId: EXTERNAL },
      });
      const [item] = incomingListItems({
        rows: [row],
        pairings: await missing.documentPairings(),
        hasCollectedPdf: () => false,
        readings: new Map(),
        purchases: [],
      });
      assert.deepEqual(
        [
          mine.map((i) => [i.state, i.document?.number ?? null]),
          item?.bankMatch.state,
        ],
        [[["FOUND", NUMBER]], "PAIRED"],
        `WITH-MAIL ${JSON.stringify(item?.bankMatch)}`,
      );
    });

    it("the debit naming the number is FOUND, and the feed row reads as paired", async () => {
      const month = await missing.month("2026-09", { tab: "ALL" });
      const mine = month.items.filter((item) =>
        item.account.name.startsWith(ACCOUNT),
      );
      assert.deepEqual(
        mine.map((item) => [item.state, item.document?.number ?? null]),
        [["FOUND", NUMBER]],
        "DEBIT-STATE",
      );
      const row = await prisma.incomingBillingDocument.findFirstOrThrow({
        where: { externalId: EXTERNAL },
      });
      const [item] = incomingListItems({
        rows: [row],
        pairings: await missing.documentPairings(),
        hasCollectedPdf: () => false,
        readings: new Map(),
        purchases: [],
      });
      assert.equal(
        item?.bankMatch.state,
        "PAIRED",
        `BANK-MATCH ${JSON.stringify(item?.bankMatch)}`,
      );
      // the diagnosis runs on the same computation: the paired row is not listed; the same row with
      // another gross is, with no debit of that amount
      const pairings = await missing.documentPairings();
      assert.deepEqual(diagnoseUnpaired([row], pairings, mine), []);
      const other = {
        ...row,
        sourceDocumentId: "nincs-ilyen",
        grossAmount: new Prisma.Decimal(5000),
      };
      assert.deepEqual(
        diagnoseUnpaired([other], pairings, mine).map((line) => [
          line.number,
          line.debits.length,
        ]),
        [[NUMBER, 0]],
      );
    });
  },
);
