import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildSzamlazzAgentInvoiceXml } from "../integrations/szamlazz/szamlazz-agent-xml.js";
import {
  adapterErrorSentence,
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
  advanceNumber: null,
  buyer: {
    name: "Kitalált Kft.",
    country: null,
    zip: "1011",
    city: "Budapest",
    address: "Fő utca 1.",
    email: "vevo@example.com",
    taxNumber: "12345678-1-42",
    euTaxNumber: null,
    vatSubject: null,
    taxSubject: { type: "COMPANY", partnerMirror: false },
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
    const flags = ["dijbekero", "elolegszamla", "szallitolevel", "vegszamla"];
    const cases = [
      ["INVOICE", "ELECTRONIC", []],
      ["PROFORMA", null, ["dijbekero"]],
      ["ADVANCE_INVOICE", "PAPER", ["elolegszamla"]],
      ["DELIVERY_NOTE", null, ["szallitolevel"]],
      ["FINAL_INVOICE", "ELECTRONIC", ["vegszamla"]],
    ] as const;
    for (const [documentType, invoiceFormat, expected] of cases) {
      const xml = xmlOf({
        documentType,
        invoiceFormat,
        // a végszámla előleg-szám nélkül nem küldhető (külön teszt alább)
        advanceNumber: documentType === "FINAL_INVOICE" ? "E-ELO-1" : null,
      });
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

  it("a final invoice: vegszamla, then the advance's number, and the full items with no deduction line", () => {
    const xml = xmlOf({
      documentType: "FINAL_INVOICE",
      advanceNumber: "E-ELO-1",
      lines: [item],
    });
    const header = children(xml, "fejlec");
    assert.deepEqual(
      header.slice(
        header.indexOf("vegszamla"),
        header.indexOf("vegszamla") + 2,
      ),
      ["vegszamla", "elolegSzamlaszam"],
    );
    assert.match(xml, /<vegszamla>true<\/vegszamla>/);
    assert.match(xml, /<elolegSzamlaszam>E-ELO-1<\/elolegSzamlaszam>/);
    assertXsdOrder(header, FEJLEC_ORDER, "FINAL_INVOICE fejlec");
    // the deduction is Számlázz.hu's: we send the items as they are, one
    // <tetel> each, none of them negative (brief, 3.: no negative advance line)
    const amounts = [...xml.matchAll(/<bruttoErtek>([^<]+)</g)].map((match) =>
      Number(match[1]),
    );
    assert.deepEqual(amounts, [item.grossAmount]);
  });

  it("refuses a final invoice with no advance number, and sends the number on no other type", () => {
    assert.throws(
      () => xmlOf({ documentType: "FINAL_INVOICE", advanceNumber: null }),
      (error: unknown) =>
        error instanceof BillingDocumentAdapterError &&
        error.code === "BILLING_FINAL_WITHOUT_ADVANCE",
    );
    for (const documentType of ["INVOICE", "ADVANCE_INVOICE"] as const) {
      const xml = xmlOf({ documentType, advanceNumber: "E-ELO-1" });
      assert.doesNotMatch(xml, /elolegSzamlaszam|vegszamla/, documentType);
    }
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

  it("an EU buyer's country, adoalany and community tax number reach the vevo element, in its order", () => {
    const eu = children(
      xmlOf({
        buyer: {
          ...base.buyer,
          country: "Szlovákia",
          taxNumber: null,
          euTaxNumber: "SK2020123456",
          vatSubject: 6,
        },
      }),
      "vevo",
    );
    const hu = children(xmlOf({}), "vevo");
    assert.deepEqual(
      [
        eu.filter((tag) =>
          ["orszag", "sendEmail", "adoalany", "adoszam", "adoszamEU"].includes(
            tag,
          ),
        ),
        hu.some((tag) => ["orszag", "adoalany", "adoszamEU"].includes(tag)),
      ],
      [["orszag", "sendEmail", "adoalany", "adoszamEU"], false],
      "ADAPTER-EU-BUYER",
    );
  });
});

describe("adapterErrorSentence", () => {
  it("names what to do when the payment terms are missing, and keeps the code in the text", () => {
    const missing = new BillingDocumentAdapterError(
      "BILLING_PAYMENT_TERMS_REQUIRED",
    );
    for (const action of ["issue", "preview"] as const) {
      const sentence = adapterErrorSentence(missing, action);
      assert.match(sentence, /fizetési határidő vagy a fizetési mód hiányzik/);
      assert.match(sentence, /\(BILLING_PAYMENT_TERMS_REQUIRED\)/);
    }
    assert.match(
      adapterErrorSentence(missing, "issue"),
      /^A bizonylat nem küldhető a Számlázz\.hu-ra/,
    );
    assert.match(
      adapterErrorSentence(missing, "preview"),
      /^Az előnézet nem kérhető a Számlázz\.hu-tól/,
    );
  });

  it("any other code keeps the plain sentence with the code", () => {
    const other = new BillingDocumentAdapterError("BILLING_NO_LINES");
    assert.equal(
      adapterErrorSentence(other, "issue"),
      "A bizonylat nem küldhető a Számlázz.hu-ra (BILLING_NO_LINES).",
    );
    assert.equal(
      adapterErrorSentence(other, "preview"),
      "Az előnézet nem kérhető a Számlázz.hu-tól (BILLING_NO_LINES).",
    );
  });

  it("both services use it (a plain code in the message would bring the old text back)", () => {
    const issue = readFileSync(
      "src/billing/billing-document-issue.service.ts",
      "utf8",
    );
    const preview = readFileSync(
      "src/billing/billing-document-preview.service.ts",
      "utf8",
    );
    assert.match(issue, /adapterErrorSentence\(error, "issue"\)/);
    assert.match(preview, /adapterErrorSentence\(error, "preview"\)/);
    assert.doesNotMatch(
      issue,
      /nem küldhető a Számlázz\.hu-ra \(\$\{error\.code\}\)/,
    );
    assert.doesNotMatch(
      preview,
      /nem kérhető a Számlázz\.hu-tól \(\$\{error\.code\}\)/,
    );
  });
});

/*
  A KIFIZETETT DÍJBEKÉRŐBŐL KÉSZÜLŐ ELŐLEGSZÁMLA (kártya 00926d89): `fizetve=true` az XSD helyén, és a határidő a kiállítás napja.
  MI PIROSÍT: ha a jelző kimarad vagy rossz helyre kerül (a Számlázz.hu a rossz sorrendet elutasítja); ha egy fizetetlen díjbekérő, egy
  számla vagy díjbekérő-szám nélküli előleg is megkapná; ha a határidő a vázlaté marad; ha előnézetben a mai nap helyett a vázlaté állna.
*/
describe("an advance invoice from a paid proforma", () => {
  const paidAdvance: Partial<BillingDocumentForIssue> = {
    documentType: "ADVANCE_INVOICE",
    proformaNumber: "D-CRPR-7",
    proformaPaid: true,
    issueDate: "2026-11-16",
  };
  const input = (
    document: Partial<BillingDocumentForIssue>,
    options: { previewOnly?: boolean; today?: string } = {},
  ) =>
    toSzamlazzAgentInput(
      { ...base, ...document },
      { agentKey: "test-key", previewOnly: false, ...options },
    );

  it("carries fizetve in its XSD place, after the document flag and before the preview mark", () => {
    const xml = buildSzamlazzAgentInvoiceXml(
      input(paidAdvance, { previewOnly: true }),
    );
    const header = children(xml, "fejlec");
    assertXsdOrder(header, FEJLEC_ORDER, "paid advance fejlec");
    assert.ok(
      header.indexOf("elolegszamla") < header.indexOf("fizetve") &&
        header.indexOf("fizetve") < header.indexOf("elonezetpdf"),
      header.join(","),
    );
    assert.match(xml, /<fizetve>true<\/fizetve>/);
  });

  it("is due on its issue day, not on the draft's due date", () => {
    assert.equal(input(paidAdvance).paymentDueDate, "2026-11-16");
  });

  it("without an issue date (the preview) it is due today", () => {
    const { issueDate: _drop, ...noDate } = paidAdvance;
    assert.equal(
      input(noDate, { previewOnly: true, today: "2026-11-17" }).paymentDueDate,
      "2026-11-17",
    );
  });

  it("an unpaid proforma, an unpaid final invoice, or an advance without a proforma number changes nothing", () => {
    for (const document of [
      { ...paidAdvance, proformaPaid: false },
      { ...paidAdvance, proformaPaid: undefined },
      {
        ...paidAdvance,
        documentType: "FINAL_INVOICE" as const,
        advanceNumber: "E-CRPR-3",
        proformaPaid: false,
      },
      { ...paidAdvance, proformaNumber: null },
    ]) {
      const result = input(document);
      assert.equal(result.paid, undefined, JSON.stringify(document));
      assert.equal(
        result.paymentDueDate,
        "2026-10-08",
        JSON.stringify(document),
      );
      assert.doesNotMatch(
        buildSzamlazzAgentInvoiceXml(result),
        /fizetve/,
        JSON.stringify(document),
      );
    }
  });
});

/*
  A WEBSHOP VÉGSZÁMLÁJA A BEÉRKEZETT HÁTRALÉKRA (kártya d31a66a3, S4): kifizetve megy ki, díjbekérő nélkül (a hátralékot rendezi, nem
  díjbekérőt). Eddig végszámla sosem kaphatta meg (a fenti esetek között állt); a változás szándékos. Hogy mikor "kifizetve", azt
  `proformaPaidOf` dönti el: csak egy webshop rendelés végszámláján, ha a fizetendője a rögzített hátralék fillérre
  (billing-document-issue.service.spec WEBSHOP-FINAL). MI PIROSÍT: a jelző kimarad, vagy fizetetlen végszámlára is rákerül.
*/
describe("a final invoice paid by the balance", () => {
  it("carries fizetve and is due on its issue day, without a proforma number", () => {
    const result = toSzamlazzAgentInput(
      {
        ...base,
        documentType: "FINAL_INVOICE",
        advanceNumber: "E-CRPR-3",
        proformaNumber: null,
        proformaPaid: true,
        issueDate: "2026-11-16",
      },
      { agentKey: "test-key", previewOnly: false },
    );
    assert.equal(result.paid, true);
    assert.equal(result.paymentDueDate, "2026-11-16");
    assert.match(
      buildSzamlazzAgentInvoiceXml(result),
      /<fizetve>true<\/fizetve>/,
    );
  });
});

/*
  A BEÉRKEZETT ELŐRE UTALÁS SZÁMLÁJA (kártya d31a66a3, S1): a webshop rendelés számlája a díjbekérő számával, kifizetve megy ki, és a
  határidő a kiállítás napja, ugyanúgy, mint a kifizetett díjbekérő előlegszámláján. Eddig egy számla sosem kaphatta meg (a fenti
  esetek között állt); a változás szándékos. Hogy KI mondja ki a „kifizetve”-t, azt `proformaPaidOf` dönti el (csak a webshop
  rendelés rögzített beérkezése), itt csak az, hogy a számla viselheti. MI PIROSÍT: a jelző kimarad, rossz helyre kerül, vagy a
  díjbekérő száma nélkül is megjön.
*/
describe("an invoice settling a paid proforma", () => {
  const paidInvoice: Partial<BillingDocumentForIssue> = {
    documentType: "INVOICE",
    proformaNumber: "D-ACR-12",
    proformaPaid: true,
    issueDate: "2026-11-25",
  };
  const input = (document: Partial<BillingDocumentForIssue>) =>
    toSzamlazzAgentInput(
      { ...base, ...document },
      { agentKey: "test-key", previewOnly: false },
    );

  it("goes paid, with the proforma's number, fizetve in its XSD place, due on its issue day", () => {
    const result = input(paidInvoice);
    assert.equal(result.paid, true);
    assert.equal(result.paymentDueDate, "2026-11-25");
    const xml = buildSzamlazzAgentInvoiceXml(result);
    assertXsdOrder(
      children(xml, "fejlec"),
      FEJLEC_ORDER,
      "paid invoice fejlec",
    );
    assert.match(xml, /<dijbekeroSzamlaszam>D-ACR-12<\/dijbekeroSzamlaszam>/);
    assert.match(xml, /<fizetve>true<\/fizetve>/);
  });

  it("without the proforma's number, or not paid, it goes as before", () => {
    for (const document of [
      { ...paidInvoice, proformaNumber: null },
      { ...paidInvoice, proformaPaid: false },
    ]) {
      const result = input(document);
      assert.equal(result.paid, undefined, JSON.stringify(document));
      assert.equal(
        result.paymentDueDate,
        "2026-10-08",
        JSON.stringify(document),
      );
    }
  });
});
