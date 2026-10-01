import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyTransaction,
  NO_INVOICE_CATEGORIES,
  payrollNamesOf,
  type ClassifiableTransaction,
} from "./bank-transaction.classify.js";

const OWN = new Set(["1170900220624460", "1171400626009841"]);

const row = (overrides: Partial<ClassifiableTransaction>) => ({
  counterpartyAccount: null,
  counterpartyName: null,
  narrative: "",
  transactionType: "ÁTUTALÁS",
  ...overrides,
});

const category = (
  overrides: Partial<ClassifiableTransaction>,
  payrollNames: ReadonlySet<string> = new Set(),
) =>
  classifyTransaction(row(overrides), { ownAccounts: OWN, payrollNames })
    .category;

describe("classifyTransaction", () => {
  it("files an ATM withdrawal as cash, which needs no invoice (8 of 8 measured were Uncertain)", () => {
    const withdrawal = {
      counterpartyName: "OTP",
      narrative: "2025.12.23 7404942795 Budapest,X.Ör s vezér tere",
      transactionType: "KÉSZPÉNZFELVÉT ATM-BŐL",
    };
    assert.equal(category(withdrawal), "CASH_WITHDRAWAL");
    assert.ok(NO_INVOICE_CATEGORIES.has("CASH_WITHDRAWAL"));
  });

  it("files money sent to a private person citing our own invoice number as a customer refund, the misspelt ARCW too", () => {
    for (const narrative of [
      "ARCW-2025/00650",
      "ACRW-2026/00362",
      "ACRB-2026/00012 visszautalás",
    ])
      assert.equal(
        category({
          counterpartyName: "Tóth János",
          narrative,
          transactionType: "AZONNALI FIZETÉS",
        }),
        "CUSTOMER_REFUND",
        narrative,
      );
    assert.ok(NO_INVOICE_CATEGORIES.has("CUSTOMER_REFUND"));
  });

  it("does not take a company or a card payment citing our invoice number for a refund", () => {
    assert.notEqual(
      category({
        counterpartyName: "Szállító Kft.",
        narrative: "ACRW-2026/00362",
        transactionType: "ÁTUTALÁS",
      }),
      "CUSTOMER_REFUND",
    );
    assert.notEqual(
      category({
        counterpartyName: "Tóth János",
        narrative: "ACRW-2026/00362",
        transactionType: "VÁSÁRLÁS KÁRTYÁVAL",
      }),
      "CUSTOMER_REFUND",
    );
  });

  it("files social-security contribution as tax, not as insurance (measured trap)", () => {
    assert.equal(
      category({
        counterpartyName: "NAV Társadalombiztosítási Járulék",
        narrative: "08 havi járulék",
      }),
      "TAX",
    );
  });

  it("files a EUR transfer to a Hungarian account as domestic (the DHL Freight case)", () => {
    assert.equal(
      category({
        counterpartyName: "DHL Freight Magyarország",
        counterpartyAccount: "HU42117730161111101800000000",
        narrative: "1.199,75 EUR HU42117730161111101800000000",
        transactionType: "DEVIZA ÁTUTALÁS",
      }),
      "DOMESTIC_SUPPLIER",
    );
  });

  it("files a card payment to a Hungarian company as domestic even in EUR (the Elektro-Light case)", () => {
    assert.equal(
      category({
        counterpartyName: "Elektro-Light Kft. Vil",
        narrative:
          "2026.09.01 7413124583 Elektro-Light Kft. Vil   -APPLE 100,650EUR    0,",
        transactionType: "VÁSÁRLÁS KÁRTYÁVAL",
      }),
      "DOMESTIC_SUPPLIER",
    );
    // a külföldi cégforma kártyával továbbra is külföldi
    assert.equal(
      category({
        counterpartyName: "Fauna Marin GmbH",
        narrative: "2026.09.01 7413124583 Fauna Marin GmbH 98,00EUR",
        transactionType: "VÁSÁRLÁS KÁRTYÁVAL",
      }),
      "FOREIGN_SUPPLIER",
    );
  });

  it("does not read the Apple Pay marker as an Apple subscription", () => {
    assert.equal(
      category({
        counterpartyName: "Pepco",
        narrative: "PEPCO BUDAPEST-APPLE",
        transactionType: "KÁRTYÁS VÁSÁRLÁS",
      }),
      "DOMESTIC_SUPPLIER",
    );
    assert.equal(
      category({
        counterpartyName: "OPENAI *CHATGPT SUBSCR",
        transactionType: "KÁRTYÁS VÁSÁRLÁS",
      }),
      "CARD_SUBSCRIPTION",
    );
  });

  it("files transfers between our own accounts, a bank fee, a loan repayment and payroll as needing no invoice", () => {
    const cases = [
      category({
        counterpartyAccount: "11714006-26009841",
        counterpartyName: "Acropora",
      }),
      category({ transactionType: "KÖLTSÉG ÉS JUTALÉK" }),
      category({
        counterpartyName: "Kovács Béla",
        narrative: "kölcsön visszafizetése szerződés szerint",
      }),
      category({
        counterpartyName: "Nagy Anna",
        narrative: "08 havi munkabér",
      }),
    ];
    assert.deepEqual(cases, [
      "INTERNAL_TRANSFER",
      "BANK_FEE",
      "LOAN",
      "PAYROLL",
    ]);
    for (const c of cases) assert.ok(NO_INVOICE_CATEGORIES.has(c), c);
  });

  it("keeps insurance among the categories that need a document", () => {
    const c = category({ counterpartyName: "Allianz Hungária Zrt." });
    assert.equal(c, "INSURANCE");
    assert.equal(NO_INVOICE_CATEGORIES.has(c), false);
  });

  it("files a foreign IBAN and a foreign company form as foreign", () => {
    assert.equal(
      category({
        counterpartyAccount: "DE89370400440532013000",
        counterpartyName: "von Wussow",
      }),
      "FOREIGN_SUPPLIER",
    );
    assert.equal(
      category({
        counterpartyName: "Coral Sands GmbH",
        transactionType: "KÁRTYÁS VÁSÁRLÁS",
      }),
      "FOREIGN_SUPPLIER",
    );
  });

  it("estimates payroll for a person paid as payroll in another month, and says it is an estimate", () => {
    const names = payrollNamesOf([
      row({ counterpartyName: "Nagy Anna", narrative: "07 havi munkabér" }),
    ]);
    const result = classifyTransaction(row({ counterpartyName: "Nagy Anna" }), {
      ownAccounts: OWN,
      payrollNames: names,
    });
    assert.equal(result.category, "PAYROLL");
    assert.match(result.rule, /becslés/);
    assert.equal(
      category({ counterpartyName: "Ismeretlen Személy" }),
      "UNCERTAIN",
    );
  });
});
