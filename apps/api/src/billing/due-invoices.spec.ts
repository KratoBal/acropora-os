import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PERMISSIONS, type IncomingDocumentListItem } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator.js";
import { DueInvoicesController } from "./due-invoices.controller.js";
import { buildDueInvoices, isTransferMethod } from "./due-invoices.js";

/*
  LEJÁRÓ SZÁMLÁK, A LISTA (Balázs, 2026-11-20; acrobot 58227, 58229). MI PIROSÍT: ha egy fizetendő, átutalásos, ki nem fizetett számla
  kiesik; ha egy készpénzes, kártyás, kifizetett, sztornózott, jóváíró vagy „nem könyvelendő” bekerül; ha a hátralék nem a bruttó
  mínusz a kifizetett rész (részben fizetettnél is); ha a hiányzó fizetési mód, bankszámlaszám vagy határidő kiejti a sort (a „nincs
  adat” jelzés a lényeg); ha a lejárt tételek nincsenek elöl, vagy nincs köztük a legrégebben lejárt legfelül; ha a mai határidő
  lejártnak számít; ha a határidő nélküli nem a végén áll; ha a közlemény nem a számla száma, vagy nem jelöli, hogy alapértelmezés;
  ha az összesítés nem pénznemenként és nem a hátralékból megy; ha a lista jog nélkül elérhető.
*/
const TODAY = "2026-11-20";

let n = 0;
const item = (
  over: Partial<IncomingDocumentListItem> = {},
): IncomingDocumentListItem => ({
  id: `row-${++n}`,
  origin: "SZAMLAZZ",
  documentNumber: `SZ-${n}`,
  kindCode: "SZ",
  kindLabel: "Számla",
  invoiceFormat: "ELECTRONIC",
  cancelled: false,
  supplierName: "Minta Szállító Kft.",
  supplierTaxNumber: null,
  issueDate: "2026-11-01",
  fulfillmentDate: null,
  dueDate: "2026-11-30",
  paymentMethod: "Átutalás",
  currency: "HUF",
  exchangeRate: null,
  netAmount: "100000",
  vatAmount: "27000",
  grossAmount: "127000",
  paymentState: "UNPAID",
  paidAmount: "0",
  lastPaymentDate: null,
  paymentSource: null,
  paymentConflict: false,
  bankMatch: { state: "UNPAIRED", reason: null, debits: [] },
  review: null,
  notBookable: false,
  paperOriginal: false,
  paperOriginalMarkedHere: false,
  hasPdf: false,
  ...over,
});
const accounts = (
  rows: IncomingDocumentListItem[],
  value: string | null = "11700000-00000000-00000000",
) => new Map(rows.map((row) => [row.id, value]));
const build = (
  rows: IncomingDocumentListItem[],
  bank: ReadonlyMap<string, string | null> = accounts(rows),
) => buildDueInvoices({ items: rows, bankAccounts: bank, today: TODAY });

