import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma, type IncomingBillingDocument } from "@acropora/database";

import {
  arrivalKeys,
  incomingListItems,
  loadManualPurchasePayments,
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
  // the number match itself is SQL (NUMBER_KEY_SQL), measured in the integration spec
  const database = {
    $queryRaw: async () => [{ id: "pi-1" }],
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

  it("az azonos szám és adószám-törzs köt; más szállító, díjbekérő, ismeretlen fajta és szám nélküli nem", async () => {
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
        await arrival({ kind: null }),
        await arrival({ textReading: { invoiceNumber: null } }),
        await arrival({
          textReading: null,
          importResult: {
            invoiceNumber: "KIT-7",
            supplier: { vatId: "HU12345678", name: "Kitalált Kft." },
          },
        }),
      ],
      ["pi-1", null, null, null, null, "pi-1"],
      "ARRIVAL-KEY",
    );
  });
});

/*
  A BEÉRKEZETT DOKUMENTUM KULCSAI (hétfői lista N3). MI PIROSÍT: a kulcs csak a
  szövegolvasóból jön, és az illesztő vagy a külföldi olvasat számát nem
  látja (a Hertlein és az Aquarioom számlája így állt kétszer a listán); egy
  üres szám kulcsot ad.
*/
describe("a beérkezett dokumentum kulcsai (N3)", () => {
  it("az illesztő, a szövegolvasó és az olvasat számából is, a saját szállítójával", () => {
    assert.deepEqual(
      arrivalKeys({
        importResult: {
          invoiceNumber: "261685",
          supplier: { name: "Hertlein GmbH", vatId: "DE123456789" },
        },
        textReading: { invoiceNumber: null },
        reading: null,
      }),
      arrivalKeys({
        reading: {
          documentNumber: "261685",
          supplierTaxNumber: null,
          supplierEuTaxNumber: "DE123456789",
          supplierName: "Hertlein GmbH",
        },
      }),
    );
    assert.equal(
      arrivalKeys({
        reading: {
          documentNumber: "FA00009139",
          supplierTaxNumber: null,
          supplierEuTaxNumber: null,
          supplierName: "Aquarioom",
        },
      }).length,
      1,
    );
    assert.equal(
      arrivalKeys({
        textReading: { invoiceNumber: "KIT-7", supplierTaxNumber: "12345678" },
      }).length,
      1,
    );
  });

  it("üres vagy hiányzó szám nem ad kulcsot", () => {
    assert.deepEqual(
      arrivalKeys({
        importResult: { invoiceNumber: "  " },
        textReading: { invoiceNumber: "" },
        reading: {
          documentNumber: null,
          supplierTaxNumber: null,
          supplierEuTaxNumber: null,
          supplierName: "X",
        },
      }),
      [],
    );
    assert.deepEqual(arrivalKeys({}), []);
  });
});

