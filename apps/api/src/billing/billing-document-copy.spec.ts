import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import {
  BillingDocumentsRepository,
  type BillingDocumentRow,
} from "./billing-documents.repository.js";
import { BillingDocumentsService } from "./billing-documents.service.js";

/**
 * KIÁLLÍTOTT BIZONYLAT MÁSOLÁSA ÚJ VÁZLATBA (os-szamla-masolas). MI PIROSÍT:
 * vázlatból, kiállítás alattiból vagy elutasítottból, végszámlából, sztornóból
 * vagy partner nélkülből is készül másolat; a másolat viszi az eredeti dátumait,
 * számát, forrását (szerződés, rendelés), szerződés-tétel hivatkozását vagy a
 * díjbekérőhöz kötését; nem a MAI napot (Budapest) adja teljesítésnek, vagy a
 * határidő nem a vevő fizetési napjaiból (nyolc nap nélkülük) jön; nem az
 * eredeti beállításait és tételeit viszi; egy
 * második másolás ugyanazt a vázlatot adja vissza (a másolatonkénti új
 * azonosító a szándék); a másolat nem kiállításhoz vagy kiküldéshez nyúl.
 */
const USER = { id: "user-1" } as AuthenticatedUser;
const d = (value: string) => new Prisma.Decimal(value);
/** Budapesten 2026-10-26 este: a UTC-nap még ugyanaz, de a mérés a Budapest-napot nézi. */
const NOW = new Date("2026-10-26T10:00:00Z");
const day = (value: unknown) =>
  value instanceof Date ? value.toISOString().slice(0, 10) : value;

function issued(over: Record<string, unknown> = {}) {
  return {
    id: "inv-1",
    status: "ISSUED",
    documentType: "INVOICE",
    invoiceNumber: "E-2026-12",
    invoiceFormat: "PAPER",
    customerId: "cust-1",
    fulfillmentDate: new Date("2026-09-01T00:00:00Z"),
    dueDate: new Date("2026-09-15T00:00:00Z"),
    paymentMethod: "Átutalás",
    currency: "EUR",
    language: "de",
    reference: "PROJ-7",
    note: "megjegyzés",
    sourceType: "CONTRACT",
    sourceId: "contract-7",
    proformaInvoiceId: "pro-9",
    referencedInvoiceId: null,
    emailStatus: "SENT",
    partnerName: "Kitalált Kft.",
    lines: [
      {
        id: "l-1",
        position: 0,
        kind: "ITEM",
        parentLineId: null,
        productId: "prod-1",
        variantId: "var-1",
        contractItemId: "ci-1",
        description: "Akvárium",
        quantity: d("2"),
        unit: "db",
        unitNet: d("1000"),
        vatRatePercent: d("27"),
        discountPercent: d("10"),
        netAmount: d("1800"),
        vatAmount: d("486"),
        grossAmount: d("2286"),
        comment: "tételmegjegyzés",
      },
      {
        id: "l-2",
        position: 1,
        kind: "DISCOUNT",
        parentLineId: "l-1",
        productId: null,
        variantId: null,
        contractItemId: null,
        description: "kedvezmény",
        quantity: d("1"),
        unit: null,
        unitNet: d("-200"),
        vatRatePercent: d("27"),
        discountPercent: null,
        netAmount: d("-200"),
        vatAmount: d("-54"),
        grossAmount: d("-254"),
        comment: null,
      },
    ],
    mailDeliveries: [],
    createdAt: new Date("2026-09-01T10:00:00Z"),
    updatedAt: new Date("2026-09-01T10:00:00Z"),
    ...over,
  } as unknown as BillingDocumentRow;
}

function setup(
  start: Record<string, BillingDocumentRow>,
  dueDays: number | null = null,
) {
  const rows = { ...start };
  const created: Array<Record<string, unknown> & { id: string }> = [];
  const repository = {
    find: async (id: string) => rows[id] ?? null,
    customer: async () => ({
      companyName: "Kitalált Kft.",
      displayName: "Kitalált",
      taxNumber: "12345678-2-42",
    }),
    create: async (input: Record<string, unknown> & { id: string }) => {
      created.push(input);
      rows[input.id] = issued({
        id: input.id,
        status: "DRAFT",
        invoiceNumber: null,
      });
      return { created: true };
    },
    customerPaymentDueDays: async () => dueDays,
    feedPaid: async () => null,
    feedTwinCancelled: async () => false,
    related: async () => ({ documents: [], truncated: false }),
    finalInvoiceOf: async () => null,
    // a forrás nélküli másolatnak SEMMILYEN szerződés-tétel nem a sajátja
    purchaseContractItemIds: async () => new Set<string>(),
  } as unknown as BillingDocumentsRepository;
  return { service: new BillingDocumentsService(repository), created };
}

