import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  AuthenticatedUser,
  BillingDocumentDetail,
  WebshopOrderDetail,
} from "@acropora/types";

import type { BillingDocumentIssueService } from "../../billing/billing-document-issue.service.js";
import type { BillingDocumentsService } from "../../billing/billing-documents.service.js";
import type { CustomersRepository } from "../../customers/customers.repository.js";
import { deliveryNoteDraftOf } from "./webshop-order-invoice.rules.js";
import { WebshopOrderInvoiceService } from "./webshop-order-invoice.service.js";
import type {
  WebshopOrderInvoiceRow,
  WebshopOrdersRepository,
} from "./webshop-orders.repository.js";
import type { WebshopOrdersService } from "./webshop-orders.service.js";

/*
  A RENDELÉS SZÁLLÍTÓLEVELE (kártya 0a14f739 C/1). MI PIROSÍT: számla nélkül
  vagy ki nem állított számla mellé szállítólevél készül; a szállítólevél
  más vevőre, más tételekkel vagy más teljesítési nappal készül, mint a
  számla; a kedvezmény-sor kétszer kerül rá; a kiállított szállítólevél
  második kattintásra újra kiállítódik; a meglévő vázlat mellé második
  készül; kikapcsolt kiállításnál bármi keletkezik.
*/
const USER = { id: "user_1" } as AuthenticatedUser;
const NOW = new Date("2026-10-06T08:00:00.000Z");

const INVOICE = {
  id: "webshop-order_38",
  status: "ISSUED",
  documentNumber: "ACRW-2026/00512",
  documentType: "INVOICE",
  invoiceFormat: "ELECTRONIC",
  customer: { id: "cust_7", name: "Nagy Emese" },
  fulfillmentDate: "2026-10-05",
  dueDate: "2026-10-05",
  paymentMethod: "Bankkártya",
  currency: "HUF",
  language: "hu",
  reference: "Webshop rendelés #38",
  note: null,
  lines: [
    {
      id: "l1",
      kind: "ITEM",
      parentLineId: null,
      productId: "prod_1",
      variantId: "var_1",
      description: "Reef Salt Pro 20 kg",
      quantity: "1",
      unit: "db",
      unitNet: "14881.8898",
      vatRatePercent: "27",
      discountPercent: "10",
      comment: null,
    },
    {
      id: "l2",
      kind: "DISCOUNT",
      parentLineId: "l1",
      productId: null,
      description: "Kedvezmény (10%)",
      quantity: "1",
      unit: null,
      unitNet: "-1488.1890",
      vatRatePercent: "27",
      discountPercent: "10",
      comment: null,
    },
    {
      id: "l3",
      kind: "ITEM",
      parentLineId: null,
      productId: null,
      description: "Szállítás (GLS)",
      quantity: "1",
      unit: null,
      unitNet: "1574.8031",
      vatRatePercent: "27",
      discountPercent: null,
      comment: null,
    },
  ],
  updatedAt: "2026-10-05T12:00:01.000Z",
} as unknown as BillingDocumentDetail;

describe("deliveryNoteDraftOf", () => {
  it("carries the invoice's buyer, items and day, and refers to its number", () => {
    const result = deliveryNoteDraftOf("order_38", INVOICE);
    assert.ok(result.ok);
    assert.deepEqual(result.draft, {
      id: "webshop-dn-order_38",
      documentType: "DELIVERY_NOTE",
      invoiceFormat: null,
      customerId: "cust_7",
      fulfillmentDate: "2026-10-05",
      dueDate: null,
      paymentMethod: null,
      currency: "HUF",
      language: "hu",
      reference: "Webshop rendelés #38",
      note: "Számla: ACRW-2026/00512",
      sourceType: "WEBSHOP_ORDER",
      sourceId: "order_38",
      lines: [
        {
          productId: "prod_1",
          variantId: "var_1",
          description: "Reef Salt Pro 20 kg",
          quantity: "1",
          unit: "db",
          unitNet: "14881.8898",
          vatRatePercent: "27",
          discountPercent: "10",
          comment: null,
        },
        {
          productId: null,
          variantId: null,
          description: "Szállítás (GLS)",
          quantity: "1",
          unit: null,
          unitNet: "1574.8031",
          vatRatePercent: "27",
          discountPercent: null,
          comment: null,
        },
      ],
    });
  });

  it("an invoice not yet issued gives no delivery note", () => {
    for (const status of ["DRAFT", "ISSUING", "ISSUE_FAILED"] as const) {
      const result = deliveryNoteDraftOf("order_38", { ...INVOICE, status });
      assert.equal(result.ok, false, status);
    }
  });
});

