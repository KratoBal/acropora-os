import { Injectable, Logger } from "@nestjs/common";
import type {
  NavTaxpayerAddress,
  NavTaxpayerLookupResult,
} from "@acropora/types";

import {
  buildEnvelopeXml,
  child,
  children,
  errorMessageFromResponse,
  escapeXml,
  NavApiError,
  parseXml,
  value,
  type NavSoftwareData,
  type NavTechnicalUser,
  type XmlNode,
} from "./nav-xml.util.js";

export {
  NavApiError,
  type NavApiErrorCode,
  type NavSoftwareData,
  type NavTechnicalUser,
} from "./nav-xml.util.js";

// Prod by default, same convention as UnasApiClient's DEFAULT_API_BASE_URL;
// override with NAV_API_URL to point at the test system
// (https://api-test.onlineszamla.nav.gov.hu/invoiceService/v3) while the
// technical user is only registered there.
const DEFAULT_API_BASE_URL =
  "https://api.onlineszamla.nav.gov.hu/invoiceService/v3";

function addressFromNode(node: XmlNode | undefined): NavTaxpayerAddress | null {
  if (!node) return null;
  const postalCode = value(node, "postalCode");
  const city = value(node, "city");
  if (!postalCode || !city) return null;
  const streetName = value(node, "streetName");
  const publicPlaceCategory = value(node, "publicPlaceCategory");
  const houseNumber = value(node, "number");
  const line1 =
    [streetName, publicPlaceCategory, houseNumber].filter(Boolean).join(" ") ||
    city;
  return {
    postalCode,
    city,
    line1,
    country: value(node, "countryCode") ?? "HU",
  };
}

function buildQueryTaxpayerXml(
  targetTaxNumber: string,
  user: NavTechnicalUser,
  software: NavSoftwareData,
  now: Date,
): string {
  const body = `<taxNumber>${escapeXml(targetTaxNumber)}</taxNumber>`;
  return buildEnvelopeXml("QueryTaxpayerRequest", body, user, software, now);
}

function parseQueryTaxpayerResponse(xml: string): NavTaxpayerLookupResult {
  const root = parseXml(xml);
  if (
    root.name === "GeneralExceptionResponse" ||
    root.name === "GeneralErrorResponse"
  )
    throw new NavApiError("API_REJECTED", errorMessageFromResponse(root));
  if (root.name !== "QueryTaxpayerResponse")
    throw new NavApiError("RESPONSE_SHAPE_INVALID");

  const result = child(root, "result");
  const funcCode = result ? value(result, "funcCode") : undefined;
  if (funcCode && funcCode !== "OK") {
    const message = value(result, "message") ?? value(result, "errorCode");
    throw new NavApiError("API_REJECTED", message);
  }

  const validity = value(root, "taxpayerValidity");
  if (validity !== "true") return { valid: false, data: null };

  const taxpayerData = child(root, "taxpayerData");
  if (!taxpayerData) return { valid: true, data: null };

  const name = value(taxpayerData, "taxpayerName") ?? "";
  const detail = child(taxpayerData, "taxNumberDetail");
  const taxpayerId = detail ? value(detail, "taxpayerId") : undefined;
  const vatCode = detail ? value(detail, "vatCode") : undefined;
  const countyCode = detail ? value(detail, "countyCode") : undefined;
  const taxNumber =
    taxpayerId && vatCode && countyCode
      ? `${taxpayerId}-${vatCode}-${countyCode}`
      : (taxpayerId ?? "");

  const addressList = child(taxpayerData, "taxpayerAddressList");
  const items = children(addressList, "taxpayerAddressItem");
  const headquarters =
    items.find((item) => value(item, "taxpayerAddressType") === "HQ") ??
    items[0];
  const address = headquarters
    ? addressFromNode(child(headquarters, "taxpayerAddress"))
    : null;

  return { valid: true, data: { name, taxNumber, address } };
}

export type NavInvoiceDirection = "OUTBOUND" | "INBOUND";
export type NavInvoiceOperation = "CREATE" | "MODIFY" | "STORNO";

export interface NavInvoiceDigestItem {
  invoiceNumber: string;
  invoiceOperation: NavInvoiceOperation;
  invoiceIssueDate: string;
  invoiceDeliveryDate?: string;
  paymentDate?: string;
  supplierTaxNumber?: string;
  supplierName?: string;
  currency?: string;
  invoiceNetAmount?: string;
  invoiceVatAmount?: string;
  insDate: string;
}

