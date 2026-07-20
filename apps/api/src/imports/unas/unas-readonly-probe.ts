import type { UnasApiCategory, UnasApiProduct } from "@acropora/types";

import {
  UnasApiError,
  type UnasApiErrorCode,
  type UnasCategoryPageRequest,
  type UnasLoginResult,
  type UnasProductPageRequest,
} from "./unas-api.client.js";

export const DEFAULT_UNAS_PROBE_PAGE_SIZE = 10;
export const MAX_UNAS_PROBE_PAGE_SIZE = 100;
export const MAX_UNAS_PROBE_PAGES = 2;

export interface UnasReadonlyProbeClient {
  login(apiKey: string): Promise<UnasLoginResult>;
  getCategoryPage(
    token: string,
    request: UnasCategoryPageRequest,
  ): Promise<UnasApiCategory[]>;
  getProductPage(
    token: string,
    request: UnasProductPageRequest,
  ): Promise<UnasApiProduct[]>;
}

export interface UnasReadonlyProbeOptions {
  pageSize: number;
  pages: number;
}

type DatasetCounts = {
  category: number;
  live: number;
  deleted: number;
};

type ProductDatasetCounts = Omit<DatasetCounts, "category">;

export interface UnasReadonlyProbeSummary {
  ok: true;
  counts: DatasetCounts;
  fieldPresence: {
    stableId: DatasetCounts;
    lastModTime: DatasetCounts;
    price: ProductDatasetCounts;
    reportedStock: ProductDatasetCounts;
    secondaryUnit: ProductDatasetCounts;
    categoryFields: ProductDatasetCounts;
  };
  sourceModifiedAt: {
    minimum: string | null;
    maximum: string | null;
  };
  durationMs: number;
}

type UnasProbeStage = "LOGIN" | "CATEGORY" | "LIVE" | "DELETED";
type UnasProbeStageReason = UnasApiErrorCode | "PERMISSION_MISSING" | "FAILED";

export type UnasProbeErrorCode =
  | "UNAS_PROBE_API_KEY_MISSING"
  | "UNAS_PROBE_INVALID_ARGUMENT"
  | `UNAS_PROBE_${UnasProbeStage}_${UnasProbeStageReason}`
  | "UNAS_PROBE_FAILED";

export class UnasProbeError extends Error {
  constructor(readonly code: UnasProbeErrorCode) {
    super(code);
    this.name = "UnasProbeError";
  }
}

const countPresent = <T>(rows: readonly T[], predicate: (row: T) => boolean) =>
  rows.reduce((count, row) => count + Number(predicate(row)), 0);

async function fetchPages<T>(
  pages: number,
  pageSize: number,
  fetchPage: (limitStart: number, limitNum: number) => Promise<T[]>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < pages; page += 1) {
    const pageRows = await fetchPage(page * pageSize, pageSize);
    rows.push(...pageRows);
    if (pageRows.length < pageSize) break;
  }
  return rows;
}

async function protectedCall<T>(
  stage: UnasProbeStage,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const reason =
      error instanceof UnasApiError ? error.code : ("FAILED" as const);
    throw new UnasProbeError(`UNAS_PROBE_${stage}_${reason}`);
  }
}

function assertPermission(
  login: UnasLoginResult,
  permission: "getCategory" | "getProduct",
  stage: "CATEGORY" | "LIVE",
) {
  if (login.permissions == null) return;
  if (!login.permissions.includes(permission))
    throw new UnasProbeError(`UNAS_PROBE_${stage}_PERMISSION_MISSING`);
}

export function parseUnasProbeOptions(
  argv: readonly string[],
): UnasReadonlyProbeOptions {
  let pageSize = DEFAULT_UNAS_PROBE_PAGE_SIZE;
  let pages = 1;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    const [flag, inlineValue] = argument.split("=", 2);
    if (flag !== "--page-size" && flag !== "--pages")
      throw new UnasProbeError("UNAS_PROBE_INVALID_ARGUMENT");
    const rawValue = inlineValue ?? argv[++index];
    if (!rawValue || !/^\d+$/.test(rawValue))
      throw new UnasProbeError("UNAS_PROBE_INVALID_ARGUMENT");
    const parsed = Number(rawValue);
    if (!Number.isSafeInteger(parsed))
      throw new UnasProbeError("UNAS_PROBE_INVALID_ARGUMENT");
    if (flag === "--page-size") pageSize = parsed;
    else pages = parsed;
  }

  if (pageSize < 1 || pageSize > MAX_UNAS_PROBE_PAGE_SIZE)
    throw new UnasProbeError("UNAS_PROBE_INVALID_ARGUMENT");
  if (pages < 1 || pages > MAX_UNAS_PROBE_PAGES)
    throw new UnasProbeError("UNAS_PROBE_INVALID_ARGUMENT");

  return { pageSize, pages };
}

