import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  AuthenticatedUser,
  BillingDocumentDetail,
  WebshopOrderDetail,
  WebshopOrderTaxCheck,
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
  taxNumber: null as string | null,
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
    byTax?: {
      id: string;
      displayName: string;
      linked: boolean;
      partnerMirror?: boolean;
    }[];
    /** A rendelés (alapból a magánszemélyes ORDER). */
    orderOverride?: MedusaOrderDetailRow;
    buyer?: typeof SAME_BUYER;
    /** A rendelés fizetési munkamenetének szolgáltatója (függő fizetés). */
    provider?: string;
    /** The summary's send address (card 7ba97e0d, S2); null: the partner has none. */
    buyerEmail?: string | null;
    /** The mail service throws (a closed gate, a provider error). */
    sendFails?: boolean;
    /** The NAV check of the order's tax number (c977aed2, P2); alapból NONE. */
    taxCheck?: WebshopOrderTaxCheck;
    /** The prepaid order's recorded transfer (d31a66a3, S1); absent: none recorded. */
    receipt?: { amount: string; advance?: boolean; receivedOn?: string };
    /** Számlázz.hu feed invoices of the order not issued by the OS (the Autokassza check). */
    foreign?: string[];
    /** The saved draft's gross (alapból 18900.00). */
    gross?: string;
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
          : (over.orderOverride ?? ORDER),
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
    customersByEmail: async () => {
      calls.push("customersByEmail");
      return over.byEmail ?? [];
    },
    customersByTaxKey: async (key: { kind: string; value: string }) => {
      calls.push(`customersByTaxKey ${key.kind} ${key.value}`);
      return (over.byTax ?? []).map((row) => ({
        partnerMirror: false,
        ...row,
      }));
    },
    linkCustomer: async (customerId: string, key: string) => {
      calls.push(`link ${customerId} ${key}`);
      return customerId;
    },
    customerBuyer: async () => over.buyer ?? SAME_BUYER,
    transferReceipts: async (ids: string[]) => {
      calls.push("transferReceipts");
      return new Map(
        over.receipt
          ? [
              [
                ids[0]!,
                {
                  source: "MANUAL",
                  receivedOn: over.receipt.receivedOn ?? "2026-10-03",
                  reference: "UT-38",
                  amount: over.receipt.amount,
                  currency: "HUF",
                  recordedBy: "Teszt Elek",
                  advance: over.receipt.advance ?? false,
                },
              ],
            ]
          : [],
      );
    },
    transferReceiptProforma: async () => ({
      id: "proforma_38",
      number: "D-ACR-2026-12",
      reference: "Webshop rendelés #38",
      issuedOn: new Date("2026-10-01T09:00:00.000Z"),
    }),
    foreignFeedInvoices: async (
      orderId: string,
      proforma: { number: string },
    ) => {
      calls.push(`foreignFeedInvoices ${orderId} ${proforma.number}`);
      return over.foreign ?? [];
    },
    linkInvoiceProforma: async (invoiceId: string, proformaId: string) => {
      calls.push(`link proforma ${proformaId} to ${invoiceId}`);
      return true;
    },
  } as unknown as WebshopOrdersRepository;
  const customers = {
    create: async (input: { displayName: string }) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      calls.push(`create customer ${input.displayName}`);
      return { id: "cust_new" };
    },
  } as unknown as CustomersRepository;
  const doc = (id: string) =>
    ({
      id,
      updatedAt: "2026-10-05T12:00:01.000Z",
      currency: "HUF",
      totals: {
        netAmount: "14882.00",
        vatAmount: "4018.00",
        grossAmount: over.gross ?? "18900.00",
      },
    }) as BillingDocumentDetail;
  const drafts: { fulfillmentDate: string; dueDate: string }[] = [];
  const documents = {
    create: async (input: {
      id: string;
      customerId: string;
      sourceId: string;
      fulfillmentDate: string;
      dueDate: string;
    }) => {
      calls.push(
        `create draft ${input.id} for ${input.customerId} from ${input.sourceId}`,
      );
      drafts.push({
        fulfillmentDate: input.fulfillmentDate,
        dueDate: input.dueDate,
      });
      return doc(input.id);
    },
    detail: async (id: string) => doc(id),
    update: async (id: string, input: { expectedUpdatedAt: string }) => {
      calls.push(`update draft ${id} at ${input.expectedUpdatedAt}`);
      return doc(id);
    },
  } as unknown as BillingDocumentsService;
  const confirmations: unknown[] = [];
  const sent: unknown[] = [];
  const issuing = {
    issueMode: () => over.mode ?? "stub",
    issue: async (
      id: string,
      expected: string,
      _user: unknown,
      confirmation?: unknown,
    ) => {
      calls.push(`issue ${id} ${expected}`);
      confirmations.push(confirmation);
    },
    summary: async (id: string) => {
      calls.push(`summary ${id}`);
      return {
        buyerName: "Nagy Emese",
        buyerEmail:
          over.buyerEmail === undefined ? "emese@example.hu" : over.buyerEmail,
        issueDate: "2026-10-05",
        fulfillmentDate: "2026-10-05",
        dueDate: "2026-10-13",
        fingerprint: "f".repeat(64),
      };
    },
  } as unknown as BillingDocumentIssueService;
  const email = {
    send: async (id: string, input: unknown) => {
      calls.push(`send ${id}`);
      if (over.sendFails)
        throw new Error("A levelezés ezen a szerveren ki van kapcsolva.");
      sent.push(input);
    },
  };
  const emailDrafts = {
    templateDraft: async () => ({
      subject: "Számla – {{document_number}}",
      body: "Csatolva.",
      bodyHtml: null,
    }),
  };
  return {
    calls,
    confirmations,
    sent,
    drafts,
    service: new WebshopOrderInvoiceService(
      orders,
      repository,
      customers,
      documents,
      issuing,
      email as never,
      emailDrafts as never,
      {
        check: async () => {
          return (
            over.taxCheck ?? {
              state: "NONE",
              taxNumber: null,
              navName: null,
              nameMatches: null,
            }
          );
        },
      } as never,
    ),
  };
}

