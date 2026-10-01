import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma, type IncomingBillingDocument } from "@acropora/database";
import type { IncomingDocumentListItem } from "@acropora/types";

import type { DocumentPairing } from "../missing-invoices/missing-invoices.service.js";
import {
  bankMatchOf,
  filterIncoming,
  incomingListResponse,
  paymentStateOf,
  toIncomingDetail,
  toIncomingListItem,
} from "./incoming-billing-documents.js";

const D = (value: string | number) => new Prisma.Decimal(value);
const day = (value: string) => new Date(`${value}T00:00:00Z`);

const row = (
  over: Partial<IncomingBillingDocument> = {},
): IncomingBillingDocument => ({
  id: "in-1",
  source: "SZAMLAZZ",
  externalId: "5150",
  feedMessageId: "msg-1",
  feedReceivedAt: new Date("2026-10-01T08:00:00Z"),
  versionCount: 2,
  kindCode: "SZ",
  documentNumber: "KI-2026/77",
  electronic: true,
  issueDate: day("2026-09-28"),
  fulfillmentDate: day("2026-09-25"),
  dueDate: day("2026-10-12"),
  paymentMethod: "Átutalás",
  currency: "HUF",
  exchangeRate: null,
  exchangeBank: null,
  supplierName: "Korall Import Kft.",
  supplierTaxNumber: "12345678-2-41",
  supplierEuTaxNumber: null,
  supplierAddress: "1010 Budapest, Minta utca 1.",
  supplierBankAccount: null,
  buyerName: "Acropora Kft.",
  buyerTaxNumber: "23916229-2-42",
  netAmount: D(10000),
  vatAmount: D(2700),
  grossAmount: D(12700),
  lines: [],
  vatSummary: [],
  paymentsKnown: true,
  payments: [],
  paidAmount: D(0),
  lastPaymentDate: null,
  note: null,
  orderNumber: null,
  referencedInvoiceNumber: null,
  referencedProformaNumber: null,
  cancelled: false,
  sourceDocumentId: "doc-1",
  hasPdf: false,
  createdAt: new Date("2026-10-01T08:00:00Z"),
  updatedAt: new Date("2026-10-01T08:00:00Z"),
  ...over,
});

const debit = { bookingDate: "2026-09-30", amount: "12700", currency: "HUF" };
const pairing = (over: Partial<DocumentPairing> = {}): DocumentPairing => ({
  payee: "COMPANY",
  kind: "INVOICE",
  debits: [debit],
  ...over,
});

// MI PIROSÍT: ha a hiányzó kifizetés-adat „nincs fizetve” lenne; ha a kerekítés
// egy forint alatti maradékkal részlegesnek, vagy egy cent hiánnyal fizetettnek
// mondana egy számlát; ha a sztornó (negatív bruttó) sosem lehetne fizetett.
// A számítás közös a kimenő listával (`@acropora/types` paymentStateOf).
describe("paymentStateOf", () => {
  const state = (paid: string, gross: string, currency = "HUF", known = true) =>
    paymentStateOf({
      paymentsKnown: known,
      paidAmount: D(paid),
      grossAmount: D(gross),
      currency,
    });

  it("without payment data the state is unknown, even at zero paid", () => {
    assert.equal(state("0", "12700", "HUF", false), "UNKNOWN");
  });

  it("measures the paid sum against the gross, within the currency's rounding", () => {
    assert.deepEqual(
      [
        state("12700", "12700"),
        state("12699.6", "12700"),
        // a forint tűrése 2 Ft (az 5 forintos készpénz-kerekítés): a részleges
        // eset ezért 3 Ft hiánnyal mér (murena kérése, 25902)
        state("12697", "12700"),
        state("0", "12700"),
        state("99.99", "100", "EUR"),
        state("99.996", "100", "EUR"),
        state("-12700", "-12700"),
        state("13000", "12700"),
      ],
      ["PAID", "PAID", "PARTIAL", "UNPAID", "PARTIAL", "PAID", "PAID", "PAID"],
    );
  });
});

