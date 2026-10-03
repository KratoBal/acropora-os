import { Prisma, prisma } from "@acropora/database";
import { validateGtin } from "@acropora/jev/product-enrichment";

import type {
  EnrichmentFactsReader,
  EnrichmentRunStore,
  ProductFacts,
  StoredCheck,
} from "./enrichment-run.js";

/**
 * THE RUN'S DATABASE SIDE. It READS the product (to know our current values
 * and the manufacturer's site) and WRITES only the four enrichment tables.
 * There is no product, variant, barcode, UNAS or Medusa write here, and the
 * run gets no other store: a JEV result has no path into the product.
 */
export class PrismaEnrichmentRunStore implements EnrichmentRunStore {
  async startRun(input: {
    requestedById: string;
    productLimit: number;
    requestLimit: number;
  }): Promise<string> {
    const run = await prisma.productEnrichmentRun.create({
      data: input,
      select: { id: true },
    });
    return run.id;
  }

  async saveCheck(runId: string, check: StoredCheck): Promise<void> {
    await prisma.productEnrichmentRunProduct.create({
      data: {
        runId,
        productId: check.productId,
        checkedAt: check.checkedAt,
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
    });
  }

  async finishRun(
    runId: string,
    result: {
      status: "COMPLETED" | "LIMIT_REACHED" | "FAILED";
      productCount: number;
      requestCount: number;
      errorCode: string | null;
    },
  ): Promise<void> {
    await prisma.productEnrichmentRun.update({
      where: { id: runId },
      data: { ...result, completedAt: new Date() },
    });
  }
}

/**
 * OUR CURRENT VALUES, the way the product holds them today.
 *
 * - title: the product name; brand: the linked brand's name.
 * - ean / manufacturerSku: only for a single-variant product, since a product
 *   with variants has more than one. The primary barcode is the EAN; the
 *   UNAS "Gyártói cikkszám" (`manufacturerPartNumber`) is the EAN when it is
 *   a valid GTIN (that column holds both kinds, see
 *   `medusa-barcode.policy.ts`), otherwise the manufacturer part number.
 * - The structured specs (weight, sizes, flow, power...) have no product
 *   column, so they have no current value (docs/jev/product-enrichment-v0.md).
 */
export class PrismaEnrichmentFactsReader implements EnrichmentFactsReader {
  async productFacts(productId: string): Promise<ProductFacts | null> {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        brand: { select: { name: true, websiteUrl: true } },
        unasSnapshot: { select: { manufacturerUrl: true } },
        variants: {
          select: {
            manufacturerPartNumber: true,
            barcodes: {
              select: { code: true, isPrimary: true },
              orderBy: [{ isPrimary: "desc" }, { code: "asc" }],
            },
          },
        },
      },
    });
    if (!product) return null;
    return productFactsFrom(product);
  }

  async supplierWebsite(supplierId: string): Promise<string | null> {
    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { websiteUrl: true },
    });
    return supplier?.websiteUrl ?? null;
  }
}

export function productFactsFrom(product: {
  id: string;
  name: string;
  brand: { name: string; websiteUrl: string | null } | null;
  unasSnapshot: { manufacturerUrl: string | null } | null;
  variants: {
    manufacturerPartNumber: string | null;
    barcodes: { code: string; isPrimary: boolean }[];
  }[];
}): ProductFacts {
  const current: ProductFacts["current"] = {};
  if (product.name.trim()) current.title = product.name;
  if (product.brand?.name.trim()) current.brand = product.brand.name;
  if (product.variants.length === 1) {
    const variant = product.variants[0]!;
    const mpn = variant.manufacturerPartNumber?.trim() || null;
    const mpnIsGtin = mpn !== null && validateGtin(mpn).ok;
    const barcode = variant.barcodes[0]?.code ?? null;
    const ean = barcode ?? (mpnIsGtin ? mpn : null);
    if (ean) current.ean = ean;
    if (mpn && !mpnIsGtin) current.manufacturerSku = mpn;
  }
  return {
    productId: product.id,
    name: product.name,
    brandWebsiteUrl: product.brand?.websiteUrl ?? null,
    unasManufacturerUrl: product.unasSnapshot?.manufacturerUrl ?? null,
    current,
  };
}
