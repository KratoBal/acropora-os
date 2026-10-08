import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSzamlazzAgentInvoiceXml } from "../integrations/szamlazz/szamlazz-agent-xml.js";
import {
  BillingDocumentAdapterError,
  toSzamlazzAgentInput,
  type BillingDocumentForIssue,
  type BillingDocumentLineForIssue,
} from "./billing-document-szamlazz.adapter.js";

const item: BillingDocumentLineForIssue = {
  position: 0,
  kind: "ITEM",
  parentPosition: null,
  description: "Tápoldat 500 ml",
  code: "TAP-500",
  quantity: 2,
  unit: "db",
  unitNet: 1000,
  vatRate: "27",
  netAmount: 2000,
  vatAmount: 540,
  grossAmount: 2540,
  comment: "A 2. doboz sérült csomagolású",
};

const discount: BillingDocumentLineForIssue = {
  position: 1,
  kind: "DISCOUNT",
  parentPosition: 0,
  description: "Kedvezmény (10%)",
  code: null,
  quantity: 1,
  unit: "db",
  unitNet: -200,
  vatRate: "27",
  netAmount: -200,
  vatAmount: -54,
  grossAmount: -254,
  comment: null,
};

const base: BillingDocumentForIssue = {
  id: "cm-billing-1",
  documentType: "INVOICE",
  invoiceFormat: "ELECTRONIC",
  fulfillmentDate: "2026-09-30",
  dueDate: "2026-10-08",
  paymentMethod: "Átutalás",
  currency: "HUF",
  language: null,
  note: "Projekt: PROJ-0268",
  reference: "PROJ-0268",
  proformaNumber: null,
  buyer: {
    name: "Kitalált Kft.",
    country: null,
    zip: "1011",
    city: "Budapest",
    address: "Fő utca 1.",
    email: "vevo@example.com",
    taxNumber: "12345678-1-42",
    euTaxNumber: null,
  },
  lines: [item, discount],
};

const xmlOf = (document: Partial<BillingDocumentForIssue>) =>
  buildSzamlazzAgentInvoiceXml(
    toSzamlazzAgentInput(
      { ...base, ...document },
      { agentKey: "test-key", previewOnly: false },
    ),
  );

/** The direct children of one element, in order. */
function children(xml: string, parent: string): string[] {
  const body = xml.slice(
    xml.indexOf(`<${parent}>`) + parent.length + 2,
    xml.indexOf(`</${parent}>`),
  );
  const names: string[] = [];
  const pattern = /<([A-Za-z]+)>[^<]*<\/\1>/g;
  for (let match = pattern.exec(body); match; match = pattern.exec(body))
    names.push(match[1]!);
  return names;
}

// the two sequences as the XSD writes them (02-xmlszamla.xsd, 52-63 and
// 103-129): the Agent rejects a reordered XML
const BEALLITASOK_ORDER = [
  "szamlaagentkulcs",
  "eszamla",
  "szamlaLetoltes",
  "szamlaLetoltesPld",
  "valaszVerzio",
  "aggregator",
  "guardian",
  "cikkazoninvoice",
  "szamlaKulsoAzon",
];
const FEJLEC_ORDER = [
  "keltDatum",
  "teljesitesDatum",
  "fizetesiHataridoDatum",
  "fizmod",
  "penznem",
  "szamlaNyelve",
  "megjegyzes",
  "arfolyamBank",
  "arfolyam",
  "rendelesSzam",
  "dijbekeroSzamlaszam",
  "elolegszamla",
  "vegszamla",
  "elolegSzamlaszam",
  "helyesbitoszamla",
  "helyesbitettSzamlaszam",
  "dijbekero",
  "szallitolevel",
  "logoExtra",
  "szamlaszamElotag",
  "fizetendoKorrekcio",
  "fizetve",
  "arresAfa",
  "eusAfa",
  "szamlaSablon",
  "elonezetpdf",
];

function assertXsdOrder(found: string[], order: string[], where: string) {
  const indices = found.map((name) => order.indexOf(name));
  assert.ok(!indices.includes(-1), `${where}: unknown element in ${found}`);
  assert.deepEqual(
    indices,
    [...indices].sort((a, b) => a - b),
    `${where} out of XSD order: ${found.join(", ")}`,
  );
}

