import { BadGatewayException, Injectable, Logger } from "@nestjs/common";
import type { NavTaxpayerAddress, NavTaxpayerLookupResult } from "@acropora/types";
import { randomBytes, createHash } from "node:crypto";
import { SaxesParser } from "saxes";

// Prod by default, same convention as UnasApiClient's DEFAULT_API_BASE_URL;
// override with NAV_API_URL to point at the test system
// (https://api-test.onlineszamla.nav.gov.hu/invoiceService/v3) while the
// technical user is only registered there.
const DEFAULT_API_BASE_URL = "https://api.onlineszamla.nav.gov.hu/invoiceService/v3";
const MAX_XML_BYTES = 2 * 1024 * 1024;
const REQUEST_VERSION = "3.0";
const HEADER_VERSION = "1.0";

export interface NavTechnicalUser {
  login: string;
  password: string;
  /** A technikai felhasználót birtokló saját cég 8 jegyű törzsszáma (nem a lekérdezett partneré). */
  taxNumber: string;
  signKey: string;
}

export interface NavSoftwareData {
  softwareId: string;
  softwareName: string;
  softwareOperation: "LOCAL_SOFTWARE" | "ONLINE_SERVICE";
  softwareMainVersion: string;
  softwareDevName: string;
  softwareDevContact: string;
  softwareDevCountryCode: string;
  softwareDevTaxNumber: string;
}

export type NavApiErrorCode =
  | "NOT_CONFIGURED"
  | "REQUEST_INVALID"
  | "AUTH_REJECTED"
  | "API_REJECTED"
  | "HTTP_4XX"
  | "HTTP_5XX"
  | "HTTP_OTHER"
  | "NETWORK_FAILED"
  | "TIMEOUT"
  | "XML_INVALID"
  | "XML_TOO_LARGE"
  | "RESPONSE_SHAPE_INVALID";

export class NavApiError extends BadGatewayException {
  constructor(
    readonly code: NavApiErrorCode,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "NavApiError";
  }
}

interface XmlNode {
  name: string;
  text: string;
  children: XmlNode[];
}

const child = (node: XmlNode | undefined, name: string) =>
  node?.children.find((item) => item.name === name);
const children = (node: XmlNode | undefined, name: string) =>
  node?.children.filter((item) => item.name === name) ?? [];
const value = (node: XmlNode | undefined, name: string) =>
  child(node, name)?.text.trim();

function escapeXml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/// A NAV válaszban a névtér-prefixek verzióról verzióre és mezőnként
/// eltérhetnek (ns2:, ns3:, ...) - a hivatalos nav-connector kliens is ezt a
/// stratégiát követi: a válasz szövegéből egyszerűen eltávolítja az "nsN:"
/// prefixeket feldolgozás előtt, így a mezők a névtértől függetlenül
/// egyszerű névvel kereshetők.
function stripNamespacePrefixes(xml: string): string {
  return xml.replace(/<\/?ns\d+:/g, (match) => (match.startsWith("</") ? "</" : "<"));
}

function parseXml(xml: string): XmlNode {
  if (Buffer.byteLength(xml, "utf8") > MAX_XML_BYTES)
    throw new NavApiError("XML_TOO_LARGE");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new NavApiError("XML_INVALID");
  const roots: XmlNode[] = [];
  const stack: XmlNode[] = [];
  const parser = new SaxesParser({ xmlns: false });
  parser.on("opentag", (tag) => {
    const node: XmlNode = { name: tag.name, text: "", children: [] };
    const parent = stack.at(-1);
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push(node);
  });
  parser.on("text", (text) => {
    const current = stack.at(-1);
    if (current) current.text += text;
  });
  parser.on("closetag", () => {
    stack.pop();
  });
  try {
    parser.write(stripNamespacePrefixes(xml)).close();
  } catch {
    throw new NavApiError("XML_INVALID");
  }
  if (roots.length !== 1) throw new NavApiError("XML_INVALID");
  return roots[0]!;
}

function requestId(): string {
  // NAV requires a unique string, max 30 chars, [+a-zA-Z0-9_] - "RID" prefix
  // plus 18 hex chars comfortably fits and is unique per request.
  return `RID${randomBytes(9).toString("hex")}`;
}

/// yyyyMMddHHmmss, UTC, no separators - the exact format NAV's
/// requestSignature expects (distinct from the header's full ISO timestamp).
function compactTimestamp(date: Date): string {
  return date.toISOString().split(".")[0]!.replace(/[-:T]/g, "");
}

function requestSignature(
  id: string,
  timestamp: string,
  signKey: string,
): string {
  return createHash("sha3-512")
    .update(`${id}${timestamp}${signKey}`)
    .digest("hex")
    .toUpperCase();
}

function passwordHash(password: string): string {
  return createHash("sha512").update(password).digest("hex").toUpperCase();
}

