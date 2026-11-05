import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  bankTransferPlanFrom,
  decideBankTransfer,
  runBankTransferMarks,
  type BankCredit,
  type FeedInvoice,
} from "./bank-transfer-paid-marks.js";
import { PAID_MARK_SOURCES } from "./paid-marks/paid-marks-auto.scheduler.js";

/*
  WHAT TURNS THIS RED (card aeddb2c3; Balázs 16:36 UTC; acrobot 42868). Balázs's transfer not marked automatically;
  the invoice Számlázz.hu already paid from the same transfer written a second time; a mark on two customers' invoices
  or on an amount off by a fillér; a payment of another day taken as this transfer's; a proforma, a cancelled or an
  unknown invoice counted; a refusal not listed for a person, or a self-settling one listed.
*/
const DAY = "2026-11-04";
const credit = (over: Partial<BankCredit> = {}): BankCredit => ({
  id: "bt-1",
  amount: "100000.00",
  currency: "HUF",
  bookingDate: DAY,
  valueDate: null,
  narrative: "2026/00083,86,85,84",
  ...over,
});
const invoice = (
  number: string,
  gross: string,
  over: Partial<FeedInvoice> = {},
): FeedInvoice => ({
  documentNumber: `ACRW-2026/${number}`,
  kindCode: "SZ",
  cancelled: false,
  currency: "HUF",
  customerName: "Fővárosi Állat- és Növénykert",
  customerTaxNumber: "15490658-2-42",
  grossAmount: gross,
  paidAmount: "0.00",
  paymentsKnown: true,
  payments: [],
  ...over,
});
// 00083 was paid by Számlázz.hu's own pairing, from this transfer, on its day
const balazs = () => [
  invoice("00083", "10000.00", {
    paidAmount: "10000.00",
    payments: [
      {
        date: DAY,
        amount: "10000",
        title: "átutalás",
        bankTransactionId: "szhu-1",
      },
    ],
  }),
  invoice("00084", "20000.00"),
  invoice("00085", "30000.00"),
  invoice("00086", "40000.00"),
];

describe("one transfer for several of our invoices", () => {
  it("Balázs's transfer: the three open invoices get their marks, the one Számlázz.hu paid does not", () => {
    const decision = decideBankTransfer(credit(), balazs());
    assert.equal(decision.markable, true);
    if (!decision.markable) return;
    assert.deepEqual(
      decision.marks.map((m) => [
        m.invoiceNumber,
        m.amount,
        m.date,
        m.sourceRef,
      ]),
      [
        ["ACRW-2026/00086", "40000.00", DAY, "bt-1"],
        ["ACRW-2026/00085", "30000.00", DAY, "bt-1"],
        ["ACRW-2026/00084", "20000.00", DAY, "bt-1"],
      ],
    );
    assert.deepEqual(decision.paidBefore, ["ACRW-2026/00083"]);
  });

  it("the value date is the transfer's day when the bank gives one", () => {
    const decision = decideBankTransfer(
      credit({ bookingDate: "2026-11-05", valueDate: DAY }),
      balazs(),
    );
    assert.equal(decision.markable && decision.marks[0]!.date, DAY);
  });

  it("a fillér off, or a payment of another day, is not automatic", () => {
    const off = decideBankTransfer(credit({ amount: "99999.99" }), balazs());
    assert.equal(!off.markable && off.refusal, "AMOUNT_MISMATCH");
    assert.match(
      !off.markable ? off.detail : "",
      /utalt 99999\.99, várt 100000\.00/,
    );
    const earlier = balazs();
    earlier[0] = invoice("00083", "10000.00", {
      paidAmount: "10000.00",
      payments: [
        {
          date: "2026-10-30",
          amount: "10000",
          title: "átutalás",
          bankTransactionId: "szhu-0",
        },
      ],
    });
    // 00083 was paid before, by another transfer: this one is 10 000 Ft more than the open three
    const other = decideBankTransfer(credit(), earlier);
    assert.equal(!other.markable && other.refusal, "AMOUNT_MISMATCH");
  });

  it("two customers' invoices are not marked; one customer by the tax base, its name or VAT code aside", () => {
    const two = balazs();
    two[3] = invoice("00086", "40000.00", {
      customerName: "Más Kft.",
      customerTaxNumber: "11111111-2-42",
    });
    const refused = decideBankTransfer(credit(), two);
    assert.equal(!refused.markable && refused.refusal, "DIFFERENT_CUSTOMERS");
    const same = balazs();
    same[3] = invoice("00086", "40000.00", {
      customerName: "Fővárosi Állatkert",
      customerTaxNumber: "15490658-1-42",
    });
    assert.equal(decideBankTransfer(credit(), same).markable, true);
  });

  it("a missing, cancelled or proforma invoice, unknown payments or another currency is not automatic", () => {
    const refusal = (
      invoices: FeedInvoice[],
      over: Partial<BankCredit> = {},
    ) => {
      const decision = decideBankTransfer(credit(over), invoices);
      return !decision.markable && decision.refusal;
    };
    assert.equal(refusal(balazs().slice(0, 3)), "UNRESOLVED");
    const cancelled = balazs();
    cancelled[1] = { ...cancelled[1]!, cancelled: true };
    assert.equal(refusal(cancelled), "UNRESOLVED");
    const proforma = balazs();
    proforma[1] = { ...proforma[1]!, kindCode: "D" };
    assert.equal(refusal(proforma), "UNRESOLVED");
    const unknown = balazs();
    unknown[2] = { ...unknown[2]!, paymentsKnown: null };
    assert.equal(refusal(unknown), "PAYMENTS_UNKNOWN");
    assert.equal(refusal(balazs(), { currency: "EUR" }), "OTHER_CURRENCY");
  });

  it("a rerun after the marks: everything paid that day, nothing to write", () => {
    const paid = balazs().map((i) => ({
      ...i,
      paidAmount: i.grossAmount,
      payments: [{ date: DAY, amount: i.grossAmount, title: "átutalás" }],
    }));
    const decision = decideBankTransfer(credit(), paid);
    assert.equal(!decision.markable && decision.refusal, "ALREADY_PAID");
  });
});

