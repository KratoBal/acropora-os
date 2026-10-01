import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  codNarrativePrefix,
  dryRunReport,
  glsCodMarkPaidMode,
} from "./gls-cod-paid-marks.dry-run.js";
import {
  decideGlsTransfer,
  type GlsCodReportInput,
  type OutgoingInvoiceInput,
} from "./gls-cod-paid-marks.js";

const D = (value: string | number) => new Prisma.Decimal(value);

const line = (
  invoiceNumbers: string[],
  amount: number,
  status: "RESOLVED" | "NEEDS_REVIEW" = "RESOLVED",
) => ({
  parcelNumber: `P-${invoiceNumbers.join("+")}-${amount}`,
  amount: D(amount),
  status,
  invoiceNumbers,
});

const report = (
  transferDate: string,
  lines: GlsCodReportInput["lines"],
): GlsCodReportInput => ({
  transferDate,
  total: lines.reduce((sum, l) => sum.plus(l.amount), D(0)),
  lines,
});

const invoice = (
  gross: number,
  overrides: Partial<OutgoingInvoiceInput> = {},
): OutgoingInvoiceInput => ({
  grossAmount: D(gross),
  currency: "HUF",
  cancelled: false,
  paymentsKnown: true,
  paidAmount: D(0),
  ...overrides,
});

/*
  SZEPTEMBER, ahogy barracuda mérte (agents/barracuda/utanvet-elszamolas-2026-10-01.md,
  és 25888): a 09-17-i utalás három csomag, betűre, egy 5 forintos kerekítéssel;
  a 09-10-i egy csomag, a HU00920611 GLS-számla beszámítva.
  MI PIROSÍT: ha egy bizonyítatlan utalásból jelölés lenne; ha a kerekítés miatt
  egy számla kimaradna, vagy a beszedett összeggel (1 Ft nyitva hagyva) menne; ha
  egy már kifizetett számla mellé második kifizetés kerülne.
*/
describe("decideGlsTransfer: September as measured", () => {
  const invoices = new Map([
    ["ACRW-2026/00479", invoice(27450)],
    ["ACRW-2026/00481", invoice(105831)],
    ["ACRW-2026/00485", invoice(27600)],
    ["ACRW-2026/00469", invoice(28900)],
  ]);

  it("09-17: three parcels, exact, one rounded to 5 Ft: the gross is marked, the note says what was collected", () => {
    const decision = decideGlsTransfer({
      report: report("2026-09-17", [
        line(["ACRW-2026/00479"], 27450),
        line(["ACRW-2026/00485"], 27600),
        line(["ACRW-2026/00481"], 105830),
      ]),
      compensation: null,
      credits: [{ id: "bt-0917", amount: D(160880) }],
      invoices,
    });
    assert.ok(decision.markable);
    assert.equal(decision.creditId, "bt-0917");
    assert.deepEqual(decision.marks, [
      {
        invoiceNumber: "ACRW-2026/00479",
        date: "2026-09-17",
        amount: "27450",
        title: "utánvét",
        note: "GLS utánvét, 2026-09-17",
      },
      {
        invoiceNumber: "ACRW-2026/00481",
        date: "2026-09-17",
        amount: "105831",
        title: "utánvét",
        note: "GLS utánvét, 2026-09-17, 5 Ft-os kerekítés: beszedve 105830",
      },
      {
        invoiceNumber: "ACRW-2026/00485",
        date: "2026-09-17",
        amount: "27600",
        title: "utánvét",
        note: "GLS utánvét, 2026-09-17",
      },
    ]);
    assert.deepEqual(decision.skipped, []);
  });

  it("09-10: the compensation letter's transferred sum is the bank credit", () => {
    const decision = decideGlsTransfer({
      report: report("2026-09-10", [line(["ACRW-2026/00469"], 28900)]),
      compensation: {
        cod: D(28900),
        transferred: D(10789),
        references: ["HU00920611"],
      },
      credits: [
        { id: "bt-other", amount: D(28900) },
        { id: "bt-0910", amount: D(10789) },
      ],
      invoices,
    });
    assert.ok(decision.markable);
    assert.deepEqual(
      [decision.creditId, decision.marks.map((m) => m.invoiceNumber)],
      ["bt-0910", ["ACRW-2026/00469"]],
    );
  });
});

