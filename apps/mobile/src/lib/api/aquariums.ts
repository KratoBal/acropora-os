import { apiRequest } from "./client";

/**
 * A végpont előtagja EGY HELYEN, ugyanazért az okért, mint a `partners.ts`
 * fejlécében: egy konstansnál a rossz előtag nem tud részlegesen megtörténni.
 */
const BASE = "/aquariums";

/**
 * AKVÁRIUMOK -- ELSŐ KÖR, CSAK FELVITEL.
 *
 * Balázs 2026-09-24 13:01-i döntése bővítette a telefonra: "az akvarium
 * felvitele, benne az ugyfel helyben felvetele (nev, cim, telefon, e-mail),
 * a meretek es a liter, az eszkozok". A típusok SAJÁT másolatok, nem a
 * `@acropora/types` csomagból jönnek -- lásd `docs/MOBILE-DEVELOPMENT.md`.
 *
 * EZ A MODUL SZÁNDÉKOSAN CSAK ÍR (`createAquarium`). A lista/részlet/
 * szerkesztés a web felületen működik; a telefonos képernyő ("felvitel")
 * ennél többet nem kért. Ha ez a kör bővül, ide kerül a `listAquariums` és a
 * `getAquarium` is, a `partners.ts` mintájára.
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

export interface AquariumDetail {
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

export function createAquarium(input: CreateAquariumInput) {
  return apiRequest<AquariumDetail>(BASE, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
