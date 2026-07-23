import { BadGatewayException, Injectable } from "@nestjs/common";
import type {
  UnasApiCategory,
  UnasApiCustomer,
  UnasApiCustomerAddress,
  UnasApiOrder,
  UnasApiProduct,
} from "@acropora/types";
import { SaxesParser } from "saxes";

const DEFAULT_API_BASE_URL = "https://api.unas.eu/shop";
const MAX_XML_BYTES = 10 * 1024 * 1024;
const MAX_HTTP_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 10_000;
const RETRYABLE_HTTP_STATUSES = new Set([429, 502, 503, 504]);

interface XmlNode {
  name: string;
  text: string;
  children: XmlNode[];
}

export interface UnasProductPageRequest {
  timeStart?: number;
  timeEnd?: number;
  limitStart: number;
  limitNum: number;
  state?: "live" | "deleted";
  contentType?: "minimal" | "short" | "normal" | "full";
}

export interface UnasCategoryPageRequest {
  timeStart?: number;
  timeEnd?: number;
  limitStart: number;
  limitNum: number;
  contentType?: "minimal" | "normal" | "full";
}

export interface UnasGetOrderRequest {
  /** Only orders whose last status/content change is at or after this unix timestamp. Omit for a first, full pull. */
  timeModStart?: number;
  timeModEnd?: number;
  limitStart: number;
  /** Max 500 per UNAS's own documented cap. */
  limitNum: number;
}

export interface UnasGetCustomerRequest {
  /** Only customers last modified at or after this unix timestamp. Omit for a first, full pull. */
  modTimeStart?: number;
  modTimeEnd?: number;
  limitStart: number;
  limitNum: number;
}

export interface UnasSetStockRequest {
  sku: string;
  /** Absolute quantity to set (UNAS "modify" action, not a delta). */
  qty: string;
  comment?: string;
}

export interface UnasSetStockResult {
  externalId: string | null;
  sku: string;
}

export interface UnasLoginResult {
  token: string;
  expireTime: number;
  permissions?: readonly string[] | null;
}

export type UnasApiErrorCode =
  | "AUTH_REJECTED"
  | "RATE_LIMITED"
  | "HTTP_4XX"
  | "HTTP_5XX"
  | "HTTP_OTHER"
  | "NETWORK_FAILED"
  | "TIMEOUT"
  | "API_REJECTED"
  | "XML_INVALID"
  | "XML_TOO_LARGE"
  | "XML_FORBIDDEN"
  | "RESPONSE_SHAPE_INVALID"
  | "FIELD_FORMAT_INVALID"
  | "REQUEST_INVALID";

export class UnasApiError extends BadGatewayException {
  constructor(readonly code: UnasApiErrorCode) {
    super(code);
    this.name = "UnasApiError";
  }
}

const child = (node: XmlNode, name: string) =>
  node.children.find((item) => item.name === name);
const children = (node: XmlNode | undefined, name: string) =>
  node?.children.filter((item) => item.name === name) ?? [];
const value = (node: XmlNode, name: string) => child(node, name)?.text.trim();
const nestedValue = (node: XmlNode, parent: string, name: string) => {
  const parentNode = child(node, parent);
  return parentNode ? value(parentNode, name) : undefined;
};

function escapeXml(valueToEscape: string | number): string {
  return String(valueToEscape)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function paramsXml(params: Record<string, string | number | undefined>) {
  const body = Object.entries(params)
    .filter(
      (entry): entry is [string, string | number] => entry[1] !== undefined,
    )
    .map(([key, item]) => `<${key}>${escapeXml(item)}</${key}>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><Params>${body}</Params>`;
}

export function unasRetryDelayMs(
  attempt: number,
  retryAfter: string | null,
  random = Math.random,
): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0)
      return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay) && dateDelay > 0)
      return Math.min(dateDelay, MAX_RETRY_DELAY_MS);
  }
  const exponential = Math.min(500 * 2 ** (attempt - 1), 5_000);
  return Math.round(exponential * (0.75 + random() * 0.5));
}

