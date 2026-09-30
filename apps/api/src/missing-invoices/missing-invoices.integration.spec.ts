import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import { BankStatementImportRepository } from "./bank-statement-import.repository.js";
import { BankStatementImportService } from "./bank-statement-import.service.js";
import { MissingInvoicesRepository } from "./missing-invoices.repository.js";
import { MissingInvoicesService } from "./missing-invoices.service.js";

/**
 * A HIÁNYZÓ SZÁMLÁK VALÓDI ADATBÁZISON, végig: feltöltött kivonat, egy NAV
 * bejövő számla, és a hónap. Amit csak adatbázis bizonyít: a kivonat-lefedés
 * csoportosítása, a jelöltek betöltése a NAV-táblából, és hogy a párosítás a
 * valódi sorokon is Megvan-t ad.
 */
const gate = integrationDatabaseGate(process.env);
const ACCOUNT = "9999000033334444";
const IMPORTER = "missing-invoices-read-it";
const SUPPLIER = "HIANYZOTESZT Kft.";

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
}

describe("a hiányzó számlák hónapja", { skip: gate.mode === "skip" }, () => {
  const missing = new MissingInvoicesService(new MissingInvoicesRepository());

  before(async () => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
    await removeLeftovers();
    await new BankStatementImportService(
      new BankStatementImportRepository(),
    ).import(
      {
        originalname: "export.csv",
        buffer: Buffer.from(
          [
            `"${ACCOUNT}";T;-12700;HUF;20260812;20260812;;;"${SUPPLIER}";"szamla";;;ÁTUTALÁS;;`,
            `"${ACCOUNT}";T;-5000;HUF;20260813;20260813;;;"Ismeretlen Bt.";"x";;;ÁTUTALÁS;;`,
          ].join("\r\n"),
        ),
      },
      { id: IMPORTER } as AuthenticatedUser,
    );
    await prisma.navIncomingInvoice.create({
      data: {
        navInvoiceNumber: "HIANYZOTESZT-1",
        supplierTaxNumber: "99999999",
        supplierName: SUPPLIER,
        invoiceIssueDate: new Date("2026-08-05T00:00:00Z"),
        currency: "HUF",
        invoiceNetAmount: 10000,
        invoiceVatAmount: 2700,
        insDate: new Date("2026-08-05T10:00:00Z"),
      },
    });
  });

  after(async () => {
    await removeLeftovers();
    nincsMaradek([
      {
        nev: "a suite NAV-számlája bent maradt",
        darab: await prisma.navIncomingInvoice.count({
          where: { supplierName: SUPPLIER },
        }),
      },
    ]);
  });

  it("finds the NAV invoice for the payment but asks for its original, and leaves the other one missing", async () => {
    const month = await missing.month("2026-08", { tab: "ALL" });
    const mine = month.items.filter((item) =>
      item.account.name.startsWith(ACCOUNT),
    );
    assert.deepEqual(
      mine.map((item) => [
        item.partner,
        item.state,
        item.document?.number ?? null,
      ]),
      [
        // a NAV-adatsor nem eredeti: a számla ismert, az eredeti kell
        [SUPPLIER, "ORIGINAL_MISSING", "HIANYZOTESZT-1"],
        ["Ismeretlen Bt.", "NO_INVOICE", null],
      ],
    );
    const account = month.accounts.find((a) => a.accountNumber === ACCOUNT);
    assert.equal(account?.hasStatement, true);
  });
});