/*
  A KÉZI „FIZETVE” NEM VESZIK EL JÓVÁHAGYÁSKOR (barracuda 2026-10-17). A jóváhagyás előtti sor a
  beszerzési számla jelöléséből fizetett; a jóváhagyás után a PURCHASE sor a beszerzési számla mezőjéből
  kapja ugyanezt. MI PIROSÍT: ha a két állapot eltérne; ha a lekérés nem csak a PURCHASE sorokra és a
  ténylegesen fizetettre menne; ha a lista nem a beszerzési azonosító szerint kötné a jelölést a sorhoz.
*/
describe("a kézi „Fizetve” jóváhagyás előtt és után", () => {
  const purchaseRow = (over: Partial<IncomingBillingDocument> = {}) =>
    ({
      id: "in-9",
      source: "PURCHASE",
      externalId: "pi-1",
      feedMessageId: "pi-1",
      feedReceivedAt: new Date("2026-10-08T08:00:00Z"),
      versionCount: 1,
      kindCode: "BE",
      documentNumber: "KIT-2026-7",
      electronic: false,
      issueDate: new Date("2026-10-01T00:00:00Z"),
      fulfillmentDate: null,
      dueDate: new Date("2026-10-09T00:00:00Z"),
      paymentMethod: null,
      currency: "HUF",
      exchangeRate: null,
      exchangeBank: null,
      supplierName: "Kitalált Kft.",
      supplierTaxNumber: "12345678-2-42",
      supplierEuTaxNumber: null,
      supplierAddress: null,
      supplierBankAccount: null,
      buyerName: "Acropora Kft.",
      buyerTaxNumber: null,
      netAmount: D(1234),
      vatAmount: D(334),
      grossAmount: D(1568),
      lines: [],
      vatSummary: [],
      paymentsKnown: false,
      payments: [],
      paidAmount: D(0),
      lastPaymentDate: null,
      note: null,
      orderNumber: null,
      referencedInvoiceNumber: null,
      referencedProformaNumber: null,
      cancelled: false,
      hasPdf: true,
      sourceDocumentId: "scan-1",
      createdAt: new Date("2026-10-08T08:00:00Z"),
      updatedAt: new Date("2026-10-08T08:00:00Z"),
      ...over,
    }) as IncomingBillingDocument;

  const list = (
    rows: IncomingBillingDocument[],
    manualPaid?: Map<string, { paidAt: Date | null }>,
  ) =>
    incomingListItems({
      rows,
      pairings: new Map(),
      hasCollectedPdf: () => false,
      readings: new Map(),
      purchases: [],
      manualPaid,
    });

  it("ugyanaz az állapot a jóváhagyás előtt és után; jelölés nélkül „Nincs adat”", () => {
    const paidAt = new Date("2026-10-05T00:00:00Z");
    const before = purchaseListItem(
      subject({ isPaid: true, paidAt }),
      new Map(),
    );
    const [after] = list([purchaseRow()], new Map([["pi-1", { paidAt }]]));
    const [unmarked] = list([purchaseRow()], new Map());
    assert.deepEqual(
      [
        [
          after!.paymentState,
          after!.paidAmount,
          after!.lastPaymentDate,
          after!.paymentSource,
        ],
        [unmarked!.paymentState, unmarked!.paidAmount],
      ],
      [
        [
          before.paymentState,
          before.paidAmount,
          before.lastPaymentDate,
          before.paymentSource,
        ],
        ["UNKNOWN", "0"],
      ],
      "PURCHASE-MANUAL-PAID",
    );
    assert.equal(after!.paymentState, "PAID");
  });

  it("a jelölést a beszerzési azonosító köti a sorhoz: egy másik számla jelölése nem fizetettre teszi", () => {
    const [other] = list(
      [purchaseRow()],
      new Map([["pi-2", { paidAt: null }]]),
    );
    assert.equal(other!.paymentState, "UNKNOWN");
  });

  it("a betöltő csak a PURCHASE sorok azonosítóit kérdezi, csak a fizetettre jelölteket", async () => {
    const asked: unknown[] = [];
    const database = {
      purchaseInvoice: {
        findMany: async (args: unknown) => {
          asked.push(args);
          return [{ id: "pi-1", paidAt: new Date("2026-10-05T00:00:00Z") }];
        },
      },
    };
    const map = await loadManualPurchasePayments(
      database as unknown as Parameters<typeof loadManualPurchasePayments>[0],
      [
        purchaseRow(),
        purchaseRow({ source: "SZAMLAZZ", externalId: "5150" }),
        purchaseRow({ source: "MAILBOX", externalId: "doc-3" }),
      ],
    );
    assert.deepEqual(
      [asked, [...map.entries()]],
      [
        [
          {
            where: { id: { in: ["pi-1"] }, isPaid: true },
            select: { id: true, paidAt: true },
          },
        ],
        [["pi-1", { paidAt: new Date("2026-10-05T00:00:00Z") }]],
      ],
      "PURCHASE-MANUAL-LOAD",
    );
  });

  it("PURCHASE sor nélkül nincs lekérés", async () => {
    let calls = 0;
    const database = {
      purchaseInvoice: {
        findMany: async () => {
          calls += 1;
          return [];
        },
      },
    };
    const map = await loadManualPurchasePayments(
      database as unknown as Parameters<typeof loadManualPurchasePayments>[0],
      [purchaseRow({ source: "SZAMLAZZ", externalId: "5150" })],
    );
    assert.deepEqual([calls, map.size], [0, 0]);
  });
});
