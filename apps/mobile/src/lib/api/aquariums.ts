import { apiRequest } from "./client";

/**
 * AKVÁRIUMOK, TELEFONON -- 1. KÖR (Balázs kérése, 2026-09-24, brief:
 * exchange/akvariumok-1-kor-brief-2026-09-24.md).
 *
 * EZ A FÁJL EGYETLEN ADAPTER, SZÁNDÉKOSAN (acrobot kérése, 2026-09-24 13:30):
 * murena párhuzamosan építi a `packages/database` + `apps/api` + `apps/web`
 * részt, és amíg az ő típusai fel nem kerülnek, ez a fájl a brief mezőneveivel
 * dolgozik. A képernyők ELLEN a fenti modulok exportjait hívják -- ha a
 * végpont vagy egy mezőnév változik, EZ AZ EGY FÁJL módosul, a képernyők nem.
 *
 * A TÍPUSOK SAJÁT MÁSOLATOK, NEM A `@acropora/types` CSOMAGBÓL -- ugyanaz az
 * elv, mint a `partners.ts`-nél: az Expo app szándékosan nem húzza be a pnpm
 * munkatér csomagjait (docs/MOBILE-DEVELOPMENT.md).
 *
 * MI GROUNDOLT ÉS MI TALÁLGATÁS, KÜLÖN MEGJELÖLVE:
 * - `AquariumOwnershipType`, `WaterBodyType`, `AquariumEquipmentKind` és az
 *   eszköz-mezők (kind/manufacturer/model/quantity/channelCount/notes): SZÓ
 *   SZERINT a brief acrobot-féle döntéseiből (1., 4., 5. pont), nem találgatás.
 * - `NewCustomerInput` mezői: a MEGLÉVŐ `CreateCustomerDto`/
 *   `CreateCustomerAddressDto` (apps/api/src/customers/dto/customer.dto.ts)
 *   alakja, mert az akvárium ügyfele ugyanabba a `Customer` táblába kerül
 *   (brief 2. döntés) -- ez is grounded, nem találgatás.
 * - A VÉGPONT-UTAK és a `volumeLitersSource`/`waterType`/`startedAt` mezőnév:
 *   TALÁLGATÁS, murena tényleges API-jához igazítandó.
 * - A meglévő ügyfél KERESÉSE nem a `/customers` végpontra megy: a `SERVICE`
 *   szerepkör NEM viseli a `customers.view`/`customers.manage` jogot (mérve
 *   `packages/types/src/auth.ts` `ROLE_PERMISSIONS.SERVICE`), tehát a
 *   keresésnek egy AKVÁRIUM-SAJÁT, `aquariums.view` alatti végponton kell
 *   futnia -- ugyanaz a minta, mint az `assets.ts` `/assets/owners`
 *   (`listAssetOwners`) végpontja. Itt `${BASE}/customers` alakban áll,
 *   találgatásként jelölve.
 */
const BASE = "/aquariums";

export type AquariumOwnershipType = "OWN" | "CUSTOMER";
export type WaterBodyType = "AKVARIUM" | "TO";
/** TALÁLGATÁS: a brief 3. döntése csak a viselkedést írja le ("a mentett
 * rekord jelölje, hogy kézi vagy számolt"), mezőnevet nem ad. */
export type VolumeLitersSource = "MANUAL" | "CALCULATED";
/** TALÁLGATÁS, a brief 6. pontja ("víztípus: tengeri / édesvízi") alapján. */
export type AquariumWaterType = "SALTWATER" | "FRESHWATER";

export type AquariumEquipmentKind =
  | "VILAGITAS"
  | "ARAMOLTATAS"
  | "LEHABZO"
  | "FELNYOMO"
  | "BIO_SZURES"
  | "MEDIA_REAKTOR"
  | "NYOMELEM_ADAGOLO"
  | "FUTES"
  | "HUTES"
  | "EGYEB";

export interface AquariumEquipmentInput {
  kind: AquariumEquipmentKind;
  manufacturer?: string;
  model?: string;
  quantity: number;
  /** Csak a `NYOMELEM_ADAGOLO` fajtánál kötelező (brief 5. döntés). */
  channelCount?: number;
  notes?: string;
}