describe("which invoices the due list holds", () => {
  it("holds a payable, transfer, unpaid invoice with its columns", () => {
    const row = item({
      documentNumber: "SZ-2026-7",
      supplierName: "Alfa Kft.",
      dueDate: "2026-11-25",
    });
    const out = build([row], accounts([row], "11700000-12345678-00000000"));
    assert.equal(out.items.length, 1);
    assert.deepEqual(out.items[0], {
      id: row.id,
      documentNumber: "SZ-2026-7",
      supplierName: "Alfa Kft.",
      dueDate: "2026-11-25",
      overdue: false,
      daysOverdue: null,
      supplierBankAccount: "11700000-12345678-00000000",
      supplierBankAccountSource: "OWN",
      outstanding: "127000",
      currency: "HUF",
      reference: "SZ-2026-7",
      referenceIsDefault: true,
      paymentMethod: "Átutalás",
      missing: {
        dueDate: false,
        supplierBankAccount: false,
        paymentMethod: false,
      },
    });
  });

  it("the payable kinds are the invoice, the final invoice and the advance invoice; the credit and cancellation notes and the proforma are not", () => {
    const rows = ["SZ", "VS", "ES", "SS", "JS", "HS", "D", "SL"].map(
      (kindCode) => item({ kindCode }),
    );
    assert.deepEqual(
      build(rows)
        .items.map((r) => r.id)
        .sort(),
      rows
        .slice(0, 3)
        .map((r) => r.id)
        .sort(),
    );
  });

  it("a cancelled, a not-bookable and a fully paid invoice are not held", () => {
    const rows = [
      item({ cancelled: true }),
      item({ notBookable: true }),
      item({ paymentState: "PAID", paidAmount: "127000" }),
    ];
    assert.equal(build(rows).items.length, 0);
  });

  it("only a transfer method stays: cash and card go, the transfer spellings stay", () => {
    for (const method of [
      "Átutalás",
      "átutalás",
      "Banki átutalás",
      "Utalás",
      "ELŐRE UTALÁS",
    ])
      assert.equal(isTransferMethod(method), true, method);
    for (const method of ["Készpénz", "Bankkártya", "Utánvét", "PayPal"])
      assert.equal(isTransferMethod(method), false, method);
    const keep = item({ paymentMethod: "Banki átutalás" });
    const rows = [
      item({ paymentMethod: "Készpénz" }),
      item({ paymentMethod: "Bankkártya" }),
      keep,
    ];
    assert.deepEqual(
      build(rows).items.map((r) => r.id),
      [keep.id],
    );
  });

  it("the outstanding is the gross less the paid part; a partly paid invoice stays, a settled amount goes", () => {
    const part = item({ paymentState: "PARTIAL", paidAmount: "27000" });
    const settled = item({ paymentState: "UNPAID", paidAmount: "127000" });
    const noGross = item({ grossAmount: null });
    const out = build([part, settled, noGross]);
    assert.deepEqual(
      out.items.map((r) => [r.id, r.outstanding]),
      [[part.id, "100000"]],
    );
  });
});

describe("missing data is shown, not dropped", () => {
  it("a missing payment method, bank account or due date keeps the row with its flag", () => {
    const noMethod = item({ paymentMethod: null });
    const emptyMethod = item({ paymentMethod: "  " });
    const noAccount = item();
    const blankAccount = item();
    const noDue = item({ dueDate: null });
    const rows = [noMethod, emptyMethod, noAccount, blankAccount, noDue];
    const bank = new Map<string, string | null>([
      [noMethod.id, "11700000-1"],
      [emptyMethod.id, "11700000-1"],
      [noAccount.id, null],
      [blankAccount.id, "   "],
      [noDue.id, "11700000-1"],
    ]);
    const out = build(rows, bank);
    assert.equal(out.items.length, 5);
    const by = new Map(out.items.map((r) => [r.id, r]));
    assert.equal(by.get(noMethod.id)?.missing.paymentMethod, true);
    assert.equal(by.get(noMethod.id)?.paymentMethod, null);
    assert.equal(by.get(emptyMethod.id)?.missing.paymentMethod, true);
    assert.equal(by.get(noAccount.id)?.missing.supplierBankAccount, true);
    assert.equal(by.get(noAccount.id)?.supplierBankAccount, null);
    assert.equal(by.get(blankAccount.id)?.missing.supplierBankAccount, true);
    assert.equal(by.get(blankAccount.id)?.supplierBankAccount, null);
    assert.equal(by.get(noDue.id)?.missing.dueDate, true);
    assert.equal(out.summary.withMissingData, 5);
  });

  it("a complete row is not counted as missing data", () => {
    assert.equal(build([item()]).summary.withMissingData, 0);
  });
});

describe("the order of the list", () => {
  it("overdue first (the longest overdue on top), then today and later ascending, and no due date last", () => {
    const noDue = item({ dueDate: null, supplierName: "Zéta" });
    const later = item({ dueDate: "2026-12-15" });
    const today = item({ dueDate: TODAY });
    const soon = item({ dueDate: "2026-11-21" });
    const recent = item({ dueDate: "2026-11-19" });
    const old = item({ dueDate: "2026-10-02" });
    const out = build([noDue, later, today, soon, recent, old]);
    assert.deepEqual(
      out.items.map((r) => r.id),
      [old.id, recent.id, today.id, soon.id, later.id, noDue.id],
    );
    // a due date of today is not yet overdue; the day before is
    assert.deepEqual(
      out.items.map((r) => r.overdue),
      [true, true, false, false, false, false],
    );
    assert.deepEqual(
      out.items.map((r) => r.daysOverdue),
      [49, 1, null, null, null, null],
    );
    assert.equal(out.summary.overdue, 2);
  });

  it("the same due date is ordered by the company name, then the number", () => {
    const b = item({
      dueDate: "2026-12-01",
      supplierName: "Béta Kft.",
      documentNumber: "B-2",
    });
    const a2 = item({
      dueDate: "2026-12-01",
      supplierName: "Alfa Kft.",
      documentNumber: "A-2",
    });
    const a1 = item({
      dueDate: "2026-12-01",
      supplierName: "Alfa Kft.",
      documentNumber: "A-1",
    });
    assert.deepEqual(
      build([b, a2, a1]).items.map((r) => r.documentNumber),
      ["A-1", "A-2", "B-2"],
    );
  });
});

