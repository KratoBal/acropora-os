import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  dryRunReport,
  simplePayMarkPaidMode,
} from "./simplepay-paid-marks.dry-run.js";
import {
  decideSimplePayOrder,
  type CardInvoiceInput,
  type SimplePaySettlementLineInput,
} from "./simplepay-paid-marks.js";

const D = (value: string | number) => new Prisma.Decimal(value);

const line = (
  id: string,
  transactionStatus: string,
  amount: number,
  transactionDate: string,
  currency = "HUF",
): SimplePaySettlementLineInput => ({
  transactionId: id,
  transactionStatus,
  amount: D(amount),
  currency,
  transactionDate,
});

const invoice = (
  invoiceNumber: string,
  gross: number,
  overrides: Partial<CardInvoiceInput> = {},
): CardInvoiceInput => ({
  invoiceNumber,
  grossAmount: D(gross),
  currency: "HUF",
  cancelled: false,
  paymentsKnown: false,
  paidAmount: D(0),
  missingPayments: "CARD_AT_ORDER",
  ...overrides,
});

const decide = (
  lines: SimplePaySettlementLineInput[],
  invoices: CardInvoiceInput[],
) => decideSimplePayOrder({ orderKey: "665706", lines, invoices });

const reasonOf = (decision: ReturnType<typeof decide>) =>
  decision.markable ? "MARK" : decision.reason;

/*
  A JELÖLHETŐ ESET. MI PIROSÍT: ha a dátum nem a SimplePay elszámolás napja
  (hanem a számla kelte vagy a legkorábbi sor); ha az összeg nem a bruttó; ha két
  külön kártyás fizetés összege nem adódna össze.
*/
describe("decideSimplePayOrder: a settled card invoice is marked", () => {
  it("one COMPLETED line of the gross: the gross, dated the settlement day", () => {
    const decision = decide(
      [line("504312345", "COMPLETED", 29210, "2026-09-28")],
      [invoice("ACRW-2026/00512", 29210)],
    );
    assert.deepEqual(decision, {
      orderKey: "665706",
      markable: true,
      mark: {
        invoiceNumber: "ACRW-2026/00512",
        date: "2026-09-28",
        amount: "29210",
        title: "bankkártya",
        note: "SimplePay, 2026-09-28, tranzakció: 504312345",
        sourceRef: "504312345",
      },
    });
  });

  it("two COMPLETED lines adding up to the gross: the later day, both transactions named", () => {
    const decision = decide(
      [
        line("504399999", "COMPLETED", 10000, "2026-09-29"),
        line("504311111", "COMPLETED", 19210, "2026-09-27"),
      ],
      [invoice("ACRW-2026/00512", 29210)],
    );
    assert.ok(decision.markable);
    assert.equal(decision.mark.date, "2026-09-29");
    assert.equal(
      decision.mark.note,
      "SimplePay, 2026-09-29, tranzakció: 504311111, 504399999",
    );
    assert.equal(decision.mark.sourceRef, "504311111,504399999");
  });

  it("a cancelled invoice next to the live one on the same order: the live one is marked", () => {
    const decision = decide(
      [line("1", "COMPLETED", 29210, "2026-09-28")],
      [
        invoice("ACRW-2026/00500", 29210, { cancelled: true }),
        invoice("ACRW-2026/00512", 29210),
      ],
    );
    assert.ok(decision.markable);
    assert.equal(decision.mark.invoiceNumber, "ACRW-2026/00512");
  });

  it("projected with an empty payments element (known, nothing paid): marked", () => {
    const decision = decide(
      [line("1", "COMPLETED", 29210, "2026-09-28")],
      [invoice("ACRW-2026/00512", 29210, { paymentsKnown: true })],
    );
    assert.equal(reasonOf(decision), "MARK");
  });
});

/*
  A VISSZATÉRÍTÉS (Balázs kérése: kezelve legyen). MI PIROSÍT: ha egy teljesen
  visszatérített rendelés számlája kifizetettnek jelölődne; ha a részleges
  visszatérítés csendben a teljes bruttóval vagy a maradékkal jelölődne; ha a
  REFUND sor előjele (amit nem ismerünk) számítana.
*/
describe("decideSimplePayOrder: a refund holds the mark back", () => {
  it("a full refund, either sign: REFUNDED, not a payment", () => {
    for (const amount of [29210, -29210])
      assert.equal(
        reasonOf(
          decide(
            [
              line("1", "COMPLETED", 29210, "2026-09-28"),
              line("2", "REFUND", amount, "2026-09-30"),
            ],
            [invoice("ACRW-2026/00512", 29210)],
          ),
        ),
        "REFUNDED",
      );
  });

  it("a partial refund: a question, and the dry run says how much", () => {
    const decision = decide(
      [
        line("1", "COMPLETED", 29210, "2026-09-28"),
        line("2", "REFUND", -10000, "2026-09-30"),
      ],
      [invoice("ACRW-2026/00512", 29210)],
    );
    assert.ok(!decision.markable);
    assert.equal(decision.reason, "PARTLY_REFUNDED");
    assert.equal(decision.completed, "29210");
    assert.equal(decision.refunded, "10000");
  });
});

