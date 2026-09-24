import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSzamlazzAgentInvoiceXml,
  parseSzamlazzAgentXmlResponse,
  SzamlazzAgentXmlError,
  type SzamlazzAgentInvoiceInput,
} from "./szamlazz-agent-xml.js";

const baseInput: SzamlazzAgentInvoiceInput = {
  agentKey: "test-agent-key",
  previewOnly: true,
  paymentDueDate: "2026-09-24",
  fulfillmentDate: "2026-09-24",
  paymentMethod: "Átutalás",
  currency: "HUF",
  comment: "Karbantartási szolgáltatás",
  orderNumber: "TIG-2026-0001",
  seller: {},
  buyer: {
    name: 'Kovács "Bt." & Társa',
    zip: "1011",
    city: "Budapest",
    address: "Fő utca 1.",
    taxNumber: "12345678-1-42",
  },
  items: [
    {
      name: "Vízcsere",
      quantity: 1,
      unit: "db",
      netUnitPrice: 10000,
      vatRatePercent: "27",
      netAmount: 10000,
      vatAmount: 2700,
      grossAmount: 12700,
    },
  ],
};

describe("buildSzamlazzAgentInvoiceXml", () => {
  it("follows the fixed element order the docs require", () => {
    const xml = buildSzamlazzAgentInvoiceXml(baseInput);

    const order = ["beallitasok", "fejlec", "elado", "vevo", "tetelek"];
    let cursor = 0;
    for (const name of order) {
      const found = xml.indexOf(`<${name}>`, cursor);
      assert.ok(found >= cursor, `${name} missing or out of order`);
      cursor = found;
    }
  });

  it("escapes XML-significant characters in free text fields", () => {
    const xml = buildSzamlazzAgentInvoiceXml(baseInput);
    assert.match(xml, /Kov.cs &quot;Bt\.&quot; &amp; T.rsa/);
    assert.doesNotMatch(xml, /<nev>Kovács "Bt\."/);
  });

  it("only emits elonezetpdf when previewOnly is set", () => {
    const preview = buildSzamlazzAgentInvoiceXml(baseInput);
    assert.match(preview, /<elonezetpdf>true<\/elonezetpdf>/);

    const real = buildSzamlazzAgentInvoiceXml({
      ...baseInput,
      previewOnly: false,
    });
    assert.doesNotMatch(real, /elonezetpdf/);
  });

  it("always requests the structured XML response with the PDF included", () => {
    const xml = buildSzamlazzAgentInvoiceXml(baseInput);
    assert.match(xml, /<valaszVerzio>2<\/valaszVerzio>/);
    assert.match(xml, /<szamlaLetoltes>true<\/szamlaLetoltes>/);
  });

  it("puts one <tetel> per item, in item order", () => {
    const xml = buildSzamlazzAgentInvoiceXml({
      ...baseInput,
      items: [
        { ...baseInput.items[0]!, name: "Első" },
        { ...baseInput.items[0]!, name: "Második" },
      ],
    });
    const first = xml.indexOf("Első");
    const second = xml.indexOf("Második");
    assert.ok(first >= 0 && second > first);
  });
});

const SUCCESS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<xmlszamlavalasz xmlns="http://www.szamlazz.hu/xmlszamlavalasz">
<sikeres>true</sikeres>
<szamlanetto>10000</szamlanetto>
<szamlabrutto>12700</szamlabrutto>
<pdf>SGVsbG8=</pdf>
</xmlszamlavalasz>`;

const ERROR_XML = `<?xml version="1.0" encoding="UTF-8"?>
<xmlszamlavalasz xmlns="http://www.szamlazz.hu/xmlszamlavalasz">
<sikeres>false</sikeres>
<hibakod>3</hibakod>
<hibauzenet><![CDATA[Bejelentkezési hiba]]></hibauzenet>
</xmlszamlavalasz>`;

describe("parseSzamlazzAgentXmlResponse", () => {
  it("parses a successful preview response, decoding the PDF from base64", () => {
    const result = parseSzamlazzAgentXmlResponse(SUCCESS_XML);
    assert.equal(result.successful, true);
    assert.equal(result.netTotal, 10000);
    assert.equal(result.grossTotal, 12700);
    assert.equal(result.pdf?.toString("utf8"), "Hello");
    // A DRAFT hívás nem kap számot -- ez a mai válaszban sincs benne, és a
    // hívó (maintenance-invoice-draft.service.ts) SOHA nem olvashatja ezt a
    // mezőt piszkozathoz.
    assert.equal(result.invoiceNumber, undefined);
  });

  it("parses a rejected request, unfolding the CDATA error text", () => {
    const result = parseSzamlazzAgentXmlResponse(ERROR_XML);
    assert.equal(result.successful, false);
    assert.equal(result.errorCode, "3");
    assert.equal(result.errorMessage, "Bejelentkezési hiba");
  });

  it("fails closed on a document that isn't the expected root element", () => {
    assert.throws(
      () => parseSzamlazzAgentXmlResponse("<html>not this</html>"),
      SzamlazzAgentXmlError,
    );
  });

  it("fails closed when the mandatory sikeres field is missing", () => {
    assert.throws(
      () =>
        parseSzamlazzAgentXmlResponse("<xmlszamlavalasz></xmlszamlavalasz>"),
      SzamlazzAgentXmlError,
    );
  });
});
