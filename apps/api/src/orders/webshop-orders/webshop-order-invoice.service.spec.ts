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
import type {
  MedusaOrderBusinessStatus,
  MedusaOrderDetailRow,
} from "../../integrations/medusa/medusa-admin.client.js";
import { WebshopOrderInvoiceService } from "./webshop-order-invoice.service.js";
import type {
  WebshopOrderInvoiceRow,
  WebshopOrdersRepository,
} from "./webshop-orders.repository.js";
import type { WebshopOrdersService } from "./webshop-orders.service.js";

/*
  A WEBSHOP RENDELÉS SZÁMLÁJA, A MELLÉKHATÁSOKKAL. MI PIROSÍT: kikapcsolt
  kiállításnál mégis partner vagy vázlat keletkezik; a kiállított számla
  második kattintásra újra kiállítódik; a kiállítás alatti vagy elutasított
  számla mellé új készül; a vendég nem kap partnert és kötést; az azonos
  e-mailű partnerek közül a szolgáltatás választ; régi címmel álló partnerre
  kiállítunk; a meglévő vázlat helyett második készül; két egyidejű kattintás
  két partnert hoz létre.
*/
const USER = { id: "user_1" } as AuthenticatedUser;
const NOW = new Date("2026-10-05T12:00:00.000Z");

const ORDER: MedusaOrderDetailRow = {
  id: "order_38",
  display_id: 38,
  created_at: "2026-10-05T11:21:00.000Z",
  email: "emese@example.hu",
  currency_code: "huf",
  customer_id: null,
  metadata: null,
  total: 18900,
  subtotal: 18900,
  discount_total: 0,
  shipping_total: 0,
  shipping_address: null,
  billing_address: {
    first_name: "Emese",
    last_name: "Nagy",
    address_1: "Fehérvári út 24.",
    city: "Budapest",
    postal_code: "1117",
    country_code: "hu",
  },
  items: [
    {
      id: "i1",
      title: "Reef Salt Pro 20 kg",
      product_title: "Reef Salt Pro 20 kg",
      variant_title: null,
      variant_sku: "RSP-20",
      quantity: 1,
      unit_price: 18900,
      total: 18900,
      metadata: null,
      tax_lines: [{ rate: 27 }],
    },
  ],
  shipping_methods: [],
  payment_collections: [],
};

const SAME_BUYER = {
  name: "Nagy Emese",
  taxNumber: null,
  postalCode: "1117",
  city: "Budapest",
  line: "Fehérvári út 24.",
};

function setup(
  over: {
    mode?: "live" | "stub" | "off" | "conflict";
    invoice?: WebshopOrderInvoiceRow;
    status?: string;
    linked?: string | null;
    byEmail?: { id: string; displayName: string; linked: boolean }[];
    buyer?: typeof SAME_BUYER;
    /** A rendelés fizetési munkamenetének szolgáltatója (függő fizetés). */
    provider?: string;
  } = {},
) {
  const calls: string[] = [];
  const orders = {
    source: async () => {
      calls.push("source");
      return {
        order: over.provider
          ? {
              ...ORDER,
              payment_collections: [
                {
                  payments: [],
                  payment_sessions: [
                    {
                      provider_id: over.provider,
                      status: "pending_authorization",
                    },
                  ],
                },
              ],
            }
          : ORDER,
        status: {
          status: over.status ?? "confirmed",
        } as MedusaOrderBusinessStatus,
      };
    },
    detail: async (id: string) => {
      calls.push(`detail ${id}`);
      return { id } as WebshopOrderDetail;
    },
  } as unknown as WebshopOrdersService;
  const repository = {
    invoices: async (ids: string[]) =>
      new Map(over.invoice ? [[ids[0]!, over.invoice]] : []),
    customerByKey: async (key: string) => {
      calls.push(`customerByKey ${key}`);
      return over.linked ?? null;
    },
    customersByEmail: async () => over.byEmail ?? [],
    linkCustomer: async (customerId: string, key: string) => {
      calls.push(`link ${customerId} ${key}`);
      return customerId;
    },
    customerBuyer: async () => over.buyer ?? SAME_BUYER,
  } as unknown as WebshopOrdersRepository;
  const customers = {
    create: async (input: { displayName: string }) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      calls.push(`create customer ${input.displayName}`);
      return { id: "cust_new" };
    },
  } as unknown as CustomersRepository;
  const doc = (id: string) =>
    ({ id, updatedAt: "2026-10-05T12:00:01.000Z" }) as BillingDocumentDetail;
  const documents = {
    create: async (input: {
      id: string;
      customerId: string;
      sourceId: string;
    }) => {
      calls.push(
        `create draft ${input.id} for ${input.customerId} from ${input.sourceId}`,
      );
      return doc(input.id);
    },
    detail: async (id: string) => doc(id),
    update: async (id: string, input: { expectedUpdatedAt: string }) => {
      calls.push(`update draft ${id} at ${input.expectedUpdatedAt}`);
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
      customers,
      documents,
      issuing,
      {} as never,
      {} as never,
    ),
  };
}

