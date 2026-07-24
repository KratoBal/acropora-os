import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseQueryInvoiceDataResponse,
  parseQueryInvoiceDigestResponse,
} from "./nav-online-invoice.client.js";
import { NavApiError } from "./nav-xml.util.js";

const HEADER = `<?xml version="1.0" encoding="UTF-8"?>`;

describe("parseQueryInvoiceDigestResponse", () => {
  it("parses a digest page with multiple invoices", () => {
    const xml =
      `${HEADER}<QueryInvoiceDigestResponse>` +
      `<result><funcCode>OK</funcCode></result>` +
      `<invoiceDigestResult>` +
      `<currentPage>1</currentPage><availablePage>1</availablePage>` +
      `<invoiceDigest>` +
      `<invoiceNumber>SZLA-2026-001</invoiceNumber>` +
      `<invoiceOperation>CREATE</invoiceOperation>` +
      `<invoiceIssueDate>2026-07-20</invoiceIssueDate>` +
      `<invoiceDeliveryDate>2026-07-20</invoiceDeliveryDate>` +
      `<supplierTaxNumber>12345678</supplierTaxNumber>` +
      `<supplierName>Teszt Kft.</supplierName>` +
      `<currency>HUF</currency>` +
      `<invoiceNetAmount>10000</invoiceNetAmount>` +
      `<invoiceVatAmount>2700</invoiceVatAmount>` +
      `<insDate>2026-07-20T10:00:00.000Z</insDate>` +
      `</invoiceDigest>` +
      `<invoiceDigest>` +
      `<invoiceNumber>SZLA-2026-002</invoiceNumber>` +
      `<invoiceOperation>MODIFY</invoiceOperation>` +
      `<invoiceIssueDate>2026-07-21</invoiceIssueDate>` +
      `<insDate>2026-07-21T09:00:00.000Z</insDate>` +
      `</invoiceDigest>` +
      `</invoiceDigestResult>` +
      `</QueryInvoiceDigestResponse>`;

    const result = parseQueryInvoiceDigestResponse(xml);
    assert.equal(result.currentPage, 1);
    assert.equal(result.availablePage, 1);
    assert.equal(result.items.length, 2);
    assert.equal(result.items[0]?.invoiceNumber, "SZLA-2026-001");
    assert.equal(result.items[0]?.invoiceOperation, "CREATE");
    assert.equal(result.items[0]?.supplierName, "Teszt Kft.");
    assert.equal(result.items[1]?.invoiceOperation, "MODIFY");
  });

  it("throws API_REJECTED when funcCode is not OK", () => {
    const xml =
      `${HEADER}<QueryInvoiceDigestResponse>` +
      `<result><funcCode>ERROR</funcCode><message>Rossz aláírás</message></result>` +
      `</QueryInvoiceDigestResponse>`;
    assert.throws(
      () => parseQueryInvoiceDigestResponse(xml),
      (error: unknown) =>
        error instanceof NavApiError && error.code === "API_REJECTED",
    );
  });

  it("throws RESPONSE_SHAPE_INVALID for an unexpected root element", () => {
    const xml = `${HEADER}<UnexpectedResponse></UnexpectedResponse>`;
    assert.throws(
      () => parseQueryInvoiceDigestResponse(xml),
      (error: unknown) =>
        error instanceof NavApiError && error.code === "RESPONSE_SHAPE_INVALID",
    );
  });
});

describe("parseQueryInvoiceDataResponse", () => {
  it("extracts the base64 invoice data and the compression flag", () => {
    const xml =
      `${HEADER}<QueryInvoiceDataResponse>` +
      `<result><funcCode>OK</funcCode></result>` +
      `<invoiceDataResult>` +
      `<invoiceData>SGVsbG8=</invoiceData>` +
      `<compressedContentIndicator>true</compressedContentIndicator>` +
      `</invoiceDataResult>` +
      `</QueryInvoiceDataResponse>`;
    const result = parseQueryInvoiceDataResponse(xml);
    assert.equal(result.invoiceDataBase64, "SGVsbG8=");
    assert.equal(result.compressed, true);
  });

  it("throws API_REJECTED when the NAV response signals an error", () => {
    const xml =
      `${HEADER}<GeneralErrorResponse>` +
      `<result><funcCode>ERROR</funcCode><errorCode>INVALID_REQUEST_SIGNATURE</errorCode></result>` +
      `</GeneralErrorResponse>`;
    assert.throws(
      () => parseQueryInvoiceDataResponse(xml),
      (error: unknown) =>
        error instanceof NavApiError && error.code === "API_REJECTED",
    );
  });
});
