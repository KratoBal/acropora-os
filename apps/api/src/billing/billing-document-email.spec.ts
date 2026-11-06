import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  billingEmailRecipients,
  billingEmailValues,
  renderBillingEmail,
  renderBillingEmailHtml,
} from "./billing-document-email.js";
import {
  DEFAULT_BILLING_DOCUMENT_MANUAL_TEMPLATE,
  DEFAULT_BILLING_DOCUMENT_WEBSHOP_ORDER_TEMPLATE,
} from "../notifications/mail/billing-document-mail.content.js";
import type { BillingDocumentRow } from "./billing-documents.repository.js";

const NBSP = "\u00a0";

function row(overrides: Record<string, unknown> = {}): BillingDocumentRow {
  return {
    id: "doc-1",
    documentType: "INVOICE",
    invoiceNumber: "E-ACR-2026-7",
    currency: "HUF",
    grossAmount: new Prisma.Decimal("12985"),
    dueDate: new Date("2026-10-08T00:00:00.000Z"),
    externalUrl: "https://www.szamlazz.hu/szamla/?page=vevoifiok&azon=abc",
    reference: "R-1001",
    ...overrides,
  } as unknown as BillingDocumentRow;
}

describe("billingEmailValues", () => {
  it("fills every variable of an issued invoice", () => {
    assert.deepEqual(billingEmailValues(row(), "Partner Kft."), {
      customer_name: "Partner Kft.",
      document_number: "E-ACR-2026-7",
      invoice_number: "E-ACR-2026-7",
      gross_total: `12${NBSP}985${NBSP}Ft`,
      due_date: "2026. 10. 08.",
      document_link: "https://www.szamlazz.hu/szamla/?page=vevoifiok&azon=abc",
      order_number: "R-1001",
    });
  });

  it("gives a proforma no invoice number, and a missing reference no order number", () => {
    const values = billingEmailValues(
      row({ documentType: "PROFORMA", reference: "  " }),
      "Partner Kft.",
    );
    assert.equal(values.invoice_number, null);
    assert.equal(values.order_number, null);
  });

  it("gives a final invoice its invoice number, like any invoice", () => {
    assert.equal(
      billingEmailValues(row({ documentType: "FINAL_INVOICE" }), "Partner Kft.")
        .invoice_number,
      row().invoiceNumber,
    );
  });

  it("keeps two decimals outside HUF", () => {
    const values = billingEmailValues(
      row({ currency: "EUR", grossAmount: new Prisma.Decimal("12.5") }),
      "Partner Kft.",
    );
    assert.equal(values.gross_total, `12,50${NBSP}EUR`);
  });
});

describe("billingEmailValues in English (d5c6befd)", () => {
  it("writes the amount and the date the English way, and leaves everything else as it is", () => {
    const en = billingEmailValues(row(), "Partner Kft.", "en");
    assert.equal(en.gross_total, "HUF\u00a012,985");
    assert.equal(en.due_date, "8 October 2026");
    const hu = billingEmailValues(row(), "Partner Kft.");
    for (const key of [
      "customer_name",
      "document_number",
      "invoice_number",
      "document_link",
      "order_number",
    ] as const)
      assert.equal(en[key], hu[key], key);
  });

  it("keeps two decimals outside HUF in English too, and an absent date stays absent", () => {
    const en = billingEmailValues(
      row({
        currency: "EUR",
        grossAmount: new Prisma.Decimal("12.5"),
        dueDate: null,
      }),
      "Partner Kft.",
      "en",
    );
    assert.equal(en.gross_total, "€12.50");
    assert.equal(en.due_date, null);
  });

  it("the Hungarian values are the same with the language given or left out", () => {
    assert.deepEqual(
      billingEmailValues(row(), "Partner Kft.", "hu"),
      billingEmailValues(row(), "Partner Kft."),
    );
  });
});

