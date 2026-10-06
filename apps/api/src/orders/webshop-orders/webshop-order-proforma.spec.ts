import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  AuthenticatedUser,
  BillingDocumentDetail,
  WebshopOrderDetail,
} from "@acropora/types";

import type { MedusaOrderDetailRow } from "../../integrations/medusa/medusa-admin.client.js";
import { WebshopOrderInvoiceService } from "./webshop-order-invoice.service.js";
import { proformaDraftOf, proformaOf } from "./webshop-order-invoice.rules.js";

/*
  A DÍJBEKÉRŐ (kártya bb3a6bd5; Balázs, 2026-10-06: „Leadja a rendelest es
  mi kuldjuk neki gombbal a dijbekerot”, határidő 8 nap; lejárat után semmi
  automatikus, újraküldhető). MI PIROSÍT:
  - nem előre utalásos rendelésnek is kimegy;
  - nem PROFORMA, nem 8 napos, vagy nem átutalás a vázlat;
  - a kiállított díjbekérő második kattintásra újra kiállítódik (újraküldés
    helyett), vagy a kiállítás alatti/elutasított mellé új készül;
  - a kiküldés nem a vevő címére megy, vagy befejezetlen kiállítás után is
    megy;
  - a lejárat a határidő napján már igaz, vagy a ki nem állítotton is.
*/
const USER = { id: "user_1" } as AuthenticatedUser;
// 2026-10-05 14:00 Budapest
const NOW = new Date("2026-10-05T12:00:00.000Z");

const order = (
  provider: string | null,
  email: string | null = "vevo@example.test",
): MedusaOrderDetailRow =>
  ({
    id: "order_55",
    display_id: 55,
    created_at: "2026-10-05T11:21:00.000Z",
    email,
    currency_code: "huf",
    customer_id: null,
    metadata: null,
    total: 4800,
    subtotal: 4800,
    discount_total: 0,
    shipping_total: 0,
    shipping_address: null,
    billing_address: {
      first_name: "Elek",
      last_name: "Teszt",
      address_1: "Teszt utca 1.",
      city: "Budapest",
      postal_code: "1111",
      country_code: "hu",
    },
    items: [
      {
        id: "i1",
        title: "Nyos Reef Putty",
        product_title: "Nyos Reef Putty",
        variant_title: null,
        variant_sku: "NRP",
        quantity: 1,
        unit_price: 4800,
        total: 4800,
        metadata: null,
        tax_lines: [{ rate: 27 }],
      },
    ],
    shipping_methods: [],
    payment_collections: provider
      ? [
          {
            status: "not_paid",
            amount: 4800,
            authorized_amount: 0,
            captured_amount: 0,
            refunded_amount: 0,
            payments: [],
            payment_sessions: [
              { provider_id: provider, status: "pending_authorization" },
            ],
          },
        ]
      : [],
  }) as MedusaOrderDetailRow;

type Row = { id: string; status: string; number: string | null };

