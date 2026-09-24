import { apiRequest } from "./client";

/**
 * AKVÁRIUMOK, TELEFONON -- 1. KÖR (brief:
 * exchange/akvariumok-1-kor-brief-2026-09-24.md).
 *
 * A TÍPUSOK ÉS VÉGPONTOK MURENA #1051-ES ÁGÁRÓL (`munka/akvariumok-elso-kor`,
 * `packages/types/src/aquarium-management.ts` és
 * `apps/api/src/aquariums/aquariums.controller.ts`), 2026-09-24 13:35-től
 * IGAZODVA -- ez már NEM találgatás. A TÍPUSOK SAJÁT MÁSOLATOK, NEM A
 * `@acropora/types` CSOMAGBÓL: az Expo app szándékosan nem húzza be a pnpm
 * munkatér csomagjait (lásd `partners.ts`, docs/MOBILE-DEVELOPMENT.md).
 *
 * EGY VALÓDI HIÁNY, AMIT A VALÓDI API FELTÁRT ÉS AMIT EZ A FÁJL NEM OLD MEG:
 * nincs olyan végpont, amivel a `SERVICE` szerepkör (a `customers.view`/
 * `customers.manage` jog nélkül, mérve `packages/types/src/auth.ts`
 * `ROLE_PERMISSIONS.SERVICE`) meglévő ügyfelet kereshetne -- a web a sima
 * `/customers`-t hívja, amit a telefon szerepköre nem ér el, és a
 * `POST /aquariums` maga csak `aquariums.manage` alatt fut, `newCustomer`
 * mezővel LÉTREHOZ ügyfelet (ezt a szervizes teheti), de nem KERES. Ezért a
 * mobil felvitel csak ÚJ ügyfél felvitelét kínálja -- ez a brief mobil-ágának
 * (13:01, "ugyfel helyben felvetele") szó szerinti hatóköre is, a keresés a
 * "meglévő ügyfél kereshető" döntés (2. pont) csak a webre valósult meg eddig.
 */
const BASE = "/aquariums";

export type AquariumOwnershipType = "OWN" | "CUSTOMER";
export type WaterBodyType = "AKVARIUM" | "TO";
export type WaterType = "EDESVIZI" | "TENGERI";

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

export interface AquariumEquipment {
  id: string;
  kind: AquariumEquipmentKind;
  manufacturer?: string;
  model?: string;
  quantity: number;
  /** Csak a `NYOMELEM_ADAGOLO` fajtánál kötelező (brief 5. döntés). */
  channelCount?: number;
  notes?: string;
}

export interface CreateAquariumEquipmentInput {
  kind: AquariumEquipmentKind;
  manufacturer?: string;
  model?: string;
  /** Elhagyható, a szerver 1-re esik vissza. */
  quantity?: number;
  channelCount?: number;
  notes?: string;
}

export type CustomerType = "PERSON" | "COMPANY";
export type CustomerAddressType = "BILLING" | "SHIPPING" | "OTHER";

export interface NewCustomerAddressInput {
  type: CustomerAddressType;
  name?: string;
  country?: string;
  postalCode: string;
  city: string;
  line1: string;
  line2?: string;
  isDefault?: boolean;
}

/**
 * ÚJ ÜGYFÉL, HELYBEN FELVÉVE -- a MEGLÉVŐ `CreateCustomerInput`
 * (`packages/types/src/customer-management.ts`) alakja, a mobilra szánt
 * legszűkebb mezőkészletre szűkítve (brief: „név, cím, telefonszám, e-mail").
 */
export interface NewCustomerInput {
  type: CustomerType;
  displayName: string;
  phone?: string;
  email?: string;
  addresses?: NewCustomerAddressInput[];
}

export interface CreateAquariumInput {
  ownershipType: AquariumOwnershipType;
  /** MEGLÉVŐ ügyfél azonosítója. Lásd a fájl fejlécét: mobilon ma nincs
   * kereső, tehát ez a mező innen (egyelőre) nem kap értéket. */
  customerId?: string;
  /** ÚJ ügyfél helyben felvéve. */
  newCustomer?: NewCustomerInput;
  name: string;
  waterBodyType?: WaterBodyType;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  systemVolumeLiters?: number;
  /** Igaz, ha a felhasználó írta át a számolt litert (brief 3. döntés). */
  systemVolumeIsManual?: boolean;
  waterType?: WaterType;
  /** ISO 8601 dátum. */
  startedAt?: string;
  notes?: string;
  equipment?: CreateAquariumEquipmentInput[];
}

export type UpdateAquariumInput = Partial<
  Omit<CreateAquariumInput, "customerId">
> & {
  customerId?: string | null;
  isActive?: boolean;
  expectedUpdatedAt: string;
};

export interface AquariumSummary {
  id: string;
  aquariumNumber: string;
  name: string;
  ownershipType: AquariumOwnershipType;
  waterBodyType: WaterBodyType;
  customerId?: string;
  customerName?: string;
  systemVolumeLiters?: number;
  equipmentCount: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AquariumDetail extends AquariumSummary {
  customerPhone?: string;
  customerEmail?: string;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  systemVolumeIsManual: boolean;
  waterType?: WaterType;
  startedAt?: string;
  notes?: string;
  equipment: AquariumEquipment[];
}

export interface AquariumListResponse {
  items: AquariumSummary[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
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

/** A TELJES, FRISSÍTETT AKVÁRIUMOT ADJA VISSZA, nem a felvett sort -- ugyanaz
 * az alak, mint a web `aquariumsApi.addEquipment`-je. */
export function addAquariumEquipment(
  aquariumId: string,
  input: CreateAquariumEquipmentInput,
) {
  return apiRequest<AquariumDetail>(
    `${BASE}/${encodeURIComponent(aquariumId)}/equipment`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function removeAquariumEquipment(
  aquariumId: string,
  equipmentId: string,
) {
  return apiRequest<AquariumDetail>(
    `${BASE}/${encodeURIComponent(aquariumId)}/equipment/${encodeURIComponent(equipmentId)}`,
    { method: "DELETE" },
  );
}