/**
 * A NAV-ELLENŐRZÉS A SZÁMLA ELŐTT (kártya c977aed2, P2). MI PIROSÍT: ha a NAV által ismeretlen vagy hibás alakú adószámra számla
 * indul; ha emiatt előbb már OS-partner vagy vázlat jött létre; ha a NAV kiesése megállítja a számlát.
 */
describe("WebshopOrderInvoiceService: the tax number check", () => {
  const check = (
    state: WebshopOrderTaxCheck["state"],
    taxNumber: string | null = "12345678-2-41",
  ): WebshopOrderTaxCheck => ({
    state,
    taxNumber,
    navName: null,
    nameMatches: null,
  });

  for (const state of ["INVALID", "MALFORMED"] as const)
    it(`${state}: 409 that names the number, before any partner or draft is created`, async () => {
      const { calls, service } = setup({ taxCheck: check(state) });
      await assert.rejects(
        service.issue("order_38", USER, NOW),
        (error: unknown) => {
          assert.equal((error as { status: number }).status, 409);
          assert.match((error as Error).message, /12345678-2-41/);
          return true;
        },
      );
      assert.deepEqual(calls, ["source"]);
    });

  it("the summary window asks the same question, and stops the same way", async () => {
    const { calls, service } = setup({ taxCheck: check("INVALID") });
    await assert.rejects(service.invoiceSummary("order_38", USER, NOW), {
      status: 409,
    });
    assert.deepEqual(calls, ["source"]);
  });

  for (const state of ["VALID", "UNAVAILABLE", "NONE"] as const)
    it(`${state}: the invoice goes on (NAV being down does not stop an invoice)`, async () => {
      const { calls, service } = setup({ taxCheck: check(state) });
      await service.issue("order_38", USER, NOW);
      assert.ok(calls.some((call) => call.startsWith("issue ")));
    });
});

