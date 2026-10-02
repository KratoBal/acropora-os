import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import type { OutgoingInvoiceInput } from "../szamlazz/cod-invoice-marks.js";
import {
  foxpostDryRunReport,
  foxpostMarkPaidMode,
} from "./foxpost-paid-marks.dry-run.js";
import {
  decideFoxpostSettlement,
  foxpostNarrativeMark,
  type FoxpostCandidateInvoice,
  type FoxpostSettlementInput,
} from "./foxpost-paid-marks.js";

const D = (value: number | string) => new Prisma.Decimal(value);

const line = (referenceCode: string, amount: number) => ({
  referenceCode,
  collectedAmount: D(amount),
});

/** A settlement whose sums agree: COD = the lines, transferred = COD - fee. */
const settlement = (
  lines: FoxpostSettlementInput["lines"],
  fee = 4500,
  overrides: Partial<FoxpostSettlementInput> = {},
): FoxpostSettlementInput => {
  const cod = lines.reduce((s, l) => s.plus(l.collectedAmount), D(0));
  return {
    settlementCode: "26H38",
    partnerCode: "W0166840",
    status: "COMPLETED",
    collectedAmount: cod,
    invoiceGrossAmount: D(fee),
    transferredAmount: cod.minus(fee),
    lines,
    ...overrides,
  };
};

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

const candidate = (
  invoiceNumber: string,
  orderNumber: string | null,
  gross: number,
  cancelled = false,
): FoxpostCandidateInvoice => ({
  invoiceNumber,
  orderNumber,
  grossAmount: D(gross),
  cancelled,
});

/*
  A FOXPOST HETI ELSZÁMOLÁS (acrobot 25982, 25993). A csapdák barracudától: a
  beszámított Foxpost-számla az utalásban (az utalt = utánvét - a számla), és a
  sztornó-pár (47679-279201: 00483 + / 00490 -). MI PIROSÍT: ha az utalt
  összeget a beszámítás nélkül keresné; ha egy sztornózott rendelésre jelölés
  menne, vagy két élő számla közül választana; ha a jelölés napja nem a
  jóváírásé lenne; ha egy bizonyítatlan elszámolásból jelölés lenne.
*/
describe("decideFoxpostSettlement", () => {
  const candidates = [
    candidate("ACRW-2026/00470", "47679-100001", 12500),
    // a csomag két részletben: két sor ugyanarra a rendelésre
    candidate("ACRW-2026/00471", "47679-100002", 30000),
    // a sztornó-pár: az eredeti sztornózva, a sztornó negatív
    candidate("ACRW-2026/00483", "47679-279201", 18990, true),
    candidate("ACRW-2026/00490", "47679-279201", -18990),
    // a hivatkozás maga a számlaszám
    candidate("ACRW-2026/00475", null, 9990),
    // két élő számla egy rendelésre
    candidate("ACRW-2026/00476", "47679-100005", 5000),
    candidate("ACRW-2026/00477", "47679-100005", 5000),
  ];
  const invoices = new Map([
    ["ACRW-2026/00470", invoice(12500)],
    ["ACRW-2026/00471", invoice(30000)],
    ["ACRW-2026/00483", invoice(18990, { cancelled: true })],
    ["ACRW-2026/00490", invoice(-18990)],
    ["ACRW-2026/00475", invoice(9990)],
    ["ACRW-2026/00476", invoice(5000)],
    ["ACRW-2026/00477", invoice(5000)],
  ]);
  const lines = [
    line("47679-100001", 12500),
    line("47679-100002", 20000),
    line("47679-100002", 10000),
    line("47679-279201", 18990),
    line("ACRW-2026/00475", 9990),
    line("47679-100005", 5000),
    line("47679-999999", 7000),
  ];
  // 83 480 beszedve, 4 500 beszámítva, 78 980 utalva
  const transfer = {
    id: "bt-26h38",
    amount: D(78980),
    bookingDate: "2026-09-23",
  };

  it("26H38-like: the fee set off, the credit's day, order numbers, an invoice-number reference, a split parcel", () => {
    const decision = decideFoxpostSettlement({
      settlement: settlement(lines),
      credits: [transfer],
      candidates,
      invoices,
    });
    assert.ok(decision.markable);
    assert.equal(decision.creditId, "bt-26h38");
    assert.deepEqual(
      decision.marks.map((m) => [m.invoiceNumber, m.amount, m.date, m.note]),
      [
        ["ACRW-2026/00470", "12500", "2026-09-23", "Foxpost utánvét, 26H38"],
        ["ACRW-2026/00471", "30000", "2026-09-23", "Foxpost utánvét, 26H38"],
        ["ACRW-2026/00475", "9990", "2026-09-23", "Foxpost utánvét, 26H38"],
      ],
    );
    assert.deepEqual(
      decision.skipped.map((s) => `${s.reference}:${s.reason}`),
      [
        "47679-100005:MULTIPLE_INVOICES",
        "47679-279201:NO_LIVE_INVOICE",
        "47679-999999:NOT_FOUND",
      ],
    );
  });

  it("an unproven settlement marks nothing", () => {
    const refusal = (s: FoxpostSettlementInput, credits = [transfer]) => {
      const d = decideFoxpostSettlement({
        settlement: s,
        credits,
        candidates,
        invoices,
      });
      return d.markable ? null : d.refusal;
    };
    assert.equal(refusal(settlement(lines)), null);
    assert.deepEqual(
      [
        refusal(settlement(lines, 4500, { status: "ERROR" })),
        refusal(settlement(lines, 4500, { status: "PROCESSING" })),
        refusal(settlement(lines, 4500, { transferredAmount: null })),
        // a line missing from the sum, the other sums agreeing with it
        refusal(
          settlement(lines, 4500, {
            collectedAmount: D(83481),
            transferredAmount: D(78981),
          }),
          [{ ...transfer, amount: D(78981) }],
        ),
        // the transfer is not the COD minus the set-off invoice
        refusal(settlement(lines, 4500, { transferredAmount: D(83480) })),
        // the COD in full, as if nothing were set off
        refusal(settlement(lines), [{ ...transfer, amount: D(83480) }]),
        refusal(settlement(lines), []),
        refusal(settlement(lines), [transfer, { ...transfer, id: "bt-2" }]),
      ],
      [
        "SETTLEMENT_INCOMPLETE",
        "SETTLEMENT_INCOMPLETE",
        "SETTLEMENT_INCOMPLETE",
        "SETTLEMENT_INCONSISTENT",
        "SETTLEMENT_INCONSISTENT",
        "NO_CREDIT",
        "NO_CREDIT",
        "AMBIGUOUS_CREDIT",
      ],
    );
    // NEEDS_REVIEW is about our internal orders, not the money
    assert.equal(
      refusal(settlement(lines, 4500, { status: "NEEDS_REVIEW" })),
      null,
    );
  });

  it("per invoice as GLS: already paid, payments unknown, more than 2 Ft off, 5 Ft rounding", () => {
    const decide = (over: OutgoingInvoiceInput, collected = 12500) => {
      const s = settlement([line("47679-100001", collected)], 0);
      const d = decideFoxpostSettlement({
        settlement: s,
        credits: [{ ...transfer, amount: s.transferredAmount! }],
        candidates,
        invoices: new Map([["ACRW-2026/00470", over]]),
      });
      assert.ok(d.markable);
      return d.marks.length
        ? d.marks[0]!.note
        : d.skipped.map((x) => x.reason).join();
    };
    assert.deepEqual(
      [
        decide(invoice(12500, { paidAmount: D(12500) })),
        decide(invoice(12500, { paymentsKnown: false })),
        decide(invoice(12500), 12497),
        decide(invoice(12502), 12500),
      ],
      [
        "ALREADY_PAID",
        "PAYMENTS_UNKNOWN",
        "AMOUNT_MISMATCH",
        "Foxpost utánvét, 26H38, 5 Ft-os kerekítés: beszedve 12500",
      ],
    );
  });
});