/*
  OUR SERIES WITHOUT A PREFIX (Balázs's live run 2026-11-05 11:05: "2026/00083 nincs" while the invoice was there).
  WHAT TURNS THIS RED: the bare series not matched; of two invoices sharing a bare number, the paid one taken, or
  either taken when both wait for money.
*/
describe("the 2026/ series, numbered without a prefix", () => {
  const bare = (
    number: string,
    gross: string,
    over: Partial<FeedInvoice> = {},
  ) => invoice(number, gross, { documentNumber: `2026/${number}`, ...over });

  it("Balázs's transfer on the real numbers is marked", () => {
    const decision = decideBankTransfer(credit(), [
      bare("00083", "10000.00", {
        paidAmount: "10000.00",
        payments: [
          {
            date: DAY,
            amount: "10000",
            title: "átutalás",
            bankTransactionId: "szhu-1",
          },
        ],
      }),
      bare("00084", "20000.00"),
      bare("00085", "30000.00"),
      bare("00086", "40000.00"),
    ]);
    assert.equal(decision.markable, true);
    if (!decision.markable) return;
    assert.deepEqual(
      decision.marks.map((m) => m.invoiceNumber),
      ["2026/00086", "2026/00085", "2026/00084"],
    );
    // one series only: no narrowing, the plain note
    assert.ok(decision.marks.every((m) => !m.note.includes("előtag nélküli")));
  });

  it("a bare number of two series: the one waiting for money, never the one paid long ago", () => {
    const paidLongAgo = invoice("00084", "7000.00", {
      paidAmount: "7000.00",
      payments: [{ date: "2026-02-01", amount: "7000", title: "átutalás" }],
    });
    const decision = decideBankTransfer(
      credit({ amount: "20000.00", narrative: "2026/00084" }),
      [paidLongAgo, bare("00084", "20000.00")],
    );
    assert.equal(decision.markable, true);
    if (!decision.markable) return;
    assert.deepEqual(
      decision.marks.map((m) => m.invoiceNumber),
      ["2026/00084"],
    );
    // the mark says the series was chosen by the narrowing, so a wrong pick can be traced (barracuda, #2216 b)
    assert.match(
      decision.marks[0]!.note,
      /előtag nélküli számából, a nyitott számlához rendelve$/,
    );
  });

  it("both waiting for money: a person decides", () => {
    const decision = decideBankTransfer(
      credit({ amount: "20000.00", narrative: "2026/00084" }),
      [invoice("00084", "20000.00"), bare("00084", "20000.00")],
    );
    assert.equal(decision.markable, false);
    if (decision.markable) return;
    assert.equal(decision.refusal, "UNRESOLVED");
    assert.equal(decision.detail, "2026/00084 több");
  });
});

