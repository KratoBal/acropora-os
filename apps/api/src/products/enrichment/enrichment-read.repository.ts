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

export interface EnrichmentReader {
  latestCheck(productId: string): Promise<LatestCheck | null>;
  /** The latest finished check of every product that has one. */
  latestCheckIds(): Promise<string[]>;
  queueCounts(
    checkIds: readonly string[],
  ): Promise<{ status: string; tier: string; count: number }[]>;
  queueRows(
    checkIds: readonly string[],
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
      select: {
        checkedAt: true,
        sourceCount: true,
        fieldCount: true,
        fields: { orderBy: { field: "asc" } },
      },
    });
    return check;
  }

  async latestCheckIds(): Promise<string[]> {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT ON (c."productId") c.id
      FROM "ProductEnrichmentRunProduct" c
      JOIN "ProductEnrichmentRun" r ON r.id = c."runId"
      WHERE r.status IN ('COMPLETED', 'LIMIT_REACHED')
      ORDER BY c."productId", c."checkedAt" DESC`;
    return rows.map((row) => row.id);
  }

  async queueCounts(checkIds: readonly string[]) {
    if (checkIds.length === 0) return [];
    const groups = await prisma.productEnrichmentFieldResult.groupBy({
      by: ["status", "tier"],
      where: { checkId: { in: [...checkIds] } },
      _count: { _all: true },
    });
    return groups.map((group) => ({
      status: group.status,
      tier: group.tier,
      count: group._count._all,
    }));
  }

  async queueRows(
    checkIds: readonly string[],
    filter: ProductQualityQueueFilter,
    after: string | null,
    take: number,
  ): Promise<QueueRowRecord[]> {
    if (checkIds.length === 0) return [];
    const rows = await prisma.productEnrichmentFieldResult.findMany({
      where: {
        checkId: { in: [...checkIds] },
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
