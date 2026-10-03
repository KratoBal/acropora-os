import { Injectable } from "@nestjs/common";
import { prisma } from "@acropora/database";
import type { ProductQualityQueueFilter } from "@acropora/types";

import type { StoredFieldRow } from "./enrichment-read.js";
import { queueFilterWhere } from "./quality-queue.js";

/** Only finished runs count: a running one may be half-written. */
const FINISHED = ["COMPLETED", "LIMIT_REACHED"] as const;

export const ENRICHMENT_READER = Symbol("ENRICHMENT_READER");

export interface LatestCheck {
  checkedAt: Date;
  sourceCount: number;
  fieldCount: number;
  fields: StoredFieldRow[];
}

export interface QueueRowRecord {
  id: string;
  field: string;
  tier: string;
  status: string;
  productId: string;
  productName: string;
  checkedAt: Date;
}

/**
 * THE LATEST RESULT PER FIELD, NOT THE LATEST CHECK.
 *
 * Until the Product Knowledge slice (#1431) every check was a crawl run that
 * stored every enriched field, so "the latest check" and "the latest result
 * of each field" were the same rows. A MANUAL evidence entry is its own
 * one-field check: read by check, it would hide every other field of the
 * product behind it. So both the review and the queue read the newest
 * finished result of each (product, field) pair; `lastRun` still describes
 * the newest check.
 */
export interface EnrichmentReader {
  latestCheck(productId: string): Promise<LatestCheck | null>;
  /** The newest finished result of every (product, field) pair. */
  latestFieldResults(): Promise<{ id: string; productId: string }[]>;
  queueCounts(
    fieldResultIds: readonly string[],
  ): Promise<{ status: string; tier: string; count: number }[]>;
  queueRows(
    fieldResultIds: readonly string[],
    filter: ProductQualityQueueFilter,
    after: string | null,
    take: number,
  ): Promise<QueueRowRecord[]>;
}

/** Reads the enrichment tables; writes nothing. */
@Injectable()
export class PrismaEnrichmentReader implements EnrichmentReader {
  async latestCheck(productId: string): Promise<LatestCheck | null> {
    const check = await prisma.productEnrichmentRunProduct.findFirst({
      where: { productId, run: { status: { in: [...FINISHED] } } },
      orderBy: { checkedAt: "desc" },
      select: { checkedAt: true, sourceCount: true, fieldCount: true },
    });
    if (!check) return null;
    const ids = await prisma.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT ON (f.field) f.id
      FROM "ProductEnrichmentFieldResult" f
      JOIN "ProductEnrichmentRunProduct" c ON c.id = f."checkId"
      JOIN "ProductEnrichmentRun" r ON r.id = c."runId"
      WHERE c."productId" = ${productId}
        AND r.status IN ('COMPLETED', 'LIMIT_REACHED')
      ORDER BY f.field, c."checkedAt" DESC, f.id DESC`;
    const fields = await prisma.productEnrichmentFieldResult.findMany({
      where: { id: { in: ids.map((row) => row.id) } },
      orderBy: { field: "asc" },
    });
    return { ...check, fields };
  }

  async latestFieldResults(): Promise<{ id: string; productId: string }[]> {
    return prisma.$queryRaw<{ id: string; productId: string }[]>`
      SELECT DISTINCT ON (c."productId", f.field) f.id, c."productId"
      FROM "ProductEnrichmentFieldResult" f
      JOIN "ProductEnrichmentRunProduct" c ON c.id = f."checkId"
      JOIN "ProductEnrichmentRun" r ON r.id = c."runId"
      WHERE r.status IN ('COMPLETED', 'LIMIT_REACHED')
      ORDER BY c."productId", f.field, c."checkedAt" DESC, f.id DESC`;
  }

  async queueCounts(fieldResultIds: readonly string[]) {
    if (fieldResultIds.length === 0) return [];
    const groups = await prisma.productEnrichmentFieldResult.groupBy({
      by: ["status", "tier"],
      where: { id: { in: [...fieldResultIds] } },
      _count: { _all: true },
    });
    return groups.map((group) => ({
      status: group.status,
      tier: group.tier,
      count: group._count._all,
    }));
  }

  async queueRows(
    fieldResultIds: readonly string[],
    filter: ProductQualityQueueFilter,
    after: string | null,
    take: number,
  ): Promise<QueueRowRecord[]> {
    if (fieldResultIds.length === 0) return [];
    const rows = await prisma.productEnrichmentFieldResult.findMany({
      where: {
        id: { in: [...fieldResultIds] },
        ...queueFilterWhere(filter),
        ...(after ? { id: { gt: after } } : {}),
      },
      orderBy: { id: "asc" },
      take,
      select: {
        id: true,
        field: true,
        tier: true,
        status: true,
        check: {
          select: {
            checkedAt: true,
            product: { select: { id: true, name: true } },
          },
        },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      field: row.field,
      tier: row.tier,
      status: row.status,
      productId: row.check.product.id,
      productName: row.check.product.name,
      checkedAt: row.check.checkedAt,
    }));
  }
}
