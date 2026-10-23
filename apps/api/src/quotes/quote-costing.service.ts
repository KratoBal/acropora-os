import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@acropora/database";
import type { QuoteCostingDto } from "@acropora/types";

import { computeCosting } from "./quote-costing.js";
import { loadVariantListPrices } from "./variant-list-price.js";

/** Reads one version for the costing; the rule lives in `quote-costing.ts`. */
@Injectable()
export class QuoteCostingService {
  private readonly database = prisma;

  async costing(quoteId: string, versionId: string): Promise<QuoteCostingDto> {
    const version = await this.database.quoteVersion.findFirst({
      where: { id: versionId, quoteId },
      select: {
        id: true,
        currency: true,
        blocks: {
          orderBy: { position: "asc" },
          select: {
            items: {
              orderBy: { position: "asc" },
              select: {
                id: true,
                name: true,
                source: true,
                variantId: true,
                quantity: true,
                unitNetPrice: true,
                isOptional: true,
              },
            },
          },
        },
        bomItems: {
          orderBy: [{ quoteItemId: "asc" }, { position: "asc" }],
          select: {
            quoteItemId: true,
            kind: true,
            variantId: true,
            customName: true,
            quantity: true,
            unitCost: true,
            costCurrency: true,
            costSource: true,
            sourcePurchaseInvoiceLineId: true,
            variant: {
              select: { sku: true, product: { select: { name: true } } },
            },
          },
        },
      },
    });
    if (!version)
      throw new NotFoundException("Az ajánlat verziója nem található.");

    const items = version.blocks.flatMap((b) => b.items);
    const variantIds = [
      ...new Set(
        [...items, ...version.bomItems]
          .map((r) => r.variantId)
          .filter((id): id is string => id !== null),
      ),
    ];
    return computeCosting({
      versionId: version.id,
      currency: version.currency,
      items,
      bomItems: version.bomItems.map(({ variant, ...b }) => ({
        ...b,
        label:
          b.customName ??
          (variant
            ? `${variant.product.name} (${variant.sku})`
            : "Anyaglista-sor"),
      })),
      listPrices: await loadVariantListPrices(this.database, variantIds),
    });
  }
}
