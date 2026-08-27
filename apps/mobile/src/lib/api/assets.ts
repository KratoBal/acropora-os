import { apiRequest } from "./client";

// Declared in lib/assets/asset-fields.ts so the logic that reasons about
// them does not have to import this module, which reaches SecureStore and
// the network. Re-exported below because callers already import them from
// the API layer.
import type {
  AssetCriticality,
  AssetKind,
  AssetOwnerType,
  AssetStatus,
  UpdateAssetInput,
} from "@/lib/assets/asset-fields";

export type {
  AssetCriticality,
  AssetKind,
  AssetOwnerType,
  AssetStatus,
  UpdateAssetInput,
};

export interface AssetHierarchyItem {
  id: string;
  assetNumber: string;
  name: string;
  kind: AssetKind;
  status: AssetStatus;
}

/**
 * A PARTNER ALEGYSÉGE, ahol az eszköz áll. Csak szerviz partner tulajdonosnál
 * van értéke; vevőnél a cím a pontosítás.
 *
 * A `path` a gyökértől eddig az egységig tartó nevek sora, és a szerver adja --
 * nem itt épül. A kód és a név csak TESTVÉREK között egyedi, tehát a puszta név
 * két távoli ágra ugyanazt a sort adná.
 */
export interface AssetUnit {
  id: string;
  code: string;
  name: string;
  path: string[];
}

export interface AssetListItem extends AssetHierarchyItem {
  criticality: AssetCriticality;
  owner: {
    type: AssetOwnerType;
    id: string;
    code: string;
    displayName: string;
  };
  address?: { id: string; name?: string; formatted: string };
  unit?: AssetUnit;
  aquarium?: { id: string; aquariumNumber: string; name: string };
  parent?: AssetHierarchyItem;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  nextServiceAt?: string;
  /**
   * A QR-matricán lévő azonosító. A listán is megjön, mert a helyszíni
   * katalógus enélkül nem tudja feloldani a beolvasott kódot térerő nélkül.
   */
  qrToken: string;
  childCount: number;
  updatedAt: string;
}

export interface AssetDetail extends AssetListItem {
  category?: string;
  inventoryNumber?: string;
  description?: string;
  installedAt?: string;
  warrantyExpiresAt?: string;
  serviceIntervalDays?: number;
  lastServicedAt?: string;
  notes?: string;
  product?: { variantId: string; sku: string; name: string };
  ancestors: AssetHierarchyItem[];
  children: AssetHierarchyItem[];
  events: {
    id: string;
    type: string;
    actor?: { id: string; displayName: string };
    occurredAt: string;
  }[];
  createdAt: string;
}

export interface AssetOwnerOption {
  type: AssetOwnerType;
  id: string;
  code: string;
  displayName: string;
  isActive: boolean;
  addresses: { id: string; name?: string; formatted: string }[];
  /**
   * Igaz, ha ez a tulajdonos ma NEM választható új eszközhöz (nem szerviz-jelölt
   * partner vagy webshopos vevő), és csak azért jött vissza, mert egy MÁR
   * rögzített eszközön rajta van. A telefonon új eszköz felvételekor nem
   * fordulhat elő; a mező azért van itt, hogy a lista egy alakú maradjon a
   * weben és a mobilon.
   */
  outsideServiceScope?: boolean;
}

export interface AssetQrCode {
  assetId: string;
  assetNumber: string;
  value: string;
  svg: string;
  labelSizeMm: 30;
}

export interface CreateAssetInput {
  ownerType: AssetOwnerType;
  ownerId: string;
  customerAddressId?: string;
  /**
   * A partner alegysége. Csak `SUPPLIER` tulajdonosnál küldhető: vevőnél a
   * szerver el is utasítja, mert ott a cím a pontosítás.
   */
  departmentId?: string;
  parentAssetId?: string;
  kind: AssetKind;
  name: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  installedAt?: string;
  serviceIntervalDays?: number;
}

export interface AssetListResponse {
  items: AssetListItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

/**
 * A SZERELŐ LISTÁJA: a szerviz-partnerek eszközei.
 *
 * Az `ownerScope` EXPLICIT, mert ugyanezt a végpontot használja a webes
 * nyilvántartás is, ahol a teljesség az érték. A szűrés a szerveren történik:
 * egy már lapozott halmazt itt szűrni annyi lenne, hogy a lapszám a kihagyott
 * sorokat is számolja.
 */
/**
 * A KERESÉS A SZERVEREN FUT, és ugyanazt a hat mezőt nézi, amit a webes lista
 * (eszközszám, név, gyártó, modell, sorozatszám, leltári szám) plusz a
 * tulajdonos nevét. A telefonon szűrni egy már lapozott halmazt annyi lenne,
 * hogy ötven sorból hármat mutatunk, miközben a darabszám a többit is számolja.
 */
export function listAssets(page = 1, pageSize = 50, search = "") {
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    status: "ACTIVE",
    ownerScope: "SERVICE_PARTNER",
  });
  if (search.trim()) query.set("search", search.trim());
  return apiRequest<AssetListResponse>(`/service/assets?${query}`);
}

export function getAsset(id: string) {
  return apiRequest<AssetDetail>(`/service/assets/${encodeURIComponent(id)}`);
}

export function scanAsset(qrToken: string) {
  return apiRequest<AssetDetail>(
    `/service/assets/scan/${encodeURIComponent(qrToken)}`,
  );
}

export function listAssetOwners() {
  return apiRequest<{ items: AssetOwnerOption[] }>("/service/assets/owners");
}

export function createAsset(input: CreateAssetInput) {
  return apiRequest<AssetDetail>("/service/assets", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateAsset(id: string, input: UpdateAssetInput) {
  return apiRequest<AssetDetail>(`/service/assets/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function getAssetQr(id: string) {
  return apiRequest<AssetQrCode>(
    `/service/assets/${encodeURIComponent(id)}/qr`,
  );
}
