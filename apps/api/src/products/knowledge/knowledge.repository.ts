import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import type { ProductCopyBlock } from "@acropora/types";

import type { StoredCheck } from "../enrichment/enrichment-run.js";
import { factSource } from "./knowledge.policy.js";

export const KNOWLEDGE_STORE = Symbol("KNOWLEDGE_STORE");

/** One stored JEV result, with what acceptance needs to know about it. */
export interface FieldResultRecord {
  id: string;
  productId: string;
  field: string;
  status: string;
  value: string | null;
  conflicts: unknown;
  /** The run finished (COMPLETED / LIMIT_REACHED): a running one may be half-written. */
  finished: boolean;
}

export interface FactRecord {
  field: string;
  value: string | null;
  unit: string | null;
  status: string;
  revision: number;
  acceptedAt: Date;
  acceptedBy: { id: string; displayName: string };
  fieldResultId: string;
  /** Read through the pointer, never stored on the fact. */
  source: {
    sourceType: string | null;
    sourceRef: string | null;
    retrievedAt: Date | null;
  };
}

export interface CopyRecord {
  block: ProductCopyBlock;
  body: string;
  status: "DRAFT" | "APPROVED";
  revision: number;
  basedOn: unknown;
  usedFields: string[];
  updatedAt: Date;
  approvedAt: Date | null;
}

export interface KnowledgeStore {
  /** The newest finished result of one field of one product. */
  latestFieldResult(
    productId: string,
    field: string,
  ): Promise<{ id: string; evidence: unknown } | null>;
  fieldResult(id: string): Promise<FieldResultRecord | null>;
  /** Stores a manual check as one finished run; returns its field result id. */
  saveManualCheck(check: StoredCheck, enteredById: string): Promise<string>;
  facts(productId: string): Promise<FactRecord[]>;
  /** Creates the fact at revision 1, or replaces it and bumps the revision. */
  upsertFact(input: {
    productId: string;
    field: string;
    value: string | null;
    unit: string | null;
    status: string;
    fieldResultId: string;
    acceptedById: string;
    acceptedAt: Date;
  }): Promise<void>;
  copy(productId: string): Promise<CopyRecord[]>;
  /** Saves a DRAFT (a new one, or over an approved one: the approval goes). */
  saveCopy(input: {
    productId: string;
    block: ProductCopyBlock;
    body: string;
    basedOn: Record<string, number>;
    usedFields: string[];
    editedById: string;
  }): Promise<void>;
  approveCopy(input: {
    productId: string;
    block: ProductCopyBlock;
    approvedById: string;
    approvedAt: Date;
  }): Promise<void>;
}

const FINISHED = ["COMPLETED", "LIMIT_REACHED"];

/**
 * THE KNOWLEDGE TABLES AND THE ENRICHMENT TABLES, NOTHING ELSE.
 *
 * It reads the JEV results, writes manual checks into the four enrichment
 * tables (the same rows a crawl run writes) and writes the two knowledge
 * tables. There is no product, variant, UNAS or Medusa write here.
 */
