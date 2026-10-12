import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { proformaLinks } from "./billing-document-detail-read.js";
import {
  BillingDocumentsRepository,
  type BillingDocumentRow,
} from "./billing-documents.repository.js";
import {
  advanceIdFor,
  BillingDocumentsService,
} from "./billing-documents.service.js";

/**
 * DÍJBEKÉRŐBŐL ELŐLEGSZÁMLA (számlázási brief, 2. pont). MI PIROSÍT: nem
 * kiállított díjbekérőből vagy egy számlából is készül előleg; a vázlat nem a
 * díjbekérő tételeiből, vevőjéből és pénznemével készül; a díjbekérő nem
 * kötődik hozzá; egy második kattintás második vázlatot ad; a részletek nem
 * mutatják a kapcsot, vagy a kifizetett díjbekérőt nem jelzik.
 */
const USER = { id: "user-1" } as AuthenticatedUser;
const d = (value: string) => new Prisma.Decimal(value);

function proforma(over: Record<string, unknown> = {}) {
  return {
    id: "pro-1",
    status: "ISSUED",
    documentType: "PROFORMA",
    invoiceNumber: "D-2026-7",
    invoiceFormat: null,
    customerId: "cust-1",
    fulfillmentDate: null,
    dueDate: null,
    paymentMethod: "Átutalás",
    currency: "EUR",
    language: "de",
    reference: "PROJ-7",
    note: "megjegyzés",
    sourceType: "PROJECT",
    sourceId: "proj-7",
    emailStatus: null,
    partnerName: "Kitalált Kft.",
    lines: [
      {
        id: "l-1",
        position: 0,
        kind: "ITEM",
        parentLineId: null,
        productId: "prod-1",
        variantId: "var-1",
        description: "Akvárium",
        quantity: d("2"),
        unit: "db",
        unitNet: d("1000"),
        vatRatePercent: d("27"),
        discountPercent: d("10"),
        netAmount: d("1800"),
        vatAmount: d("486"),
        grossAmount: d("2286"),
        comment: null,
      },
      {
        id: "l-2",
        position: 1,
        kind: "DISCOUNT",
        parentLineId: "l-1",
        productId: null,
        variantId: null,
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
    createdAt: new Date("2026-10-01T10:00:00Z"),
    updatedAt: new Date("2026-10-01T10:00:00Z"),
    ...over,
  } as unknown as BillingDocumentRow;
}

function setup(start: Record<string, BillingDocumentRow>) {
  const rows = { ...start };
  const created: Record<string, unknown>[] = [];
  const repository = {
    find: async (id: string) => rows[id] ?? null,
    customer: async () => ({
      companyName: "Kitalált Kft.",
      displayName: "Kitalált",
      taxNumber: "12345678-2-42",
    }),
    create: async (input: Record<string, unknown> & { id: string }) => {
      created.push(input);
      rows[input.id] = proforma({
        id: input.id,
        status: "DRAFT",
        documentType: "ADVANCE_INVOICE",
        invoiceNumber: null,
        proformaInvoice: { id: "pro-1", invoiceNumber: "D-2026-7" },
      });
      return { created: true };
    },
    feedPaid: async () => true,
  } as unknown as BillingDocumentsRepository;
  return { service: new BillingDocumentsService(repository), created };
}

describe("an advance from a proforma", () => {
  it("only from an issued proforma", async () => {
    await assert.rejects(
      setup({}).service.advanceFromProforma("pro-1", USER),
      NotFoundException,
    );
    for (const over of [{ status: "DRAFT" }, { documentType: "INVOICE" }])
      await assert.rejects(
        setup({ "pro-1": proforma(over) }).service.advanceFromProforma(
          "pro-1",
          USER,
        ),
        ConflictException,
      );
  });

  it("a draft from the proforma's items, customer and currency, bound to it; the paid proforma warned", async () => {
    const s = setup({ "pro-1": proforma() });
    const detail = await s.service.advanceFromProforma("pro-1", USER);
    assert.equal(s.created.length, 1);
    const input = s.created[0] as {
      id: string;
      proformaInvoiceId: string;
      draft: {
        documentType: string;
        currency: string;
        reference: string;
        lines: {
          kind: string;
          description: string;
          discountPercent: unknown;
        }[];
      };
    };
    assert.deepEqual(
      [
        input.id,
        input.proformaInvoiceId,
        input.draft.documentType,
        input.draft.currency,
        input.draft.reference,
        input.draft.lines.map((l) => [l.kind, l.description]),
      ],
      [
        advanceIdFor("pro-1"),
        "pro-1",
        "ADVANCE_INVOICE",
        "EUR",
        "PROJ-7",
        // the stored discount line is rebuilt from the item's percent, once
        [
          ["ITEM", "Akvárium"],
          ["DISCOUNT", "Kedvezmény (10%)"],
        ],
      ],
    );
    assert.deepEqual(detail.proforma, {
      id: "pro-1",
      number: "D-2026-7",
      paid: true,
    });
  });

  it("a second click gets the same draft, and makes no second one", async () => {
    const s = setup({ "pro-1": proforma() });
    const first = await s.service.advanceFromProforma("pro-1", USER);
    const second = await s.service.advanceFromProforma("pro-1", USER);
    assert.deepEqual(
      [first.id, second.id, s.created.length],
      [advanceIdFor("pro-1"), advanceIdFor("pro-1"), 1],
    );
  });

  it("the links: the advance names its proforma, the proforma its advance", () => {
    assert.deepEqual(
      proformaLinks({
        proformaInvoice: null,
        invoicesFromProforma: [
          { id: "a", status: "DRAFT", invoiceNumber: null },
        ],
      } as never),
      { proforma: null, advance: { id: "a", number: null, status: "DRAFT" } },
    );
    assert.deepEqual(proformaLinks({} as never), {
      proforma: null,
      advance: null,
    });
  });
});

describe("is the proforma paid, by the feed", () => {
  it("paid, known unpaid, or not known", async () => {
    const answer = async (twin: unknown) => {
      const repository = new BillingDocumentsRepository();
      (repository as unknown as { database: unknown }).database = {
        externalBillingDocument: { findFirst: async () => twin },
      };
      return repository.feedPaid("D-1");
    };
    assert.deepEqual(
      [
        await answer(null),
        await answer({ paymentsKnown: true, paidAmount: d("100") }),
        await answer({ paymentsKnown: true, paidAmount: d("0") }),
        await answer({ paymentsKnown: null, paidAmount: d("0") }),
      ],
      [null, true, false, null],
    );
  });
});
