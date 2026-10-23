import type { PrismaClient } from "@acropora/database";

import { isKnownCatalogAuthority } from "../integrations/medusa/medusa-publication.policy.js";
import { resolvePriceSource } from "../integrations/medusa/medusa-price-source.js";
import {
  listPriceFromDecision,
  type CostingListPrice,
} from "./quote-costing.js";

/**
 * A VÁLTOZATOK MAI ELADÁSI ÁRA, HUF NETTÓBAN (acrobot 27773): a törzsadat
 * gazdája dönt, hogy a tükör vagy a saját ár a mérvadó (`resolvePriceSource`),
 * és a nettót a VÁLTOZAT áfakulcsa adja (`listPriceFromDecision`: a `vatRate`
 * SZÁZALÉK, 27, nem 0,27). Minden hiány megnevezett ok, soha nem nulla.
 *
 * Az ajánlat önköltsége használta egyedül (`QuoteCostingService`); a beszállítói
 * árlisták haszon-számítása ugyanezt az eladási árat kell lássa, ezért a lekérdezés
 * ide költözött, hogy a két hely ne térjen el egymástól.
 */
export async function loadVariantListPrices(
  database: Pick<PrismaClient, "productVariant" | "unasProductSnapshot">,
  variantIds: readonly string[],
  now: Date = new Date(),
): Promise<Map<string, CostingListPrice>> {
  if (!variantIds.length) return new Map();
  const variants = await database.productVariant.findMany({
    where: { id: { in: [...variantIds] } },
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
  const mirrors = await database.unasProductSnapshot.findMany({
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