describe("copying an issued document into a new draft", () => {
  it("answers 404 for an unknown document, and creates nothing", async () => {
    const s = setup({});
    await assert.rejects(
      s.service.copyFromIssued("x", USER),
      NotFoundException,
    );
    assert.equal(s.created.length, 0);
  });

  it("only copies an issued document of a type that can be started from scratch, with a customer", async () => {
    for (const over of [
      { status: "DRAFT" },
      { status: "ISSUING" },
      { status: "ISSUE_FAILED" },
      { documentType: "FINAL_INVOICE" },
      { documentType: "STORNO" },
      { customerId: null },
    ]) {
      const s = setup({ "inv-1": issued(over) });
      await assert.rejects(
        s.service.copyFromIssued("inv-1", USER),
        ConflictException,
        JSON.stringify(over),
      );
      assert.equal(s.created.length, 0, JSON.stringify(over));
    }
  });

  it("carries the settings and items, and nothing that ties it to the original", async () => {
    const s = setup({ "inv-1": issued() });
    const copy = await s.service.copyFromIssued("inv-1", USER, NOW);
    assert.equal(s.created.length, 1);
    const sent = s.created[0]!;
    assert.notEqual(sent.id, "inv-1");
    assert.equal(copy.id, sent.id);
    assert.equal(sent.createdByUserId, "user-1");
    // semmilyen kötés az eredetihez
    assert.equal(sent.proformaInvoiceId, undefined);
    assert.equal(sent.referencedInvoiceId, undefined);

    const draft = sent.draft as Record<string, unknown> & {
      lines: Array<Record<string, unknown>>;
    };
    assert.equal(draft.documentType, "INVOICE");
    assert.equal(draft.invoiceFormat, "PAPER");
    assert.equal(draft.customerId, "cust-1");
    assert.equal(draft.paymentMethod, "Átutalás");
    assert.equal(draft.currency, "EUR");
    assert.equal(draft.language, "de");
    assert.equal(draft.reference, "PROJ-7");
    assert.equal(draft.note, "megjegyzés");
    // a dátumok a MAI nappal indulnak (nem az eredetiéivel); a forrás kézi
    assert.equal(day(draft.fulfillmentDate), "2026-10-26");
    assert.equal(day(draft.dueDate), "2026-11-03"); // nincs vevő-nap: nyolc nap
    assert.equal(draft.sourceType, "MANUAL");
    assert.equal(draft.sourceId, null);

    const items = draft.lines.filter((line) => line.kind === "ITEM");
    assert.equal(items.length, 1);
    assert.equal(items[0]!.description, "Akvárium");
    assert.equal(items[0]!.productId, "prod-1");
    assert.equal(items[0]!.comment, "tételmegjegyzés");
    // a szerződés-tételre mutatás nem utazik: a szerződés maradékát fogyasztaná
    for (const line of draft.lines) assert.equal(line.contractItemId, null);
  });

  it("the due date follows the customer's payment days, and the Budapest day decides 'today'", async () => {
    const s = setup({ "inv-1": issued() }, 30);
    // 23:30 UTC: Budapesten már a következő nap
    await s.service.copyFromIssued(
      "inv-1",
      USER,
      new Date("2026-10-26T23:30:00Z"),
    );
    const draft = s.created[0]!.draft as Record<string, unknown>;
    assert.equal(day(draft.fulfillmentDate), "2026-10-27");
    assert.equal(day(draft.dueDate), "2026-11-26");
  });

  it("every copy is a new draft", async () => {
    const s = setup({ "inv-1": issued() });
    const first = await s.service.copyFromIssued("inv-1", USER, NOW);
    const second = await s.service.copyFromIssued("inv-1", USER, NOW);
    assert.notEqual(first.id, second.id);
    assert.equal(s.created.length, 2);
  });
});
