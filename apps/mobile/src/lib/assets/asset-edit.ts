import type {
  AssetCriticality,
  AssetStatus,
  UpdateAssetInput,
} from "./asset-fields";

/**
 * The part of an asset this module reasons about. Structural on purpose:
 * `AssetDetail` from the API layer satisfies it, but nothing here imports
 * that layer, so this stays testable without the Expo runtime.
 */
export interface EditableAsset {
  updatedAt: string;
  status: AssetStatus;
  criticality: AssetCriticality;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  inventoryNumber?: string;
  description?: string;
  notes?: string;
}

/**
 * What the phone is allowed to change about an asset.
 *
 * Deliberately narrower than the web editor, which also moves an asset
 * between owners, addresses and parents. Those are desk decisions needing
 * pickers over long lists; a technician standing in front of the
 * equipment is correcting what they can see on it - a serial number, a
 * model, what state it is in, and what they noticed.
 *
 * Dates are left out as well, and not for lack of interest: a date picker
 * is a new native dependency, and adding one is a decision of its own.
 * The web keeps them until then.
 */
export interface AssetEditForm {
  status: AssetStatus;
  criticality: AssetCriticality;
  manufacturer: string;
  model: string;
  serialNumber: string;
  inventoryNumber: string;
  description: string;
  notes: string;
}

const TEXT_FIELDS = [
  "manufacturer",
  "model",
  "serialNumber",
  "inventoryNumber",
  "description",
  "notes",
] as const;

/** Fills the form from what the server last said about the asset. */
export function assetEditFormFrom(asset: EditableAsset): AssetEditForm {
  return {
    status: asset.status,
    criticality: asset.criticality,
    manufacturer: asset.manufacturer ?? "",
    model: asset.model ?? "",
    serialNumber: asset.serialNumber ?? "",
    inventoryNumber: asset.inventoryNumber ?? "",
    description: asset.description ?? "",
    notes: asset.notes ?? "",
  };
}

/**
 * An emptied field means "clear this", which the server spells `null`. An
 * absent field means "leave it alone". The difference matters: sending
 * every field on every save would overwrite whatever somebody edited
 * elsewhere between the phone loading the asset and saving it.
 */
function textPatchValue(
  current: string,
  original: string | undefined,
): string | null | undefined {
  const trimmed = current.trim();
  if (trimmed === (original ?? "").trim()) return undefined;
  return trimmed === "" ? null : trimmed;
}

/**
 * Builds the PATCH body: only what actually changed, plus the timestamp
 * the server uses to notice that somebody else got there first.
 */
export function buildAssetPatch(
  asset: EditableAsset,
  form: AssetEditForm,
): UpdateAssetInput {
  const patch: UpdateAssetInput = { expectedUpdatedAt: asset.updatedAt };

  if (form.status !== asset.status) patch.status = form.status;
  if (form.criticality !== asset.criticality) {
    patch.criticality = form.criticality;
  }

  for (const field of TEXT_FIELDS) {
    const value = textPatchValue(form[field], asset[field]);
    if (value !== undefined) patch[field] = value;
  }

  return patch;
}

/**
 * Whether there is anything to send. Saving an unchanged form would still
 * bump `updatedAt` and could still lose a conflict, so the save button
 * stays inert until something actually differs.
 */
export function hasAssetChanges(
  asset: EditableAsset,
  form: AssetEditForm,
): boolean {
  return Object.keys(buildAssetPatch(asset, form)).length > 1;
}
