import type {
  AquariumEquipmentKind,
  AquariumOwnershipType,
  WaterBodyType,
  WaterType,
} from "@acropora/types";

export const OWNERSHIP_LABEL: Record<AquariumOwnershipType, string> = {
  OWN: "Saját",
  CUSTOMER: "Ügyfél",
};

/**
 * THE OWNERSHIP BADGE (ReefClub slice 5a; acrobot 33818, Balázs saw "Ügyfél" on
 * a shared one): a customer's own ReefClub aquarium, shared with the shop, is a
 * "ReefClub akvárium", not a shop customer's. The API marks it with
 * `reefClubSharedAt`; without it the ownership type decides, as before.
 */
export function ownershipLabel(aquarium: {
  ownershipType: AquariumOwnershipType;
  reefClubSharedAt?: string;
}): string {
  return aquarium.reefClubSharedAt
    ? "ReefClub akvárium"
    : OWNERSHIP_LABEL[aquarium.ownershipType];
}

export const WATER_BODY_LABEL: Record<WaterBodyType, string> = {
  AKVARIUM: "Akvárium",
  TO: "Tó",
};

export const WATER_TYPE_LABEL: Record<WaterType, string> = {
  EDESVIZI: "Édesvízi",
  TENGERI: "Tengeri",
};

/** Balázs listája (2026-09-24), a felvitel sorrendjében. */
export const EQUIPMENT_KIND_LABEL: Record<AquariumEquipmentKind, string> = {
  VILAGITAS: "Világítás",
  ARAMOLTATAS: "Áramoltatás",
  LEHABZO: "Lehabzó",
  FELNYOMO: "Felnyomó",
  BIO_SZURES: "Biológiai szűrés",
  MEDIA_REAKTOR: "Média reaktor",
  NYOMELEM_ADAGOLO: "Nyomelem adagoló",
  FUTES: "Fűtés",
  HUTES: "Hűtés",
  EGYEB: "Egyéb",
};

export const EQUIPMENT_KIND_OPTIONS = Object.entries(EQUIPMENT_KIND_LABEL) as [
  AquariumEquipmentKind,
  string,
][];