@Injectable()
export class PrismaKnowledgeStore implements KnowledgeStore {
  async latestFieldResult(productId: string, field: string) {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT f.id
      FROM "ProductEnrichmentFieldResult" f
      JOIN "ProductEnrichmentRunProduct" c ON c.id = f."checkId"
      JOIN "ProductEnrichmentRun" r ON r.id = c."runId"
      WHERE c."productId" = ${productId}
        AND f.field = ${field}
        AND r.status IN ('COMPLETED', 'LIMIT_REACHED')
      ORDER BY c."checkedAt" DESC, f.id DESC
      LIMIT 1`;
    const id = rows[0]?.id;
    if (!id) return null;
    return prisma.productEnrichmentFieldResult.findUnique({
      where: { id },
      select: { id: true, evidence: true },
    });
  }

  async fieldResult(id: string): Promise<FieldResultRecord | null> {
    const row = await prisma.productEnrichmentFieldResult.findUnique({
      where: { id },
      select: {
        id: true,
        field: true,
        status: true,
        value: true,
        conflicts: true,
        check: {
          select: { productId: true, run: { select: { status: true } } },
        },
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      productId: row.check.productId,
      field: row.field,
      status: row.status,
      value: row.value,
      conflicts: row.conflicts,
      finished: FINISHED.includes(row.check.run.status),
    };
  }

  async saveManualCheck(
    check: StoredCheck,
    enteredById: string,
  ): Promise<string> {
    const at = check.checkedAt;
    const run = await prisma.productEnrichmentRun.create({
      data: {
        requestedById: enteredById,
        status: "COMPLETED",
        productLimit: 1,
        requestLimit: 0,
        productCount: 1,
        requestCount: 0,
        startedAt: at,
        completedAt: at,
        products: {
          create: {
            productId: check.productId,
            checkedAt: at,
            sourceCount: check.sourceCount,
            fieldCount: check.fieldCount,
            fetches: {
              create: check.fetches.map((fetch) => ({
                sourceKind: fetch.sourceKind,
                url: fetch.url,
                outcome: fetch.outcome,
                reason: fetch.reason,
                httpStatus: fetch.httpStatus,
                fetchedAt: fetch.fetchedAt,
                fieldCount: fetch.fieldCount,
              })),
            },
            fields: {
              create: check.fields.map((field) => ({
                field: field.field,
                tier: field.tier,
                status: field.status,
                value: field.value,
                sourceType: field.sourceType,
                sourceRef: field.sourceRef,
                retrievedAt: field.retrievedAt,
                confidence: field.confidence,
                currentValue: field.currentValue,
                evidence: field.evidence as unknown as Prisma.InputJsonValue,
                conflicts:
                  field.conflicts === null
                    ? Prisma.DbNull
                    : (field.conflicts as Prisma.InputJsonValue),
              })),
            },
          },
        },
      },
      select: {
        products: { select: { fields: { select: { id: true } } } },
      },
    });
    return run.products[0]!.fields[0]!.id;
  }

  async facts(productId: string): Promise<FactRecord[]> {
    const rows = await prisma.productKnowledgeFact.findMany({
      where: { productId },
      orderBy: { field: "asc" },
      select: {
        field: true,
        value: true,
        unit: true,
        status: true,
        revision: true,
        acceptedAt: true,
        fieldResultId: true,
        acceptedBy: { select: { id: true, displayName: true } },
        fieldResult: {
          select: {
            status: true,
            sourceType: true,
            sourceRef: true,
            retrievedAt: true,
            conflicts: true,
          },
        },
      },
    });
    return rows.map((row) => {
      const source = factSource(row, {
        ...row.fieldResult,
        retrievedAt: row.fieldResult.retrievedAt?.toISOString() ?? null,
      });
      return {
        field: row.field,
        value: row.value,
        unit: row.unit,
        status: row.status,
        revision: row.revision,
        acceptedAt: row.acceptedAt,
        acceptedBy: row.acceptedBy,
        fieldResultId: row.fieldResultId,
        source: {
          sourceType: source.sourceType,
          sourceRef: source.sourceRef,
          retrievedAt: source.retrievedAt ? new Date(source.retrievedAt) : null,
        },
      };
    });
  }

  async upsertFact(input: Parameters<KnowledgeStore["upsertFact"]>[0]) {
    const data = {
      value: input.value,
      unit: input.unit,
      status: input.status,
      fieldResultId: input.fieldResultId,
      acceptedById: input.acceptedById,
      acceptedAt: input.acceptedAt,
    };
    await prisma.productKnowledgeFact.upsert({
      where: {
        productId_field: { productId: input.productId, field: input.field },
      },
      create: {
        productId: input.productId,
        field: input.field,
        revision: 1,
        ...data,
      },
      update: { ...data, revision: { increment: 1 } },
    });
  }

  async copy(productId: string): Promise<CopyRecord[]> {
    return prisma.productCopy.findMany({
      where: { productId },
      orderBy: { block: "asc" },
      select: {
        block: true,
        body: true,
        status: true,
        revision: true,
        basedOn: true,
        usedFields: true,
        updatedAt: true,
        approvedAt: true,
      },
    });
  }

  async saveCopy(input: Parameters<KnowledgeStore["saveCopy"]>[0]) {
    const data = {
      body: input.body,
      status: "DRAFT" as const,
      basedOn: input.basedOn,
      usedFields: input.usedFields,
      editedById: input.editedById,
      approvedById: null,
      approvedAt: null,
    };
    await prisma.productCopy.upsert({
      where: {
        productId_block: { productId: input.productId, block: input.block },
      },
      create: {
        productId: input.productId,
        block: input.block,
        revision: 1,
        ...data,
      },
      update: { ...data, revision: { increment: 1 } },
    });
  }

  async approveCopy(input: Parameters<KnowledgeStore["approveCopy"]>[0]) {
    await prisma.productCopy.update({
      where: {
        productId_block: { productId: input.productId, block: input.block },
      },
      data: {
        status: "APPROVED",
        approvedById: input.approvedById,
        approvedAt: input.approvedAt,
      },
    });
  }
}
