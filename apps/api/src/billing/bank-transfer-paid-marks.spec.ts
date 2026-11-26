import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  bankTransferListed,
  bankTransferPlanFrom,
  decideBankTransfer,
  decideBankTransfers,
  runBankTransferMarks,
  type BankCredit,
  type BankRefundDebit,
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
    // no payments element on a card invoice, or with no known method: it may be paid, so not proven open
    for (const missingPayments of ["CARD_AT_ORDER", undefined] as const) {
      const noElement = balazs();
      noElement[2] = {
        ...noElement[2]!,
        paymentsKnown: false,
        missingPayments,
      };
      assert.equal(
        refusal(noElement),
        "PAYMENTS_UNKNOWN",
        String(missingPayments),
      );
    }
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
      /; előtag nélküli szám, a nyitott számlához$/,
    );
    assert.ok(
      decision.marks[0]!.note.length <= 90,
      `${decision.marks[0]!.note.length} karakter`,
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

/*
  BALÁZS'S LIVE RUN 2026-11-05 12:04: his four invoices stood as PAYMENTS_UNKNOWN. A transfer invoice with NO
  `kifizetesek` element is known unpaid (the document list's rule, `outgoingMissingPayments`), not unknown. And a
  "nincs" line says why. WHAT TURNS THIS RED: a transfer invoice with no payments element refused; a reference to a
  cancelled or a proforma document reported as missing from the feed, or the reverse.
*/
describe("a transfer invoice with no payments element, and why a number is not found", () => {
  it("is known unpaid, and Balázs's transfer is marked", () => {
    const unpaid = balazs().map((invoice, i) =>
      i === 0
        ? invoice
        : {
            ...invoice,
            paymentsKnown: false,
            missingPayments: "UNPAID" as const,
          },
    );
    const decision = decideBankTransfer(credit(), unpaid);
    assert.equal(decision.markable, true);
    if (!decision.markable) return;
    assert.deepEqual(
      decision.marks.map((m) => m.invoiceNumber),
      ["ACRW-2026/00086", "ACRW-2026/00085", "ACRW-2026/00084"],
    );
  });

  it("names a missing feed row apart from a cancelled or a proforma document", () => {
    const detail = (rows: FeedInvoice[]) => {
      const d = decideBankTransfer(credit(), rows);
      return d.markable ? "" : d.detail;
    };
    assert.equal(detail(balazs().slice(0, 3)), "2026/00086 nincs a feedben");
    const cancelled = balazs();
    cancelled[1] = { ...cancelled[1]!, cancelled: true };
    assert.equal(
      detail(cancelled),
      "2026/00084 nem fizetendő: ACRW-2026/00084 sztornózott",
    );
    const proforma = balazs();
    proforma[1] = { ...proforma[1]!, kindCode: "D" };
    assert.equal(
      detail(proforma),
      "2026/00084 nem fizetendő: ACRW-2026/00084 díjbekérő",
    );
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

/*
  6fd8c574 (Balázs, 2026-11-05 16:07 UTC): WHAT TURNS THIS RED: a credit another source's WRITTEN or ALREADY_PAID mark
  closed still asking for a person every morning; a PLANNED or UNKNOWN one (a write not known to have happened), or a
  mix, no longer asking; the credit used by our own marks for other invoices let through; the line without the credit
  as its key (the reference is only the day: two transfers of a day would share it).
*/
describe("a credit another source closed (6fd8c574)", () => {
  const usedBy = (...states: string[]) =>
    decideBankTransfer(
      credit({
        existingMarks: states.map((state, i) => ({
          source: i === 0 ? "GLS_COD" : "FOXPOST",
          invoiceNumber: `ACRW-2026/0054${i}`,
          state,
        })),
      }),
      balazs(),
    );
  const attentionOf = (decision: ReturnType<typeof decideBankTransfer>) => {
    const [only] = bankTransferPlanFrom([decision]).exceptions;
    return [only?.reason, only?.attention];
  };

  it("WRITTEN or ALREADY_PAID: counted, not listed", () => {
    assert.deepEqual(attentionOf(usedBy("WRITTEN")), ["CREDIT_USED", false]);
    assert.deepEqual(attentionOf(usedBy("ALREADY_PAID")), [
      "CREDIT_USED",
      false,
    ]);
    assert.deepEqual(attentionOf(usedBy("WRITTEN", "ALREADY_PAID")), [
      "CREDIT_USED",
      false,
    ]);
  });

  it("PLANNED, UNKNOWN or a mix: a person still looks", () => {
    assert.deepEqual(attentionOf(usedBy("PLANNED")), ["CREDIT_USED", true]);
    assert.deepEqual(attentionOf(usedBy("UNKNOWN")), ["CREDIT_USED", true]);
    assert.deepEqual(attentionOf(usedBy("WRITTEN", "PLANNED")), [
      "CREDIT_USED",
      true,
    ]);
  });

  it("the detail names every other source's mark with its state", () => {
    const decision = usedBy("WRITTEN", "PLANNED");
    assert.equal(
      !decision.markable && decision.detail,
      "GLS_COD: ACRW-2026/00540 (WRITTEN), FOXPOST: ACRW-2026/00541 (PLANNED)",
    );
  });

  it("our own written mark on other invoices: still a person's", () => {
    const decision = decideBankTransfer(
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
    assert.deepEqual(attentionOf(decision), ["CREDIT_USED", true]);
  });

  it("the line's key is the credit", () => {
    const [line] = bankTransferPlanFrom([
      decideBankTransfer(credit({ id: "bt-9", amount: "1.00" }), balazs()),
    ]).exceptions;
    assert.equal(line?.reference, `jóváírás ${DAY}`);
    assert.equal(line?.key, "bt-9");
  });
});

describe("the daily run's writer (barracuda, #2192 v2)", () => {
  it("BANK_TRANSFER writes its own way: one credit at a time, under its lock", () => {
    const source = PAID_MARK_SOURCES.find((s) => s.source === "BANK_TRANSFER");
    assert.equal(source?.run, runBankTransferMarks);
  });
});

/*
  THE OTHER SHAPES IN A DECISION (the Banki átutalások survey, 2026-11-18). WHAT TURNS THIS RED: a credit naming a díjbekérő or
  a cancelled invoice by its full number hidden as "no reference" (it must stand as UNRESOLVED with the reason, listed); a full
  Számlázz.hu number that is payable not paired by its exact amount; one missing from the feed not said; an eBIZ number
  (EINV) taken for a Számlázz.hu one, or listed for a person who has nothing to write; our own year/number reference beside
  an EINV number not winning.
*/
describe("our numbers in other shapes, in a decision", () => {
  const own = (number: string, over: Partial<FeedInvoice> = {}) =>
    invoice("x", "11287062.00", { documentNumber: number, ...over });
  const detailOf = (decision: ReturnType<typeof decideBankTransfer>) =>
    decision.markable ? "" : `${decision.refusal}: ${decision.detail}`;

  it("a díjbekérő by its full number, paid by another amount: said with both amounts, and listed", () => {
    const decision = decideBankTransfer(
      credit({ narrative: "D-CRPR-7", amount: "1121819.00" }),
      [own("D-CRPR-7", { kindCode: "D" })],
    );
    assert.equal(
      detailOf(decision),
      "AMOUNT_MISMATCH: D-CRPR-7 díjbekérő: utalt 1121819.00, várt 11287062.00",
    );
    assert.equal(bankTransferListed(decision, [], false), true);
  });

  it("a cancelled invoice by its full number, with no refund found: unresolved, and the customer's references are not ours", () => {
    const decision = decideBankTransfer(
      credit({
        narrative: "KXT/2026/003674 E-CRPR-2026-1 S/2026/0004363",
        amount: "11287062.00",
      }),
      [own("E-CRPR-2026-1", { cancelled: true })],
    );
    assert.equal(
      detailOf(decision),
      "UNRESOLVED: E-CRPR-2026-1 nem fizetendő: E-CRPR-2026-1 sztornózott",
    );
  });

  it("a full number missing from the feed is said so", () => {
    const decision = decideBankTransfer(
      credit({ narrative: "E-CRPR-2026-9" }),
      [],
    );
    assert.equal(
      detailOf(decision),
      "UNRESOLVED: E-CRPR-2026-9 nincs a feedben",
    );
  });

  it("a payable full number pairs by the exact amount, like a year/number one", () => {
    const decision = decideBankTransfer(
      credit({ narrative: "E-CRPR-2026-2 kifizetés", amount: "5000.00" }),
      [own("E-CRPR-2026-2", { grossAmount: "5000.00" })],
    );
    assert.equal(decision.markable, true);
    assert.deepEqual(
      decision.markable && decision.marks.map((m) => m.invoiceNumber),
      ["E-CRPR-2026-2"],
    );
    const off = decideBankTransfer(
      credit({ narrative: "E-CRPR-2026-2", amount: "4999.99" }),
      [own("E-CRPR-2026-2", { grossAmount: "5000.00" })],
    );
    assert.equal(!off.markable && off.refusal, "AMOUNT_MISMATCH");
  });

  it("an eBIZ number is OTHER_SYSTEM: said, not listed by default, not the plan's attention", () => {
    const decision = decideBankTransfer(
      credit({ narrative: "EINV000000819 számla kif.", amount: "256340.00" }),
      [],
    );
    assert.equal(detailOf(decision), "OTHER_SYSTEM: EINV000000819");
    assert.equal(bankTransferListed(decision, [], false), false);
    assert.equal(bankTransferListed(decision, [], true), true);
    // nothing to pair here: not an exception line at all (a transfer naming none of ours is left out of the plan the same way)
    assert.deepEqual(bankTransferPlanFrom([decision]).exceptions, []);
  });

  it("our own year/number reference beside an eBIZ number wins; a transfer naming neither stays NO_REFERENCE", () => {
    const both = decideBankTransfer(
      credit({ narrative: "2026/00084 és EINV000000819", amount: "20000.00" }),
      balazs(),
    );
    assert.equal(both.markable, true);
    assert.equal(
      decideBankTransfer(credit({ narrative: "köszönöm" }), balazs())
        .markable === false,
      true,
    );
    assert.equal(
      detailOf(decideBankTransfer(credit({ narrative: "köszönöm" }), balazs())),
      "NO_REFERENCE: ",
    );
  });
});

/*
  THE PAGE'S LIST (the Banki átutalások survey, 2026-11-18, live: 15 of the 20 default rows were GLS/Foxpost credits another
  source had WRITTEN, each with the sentence meant for a case a person must solve). WHAT TURNS THIS RED: a credit another source
  closed for sure shown by default; one that is not sure (PLANNED, UNKNOWN) hidden; the page deciding by another definition than
  the daily plan's (`attention`); a credit with our own written mark hidden; `all` not showing everything.
*/
describe("the page's list shows what a person looks at, by the plan's own definition", () => {
  const usedBy = (...states: string[]) =>
    decideBankTransfer(
      credit({
        existingMarks: states.map((state, i) => ({
          source: i === 0 ? "GLS_COD" : "FOXPOST",
          invoiceNumber: `ACRW-2026/0054${i}`,
          state,
        })),
      }),
      balazs(),
    );

  it("a credit another source closed for sure is not listed by default, but `all` lists it", () => {
    for (const decision of [
      usedBy("WRITTEN"),
      usedBy("ALREADY_PAID"),
      usedBy("WRITTEN", "ALREADY_PAID"),
    ]) {
      assert.equal(bankTransferListed(decision, [], false), false);
      assert.equal(bankTransferListed(decision, [], true), true);
    }
  });

  it("PLANNED, UNKNOWN or a mix is listed: a person still looks", () => {
    for (const decision of [
      usedBy("PLANNED"),
      usedBy("UNKNOWN"),
      usedBy("WRITTEN", "PLANNED"),
    ])
      assert.equal(bankTransferListed(decision, [], false), true);
  });

  it("the same definition as the daily plan: for a used credit, listed is the plan's attention", () => {
    for (const decision of [
      usedBy("WRITTEN"),
      usedBy("PLANNED"),
      usedBy("UNKNOWN"),
      usedBy("WRITTEN", "PLANNED"),
      usedBy("ALREADY_PAID"),
    ]) {
      const [line] = bankTransferPlanFrom([decision]).exceptions;
      assert.equal(
        bankTransferListed(decision, [], false),
        line?.attention,
        decision.markable ? "" : decision.detail,
      );
    }
  });

  it("a credit with our own written mark stays listed, even when another source also closed it", () => {
    assert.equal(
      bankTransferListed(usedBy("WRITTEN"), ["ACRW-2026/00090"], false),
      true,
    );
  });

  it("what was listed before stays: markable, unresolved, already paid; a transfer naming none of ours does not", () => {
    const named = decideBankTransfer(
      credit({ narrative: "2026/00083,86,85,84", amount: "100000.50" }),
      balazs(),
    );
    assert.equal(bankTransferListed(named, [], false), true);
    const none = decideBankTransfer(
      credit({ narrative: "köszönöm" }),
      balazs(),
    );
    assert.equal(bankTransferListed(none, [], false), false);
    assert.equal(bankTransferListed(none, [], true), true);
    const missing = decideBankTransfer(
      credit({ narrative: "2026/00083,87", amount: "10000" }),
      balazs(),
    );
    assert.equal(bankTransferListed(missing, [], false), true);
  });
});

/*
  CREDITS THAT ARE NOT AN INVOICE'S PAYMENT (the Banki átutalások survey, 2026-11-18, acrobot 55708): of 127 live credits, 14 came
  in our own company's name (transfers, EUR->HUF exchange; 16 036 940 Ft), 57 were OTP card-acquiring settlements and 11 SimplePay
  settlements. All stood as "no reference". WHAT TURNS THIS RED: one of them without its own reason; one listed by default or
  the plan's attention; a CUSTOMER named alike (not our company, not those providers) swallowed; one that names our invoice
  read as a non-payment; the reason said only when the text has no reference.
*/
describe("credits that are not an invoice's payment get their own reason", () => {
  const kindOf = (over: Partial<BankCredit>) => {
    const decision = decideBankTransfer(credit(over), balazs());
    return decision.markable ? "MARKABLE" : decision.refusal;
  };

  it("our own company's name: OWN_ACCOUNT, whatever the text (empty, an exchange)", () => {
    for (const narrative of ["", "362,36 1.000,00 EUR"])
      assert.equal(
        kindOf({ narrative, counterpartyName: "ACROPORA KER.ÉS SZOLG.KFT" }),
        "OWN_ACCOUNT",
        narrative,
      );
    assert.equal(
      kindOf({ narrative: "", counterpartyName: "Acropora Kft." }),
      "OWN_ACCOUNT",
    );
  });

  it("the OTP card-acquiring settlement, in both spellings the bank wrote: CARD_SETTLEMENT", () => {
    for (const counterpartyName of [
      "OTP Bank Nyrt. KELFO Kártyaelfog",
      "OTP Bank Nyrt. KELFO Kártyaelfogadói Főosztály",
    ])
      assert.equal(
        kindOf({
          narrative:
            "Elszamolas a kartya elfogadoval                       61425/2026.11.18",
          counterpartyName,
        }),
        "CARD_SETTLEMENT",
      );
    // the text alone says it too, with no partner name
    assert.equal(
      kindOf({ narrative: "Elszamolas a kartya elfogadoval 61425/2026.11.14" }),
      "CARD_SETTLEMENT",
    );
  });

  it("the SimplePay settlement: PAYMENT_PROVIDER", () => {
    assert.equal(
      kindOf({
        narrative: "T714027699 report_20261111",
        counterpartyName: "SIMPLEPAY ZRT.",
      }),
      "PAYMENT_PROVIDER",
    );
  });

  it("a customer named alike, and an ordinary credit, stay NO_REFERENCE", () => {
    for (const counterpartyName of [
      "Acropora Aquarium Kft.",
      "OTP Bank Nyrt.",
      "Simple Pay Kft.",
      // the letters "kelfo" inside another word are not the OTP department (barracuda, #2685)
      "Kelfold Kereskedelmi Kft.",
      "Pankelfo Bt.",
      "Állatkert",
      null,
    ])
      assert.equal(
        kindOf({ narrative: "köszönöm", counterpartyName }),
        "NO_REFERENCE",
        String(counterpartyName),
      );
  });

  it("a credit that names our invoice is that invoice's, whoever sends it", () => {
    assert.equal(
      kindOf({
        narrative: "2026/00084",
        amount: "20000.00",
        counterpartyName: "ACROPORA KER.ÉS SZOLG.KFT",
      }),
      "MARKABLE",
    );
  });

  it("not listed by default, listed with `all`, and not a line of the plan", () => {
    for (const [narrative, counterpartyName] of [
      ["", "ACROPORA KER.ÉS SZOLG.KFT"],
      [
        "Elszamolas a kartya elfogadoval 61425/2026.11.18",
        "OTP Bank Nyrt. KELFO",
      ],
      ["T714027699 report_20261111", "SIMPLEPAY ZRT."],
    ] as const) {
      const decision = decideBankTransfer(
        credit({ narrative, counterpartyName }),
        balazs(),
      );
      assert.equal(bankTransferListed(decision, [], false), false, narrative);
      assert.equal(bankTransferListed(decision, [], true), true, narrative);
      assert.deepEqual(
        bankTransferPlanFrom([decision]).exceptions,
        [],
        narrative,
      );
    }
  });
});

/*
  LUCA'S THREE BANK ROWS (2026-11-18, acrobot 55993, 56006, 56014). WHAT TURNS THIS RED:
  - a credit naming a díjbekérő by its number stays "nem fizetendő" / manual pairing (it is the proforma's payment, the invoice
    comes from Számlázz.hu's Autokassza); one with a different amount is not said so; an invoice found from the proforma not
    named, or one that is still open written as paid (nothing is written for a proforma);
  - a credit whose invoice was cancelled and whose money went back out stays "nem fizetendő: sztornózott" (a refund of the same
    amount, on or after the credit's day, naming the invoice or going to the same payer); a refund of another amount, an earlier
    one or one to somebody else taken for it;
  - a credit Számlázz.hu already booked on its invoice stands as something to decide, or a second credit naming the same invoice
    is not flagged as a possible double payment.
*/
describe("Luca's three bank rows", () => {
  const PAYER = "BODNÁR FERENC ÁDÁM";
  const proforma = (over: Partial<FeedInvoice> = {}): FeedInvoice => ({
    ...invoice("x", "1121819.00", {
      documentNumber: "D-CRPR-7",
      kindCode: "D",
      customerName: "Bodnár Ferenc Ádám",
      customerTaxNumber: null,
      issueDate: "2026-11-10",
    }),
    ...over,
  });
  const dijbekero = (over: Partial<BankCredit> = {}) =>
    credit({
      narrative: "D-CRPR-7",
      amount: "1121819.00",
      bookingDate: "2026-11-16",
      counterpartyName: PAYER,
      ...over,
    });
  const fromProforma = (over: Partial<FeedInvoice> = {}): FeedInvoice =>
    invoice("x", "1121819.00", {
      documentNumber: "ACRW-2026/00120",
      customerName: "Bodnár Ferenc Ádám",
      customerTaxNumber: null,
      issueDate: "2026-11-16",
      ...over,
    });

  it("a díjbekérő paid by exactly its gross: its own state, nothing to write, and a person sees it until its invoice is paid", () => {
    const decision = decideBankTransfer(dijbekero(), [proforma()]);
    assert.equal(!decision.markable && decision.refusal, "PROFORMA");
    assert.match(!decision.markable ? decision.detail : "", /D-CRPR-7/);
    assert.equal(bankTransferListed(decision, [], false), true);
    const plan = bankTransferPlanFrom([decision]);
    assert.deepEqual(plan.marks, []);
    assert.deepEqual(
      plan.exceptions.map((e) => [e.reason, e.attention]),
      [["PROFORMA", true]],
    );
  });

  // barracuda, #2700: the money came, and the invoice from the díjbekérő is missing or still open: Autokassza did not do its work
  it("the díjbekérő with no invoice from it, or one still open, asks attention; the one that ends in a paid invoice asks nothing", () => {
    const attentionOf = (invoices: FeedInvoice[]) =>
      bankTransferPlanFrom([decideBankTransfer(dijbekero(), invoices)])
        .exceptions[0]!.attention;
    assert.equal(attentionOf([proforma()]), true);
    assert.equal(attentionOf([proforma(), fromProforma()]), true);
    assert.equal(
      attentionOf([
        proforma(),
        fromProforma({
          paidAmount: "1121819.00",
          payments: [
            {
              date: "2026-11-16",
              amount: "1121819",
              title: "átutalás",
              bankTransactionId: "szhu-9",
            },
          ],
        }),
      ]),
      false,
    );
  });

  it("a díjbekérő paid by another amount: the amounts are said, and a person looks", () => {
    const decision = decideBankTransfer(dijbekero({ amount: "1000000.00" }), [
      proforma(),
    ]);
    assert.equal(!decision.markable && decision.refusal, "AMOUNT_MISMATCH");
    assert.match(
      !decision.markable ? decision.detail : "",
      /D-CRPR-7 díjbekérő: utalt 1000000\.00, várt 1121819\.00/,
    );
  });

  it("the invoice Számlázz.hu issued from it, already paid by this transfer: already paid, the invoice named", () => {
    const issued = fromProforma({
      paidAmount: "1121819.00",
      payments: [
        {
          date: "2026-11-16",
          amount: "1121819",
          title: "átutalás",
          bankTransactionId: "szhu-9",
        },
      ],
    });
    const decision = decideBankTransfer(dijbekero(), [proforma(), issued]);
    assert.equal(!decision.markable && decision.refusal, "ALREADY_PAID");
    assert.match(
      !decision.markable ? decision.detail : "",
      /ACRW-2026\/00120.*D-CRPR-7/,
    );
  });

  it("the invoice from it still open: the proforma state, the invoice named, nothing written", () => {
    const decision = decideBankTransfer(dijbekero(), [
      proforma(),
      fromProforma(),
    ]);
    assert.equal(!decision.markable && decision.refusal, "PROFORMA");
    assert.match(!decision.markable ? decision.detail : "", /ACRW-2026\/00120/);
    assert.deepEqual(bankTransferPlanFrom([decision]).marks, []);
  });

  it("an invoice from before the díjbekérő, a cancelled one, another buyer's or two candidates are not 'the one issued from it'", () => {
    const named = (candidates: FeedInvoice[]) => {
      const decision = decideBankTransfer(dijbekero(), [
        proforma(),
        ...candidates,
      ]);
      return !decision.markable ? decision.detail : "";
    };
    assert.doesNotMatch(
      named([fromProforma({ issueDate: "2026-11-01" })]),
      /ACRW-2026/,
    );
    assert.doesNotMatch(
      named([fromProforma({ cancelled: true })]),
      /ACRW-2026/,
    );
    assert.doesNotMatch(
      named([fromProforma({ customerName: "Más Vevő Kft." })]),
      /ACRW-2026/,
    );
    assert.doesNotMatch(
      named([
        fromProforma(),
        fromProforma({ documentNumber: "ACRW-2026/00121" }),
      ]),
      /ACRW-2026/,
    );
  });

  // the cancelled invoice paid, then the money sent back (Luca: 11 287 062 Ft, E-CRPR-2026-1)
  const cancelled = () =>
    invoice("x", "11287062.00", {
      documentNumber: "E-CRPR-2026-1",
      cancelled: true,
      customerName: "Fővárosi Állat- és Növénykert",
    });
  const returned = (over: Partial<BankCredit> = {}) =>
    credit({
      narrative: "HCUT/2026/003674 E-CRPR-2026-1 S/2026/0004363",
      amount: "11287062.00",
      bookingDate: "2026-11-03",
      counterpartyName: "FŐVÁROSI ÁLLAT- ÉS NÖVÉNYKERT",
      ...over,
    });
  const refund = (over: Partial<BankRefundDebit> = {}): BankRefundDebit => ({
    day: "2026-11-05",
    amount: "11287062.00",
    currency: "HUF",
    narrative: "E-CRPR-2026-1 utalás vissza",
    counterpartyName: "Fővárosi Állat- és Növénykert",
    ...over,
  });

  it("a cancelled invoice whose money went back out: visszafizetve, with the day, nothing written", () => {
    const decision = decideBankTransfer(returned(), [cancelled()], [refund()]);
    assert.equal(!decision.markable && decision.refusal, "REFUNDED");
    assert.match(
      !decision.markable ? decision.detail : "",
      /E-CRPR-2026-1.*2026-11-05/,
    );
    const plan = bankTransferPlanFrom([decision]);
    assert.deepEqual(plan.marks, []);
    assert.deepEqual(
      plan.exceptions.map((e) => [e.reason, e.attention]),
      [["REFUNDED", false]],
    );
  });

  it("the refund naming the invoice or going to the same payer both count; a stranger's, an earlier or another amount do not", () => {
    const refusalFor = (debits: BankRefundDebit[]) => {
      const decision = decideBankTransfer(returned(), [cancelled()], debits);
      return !decision.markable && decision.refusal;
    };
    assert.equal(
      refusalFor([refund({ counterpartyName: "Valaki Más Kft." })]),
      "REFUNDED",
    ); // the narrative names the invoice
    assert.equal(
      refusalFor([refund({ narrative: "visszautalás" })]),
      "REFUNDED",
    ); // the same payer
    assert.equal(
      refusalFor([
        refund({ narrative: "visszautalás", counterpartyName: "Valaki Más" }),
      ]),
      "UNRESOLVED",
    );
    assert.equal(refusalFor([refund({ day: "2026-11-02" })]), "UNRESOLVED");
    assert.equal(refusalFor([refund({ amount: "11287061.99" })]), "UNRESOLVED");
    assert.equal(refusalFor([refund({ currency: "EUR" })]), "UNRESOLVED");
    assert.equal(refusalFor([]), "UNRESOLVED");
  });

  it("a number that fits a cancelled invoice AND another document is ambiguous: not 'refunded'", () => {
    const decision = decideBankTransfer(
      credit({
        narrative: "2026/00084",
        amount: "20000.00",
        counterpartyName: "Fővárosi Állat- és Növénykert",
      }),
      [
        invoice("00084", "20000.00", { cancelled: true }),
        invoice("00084", "20000.00", {
          documentNumber: "ACRL-2026/00084",
          kindCode: "SL",
        }),
      ],
      [refund({ amount: "20000.00", narrative: "2026/00084 vissza" })],
    );
    assert.equal(!decision.markable && decision.refusal, "UNRESOLVED");
  });

  it("a cancelled invoice and a live one in one text are not 'refunded' as a whole", () => {
    const decision = decideBankTransfer(
      returned({ narrative: "E-CRPR-2026-1 2026/00083" }),
      [cancelled(), ...balazs()],
      [refund()],
    );
    assert.equal(!decision.markable && decision.refusal, "UNRESOLVED");
  });

  // the credit Számlázz.hu already booked (Luca: 190 488 Ft, 2026/00076): it is that invoice's payment
  const booked = () =>
    invoice("00076", "190488.00", {
      paidAmount: "190488.00",
      payments: [
        {
          date: "2026-10-12",
          amount: "190488",
          title: "átutalás",
          bankTransactionId: "szhu-7",
        },
      ],
    });
  const bookedCredit = (id: string, over: Partial<BankCredit> = {}) =>
    credit({
      id,
      narrative: "HCUT/2026/003398 2026/00076 S/2026/0004190",
      amount: "190488.00",
      bookingDate: "2026-10-12",
      ...over,
    });

  it("a credit Számlázz.hu booked, with no other credit naming the invoice: already paid, no attention", () => {
    const [decision] = decideBankTransfers([bookedCredit("a")], [booked()]);
    assert.equal(!decision!.markable && decision!.refusal, "ALREADY_PAID");
    assert.equal(!decision!.markable && decision!.sharedWith, undefined);
    assert.equal(
      bankTransferPlanFrom([decision!]).exceptions[0]!.attention,
      false,
    );
  });

  it("a second credit naming the same invoice the same day: both flagged as a possible double payment, and the plan asks a person", () => {
    const decisions = decideBankTransfers(
      [bookedCredit("a"), bookedCredit("b")],
      [booked()],
    );
    for (const [index, other] of [
      [0, "b"],
      [1, "a"],
    ] as const) {
      const decision = decisions[index]!;
      assert.equal(!decision.markable && decision.refusal, "ALREADY_PAID");
      assert.deepEqual(!decision.markable && decision.sharedWith, [other]);
    }
    assert.deepEqual(
      bankTransferPlanFrom(decisions).exceptions.map((e) => e.attention),
      [true, true],
    );
  });

  it("a credit of another day for an invoice paid long before: paid earlier, a person looks (it may be a double payment)", () => {
    const decision = decideBankTransfer(
      bookedCredit("b", { bookingDate: "2026-10-14" }),
      [booked()],
    );
    assert.equal(!decision.markable && decision.refusal, "PAID_EARLIER");
    assert.match(
      !decision.markable ? decision.detail : "",
      /ACRW-2026\/00076.*2026-10-12/,
    );
    assert.equal(
      bankTransferPlanFrom([decision]).exceptions[0]!.attention,
      true,
    );
    assert.equal(bankTransferListed(decision, [], false), true);
  });

  it("a part-paid invoice with another day's payment is still an amount question, not 'paid earlier'", () => {
    const part = invoice("00076", "200000.00", {
      paidAmount: "10000.00",
      payments: [{ date: "2026-10-01", amount: "10000", title: "átutalás" }],
    });
    const decision = decideBankTransfer(
      bookedCredit("b", { amount: "5000.00" }),
      [part],
    );
    assert.equal(!decision.markable && decision.refusal, "AMOUNT_MISMATCH");
  });

  it("a credit that is paired on another invoice is not a second credit for this one", () => {
    const decisions = decideBankTransfers(
      [
        bookedCredit("a"),
        credit({ id: "c", narrative: "2026/00084", amount: "20000.00" }),
      ],
      [booked(), invoice("00084", "20000.00")],
    );
    assert.equal(
      !decisions[0]!.markable && decisions[0]!.sharedWith,
      undefined,
    );
  });
});

/*
  AN INVOICE MADE IN CASHMAN (2026-11-26, Balázs: "ez sose lesz megoldva?"; acrobot 62980). The Állatkert's 34 671 Ft named
  2026/00058, which NAV alone holds (card 785dfea6), and the page said "nincs a feedben". WHAT TURNS THIS RED: such an invoice
  marked (Számlázz.hu does not know it), reported as missing, hidden from the default list, or put on the attention list.
*/
describe("an invoice NAV alone holds (CASHMAN's)", () => {
  const allatkert = (over: Partial<FeedInvoice> = {}) =>
    invoice("x", "34671.00", { documentNumber: "2026/00058", ...over });
  const transfer = credit({
    id: "bt-allatkert",
    amount: "34671.00",
    bookingDate: "2026-11-12",
    narrative: "HCUT/2026/003814 2026/00058 S/2026/0005034",
  });

  it("is found and said to be CASHMAN's: no mark, listed by default, not on the attention list", () => {
    const decision = decideBankTransfer(transfer, [
      allatkert({ onlyInNav: true, paymentsKnown: null }),
    ]);
    assert.equal(decision.markable, false);
    if (decision.markable) return;
    assert.equal(decision.refusal, "OTHER_PROGRAM");
    assert.equal(decision.detail, "2026/00058");
    assert.equal(bankTransferListed(decision, [], false), true);
    const plan = bankTransferPlanFrom([decision]);
    assert.deepEqual(plan.marks, []);
    assert.equal(plan.exceptions[0]?.attention, false);
  });

  it("the same invoice from the Számlázz.hu feed pairs: the source decides, not the number", () => {
    const decision = decideBankTransfer(transfer, [allatkert()]);
    assert.equal(decision.markable, true);
  });

  it("beside invoices Számlázz.hu knows, the credit is still not paired, and only the NAV one is named", () => {
    const rows = balazs();
    rows[1] = { ...rows[1]!, onlyInNav: true };
    const decision = decideBankTransfer(credit(), rows);
    assert.equal(decision.markable, false);
    if (decision.markable) return;
    assert.equal(decision.refusal, "OTHER_PROGRAM");
    assert.equal(decision.detail, "ACRW-2026/00084");
  });
});

/*
  A BARE NUMBER OF SEVERAL SERIES, AND THE CREDIT'S AMOUNT (2026-11-26, live after #3044, acrobot 63087: the Állatkert's 34 671 Ft
  named `2026/00058`, and the page said "2026/00058 több"; a NAV-only invoice has no payments, so the open-or-paid narrowing
  never drops it). WHAT TURNS THIS RED: the one candidate whose gross is the credit is not chosen; one is chosen when two have that
  gross, when none has it, or when the text names several invoices (then the credit is their sum); the mark does not say why.
*/
describe("a bare number of several series, chosen by the credit's amount", () => {
  const allatkert = credit({
    id: "bt-allatkert",
    amount: "34671.00",
    bookingDate: "2026-11-12",
    narrative: "HCUT/2026/003814 2026/00058 S/2026/0005034",
  });
  const cashman = invoice("x", "34671.00", {
    documentNumber: "2026/00058",
    onlyInNav: true,
    paymentsKnown: null,
  });

  it("the Állatkert: of a CASHMAN invoice and another series' open one, the CASHMAN one by the amount, and it is said so", () => {
    for (const other of [
      invoice("00058", "12000.00", { customerName: "Más Vevő Kft." }),
      invoice("00058", "12000.00", { onlyInNav: true, paymentsKnown: null }),
    ]) {
      const decision = decideBankTransfer(allatkert, [other, cashman]);
      assert.equal(decision.markable, false);
      if (decision.markable) return;
      assert.equal(decision.refusal, "OTHER_PROGRAM");
      assert.equal(decision.detail, "2026/00058");
    }
  });

  it("a Számlázz.hu invoice chosen by the amount is marked, and the mark says the amount chose it", () => {
    const decision = decideBankTransfer(
      credit({ amount: "20000.00", narrative: "2026/00084" }),
      [
        invoice("00084", "7000.00"),
        invoice("x", "20000.00", { documentNumber: "2026/00084" }),
      ],
    );
    assert.equal(decision.markable, true);
    if (!decision.markable) return;
    assert.deepEqual(
      decision.marks.map((m) => m.invoiceNumber),
      ["2026/00084"],
    );
    assert.match(
      decision.marks[0]!.note,
      /; előtag nélküli szám, az összeg szerint$/,
    );
    assert.ok(
      decision.marks[0]!.note.length <= 90,
      `${decision.marks[0]!.note.length} karakter`,
    );
  });

  it("two with the credit's gross, none with it, or a text naming several invoices: a person decides", () => {
    const two = decideBankTransfer(allatkert, [
      invoice("00058", "34671.00", { onlyInNav: true, paymentsKnown: null }),
      cashman,
    ]);
    assert.equal(!two.markable && two.detail, "2026/00058 több");

    const none = decideBankTransfer(allatkert, [
      invoice("00058", "12000.00", { onlyInNav: true, paymentsKnown: null }),
      invoice("x", "15000.00", {
        documentNumber: "2026/00058",
        onlyInNav: true,
        paymentsKnown: null,
      }),
    ]);
    assert.equal(!none.markable && none.detail, "2026/00058 több");

    // "2026/00058,59": the credit is the two invoices' sum, so one invoice's gross says nothing
    const several = decideBankTransfer(
      { ...allatkert, narrative: "2026/00058,59" },
      [
        invoice("00058", "12000.00", { onlyInNav: true, paymentsKnown: null }),
        cashman,
        invoice("x", "1.00", { documentNumber: "2026/00059" }),
      ],
    );
    assert.equal(!several.markable && several.detail, "2026/00058 több");
  });
});