describe("the summary and the access", () => {
  it("totals the outstanding per currency, from the outstanding, with the currency's decimals", () => {
    const rows = [
      item({ grossAmount: "100000", paidAmount: "0" }),
      item({
        grossAmount: "50000",
        paymentState: "PARTIAL",
        paidAmount: "20000",
      }),
      item({ currency: "EUR", grossAmount: "100.50", paidAmount: "0" }),
      item({
        currency: "EUR",
        grossAmount: "20.25",
        paymentState: "PARTIAL",
        paidAmount: "5.25",
      }),
    ];
    assert.deepEqual(build(rows).summary.totals, [
      { currency: "EUR", outstanding: "115.50" },
      { currency: "HUF", outstanding: "130000" },
    ]);
    assert.equal(build(rows).summary.count, 4);
  });

  it("the list asks for the finance read right, as the finance pages do", () => {
    assert.deepEqual(
      Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, DueInvoicesController),
      [PERMISSIONS.FINANCE_VIEW],
    );
  });
});

/*
  A PÓTOLT SZÁMLASZÁM FORRÁSA A SORBAN (acrobot 58654, 58655). MI PIROSÍT: ha a sor saját számlaszáma nem OWN jelölést kapna; ha a pótolt számlaszám forrás nélkül maradna (az utalási jegyzékbe
  kerülő számot a forrásáról kell megítélni); ha a számlaszám nélküli sorhoz forrás kerülne; ha a pótolt számlaszám után a sor még "hiányzó adat"-ként számolna.
*/
describe("the source of a supplied bank account", () => {
  it("an own account is OWN, a supplied one carries its source, no account has no source", () => {
    const own = item();
    const supplied = item();
    const none = item();
    const out = buildDueInvoices({
      items: [own, supplied, none],
      bankAccounts: new Map<string, string | null>([
        [own.id, "11700000-12345678-00000000"],
        [supplied.id, "11773016-11111018-00000000"],
        [none.id, null],
      ]),
      bankAccountSources: new Map([
        [supplied.id, "INVOICE_PDF"],
        // egy számlaszám nélküli sorhoz hiába van forrás: nincs számlaszám, nincs forrás
        [none.id, "OTHER_INVOICE"],
      ]),
      today: TODAY,
    });
    const by = new Map(out.items.map((r) => [r.id, r]));
    assert.equal(by.get(own.id)?.supplierBankAccountSource, "OWN");
    assert.equal(by.get(supplied.id)?.supplierBankAccountSource, "INVOICE_PDF");
    assert.equal(by.get(none.id)?.supplierBankAccountSource, null);
    assert.equal(by.get(supplied.id)?.missing.supplierBankAccount, false);
    assert.equal(by.get(none.id)?.missing.supplierBankAccount, true);
    assert.equal(out.summary.withMissingData, 1);
  });
});

