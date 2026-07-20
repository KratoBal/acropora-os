import { Injectable } from "@nestjs/common";
import type {
  CanonicalUnasProduct,
  UnasProductIdentitySnapshot,
  UnasProductSyncDiff,
} from "@acropora/types";

@Injectable()
export class UnasProductSyncDiffEngine {
  diff(
    products: readonly CanonicalUnasProduct[],
    snapshots: readonly UnasProductIdentitySnapshot[],
  ): UnasProductSyncDiff[] {
    const byExternalId = new Map(
      snapshots.map((snapshot) => [snapshot.externalId, snapshot]),
    );
    const bySku = new Map(
      snapshots.map((snapshot) => [snapshot.sku, snapshot]),
    );

    return products.map((product) => {
      const idMatch = byExternalId.get(product.externalId);
      const skuMatch = bySku.get(product.sku);
      if (idMatch && skuMatch && idMatch.productId !== skuMatch.productId)
        return {
          product,
          action: "CONFLICT",
          productId: null,
          reason: "IDENTITY_CONFLICT",
        };
      const current = idMatch ?? skuMatch;
      if (!current)
        return { product, action: "CREATE", productId: null, reason: "NEW" };
      if (current.mirrorState === "MISSING")
        return {
          product,
          action: "UPDATE",
          productId: current.productId,
          reason: "RESTORE",
        };
      if (current.canonicalHash === product.canonicalHash)
        return {
          product,
          action: "UNCHANGED",
          productId: current.productId,
          reason: "SAME_HASH",
        };
      return {
        product,
        action: "UPDATE",
        productId: current.productId,
        reason: "HASH_CHANGED",
      };
    });
  }
}
