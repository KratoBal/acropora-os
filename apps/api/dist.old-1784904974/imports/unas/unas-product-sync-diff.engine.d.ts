import type { CanonicalUnasProduct, UnasProductIdentitySnapshot, UnasProductSyncDiff } from "@acropora/types";
export declare class UnasProductSyncDiffEngine {
    diff(products: readonly CanonicalUnasProduct[], snapshots: readonly UnasProductIdentitySnapshot[]): UnasProductSyncDiff[];
}
