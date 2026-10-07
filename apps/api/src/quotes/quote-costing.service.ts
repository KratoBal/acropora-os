import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@acropora/database";
import type { QuoteCostingDto } from "@acropora/types";

import { isKnownCatalogAuthority } from "../integrations/medusa/medusa-publication.policy.js";
import { resolvePriceSource } from "../integrations/medusa/medusa-price-source.js";
import {
  computeCosting,
  listPriceFromDecision,
  type CostingListPrice,
} from "./quote-costing.js";

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
      listPrices: await this.listPrices(variantIds),
    });
  }

  private async listPrices(
    variantIds: string[],
  ): Promise<Map<string, CostingListPrice>> {
    if (!variantIds.length) return new Map();
    const variants = await this.database.productVariant.findMany({
      where: { id: { in: variantIds } },
      select: {
        id: true,
        productId: true,
        vatRate: true,
        sellingGrossPrice: true,
        sellingPriceCurrency: true,
        unasVariantExtraGrossPrice: true,
        product: { select: { catalogAuthority: true } },
      },
    });
    const mirrors = await this.database.unasProductSnapshot.findMany({
      where: {
        productId: { in: [...new Set(variants.map((v) => v.productId))] },
      },
      select: {
        productId: true,
        grossPrice: true,
        currency: true,
        saleGrossPrice: true,
        saleStartsAt: true,
        saleEndsAt: true,
      },
    });
    const mirrorByProduct = new Map(mirrors.map((m) => [m.productId, m]));
    const now = new Date();
    return new Map(
      variants.map((v) => {
        const authority = v.product.catalogAuthority;
        const decision = resolvePriceSource({
          // an unknown owner is neither ours nor theirs (the pricing CLI's rule)
          authority: isKnownCatalogAuthority(authority)
            ? (authority as "UNAS" | "ACROPORA")
            : null,
          mirror: mirrorByProduct.get(v.productId) ?? null,
          own: {
            sellingGrossPrice: v.sellingGrossPrice,
            sellingPriceCurrency: v.sellingPriceCurrency,
          },
          variantSurcharge: v.unasVariantExtraGrossPrice,
          now,
        });
        return [v.id, listPriceFromDecision(decision, v.vatRate)];
      }),
    );
  }
}
