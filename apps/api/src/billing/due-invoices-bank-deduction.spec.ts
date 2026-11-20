import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma, type IncomingBillingDocument } from "@acropora/database";
import { probablyNotTransferNote } from "@acropora/types";

import {
  WINDOW_DAYS,
  bankDeductionEvidence as evidenceOf,
  parseAccountBankTaxBases,
} from "./due-invoices-bank-deduction.js";

const bankDeductionEvidence = (input: {
  rows: IncomingBillingDocument[];
  bankFeeDebits: ReturnType<typeof fee>[];
  bankTaxBases?: ReadonlySet<string>;
}) => evidenceOf({ bankTaxBases: BASES, ...input });

/*
  A BANK SAJÁT SZÁMLÁJA, AMIT A BANK LEVON (acrobot 58915, az OTP-sor). MI PIROSÍT: ha egy idegen szállító azonos összegű sora bekerül; ha a bank saját számlája egy más összegű, más pénznemű, a
  kiállítás előtti vagy az ablakon túli díj-levonáshoz kerül; ha egy terhelés két számlát igazol; ha a sztornózott számla igazolást kap; ha a bank számlája levonás nélkül kerül be; ha az ablak határa
  eltolódik; ha az ok szövege nem „valószínű” és nem nevezi meg a napot.
*/
// neutral test data: no real company's tax number in the public base
const BANK_TAX = "12345678-4-44";
const BASES = new Set(["12345678"]);
let n = 0;
const row = (
  over: Partial<Record<string, unknown>> = {},
): IncomingBillingDocument =>
  ({
    id: `row-${++n}`,
    supplierName: "OTP Bank Nyrt.",
    supplierTaxNumber: BANK_TAX,
    supplierEuTaxNumber: null,
    issueDate: new Date("2026-11-02T00:00:00Z"),
    grossAmount: new Prisma.Decimal(9525),
    currency: "HUF",
    cancelled: false,
    ...over,
  }) as unknown as IncomingBillingDocument;
const fee = (bookingDate: string, amount = "9525", currency = "HUF") => ({
  bookingDate,
  amount,
  currency,
});

describe("bankDeductionEvidence", () => {
  it("the bank's own invoice with an identical bank-fee debit within the window is evidence, with the debit's day", () => {
    const bank = row();
    const evidence = bankDeductionEvidence({
      rows: [bank],
      bankFeeDebits: [fee("2026-11-05")],
    });
    assert.deepEqual(evidence.get(bank.id), { bookingDate: "2026-11-05" });
  });

  it("a stranger supplier's invoice of the same amount gets nothing: only the account-keeping bank counts", () => {
    const stranger = row({
      supplierName: "Idegen Kft.",
      supplierTaxNumber: "99999999-2-44",
    });
    const nameOnly = row({ supplierTaxNumber: null });
    assert.equal(
      bankDeductionEvidence({
        rows: [stranger, nameOnly],
        bankFeeDebits: [fee("2026-11-05")],
      }).size,
      0,
    );
  });

  it("the amount, the currency and the window must all fit: another amount or currency, a debit before the issue day, one past the window", () => {
    const bank = row();
    const none = (debit: ReturnType<typeof fee>) =>
      bankDeductionEvidence({ rows: [bank], bankFeeDebits: [debit] }).size ===
      0;
    assert.ok(none(fee("2026-11-05", "9526")));
    assert.ok(none(fee("2026-11-05", "9525", "EUR")));
    assert.ok(none(fee("2026-11-01")), "before the issue day");
    assert.ok(none(fee("2026-12-18")), "46 days after");
    assert.equal(WINDOW_DAYS, 45);
    // the edges are inside: the issue day itself and day 45
    assert.equal(
      bankDeductionEvidence({
        rows: [bank],
        bankFeeDebits: [fee("2026-11-02")],
      }).size,
      1,
    );
    assert.equal(
      bankDeductionEvidence({
        rows: [bank],
        bankFeeDebits: [fee("2026-12-17")],
      }).size,
      1,
    );
  });

  it("one debit proves one invoice: two identical invoices and one debit give evidence to the EARLIER invoice only", () => {
    const first = row({ issueDate: new Date("2026-11-02T00:00:00Z") });
    const second = row({ issueDate: new Date("2026-11-20T00:00:00Z") });
    const evidence = bankDeductionEvidence({
      rows: [second, first],
      bankFeeDebits: [fee("2026-11-25")],
    });
    assert.equal(evidence.has(first.id), true);
    assert.equal(evidence.has(second.id), false);
    // two debits prove both
    assert.equal(
      bankDeductionEvidence({
        rows: [first, second],
        bankFeeDebits: [fee("2026-11-25"), fee("2026-11-26")],
      }).size,
      2,
    );
  });

  it("a cancelled invoice gets no evidence, and no debit means no evidence", () => {
    const cancelled = row({ cancelled: true });
    assert.equal(
      bankDeductionEvidence({
        rows: [cancelled],
        bankFeeDebits: [fee("2026-11-05")],
      }).size,
      0,
    );
    assert.equal(
      bankDeductionEvidence({ rows: [row()], bankFeeDebits: [] }).size,
      0,
    );
  });
});

describe("the configuration of the account-keeping bank", () => {
  it("an empty or missing value runs no rule: nothing is evidence", () => {
    const bank = row();
    for (const bases of [
      parseAccountBankTaxBases(undefined),
      parseAccountBankTaxBases(""),
      parseAccountBankTaxBases(" , "),
    ])
      assert.equal(
        bankDeductionEvidence({
          rows: [bank],
          bankFeeDebits: [fee("2026-11-05")],
          bankTaxBases: bases,
        }).size,
        0,
      );
  });

  it("the value is comma-separated tax numbers, each cut to its 8-digit base; a short or digitless entry is dropped", () => {
    assert.deepEqual(
      [...parseAccountBankTaxBases("12345678, 87654321-4-44 ,abc,1234")].sort(),
      ["12345678", "87654321"],
    );
  });

  it("a supplier whose base is not in the configured list gets nothing", () => {
    const other = row({ supplierTaxNumber: "87654321-2-44" });
    assert.equal(
      bankDeductionEvidence({
        rows: [other],
        bankFeeDebits: [fee("2026-11-05")],
      }).size,
      0,
    );
  });
});

describe("probablyNotTransferNote", () => {
  it("says 'valószínűleg' and names the day for a bank deduction, and the count for a card history", () => {
    assert.equal(
      probablyNotTransferNote({
        kind: "BANK_DEDUCTION",
        bookingDate: "2026-11-05",
      }),
      "a bank a saját díját valószínűleg levonta (2026. 11. 05.)",
    );
    assert.equal(
      probablyNotTransferNote({ kind: "CARD", cardInvoices: 1 }),
      "a szállító másik számláját kártyával fizettük",
    );
  });
});
