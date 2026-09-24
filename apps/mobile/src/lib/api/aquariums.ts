import { apiRequest } from "./client";

/**
 * A végpont előtagja EGY HELYEN, ugyanazért az okért, mint a `partners.ts`
 * fejlécében: egy konstansnál a rossz előtag nem tud részlegesen megtörténni.
 */
const BASE = "/aquariums";

/**
 * AKVÁRIUMOK.
 *
 * Balázs 2026-09-24 13:01-i döntése bővítette a telefonra: "az akvarium
 * felvitele, benne az ugyfel helyben felvetele (nev, cim, telefon, e-mail),
 * a meretek es a liter, az eszkozok". A típusok SAJÁT másolatok, nem a
 * `@acropora/types` csomagból jönnek -- lásd `docs/MOBILE-DEVELOPMENT.md`.
 *
 * EZ A MODUL EDDIG SZÁNDÉKOSAN CSAK ÍRT (`createAquarium`): a "felvitel"
 * felül el is fért egyetlen hívással. Acrobot döntése (2026-09-24 14:13):
 * felvitel lista nélkül nem adható ki a telefonra, ezért a `listAquariums`,
 * `getAquarium`, `addAquariumEquipment` és `removeAquariumEquipment` most
 * kerül ide, a `partners.ts` mintájára, a valódi vezérlő végpontjaihoz
 * igazítva (`apps/api/src/aquariums/aquariums.controller.ts`).
 */

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

/**
 * ÚJ ÜGYFÉL, HELYBEN FELVÉVE -- A MEGLÉVŐ `Customer` TÁBLÁBA KERÜL.
 *
 * A mezők a szerver `CreateCustomerDto`-ját tükrözik (lásd
 * `apps/api/src/customers/dto/customer.dto.ts`), csak a telefonos felvitel
 * SZŰKÍTETT alakjában: cégnév, adószám, marketing-hozzájárulás nincs az
 * űrlapon, mert a brief csak "nev, cim, telefon, e-mail"-t kért. A `type`
 * itt mindig `"PERSON"`, mert a helyszíni felvitel magánszemélyt jelent --
 * cég-ügyfelet a webes felületen visznek fel.
 */
export interface NewAquariumCustomerInput {
  type: "PERSON";
  displayName: string;
  email?: string;
  phone?: string;
  addresses?: {
    type: "OTHER";
    postalCode: string;
    city: string;
    line1: string;
  }[];
}

export interface CreateAquariumEquipmentInput {
  kind: AquariumEquipmentKind;
  manufacturer?: string;
  model?: string;
  quantity?: number;
  channelCount?: number;
  notes?: string;
}

export interface CreateAquariumInput {
  /**
   * A HELYSZÍNI FELVITEL IDEMPOTENCIA-KULCSA. Elhagyható -- a webes felvitel
   * nem küld kulcsot, és ma működik. Lásd `sync-queue.ts`
   * `aquariumOperationId`-jét: ugyanaz a kulcs megy a sorba ÉS a szervernek.
   */
  clientOperationId?: string;
  ownershipType: AquariumOwnershipType;
  customerId?: string;
  newCustomer?: NewAquariumCustomerInput;
  name: string;
  waterBodyType?: WaterBodyType;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  systemVolumeLiters?: number;
  systemVolumeIsManual?: boolean;
  waterType?: WaterType;
  startedAt?: string;
  notes?: string;
  equipment?: CreateAquariumEquipmentInput[];
}

export interface AquariumEquipment {
  id: string;
  kind: AquariumEquipmentKind;
  manufacturer?: string;
  model?: string;
  quantity: number;
  channelCount?: number;
  notes?: string;
}

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