function setup(over: {
  provider?: string | null;
  email?: string | null;
  proforma?: Row;
  emailStatus?: string | null;
  issueEnds?: string;
  orderStatus?: string | null;
  /** A levél-kapu mondata, ha zárva van (`gateRefusal`). */
  mailClosed?: string;
}) {
  const calls: string[] = [];
  let proforma: Row | undefined = over.proforma;
  const drafts: Record<string, unknown>[] = [];
  const service = new WebshopOrderInvoiceService(
    {
      source: async () => ({
        order: order(
          over.provider === undefined ? "pp_acropora_transfer" : over.provider,
          over.email === undefined ? "vevo@example.test" : over.email,
        ),
        status:
          over.orderStatus === null
            ? null
            : { status: over.orderStatus ?? "pending_processing" },
      }),
      detail: async (id: string) => ({ id }) as WebshopOrderDetail,
    } as never,
    {
      invoices: async (ids: string[], type?: string) => {
        calls.push(`invoices ${type ?? "INVOICE"}`);
        return new Map(
          type === "PROFORMA" && proforma ? [[ids[0]!, proforma]] : [],
        );
      },
      customerByKey: async () => "cust_1",
      customerBuyer: async () => ({
        name: "Teszt Elek",
        taxNumber: null,
        postalCode: "1111",
        city: "Budapest",
        line: "Teszt utca 1.",
      }),
    } as never,
    {} as never,
    {
      create: async (input: Record<string, unknown>) => {
        drafts.push(input);
        calls.push(`create ${input.id as string}`);
        return {
          id: "doc_1",
          updatedAt: "u1",
        } as BillingDocumentDetail;
      },
      update: async (id: string) => {
        calls.push(`update ${id}`);
        return { id, updatedAt: "u2" } as BillingDocumentDetail;
      },
      detail: async (id: string) =>
        ({
          id,
          updatedAt: "u1",
          emailStatus: over.emailStatus ?? null,
        }) as BillingDocumentDetail,
    } as never,
    {
      issueMode: () => "stub",
      issue: async (id: string) => {
        calls.push(`issue ${id}`);
        proforma = {
          id,
          status: over.issueEnds ?? "ISSUED",
          number: "D-1",
        };
      },
    } as never,
    {
      gateRefusal: () => over.mailClosed ?? null,
      send: async (
        id: string,
        input: { mode: string; to: string[]; subject: string },
      ) => {
        calls.push(`send ${id} ${input.mode} to ${input.to.join(",")}`);
        return {} as BillingDocumentDetail;
      },
    } as never,
    {
      templateDraft: async () => ({
        source: "default",
        subject: "Bizonylat",
        body: "Kedves {{nev}}",
        bodyHtml: null,
        variables: [],
      }),
    } as never,
  );
  return { service, calls, drafts };
}

const status = async (p: Promise<unknown>) => {
  try {
    await p;
    return 200;
  } catch (error) {
    return (error as { getStatus?: () => number }).getStatus?.() ?? 500;
  }
};

describe("sending the proforma from the order page", () => {
  it("only for a prepayment by bank transfer: cash on delivery or no payment is refused, nothing is made", async () => {
    for (const provider of ["pp_acropora_cod", "pp_stripe_stripe", null]) {
      const { service, calls } = setup({ provider });
      assert.equal(
        await status(service.sendProforma("order_55", USER, NOW)),
        409,
      );
      assert.ok(
        !calls.some((c) => c.startsWith("create") || c.startsWith("send")),
      );
    }
  });

  it("before confirmation it goes; a failed order or one without status gets none", async () => {
    for (const [orderStatus, expected] of [
      ["pending_processing", 200],
      ["closed_unsuccessfully", 409],
      [null, 409],
    ] as const) {
      const { service, calls } = setup({ orderStatus });
      assert.equal(
        await status(service.sendProforma("order_55", USER, NOW)),
        expected,
        String(orderStatus),
      );
      assert.equal(
        calls.some((c) => c.startsWith("send")),
        expected === 200,
      );
    }
  });

  it("the first press issues it and sends it to the buyer's address", async () => {
    const { service, calls, drafts } = setup({});
    await service.sendProforma("order_55", USER, NOW);
    assert.deepEqual(
      calls.filter((c) => !c.startsWith("invoices")),
      [
        "create webshop-proforma-order_55",
        "issue doc_1",
        "send doc_1 SEND to vevo@example.test",
      ],
    );
    assert.equal(drafts[0]!.documentType, "PROFORMA");
  });

  it("once issued and sent, the button resends it and issues nothing", async () => {
    const { service, calls } = setup({
      proforma: { id: "doc_1", status: "ISSUED", number: "D-1" },
      emailStatus: "SENT",
    });
    await service.sendProforma("order_55", USER, NOW);
    assert.deepEqual(
      calls.filter((c) => !c.startsWith("invoices")),
      ["send doc_1 RESEND to vevo@example.test"],
    );
  });

  it("a proforma being issued or refused is not replaced by a new one", async () => {
    for (const s of ["ISSUING", "ISSUE_FAILED"]) {
      const { service, calls } = setup({
        proforma: { id: "doc_1", status: s, number: null },
      });
      assert.equal(
        await status(service.sendProforma("order_55", USER, NOW)),
        409,
      );
      assert.ok(!calls.some((c) => /^(create|update|issue|send)/.test(c)));
    }
  });

  it("an issue that did not finish sends nothing; an order without e-mail is refused", async () => {
    const unfinished = setup({ issueEnds: "ISSUING" });
    assert.equal(
      await status(unfinished.service.sendProforma("order_55", USER, NOW)),
      409,
    );
    assert.ok(!unfinished.calls.some((c) => c.startsWith("send")));

    const noEmail = setup({
      email: null,
      proforma: { id: "doc_1", status: "ISSUED", number: "D-1" },
    });
    assert.equal(
      await status(noEmail.service.sendProforma("order_55", USER, NOW)),
      409,
    );
    assert.ok(!noEmail.calls.some((c) => c.startsWith("send")));
  });
});

