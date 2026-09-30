import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gzipSync } from "node:zlib";

import {
  parseNavInvoiceData,
  suggestedVatRatePercent,
} from "./nav-invoice-data.parser.js";
import { decodeInvoiceDataXml, parseXml } from "./nav-xml.util.js";

function sampleInvoiceXml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<InvoiceData>` +
    `<invoiceNumber>FM-2026-001</invoiceNumber>` +
    `<invoiceIssueDate>2026-07-24</invoiceIssueDate>` +
    `<completenessIndicator>false</completenessIndicator>` +
    `<invoiceMain><invoice>` +
    `<invoiceHead>` +
    `<supplierInfo>` +
    `<supplierTaxNumber><taxpayerId>12345678</taxpayerId><vatCode>2</vatCode><countyCode>42</countyCode></supplierTaxNumber>` +
    `<supplierName>Reef Import Kft.</supplierName>` +
    `<supplierAddress><detailedAddress><postalCode>1111</postalCode><city>Budapest</city><streetName>Fő</streetName><publicPlaceCategory>utca</publicPlaceCategory><number>12</number></detailedAddress></supplierAddress>` +
    `<supplierBankAccountNumber>12345678-12345678-12345678</supplierBankAccountNumber>` +
    `</supplierInfo>` +
    `<invoiceDetail>` +
    `<invoiceIssueDate>2026-07-24</invoiceIssueDate>` +
    `<invoiceDeliveryDate>2026-07-24</invoiceDeliveryDate>` +
    `<paymentDate>2026-08-07</paymentDate>` +
    `<currencyCode>HUF</currencyCode>` +
    `</invoiceDetail>` +
    `</invoiceHead>` +
    `<invoiceLines>` +
    `<line>` +
    `<lineNumber>1</lineNumber>` +
    `<lineDescription>Tengeri só 25kg</lineDescription>` +
    `<quantity>2</quantity>` +
    `<unitOfMeasure>PIECE</unitOfMeasure>` +
    `<unitPrice>8000</unitPrice>` +
    `<lineAmountsNormal><lineNetAmountData><lineNetAmount>16000</lineNetAmount><lineNetAmountHUF>16000</lineNetAmountHUF></lineNetAmountData><lineVatRate><vatPercentage>0.27</vatPercentage></lineVatRate></lineAmountsNormal>` +
    `</line>` +
    `<line>` +
    `<lineNumber>2</lineNumber>` +
    `<lineDescription>Szállítási díj</lineDescription>` +
    `<quantity>1</quantity>` +
    `<unitOfMeasureOwn>alkalom</unitOfMeasureOwn>` +
    `<unitPrice>3000</unitPrice>` +
    `<lineAmountsNormal><lineNetAmountData><lineNetAmount>3000</lineNetAmount><lineNetAmountHUF>3000</lineNetAmountHUF></lineNetAmountData><lineVatRate><vatPercentage>0.27</vatPercentage></lineVatRate></lineAmountsNormal>` +
    `</line>` +
    `</invoiceLines>` +
    `</invoice></invoiceMain>` +
    `</InvoiceData>`
  );
}

describe("parseNavInvoiceData", () => {
  it("extracts supplier, address and line details", () => {
    const parsed = parseNavInvoiceData(parseXml(sampleInvoiceXml()));

    assert.equal(parsed.supplierTaxNumber, "12345678-2-42");
    assert.equal(parsed.supplierName, "Reef Import Kft.");
    assert.deepEqual(parsed.supplierAddress, {
      postalCode: "1111",
      city: "Budapest",
      line1: "Fő utca 12",
      country: "HU",
    });
    assert.equal(
      parsed.supplierBankAccountNumber,
      "12345678-12345678-12345678",
    );
    assert.equal(parsed.currency, "HUF");
    assert.equal(parsed.paymentDate, "2026-08-07");
    assert.equal(parsed.lines.length, 2);
    assert.equal(parsed.lines[0]?.description, "Tengeri só 25kg");
    assert.equal(parsed.lines[0]?.unit, "db");
    assert.equal(parsed.lines[0]?.lineNetAmount, "16000");
    assert.equal(parsed.lines[0]?.vatRatePercent, "27");
    assert.equal(parsed.lines[1]?.unit, "alkalom");
  });

  it("suggests the most common line VAT rate", () => {
    const parsed = parseNavInvoiceData(parseXml(sampleInvoiceXml()));
    assert.equal(suggestedVatRatePercent(parsed.lines), "27");
  });

  it("returns undefined suggested VAT rate when no line carries one", () => {
    assert.equal(suggestedVatRatePercent([]), undefined);
  });
});

/**
 * A TÉTEL SORSZÁMA (2026-09-28).
 *
 * A korábbi alak a hiányzó sorszámot `Number("")` = 0-ként engedte át, mert a 0
 * véges szám; a nem szám sorszám (NaN) viszont az egész tételt eldobta. Mostantól
 * minden nem pozitív egész `null`, és a tétel megmarad.
 *
 * MI PIROSÍT: ha a hiányzó vagy az üres sorszám 0 lesz (a régi hiba); ha a 0
 * átmegy sorszámként; ha egy rossz sorszám a tételt is elviszi. A normál eset a
 * kontroll: egy mindig-null megvalósítás a többit zölden hagyná.
 */
function oneLineInvoice(lineNumberXml: string): string {
  return (
    `<InvoiceData><invoiceMain><invoice>` +
    `<invoiceHead><supplierInfo><supplierName>X Kft.</supplierName></supplierInfo>` +
    `<invoiceDetail><currencyCode>HUF</currencyCode></invoiceDetail></invoiceHead>` +
    `<invoiceLines><line>` +
    lineNumberXml +
    `<lineDescription>Tengeri só 25kg</lineDescription>` +
    `<quantity>1</quantity>` +
    `<lineAmountsNormal><lineNetAmountData><lineNetAmount>8000</lineNetAmount></lineNetAmountData></lineAmountsNormal>` +
    `</line></invoiceLines>` +
    `</invoice></invoiceMain></InvoiceData>`
  );
}

function linesOf(lineNumberXml: string) {
  return parseNavInvoiceData(parseXml(oneLineInvoice(lineNumberXml))).lines;
}

describe("parseNavInvoiceData: a tétel sorszáma", () => {
  it("normál eset: a sorszám szám marad (kontroll)", () => {
    const lines = linesOf(`<lineNumber>7</lineNumber>`);
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.lineNumber, 7);
  });

  it("hiányzó sorszám: null, nem 0, és a tétel megmarad", () => {
    const lines = linesOf(``);
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.lineNumber, null);
  });

  it("üres sorszám: null, nem 0", () => {
    const lines = linesOf(`<lineNumber></lineNumber>`);
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.lineNumber, null);
  });

  it("a 0 nem sorszám: null", () => {
    assert.equal(linesOf(`<lineNumber>0</lineNumber>`)[0]?.lineNumber, null);
  });

  /**
   * A MÁSIK IRÁNY: eddig egy nem szám sorszám a TÉTELT is eldobta. A tétel
   * létét nem a sorszám dönti el.
   */
  it("nem szám, negatív, tört vagy exponenciális alak: null, és a tétel megmarad", () => {
    for (const raw of ["abc", "-1", "1.5", "1e2", "0x1f"]) {
      const lines = linesOf(`<lineNumber>${raw}</lineNumber>`);
      assert.equal(lines.length, 1, `${raw}: a tétel kiesett`);
      assert.equal(lines[0]?.lineNumber, null, `${raw}: nem null`);
    }
  });

  it("a 32 bites határ fölött: null", () => {
    assert.equal(
      linesOf(`<lineNumber>2147483648</lineNumber>`)[0]?.lineNumber,
      null,
    );
    assert.equal(
      linesOf(`<lineNumber>2147483647</lineNumber>`)[0]?.lineNumber,
      2147483647,
    );
  });
});

describe("decodeInvoiceDataXml", () => {
  it("round-trips base64 + gzip compressed invoice data", () => {
    const original = sampleInvoiceXml();
    const compressed = gzipSync(Buffer.from(original, "utf8")).toString(
      "base64",
    );
    const node = decodeInvoiceDataXml(compressed, true);
    const parsed = parseNavInvoiceData(node);
    assert.equal(parsed.supplierName, "Reef Import Kft.");
  });

  it("decodes uncompressed base64 invoice data", () => {
    const original = sampleInvoiceXml();
    const base64 = Buffer.from(original, "utf8").toString("base64");
    const node = decodeInvoiceDataXml(base64, false);
    const parsed = parseNavInvoiceData(node);
    assert.equal(parsed.lines.length, 2);
  });
});

/**
 * A tétel termékkódjai: NAV Online Számla 3.0, invoiceData.xsd
 * `ProductCodesType` (1761. sor), `ProductCodeType` (1775. sor),
 * `ProductCodeCategoryType` (136. sor). A `productCodeValue` és a
 * `productCodeOwnValue` közül a séma pontosan egyet enged (xs:choice).
 */
describe("parseNavInvoiceData: productCodes", () => {
  const invoiceWithLine = (lineXml: string) =>
    parseNavInvoiceData(
      parseXml(
        `<InvoiceData><invoiceMain><invoice>` +
          `<invoiceHead><supplierInfo><supplierName>HANNA Instruments Service Kft.</supplierName></supplierInfo>` +
          `<invoiceDetail><currencyCode>HUF</currencyCode></invoiceDetail></invoiceHead>` +
          `<invoiceLines><line><lineNumber>1</lineNumber>` +
          lineXml +
          `<lineDescription>pH mérő</lineDescription><quantity>1</quantity>` +
          `<lineAmountsNormal><lineNetAmountData><lineNetAmount>15000</lineNetAmount></lineNetAmountData></lineAmountsNormal>` +
          `</line></invoiceLines></invoice></invoiceMain></InvoiceData>`,
      ),
    ).lines[0]!;

  it("reads every code with its category, own and not-own values alike", () => {
    const line = invoiceWithLine(
      `<productCodes>` +
        `<productCode><productCodeCategory>VTSZ</productCodeCategory><productCodeValue>90278017</productCodeValue></productCode>` +
        `<productCode><productCodeCategory>OWN</productCodeCategory><productCodeOwnValue>HI98107</productCodeOwnValue></productCode>` +
        `<productCode><productCodeCategory>OTHER</productCodeCategory><productCodeValue>5901234123457</productCodeValue></productCode>` +
        `</productCodes>`,
    );

    assert.deepEqual(line.productCodes, [
      { category: "VTSZ", value: "90278017" },
      { category: "OWN", value: "HI98107" },
      { category: "OTHER", value: "5901234123457" },
    ]);
  });

  it("reads the codes through namespace prefixes, trimmed", () => {
    const line = invoiceWithLine(
      `<ns2:productCodes><ns2:productCode><ns2:productCodeCategory>OWN</ns2:productCodeCategory><ns2:productCodeOwnValue> HI98107 </ns2:productCodeOwnValue></ns2:productCode></ns2:productCodes>`,
    );

    assert.deepEqual(line.productCodes, [
      { category: "OWN", value: "HI98107" },
    ]);
  });

  it("drops a code without a category or a value", () => {
    const line = invoiceWithLine(
      `<productCodes>` +
        `<productCode><productCodeValue>90278017</productCodeValue></productCode>` +
        `<productCode><productCodeCategory>OWN</productCodeCategory></productCode>` +
        `</productCodes>`,
    );

    assert.equal("productCodes" in line, false);
  });

  it("leaves a line without codes as it was", () => {
    const line = invoiceWithLine("");

    assert.equal("productCodes" in line, false);
    assert.equal(line.description, "pH mérő");
  });
});
