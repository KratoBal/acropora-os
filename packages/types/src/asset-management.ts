export type AssetKind =
  "SYSTEM" | "EQUIPMENT" | "COMPONENT" | "SENSOR" | "OTHER";

export type AssetStatus = "ACTIVE" | "OUT_OF_SERVICE" | "IN_REPAIR" | "RETIRED";

export type AssetCriticality = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";

export type AssetOwnerType = "CUSTOMER" | "SUPPLIER";

export type AssetDocumentType = "INVOICE" | "WARRANTY" | "MANUAL" | "OTHER";

export type AssetEventType =
  | "CREATED"
  | "UPDATED"
  | "PLACEMENT_CHANGED"
  | "PARENT_CHANGED"
  | "STATUS_CHANGED"
  | "QR_ROTATED"
  | "DOCUMENT_UPLOADED"
  | "DOCUMENT_DELETED";

export interface AssetCustomerSummary {
  id: string;
  customerNumber: string;
  displayName: string;
}

export interface AssetOwnerSummary {
  type: AssetOwnerType;
  id: string;
  code: string;
  displayName: string;
}

export interface AssetOwnerOption extends AssetOwnerSummary {
  isActive: boolean;
  address?: AssetAddressSummary;
  addresses: AssetAddressSummary[];
  /**
   * Igaz, ha ez a tulajdonos MA NEM választható új eszközhöz: nem szerviz-jelölt
   * partner, vagy webshopos vevő. Az ilyen sor csak azért van a listában, mert
   * egy MÁR RÖGZÍTETT eszköz tulajdonosa, és a szerkesztő nem veheti el azt, amit
   * nem ő tett oda. A felület megjelöli, a hívó nem kínálja fel újnak.
   */
  outsideServiceScope?: boolean;
}

export interface AssetOwnerListResponse {
  items: AssetOwnerOption[];
}

export interface AssetAddressSummary {
  id: string;
  name?: string;
  formatted: string;
}

export interface AssetAquariumSummary {
  id: string;
  aquariumNumber: string;
  name: string;
}

export interface AssetHierarchyItem {
  id: string;
  assetNumber: string;
  name: string;
  kind: AssetKind;
  status: AssetStatus;
}

export interface AssetProductSummary {
  variantId: string;
  sku: string;
  name: string;
}

export interface AssetUnitSummary {
  id: string;
  code: string;
  name: string;
}

export interface AssetListItem extends AssetHierarchyItem {
  criticality: AssetCriticality;
  owner: AssetOwnerSummary;
  address?: AssetAddressSummary;
  /**
   * A PARTNER ALEGYSÉGE, ahol az eszköz áll. Csak szerviz partner
   * tulajdonosnál van értéke; vevőnél az `address` a pontosítás.
   *
   * A listán is kimegy, nem csak az adatlapon: enélkül a felület nem tudná
   * kiírni, hol áll az eszköz, anélkül hogy eszközönként külön hívást
   * indítana.
   */
  unit?: AssetUnitSummary;
  aquarium?: AssetAquariumSummary;
  parent?: AssetHierarchyItem;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  nextServiceAt?: string;
  /**
   * A QR-matricán lévő azonosító.
   *
   * A listán is szerepel, nem csak az adatlapon, mert a helyszíni munkához
   * a telefon előre letölti az eszközöket, és térerő nélkül a beolvasott
   * kódot ebből kell feloldania. Adatlapról építeni a katalógust eszközönként
   * egy hívást jelentene.
   *
   * Nem ad új hozzáférést: a lista, az adatlap és a `scan` végpont MIND
   * ugyanazt a jogosultságot kéri (`SERVICE_VIEW`), tehát aki listázni tud,
   * az ma is megnyit bármelyik eszközt és beolvas bármelyik tokent.
   *
   * EZ MEGFORDUL, ha a beolvasás valaha bejelentkezés nélkül is működne
   * (például ügyfélnek szánt oldalon): akkor a token bemutatóra szóló
   * kulccsá válik, és nem szabad listában kiadni.
   */
  qrToken: string;
  childCount: number;
  updatedAt: string;
}

export interface AssetDocumentSummary {
  id: string;
  type: AssetDocumentType;
  fileName: string;
  contentType: "application/pdf";
  sizeBytes: number;
  sha256: string;
  uploadedBy?: { id: string; displayName: string };
  createdAt: string;
}

export interface AssetEventSummary {
  id: string;
  type: AssetEventType;
  actor?: {
    id: string;
    displayName: string;
  };
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface AssetDetail extends AssetListItem {
  category?: string;
  inventoryNumber?: string;
  description?: string;
  installedAt?: string;
  purchasedAt?: string;
  warrantyExpiresAt?: string;
  serviceIntervalDays?: number;
  lastServicedAt?: string;
  notes?: string;
  archivedAt?: string;
  product?: AssetProductSummary;
  ancestors: AssetHierarchyItem[];
  children: AssetHierarchyItem[];
  events: AssetEventSummary[];
  documents: AssetDocumentSummary[];
  createdAt: string;
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

export interface CreateAssetInput {
  ownerType: AssetOwnerType;
  ownerId: string;
  customerAddressId?: string;
  aquariumId?: string;
  parentAssetId?: string;
  productVariantId?: string;
  kind: AssetKind;
  status?: AssetStatus;
  criticality?: AssetCriticality;
  name: string;
  category?: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  inventoryNumber?: string;
  description?: string;
  installedAt?: string;
  purchasedAt?: string;
  warrantyExpiresAt?: string;
  serviceIntervalDays?: number;
  lastServicedAt?: string;
  nextServiceAt?: string;
  notes?: string;
}

export interface UpdateAssetInput {
  ownerType?: AssetOwnerType;
  ownerId?: string;
  customerAddressId?: string | null;
  aquariumId?: string | null;
  parentAssetId?: string | null;
  productVariantId?: string | null;
  kind?: AssetKind;
  status?: AssetStatus;
  criticality?: AssetCriticality;
  name?: string;
  category?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  inventoryNumber?: string | null;
  description?: string | null;
  installedAt?: string | null;
  purchasedAt?: string | null;
  warrantyExpiresAt?: string | null;
  serviceIntervalDays?: number | null;
  lastServicedAt?: string | null;
  nextServiceAt?: string | null;
  notes?: string | null;
  expectedUpdatedAt: string;
}

export interface AssetQrCode {
  assetId: string;
  assetNumber: string;
  value: string;
  svg: string;
  labelSizeMm: 30;
}