/*
  A LEVÉL-KAPU A KIÁLLÍTÁS ELŐTT (stage-próba, 2026-10-07: zárt kapunál 503
  jött, a díjbekérő mégis elkészült). MI PIROSÍT: zárt kapunál kiállít vagy
  vázlatot ment; nem a kapu mondata jön; nyitott kapunál megáll.
*/
describe("a closed mail gate", () => {
  it("issues nothing and says why", async () => {
    const closed =
      "A számlázási bizonylatok kiküldése ebben a környezetben ki van kapcsolva (TICKET_MAIL_BILLING_DOCUMENT).";
    const { service, calls } = setup({ mailClosed: closed });
    await assert.rejects(service.sendProforma("order_55", USER, NOW), {
      status: 503,
      message: closed,
    });
    assert.ok(!calls.some((c) => /^(create|update|issue|send)/.test(c)));
  });

  it("an existing proforma is not resent either", async () => {
    const { service, calls } = setup({
      mailClosed: "zárva",
      proforma: { id: "doc_1", status: "ISSUED", number: "D-1" },
      emailStatus: "SENT",
    });
    assert.equal(
      await status(service.sendProforma("order_55", USER, NOW)),
      503,
    );
    assert.ok(!calls.some((c) => c.startsWith("send")));
  });
});

describe("the proforma's draft and its place on the page", () => {
  it("a PROFORMA by transfer, due 8 days later by the Budapest day", () => {
    const result = proformaDraftOf(order("pp_acropora_transfer"), {
      customerId: "cust_1",
      now: new Date("2026-10-05T22:30:00.000Z"), // 2026-10-06 00:30 Budapest
    });
    assert.ok(result.ok);
    assert.equal(result.draft.id, "webshop-proforma-order_55");
    assert.equal(result.draft.documentType, "PROFORMA");
    assert.equal(result.draft.invoiceFormat, null);
    assert.equal(result.draft.paymentMethod, "Átutalás");
    assert.equal(result.draft.dueDate, "2026-10-14");
  });

  it("expired only after its due day, and only when issued", () => {
    const row = (dueDate: string, s = "ISSUED") => ({
      id: "doc_1",
      status: s as "ISSUED",
      number: "D-1",
      dueDate: new Date(`${dueDate}T10:00:00.000Z`),
      emailStatus: "SENT",
    });
    assert.equal(proformaOf(row("2026-10-04"), NOW).expired, true);
    assert.equal(proformaOf(row("2026-10-05"), NOW).expired, false);
    assert.equal(proformaOf(row("2026-10-04", "ISSUING"), NOW).expired, false);
    assert.equal(proformaOf(row("2026-10-13"), NOW).dueDate, "2026-10-13");
  });
});