function buildQueryTaxpayerXml(
  targetTaxNumber: string,
  user: NavTechnicalUser,
  software: NavSoftwareData,
  now: Date,
): string {
  const id = requestId();
  const timestamp = now.toISOString();
  const signature = requestSignature(id, compactTimestamp(now), user.signKey);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<QueryTaxpayerRequest xmlns:common="http://schemas.nav.gov.hu/NTCA/1.0/common" xmlns="http://schemas.nav.gov.hu/OSA/3.0/api">` +
    `<common:header>` +
    `<common:requestId>${escapeXml(id)}</common:requestId>` +
    `<common:timestamp>${timestamp}</common:timestamp>` +
    `<common:requestVersion>${REQUEST_VERSION}</common:requestVersion>` +
    `<common:headerVersion>${HEADER_VERSION}</common:headerVersion>` +
    `</common:header>` +
    `<common:user>` +
    `<common:login>${escapeXml(user.login)}</common:login>` +
    `<common:passwordHash cryptoType="SHA-512">${passwordHash(user.password)}</common:passwordHash>` +
    `<common:taxNumber>${escapeXml(user.taxNumber)}</common:taxNumber>` +
    `<common:requestSignature cryptoType="SHA3-512">${signature}</common:requestSignature>` +
    `</common:user>` +
    `<software>` +
    `<softwareId>${escapeXml(software.softwareId)}</softwareId>` +
    `<softwareName>${escapeXml(software.softwareName)}</softwareName>` +
    `<softwareOperation>${software.softwareOperation}</softwareOperation>` +
    `<softwareMainVersion>${escapeXml(software.softwareMainVersion)}</softwareMainVersion>` +
    `<softwareDevName>${escapeXml(software.softwareDevName)}</softwareDevName>` +
    `<softwareDevContact>${escapeXml(software.softwareDevContact)}</softwareDevContact>` +
    `<softwareDevCountryCode>${escapeXml(software.softwareDevCountryCode)}</softwareDevCountryCode>` +
    `<softwareDevTaxNumber>${escapeXml(software.softwareDevTaxNumber)}</softwareDevTaxNumber>` +
    `</software>` +
    `<taxNumber>${escapeXml(targetTaxNumber)}</taxNumber>` +
    `</QueryTaxpayerRequest>`
  );
}

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

/// GeneralExceptionResponse mezői közvetlenül a gyökéren vannak
/// (funcCode/errorCode/message), GeneralErrorResponse esetén viszont
/// beágyazva egy <result> alá, plusz nulla vagy több
/// <technicalValidationMessages> testvérelem hordozza a tényleges okot
/// (pl. rossz requestSignature, ismeretlen login). A NAV-connector
/// referenciakliens ugyanígy kezeli a két választ eltérő szerkezetűként.
function errorMessageFromResponse(root: XmlNode): string {
  if (root.name === "GeneralExceptionResponse")
    return (
      value(root, "message") ?? value(root, "errorCode") ?? root.name
    );
  const result = child(root, "result");
  const resultMessage = result ? value(result, "message") : undefined;
  const resultErrorCode = result ? value(result, "errorCode") : undefined;
  const technicalDetails = children(root, "technicalValidationMessages")
    .map((node) => value(node, "message") ?? value(node, "validationErrorCode"))
    .filter((item): item is string => Boolean(item));
  const parts = [
    resultMessage ?? resultErrorCode,
    ...technicalDetails,
  ].filter((item): item is string => Boolean(item));
  return parts.length > 0 ? parts.join(" | ") : root.name;
}

function parseQueryTaxpayerResponse(xml: string): NavTaxpayerLookupResult {
  const root = parseXml(xml);
  if (root.name === "GeneralExceptionResponse" || root.name === "GeneralErrorResponse")
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
    items.find((item) => value(item, "taxpayerAddressType") === "HQ") ?? items[0];
  const address = headquarters
    ? addressFromNode(child(headquarters, "taxpayerAddress"))
    : null;

  return { valid: true, data: { name, taxNumber, address } };
}

@Injectable()
export class NavOnlineInvoiceClient {
  private readonly logger = new Logger(NavOnlineInvoiceClient.name);

  async queryTaxpayer(
    targetTaxNumber: string,
    user: NavTechnicalUser,
    software: NavSoftwareData,
  ): Promise<NavTaxpayerLookupResult> {
    const body = buildQueryTaxpayerXml(targetTaxNumber, user, software, new Date());
    const baseUrl = (process.env.NAV_API_URL ?? DEFAULT_API_BASE_URL).replace(
      /\/$/,
      "",
    );
    let responseText: string;
    let status: number;
    try {
      const response = await this.request(`${baseUrl}/queryTaxpayer`, {
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
      return parseQueryTaxpayerResponse(responseText);
    } catch (error) {
      // Full raw NAV response only ever goes to the server log (never to the
      // HTTP error surfaced to the browser) - it can contain the technical
      // user's own tax number and other operational detail, but is the only
      // way to see the exact reason NAV rejected a request (bad signature,
      // wrong login, unregistered technical user, etc.).
      this.logger.warn(`NAV queryTaxpayer rejected (HTTP ${status}): ${responseText}`);
      if (error instanceof NavApiError && error.code === "API_REJECTED") throw error;
      if (status >= 200 && status < 300) throw error;
      if (status === 401 || status === 403) throw new NavApiError("AUTH_REJECTED");
      if (status >= 400 && status < 500) throw new NavApiError("HTTP_4XX");
      if (status >= 500) throw new NavApiError("HTTP_5XX");
      throw new NavApiError("HTTP_OTHER");
    }
  }

  protected request(input: string, init: RequestInit) {
    return fetch(input, init);
  }
}