// MI PIROSÍT: ha a „nem párosítandó” a két döntött eseten (acrobot 25879) kívül
// is megjelenne, vagy valamelyikükön nem; ha egy párosított terhelés a nem a
// cégre szóló számlán is párosítottnak mutatná.
describe("bankMatchOf", () => {
  const match = (
    sourceDocumentId: string | null,
    kindCode: string,
    found?: DocumentPairing,
  ) =>
    bankMatchOf(
      { sourceDocumentId, kindCode },
      new Map(found ? [["doc-1", found]] : []),
    );

  it("not to pair only for a bill to someone else or a proforma", () => {
    assert.deepEqual(
      [
        match("doc-1", "SZ", pairing({ payee: "NOT_COMPANY" })),
        match("doc-1", "d", pairing({ debits: [] })),
        match("doc-1", "SZ", pairing({ kind: "PROFORMA", debits: [] })),
      ],
      [
        { state: "NOT_TO_PAIR", reason: "NOT_COMPANY", debits: [] },
        { state: "NOT_TO_PAIR", reason: "PROFORMA", debits: [] },
        { state: "NOT_TO_PAIR", reason: "PROFORMA", debits: [] },
      ],
    );
  });

  it("paired with the debits, otherwise unpaired", () => {
    assert.deepEqual(
      [
        match("doc-1", "SZ", pairing()),
        match("doc-1", "SZ", pairing({ debits: [] })),
        match("doc-1", "SZ"),
        match(null, "SZ"),
        match(
          "doc-1",
          "SZ",
          pairing({ payee: "UNKNOWN", kind: "PREMIUM_NOTICE" }),
        ),
      ].map((m) => [m.state, m.debits.length]),
      [
        ["PAIRED", 1],
        ["UNPAIRED", 0],
        ["UNPAIRED", 0],
        ["UNPAIRED", 0],
        ["PAIRED", 1],
      ],
    );
  });
});

// MI PIROSÍT: ha egy összeg rossz tizedesre kerekedne (forint egészre, deviza
// két tizedesre); ha a kifizetés banki tranzakció-azonosítója kiszivárogna az
// adatlapra; ha az e-számla jelölés vagy a párosítás nem a sorból jönne.
describe("toIncomingListItem and toIncomingDetail", () => {
  it("formats amounts per currency and derives the states", () => {
    const pairings = new Map([["doc-1", pairing()]]);
    const huf = toIncomingListItem(
      row({ paidAmount: D(12700), lastPaymentDate: day("2026-09-30") }),
      pairings,
    );
    const eur = toIncomingListItem(
      row({
        currency: "EUR",
        electronic: false,
        exchangeRate: D("391.25"),
        netAmount: D(70),
        vatAmount: D("16.2"),
        grossAmount: D("86.2"),
        paidAmount: D(50),
        kindCode: "HS",
      }),
      pairings,
    );
    assert.deepEqual(
      [
        huf.grossAmount,
        huf.paymentState,
        huf.lastPaymentDate,
        huf.bankMatch.state,
        huf.invoiceFormat,
        huf.kindLabel,
      ],
      ["12700", "PAID", "2026-09-30", "PAIRED", "ELECTRONIC", "Számla"],
    );
    assert.deepEqual(
      [
        eur.netAmount,
        eur.vatAmount,
        eur.grossAmount,
        eur.paidAmount,
        eur.exchangeRate,
        eur.paymentState,
        eur.invoiceFormat,
        eur.kindLabel,
      ],
      [
        "70.00",
        "16.20",
        "86.20",
        "50.00",
        "391.25",
        "PARTIAL",
        "PAPER",
        "Helyesbítő számla",
      ],
    );
  });

  it("the detail carries the parties and payments, without the bank transaction id", () => {
    const detail = toIncomingDetail(
      row({
        payments: [
          {
            date: "2026-09-30",
            title: "átutalás",
            amount: "12700",
            note: null,
            bankTransactionId: "9001",
          },
        ],
      }),
      new Map(),
    );
    assert.deepEqual(
      [
        detail.supplier,
        detail.buyer,
        detail.payments,
        detail.versionCount,
        detail.receivedAt,
      ],
      [
        {
          name: "Korall Import Kft.",
          address: "1010 Budapest, Minta utca 1.",
          taxNumber: "12345678-2-41",
          euTaxNumber: null,
          bankAccount: null,
        },
        { name: "Acropora Kft.", taxNumber: "23916229-2-42" },
        [
          {
            date: "2026-09-30",
            title: "átutalás",
            amount: "12700",
            note: null,
          },
        ],
        2,
        "2026-10-01T08:00:00.000Z",
      ],
    );
  });
});