describe("the Foxpost dry run's list and switch", () => {
  it("off unless dry or live; the narrative names the settlement", () => {
    assert.deepEqual(
      [undefined, "", "on", "dry", " live "].map(foxpostMarkPaidMode),
      ["off", "off", "off", "dry", "live"],
    );
    assert.equal(foxpostNarrativeMark("26H38"), "FOXPOST 26H38");
  });

  it("names a refused settlement and why, every mark, every skip, and the total", () => {
    assert.equal(
      foxpostDryRunReport([
        {
          settlementCode: "26H35",
          markable: false,
          refusal: "NO_CREDIT",
          transferred: "94338",
        },
        {
          settlementCode: "26H38",
          markable: true,
          transferred: "78980",
          creditId: "bt",
          creditDate: "2026-09-23",
          marks: [
            {
              invoiceNumber: "ACRW-2026/00470",
              date: "2026-09-23",
              amount: "12500",
              title: "utánvét",
              note: "Foxpost utánvét, 26H38",
            },
          ],
          skipped: [{ reference: "47679-279201", reason: "NO_LIVE_INVOICE" }],
        },
      ]),
      [
        "26H35  utalt 94338 Ft  NEM JELÖLHETŐ: nincs ilyen összegű, erre az elszámolásra hivatkozó jóváírás",
        "26H38  utalt 78980 Ft, 2026-09-23  jelölhető",
        "  ACRW-2026/00470\t12500 Ft\t2026-09-23\tutánvét\tFoxpost utánvét, 26H38",
        "  47679-279201\tkimarad: a rendelés számlája sztornózva, élő számla nincs",
        "összesen: 1 számla jelölhető, 2 elszámolásból",
        "",
      ].join("\n"),
    );
  });
});
