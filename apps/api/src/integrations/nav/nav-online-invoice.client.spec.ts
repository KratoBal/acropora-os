import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  NavOnlineInvoiceClient,
  buildQueryInvoiceDigestXml,
  parseQueryInvoiceDataResponse,
  parseQueryInvoiceDigestResponse,
  parseQueryTaxpayerResponse,
  type NavSoftwareData,
  type NavTechnicalUser,
} from "./nav-online-invoice.client.js";
import { NavApiError } from "./nav-xml.util.js";

const HEADER = `<?xml version="1.0" encoding="UTF-8"?>`;
const TECHNICAL_USER: NavTechnicalUser = {
  login: "technical-user",
  password: "secret",
  taxNumber: "23916229",
  signKey: "sign-key",
};
const SOFTWARE: NavSoftwareData = {
  softwareId: "ACROPORAOS00000001",
  softwareName: "Acropora OS",
  softwareOperation: "ONLINE_SERVICE",
  softwareMainVersion: "1.0",
  softwareDevName: "Acropora Kft.",
  softwareDevContact: "info@acropora.hu",
  softwareDevCountryCode: "HU",
  softwareDevTaxNumber: "23916229",
};

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

  it("reads the original invoice and the modification index of a credit note, and skips an unknown operation", () => {
    const digest = (operation: string, extra = "") =>
      `<invoiceDigest>` +
      `<invoiceNumber>KS26/05898</invoiceNumber>` +
      `<invoiceOperation>${operation}</invoiceOperation>` +
      `<invoiceIssueDate>2026-06-12</invoiceIssueDate>` +
      `<supplierTaxNumber>12345678</supplierTaxNumber>` +
      `<invoiceNetAmount>-59918</invoiceNetAmount>` +
      `<insDate>2026-06-12T09:00:00.000Z</insDate>` +
      extra +
      `</invoiceDigest>`;
    const xml =
      `${HEADER}<QueryInvoiceDigestResponse>` +
      `<result><funcCode>OK</funcCode></result>` +
      `<invoiceDigestResult><currentPage>1</currentPage><availablePage>1</availablePage>` +
      digest(
        "MODIFY",
        "<originalInvoiceNumber>KS26/05101</originalInvoiceNumber><modificationIndex>1</modificationIndex>",
      ) +
      digest("STORNO", "<modificationIndex></modificationIndex>") +
      digest("ANNUL") +
      `</invoiceDigestResult></QueryInvoiceDigestResponse>`;
    const items = parseQueryInvoiceDigestResponse(xml).items;
    assert.deepEqual(
      items.map((i) => [
        i.invoiceOperation,
        i.originalInvoiceNumber,
        i.modificationIndex,
        i.invoiceNetAmount,
      ]),
      [
        ["MODIFY", "KS26/05101", 1, "-59918"],
        ["STORNO", undefined, undefined, "-59918"],
      ],
    );
  });

  // THE OUTBOUND PATH'S FIELDS (card 785dfea6), from the schema's InvoiceDigestType; a private-person buyer has neither name nor tax
  // number in NAV (interface specification v3.0, 2026.02.12, pp. 95, 108)
  it("reads the buyer, the category, the appearance, the source and the transaction of an outbound digest; a private person has no buyer", () => {
    const digest = (number: string, buyer: string) =>
      `<invoiceDigest>` +
      `<invoiceNumber>${number}</invoiceNumber>` +
      `<invoiceOperation>CREATE</invoiceOperation>` +
      `<invoiceCategory>NORMAL</invoiceCategory>` +
      `<invoiceIssueDate>2026-05-04</invoiceIssueDate>` +
      `<supplierTaxNumber>23916229</supplierTaxNumber>` +
      `<supplierName>Acropora Kft.</supplierName>` +
      buyer +
      `<paymentMethod>TRANSFER</paymentMethod>` +
      `<invoiceAppearance>ELECTRONIC</invoiceAppearance>` +
      `<source>MGM</source>` +
      `<transactionId>4B8ZXKF2TL1SDNMQ</transactionId>` +
      `<index>2</index>` +
      `<insDate>2026-05-04T08:00:00.000Z</insDate>` +
      `</invoiceDigest>`;
    const xml =
      `${HEADER}<QueryInvoiceDigestResponse><result><funcCode>OK</funcCode></result>` +
      `<invoiceDigestResult><currentPage>1</currentPage><availablePage>1</availablePage>` +
      digest(
        "2026/00031",
        "<customerTaxNumber>15300001</customerTaxNumber><customerName>Állatkert Kft.</customerName>",
      ) +
      digest("2026/00032", "") +
      `</invoiceDigestResult></QueryInvoiceDigestResponse>`;
    const items = parseQueryInvoiceDigestResponse(xml).items;
    assert.deepEqual(
      items.map((i) => [
        i.customerName,
        i.customerTaxNumber,
        i.invoiceCategory,
        i.paymentMethod,
        i.invoiceAppearance,
        i.source,
        i.transactionId,
        i.index,
      ]),
      [
        [
          "Állatkert Kft.",
          "15300001",
          "NORMAL",
          "TRANSFER",
          "ELECTRONIC",
          "MGM",
          "4B8ZXKF2TL1SDNMQ",
          2,
        ],
        [
          undefined,
          undefined,
          "NORMAL",
          "TRANSFER",
          "ELECTRONIC",
          "MGM",
          "4B8ZXKF2TL1SDNMQ",
          2,
        ],
      ],
    );
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

describe("NavOnlineInvoiceClient.queryInvoiceData", () => {
  it("sends only the eight-digit supplier taxpayer id to NAV", async () => {
    class CapturingClient extends NavOnlineInvoiceClient {
      requestBody = "";

      protected override request(_input: string, init: RequestInit) {
        this.requestBody = String(init.body);
        return Promise.resolve(
          new Response(
            `${HEADER}<QueryInvoiceDataResponse>` +
              `<result><funcCode>OK</funcCode></result>` +
              `<invoiceDataResult>` +
              `<compressedContentIndicator>false</compressedContentIndicator>` +
              `</invoiceDataResult>` +
              `</QueryInvoiceDataResponse>`,
            { status: 200 },
          ),
        );
      }
    }

    const client = new CapturingClient();
    await client.queryInvoiceData(
      "TESZT-2026-001",
      "INBOUND",
      "32435119-2-43",
      TECHNICAL_USER,
      SOFTWARE,
    );

    assert.match(
      client.requestBody,
      /<supplierTaxNumber>32435119<\/supplierTaxNumber>/,
    );
    assert.doesNotMatch(client.requestBody, /32435119-2-43/);
  });
});

/**
 * A NAV ADÓALANY-LEKÉRDEZÉS VÁLASZA (acropora-os #2726, barracuda). MI PIROSÍT: ha a hiányzó vagy ismeretlen `taxpayerValidity`
 * "nincs ilyen adószám"-nak látszik (egy válaszalak-változás csendben minden céges számlát megállítana); ha a kifejezett "false"
 * nem hamis; ha az érvényes adóalany adatai (név, adószám, székhely) elvesznek.
 */
describe("parseQueryTaxpayerResponse", () => {
  const response = (inner: string, funcCode = "OK") =>
    `${HEADER}<QueryTaxpayerResponse><result><funcCode>${funcCode}</funcCode></result>${inner}</QueryTaxpayerResponse>`;

  it("a valid taxpayer: its name, tax number and headquarters address", () => {
    const result = parseQueryTaxpayerResponse(
      response(
        `<taxpayerValidity>true</taxpayerValidity><taxpayerData>` +
          `<taxpayerName>MINTA KFT</taxpayerName>` +
          `<taxNumberDetail><taxpayerId>12345678</taxpayerId><vatCode>2</vatCode><countyCode>41</countyCode></taxNumberDetail>` +
          `</taxpayerData>`,
      ),
    );
    assert.equal(result.valid, true);
    assert.equal(result.validityUnknown, undefined);
    assert.equal(result.data?.name, "MINTA KFT");
    assert.equal(result.data?.taxNumber, "12345678-2-41");
  });

  it("an explicit false is 'no such taxpayer' and says nothing is unknown", () => {
    assert.deepEqual(
      parseQueryTaxpayerResponse(
        response(`<taxpayerValidity>false</taxpayerValidity>`),
      ),
      { valid: false, data: null },
    );
  });

  it("a missing or odd taxpayerValidity is NOT 'no such taxpayer': validityUnknown", () => {
    for (const inner of [
      "",
      `<taxpayerValidity></taxpayerValidity>`,
      `<taxpayerValidity>maybe</taxpayerValidity>`,
    ])
      assert.deepEqual(parseQueryTaxpayerResponse(response(inner)), {
        valid: false,
        data: null,
        validityUnknown: true,
      });
  });

  it("a refused request is an error, not an answer", () => {
    assert.throws(
      () => parseQueryTaxpayerResponse(response("", "ERROR")),
      NavApiError,
    );
  });
});

// THE DATE THE DIGEST SEARCHES ON (card 785dfea6): the receipt time by default (the daily inbound sync), the issue date on request; the
// schema takes exactly one (MandatoryQueryParamsType), the issue date as xs:date with both ends included (DateIntervalParamType)
describe("buildQueryInvoiceDigestXml", () => {
  const from = new Date("2026-01-01T00:00:00.000Z");
  const to = new Date("2026-01-30T00:00:00.000Z");
  const now = new Date("2026-11-20T12:00:00.000Z");
  const params = (xml: string) =>
    xml.slice(
      xml.indexOf("<invoiceQueryParams>"),
      xml.indexOf("</invoiceQueryParams>") + 21,
    );

  it("searches the receipt time by default, as before", () => {
    assert.equal(
      params(
        buildQueryInvoiceDigestXml(
          1,
          "INBOUND",
          from,
          to,
          TECHNICAL_USER,
          SOFTWARE,
          now,
        ),
      ),
      "<invoiceQueryParams><mandatoryQueryParams><insDate><dateTimeFrom>2026-01-01T00:00:00.000Z</dateTimeFrom>" +
        "<dateTimeTo>2026-01-30T00:00:00.000Z</dateTimeTo></insDate></mandatoryQueryParams></invoiceQueryParams>",
    );
  });

  it("searches the issue date by day when asked, outbound", () => {
    const xml = buildQueryInvoiceDigestXml(
      2,
      "OUTBOUND",
      from,
      to,
      TECHNICAL_USER,
      SOFTWARE,
      now,
      "invoiceIssueDate",
    );
    assert.equal(
      params(xml),
      "<invoiceQueryParams><mandatoryQueryParams><invoiceIssueDate><dateFrom>2026-01-01</dateFrom><dateTo>2026-01-30</dateTo>" +
        "</invoiceIssueDate></mandatoryQueryParams></invoiceQueryParams>",
    );
    assert.ok(
      xml.includes(
        "<page>2</page><invoiceDirection>OUTBOUND</invoiceDirection>",
      ),
    );
  });
});
