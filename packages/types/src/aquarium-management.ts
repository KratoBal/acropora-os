import type { CreateCustomerInput } from "./customer-management.js";

/// A felületen csak "Saját" (OWN) és "Ügyfél" (CUSTOMER) választható.
/// A `STORE` a sémában marad, de ezen a felületen soha nem jelenik meg --
/// lásd `apps/api/src/aquariums/aquarium-validation.ts` fejlécét.
export type AquariumOwnershipType = "OWN" | "CUSTOMER";

/// Akvárium vagy tó -- ugyanaz a rekord, egy megkülönböztető mezővel.
export type WaterBodyType = "AKVARIUM" | "TO";

export type WaterType = "EDESVIZI" | "TENGERI";

/// Balázs listája (2026-09-24): világítás, áramoltatás, lehabzó, felnyomó,
/// biológiai szűrés, médiareaktor, nyomelem-adagoló, fűtés, hűtés.
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
  /** A "típus", Balázs szavával -- pl. a nyomelem-adagoló gyártói modellje. */
  model?: string;
  quantity: number;
  /** Csak a nyomelem-adagolónál (`kind === "NYOMELEM_ADAGOLO"`) kötelező. */
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
  /** Lásd `apps/api/src/aquariums/aquarium-volume.ts` fejlécét: `true`, ha a
   * felhasználó írta át a számolt litert. */
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

export interface CreateAquariumEquipmentInput {
  kind: AquariumEquipmentKind;
  manufacturer?: string;
  model?: string;
  quantity?: number;
  channelCount?: number;
  notes?: string;
}

/**
 * ÚJ AKVÁRIUM VAGY TÓ FELVITELE.
 *
 * `CUSTOMER` tulajdonnál pontosan az egyik kell: `customerId` (meglévő
 * ügyfél) VAGY `newCustomer` (a meglévő `CreateCustomerInput`-tal, a
 * meglévő `Customer` táblába kerül, nem szabad szövegként) -- lásd
 * `apps/api/src/aquariums/aquarium-validation.ts` fejlécét.
 */
export interface CreateAquariumInput {
  ownershipType: AquariumOwnershipType;
  customerId?: string;
  newCustomer?: CreateCustomerInput;
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

export interface UpdateAquariumInput {
  ownershipType?: AquariumOwnershipType;
  customerId?: string | null;
  newCustomer?: CreateCustomerInput;
  name?: string;
  waterBodyType?: WaterBodyType;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  systemVolumeLiters?: number | null;
  systemVolumeIsManual?: boolean;
  waterType?: WaterType | null;
  startedAt?: string | null;
  notes?: string | null;
  isActive?: boolean;
  expectedUpdatedAt: string;
}