function parseXml(xml: string): XmlNode {
  if (Buffer.byteLength(xml, "utf8") > MAX_XML_BYTES)
    throw new UnasApiError("XML_TOO_LARGE");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new UnasApiError("XML_FORBIDDEN");

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
  parser.on("cdata", (text) => {
    const current = stack.at(-1);
    if (current) current.text += text;
  });
  parser.on("closetag", () => {
    stack.pop();
  });
  try {
    parser.write(xml).close();
  } catch {
    throw new UnasApiError("XML_INVALID");
  }
  if (roots.length !== 1) throw new UnasApiError("XML_INVALID");
  return roots[0]!;
}

function parsePermissions(root: XmlNode): readonly string[] | null {
  const permissions = child(root, "Permissions");
  if (!permissions) return null;
  if (permissions.text.trim().length > 0) return null;
  if (permissions.children.some((item) => item.name !== "Permission"))
    return null;
  const values = permissions.children.map((item) => item.text.trim());
  return values.some((item) => item.length === 0) ? null : values;
}

function hasUnasErrorRoot(xml: string): boolean {
  try {
    return parseXml(xml).name === "Error";
  } catch {
    return false;
  }
}

function classifyHttpFailure(status: number, responseBody: string) {
  if (status === 401 || status === 403)
    return new UnasApiError("AUTH_REJECTED");
  if (status === 429) return new UnasApiError("RATE_LIMITED");
  if (hasUnasErrorRoot(responseBody)) return new UnasApiError("API_REJECTED");
  if (status >= 400 && status < 500) return new UnasApiError("HTTP_4XX");
  if (status >= 500 && status < 600) return new UnasApiError("HTTP_5XX");
  return new UnasApiError("HTTP_OTHER");
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

function nodePayload(node: XmlNode): unknown {
  if (!node.children.length) return node.text.trim();
  const result: Record<string, unknown> = {};
  for (const item of node.children) {
    const mapped = nodePayload(item);
    const existing = result[item.name];
    result[item.name] =
      existing === undefined
        ? mapped
        : Array.isArray(existing)
          ? [...existing, mapped]
          : [existing, mapped];
  }
  return result;
}

function unixTimestamp(valueToParse: string | undefined): string | null {
  if (!valueToParse) return null;
  const seconds = Number(valueToParse);
  if (!Number.isSafeInteger(seconds) || seconds < 0)
    throw new UnasApiError("FIELD_FORMAT_INVALID");
  return new Date(seconds * 1000).toISOString();
}

function decimal(valueToParse: string | undefined): string | null {
  if (!valueToParse) return null;
  const normalized = valueToParse.trim().replace(",", ".");
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized))
    throw new UnasApiError("FIELD_FORMAT_INVALID");
  return normalized;
}

function vatRate(valueToParse: string | undefined): string | null {
  if (!valueToParse) return null;
  const trimmed = valueToParse.trim();
  return decimal(trimmed.endsWith("%") ? trimmed.slice(0, -1).trim() : trimmed);
}

function flag(valueToParse: string | undefined): boolean | null {
  if (valueToParse === undefined || valueToParse === "") return null;
  if (["1", "yes", "true", "on"].includes(valueToParse.toLowerCase()))
    return true;
  if (["0", "no", "false", "off"].includes(valueToParse.toLowerCase()))
    return false;
  throw new UnasApiError("FIELD_FORMAT_INVALID");
}

function unasDate(valueToParse: string | undefined): string | null {
  if (!valueToParse) return null;
  const match = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(valueToParse);
  if (!match) throw new UnasApiError("FIELD_FORMAT_INVALID");
  return `${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`;
}

