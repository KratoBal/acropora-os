import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PDFDocument } from "pdf-lib";
import type { DueInvoiceItem, DueInvoicesResponse } from "@acropora/types";

import { pdfTextLines } from "../purchasing/supplier-invoice-import/pdf-text-lines.js";
import {
  buildDueInvoicesPdf,
  DUE_INVOICES_PDF_FILENAME,
  DUE_INVOICES_PDF_TITLE,
  pdfAmount,
} from "./due-invoices-pdf.js";

/*
  A LEJÁRÓ SZÁMLÁK PDF-JE (Balázs, 2026-11-20; acrobot 58228, 58230). MI PIROSÍT: ha a PDF címe vagy fájlneve nem „Lejáró számlák - Utalási
  jegyzék” (kötőjellel, helyes ékezettel); ha a tetején nem áll az utolsó banki adat ideje (vagy a nincs-bankadat mondat); ha a
  „nem jött új banki adat” értesítés a késői küldésnél hiányzik, vagy nélküle is megjelenik; ha a hiányzó bankszámlaszám, határidő vagy
  fizetési mód nem „nincs adat”; ha a lejárt sor nincs jelölve; ha az összeg nem a hátralék a pénznemével; ha egy ékezetes betű más
  jellé romlik (a beágyazott betű); ha sok sornál nem lesz több oldal, vagy az oldalakon nem ismétlődik a fejléc.
*/
const row = (over: Partial<DueInvoiceItem> = {}): DueInvoiceItem => ({
  id: "row-1",
  documentNumber: "SZ-2026-7",
  supplierName: "Árvíztűrő Tükörfúrógép Kft.",
  dueDate: "2026-11-25",
  overdue: false,
  daysOverdue: null,
  supplierBankAccount: "11700000-12345678-00000000",
  supplierBankAccountSource: "OWN",
  outstanding: "1234567",
  currency: "HUF",
  reference: "SZ-2026-7",
  referenceIsDefault: true,
  paymentMethod: "Átutalás",
  missing: { dueDate: false, supplierBankAccount: false, paymentMethod: false },
  ...over,
});
const list = (items: DueInvoiceItem[]): DueInvoicesResponse => ({
  asOf: "2026-11-23",
  items,
  summary: {
    count: items.length,
    overdue: items.filter((i) => i.overdue).length,
    withMissingData: items.filter(
      (i) =>
        i.missing.dueDate ||
        i.missing.supplierBankAccount ||
        i.missing.paymentMethod,
    ).length,
    totals: [{ currency: "HUF", outstanding: "1234567" }],
  },
});
const GENERATED = new Date("2026-11-23T08:20:00Z"); // 09:20 Budapest
const LAST_BANK = new Date("2026-11-23T07:15:00Z"); // 08:15 Budapest

const build = async (
  items: DueInvoiceItem[],
  over: { lastBankData?: Date | null; lateNotice?: boolean } = {},
) => {
  const pdf = await buildDueInvoicesPdf({
    list: list(items),
    lastBankData:
      "lastBankData" in over ? (over.lastBankData ?? null) : LAST_BANK,
    generatedAt: GENERATED,
    lateNotice: over.lateNotice ?? false,
  });
  return { pdf, text: (await pdfTextLines(new Uint8Array(pdf))).join("\n") };
};

