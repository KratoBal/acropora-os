import { Prisma, prisma } from "@acropora/database";
import { Injectable } from "@nestjs/common";

/**
 * Az adat, amiből a számlasor-javaslat dolgozik, és ahová az auditja kerül
 * (#1199 P-026). Csak olvas, kivéve a `DecisionRun` sorokat: a javaslat maga
 * soha nem ír terméket, leképezést vagy készletet.
 */

export interface SuggestionProduct {
  readonly variantId: string;
  readonly sku: string;
  readonly productName: string;
}

export interface SuggestionRunRow {
  readonly id: string;
  readonly policyKey: string;
  readonly selectedValue: string | null;
  readonly exposure: "HIDDEN" | "SHOWN";
  readonly entityId: string | null;
  readonly resolution: string | null;
}

const productSelect = {
  id: true,
  sku: true,
  name: true,
  product: { select: { name: true } },
} as const;

function productOf(variant: {
  id: string;
  sku: string;
  name: string | null;
  product: { name: string };
}): SuggestionProduct {
  return {
    variantId: variant.id,
    sku: variant.sku,
    productName:
      variant.name && variant.name !== variant.product.name
        ? `${variant.product.name} / ${variant.name}`
        : variant.product.name,
  };
}

@Injectable()
export class SupplierLineSuggestionRepository {
  /**
   * The candidate master: every variant with its full name, as the measured
   * Stage A read the product export (product name + variant name, active and
   * inactive alike).
   */
  async candidateMaster(): Promise<
    Array<{ variantId: string; text: string; product: SuggestionProduct }>
  > {
    const variants = await prisma.productVariant.findMany({
      select: productSelect,
    });
    return variants.map((variant) => ({
      variantId: variant.id,
      text: `${variant.product.name} ${variant.name ?? ""}`,
      product: productOf(variant),
    }));
  }

  async supplierVatId(supplierId: string): Promise<string | null> {
    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { taxNumber: true },
    });
    return supplier?.taxNumber ?? null;
  }

  /** The product a supplier code is already mapped to at this supplier. */
  async mappedProduct(
    supplierId: string,
    supplierSku: string,
  ): Promise<SuggestionProduct | null> {
    const mapping = await prisma.supplierProduct.findUnique({
      where: { supplierId_supplierSku: { supplierId, supplierSku } },
      select: { variant: { select: productSelect } },
    });
    return mapping ? productOf(mapping.variant) : null;
  }

  /** The product whose barcode is exactly this code. */
  async barcodeProduct(code: string): Promise<SuggestionProduct | null> {
    const barcode = await prisma.productBarcode.findUnique({
      where: { code },
      select: { variant: { select: productSelect } },
    });
    return barcode ? productOf(barcode.variant) : null;
  }

  /**
   * One run per (line, projection, options, model): the table's own unique
   * key. The same line asked again with the same inputs gets the SAME run
   * back, so a re-render does not multiply the audit.
   */
  async createRun(
    data: Prisma.DecisionRunUncheckedCreateInput,
  ): Promise<{ id: string }> {
    try {
      return await prisma.decisionRun.create({ data, select: { id: true } });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2002"
      )
        throw error;
      const existing = await prisma.decisionRun.findFirst({
        where: {
          policyKey: data.policyKey,
          policyVersion: data.policyVersion,
          clientOperationId: data.clientOperationId ?? null,
          projectionHash: data.projectionHash,
          optionsHash: data.optionsHash,
          requestedModel: data.requestedModel,
        },
        select: { id: true },
      });
      if (!existing) throw error;
      return existing;
    }
  }

  async runs(ids: readonly string[]): Promise<SuggestionRunRow[]> {
    if (ids.length === 0) return [];
    return prisma.decisionRun.findMany({
      where: { id: { in: [...ids] } },
      select: {
        id: true,
        policyKey: true,
        selectedValue: true,
        exposure: true,
        entityId: true,
        resolution: true,
      },
    });
  }

  async resolveRun(
    id: string,
    data: {
      entityId: string;
      resolution:
        "ACCEPTED" | "OVERRIDDEN" | "SHADOW_MATCH" | "SHADOW_MISMATCH";
      resolvedValue: string;
      resolvedAt: Date;
    },
  ): Promise<void> {
    // only a run nobody resolved yet: a re-sent save must not rewrite history
    await prisma.decisionRun.updateMany({
      where: { id, entityId: null, resolution: null },
      data: { ...data, entityType: "PurchaseInvoiceLine" },
    });
  }
}