describe("renderBillingEmail", () => {
  const values = billingEmailValues(row(), "Partner Kft.");

  it("substitutes the single-brace variables, and leaves other braces alone", () => {
    assert.deepEqual(
      renderBillingEmail(
        "Kedves {customer_name}! A(z) {document_number} itt: {document_link} {nem valtozo}",
        values,
      ),
      {
        ok: true,
        text: "Kedves Partner Kft.! A(z) E-ACR-2026-7 itt: https://www.szamlazz.hu/szamla/?page=vevoifiok&azon=abc {nem valtozo}",
      },
    );
  });

  it("names an unknown variable and a required one without a value, and gives no text", () => {
    const proforma = billingEmailValues(
      row({ documentType: "PROFORMA" }),
      "Partner Kft.",
    );
    assert.deepEqual(
      renderBillingEmail("{invoice_number} {szamlaszam}", proforma),
      { ok: false, unknown: ["szamlaszam"], missing: ["invoice_number"] },
    );
  });

  it("resolves a missing document link to nothing, without stopping the send", () => {
    const noLink = billingEmailValues(
      row({ externalUrl: null }),
      "Partner Kft.",
    );
    assert.deepEqual(renderBillingEmail("Online: {document_link}.", noLink), {
      ok: true,
      text: "Online: .",
    });
  });
});

describe("renderBillingEmail, a Levelezés sablonjainak alakjával", () => {
  const values = billingEmailValues(row(), "Partner Kft.");

  it("resolves the canonical {{name}} form, spaces inside allowed, and the old {name} too", () => {
    assert.deepEqual(
      renderBillingEmail(
        "{{customer_name}} / {{ document_number }} / {document_number}",
        values,
      ),
      { ok: true, text: "Partner Kft. / E-ACR-2026-7 / E-ACR-2026-7" },
    );
  });

  it("names an unknown variable in the double form too, and leaves no braces behind", () => {
    assert.deepEqual(renderBillingEmail("{{szamlaszam}}", values), {
      ok: false,
      unknown: ["szamlaszam"],
      missing: [],
    });
  });

  it("renders both default templates completely for an issued invoice", () => {
    for (const template of [
      DEFAULT_BILLING_DOCUMENT_MANUAL_TEMPLATE,
      DEFAULT_BILLING_DOCUMENT_WEBSHOP_ORDER_TEMPLATE,
    ])
      for (const text of [template.subject, template.body]) {
        const result = renderBillingEmail(text, values);
        assert.equal(result.ok, true, text);
        assert.doesNotMatch(result.ok ? result.text : "", /[{}]/, text);
      }
  });
});

describe("renderBillingEmailHtml", () => {
  it("escapes the values, and keeps the template's own tags", () => {
    const values = billingEmailValues(row(), "Kis & Nagy <Kft.>");
    assert.deepEqual(
      renderBillingEmailHtml(
        "<p>Kedves <strong>{{customer_name}}</strong>!</p>",
        values,
      ),
      {
        ok: true,
        text: "<p>Kedves <strong>Kis &amp; Nagy &lt;Kft.&gt;</strong>!</p>",
      },
    );
  });
});

describe("billingEmailRecipients", () => {
  it("trims, drops empty entries, and keeps the three lists apart", () => {
    assert.deepEqual(
      billingEmailRecipients({
        to: [" a@partner.hu ", ""],
        cc: ["b@partner.hu"],
        bcc: [],
      }),
      { ok: true, to: ["a@partner.hu"], cc: ["b@partner.hu"], bcc: [] },
    );
  });

  it("stops on a bad address anywhere, and on no addressee", () => {
    assert.deepEqual(
      billingEmailRecipients({
        to: ["a@partner.hu"],
        cc: ["b@partner.hu, c@partner.hu"],
        bcc: ["nem-cim"],
      }),
      { ok: false, invalid: ["b@partner.hu, c@partner.hu", "nem-cim"] },
    );
    assert.deepEqual(
      billingEmailRecipients({ to: [" "], cc: ["b@partner.hu"], bcc: [] }),
      { ok: false, invalid: [] },
    );
  });
});
