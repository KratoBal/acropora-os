import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";
import PDFDocument from "pdfkit";
import type { AuthenticatedUser } from "@acropora/types";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { registerEmbeddedPdfFont } from "../documents/pdf/branded-document.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import { BankStatementImportRepository } from "./bank-statement-import.repository.js";
import { BankStatementImportService } from "./bank-statement-import.service.js";
import { MissingInvoicesRepository } from "./missing-invoices.repository.js";
import { SupplierInvoiceImportService } from "../purchasing/supplier-invoice-import/supplier-invoice-import.service.js";
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
// a döntés audit-sort ír, annak a szerzője valódi felhasználó kell legyen
const ACTOR_EMAIL = "missing-invoices-it-actor@example.invalid";

async function removeLeftovers() {
  const ids = (
    await prisma.bankTransaction.findMany({
      where: { bankAccount: { accountNumber: ACCOUNT } },
      select: { id: true },
    })
  ).map((row) => row.id);
  await prisma.auditLog.deleteMany({
    where: { entityType: "BankTransaction", entityId: { in: ids } },
  });
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
  const actors = await prisma.user.findMany({
    where: { email: ACTOR_EMAIL },
    select: { id: true },
  });
  await prisma.incomingSupplierDocument.deleteMany({
    where: {
      origin: "UPLOAD",
      uploadedByUserId: { in: actors.map((user) => user.id) },
    },
  });
  await prisma.incomingSupplierDocument.deleteMany({
    where: { gmailMessageId: { startsWith: "collect:INFO_MAIL:hianyzo-it-" } },
  });
  await prisma.user.deleteMany({ where: { email: ACTOR_EMAIL } });
}

describe("a hiányzó számlák hónapja", { skip: gate.mode === "skip" }, () => {
  const missing = new MissingInvoicesService(
    new MissingInvoicesRepository(),
    new SupplierInvoiceImportService(),
  );
  let actor: AuthenticatedUser;

  before(async () => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
    await removeLeftovers();
    actor = (await prisma.user.create({
      data: {
        email: ACTOR_EMAIL,
        displayName: "Hiányzó számlák aktor",
        role: "OWNER",
      },
      select: { id: true },
    })) as AuthenticatedUser;
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
      {
        nev: "a suite aktor-felhasználója bent maradt",
        darab: await prisma.user.count({ where: { email: ACTOR_EMAIL } }),
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

  it("pairs by hand with an audit row, lets an invoice go to one debit only, and takes it back", async () => {
    const all = (await missing.month("2026-08", { tab: "ALL" })).items.filter(
      (item) => item.account.name.startsWith(ACCOUNT),
    );
    const payment = all.find((item) => item.partner === SUPPLIER)!;
    const other = all.find((item) => item.partner === "Ismeretlen Bt.")!;
    const documentId = payment.document!.id;

    const paired = await missing.pair(other.id, documentId, actor);
    assert.deepEqual(
      [paired.matchedBy, paired.document?.id],
      ["MANUAL", documentId],
    );
    // a kézi párosítás elvitte a számlát a szabály elől
    assert.equal((await missing.item(payment.id)).document, null);
    await assert.rejects(
      missing.pair(payment.id, documentId, actor),
      /másik terheléshez/,
    );
    assert.equal(
      await prisma.auditLog.count({
        where: {
          entityType: "BankTransaction",
          entityId: other.id,
          action: "missing-invoices.paired",
        },
      }),
      1,
    );

    await missing.unpair(other.id, actor);
    assert.equal((await missing.item(payment.id)).document?.id, documentId);
  });

  it("stores an uploaded PDF outside the receipt chain, pairs it, and it counts as the original", async () => {
    const other = (await missing.month("2026-08", { tab: "ALL" })).items.find(
      (item) =>
        item.account.name.startsWith(ACCOUNT) &&
        item.partner === "Ismeretlen Bt.",
    )!;
    const bytes = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const doc = new PDFDocument({ size: "A4" });
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("error", reject);
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      registerEmbeddedPdfFont(doc).text(
        "Vevő: Acropora Kft. 23916229-2-13",
        40,
        40,
      );
      doc.end();
    });
    const after = await missing.upload(
      other.id,
      { originalname: "ismeretlen.pdf", buffer: bytes },
      "INVOICE",
      actor,
    );
    assert.deepEqual(
      [after.state, after.matchedBy, after.document?.source],
      ["FOUND", "MANUAL", "UPLOAD"],
    );
    const stored = await prisma.incomingSupplierDocument.findFirst({
      where: { origin: "UPLOAD", uploadedByUserId: actor.id },
      select: { expectedArrivalId: true, payeeCheck: true, status: true },
    });
    // a bevételezési lánc a várható beérkezésen át olvas: feltöltésnek ilyen nincs
    assert.deepEqual(stored, {
      expectedArrivalId: null,
      payeeCheck: "COMPANY",
      status: "FAILED",
    });
    assert.equal(
      await prisma.auditLog.count({
        where: {
          entityType: "BankTransaction",
          entityId: other.id,
          action: "missing-invoices.uploaded",
        },
      }),
      1,
    );
  });

  it("a collected PDF carrying the NAV row's number is its original: the payment is found", async () => {
    const payment = (await missing.month("2026-08", { tab: "ALL" })).items.find(
      (item) =>
        item.account.name.startsWith(ACCOUNT) && item.partner === SUPPLIER,
    )!;
    assert.equal(payment.state, "ORIGINAL_MISSING");
    await prisma.incomingSupplierDocument.create({
      data: {
        gmailMessageId: "collect:INFO_MAIL:hianyzo-it-1",
        fileName: "HIANYZOTESZT-1.pdf",
        sizeBytes: 14,
        sha256: "hianyzo-it-collected",
        content: new Uint8Array(Buffer.from("%PDF-1.4 teszt")),
        status: "FAILED",
        kind: "INVOICE",
        origin: "COLLECTED_MAIL",
        receivedAt: new Date("2026-08-06T09:00:00Z"),
        payeeCheck: "COMPANY",
        textReading: {
          invoiceNumber: "HIANYZOTESZT-1",
          numberFrom: "NAV",
          supplierTaxNumber: "99999999-2-42",
        },
      },
    });
    const after = await missing.item(payment.id);
    assert.deepEqual(
      [after.state, after.document?.source],
      ["FOUND", "MAILBOX"],
    );
  });
});
