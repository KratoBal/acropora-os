import { apiRequest } from "./client";
import {
  buildAssetDocumentUpload,
  type PickedFile,
} from "./asset-document-upload";

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

/**
 * A végpont előtagja EGY HELYEN. Ez a fájl korábban 7-szer írta le ugyanezt, és
 * 2026-08-27-én a munkalap-kliens pontosan ezért tudott HÁROM helyen egyszerre
 * rossz előtaggal hívni: a szerkezet megengedte, hogy egy helyen javuljon és a
 * másik kettőben ne. Egy konstansnál ez a hiba nem tud részlegesen megtörténni.
 */
const BASE = "/service/assets";

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
  /**
   * Az ugyfel sajat eszkozkodja. A LISTAN is megjon, mert a kereses nezi: egy
   * talalat, ami nem mutatja meg, mire illeszkedett, ugyanazt kerdezteti meg
   * masodszor.
   */
  inventoryNumber?: string;
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
  /**
   * A HELYSZINI ROGZITES IDEMPOTENCIA-KULCSA, a sor azonositoja.
   *
   * Elhagyhato: terero mellett a felvitel nem all sorba, tehat nincs mit
   * ujrakuldeni. A sorbol indulo kuldes viszont MINDIG viszi, mert ott a
   * halozati hiba utani ujraprobalas a normalis ut -- es epp ott lehet, hogy a
   * szerver mar letrehozta az eszkozt, csak a valasz veszett el.
   */
  clientOperationId?: string;
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
  /**
   * A partner SAJÁT azonosítója az eszközön (leltári szám). Nem a miénk: a
   * gépen gyakran ez a matrica van rajta, és a helyszínen ezt olvassa le a
   * szerelő. A szerver felvitelkor is fogadja.
   */
  inventoryNumber?: string;
  /**
   * AZ ELŐRE NYOMTATOTT MATRICA KÓDJA (egy betű és négy szám, pl. V2196).
   *
   * NEM UGYANAZ, MINT AZ `inventoryNumber`: az a PARTNERÉ, ez a MIÉNK. A
   * szerelő a helyszínen a mi matricánkat ragasztja fel, és ezt a kódot köti
   * az eszközhöz. A régi, generált QR-tokent NEM ez váltja ki: az továbbra is
   * a beolvasás kulcsa marad (Balázs, 2026-09-02 16:27: „nem tedd vissza a
   * régi qr-t, csak majd az újat").
   */
  labelCode?: string;
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
  return apiRequest<AssetListResponse>(`${BASE}?${query}`);
}

export function getAsset(id: string) {
  return apiRequest<AssetDetail>(`${BASE}/${encodeURIComponent(id)}`);
}

export function scanAsset(qrToken: string) {
  return apiRequest<AssetDetail>(`${BASE}/scan/${encodeURIComponent(qrToken)}`);
}

export function listAssetOwners() {
  return apiRequest<{ items: AssetOwnerOption[] }>(`${BASE}/owners`);
}

export function createAsset(input: CreateAssetInput) {
  return apiRequest<AssetDetail>(BASE, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateAsset(id: string, input: UpdateAssetInput) {
  return apiRequest<AssetDetail>(`${BASE}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function getAssetQr(id: string) {
  return apiRequest<AssetQrCode>(`${BASE}/${encodeURIComponent(id)}/qr`);
}

/**
 * A dokumentum-fajták, ahogy a szerver ismeri őket. SAJÁT másolat, nem a
 * `@acropora/types` csomagból: az Expo app szándékosan nem húzza be a pnpm
 * munkatér csomagjait (lásd `docs/MOBILE-DEVELOPMENT.md`). A nevek a
 * szerveréi, hogy a két oldal összevetése olvasásra is elvégezhető legyen.
 *
 * FÉNYKÉPNEK MA NINCS SAJÁT FAJTÁJA: az `OTHER` alá kerül. Hogy legyen-e külön
 * `PHOTO`, az termék-döntés, és séma-változást kíván - ez a felület úgy áll,
 * hogy bármelyik válasz mellett megmarad.
 */
export type AssetDocumentType = "INVOICE" | "WARRANTY" | "MANUAL" | "OTHER";

/**
 * Egy feltöltött dokumentum sora, ahogy a végpont visszaadja.
 *
 * A MEZŐNEVEK A SZERVERÉI, ÉS EZT MEGMÉRTEM, NEM KITALÁLTAM. Az első
 * változatomban `uploadedAt` állt, a szerveren `createdAt` van, és a fordító
 * ezt SOHA nem mondta volna meg: a mobil szándékosan másolatot tart, tehát a
 * két oldal között nincs típus-kapcsolat. Egy elgépelt mezőnév itt
 * `undefined`-ként jelenne meg a képernyőn, hibaüzenet nélkül.
 */
export interface AssetDocumentSummary {
  id: string;
  type: AssetDocumentType;
  fileName: string;
  contentType: "application/pdf" | "image/jpeg" | "image/png";
  sizeBytes: number;
  sha256: string;
  uploadedBy?: { id: string; displayName: string };
  createdAt: string;
}

/**
 * DOKUMENTUM- ÉS FÉNYKÉP-FELTÖLTÉS EGY ESZKÖZHÖZ.
 *
 * A törzset a `buildAssetDocumentUpload` állítja össze, és a hibát MÉG A
 * KÜLDÉS ELŐTT megnevezi. Itt csak az marad, ami hálózatot igényel.
 *
 * A válasz LISTA, egyetlen fájlnál is: a végpont mindig azzal felel.
 */
export async function uploadAssetDocuments(
  id: string,
  input: { type: AssetDocumentType; files: readonly PickedFile[] },
): Promise<AssetDocumentSummary[]> {
  const built = buildAssetDocumentUpload(input);
  if (!built.ok) throw new Error(built.reason);

  return apiRequest<AssetDocumentSummary[]>(
    `${BASE}/${encodeURIComponent(id)}/documents`,
    { method: "POST", body: built.body },
  );
}