describe("WebshopOrderInvoiceService", () => {
  it("a guest gets a partner and a link, then one draft and one issue", async () => {
    const { calls, service } = setup();
    await service.issue("order_38", USER, NOW);
    assert.deepEqual(calls, [
      "source",
      "customerByKey guest:emese@example.hu",
      "create customer Nagy Emese",
      "link cust_new guest:emese@example.hu",
      "create draft webshop-order_38 for cust_new from order_38",
      "issue webshop-order_38 2026-10-05T12:00:01.000Z",
      "detail order_38",
    ]);
  });

  it("with issuing off or contradictory, nothing is created", async () => {
    for (const mode of ["off", "conflict"] as const) {
      const { calls, service } = setup({ mode });
      await assert.rejects(service.issue("order_38", USER, NOW), {
        status: 409,
      });
      assert.deepEqual(calls, []);
    }
  });

  it("an issued invoice is returned, not issued again; issuing or failed stops", async () => {
    const issued = setup({
      invoice: { id: "webshop-order_38", status: "ISSUED", number: "E-1" },
    });
    await issued.service.issue("order_38", USER, NOW);
    assert.deepEqual(issued.calls, ["detail order_38"]);

    for (const status of ["ISSUING", "ISSUE_FAILED"] as const) {
      const { calls, service } = setup({
        invoice: { id: "webshop-order_38", status, number: null },
      });
      await assert.rejects(service.issue("order_38", USER, NOW), {
        status: 409,
      });
      assert.deepEqual(calls, []);
    }
  });

  it("an earlier draft is refreshed from the order and issued, not doubled", async () => {
    const { calls, service } = setup({
      invoice: { id: "webshop-order_38", status: "DRAFT", number: null },
      linked: "cust_7",
    });
    await service.issue("order_38", USER, NOW);
    assert.deepEqual(calls.slice(2), [
      "update draft webshop-order_38 at 2026-10-05T12:00:01.000Z",
      "issue webshop-order_38 2026-10-05T12:00:01.000Z",
      "detail order_38",
    ]);
  });

  /*
    ELŐRE UTALÁSNÁL A SZÁMLÁT A SZÁMLÁZZ.HU ÁLLÍTJA KI (bb3a6bd5; Balázs,
    2026-10-06 18:22 UTC). MI PIROSÍT: az OS is kiállít mellé egyet.
  */
  it("a prepaid order gets no OS invoice: Számlázz.hu issues it", async () => {
    const { calls, service } = setup({ provider: "pp_acropora_transfer" });
    await assert.rejects(service.issue("order_38", USER, NOW), {
      status: 409,
      message: /Számlázz\.hu állítja ki/,
    });
    assert.deepEqual(calls, ["source"]);
  });

  it("an unconfirmed order is refused before any partner is made", async () => {
    const { calls, service } = setup({ status: "pending_processing" });
    await assert.rejects(service.issue("order_38", USER, NOW), {
      message: /visszaigazolás után/,
    });
    assert.deepEqual(calls, ["source"]);
  });

  it("one partner with the e-mail is linked; several are not chosen between", async () => {
    const one = setup({
      byEmail: [{ id: "cust_3", displayName: "Nagy Emese", linked: false }],
    });
    await one.service.issue("order_38", USER, NOW);
    assert.ok(one.calls.includes("link cust_3 guest:emese@example.hu"));
    assert.ok(!one.calls.some((call) => call.startsWith("create customer")));

    const several = setup({
      byEmail: [
        { id: "cust_3", displayName: "Nagy Emese", linked: false },
        { id: "cust_4", displayName: "Nagy E.", linked: true },
      ],
    });
    await assert.rejects(several.service.issue("order_38", USER, NOW), {
      message: /több partner.*Nagy Emese, Nagy E\./,
    });
    assert.ok(!several.calls.some((call) => call.startsWith("create")));
  });

  it("a partner with another address is not invoiced to", async () => {
    const { calls, service } = setup({
      linked: "cust_7",
      buyer: { ...SAME_BUYER, line: "Bartók Béla út 1." },
    });
    await assert.rejects(service.issue("order_38", USER, NOW), {
      status: 409,
      message: /eltérnek/,
    });
    assert.ok(!calls.some((call) => call.includes("draft")));
  });

  it("two clicks at once make one partner", async () => {
    let linkedKey: string | null = null;
    const { calls, service } = setup();
    const repository = (
      service as unknown as { repository: WebshopOrdersRepository }
    ).repository;
    Object.assign(repository, {
      customerByKey: async () => linkedKey,
      linkCustomer: async (id: string) => {
        linkedKey = id;
        return id;
      },
    });
    await Promise.all([
      service.issue("order_38", USER, NOW),
      service.issue("order_38", USER, NOW),
    ]);
    assert.equal(
      calls.filter((call) => call.startsWith("create customer")).length,
      1,
    );
  });
});
