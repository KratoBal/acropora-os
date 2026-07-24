import { BadGatewayException } from "@nestjs/common";
import { randomBytes, createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { SaxesParser } from "saxes";

// Közös alacsony szintű segédfüggvények a NAV Online Számla v3 API-hoz -
// a queryTaxpayer, queryInvoiceDigest és queryInvoiceData operációk
// mindegyike ugyanazt a header/user/software XML borítékot és aláírás-
// számítást használja (lásd nav-online-invoice.client.ts), csak a törzs
// (a konkrét operáció paraméterei) tér el.

export const MAX_XML_BYTES = 2 * 1024 * 1024;
export const REQUEST_VERSION = "3.0";
export const HEADER_VERSION = "1.0";
export const API_NS = "http://schemas.nav.gov.hu/OSA/3.0/api";
export const COMMON_NS = "http://schemas.nav.gov.hu/NTCA/1.0/common";

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
  | "RESPONSE_SHAPE_INVALID"
  | "GZIP_INVALID";

export class NavApiError extends BadGatewayException {
  constructor(
    readonly code: NavApiErrorCode,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "NavApiError";
  }
}

export interface XmlNode {
  name: string;
  text: string;
  children: XmlNode[];
}

export const child = (node: XmlNode | undefined, name: string) =>
  node?.children.find((item) => item.name === name);
export const children = (node: XmlNode | undefined, name: string) =>
  node?.children.filter((item) => item.name === name) ?? [];
export const value = (node: XmlNode | undefined, name: string) =>
  child(node, name)?.text.trim();

export function escapeXml(input: string): string {
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
export function stripNamespacePrefixes(xml: string): string {
  return xml.replace(/<\/?ns\d+:/g, (match) =>
    match.startsWith("</") ? "</" : "<",
  );
}

export function parseXml(xml: string): XmlNode {
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

/// A számla-adat (invoiceData) base64+opcionális gzip dekódolása a
/// queryInvoiceData válaszból - lásd a NAV dokumentáció 1.6.5 fejezetét
/// (Tömörítés és méretkorlát). A hivatalos nav-online-invoice referencia-
/// kliensek (PHP, lásd InvoiceOperations::convertToXml) ugyanezt a
/// base64_decode + gzdecode sorrendet követik.
export function decodeInvoiceDataXml(
  base64Data: string,
  compressed: boolean,
): XmlNode {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64Data, "base64");
    if (compressed) bytes = gunzipSync(bytes);
  } catch {
    throw new NavApiError("GZIP_INVALID");
  }
  return parseXml(bytes.toString("utf8"));
}

export function requestId(): string {
  // NAV requires a unique string, max 30 chars, [+a-zA-Z0-9_] - "RID" prefix
  // plus 18 hex chars comfortably fits and is unique per request.
  return `RID${randomBytes(9).toString("hex")}`;
}

/// yyyyMMddHHmmss, UTC, no separators - the exact format NAV's
/// requestSignature expects (distinct from the header's full ISO timestamp).
export function compactTimestamp(date: Date): string {
  return date.toISOString().split(".")[0]!.replace(/[-:T]/g, "");
}

export function requestSignature(
  id: string,
  timestamp: string,
  signKey: string,
): string {
  return createHash("sha3-512")
    .update(`${id}${timestamp}${signKey}`)
    .digest("hex")
    .toUpperCase();
}

export function passwordHash(password: string): string {
  return createHash("sha512").update(password).digest("hex").toUpperCase();
}

/// Közös header+user+software XML boríték felépítése - minden lekérdező
/// operáció (queryTaxpayer, queryInvoiceDigest, queryInvoiceData) azonos
/// szerkezetű borítékot használ, csak a rootName és a törzs tér el.
export function buildEnvelopeXml(
  rootName: string,
  bodyXml: string,
  user: NavTechnicalUser,
  software: NavSoftwareData,
  now: Date,
): string {
  const id = requestId();
  const timestamp = now.toISOString();
  const signature = requestSignature(id, compactTimestamp(now), user.signKey);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<${rootName} xmlns:common="${COMMON_NS}" xmlns="${API_NS}">` +
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
    bodyXml +
    `</${rootName}>`
  );
}

/// GeneralExceptionResponse mezői közvetlenül a gyökéren vannak
/// (funcCode/errorCode/message), GeneralErrorResponse esetén viszont
/// beágyazva egy <result> alá, plusz nulla vagy több
/// <technicalValidationMessages> testvérelem hordozza a tényleges okot
/// (pl. rossz requestSignature, ismeretlen login). A NAV-connector
/// referenciakliens ugyanígy kezeli a két választ eltérő szerkezetűként.
export function errorMessageFromResponse(root: XmlNode): string {
  if (root.name === "GeneralExceptionResponse")
    return value(root, "message") ?? value(root, "errorCode") ?? root.name;
  const result = child(root, "result");
  const resultMessage = result ? value(result, "message") : undefined;
  const resultErrorCode = result ? value(result, "errorCode") : undefined;
  const technicalDetails = children(root, "technicalValidationMessages")
    .map((node) => value(node, "message") ?? value(node, "validationErrorCode"))
    .filter((item): item is string => Boolean(item));
  const parts = [resultMessage ?? resultErrorCode, ...technicalDetails].filter(
    (item): item is string => Boolean(item),
  );
  return parts.length > 0 ? parts.join(" | ") : root.name;
}