export interface AquariumEquipmentRow extends AquariumEquipmentInput {
  id: string;
}

/**
 * ÚJ ÜGYFÉL, HELYBEN FELVÉVE -- a `CreateCustomerDto`/
 * `CreateCustomerAddressDto` valódi alakja (apps/api/src/customers/dto),
 * a mobilra szánt legszűkebb mezőkészletre szűkítve (brief: „név, cím,
 * telefonszám, e-mail").
 */
export interface NewCustomerInput {
  displayName: string;
  phone?: string;
  email?: string;
  address?: {
    postalCode: string;
    city: string;
    line1: string;
  };
}

export interface CreateAquariumInput {
  name: string;
  ownershipType: AquariumOwnershipType;
  /** MEGLÉVŐ ügyfél, ha `ownershipType === "CUSTOMER"` és a felhasználó a
   * keresőből választott. `newCustomer`-rel kölcsönösen kizárja egymást. */
  customerId?: string;
  /** ÚJ ügyfél helyben felvéve, ha nincs `customerId`. */
  newCustomer?: NewCustomerInput;
  waterBodyType: WaterBodyType;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  systemVolumeLiters?: number;
  volumeLitersSource?: VolumeLitersSource;
  waterType?: AquariumWaterType;
  /** ISO 8601 dátum (`YYYY-MM-DD`). */
  startedAt?: string;
  notes?: string;
  equipment: AquariumEquipmentInput[];
}

export type UpdateAquariumInput = Partial<CreateAquariumInput> & {
  expectedUpdatedAt: string;
};

export interface AquariumListItem {
  id: string;
  aquariumNumber: string;
  name: string;
  ownershipType: AquariumOwnershipType;
  waterBodyType: WaterBodyType;
  customerName: string | null;
  systemVolumeLiters: number | null;
  equipmentCount: number;
  isActive: boolean;
}

export interface AquariumListResponse {
  items: AquariumListItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export interface AquariumDetail {
  id: string;
  aquariumNumber: string;
  name: string;
  ownershipType: AquariumOwnershipType;
  customerId: string | null;
  customerName: string | null;
  waterBodyType: WaterBodyType;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  systemVolumeLiters: number | null;
  volumeLitersSource: VolumeLitersSource | null;
  waterType: AquariumWaterType | null;
  startedAt: string | null;
  notes: string | null;
  isActive: boolean;
  equipment: AquariumEquipmentRow[];
  updatedAt: string;
}

/** A VÁLASZTÓ-LISTA MEGLÉVŐ ÜGYFELEKHEZ. Lásd a fájl fejlécét: ez SZÁNDÉKOSAN
 * nem a `/customers` végpont, mert a `SERVICE` szerepkör azt nem éri el. */
export interface AquariumSelectableCustomer {
  id: string;
  name: string;
  phone: string | null;
}

export function listAquariums(page = 1, pageSize = 25, search = "") {
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (search.trim()) query.set("search", search.trim());
  return apiRequest<AquariumListResponse>(`${BASE}?${query}`);
}

export function getAquarium(id: string) {
  return apiRequest<AquariumDetail>(`${BASE}/${encodeURIComponent(id)}`);
}

export function createAquarium(input: CreateAquariumInput) {
  return apiRequest<AquariumDetail>(BASE, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateAquarium(id: string, input: UpdateAquariumInput) {
  return apiRequest<AquariumDetail>(`${BASE}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function addAquariumEquipment(
  aquariumId: string,
  input: AquariumEquipmentInput,
) {
  return apiRequest<AquariumEquipmentRow>(
    `${BASE}/${encodeURIComponent(aquariumId)}/equipment`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function deleteAquariumEquipment(
  aquariumId: string,
  equipmentId: string,
) {
  return apiRequest<void>(
    `${BASE}/${encodeURIComponent(aquariumId)}/equipment/${encodeURIComponent(equipmentId)}`,
    { method: "DELETE" },
  );
}

export function listSelectableAquariumCustomers(search = "") {
  const query = new URLSearchParams();
  if (search.trim()) query.set("search", search.trim());
  return apiRequest<{ items: AquariumSelectableCustomer[] }>(
    `${BASE}/customers?${query}`,
  );
}