export interface NavInvoiceDigestResult {
  currentPage: number;
  availablePage: number;
  items: NavInvoiceDigestItem[];
}

export interface NavInvoiceDataResult {
  /** Nincs, ha az adott számlaszámhoz nem talált adatot a NAV (pl. törölt tranzakció). */
  invoiceDataBase64?: string;
  compressed: boolean;
}

function buildQueryInvoiceDigestXml(
  page: number,
  direction: NavInvoiceDirection,
  insDateFrom: Date,
  insDateTo: Date,
  user: NavTechnicalUser,
  software: NavSoftwareData,
  now: Date,
): string {
  const body =
    `<page>${page}</page>` +
    `<invoiceDirection>${direction}</invoiceDirection>` +
    `<invoiceQueryParams>` +
    `<mandatoryQueryParams>` +
    `<insDate>` +
    `<dateTimeFrom>${insDateFrom.toISOString()}</dateTimeFrom>` +
    `<dateTimeTo>${insDateTo.toISOString()}</dateTimeTo>` +
    `</insDate>` +
    `</mandatoryQueryParams>` +
    `</invoiceQueryParams>`;
  return buildEnvelopeXml(
    "QueryInvoiceDigestRequest",
    body,
    user,
    software,
    now,
  );
}

export function parseQueryInvoiceDigestResponse(
  xml: string,
): NavInvoiceDigestResult {
  const root = parseXml(xml);
  if (
    root.name === "GeneralExceptionResponse" ||
    root.name === "GeneralErrorResponse"
  )
    throw new NavApiError("API_REJECTED", errorMessageFromResponse(root));
  if (root.name !== "QueryInvoiceDigestResponse")
    throw new NavApiError("RESPONSE_SHAPE_INVALID");

  const result = child(root, "result");
  const funcCode = result ? value(result, "funcCode") : undefined;
  if (funcCode && funcCode !== "OK") {
    const message = value(result, "message") ?? value(result, "errorCode");
    throw new NavApiError("API_REJECTED", message);
  }

  const digestResult = child(root, "invoiceDigestResult");
  const currentPage = Number(value(digestResult, "currentPage") ?? "1");
  const availablePage = Number(value(digestResult, "availablePage") ?? "1");
  const items = children(digestResult, "invoiceDigest")
    .map((node): NavInvoiceDigestItem | null => {
      const invoiceNumber = value(node, "invoiceNumber");
      const invoiceIssueDate = value(node, "invoiceIssueDate");
      const insDate = value(node, "insDate");
      // Ezek nélkül a mező nélkül a digest-tétel nem használható - inkább
      // kihagyjuk, mint hogy hiányos rekordot mentsünk el.
      if (!invoiceNumber || !invoiceIssueDate || !insDate) return null;
      return {
        invoiceNumber,
        invoiceOperation:
          (value(node, "invoiceOperation") as
            NavInvoiceOperation | undefined) ?? "CREATE",
        invoiceIssueDate,
        invoiceDeliveryDate: value(node, "invoiceDeliveryDate"),
        paymentDate: value(node, "paymentDate"),
        supplierTaxNumber: value(node, "supplierTaxNumber"),
        supplierName: value(node, "supplierName"),
        currency: value(node, "currency"),
        invoiceNetAmount: value(node, "invoiceNetAmount"),
        invoiceVatAmount: value(node, "invoiceVatAmount"),
        insDate,
      };
    })
    .filter((item): item is NavInvoiceDigestItem => item !== null);

  return { currentPage, availablePage, items };
}

function buildQueryInvoiceDataXml(
  invoiceNumber: string,
  direction: NavInvoiceDirection,
  supplierTaxNumber: string | undefined,
  user: NavTechnicalUser,
  software: NavSoftwareData,
  now: Date,
): string {
  // A supplierTaxNumber INBOUND irányú lekérdezésnél kötelező (a NAV
  // specifikáció szerint egy számlaszám önmagában nem egyértelmű vevői
  // oldalról, több beszállító is kiállíthatott azonos sorszámú számlát).
  const body =
    `<invoiceNumberQuery>` +
    `<invoiceNumber>${escapeXml(invoiceNumber)}</invoiceNumber>` +
    `<invoiceDirection>${direction}</invoiceDirection>` +
    (direction === "INBOUND" && supplierTaxNumber
      ? `<supplierTaxNumber>${escapeXml(supplierTaxNumber)}</supplierTaxNumber>`
      : "") +
    `</invoiceNumberQuery>`;
  return buildEnvelopeXml("QueryInvoiceDataRequest", body, user, software, now);
}