// UNAS's order data-structure docs don't specify a concrete format for the
// response's Date/DateMod fields (unlike the getOrder request filters, whose
// formats are documented explicitly). Rather than throwing and failing an
// entire sync batch over one unrecognized order timestamp, this parses
// best-effort and returns null on anything it can't confidently read - the
// order-sync's own windowEnd (not this field) is what advances the cursor,
// so a null orderedAt only affects display, never correctness.
function looseOrderDateTime(valueToParse: string | undefined): string | null {
  if (!valueToParse) return null;
  const trimmed = valueToParse.trim();
  const dotted =
    /^(\d{4})\.(\d{2})\.(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?$/.exec(trimmed);
  const iso = dotted
    ? `${dotted[1]}-${dotted[2]}-${dotted[3]}T${dotted[4] ?? "00"}:${
        dotted[5] ?? "00"
      }:${dotted[6] ?? "00"}.000Z`
    : trimmed;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function baseStatus(product: XmlNode): string | null {
  const statuses = child(product, "Statuses");
  if (!statuses) return null;
  const status = statuses.children.find(
    (item) => item.name === "Status" && value(item, "Type") === "base",
  );
  return status ? (value(status, "Value") ?? null) : null;
}

function price(product: XmlNode, type: "normal" | "sale") {
  const prices = child(product, "Prices");
  return children(prices, "Price").find((item) => value(item, "Type") === type);
}

function parameterRows(product: XmlNode) {
  return children(child(product, "Params"), "Param").map((parameter) => ({
    id: value(parameter, "Id") ?? "",
    type: value(parameter, "Type") ?? null,
    name: value(parameter, "Name") ?? "",
    value: value(parameter, "Value") ?? "",
  }));
}

function parameterValue(
  parameters: ReturnType<typeof parameterRows>,
  expectedName: string,
) {
  return (
    parameters.find(
      (parameter) =>
        parameter.name.localeCompare(expectedName, "hu", {
          sensitivity: "base",
        }) === 0,
    )?.value ?? null
  );
}

export function parseUnasProductResponse(xml: string): UnasApiProduct[] {
  const root = parseXml(xml);
  if (root.name === "Error") throw new UnasApiError("API_REJECTED");
  if (root.name !== "Products")
    throw new UnasApiError("RESPONSE_SHAPE_INVALID");

  return root.children
    .filter((item) => item.name === "Product")
    .map((product) => {
      const externalId = value(product, "Id") ?? "";
      const sku = value(product, "Sku") ?? "";
      const name = value(product, "Name") ?? "";
      if (!/^\d+$/.test(externalId) || !sku)
        throw new UnasApiError("FIELD_FORMAT_INVALID");
      const normalPrice = price(product, "normal");
      const salePrice = price(product, "sale");
      const categories = children(child(product, "Categories"), "Category");
      const parameters = parameterRows(product);
      const images = children(child(product, "Images"), "Image").map(
        (image) => ({
          type:
            value(image, "Type") === "alt"
              ? ("alt" as const)
              : ("base" as const),
          id: value(image, "Id") ?? null,
          sefUrl: value(image, "SefUrl") ?? null,
          filename: value(image, "Filename") ?? null,
          alt: value(image, "Alt") ?? null,
        }),
      );
      const stocks = child(product, "Stocks");
      const stockStatus = stocks ? child(stocks, "Status") : undefined;
      const stockRows = children(stocks, "Stock");
      const baseStock =
        stockRows.find((stock) => !value(stock, "WarehouseId")) ??
        (stockRows.length === 1 ? stockRows[0] : undefined);
      const meta = child(product, "Meta");
      const description = child(product, "Description");
      const prices = child(product, "Prices");
      return {
        externalId,
        sku,
        name,
        state: value(product, "State") === "deleted" ? "deleted" : "live",
        externalStatus: baseStatus(product),
        sourceCreatedAt: unixTimestamp(value(product, "CreateTime")),
        sourceUpdatedAt: unixTimestamp(value(product, "LastModTime")),
        descriptionShort: description
          ? (value(description, "Short") ?? null)
          : null,
        descriptionLong: description
          ? (value(description, "Long") ?? null)
          : null,
        descriptionShortIsHtml: description
          ? flag(value(description, "ShortIsHtml"))
          : null,
        descriptionLongIsHtml: description
          ? flag(value(description, "LongIsHtml"))
          : null,
        unit: value(product, "Unit") ?? null,
        secondaryUnit: nestedValue(product, "AlterUnit", "Unit") ?? null,
        secondaryUnitFactor: decimal(nestedValue(product, "AlterUnit", "Qty")),
        manufacturerPartNumber: parameterValue(parameters, "Gyártói cikkszám"),
        brandName: parameterValue(parameters, "brand"),
        vatRate: prices ? vatRate(value(prices, "Vat")) : null,
        netPrice: normalPrice ? decimal(value(normalPrice, "Net")) : null,
        grossPrice: normalPrice ? decimal(value(normalPrice, "Gross")) : null,
        saleNetPrice: salePrice ? decimal(value(salePrice, "Net")) : null,
        saleGrossPrice: salePrice ? decimal(value(salePrice, "Gross")) : null,
        saleStartsAt: salePrice ? unasDate(value(salePrice, "Start")) : null,
        saleEndsAt: salePrice ? unasDate(value(salePrice, "End")) : null,
        priceDisplay: prices ? (value(prices, "Appearance") ?? null) : null,
        minimumOrderQuantity: decimal(value(product, "MinimumQty")),
        maximumOrderQuantity: decimal(value(product, "MaximumQty")),
        lowStockThreshold: decimal(value(product, "AlertQty")),
        orderQuantityStep: decimal(value(product, "UnitStep")),
        backorderAllowed: stockStatus
          ? flag(value(stockStatus, "Empty"))
          : null,
        variantStockEnabled: stockStatus
          ? flag(value(stockStatus, "Variant"))
          : null,
        reportedStock: baseStock ? decimal(value(baseStock, "Qty")) : null,
        productUrl: value(product, "Url") ?? null,
        sefUrl: value(product, "SefUrl") ?? null,
        manufacturerUrl: value(product, "ManufacturerUrl") ?? null,
        primaryCategoryExternalId: (() => {
          const baseCategory = categories.find(
            (category) => value(category, "Type") === "base",
          );
          return baseCategory ? (value(baseCategory, "Id") ?? null) : null;
        })(),
        alternativeCategoryExternalIds: categories
          .filter((category) => value(category, "Type") === "alt")
          .map((category) => value(category, "Id"))
          .filter((item): item is string => Boolean(item)),
        images,
        parameters,
        seo: {
          title: meta ? (value(meta, "Title") ?? null) : null,
          description: meta ? (value(meta, "Description") ?? null) : null,
          keywords: meta ? (value(meta, "Keywords") ?? null) : null,
          robots: meta ? (value(meta, "Robots") ?? null) : null,
        },
        rawPayload: nodePayload(product) as Record<string, unknown>,
      };
    });
}

export function buildUnasProductPageXml(request: UnasProductPageRequest) {
  if (!Number.isSafeInteger(request.limitStart) || request.limitStart < 0)
    throw new UnasApiError("REQUEST_INVALID");
  if (!Number.isSafeInteger(request.limitNum) || request.limitNum < 1)
    throw new UnasApiError("REQUEST_INVALID");
  return paramsXml({
    TimeStart: request.timeStart,
    TimeEnd: request.timeEnd,
    LimitStart: request.limitStart === 0 ? undefined : request.limitStart,
    LimitNum: request.limitNum,
    State: request.state,
    ContentType: request.contentType ?? "full",
  });
}

export function buildUnasCategoryPageXml(request: UnasCategoryPageRequest) {
  if (!Number.isSafeInteger(request.limitStart) || request.limitStart < 0)
    throw new UnasApiError("REQUEST_INVALID");
  if (!Number.isSafeInteger(request.limitNum) || request.limitNum < 1)
    throw new UnasApiError("REQUEST_INVALID");
  return paramsXml({
    TimeStart: request.timeStart,
    TimeEnd: request.timeEnd,
    LimitStart: request.limitStart === 0 ? undefined : request.limitStart,
    LimitNum: request.limitNum,
    ContentType: request.contentType ?? "normal",
  });
}

export function buildUnasGetOrderXml(request: UnasGetOrderRequest) {
  if (!Number.isSafeInteger(request.limitStart) || request.limitStart < 0)
    throw new UnasApiError("REQUEST_INVALID");
  if (
    !Number.isSafeInteger(request.limitNum) ||
    request.limitNum < 1 ||
    request.limitNum > 500
  )
    throw new UnasApiError("REQUEST_INVALID");
  return paramsXml({
    TimeModStart: request.timeModStart,
    TimeModEnd: request.timeModEnd,
    LimitStart: request.limitStart === 0 ? undefined : request.limitStart,
    LimitNum: request.limitNum,
  });
}

// NOTE: the exact response root/item element names ("Orders"/"Order") follow
// every other UNAS list endpoint's plural-root/singular-item convention
// (Products/Product, Categories/Category) - the megrendelesek-getOrder-valasz
// page wasn't fetchable at implementation time to confirm this directly, so
// this should be double-checked against a real getOrder response the first
// time this runs against live UNAS data.
export function parseUnasOrderResponse(xml: string): UnasApiOrder[] {
  const root = parseXml(xml);
  if (root.name === "Error") throw new UnasApiError("API_REJECTED");
  if (root.name !== "Orders") throw new UnasApiError("RESPONSE_SHAPE_INVALID");

  return children(root, "Order").map((order) => {
    const key = value(order, "Key");
    if (!key) throw new UnasApiError("FIELD_FORMAT_INVALID");
    const customer = child(order, "Customer");
    const contact = customer ? child(customer, "Contact") : undefined;
    const payment = child(order, "Payment");
    const shipping = child(order, "Shipping");
    const itemsNode = child(order, "Items");
    const items = children(itemsNode, "Item").map((item) => {
      const sku = value(item, "Sku");
      return {
        id: value(item, "Id") ?? "",
        sku: sku && sku.trim() ? sku.trim() : null,
        name: value(item, "Name") ?? "",
        unit: value(item, "Unit") ?? null,
        quantity: decimal(value(item, "Quantity")) ?? "0",
        priceNet: decimal(value(item, "PriceNet")),
        priceGross: decimal(value(item, "PriceGross")),
        vatRate: vatRate(value(item, "Vat")),
      };
    });
    return {
      key,
      internalKey: value(order, "InternalKey") ?? null,
      status: value(order, "Status") ?? null,
      statusType: value(order, "StatusType") ?? null,
      statusId: value(order, "StatusID") ?? null,
      orderedAt: looseOrderDateTime(value(order, "Date")),
      customerName: contact ? (value(contact, "Name") ?? null) : null,
      customerEmail: customer ? (value(customer, "Email") ?? null) : null,
      currency: value(order, "Currency") ?? null,
      sumPriceGross: decimal(value(order, "SumPriceGross")),
      paymentName: payment ? (value(payment, "Name") ?? null) : null,
      paymentType: payment ? (value(payment, "Type") ?? null) : null,
      paymentStatus: payment ? (value(payment, "Status") ?? null) : null,
      shippingName: shipping ? (value(shipping, "Name") ?? null) : null,
      items,
    };
  });
}

export function buildUnasGetCustomerXml(request: UnasGetCustomerRequest) {
  if (!Number.isSafeInteger(request.limitStart) || request.limitStart < 0)
    throw new UnasApiError("REQUEST_INVALID");
  if (!Number.isSafeInteger(request.limitNum) || request.limitNum < 1)
    throw new UnasApiError("REQUEST_INVALID");
  return paramsXml({
    ModTimeStart: request.modTimeStart,
    ModTimeEnd: request.modTimeEnd,
    LimitStart: request.limitStart === 0 ? undefined : request.limitStart,
    LimitNum: request.limitNum,
  });
}

function customerAddress(
  node: XmlNode | undefined,
): UnasApiCustomerAddress | null {
  if (!node) return null;
  const customerType = value(node, "CustomerType");
  return {
    name: value(node, "Name") ?? null,
    zip: value(node, "ZIP") ?? null,
    city: value(node, "City") ?? null,
    street: value(node, "Street") ?? null,
    country: value(node, "Country") ?? null,
    countryCode: value(node, "CountryCode") ?? null,
    taxNumber: value(node, "TaxNumber") ?? null,
    customerType:
      customerType === "private" ||
      customerType === "company" ||
      customerType === "other_customer_without_tax_number"
        ? customerType
        : null,
  };
}

// NOTE: like parseUnasOrderResponse, the exact response root/item element
// names ("Customers"/"Customer") follow every other UNAS list endpoint's
// plural-root/singular-item convention (Products/Product, Orders/Order) -
// the vasarlok-getCustomer-valasz page only links to the shared Adatszerkezet
// section without spelling out the envelope, so this should be double-checked
// against a real getCustomer response the first time it runs against live
// UNAS data.
export function parseUnasCustomerResponse(xml: string): UnasApiCustomer[] {
  const root = parseXml(xml);
  if (root.name === "Error") throw new UnasApiError("API_REJECTED");
  if (root.name !== "Customers")
    throw new UnasApiError("RESPONSE_SHAPE_INVALID");

  return children(root, "Customer").map((customer) => {
    const externalId = value(customer, "Id");
    if (!externalId || !/^\d+$/.test(externalId))
      throw new UnasApiError("FIELD_FORMAT_INVALID");
    const contact = child(customer, "Contact");
    const addresses = child(customer, "Addresses");
    const dates = child(customer, "Dates");
    return {
      externalId,
      email: value(customer, "Email") ?? null,
      contactName: contact ? (value(contact, "Name") ?? null) : null,
      contactPhone: contact ? (value(contact, "Phone") ?? null) : null,
      contactMobile: contact ? (value(contact, "Mobile") ?? null) : null,
      invoiceAddress: customerAddress(
        addresses ? child(addresses, "Invoice") : undefined,
      ),
      shippingAddress: customerAddress(
        addresses ? child(addresses, "Shipping") : undefined,
      ),
      sourceCreatedAt: dates
        ? looseOrderDateTime(value(dates, "Registration"))
        : null,
      sourceUpdatedAt: dates
        ? looseOrderDateTime(value(dates, "Modification"))
        : null,
    };
  });
}

export function buildUnasSetStockXml(request: UnasSetStockRequest) {
  if (!request.sku.trim()) throw new UnasApiError("REQUEST_INVALID");
  const stockFields = [
    `<Qty>${escapeXml(request.qty)}</Qty>`,
    request.comment !== undefined
      ? `<Comment><![CDATA[${request.comment}]]></Comment>`
      : "",
  ].join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?><Products><Product>` +
    `<Action>modify</Action>` +
    `<Sku>${escapeXml(request.sku)}</Sku>` +
    `<Stocks><Stock>${stockFields}</Stock></Stocks>` +
    `</Product></Products>`
  );
}

export function parseUnasSetStockResponse(xml: string): UnasSetStockResult {
  const root = parseXml(xml);
  if (root.name === "Error") throw new UnasApiError("API_REJECTED");
  if (root.name !== "Products")
    throw new UnasApiError("RESPONSE_SHAPE_INVALID");
  const product = child(root, "Product");
  if (!product) throw new UnasApiError("RESPONSE_SHAPE_INVALID");
  if (value(product, "Status") !== "ok") throw new UnasApiError("API_REJECTED");
  return {
    externalId: value(product, "Id") ?? null,
    sku: value(product, "Sku") ?? "",
  };
}

export function parseUnasCategoryResponse(xml: string): UnasApiCategory[] {
  const root = parseXml(xml);
  if (root.name === "Error") throw new UnasApiError("API_REJECTED");
  if (root.name !== "Categories")
    throw new UnasApiError("RESPONSE_SHAPE_INVALID");
  return children(root, "Category").map((category) => {
    const externalId = value(category, "Id") ?? "";
    if (!/^\d+$/.test(externalId))
      throw new UnasApiError("FIELD_FORMAT_INVALID");
    const parent = child(category, "Parent");
    const order = value(category, "Order");
    // UNAS represents a top-level category by sending <Parent><Id>0</Id>
    // </Parent> rather than omitting the <Parent> node entirely. "0" is not
    // a real category id (no category is ever assigned externalId "0"), so
    // it must be treated the same as a missing parent, or every top-level
    // category's children would fail to resolve their parent and the whole
    // sync would throw UNAS_CATEGORY_PARENT_NOT_FOUND.
    const parentId = parent ? (value(parent, "Id") ?? null) : null;
    return {
      externalId,
      name: value(category, "Name") ?? "",
      state: value(category, "State") === "deleted" ? "deleted" : "live",
      parentExternalId: parentId && parentId !== "0" ? parentId : null,
      sortOrder: order && /^-?\d+$/.test(order) ? Number(order) : null,
      sourceCreatedAt: unixTimestamp(value(category, "CreateTime")),
      sourceUpdatedAt: unixTimestamp(value(category, "LastModTime")),
      rawPayload: nodePayload(category) as Record<string, unknown>,
    };
  });
}

@Injectable()
export class UnasApiClient {
  async login(apiKey: string): Promise<UnasLoginResult> {
    const xml = await this.post("login", paramsXml({ ApiKey: apiKey }));
    const root = parseXml(xml);
    if (root.name === "Error") throw new UnasApiError("API_REJECTED");
    if (root.name !== "Login") throw new UnasApiError("RESPONSE_SHAPE_INVALID");
    const token = value(root, "Token");
    // The documented `ExpireTime` field is the UNIX timestamp intended for
    // programmatic use. The documented `Expire` field is a separate,
    // human-readable "Y.m.d H:i:s" string in the shop's timezone, not a
    // timestamp; real UNAS login responses always include both fields
    // together, so `Expire` is intentionally ignored here rather than
    // treated as an alternate or mutually-exclusive source for `expireTime`.
    const expireTimeRaw = value(root, "ExpireTime");
    const expireTime = Number(expireTimeRaw);
    if (
      !token ||
      expireTimeRaw === undefined ||
      !Number.isSafeInteger(expireTime)
    )
      throw new UnasApiError("RESPONSE_SHAPE_INVALID");
    return { token, expireTime, permissions: parsePermissions(root) };
  }

  async getProductPage(
    token: string,
    request: UnasProductPageRequest,
  ): Promise<UnasApiProduct[]> {
    const response = await this.post(
      "getProduct",
      buildUnasProductPageXml(request),
      token,
    );
    return parseUnasProductResponse(response);
  }

  async getCategoryPage(
    token: string,
    request: UnasCategoryPageRequest,
  ): Promise<UnasApiCategory[]> {
    const response = await this.post(
      "getCategory",
      buildUnasCategoryPageXml(request),
      token,
    );
    return parseUnasCategoryResponse(response);
  }

  async getOrderPage(
    token: string,
    request: UnasGetOrderRequest,
  ): Promise<UnasApiOrder[]> {
    const response = await this.post(
      "getOrder",
      buildUnasGetOrderXml(request),
      token,
    );
    return parseUnasOrderResponse(response);
  }

  async getCustomerPage(
    token: string,
    request: UnasGetCustomerRequest,
  ): Promise<UnasApiCustomer[]> {
    const response = await this.post(
      "getCustomer",
      buildUnasGetCustomerXml(request),
      token,
    );
    return parseUnasCustomerResponse(response);
  }

  async setStock(
    token: string,
    request: UnasSetStockRequest,
  ): Promise<UnasSetStockResult> {
    const response = await this.post(
      "setStock",
      buildUnasSetStockXml(request),
      token,
    );
    return parseUnasSetStockResponse(response);
  }

  private async post(endpoint: string, body: string, token?: string) {
    const baseUrl = (process.env.UNAS_API_URL ?? DEFAULT_API_BASE_URL).replace(
      /\/$/,
      "",
    );
    for (let attempt = 1; attempt <= MAX_HTTP_ATTEMPTS; attempt += 1) {
      try {
        const response = await this.request(`${baseUrl}/${endpoint}`, {
          method: "POST",
          headers: {
            "content-type": "application/xml; charset=utf-8",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body,
          signal: AbortSignal.timeout(30_000),
        });
        const responseBody = await response.text();
        if (response.ok) return responseBody;
        if (
          attempt === MAX_HTTP_ATTEMPTS ||
          !RETRYABLE_HTTP_STATUSES.has(response.status)
        )
          throw classifyHttpFailure(response.status, responseBody);
        await this.wait(
          unasRetryDelayMs(attempt, response.headers.get("retry-after")),
        );
      } catch (error) {
        if (error instanceof UnasApiError) throw error;
        if (attempt === MAX_HTTP_ATTEMPTS)
          throw new UnasApiError(
            isTimeoutError(error) ? "TIMEOUT" : "NETWORK_FAILED",
          );
        await this.wait(unasRetryDelayMs(attempt, null));
      }
    }
    throw new UnasApiError("NETWORK_FAILED");
  }

  protected wait(milliseconds: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  }

  protected request(input: string, init: RequestInit) {
    return fetch(input, init);
  }
}