export function normalizeUnasProbeError(error: unknown): UnasProbeErrorCode {
  return error instanceof UnasProbeError ? error.code : "UNAS_PROBE_FAILED";
}

export async function runUnasReadonlyProbe(
  client: UnasReadonlyProbeClient,
  options: UnasReadonlyProbeOptions,
  now: () => number = Date.now,
): Promise<UnasReadonlyProbeSummary> {
  const startedAt = now();
  const apiKey = process.env.UNAS_API_KEY?.trim();
  if (!apiKey) throw new UnasProbeError("UNAS_PROBE_API_KEY_MISSING");

  const token = await protectedCall("LOGIN", () => client.login(apiKey));
  assertPermission(token, "getCategory", "CATEGORY");
  const categories = await protectedCall("CATEGORY", () =>
    fetchPages(options.pages, options.pageSize, (limitStart, limitNum) =>
      client.getCategoryPage(token.token, {
        limitStart,
        limitNum,
        contentType: "normal",
      }),
    ),
  );
  assertPermission(token, "getProduct", "LIVE");
  const liveProducts = await protectedCall("LIVE", () =>
    fetchPages(options.pages, options.pageSize, (limitStart, limitNum) =>
      client.getProductPage(token.token, {
        limitStart,
        limitNum,
        state: "live",
        contentType: "full",
      }),
    ),
  );
  const deletedProducts = await protectedCall("DELETED", () =>
    fetchPages(options.pages, options.pageSize, (limitStart, limitNum) =>
      client.getProductPage(token.token, {
        limitStart,
        limitNum,
        state: "deleted",
        contentType: "full",
      }),
    ),
  );

  const productPresence = (
    rows: readonly UnasApiProduct[],
    predicate: (row: UnasApiProduct) => boolean,
  ) => countPresent(rows, predicate);
  const sourceModifiedTimes = [
    ...categories,
    ...liveProducts,
    ...deletedProducts,
  ]
    .map((row) => row.sourceUpdatedAt)
    .filter((value): value is string => value !== null)
    .sort();

  return {
    ok: true,
    counts: {
      category: categories.length,
      live: liveProducts.length,
      deleted: deletedProducts.length,
    },
    fieldPresence: {
      stableId: {
        category: countPresent(categories, (row) => row.externalId.length > 0),
        live: productPresence(liveProducts, (row) => row.externalId.length > 0),
        deleted: productPresence(
          deletedProducts,
          (row) => row.externalId.length > 0,
        ),
      },
      lastModTime: {
        category: countPresent(
          categories,
          (row) => row.sourceUpdatedAt !== null,
        ),
        live: productPresence(
          liveProducts,
          (row) => row.sourceUpdatedAt !== null,
        ),
        deleted: productPresence(
          deletedProducts,
          (row) => row.sourceUpdatedAt !== null,
        ),
      },
      price: {
        live: productPresence(liveProducts, hasPrice),
        deleted: productPresence(deletedProducts, hasPrice),
      },
      reportedStock: {
        live: productPresence(
          liveProducts,
          (row) => row.reportedStock !== null,
        ),
        deleted: productPresence(
          deletedProducts,
          (row) => row.reportedStock !== null,
        ),
      },
      secondaryUnit: {
        live: productPresence(liveProducts, hasSecondaryUnit),
        deleted: productPresence(deletedProducts, hasSecondaryUnit),
      },
      categoryFields: {
        live: productPresence(liveProducts, hasCategoryFields),
        deleted: productPresence(deletedProducts, hasCategoryFields),
      },
    },
    sourceModifiedAt: {
      minimum: sourceModifiedTimes[0] ?? null,
      maximum: sourceModifiedTimes.at(-1) ?? null,
    },
    durationMs: Math.max(0, now() - startedAt),
  };
}

function hasPrice(product: UnasApiProduct): boolean {
  return [
    product.netPrice,
    product.grossPrice,
    product.saleNetPrice,
    product.saleGrossPrice,
  ].some((value) => value !== null);
}

function hasSecondaryUnit(product: UnasApiProduct): boolean {
  return product.secondaryUnit !== null || product.secondaryUnitFactor !== null;
}

function hasCategoryFields(product: UnasApiProduct): boolean {
  return (
    product.primaryCategoryExternalId !== null ||
    product.alternativeCategoryExternalIds.length > 0
  );
}
