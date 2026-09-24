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