/*
  A „VALÓSZÍNŰLEG NEM UTALANDÓ” SZAKASZ (acrobot 58830, nautilus 58712). MI PIROSÍT: ha a kártyás múltú, fizetési mód NÉLKÜLI sor a főlistában marad; ha egy sor, amelyiknek van fizetési módja
  (átutalás is), a szakaszba kerül; ha egy sor KIESIK (a szakaszban nincs meg); ha a szakasz összege beleszámít a főlista darabszámába, lejárt-számába vagy összegébe; ha a szakasz sorai nem
  ugyanabban a sorrendben állnak, mint a főlistáé; ha a szakasz összege nem pénznemenként van.
*/
describe("the probably-not-transfer section", () => {
  const evidence = (...ids: string[]) =>
    new Map(ids.map((id) => [id, { kind: "CARD" as const, cardInvoices: 2 }]));

  it("a row with NO payment method and a card-paid supplier moves to the section, with its evidence; nothing drops", () => {
    const card = item({ paymentMethod: null, supplierName: "Kártyás Kft." });
    const plain = item({ paymentMethod: null, supplierName: "Más Kft." });
    const list = buildDueInvoices({
      items: [card, plain],
      bankAccounts: new Map(),
      notTransferEvidence: evidence(card.id),
      today: TODAY,
    });
    assert.deepEqual(
      list.items.map((r) => r.id),
      [plain.id],
    );
    assert.deepEqual(
      list.probablyNotTransfer.map((r) => [r.id, r.evidence]),
      [[card.id, { kind: "CARD", cardInvoices: 2 }]],
    );
    // the moved row keeps its own data and its missing flags
    assert.equal(list.probablyNotTransfer[0]!.missing.paymentMethod, true);
    assert.equal(list.probablyNotTransfer[0]!.outstanding, "127000");
  });

  it("a row WITH a transfer method never moves, whatever the supplier's card history says", () => {
    const transfer = item({ paymentMethod: "Átutalás" });
    const list = buildDueInvoices({
      items: [transfer],
      bankAccounts: new Map(),
      notTransferEvidence: evidence(transfer.id),
      today: TODAY,
    });
    assert.equal(list.items.length, 1);
    assert.equal(list.probablyNotTransfer.length, 0);
  });

  it("the section's rows are NOT in the main count, the overdue count or the totals; they have their own", () => {
    const overdueCard = item({
      paymentMethod: null,
      dueDate: "2026-11-10",
      grossAmount: "1000",
    });
    const main = item({ grossAmount: "5000" });
    const eurCard = item({
      paymentMethod: null,
      currency: "EUR",
      grossAmount: "20.50",
      dueDate: null,
    });
    const list = buildDueInvoices({
      items: [main, overdueCard, eurCard],
      bankAccounts: new Map(),
      notTransferEvidence: evidence(overdueCard.id, eurCard.id),
      today: TODAY,
    });
    assert.equal(list.summary.count, 1);
    assert.equal(list.summary.overdue, 0);
    assert.deepEqual(list.summary.totals, [
      { currency: "HUF", outstanding: "5000" },
    ]);
    assert.equal(list.summary.probablyNotTransfer.count, 2);
    assert.deepEqual(list.summary.probablyNotTransfer.totals, [
      { currency: "EUR", outstanding: "20.50" },
      { currency: "HUF", outstanding: "1000" },
    ]);
  });

  it("the section keeps the main list's order: the overdue first, no due date last", () => {
    const later = item({ paymentMethod: null, dueDate: "2026-12-05" });
    const none = item({ paymentMethod: null, dueDate: null });
    const old = item({ paymentMethod: null, dueDate: "2026-11-01" });
    const list = buildDueInvoices({
      items: [later, none, old],
      bankAccounts: new Map(),
      notTransferEvidence: evidence(later.id, none.id, old.id),
      today: TODAY,
    });
    assert.deepEqual(
      list.probablyNotTransfer.map((r) => r.id),
      [old.id, later.id, none.id],
    );
  });

  it("without evidence the section is empty and every row stays (the field is optional)", () => {
    const row = item({ paymentMethod: null });
    const list = buildDueInvoices({
      items: [row],
      bankAccounts: new Map(),
      today: TODAY,
    });
    assert.equal(list.items.length, 1);
    assert.deepEqual(list.probablyNotTransfer, []);
    assert.deepEqual(list.summary.probablyNotTransfer, {
      count: 0,
      totals: [],
    });
  });

  it("a bank-deduction evidence moves a row with no method too, and the note's kind rides with it", () => {
    const bank = item({ paymentMethod: null, supplierName: "OTP Bank Nyrt." });
    const list = buildDueInvoices({
      items: [bank],
      bankAccounts: new Map(),
      notTransferEvidence: new Map([
        [
          bank.id,
          { kind: "BANK_DEDUCTION" as const, bookingDate: "2026-11-05" },
        ],
      ]),
      today: TODAY,
    });
    assert.deepEqual(list.items, []);
    assert.deepEqual(list.probablyNotTransfer[0]!.evidence, {
      kind: "BANK_DEDUCTION",
      bookingDate: "2026-11-05",
    });
  });
});
