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

/** What the confirmation window showed and the person confirmed (card 7ba97e0d follow-up): the first send needs it. */
const CONFIRMED = {
  issueDate: "2026-10-06",
  fulfillmentDate: "2026-10-06",
  dueDate: "2026-10-14",
  fingerprint: "f".repeat(64),
};

function setup(over: {
  provider?: string | null;
  email?: string | null;
  proforma?: Row;
  emailStatus?: string | null;
  issueEnds?: string;
  orderStatus?: string | null;
  /** A levél-kapu mondata, ha zárva van (`gateRefusal`). */
  mailClosed?: string;
  /** The order's `storefront_locale` metadata, as the shop wrote it (d5c6befd, P4). */
  locale?: unknown;
  /** A registered buyer's id: its key is not the e-mail, so an order without one still finds its customer. */
  customerId?: string;
}) {
  const calls: string[] = [];
  let proforma: Row | undefined = over.proforma;
  const drafts: Record<string, unknown>[] = [];
  const languages: unknown[] = [];
  const sentSubjects: string[] = [];
  const confirmations: unknown[] = [];
  const sendTos: unknown[] = [];
  const service = new WebshopOrderInvoiceService(
    {
      source: async () => ({
        order: {
          ...order(
            over.provider === undefined
              ? "pp_acropora_transfer"
              : over.provider,
            over.email === undefined ? "vevo@example.test" : over.email,
          ),
          customer_id: over.customerId ?? null,
          metadata:
            over.locale === undefined
              ? null
              : { storefront_locale: over.locale },
        },
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
      summary: async (id: string, _now: unknown, sendTo: unknown) => {
        calls.push(`summary ${id}`);
        sendTos.push(sendTo);
        return {
          buyerName: "Teszt Elek",
          // the shared summary's address is the sendTo it was given, else the buyer's
          buyerEmail: sendTo === undefined ? "szamlazasi@example.test" : sendTo,
          issueDate: "2026-10-06",
          fulfillmentDate: "2026-10-06",
          dueDate: "2026-10-14",
          fingerprint: "f".repeat(64),
        };
      },
      issue: async (
        id: string,
        _updatedAt: string,
        _user: unknown,
        confirmation: unknown,
        _now: unknown,
        sendTo: unknown,
      ) => {
        calls.push(`issue ${id}`);
        confirmations.push(confirmation);
        sendTos.push(sendTo);
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
        sentSubjects.push(input.subject);
        return {} as BillingDocumentDetail;
      },
    } as never,
    {
      templateDraft: async (language?: unknown) => (
        languages.push(language),
        {
          source: "default",
          subject: language === "en" ? "Document" : "Bizonylat",
          body: language === "en" ? "Dear {{nev}}" : "Kedves {{nev}}",
          bodyHtml: null,
          variables: [],
        }
      ),
    } as never,
  );
  return {
    service,
    calls,
    drafts,
    languages,
    sentSubjects,
    confirmations,
    sendTos,
  };
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
        await status(service.sendProforma("order_55", USER, NOW, CONFIRMED)),
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
        await status(service.sendProforma("order_55", USER, NOW, CONFIRMED)),
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
    await service.sendProforma("order_55", USER, NOW, CONFIRMED);
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
    await service.sendProforma("order_55", USER, NOW, CONFIRMED);
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
        await status(service.sendProforma("order_55", USER, NOW, CONFIRMED)),
        409,
      );
      assert.ok(!calls.some((c) => /^(create|update|issue|send)/.test(c)));
    }
  });

  it("the first send issues what the window confirmed; without the window nothing is issued", async () => {
    const confirmed = setup({});
    await confirmed.service.sendProforma("order_55", USER, NOW, CONFIRMED);
    assert.deepEqual(confirmed.confirmations, [CONFIRMED]);
    // the issue re-checks the digest with the address the window named: the order's (barracuda on #2429)
    assert.deepEqual(confirmed.sendTos, ["vevo@example.test"]);

    const blind = setup({});
    assert.equal(
      await status(blind.service.sendProforma("order_55", USER, NOW)),
      400,
    );
    assert.ok(!blind.calls.some((c) => /^(issue|send)/.test(c)));
  });

  it("an order without e-mail is refused BEFORE anything is made, not after the issue", async () => {
    // a registered buyer: a guest order without e-mail has no customer key and stops even earlier
    const { service, calls } = setup({ email: null, customerId: "cus_1" });
    assert.equal(
      await status(service.sendProforma("order_55", USER, NOW, CONFIRMED)),
      409,
    );
    assert.ok(!calls.some((c) => /^(create|update|issue|send)/.test(c)));
  });

  it("an issue that did not finish sends nothing; an order without e-mail is refused", async () => {
    const unfinished = setup({ issueEnds: "ISSUING" });
    assert.equal(
      await status(
        unfinished.service.sendProforma("order_55", USER, NOW, CONFIRMED),
      ),
      409,
    );
    assert.ok(!unfinished.calls.some((c) => c.startsWith("send")));

    const noEmail = setup({
      email: null,
      proforma: { id: "doc_1", status: "ISSUED", number: "D-1" },
    });
    assert.equal(
      await status(
        noEmail.service.sendProforma("order_55", USER, NOW, CONFIRMED),
      ),
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
describe("the language of the proforma's mail (d5c6befd, P4)", () => {
  /*
    WHAT TURNS THIS RED. An order from the English storefront getting the Hungarian text; a Hungarian, an old (no
    metadata) or an unrecognised-language order getting English; the mail's language leaking into the document (the
    PDF stays Hungarian); the resend of an issued proforma ignoring the language.
  */
  it("an order the shop marked English gets the English letter, anything else the Hungarian one", async () => {
    for (const [locale, language, subject] of [
      ["en", "en", "Document"],
      ["hu", "hu", "Bizonylat"],
      [undefined, "hu", "Bizonylat"],
      ["EN", "hu", "Bizonylat"],
      ["de", "hu", "Bizonylat"],
      [null, "hu", "Bizonylat"],
    ] as const) {
      const { service, languages, sentSubjects } = setup({ locale });
      await service.sendProforma("order_55", USER, NOW, CONFIRMED);
      assert.deepEqual(languages, [language], String(locale));
      assert.deepEqual(sentSubjects, [subject], String(locale));
    }
  });

  it("the resend of an issued proforma follows the language too, and the document is the same", async () => {
    const { service, calls, drafts, sentSubjects } = setup({
      locale: "en",
      proforma: { id: "doc_1", status: "ISSUED", number: "D-1" },
      emailStatus: "SENT",
    });
    await service.sendProforma("order_55", USER, NOW, CONFIRMED);
    assert.deepEqual(sentSubjects, ["Document"]);
    assert.deepEqual(
      calls.filter((c) => !c.startsWith("invoices")),
      ["send doc_1 RESEND to vevo@example.test"],
    );
    assert.equal(drafts.length, 0);
  });

  it("the document itself is built the same for an English order (the PDF language is not touched here)", async () => {
    const en = setup({ locale: "en" });
    const hu = setup({});
    await en.service.sendProforma("order_55", USER, NOW, CONFIRMED);
    await hu.service.sendProforma("order_55", USER, NOW, CONFIRMED);
    assert.deepEqual(en.drafts, hu.drafts);
  });
});

describe("a closed mail gate", () => {
  it("issues nothing and says why", async () => {
    const closed =
      "A számlázási bizonylatok kiküldése ebben a környezetben ki van kapcsolva (TICKET_MAIL_BILLING_DOCUMENT).";
    const { service, calls } = setup({ mailClosed: closed });
    await assert.rejects(
      service.sendProforma("order_55", USER, NOW, CONFIRMED),
      {
        status: 503,
        message: closed,
      },
    );
    assert.ok(!calls.some((c) => /^(create|update|issue|send)/.test(c)));
  });

  it("an existing proforma is not resent either", async () => {
    const { service, calls } = setup({
      mailClosed: "zárva",
      proforma: { id: "doc_1", status: "ISSUED", number: "D-1" },
      emailStatus: "SENT",
    });
    assert.equal(
      await status(service.sendProforma("order_55", USER, NOW, CONFIRMED)),
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

/*
  THE PROFORMA'S CONFIRMATION WINDOW (card 7ba97e0d follow-up). WHAT TURNS IT RED: the window names another address than
  the one the proforma goes to (the order's e-mail, not the billing one); an issued proforma opens a window for a resend.
*/
describe("the proforma's confirmation window", () => {
  it("is the saved draft's summary, with the order's e-mail as the send address and the draft's id", async () => {
    const { service, calls, sendTos } = setup({});
    const summary = await service.proformaSummary("order_55", USER, NOW);
    assert.equal(summary.buyerEmail, "vevo@example.test");
    // the summary is built with it, so its digest covers the order's e-mail, not the billing one
    assert.deepEqual(sendTos, ["vevo@example.test"]);
    assert.equal(summary.documentId, "doc_1");
    assert.equal(summary.fingerprint, "f".repeat(64));
    assert.deepEqual(
      calls.filter((c) => !c.startsWith("invoices")),
      ["create webshop-proforma-order_55", "summary doc_1"],
    );
  });

  it("an issued proforma has nothing to confirm: its button resends", async () => {
    const { service } = setup({
      proforma: { id: "doc_1", status: "ISSUED", number: "D-1" },
    });
    assert.equal(
      await status(service.proformaSummary("order_55", USER, NOW)),
      409,
    );
  });
});