function setup(
  over: {
    mode?: "live" | "stub" | "off" | "conflict";
    invoice?: WebshopOrderInvoiceRow | null;
    note?: WebshopOrderInvoiceRow;
  } = {},
) {
  const calls: string[] = [];
  const orders = {
    detail: async (id: string) => {
      calls.push(`detail ${id}`);
      return { id } as WebshopOrderDetail;
    },
  } as unknown as WebshopOrdersService;
  const invoice =
    over.invoice === undefined
      ? { id: "webshop-order_38", status: "ISSUED" as const, number: "E-1" }
      : over.invoice;
  const repository = {
    invoices: async (ids: string[], type = "INVOICE") => {
      const row = type === "DELIVERY_NOTE" ? over.note : invoice;
      return new Map(row ? [[ids[0]!, row]] : []);
    },
  } as unknown as WebshopOrdersRepository;
  const doc = (id: string) =>
    (id === INVOICE.id
      ? INVOICE
      : {
          id,
          updatedAt: "2026-10-06T08:00:01.000Z",
        }) as BillingDocumentDetail;
  const documents = {
    create: async (input: {
      id: string;
      documentType: string;
      customerId: string;
      lines: unknown[];
    }) => {
      calls.push(
        `create ${input.documentType} ${input.id} for ${input.customerId}, ${input.lines.length} lines`,
      );
      return doc(input.id);
    },
    detail: async (id: string) => doc(id),
    update: async (
      id: string,
      input: { documentType: string; expectedUpdatedAt: string },
    ) => {
      calls.push(
        `update ${input.documentType} ${id} at ${input.expectedUpdatedAt}`,
      );
      return doc(id);
    },
  } as unknown as BillingDocumentsService;
  const issuing = {
    issueMode: () => over.mode ?? "stub",
    issue: async (id: string, expected: string) => {
      calls.push(`issue ${id} ${expected}`);
    },
  } as unknown as BillingDocumentIssueService;
  return {
    calls,
    service: new WebshopOrderInvoiceService(
      orders,
      repository,
      {} as CustomersRepository,
      documents,
      issuing,
    ),
  };
}

describe("WebshopOrderInvoiceService.issueDeliveryNote", () => {
  it("after an issued invoice: one draft from it, and one issue", async () => {
    const { calls, service } = setup();
    await service.issueDeliveryNote("order_38", USER, NOW);
    assert.deepEqual(calls, [
      "create DELIVERY_NOTE webshop-dn-order_38 for cust_7, 2 lines",
      "issue webshop-dn-order_38 2026-10-06T08:00:01.000Z",
      "detail order_38",
    ]);
  });

  it("no invoice, or one not issued: refused, nothing is created", async () => {
    for (const invoice of [
      null,
      { id: "webshop-order_38", status: "DRAFT" as const, number: null },
      { id: "webshop-order_38", status: "ISSUING" as const, number: null },
    ]) {
      const { calls, service } = setup({ invoice });
      await assert.rejects(service.issueDeliveryNote("order_38", USER, NOW), {
        status: 409,
        message: /előbb állítsd ki a számlát/,
      });
      assert.deepEqual(calls, []);
    }
  });

  it("an issued delivery note is returned, not issued again; issuing or failed stops", async () => {
    const issued = setup({
      note: { id: "webshop-dn-order_38", status: "ISSUED", number: "SL-1" },
    });
    await issued.service.issueDeliveryNote("order_38", USER, NOW);
    assert.deepEqual(issued.calls, ["detail order_38"]);

    for (const status of ["ISSUING", "ISSUE_FAILED"] as const) {
      const { calls, service } = setup({
        note: { id: "webshop-dn-order_38", status, number: null },
      });
      await assert.rejects(service.issueDeliveryNote("order_38", USER, NOW), {
        status: 409,
      });
      assert.deepEqual(calls, []);
    }
  });

  it("an earlier draft is refreshed and issued, not doubled", async () => {
    const { calls, service } = setup({
      note: { id: "webshop-dn-order_38", status: "DRAFT", number: null },
    });
    await service.issueDeliveryNote("order_38", USER, NOW);
    assert.deepEqual(calls, [
      "update DELIVERY_NOTE webshop-dn-order_38 at 2026-10-06T08:00:01.000Z",
      "issue webshop-dn-order_38 2026-10-06T08:00:01.000Z",
      "detail order_38",
    ]);
  });

  it("with issuing off or contradictory, nothing is created", async () => {
    for (const mode of ["off", "conflict"] as const) {
      const { calls, service } = setup({ mode });
      await assert.rejects(service.issueDeliveryNote("order_38", USER, NOW), {
        status: 409,
      });
      assert.deepEqual(calls, []);
    }
  });
});