const item = (
  over: Partial<IncomingDocumentListItem>,
): IncomingDocumentListItem => ({
  ...toIncomingListItem(row(), new Map()),
  ...over,
});

// MI PIROSÍT: ha egy szűrő a másik mezőt nézné (kelt helyett teljesítést); ha a
// határnap kiesne; ha a teljesítés nélküli számla dátum-szűrésnél átcsúszna; ha
// a rövid számsor adószám-találatot adna (a „Kft. 2” minden adószámra illene);
// ha a pénznem vagy a típus a kis- és nagybetűn múlna.
describe("filterIncoming", () => {
  const a = item({
    id: "a",
    documentNumber: "A-1",
    supplierName: "Korall Import Kft.",
    supplierTaxNumber: "12345678-2-41",
    issueDate: "2026-09-28",
    fulfillmentDate: "2026-09-25",
    kindCode: "SZ",
    currency: "HUF",
    paymentState: "PAID",
  });
  const b = item({
    id: "b",
    documentNumber: "B-1",
    supplierName: "Halbolt Bt.",
    supplierTaxNumber: "87654321-1-13",
    issueDate: "2026-09-30",
    fulfillmentDate: null,
    kindCode: "D",
    currency: "EUR",
    paymentState: "UNKNOWN",
    bankMatch: { state: "NOT_TO_PAIR", reason: "PROFORMA", debits: [] },
  });
  const c = item({
    id: "c",
    documentNumber: "C-1",
    supplierName: "Korall Import Kft.",
    issueDate: "2026-09-30",
    fulfillmentDate: "2026-10-01",
    paymentState: "PARTIAL",
  });
  const ids = (query: Parameters<typeof filterIncoming>[1]) =>
    filterIncoming([a, b, c], query).map((x) => x.id);

  it("sorts the newest issue date first, then by number", () => {
    assert.deepEqual(ids({}), ["b", "c", "a"]);
  });

  it("finds the supplier by name or by tax number digits", () => {
    assert.deepEqual(
      [
        ids({ q: "korall" }),
        ids({ q: "87654321" }),
        ids({ q: "8765-4321" }),
        ids({ q: "2" }),
      ],
      [["c", "a"], ["b"], ["b"], []],
    );
  });

  it("filters the period on the chosen date, both ends included", () => {
    assert.deepEqual(
      [
        ids({ from: "2026-09-28", to: "2026-09-28" }),
        ids({ from: "2026-09-25", to: "2026-09-25", dateBasis: "FULFILLMENT" }),
        ids({ from: "2026-09-01", dateBasis: "FULFILLMENT" }),
        ids({ to: "2026-09-29" }),
      ],
      [["a"], ["a"], ["c", "a"], ["a"]],
    );
  });

  it("filters payment, kind, currency and bank match", () => {
    assert.deepEqual(
      [
        ids({ paymentState: "PARTIAL" }),
        ids({ kindCode: "d" }),
        ids({ currency: "eur" }),
        ids({ bankMatch: "NOT_TO_PAIR" }),
        ids({ bankMatch: "UNPAIRED", q: "korall", paymentState: "PAID" }),
      ],
      [["c"], ["b"], ["b"], ["b"], ["a"]],
    );
  });
});

// MI PIROSÍT: ha a lapozás a szűrés előtt vágna; ha a szűrő-választék a szűrt
// sorokból jönne (egy választott típus után a többi eltűnne a legördülőből).
describe("incomingListResponse", () => {
  const all = [1, 2, 3, 4, 5].map((n) =>
    item({
      id: `r${n}`,
      documentNumber: `N-${n}`,
      issueDate: `2026-09-0${n}`,
      kindCode: n === 5 ? "D" : "SZ",
      currency: n === 5 ? "EUR" : "HUF",
    }),
  );

  it("pages the filtered rows and offers the facets of all rows", () => {
    const response = incomingListResponse(all, {
      page: 2,
      pageSize: 2,
      kindCode: "SZ",
    });
    assert.deepEqual(
      [response.items.map((x) => x.id), response.pagination, response.facets],
      [
        ["r2", "r1"],
        { page: 2, pageSize: 2, totalItems: 4, totalPages: 2 },
        {
          kindCodes: [
            { code: "D", label: "Díjbekérő" },
            { code: "SZ", label: "Számla" },
          ],
          currencies: ["EUR", "HUF"],
        },
      ],
    );
  });
});
