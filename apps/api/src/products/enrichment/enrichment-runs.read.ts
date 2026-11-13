import { Injectable } from "@nestjs/common";
import { prisma } from "@acropora/database";

/**
 * THE LATEST JEV RUNS, READ ONLY (Product Knowledge, card 85c38ab1; acrobot 50407, 50416).
 *
 * The test API runs the enrichment CLI through a Coolify scheduled task, and the task's output is not readable (its
 * execution record holds a status, no stdout; acrobot measured, 2026-11-13). The run itself stores everything in the
 * database: per product every page it fetched, refused or could not reach, with the reason, and the field results. The
 * per-product review (`GET /products/:id/enrichment`) shows the fields, not the fetches, so a refused source or an AI
 * guard's reason had no reader. This is that reader: the newest runs, each product with its fetches and a field summary.
 * The evidence of a field stays on the per-product review.
 */
export const ENRICHMENT_RUNS_READER = Symbol("ENRICHMENT_RUNS_READER");

export const RUN_LIST_LIMITS = { default: 5, max: 20 } as const;

/** `?limit=`: a whole number from 1 to the maximum; anything else is the default. */
export function runListLimit(raw: unknown): number {
  const n = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 1
    ? Math.min(n, RUN_LIST_LIMITS.max)
    : RUN_LIST_LIMITS.default;
}

export interface EnrichmentRunFetchView {
  sourceKind: string;
  url: string;
  outcome: string;
  reason: string | null;
  httpStatus: number | null;
  fieldCount: number;
}

export interface EnrichmentRunFieldView {
  field: string;
  status: string;
  value: string | null;
  sourceType: string | null;
}

export interface EnrichmentRunProductView {
  productId: string;
  productName: string;
  checkedAt: string;
  sourceCount: number;
  fieldCount: number;
  errorCode: string | null;
  fetches: EnrichmentRunFetchView[];
  fields: EnrichmentRunFieldView[];
}

export interface EnrichmentRunView {
  id: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  productLimit: number;
  requestLimit: number;
  productCount: number;
  requestCount: number;
  errorCode: string | null;
  products: EnrichmentRunProductView[];
}

export interface EnrichmentRunsReader {
  recentRuns(limit: number): Promise<EnrichmentRunView[]>;
}

/** The stored row as the view: dates as ISO text, nothing else changed. */
export function toRunView(run: {
  id: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  productLimit: number;
  requestLimit: number;
  productCount: number;
  requestCount: number;
  errorCode: string | null;
  products: {
    productId: string;
    product: { name: string } | null;
    checkedAt: Date;
    sourceCount: number;
    fieldCount: number;
    errorCode: string | null;
    fetches: EnrichmentRunFetchView[];
    fields: EnrichmentRunFieldView[];
  }[];
}): EnrichmentRunView {
  return {
    id: run.id,
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    productLimit: run.productLimit,
    requestLimit: run.requestLimit,
    productCount: run.productCount,
    requestCount: run.requestCount,
    errorCode: run.errorCode,
    products: run.products.map((p) => ({
      productId: p.productId,
      productName: p.product?.name ?? "",
      checkedAt: p.checkedAt.toISOString(),
      sourceCount: p.sourceCount,
      fieldCount: p.fieldCount,
      errorCode: p.errorCode,
      fetches: p.fetches,
      fields: p.fields,
    })),
  };
}

@Injectable()
export class PrismaEnrichmentRunsReader implements EnrichmentRunsReader {
  async recentRuns(limit: number): Promise<EnrichmentRunView[]> {
    const runs = await prisma.productEnrichmentRun.findMany({
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: limit,
      select: {
        id: true,
        status: true,
        startedAt: true,
        completedAt: true,
        productLimit: true,
        requestLimit: true,
        productCount: true,
        requestCount: true,
        errorCode: true,
        products: {
          orderBy: [{ checkedAt: "asc" }, { id: "asc" }],
          select: {
            productId: true,
            product: { select: { name: true } },
            checkedAt: true,
            sourceCount: true,
            fieldCount: true,
            errorCode: true,
            fetches: {
              orderBy: [{ fetchedAt: "asc" }, { id: "asc" }],
              select: {
                sourceKind: true,
                url: true,
                outcome: true,
                reason: true,
                httpStatus: true,
                fieldCount: true,
              },
            },
            fields: {
              orderBy: [{ field: "asc" }, { id: "asc" }],
              select: {
                field: true,
                status: true,
                value: true,
                sourceType: true,
              },
            },
          },
        },
      },
    });
    return runs.map(toRunView);
  }
}