describe("the due invoices PDF", () => {
  it("its name is 'Lejáró számlák - Utalási jegyzék' (the title, the metadata and the file name), with a hyphen and the right accents", async () => {
    assert.equal(DUE_INVOICES_PDF_TITLE, "Lejáró számlák - Utalási jegyzék");
    assert.equal(
      DUE_INVOICES_PDF_FILENAME,
      "Lejáró számlák - Utalási jegyzék.pdf",
    );
    const { pdf, text } = await build([row()]);
    assert.ok(text.includes("Lejáró számlák - Utalási jegyzék"), text);
    // the measuring day is stated, and the sentence does not end in two periods
    assert.ok(
      text.includes("A lejáratot erre a napra mérjük: 2026. 11. 23."),
      text,
    );
    assert.ok(!text.includes(".."), text);
    assert.equal(
      (await PDFDocument.load(pdf)).getTitle(),
      "Lejáró számlák - Utalási jegyzék",
    );
    assert.equal(Buffer.from(pdf.subarray(0, 5)).toString("latin1"), "%PDF-");
  });

  it("the last bank data time is always at the top: the time, or that there is no bank data", async () => {
    assert.ok(
      (await build([row()])).text.includes(
        "Utolsó banki adat: 2026. 11. 23. 08:15",
      ),
    );
    assert.ok(
      (await build([row()], { lastBankData: null })).text.includes(
        "Utolsó banki adat: nincs betöltött bankadat",
      ),
    );
    // also with an empty list
    assert.ok(
      (await build([])).text.includes("Utolsó banki adat: 2026. 11. 23. 08:15"),
    );
  });

  it("the late notice appears only when asked", async () => {
    const notice = "Ma még nem érkezett új banki adat";
    assert.ok(
      (await build([row()], { lateNotice: true })).text.includes(notice),
    );
    assert.ok(
      !(await build([row()], { lateNotice: false })).text.includes(notice),
    );
  });

  it("a row shows the company, the due date, the bank account, the outstanding with its currency and the reference", async () => {
    const { text } = await build([row()]);
    for (const expected of [
      "Árvíztűrő Tükörfúrógép Kft.",
      "2026. 11. 25.",
      "11700000-12345678-00000000",
      "1 234 567 HUF",
      "SZ-2026-7",
    ])
      assert.ok(text.includes(expected), `${expected}\n${text}`);
    assert.ok(!text.includes("nincs adat"));
    // the accents survive the embedded font
    assert.ok(!text.includes("\u0000"));
  });

  it("an overdue row is marked with its days, and a missing bank account, due date and payment method read 'nincs adat'", async () => {
    const { text } = await build([
      row({ overdue: true, daysOverdue: 49, dueDate: "2026-10-05" }),
      row({
        id: "x",
        supplierName: "Hiányos Kft.",
        dueDate: null,
        supplierBankAccount: null,
        supplierBankAccountSource: null,
        paymentMethod: null,
        missing: {
          dueDate: true,
          supplierBankAccount: true,
          paymentMethod: true,
        },
      }),
    ]);
    assert.ok(text.includes("LEJÁRT (49 napja)"), text);
    // the due date, the bank account and the payment method line
    assert.equal(text.split("nincs adat").length - 1, 3, text);
    assert.ok(text.includes("fizetési mód: nincs adat"));
    assert.ok(text.includes("1 sorból hiányzik adat"));
  });

  it("a long list runs over several pages and the header repeats on each", async () => {
    const items = Array.from({ length: 80 }, (_, i) =>
      row({
        id: `r${i}`,
        supplierName: `Cég ${i + 1} Kft.`,
        documentNumber: `SZ-${i + 1}`,
        reference: `SZ-${i + 1}`,
      }),
    );
    const { pdf, text } = await build(items);
    const pages = (await PDFDocument.load(pdf)).getPageCount();
    assert.ok(pages > 1, `pages: ${pages}`);
    assert.equal(text.split("Fizetési határidő").length - 1, pages);
    assert.ok(text.includes("Cég 80 Kft."));
  });

  it("the amount reads with space-grouped thousands, a decimal comma for fractions, and the currency", () => {
    assert.equal(pdfAmount("1234567", "HUF"), "1 234 567 HUF");
    assert.equal(pdfAmount("115.50", "EUR"), "115,50 EUR");
    assert.equal(pdfAmount("999", "HUF"), "999 HUF");
  });
});

/*
  A PÓTOLT SZÁMLASZÁM FORRÁSA AZ UTALÁSI JEGYZÉKEN (acrobot 58654, 58655). MI PIROSÍT: ha a pótolt számlaszám forrás nélkül kerülne a jegyzékre; ha a sor saját számlaszáma mellé is forrás-megjegyzés
  kerülne; ha a megjegyzés szövege nem a forrást nevezné meg.
*/
describe("the due invoices PDF names where a supplied account comes from", () => {
  it("a supplied account carries its source note, an own account carries none", async () => {
    const { text } = await build([
      row({ id: "own", documentNumber: "SZ-OWN" }),
      row({
        id: "pdf",
        documentNumber: "SZ-PDF",
        supplierBankAccount: "11773016-11111018",
        supplierBankAccountSource: "INVOICE_PDF",
      }),
      row({
        id: "other",
        documentNumber: "SZ-OTHER",
        supplierBankAccount: "10918001-00000017",
        supplierBankAccountSource: "OTHER_INVOICE",
      }),
    ]);
    assert.ok(text.includes("(a számla PDF-jéből)"), text);
    assert.ok(text.includes("(a szállító másik számlájáról)"), text);
    assert.equal(text.split("(a számla PDF-jéből)").length - 1, 1);
    assert.ok(!text.includes("(kézzel megadva)"), text);
  });
});
