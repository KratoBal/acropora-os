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

/**
 * EGY KARBANTARTÓ -- CSAK MEGJELENÍTÉS EBBEN A KÖRBEN.
 *
 * A brief (exchange/akvariumok-2-kor-vizertekek-brief-2026-09-24.md) 8.
 * pontja szerint a szerkesztés webes, a telefonon egyelőre csak a lista
 * jelenik meg az adatlapon.
 */
export interface AquariumMaintainer {
  userId: string;
  displayName: string;
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
  maintainers: AquariumMaintainer[];
  /** SZÁRMAZTATOTT: igaz, ha legalább egy karbantartó van. */
  maintainedByUs: boolean;
}

export function createAquarium(input: CreateAquariumInput) {
  return apiRequest<AquariumDetail>(BASE, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * VÍZÉRTÉKEK -- MÁSODIK KÖR (murena API-ja, #1055, ág:
 * munka/akvariumok-vizertekek).
 *
 * A típusok szerkezetileg a `packages/types/src/aquarium-management.ts`
 * megosztott alakjait tükrözik, saját másolatban (lásd a fájl fejlécét,
 * miért nem import).
 */
export type AquariumMeasurementParameterCode =
  | "HOMERSEKLET"
  | "SOTARTALOM"
  | "SURUSEG"
  | "PH"
  | "KH"
  | "GH"
  | "KALCIUM"
  | "MAGNEZIUM"
  | "NITRAT"
  | "FOSZFAT"
  | "AMMONIA"
  | "NITRIT"
  | "SZILIKAT"
  | "ORP"
  | "VAS"
  | "REZ"
  | "VEZETOKEPESSEG";

export interface AquariumMeasurementValue {
  parameterCode: AquariumMeasurementParameterCode;
  value: number;
}

export interface AquariumMeasurementOccasion {
  id: string;
  measuredAt: string;
  measuredById?: string;
  measuredByName?: string;
  source?: string;
  notes?: string;
  values: AquariumMeasurementValue[];
}

export interface AquariumMeasurementListResponse {
  occasions: AquariumMeasurementOccasion[];
}

export interface CreateAquariumMeasurementInput {
  /** Ugyanaz az idempotencia-elv, mint az akvárium saját felvitelénél --
   * lásd `aquariumMeasurementOperationId` a `sync-queue.ts`-ben. */
  clientOperationId?: string;
  measuredAt?: string;
  source?: string;
  notes?: string;
  values: AquariumMeasurementValue[];
}

export function listAquariumMeasurements(aquariumId: string) {
  return apiRequest<AquariumMeasurementListResponse>(
    `${BASE}/${encodeURIComponent(aquariumId)}/measurements`,
  );
}

/** EGY ALKALMAT AD VISSZA, NEM A TELJES LISTÁT -- ugyanaz az alak, mint a
 * szerver `AquariumMeasurementsService.create()`-je. */
export function createAquariumMeasurement(
  aquariumId: string,
  input: CreateAquariumMeasurementInput,
) {
  return apiRequest<AquariumMeasurementOccasion>(
    `${BASE}/${encodeURIComponent(aquariumId)}/measurements`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

/**
 * AZ `occasionId` A MÉRÉSI ALKALOM `measuredAt` ÉRTÉKÉNEK ISO-ALAKJA --
 * lásd a szerver `aquarium-measurements.repository.ts` fejlécét, miért
 * nincs külön azonosító.
 */
export function deleteAquariumMeasurement(
  aquariumId: string,
  occasionId: string,
) {
  return apiRequest<void>(
    `${BASE}/${encodeURIComponent(aquariumId)}/measurements/${encodeURIComponent(occasionId)}`,
    { method: "DELETE" },
  );
}