describe("toSzamlazzAgentInput", () => {
  it("maps each document type to its one header flag, in XSD order", () => {
    const flags = ["dijbekero", "elolegszamla", "szallitolevel"];
    const cases = [
      ["INVOICE", "ELECTRONIC", []],
      ["PROFORMA", null, ["dijbekero"]],
      ["ADVANCE_INVOICE", "PAPER", ["elolegszamla"]],
      ["DELIVERY_NOTE", null, ["szallitolevel"]],
    ] as const;
    for (const [documentType, invoiceFormat, expected] of cases) {
      const xml = xmlOf({ documentType, invoiceFormat });
      const header = children(xml, "fejlec");
      assert.deepEqual(
        header.filter((name) => flags.includes(name)),
        [...expected],
        documentType,
      );
      for (const flag of expected)
        assert.match(xml, new RegExp(`<${flag}>true</${flag}>`), documentType);
      assertXsdOrder(header, FEJLEC_ORDER, `${documentType} fejlec`);
      assertXsdOrder(
        children(xml, "beallitasok"),
        BEALLITASOK_ORDER,
        `${documentType} beallitasok`,
      );
    }
  });

  it("sends eszamla true only for an electronic document, false elsewhere", () => {
    const eszamla = (xml: string) => /<eszamla>(\w+)<\/eszamla>/.exec(xml)![1];
    assert.equal(eszamla(xmlOf({})), "true");
    assert.equal(eszamla(xmlOf({ invoiceFormat: "PAPER" })), "false");
    assert.equal(
      eszamla(xmlOf({ documentType: "PROFORMA", invoiceFormat: null })),
      "false",
    );
    assert.equal(
      eszamla(xmlOf({ documentType: "DELIVERY_NOTE", invoiceFormat: null })),
      "false",
    );
  });

  it("refuses a format on a type without one, and a missing one where it is needed", () => {
    const code = (document: Partial<BillingDocumentForIssue>) => {
      try {
        xmlOf(document);
        return "OK";
      } catch (error) {
        assert.ok(error instanceof BillingDocumentAdapterError);
        return error.code;
      }
    };
    assert.equal(
      code({ documentType: "PROFORMA", invoiceFormat: "ELECTRONIC" }),
      "BILLING_FORMAT_NOT_SUPPORTED",
    );
    assert.equal(
      code({ documentType: "DELIVERY_NOTE", invoiceFormat: "PAPER" }),
      "BILLING_FORMAT_NOT_SUPPORTED",
    );
    assert.equal(code({ invoiceFormat: null }), "BILLING_FORMAT_REQUIRED");
    assert.equal(code({ lines: [] }), "BILLING_NO_LINES");
    assert.equal(code({ language: "xx" }), "BILLING_LANGUAGE_NOT_SUPPORTED");
    assert.equal(code({ dueDate: null }), "BILLING_PAYMENT_TERMS_REQUIRED");
  });

  it("fills a delivery note's payment fields itself, since the form does not ask", () => {
    const input = toSzamlazzAgentInput(
      {
        ...base,
        documentType: "DELIVERY_NOTE",
        invoiceFormat: null,
        dueDate: null,
        paymentMethod: null,
      },
      { agentKey: "k", previewOnly: false },
    );
    assert.deepEqual(
      [input.paymentDueDate, input.paymentMethod],
      ["2026-09-30", "Átutalás"],
    );
  });

  it("keeps the document comment and every line comment, and the discount right under its item", () => {
    const xml = xmlOf({
      lines: [
        discount,
        { ...item, position: 2, description: "Második", comment: null },
        item,
      ],
    });
    assert.match(
      children(xml, "fejlec").join(","),
      /megjegyzes/,
      "document comment",
    );
    assert.match(
      xml,
      /<megjegyzes>A 2\. doboz sérült csomagolású<\/megjegyzes>/,
    );
    const names = [...xml.matchAll(/<tetel><megnevezes>([^<]+)</g)].map(
      (match) => match[1],
    );
    assert.deepEqual(names, ["Tápoldat 500 ml", "Kedvezmény (10%)", "Második"]);
  });

  it("refuses a discount line with no item above it", () => {
    assert.throws(
      () => xmlOf({ lines: [{ ...discount, parentPosition: 7 }] }),
      (error: unknown) =>
        error instanceof BillingDocumentAdapterError &&
        error.code === "BILLING_DISCOUNT_WITHOUT_ITEM",
    );
  });

  it("sends our id as szamlaKulsoAzon, the proforma's number, and never asks Számlázz.hu to e-mail", () => {
    const xml = xmlOf({ proformaNumber: "D-43" });
    assert.match(xml, /<szamlaKulsoAzon>cm-billing-1<\/szamlaKulsoAzon>/);
    assert.match(xml, /<dijbekeroSzamlaszam>D-43<\/dijbekeroSzamlaszam>/);
    assert.match(xml, /<sendEmail>false<\/sendEmail>/);
    assert.doesNotMatch(xml, /<sendEmail>true/);
  });
});
