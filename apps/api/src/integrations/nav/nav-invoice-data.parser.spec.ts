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
    `<Invoice>` +
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
    `<lineAmountsNormal><lineNetAmount>16000</lineNetAmount><lineVatRate><vatPercentage>0.27</vatPercentage></lineVatRate></lineAmountsNormal>` +
    `</line>` +
    `<line>` +
    `<lineNumber>2</lineNumber>` +
    `<lineDescription>Szállítási díj</lineDescription>` +
    `<quantity>1</quantity>` +
    `<unitOfMeasureOwn>alkalom</unitOfMeasureOwn>` +
    `<unitPrice>3000</unitPrice>` +
    `<lineAmountsNormal><lineNetAmount>3000</lineNetAmount><lineVatRate><vatPercentage>0.27</vatPercentage></lineVatRate></lineAmountsNormal>` +
    `</line>` +
    `</invoiceLines>` +
    `</invoice></invoiceMain>` +
    `</Invoice>`
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
