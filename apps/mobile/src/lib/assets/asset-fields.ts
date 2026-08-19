/**
 * The asset vocabulary, kept in one place and free of any import from the
 * fetch/SecureStore layer, so the logic that reasons about these values
 * stays compilable and testable with plain `tsc` + `node --test`.
 *
 * `src/lib/api/assets.ts` re-exports these, so callers keep importing
 * whichever module they already used.
 */

export type AssetKind =
  "SYSTEM" | "EQUIPMENT" | "COMPONENT" | "SENSOR" | "OTHER";
export type AssetStatus = "ACTIVE" | "OUT_OF_SERVICE" | "IN_REPAIR" | "RETIRED";
export type AssetCriticality = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
export type AssetOwnerType = "CUSTOMER" | "SUPPLIER";

/**
 * The PATCH body for `/service/assets/:id`, mirroring the server's
 * `UpdateAssetDto`. Only the fields the mobile client can send are listed
 * - the web editor covers the rest.
 *
 * `expectedUpdatedAt` is required by the server, which compares it to the
 * row and refuses the write if they differ. That is what stops one client
 * from silently undoing another's edit.
 */
export interface UpdateAssetInput {
  expectedUpdatedAt: string;
  status?: AssetStatus;
  criticality?: AssetCriticality;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  inventoryNumber?: string | null;
  description?: string | null;
  notes?: string | null;
}