/*
  A BESZÁMÍTÁS CSAK GLS-SZÁMLÁRA SZÓLHAT (acrobot 25971). 09-03, ahogy a levél
  mondja: 117 450 beszedve, 8 013 beszámítva a HU00912382-re, 109 437 utalva; a
  vevő a teljes összeget fizette. MI PIROSÍT: ha egy csomagszámra (vagy
  megnevezés nélkül) beszámított összeg mellett is jelölhető lenne az utalás;
  ha a beszámítás nélküli levél hivatkozás nélkül is elutasítást kapna.
*/
describe("decideGlsTransfer: a compensation sets off GLS invoices only", () => {
  const invoices = new Map([["ACRW-2026/00467", invoice(117450)]]);
  const decide = (references: string[], transferred = 109437) =>
    decideGlsTransfer({
      report: report("2026-09-03", [line(["ACRW-2026/00467"], 117450)]),
      compensation: {
        cod: D(117450),
        transferred: D(transferred),
        references,
      },
      credits: [{ id: "bt-0903", amount: D(transferred) }],
      invoices,
    });
  const outcome = (d: ReturnType<typeof decideGlsTransfer>) =>
    d.markable ? d.marks.map((m) => m.invoiceNumber) : d.refusal;

  it("09-03: 8 013 Ft set off against HU00912382, the buyer's invoice is paid in full", () => {
    assert.deepEqual(outcome(decide(["HU00912382"])), ["ACRW-2026/00467"]);
  });

  it("a set-off against a parcel, a mixed list or nothing named is refused", () => {
    assert.deepEqual(
      [
        decide(["0021234567890"]),
        decide(["HU00912382", "0021234567890"]),
        decide([]),
        decide(["HU0091238"]),
        decide(["HU009123820"]),
        decide(["XHU00912382"]),
      ].map(outcome),
      [
        "COMPENSATION_NOT_GLS_INVOICE",
        "COMPENSATION_NOT_GLS_INVOICE",
        "COMPENSATION_NOT_GLS_INVOICE",
        "COMPENSATION_NOT_GLS_INVOICE",
        "COMPENSATION_NOT_GLS_INVOICE",
        "COMPENSATION_NOT_GLS_INVOICE",
      ],
    );
  });

  it("a letter that set nothing off needs no reference", () => {
    assert.deepEqual(outcome(decide([], 117450)), ["ACRW-2026/00467"]);
  });
});

describe("decideGlsTransfer: an unproven transfer marks nothing", () => {
  const invoices = new Map([["A-1", invoice(1000)]]);
  const refusal = (input: Partial<Parameters<typeof decideGlsTransfer>[0]>) => {
    const decision = decideGlsTransfer({
      report: report("2026-09-03", [line(["A-1"], 1000)]),
      compensation: null,
      credits: [{ id: "bt", amount: D(1000) }],
      invoices,
      ...input,
    });
    return decision.markable ? null : decision.refusal;
  };

  it("a line in review, a compensation that is not the report, no or two credits", () => {
    assert.equal(refusal({}), null);
    assert.equal(
      refusal({
        report: report("2026-09-03", [
          line(["A-1"], 1000),
          line([], 500, "NEEDS_REVIEW"),
        ]),
      }),
      "REPORT_NEEDS_REVIEW",
    );
    assert.equal(
      refusal({
        compensation: { cod: D(999), transferred: D(1000), references: [] },
      }),
      "COMPENSATION_MISMATCH",
    );
    assert.equal(
      refusal({ credits: [{ id: "x", amount: D(999) }] }),
      "NO_CREDIT",
    );
    assert.equal(
      refusal({
        credits: [
          { id: "x", amount: D(1000) },
          { id: "y", amount: D(1000) },
        ],
      }),
      "AMBIGUOUS_CREDIT",
    );
  });
});

