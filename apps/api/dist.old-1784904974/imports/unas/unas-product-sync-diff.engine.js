var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Injectable } from "@nestjs/common";
let UnasProductSyncDiffEngine = class UnasProductSyncDiffEngine {
    diff(products, snapshots) {
        const byExternalId = new Map(snapshots.map((snapshot) => [snapshot.externalId, snapshot]));
        const bySku = new Map(snapshots.map((snapshot) => [snapshot.sku, snapshot]));
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
};
UnasProductSyncDiffEngine = __decorate([
    Injectable()
], UnasProductSyncDiffEngine);
export { UnasProductSyncDiffEngine };
//# sourceMappingURL=unas-product-sync-diff.engine.js.map