describe("a credit already used (barracuda, #2192)", () => {
  it("another source's mark on the credit: not used again", () => {
    const decision = decideBankTransfer(
      credit({
        existingMarks: [
          // on one of the named invoices: the "other invoices" check would let it through
          {
            source: "GLS_COD",
            invoiceNumber: "ACRW-2026/00084",
            state: "WRITTEN",
          },
        ],
      }),
      balazs(),
    );
    assert.equal(!decision.markable && decision.refusal, "CREDIT_USED");
  });

  it("its own marks on the same invoices: a retry, allowed; on other invoices: refused; a FAILED one does not count", () => {
    const retry = decideBankTransfer(
      credit({
        existingMarks: [
          {
            source: "BANK_TRANSFER",
            invoiceNumber: "ACRW-2026/00084",
            state: "WRITTEN",
          },
          {
            source: "BANK_TRANSFER",
            invoiceNumber: "ACRW-2026/00085",
            state: "PLANNED",
          },
        ],
      }),
      balazs(),
    );
    assert.equal(retry.markable, true);
    const other = decideBankTransfer(
      credit({
        existingMarks: [
          {
            source: "BANK_TRANSFER",
            invoiceNumber: "ACRW-2026/00090",
            state: "WRITTEN",
          },
        ],
      }),
      balazs(),
    );
    assert.equal(!other.markable && other.refusal, "CREDIT_USED");
    const failed = decideBankTransfer(
      credit({
        existingMarks: [
          {
            source: "GLS_COD",
            invoiceNumber: "ACRW-2026/00090",
            state: "FAILED",
          },
        ],
      }),
      balazs(),
    );
    assert.equal(failed.markable, true);
  });

  it("a cash payment the same day is not this credit's (#2192 a)", () => {
    const cash = balazs();
    cash[0] = invoice("00083", "10000.00", {
      paidAmount: "10000.00",
      payments: [{ date: DAY, amount: "10000", title: "készpénz" }],
    });
    const decision = decideBankTransfer(credit(), cash);
    assert.equal(!decision.markable && decision.refusal, "AMOUNT_MISMATCH");
  });
});

describe("the plan for the daily run", () => {
  it("marks the markable, lists what a person must see, leaves out a transfer naming none of ours", () => {
    const plan = bankTransferPlanFrom([
      decideBankTransfer(credit(), balazs()),
      decideBankTransfer(
        credit({ id: "bt-2", narrative: "COD-2026.11.03" }),
        [],
      ),
      decideBankTransfer(credit({ id: "bt-3", amount: "1.00" }), balazs()),
      decideBankTransfer(
        credit({ id: "bt-4" }),
        balazs().map((i) => ({
          ...i,
          paidAmount: i.grossAmount,
          payments: [{ date: DAY, amount: i.grossAmount, title: "átutalás" }],
        })),
      ),
    ]);
    assert.equal(plan.source, "BANK_TRANSFER");
    assert.equal(plan.marks.length, 3);
    assert.deepEqual(
      plan.exceptions.map((e) => [e.reason, e.attention]),
      [
        ["AMOUNT_MISMATCH", true],
        ["ALREADY_PAID", false],
      ],
    );
  });
});

describe("the daily run's writer (barracuda, #2192 v2)", () => {
  it("BANK_TRANSFER writes its own way: one credit at a time, under its lock", () => {
    const source = PAID_MARK_SOURCES.find((s) => s.source === "BANK_TRANSFER");
    assert.equal(source?.run, runBankTransferMarks);
  });
});