/*
  AMI NEM JELÖLHETŐ. MI PIROSÍT: ha a Számlázz.hu már rögzített kifizetése mellé
  második kerülne; ha egy nem újravetített (ismeretlen) számla jelölődne; ha egy
  átutalásos számla kártyás elszámolásból; ha több élő számla közül egy találgatott;
  ha egy ismeretlen SimplePay-állapotot fizetésnek vennénk; ha 1 Ft eltérés átmenne.
*/
describe("decideSimplePayOrder: what is not marked", () => {
  const paid = [line("1", "COMPLETED", 29210, "2026-09-28")];
  const cases: [
    string,
    CardInvoiceInput[],
    SimplePaySettlementLineInput[],
    string,
  ][] = [
    ["no invoice on the order", [], paid, "NO_INVOICE"],
    [
      "only a cancelled invoice",
      [invoice("A", 29210, { cancelled: true })],
      paid,
      "CANCELLED",
    ],
    [
      "a storno document only (negative gross)",
      [invoice("A", -29210)],
      paid,
      "CANCELLED",
    ],
    [
      "two live invoices",
      [invoice("A", 19210), invoice("B", 10000)],
      paid,
      "SEVERAL_INVOICES",
    ],
    [
      "payments not yet projected",
      [invoice("A", 29210, { paymentsKnown: null })],
      paid,
      "PAYMENTS_UNKNOWN",
    ],
    [
      "Számlázz.hu already recorded the payment",
      [invoice("A", 29210, { paymentsKnown: true, paidAmount: D(29210) })],
      paid,
      "ALREADY_PAID",
    ],
    [
      "Számlázz.hu recorded a part",
      [invoice("A", 29210, { paymentsKnown: true, paidAmount: D(10000) })],
      paid,
      "PARTLY_PAID",
    ],
    [
      "a transfer invoice",
      [invoice("A", 29210, { missingPayments: "UNPAID" })],
      paid,
      "NOT_CARD",
    ],
    [
      "a foreign-currency invoice",
      [invoice("A", 29210, { currency: "EUR" })],
      paid,
      "FOREIGN_CURRENCY",
    ],
    [
      "a foreign-currency line",
      [invoice("A", 29210)],
      [line("1", "COMPLETED", 29210, "2026-09-28", "EUR")],
      "FOREIGN_CURRENCY",
    ],
    [
      "a status other than COMPLETED and REFUND",
      [invoice("A", 29210)],
      [...paid, line("2", "CHARGEBACK", 29210, "2026-09-30")],
      "UNKNOWN_STATUS",
    ],
    [
      "a refund with no payment",
      [invoice("A", 29210)],
      [line("2", "REFUND", 29210, "2026-09-30")],
      "NOT_SETTLED",
    ],
    [
      "paid 1 Ft less than the gross",
      [invoice("A", 29211)],
      paid,
      "AMOUNT_MISMATCH",
    ],
    [
      "paid more than the gross",
      [invoice("A", 29000)],
      paid,
      "AMOUNT_MISMATCH",
    ],
  ];
  for (const [name, invoices, lines, reason] of cases)
    it(`${name}: ${reason}`, () => {
      assert.equal(reasonOf(decide(lines, invoices)), reason);
    });
});

describe("the dry run's list and switch", () => {
  it("lists the marks by day, then each skipped order with its reason and the unkeyed count", () => {
    const report = dryRunReport(
      [
        decideSimplePayOrder({
          orderKey: "665707",
          lines: [line("2", "COMPLETED", 5000, "2026-09-29")],
          invoices: [invoice("ACRW-2026/00520", 5000)],
        }),
        decideSimplePayOrder({
          orderKey: "665706",
          lines: [line("1", "COMPLETED", 29210, "2026-09-28")],
          invoices: [invoice("ACRW-2026/00512", 29210)],
        }),
        decideSimplePayOrder({
          orderKey: "665708",
          lines: [
            line("3", "COMPLETED", 8000, "2026-09-28"),
            line("4", "REFUND", 8000, "2026-09-30"),
          ],
          invoices: [invoice("ACRW-2026/00515", 8000)],
        }),
      ],
      2,
    );
    assert.equal(
      report,
      [
        "ACRW-2026/00512\t29210 Ft\t2026-09-28\tbankkártya\tSimplePay, 2026-09-28, tranzakció: 1",
        "ACRW-2026/00520\t5000 Ft\t2026-09-29\tbankkártya\tSimplePay, 2026-09-29, tranzakció: 2",
        "ACRW-2026/00515\trendelés 47679-665708\tfizetve 8000 Ft, visszatérítve 8000 Ft\tkimarad: visszatérítve: nem fizetés",
        "2 teljesült SimplePay-fizetés rendelésszám nélkül: számlához nem köthető",
        "összesen: 2 számla jelölhető, 3 rendelésből",
      ].join("\n") + "\n",
    );
  });

  it("the switch is off unless it says dry or live", () => {
    assert.deepEqual(
      [undefined, "", "on", "DRY", " dry ", "live"].map(simplePayMarkPaidMode),
      ["off", "off", "off", "off", "dry", "live"],
    );
  });
});
