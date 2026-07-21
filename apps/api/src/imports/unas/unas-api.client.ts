import { BadGatewayException, Injectable } from "@nestjs/common";
import type { UnasApiCategory, UnasApiProduct } from "@acropora/types";
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