describe("WebshopOrderInvoiceService", () => {
  it("a guest gets a partner and a link, then one draft and one issue", async () => {
    const { calls, service } = setup();
    await service.issue("order_38", USER, NOW);
    assert.deepEqual(calls, [
      "source",
      "customerByKey guest:emese@example.hu",
      "customersByEmail",
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
    ELŐRE UTALÁSNÁL AZ OS ÁLLÍTJA KI, A BEÉRKEZÉS UTÁN (d31a66a3, S1; az Autokassza ki van kapcsolva). MI PIROSÍT: beérkezés
    nélkül, előleg-beérkezésre vagy egy már meglévő, nem OS-es Számlázz.hu-számla mellé kiállít, vagy közben partnert hoz
    létre; a kifizetett számla nem a beérkezés napjával, nem a díjbekérőre hivatkozva, vagy más összeggel megy ki.
  */
  const TRANSFER = "pp_acropora_transfer";

  it("a prepaid order without a recorded transfer gets no invoice, and no partner", async () => {
    const { calls, service } = setup({ provider: TRANSFER });
    await assert.rejects(service.issue("order_38", USER, NOW), {
      status: 409,
      message: /beérkezése után állítható ki/,
    });
    assert.deepEqual(calls, ["source", "transferReceipts"]);
  });

  it("an advance transfer is not invoiced as the whole order", async () => {
    const { calls, service } = setup({
      provider: TRANSFER,
      receipt: { amount: "5670.0000", advance: true },
    });
    await assert.rejects(service.issue("order_38", USER, NOW), {
      status: 409,
      message: /előleg érkezett/,
    });
    assert.deepEqual(calls, ["source", "transferReceipts"]);
  });

  it("a Számlázz.hu invoice the OS did not issue stops it, by its number", async () => {
    const { calls, service } = setup({
      provider: TRANSFER,
      receipt: { amount: "18900.0000" },
      foreign: ["E-ACR-2026-77"],
    });
    await assert.rejects(service.issue("order_38", USER, NOW), {
      status: 409,
      message: /E-ACR-2026-77/,
    });
    assert.deepEqual(calls, [
      "source",
      "transferReceipts",
      "foreignFeedInvoices order_38 D-ACR-2026-12",
    ]);
  });

  it("a paid transfer is invoiced on its day, settling the proforma", async () => {
    const { calls, drafts, service } = setup({
      provider: TRANSFER,
      receipt: { amount: "18900.0000", receivedOn: "2026-10-03" },
    });
    await service.issue("order_38", USER, NOW);
    assert.deepEqual(drafts, [
      { fulfillmentDate: "2026-10-03", dueDate: "2026-10-03" },
    ]);
    assert.deepEqual(calls.slice(-4), [
      "create draft webshop-order_38 for cust_new from order_38",
      "link proforma proforma_38 to webshop-order_38",
      "issue webshop-order_38 2026-10-05T12:00:01.000Z",
      "detail order_38",
    ]);
  });

  it("a draft whose gross is not the transfer is not issued", async () => {
    const { calls, service } = setup({
      provider: TRANSFER,
      receipt: { amount: "18900.0000" },
      gross: "19350.00",
    });
    await assert.rejects(service.issue("order_38", USER, NOW), {
      status: 409,
      message: /nem egyezik a beérkezett utalással \(18900 HUF\)/,
    });
    assert.ok(!calls.some((call) => call.startsWith("issue ")));
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

  /*
    A CÉGET AZ ADÓSZÁM AZONOSÍTJA, NEM AZ E-MAIL (kártya c499739d, Balázs 2026-11-11 10:54 UTC). MI PIROSÍT: egy céges rendelés más
    e-mail címmel új vevő-sort hoz létre a meglévő helyett; az adószámos rendelésnél az e-mail dönt; több azonos adószámú vevőnél a
    szolgáltatás választ; nincs adószám-találat, mégis az e-mail alapján köt; a magánszemély nem az adószám útján megy.
  */
  const COMPANY_ORDER = (taxId: string): MedusaOrderDetailRow => ({
    ...ORDER,
    email: "rendeles.kiss.anna@example.hu",
    billing_address: {
      ...ORDER.billing_address!,
      company: "Fővárosi Állat- és Növénykert",
      metadata: { tax_id: taxId },
    },
  });

  it("an Állatkert-shaped order: a different e-mail, the SAME tax number: the existing customer row, no new one", async () => {
    const { calls, service } = setup({
      orderOverride: COMPANY_ORDER("15509246-2-41"),
      byTax: [
        {
          id: "cust_fank",
          displayName: "Fővárosi Állat- és Növénykert",
          linked: false,
        },
      ],
      buyer: {
        ...SAME_BUYER,
        name: "Fővárosi Állat- és Növénykert",
        taxNumber: "15509246-2-41",
      },
    });
    await service.issue("order_38", USER, NOW);
    assert.ok(calls.includes("customersByTaxKey HU 15509246"));
    assert.ok(
      calls.includes("link cust_fank guest:rendeles.kiss.anna@example.hu"),
    );
    assert.ok(
      calls.some(
        (c) => c.startsWith("create draft") && c.includes("for cust_fank"),
      ),
    );
    assert.equal(
      calls.some((c) => c.startsWith("create customer")),
      false,
      "no new customer",
    );
    assert.equal(
      calls.includes("customersByEmail"),
      false,
      "the e-mail does not decide when there is a tax number",
    );
  });

  it("the Hungarian key is the first eight digits: any stored shape of the same company is one key", async () => {
    for (const taxId of [
      "15509246-2-41",
      "15509246241",
      "HU15509246",
      "hu 15509246-2-41",
    ]) {
      const { calls, service } = setup({
        orderOverride: COMPANY_ORDER(taxId),
        byTax: [{ id: "cust_fank", displayName: "FANK", linked: true }],
        buyer: {
          ...SAME_BUYER,
          name: "Fővárosi Állat- és Növénykert",
          taxNumber: taxId,
        },
      });
      await service.issue("order_38", USER, NOW);
      assert.ok(calls.includes("customersByTaxKey HU 15509246"), taxId);
    }
  });

  it("a community tax number is its own kind of key, with the country code (never the Hungarian eight digits)", async () => {
    const { calls, service } = setup({
      orderOverride: COMPANY_ORDER("DE 123 456 789"),
      byTax: [{ id: "cust_de", displayName: "Aquaristik GmbH", linked: true }],
      buyer: {
        ...SAME_BUYER,
        name: "Fővárosi Állat- és Növénykert",
        taxNumber: "DE 123 456 789",
      },
    });
    await service.issue("order_38", USER, NOW);
    assert.ok(calls.includes("customersByTaxKey EU DE123456789"));
    assert.equal(
      calls.some((c) => c.includes("customersByTaxKey HU")),
      false,
    );
  });

  it("several customers on the same tax key: NO invoice, the reason names them, nothing is created or linked", async () => {
    const { calls, service } = setup({
      orderOverride: COMPANY_ORDER("15509246-2-41"),
      byTax: [
        { id: "cust_a", displayName: "FANK régi sor", linked: false },
        { id: "cust_b", displayName: "FANK másik régi sor", linked: true },
      ],
    });
    await assert.rejects(service.issue("order_38", USER, NOW), {
      status: 409,
      message: /ezzel az adószámmal.*FANK régi sor, FANK másik régi sor/s,
    });
    assert.equal(
      calls.some((c) => c.startsWith("create") || c.startsWith("link")),
      false,
    );
  });

  it("THE MOTIVATING CASE: the old customer row and the partner's mirror on the same key: the MIRROR is the customer (the invoice's right buyer), no 409", async () => {
    const { calls, service } = setup({
      orderOverride: COMPANY_ORDER("15509246-2-41"),
      byTax: [
        { id: "cust_old", displayName: "FANK régi vevő-sor", linked: false },
        {
          id: "cust_mirror",
          displayName: "FANK partner tükör",
          linked: false,
          partnerMirror: true,
        },
      ],
      buyer: {
        ...SAME_BUYER,
        name: "Fővárosi Állat- és Növénykert",
        taxNumber: "15509246-2-41",
      },
    });
    await service.issue("order_38", USER, NOW);
    assert.ok(
      calls.includes("link cust_mirror guest:rendeles.kiss.anna@example.hu"),
    );
    assert.ok(
      calls.some(
        (c) => c.startsWith("create draft") && c.includes("for cust_mirror"),
      ),
    );
    assert.equal(
      calls.some((c) => c.includes("cust_old")),
      false,
    );
    assert.equal(
      calls.some((c) => c.startsWith("create customer")),
      false,
    );
  });

  it("the old row of a DELETED partner is no mirror (the repository says so): next to a plain old row it makes two plain rows, and the invoice is refused", async () => {
    const { calls, service } = setup({
      orderOverride: COMPANY_ORDER("15509246-2-41"),
      byTax: [
        { id: "cust_old", displayName: "FANK régi vevő-sor", linked: false },
        {
          id: "cust_deleted",
          displayName: "FANK megszűnt partner sora",
          linked: false,
          partnerMirror: false,
        },
      ],
    });
    await assert.rejects(service.issue("order_38", USER, NOW), {
      status: 409,
      message: /ezzel az adószámmal/,
    });
    assert.equal(
      calls.some((c) => c.startsWith("create") || c.startsWith("link")),
      false,
    );
  });

  it("the mirror rule needs EXACTLY ONE mirror: two mirrors, or several rows and no mirror, are still refused", async () => {
    for (const rows of [
      [
        {
          id: "m1",
          displayName: "FANK tükör 1",
          linked: false,
          partnerMirror: true,
        },
        {
          id: "m2",
          displayName: "FANK tükör 2",
          linked: false,
          partnerMirror: true,
        },
      ],
      [
        { id: "a", displayName: "FANK régi A", linked: false },
        { id: "b", displayName: "FANK régi B", linked: false },
      ],
      [
        {
          id: "m1",
          displayName: "FANK tükör",
          linked: false,
          partnerMirror: true,
        },
        {
          id: "m2",
          displayName: "FANK tükör 2",
          linked: false,
          partnerMirror: true,
        },
        { id: "old", displayName: "FANK régi", linked: false },
      ],
    ]) {
      const { calls, service } = setup({
        orderOverride: COMPANY_ORDER("15509246-2-41"),
        byTax: rows,
      });
      await assert.rejects(service.issue("order_38", USER, NOW), {
        status: 409,
        message: /ezzel az adószámmal/,
      });
      assert.equal(
        calls.some((c) => c.startsWith("create") || c.startsWith("link")),
        false,
      );
    }
  });

  it("an order WITH a tax number and no match makes a new customer: the e-mail is not asked, even if it matches somebody", async () => {
    const { calls, service } = setup({
      orderOverride: COMPANY_ORDER("15509246-2-41"),
      byTax: [],
      byEmail: [
        { id: "cust_somebody", displayName: "Valaki Más", linked: false },
      ],
      buyer: {
        ...SAME_BUYER,
        name: "Fővárosi Állat- és Növénykert",
        taxNumber: "15509246-2-41",
      },
    });
    await service.issue("order_38", USER, NOW);
    assert.ok(calls.some((c) => c.startsWith("create customer")));
    assert.equal(calls.includes("customersByEmail"), false);
  });

  it("an order WITHOUT a tax number (a private person) goes by e-mail as before, and never asks the tax lookup", async () => {
    const { calls, service } = setup({
      byEmail: [{ id: "cust_emese", displayName: "Nagy Emese", linked: false }],
    });
    await service.issue("order_38", USER, NOW);
    assert.ok(calls.includes("customersByEmail"));
    assert.equal(
      calls.some((c) => c.startsWith("customersByTaxKey")),
      false,
    );
    assert.ok(calls.includes("link cust_emese guest:emese@example.hu"));
  });

  it("an already linked order key still wins over everything: no tax lookup, no e-mail lookup", async () => {
    const { calls, service } = setup({
      orderOverride: COMPANY_ORDER("15509246-2-41"),
      linked: "cust_7",
      buyer: {
        ...SAME_BUYER,
        name: "Fővárosi Állat- és Növénykert",
        taxNumber: "15509246-2-41",
      },
    });
    await service.issue("order_38", USER, NOW);
    assert.equal(
      calls.some((c) => c.startsWith("customersBy")),
      false,
    );
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

/**
 * THE CONFIRMATION WINDOW ON THE WEBSHOP INVOICE (card 7ba97e0d, S2; Balázs 2026-11-11 11:12-11:20). WHAT TURNS IT RED:
 * the summary is not the draft the issue makes; the confirmation does not reach the shared issuer; "Elküldöm e-mailben"
 * sends nowhere, somewhere else than the summary's address, before the issue, or without being asked; an order without
 * an address is issued anyway when sending was asked; an already issued invoice gets a new window.
 */
describe("WebshopOrderInvoiceService, the confirmation window (card 7ba97e0d)", () => {
  const CONFIRMED = {
    issueDate: "2026-10-05",
    fulfillmentDate: "2026-10-05",
    dueDate: "2026-10-13",
    fingerprint: "f".repeat(64),
  };

  it("the summary is the issue's own draft, saved, and the shared summary of it, with the draft's id", async () => {
    const { calls, service } = setup();
    const summary = await service.invoiceSummary("order_38", USER, NOW);
    assert.equal(summary.documentId, "webshop-order_38");
    assert.equal(summary.buyerEmail, "emese@example.hu");
    assert.deepEqual(calls, [
      "source",
      "customerByKey guest:emese@example.hu",
      "customersByEmail",
      "create customer Nagy Emese",
      "link cust_new guest:emese@example.hu",
      "create draft webshop-order_38 for cust_new from order_38",
      "summary webshop-order_38",
    ]);
  });

  it("an issued invoice has nothing to confirm", async () => {
    const { calls, service } = setup({
      invoice: { id: "webshop-order_38", status: "ISSUED", number: "E-1" },
    });
    await assert.rejects(service.invoiceSummary("order_38", USER, NOW), {
      status: 409,
    });
    assert.deepEqual(calls, []);
  });

  it("the confirmation reaches the shared issuer; unchecked, nothing is sent", async () => {
    const { calls, confirmations, service } = setup();
    await service.issue("order_38", USER, NOW, { ...CONFIRMED, send: false });
    assert.deepEqual(confirmations, [{ ...CONFIRMED, send: false }]);
    assert.equal(
      calls.some((call) => call.startsWith("send")),
      false,
    );
  });

  it('"Elküldöm e-mailben": after the issue, to the summary\'s address, with the Levelezés template', async () => {
    // the partner's billing address, not the order's e-mail: the window showed this one
    const { calls, sent, service } = setup({
      buyerEmail: "szamlazas@nagyemese.hu",
    });
    await service.issue("order_38", USER, NOW, { ...CONFIRMED, send: true });
    const issueAt = calls.indexOf(
      "issue webshop-order_38 2026-10-05T12:00:01.000Z",
    );
    const sendAt = calls.indexOf("send webshop-order_38");
    assert.ok(issueAt >= 0 && sendAt > issueAt, calls.join(" | "));
    assert.deepEqual(
      (sent[0] as { to: string[]; mode: string; subject: string }).to,
      ["szamlazas@nagyemese.hu"],
    );
    assert.equal((sent[0] as { mode: string }).mode, "SEND");
    assert.equal(
      (sent[0] as { subject: string }).subject,
      "Számla – {{document_number}}",
    );
  });

  it("sending asked with no address stops before the issue", async () => {
    const { calls, service } = setup({ buyerEmail: null });
    await assert.rejects(
      service.issue("order_38", USER, NOW, { ...CONFIRMED, send: true }),
      /nincs e-mail címe/,
    );
    assert.equal(
      calls.some((call) => call.startsWith("issue")),
      false,
    );
  });

  // barracuda on #2419: the invoice is issued before the letter; a failed send is reported, not thrown
  it("a failed send after the issue: the answer is the fresh order, the send's failure beside it", async () => {
    const { calls, service } = setup({ sendFails: true });
    const result = await service.issue("order_38", USER, NOW, {
      ...CONFIRMED,
      send: true,
    });
    assert.deepEqual(result.order, { id: "order_38" });
    assert.deepEqual(result.mail, {
      to: "emese@example.hu",
      sent: false,
      error: "A levelezés ezen a szerveren ki van kapcsolva.",
    });
    assert.ok(
      calls.includes("issue webshop-order_38 2026-10-05T12:00:01.000Z"),
    );
  });

  it("a sent invoice says so beside the order; unasked, the mail outcome is null", async () => {
    const sent = await setup().service.issue("order_38", USER, NOW, {
      ...CONFIRMED,
      send: true,
    });
    assert.deepEqual(sent.mail, { to: "emese@example.hu", sent: true });
    const quiet = await setup().service.issue("order_38", USER, NOW, {
      ...CONFIRMED,
      send: false,
    });
    assert.equal(quiet.mail, null);
  });
});
