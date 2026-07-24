import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gzipSync } from "node:zlib";

import type {
  NavInvoiceDigestItem,
  NavInvoiceDigestResult,
} from "../../integrations/nav/nav-online-invoice.client.js";
import { NavIncomingInvoiceService } from "./nav-incoming-invoice.service.js";
import type { NavIncomingInvoiceRow } from "./nav-incoming-invoice.types.js";

function sampleInvoiceXml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Invoice><invoiceMain><invoice>` +
    `<invoiceHead>` +
    `<supplierInfo>` +
    `<supplierTaxNumber><taxpayerId>87654321</taxpayerId><vatCode>2</vatCode><countyCode>13</countyCode></supplierTaxNumber>` +
    `<supplierName>Akvarisztika Kft.</supplierName>` +
    `</supplierInfo>` +
    `<invoiceDetail><currencyCode>HUF</currencyCode></invoiceDetail>` +
    `</invoiceHead>` +
    `<invoiceLines>` +
    `<line><lineNumber>1</lineNumber><lineDescription>Akvárium szűrő</lineDescription><quantity>1</quantity><unitOfMeasure>PIECE</unitOfMeasure><unitPrice>15000</unitPrice><lineAmountsNormal><lineNetAmount>15000</lineNetAmount><lineVatRate><vatPercentage>0.27</vatPercentage></lineVatRate></lineAmountsNormal></line>` +
    `</invoiceLines>` +
    `</invoice></invoiceMain></Invoice>`
  );
}

function baseRow(
  overrides: Partial<NavIncomingInvoiceRow> = {},
): NavIncomingInvoiceRow {
  return {
    id: "nav-invoice-1",
    navInvoiceNumber: "SZLA-2026-001",
    supplierTaxNumber: "87654321",
    supplierName: "Akvarisztika Kft.",
    invoiceIssueDate: new Date("2026-07-24T00:00:00.000Z"),
    invoiceDeliveryDate: null,
    paymentDate: null,
    currency: "HUF",
    invoiceNetAmount: null,
    invoiceVatAmount: null,
    insDate: new Date("2026-07-24T10:00:00.000Z"),
    status: "NEW",
    parsedData: null,
    errorCode: null,
    purchaseInvoiceId: null,
    ...overrides,
  };
}

function buildService(options: {
  row: NavIncomingInvoiceRow;
  refreshedRow?: NavIncomingInvoiceRow;
  queryInvoiceData?: () => Promise<{
    invoiceDataBase64?: string;
    compressed: boolean;
  }>;
  queryInvoiceDigest?: (page: number) => Promise<NavInvoiceDigestResult>;
}) {
  let savedParsedData: unknown;
  let markedErrorCode: string | undefined;
  let appliedItems: NavInvoiceDigestItem[] | undefined;
  let createRunCalled = false;
  let markFailedCalled = false;

  const client = {
    queryInvoiceData:
      options.queryInvoiceData ??
      (async () => ({
        invoiceDataBase64: Buffer.from(sampleInvoiceXml(), "utf8").toString(
          "base64",
        ),
        compressed: false,
      })),
    queryInvoiceDigest:
      options.queryInvoiceDigest ??
      (async (page: number) => ({
        currentPage: page,
        availablePage: 1,
        items: [],
      })),
  } as unknown as ConstructorParameters<typeof NavIncomingInvoiceService>[0];

  const credentials = {
    technicalUser: () => ({
      login: "user",
      password: "pass",
      taxNumber: "12345678",
      signKey: "key",
    }),
    software: () => ({
      softwareId: "123456789123456789",
      softwareName: "Acropora OS",
      softwareOperation: "ONLINE_SERVICE" as const,
      softwareMainVersion: "1.0",
      softwareDevName: "Dev",
      softwareDevContact: "dev@example.com",
      softwareDevCountryCode: "HU",
      softwareDevTaxNumber: "12345678",
    }),
  } as unknown as ConstructorParameters<typeof NavIncomingInvoiceService>[1];

  const repository = {
    findById: async () => options.row,
    saveParsedData: async (_id: string, parsedData: unknown) => {
      savedParsedData = parsedData;
    },
    markError: async (_id: string, errorCode: string) => {
      markedErrorCode = errorCode;
    },
    getCursor: async () => null,
    createRun: async () => {
      createRunCalled = true;
      return "run-1";
    },
    markFailed: async () => {
      markFailedCalled = true;
    },
    applyDigest: async (
      _runId: string,
      items: NavInvoiceDigestItem[],
      windowStart: Date | null,
      windowEnd: Date,
    ) => {
      appliedItems = items;
      return {
        runId: "run-1",
        status: "APPLIED" as const,
        invoicesSeen: items.length,
        createdCount: items.length,
        skippedCount: 0,
        windowStart: windowStart?.toISOString() ?? null,
        windowEnd: windowEnd.toISOString(),
      };
    },
  } as unknown as ConstructorParameters<typeof NavIncomingInvoiceService>[2];

  // A detail() a lekérdezés utáni friss sort a repository.findById második
  // hívásából kapja - ha a teszt megadott egy "utána" állapotot, azt adjuk
  // vissza másodikra.
  if (options.refreshedRow) {
    let callCount = 0;
    (
      repository as unknown as {
        findById: (id: string) => Promise<NavIncomingInvoiceRow>;
      }
    ).findById = async () => {
      callCount += 1;
      return callCount === 1 ? options.row : options.refreshedRow!;
    };
  }

  return {
    service: new NavIncomingInvoiceService(client, credentials, repository),
    getSavedParsedData: () => savedParsedData,
    getMarkedErrorCode: () => markedErrorCode,
    getAppliedItems: () => appliedItems,
    wasCreateRunCalled: () => createRunCalled,
    wasMarkFailedCalled: () => markFailedCalled,
  };
}

describe("NavIncomingInvoiceService.detail", () => {
  it("fetches and parses the full invoice data for a NEW row", async () => {
    const row = baseRow({ status: "NEW" });
    const refreshedRow = baseRow({
      status: "DATA_FETCHED",
      parsedData: {
        supplierTaxNumber: "87654321-2-13",
        supplierName: "Akvarisztika Kft.",
        currency: "HUF",
        lines: [
          {
            lineNumber: 1,
            description: "Akvárium szűrő",
            quantity: "1",
            unit: "db",
            unitPrice: "15000",
            lineNetAmount: "15000",
            vatRatePercent: "27",
          },
        ],
        suggestedVatRatePercent: "27",
      },
    });
    const { service, getSavedParsedData } = buildService({ row, refreshedRow });

    const detail = await service.detail("nav-invoice-1");

    assert.equal(detail.status, "DATA_FETCHED");
    assert.equal(detail.lines.length, 1);
    assert.equal(detail.lines[0]?.description, "Akvárium szűrő");
    assert.equal(detail.suggestedVatRatePercent, "27");
    assert.ok(getSavedParsedData(), "parsedData mentésre került");
  });

  it("returns the cached detail without calling the NAV client when already DATA_FETCHED", async () => {
    const row = baseRow({
      status: "DATA_FETCHED",
      parsedData: {
        supplierName: "Akvarisztika Kft.",
        currency: "HUF",
        lines: [],
      },
    });
    let queryInvoiceDataCalled = false;
    const { service } = buildService({
      row,
      queryInvoiceData: async () => {
        queryInvoiceDataCalled = true;
        return { invoiceDataBase64: "", compressed: false };
      },
    });

    const detail = await service.detail("nav-invoice-1");
    assert.equal(detail.status, "DATA_FETCHED");
    assert.equal(queryInvoiceDataCalled, false);
  });

  it("marks the row as ERROR when queryInvoiceData fails", async () => {
    const row = baseRow({ status: "NEW" });
    const { service, getMarkedErrorCode } = buildService({
      row,
      queryInvoiceData: async () => {
        throw new Error("boom");
      },
    });

    await assert.rejects(() => service.detail("nav-invoice-1"));
    assert.equal(getMarkedErrorCode(), "NAV_INVOICE_DATA_FETCH_FAILED");
  });

  it("decodes gzip-compressed invoice data", async () => {
    const row = baseRow({ status: "ERROR" });
    const refreshedRow = baseRow({
      status: "DATA_FETCHED",
      parsedData: {
        supplierName: "Akvarisztika Kft.",
        currency: "HUF",
        lines: [
          {
            lineNumber: 1,
            description: "Akvárium szűrő",
            quantity: "1",
            unit: "db",
            lineNetAmount: "15000",
          },
        ],
      },
    });
    const { service } = buildService({
      row,
      refreshedRow,
      queryInvoiceData: async () => ({
        invoiceDataBase64: gzipSync(
          Buffer.from(sampleInvoiceXml(), "utf8"),
        ).toString("base64"),
        compressed: true,
      }),
    });

    const detail = await service.detail("nav-invoice-1");
    assert.equal(detail.lines.length, 1);
  });
});

describe("NavIncomingInvoiceService.sync", () => {
  it("paginates the digest until the last available page and applies the result", async () => {
    const { service, getAppliedItems } = buildService({
      row: baseRow(),
      queryInvoiceDigest: async (page: number) => ({
        currentPage: page,
        availablePage: 2,
        items:
          page === 1
            ? [
                {
                  invoiceNumber: "SZLA-1",
                  invoiceOperation: "CREATE",
                  invoiceIssueDate: "2026-07-24",
                  insDate: "2026-07-24T10:00:00.000Z",
                  supplierTaxNumber: "87654321",
                },
              ]
            : [
                {
                  invoiceNumber: "SZLA-2",
                  invoiceOperation: "CREATE",
                  invoiceIssueDate: "2026-07-24",
                  insDate: "2026-07-24T11:00:00.000Z",
                  supplierTaxNumber: "87654321",
                },
              ],
      }),
    });

    const result = await service.sync(new Date("2026-07-24T12:00:00.000Z"));
    assert.equal(result.createdCount, 2);
    assert.equal(getAppliedItems()?.length, 2);
  });

  it("marks the run as failed when the digest download throws", async () => {
    const { service, wasCreateRunCalled, wasMarkFailedCalled } = buildService({
      row: baseRow(),
      queryInvoiceDigest: async () => {
        throw new Error("NETWORK_FAILED");
      },
    });

    await assert.rejects(() => service.sync(new Date()));
    assert.equal(wasCreateRunCalled(), true);
    assert.equal(wasMarkFailedCalled(), true);
  });
});