export function parseQueryInvoiceDataResponse(
  xml: string,
): NavInvoiceDataResult {
  const root = parseXml(xml);
  if (
    root.name === "GeneralExceptionResponse" ||
    root.name === "GeneralErrorResponse"
  )
    throw new NavApiError("API_REJECTED", errorMessageFromResponse(root));
  if (root.name !== "QueryInvoiceDataResponse")
    throw new NavApiError("RESPONSE_SHAPE_INVALID");

  const result = child(root, "result");
  const funcCode = result ? value(result, "funcCode") : undefined;
  if (funcCode && funcCode !== "OK") {
    const message = value(result, "message") ?? value(result, "errorCode");
    throw new NavApiError("API_REJECTED", message);
  }

  const dataResult = child(root, "invoiceDataResult");
  const invoiceDataBase64 = value(dataResult, "invoiceData");
  const compressed = value(dataResult, "compressedContentIndicator") === "true";
  return { invoiceDataBase64, compressed };
}

@Injectable()
export class NavOnlineInvoiceClient {
  private readonly logger = new Logger(NavOnlineInvoiceClient.name);

  async queryTaxpayer(
    targetTaxNumber: string,
    user: NavTechnicalUser,
    software: NavSoftwareData,
  ): Promise<NavTaxpayerLookupResult> {
    return this.call(
      "/queryTaxpayer",
      buildQueryTaxpayerXml(targetTaxNumber, user, software, new Date()),
      parseQueryTaxpayerResponse,
    );
  }

  async queryInvoiceDigest(
    page: number,
    direction: NavInvoiceDirection,
    insDateFrom: Date,
    insDateTo: Date,
    user: NavTechnicalUser,
    software: NavSoftwareData,
  ): Promise<NavInvoiceDigestResult> {
    return this.call(
      "/queryInvoiceDigest",
      buildQueryInvoiceDigestXml(
        page,
        direction,
        insDateFrom,
        insDateTo,
        user,
        software,
        new Date(),
      ),
      parseQueryInvoiceDigestResponse,
    );
  }

  async queryInvoiceData(
    invoiceNumber: string,
    direction: NavInvoiceDirection,
    supplierTaxNumber: string | undefined,
    user: NavTechnicalUser,
    software: NavSoftwareData,
  ): Promise<NavInvoiceDataResult> {
    return this.call(
      "/queryInvoiceData",
      buildQueryInvoiceDataXml(
        invoiceNumber,
        direction,
        supplierTaxNumber,
        user,
        software,
        new Date(),
      ),
      parseQueryInvoiceDataResponse,
    );
  }

  private async call<T>(
    path: string,
    body: string,
    parse: (xml: string) => T,
  ): Promise<T> {
    const baseUrl = (process.env.NAV_API_URL ?? DEFAULT_API_BASE_URL).replace(
      /\/$/,
      "",
    );
    let responseText: string;
    let status: number;
    try {
      const response = await this.request(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/xml; charset=utf-8" },
        body,
        signal: AbortSignal.timeout(20_000),
      });
      status = response.status;
      responseText = await response.text();
    } catch (error) {
      throw new NavApiError(
        error instanceof Error &&
          (error.name === "TimeoutError" || error.name === "AbortError")
          ? "TIMEOUT"
          : "NETWORK_FAILED",
      );
    }
    try {
      return parse(responseText);
    } catch (error) {
      // Full raw NAV response only ever goes to the server log (never to the
      // HTTP error surfaced to the browser) - it can contain the technical
      // user's own tax number and other operational detail, but is the only
      // way to see the exact reason NAV rejected a request (bad signature,
      // wrong login, unregistered technical user, etc.).
      this.logger.warn(
        `NAV ${path} rejected (HTTP ${status}): ${responseText}`,
      );
      if (error instanceof NavApiError && error.code === "API_REJECTED")
        throw error;
      if (status >= 200 && status < 300) throw error;
      if (status === 401 || status === 403)
        throw new NavApiError("AUTH_REJECTED");
      if (status >= 400 && status < 500) throw new NavApiError("HTTP_4XX");
      if (status >= 500) throw new NavApiError("HTTP_5XX");
      throw new NavApiError("HTTP_OTHER");
    }
  }

  protected request(input: string, init: RequestInit) {
    return fetch(input, init);
  }
}