describe("decideGlsTransfer: which invoices of a proven transfer are skipped, and why", () => {
  const decide = (
    lines: GlsCodReportInput["lines"],
    invoices: Map<string, OutgoingInvoiceInput>,
  ) => {
    const r = report("2026-09-17", lines);
    const decision = decideGlsTransfer({
      report: r,
      compensation: null,
      credits: [{ id: "bt", amount: r.total }],
      invoices,
    });
    assert.ok(decision.markable);
    return {
      marked: decision.marks.map((m) => `${m.invoiceNumber}:${m.amount}`),
      skipped: decision.skipped.map((s) => `${s.invoiceNumber}:${s.reason}`),
    };
  };

  it("not found, cancelled, foreign, more than 2 Ft off, unknown payments, already or partly paid", () => {
    assert.deepEqual(
      decide(
        [
          line(["NINCS"], 100),
          line(["STORNO"], 100),
          line(["EUR"], 100),
          line(["ELTER"], 100),
          line(["ISMERETLEN"], 100),
          line(["FIZETETT"], 100),
          line(["RESZBEN"], 100),
          line(["JO"], 100),
        ],
        new Map([
          ["STORNO", invoice(100, { cancelled: true })],
          ["EUR", invoice(100, { currency: "EUR" })],
          ["ELTER", invoice(103)],
          ["ISMERETLEN", invoice(100, { paymentsKnown: false })],
          // a Számlázz.hu saját banki párosítása már rögzítette (acrobot 25894)
          ["FIZETETT", invoice(100, { paidAmount: D(100) })],
          ["RESZBEN", invoice(100, { paidAmount: D(40) })],
          ["JO", invoice(100)],
        ]),
      ),
      {
        marked: ["JO:100"],
        skipped: [
          "ELTER:AMOUNT_MISMATCH",
          "EUR:FOREIGN_CURRENCY",
          "FIZETETT:ALREADY_PAID",
          "ISMERETLEN:PAYMENTS_UNKNOWN",
          "NINCS:NOT_FOUND",
          "RESZBEN:PARTLY_PAID",
          "STORNO:CANCELLED",
        ],
      },
    );
  });

  it("a line paying two invoices is split by their grosses; when they do not add up, both are skipped", () => {
    assert.deepEqual(
      decide(
        [line(["A", "B"], 300)],
        new Map([
          ["A", invoice(100)],
          ["B", invoice(200)],
        ]),
      ),
      { marked: ["A:100", "B:200"], skipped: [] },
    );
    assert.deepEqual(
      decide(
        [line(["A", "B"], 350)],
        new Map([
          ["A", invoice(100)],
          ["B", invoice(200)],
        ]),
      ),
      { marked: [], skipped: ["A:MULTI_INVOICE_LINE", "B:MULTI_INVOICE_LINE"] },
    );
  });

  it("an invoice paid by two parcels is the sum of both", () => {
    assert.deepEqual(
      decide(
        [line(["A"], 60), line(["A"], 40)],
        new Map([["A", invoice(100)]]),
      ),
      { marked: ["A:100"], skipped: [] },
    );
  });
});

describe("the dry run's list and switch", () => {
  it("off unless switched to dry or live; the bank narrative's COD day", () => {
    assert.deepEqual(
      [undefined, "", "on", "dry", " live "].map(glsCodMarkPaidMode),
      ["off", "off", "off", "dry", "live"],
    );
    assert.equal(codNarrativePrefix("2026-09-17"), "COD-2026.09.17");
  });

  it("names a refused transfer and why, every mark, every skip with its reason, and the total", () => {
    const report = dryRunReport([
      {
        transferDate: "2026-09-03",
        markable: false,
        refusal: "REPORT_NEEDS_REVIEW",
        transferred: "109437",
      },
      {
        transferDate: "2026-09-10",
        markable: false,
        refusal: "COMPENSATION_NOT_GLS_INVOICE",
        transferred: "10789",
      },
      {
        transferDate: "2026-09-17",
        markable: true,
        transferred: "160880",
        creditId: "bt",
        marks: [
          {
            invoiceNumber: "ACRW-2026/00481",
            date: "2026-09-17",
            amount: "105831",
            title: "utánvét",
            note: "GLS utánvét, 2026-09-17, 5 Ft-os kerekítés: beszedve 105830",
          },
        ],
        skipped: [{ invoiceNumber: "ACRW-2026/00485", reason: "ALREADY_PAID" }],
      },
    ]);
    assert.equal(
      report,
      [
        "2026-09-03  utalt 109437 Ft  NEM JELÖLHETŐ: a részletező egy sora még ellenőrzésre vár",
        "2026-09-10  utalt 10789 Ft  NEM JELÖLHETŐ: a kompenzációs levél beszámítása nem GLS-számlára szól",
        "2026-09-17  utalt 160880 Ft  jelölhető",
        "  ACRW-2026/00481\t105831 Ft\t2026-09-17\tutánvét\tGLS utánvét, 2026-09-17, 5 Ft-os kerekítés: beszedve 105830",
        "  ACRW-2026/00485\tkimarad: már kifizetett (a Számlázz.hu szerint)",
        "összesen: 1 számla jelölhető, 3 utalásból",
        "",
      ].join("\n"),
    );
  });
});
