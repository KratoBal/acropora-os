import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import type { ProductCopyBlock } from "@acropora/types";

import type { StoredCheck } from "../enrichment/enrichment-run.js";
import { vonalkodAlakjai } from "../../integrations/medusa/medusa-barcode.policy.js";
import { barcodeType } from "../barcode-type.js";
import type { FactDefinition } from "./fact-definition.policy.js";
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
  /** `null` = product-level (SEO P0 PR 3). REQUIRED: see `FactIdentity`. */
  variantId: string | null;
  value: string | null;
  unit: string | null;
  status: string;
  revision: number;
  /** The definition's `public` flag (SEO P0 PR 2); `false` with no definition. */
  public: boolean;
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
  /** The field's attribute definition (SEO P0 PR 3), or `null` if there is none. */
  definition(field: string): Promise<FactDefinition | null>;
  /** The product's ACTIVE variant ids: the scope rule names one of these, or binds the only one. */
  variantIds(productId: string): Promise<string[]>;
  /**
   * Creates the fact at revision 1, or replaces it and bumps the revision. The
   * key is the product, the variant (`null` = the product's own fact) and the
   * field: a variant's fact and the product's fact of one field are two rows.
   */
  upsertFact(input: {
    productId: string;
    variantId: string | null;
    field: string;
    value: string | null;
    unit: string | null;
    status: string;
    fieldResultId: string;
    acceptedById: string;
    acceptedAt: Date;
  }): Promise<void>;
  /**
   * AZ ELFOGADOTT EAN MINT VONALKÓD (SEO P0 PR 4, C3). Létrehozza a változat
   * `ProductBarcode` sorát (`source = JEV`, a bizonyítékkal), és primary-vé teszi,
   * ha a változatnak még nincs primary-je; egy meglévőt nem ír felül. Ha a kód
   * (bármelyik írásmódban) egy MÁSIK változat sora, nem ír, és megnevezi azt.
   */
  acceptBarcode(input: {
    variantId: string;
    code: string;
    fieldResultId: string;
    verifiedById: string;
    verifiedAt: Date;
  }): Promise<
    | { kind: "created"; isPrimary: boolean }
    | { kind: "exists" }
    | { kind: "taken"; sku: string }
  >;
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
    const kiadhato = new Set(
      (
        await prisma.attributeDefinition.findMany({
          where: { public: true, isActive: true },
          select: { key: true },
        })
      ).map((row) => row.key),
    );
    const rows = await prisma.productKnowledgeFact.findMany({
      where: { productId },
      // the product's own fact first (`scopeKey` ''), then its variants'
      orderBy: [{ field: "asc" }, { scopeKey: "asc" }],
      select: {
        field: true,
        variantId: true,
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
        variantId: row.variantId,
        value: row.value,
        unit: row.unit,
        status: row.status,
        revision: row.revision,
        public: kiadhato.has(row.field),
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
    // `scopeKey` is `coalesce(variantId, '')` (the migration's CHECK): the
    // unique key, because a NULL in a unique index never collides
    const scopeKey = input.variantId ?? "";
    await prisma.productKnowledgeFact.upsert({
      where: {
        productId_scopeKey_field: {
          productId: input.productId,
          scopeKey,
          field: input.field,
        },
      },
      create: {
        productId: input.productId,
        variantId: input.variantId,
        scopeKey,
        field: input.field,
        revision: 1,
        ...data,
      },
      update: { ...data, revision: { increment: 1 } },
    });
  }

  async definition(field: string): Promise<FactDefinition | null> {
    return prisma.attributeDefinition.findUnique({
      where: { key: field },
      select: {
        key: true,
        dataType: true,
        medusaNativeField: true,
        canonicalUnit: true,
        scope: true,
        validation: true,
        isActive: true,
      },
    });
  }

  async variantIds(productId: string): Promise<string[]> {
    // the ACTIVE variants: a product with one live variant and retired ones
    // is a one-variant product for the scope rule
    const rows = await prisma.productVariant.findMany({
      where: { productId, isActive: true },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async acceptBarcode(
    input: Parameters<KnowledgeStore["acceptBarcode"]>[0],
  ): ReturnType<KnowledgeStore["acceptBarcode"]> {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.productBarcode.findFirst({
        where: { code: { in: vonalkodAlakjai(input.code) } },
        select: { variantId: true, variant: { select: { sku: true } } },
      });
      if (existing && existing.variantId !== input.variantId)
        return { kind: "taken" as const, sku: existing.variant.sku };
      if (existing) return { kind: "exists" as const };
      const primary = await tx.productBarcode.count({
        where: { variantId: input.variantId, isPrimary: true },
      });
      await tx.productBarcode.create({
        data: {
          variantId: input.variantId,
          code: input.code,
          type: barcodeType(input.code),
          source: "JEV",
          fieldResultId: input.fieldResultId,
          verifiedById: input.verifiedById,
          verifiedAt: input.verifiedAt,
          isPrimary: primary === 0,
        },
      });
      return { kind: "created" as const, isPrimary: primary === 0 };
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
