import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  postedPurchaseForArrival,
  purchaseListItem,
  purchaseReading,
  type PurchaseSubject,
} from "./purchase-incoming.js";

const D = (value: string | number) => new Prisma.Decimal(value);

const subject = (over: Partial<PurchaseSubject> = {}): PurchaseSubject => ({
  purchaseInvoiceId: "pi-1",
  supplierInvoiceNumber: "KIT-2026-7",
  invoiceDate: new Date("2026-10-01T00:00:00Z"),
  dueDate: new Date("2026-10-09T00:00:00Z"),
  currency: "HUF",
  exchangeRate: null,
  vatRate: D(27),
  isPaid: false,
  paidAt: null,
  supplierName: "Kitalált Kft.",
  supplierTaxNumber: "12345678-2-42",
  supplierIsForeign: false,
  net: D("1234.567"),
  scanIds: ["scan-1"],
  scanReceivedAt: null,
  ...over,
});

describe("a beszerzésből kitöltött olvasat (kártya 83f31a95)", () => {
  it("nettó a sorokból, ÁFA a kulcsból; EU-s beszállítónál a közösségi mező; kulcs nélkül üres ÁFA", () => {
    const hu = purchaseReading(subject()).values;
    const eu = purchaseReading(
      subject({ supplierIsForeign: true, supplierTaxNumber: "ATU12345678" }),
    ).values;
    const none = purchaseReading(subject({ vatRate: null })).values;
    assert.deepEqual(
      [
        [hu.netAmount, hu.vatAmount, hu.grossAmount, hu.supplierTaxNumber],
        [eu.supplierTaxNumber, eu.supplierEuTaxNumber],
        [none.vatAmount, none.grossAmount, none.netAmount],
        [hu.issueDate, hu.dueDate, hu.fulfillmentDate],
      ],
      [
        ["1234.57", "333.33", "1567.90", "12345678-2-42"],
        [null, "ATU12345678"],
        [null, null, "1234.57"],
        ["2026-10-01", "2026-10-09", null],
      ],
      "PURCHASE-PREFILL",
    );
  });
});

describe("a beszerzésből jött sor a listán", () => {
  it("purchase: azonosító, ellenőrizendő, a rögzítés fizetve-jelölése, kép nélkül PDF sincs", () => {
    const paid = purchaseListItem(
      subject({ isPaid: true, paidAt: new Date("2026-10-05T00:00:00Z") }),
      new Map(),
    );
    const bare = purchaseListItem(subject({ scanIds: [] }), new Map());
    assert.deepEqual(
      [
        paid.id,
        paid.origin,
        paid.review,
        paid.kindCode,
        paid.paymentState,
        paid.lastPaymentDate,
        paid.grossAmount,
        bare.hasPdf,
        bare.paymentState,
      ],
      [
        "purchase:pi-1",
        "PURCHASE",
        "TO_REVIEW",
        "BE",
        "PAID",
        "2026-10-05",
        "1568",
        false,
        "UNPAID",
      ],
      "PURCHASE-LIST-ITEM",
    );
  });
});

describe("a később érkező példány kötése (PR 2)", () => {
  // a beszerzések, amiket a lekérdezés a szám szerint visszaad
  const database = {
    purchaseInvoice: {
      findMany: async () => [
        {
          id: "pi-1",
          supplierInvoiceNumber: "KIT-7",
          supplier: { taxNumber: "12345678-2-42", name: "Kitalált Kft." },
        },
      ],
    },
  } as never;
  const arrival = (over: Record<string, unknown>) =>
    postedPurchaseForArrival(database, {
      importResult: null,
      textReading: { invoiceNumber: "KIT-7", supplierTaxNumber: "12345678" },
      kind: "INVOICE",
      ...over,
    });

  it("az azonos szám és adószám-törzs köt; más szállító, díjbekérő és szám nélküli nem", async () => {
    assert.deepEqual(
      [
        await arrival({}),
        await arrival({
          textReading: {
            invoiceNumber: "KIT-7",
            supplierTaxNumber: "87654321",
          },
        }),
        await arrival({ kind: "PROFORMA" }),
        await arrival({ textReading: { invoiceNumber: null } }),
        await arrival({
          textReading: null,
          importResult: {
            invoiceNumber: "KIT-7",
            supplier: { vatId: "HU12345678", name: "Kitalált Kft." },
          },
        }),
      ],
      ["pi-1", null, null, null, "pi-1"],
      "ARRIVAL-KEY",
    );
  });
});
