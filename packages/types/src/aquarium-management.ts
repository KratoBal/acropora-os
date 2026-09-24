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
  /** A karbantartók listája. Lásd az `AquariumMaintainer` fejlécét. */
  maintainers: AquariumMaintainer[];
  /** SZÁRMAZTATOTT: igaz, ha legalább egy karbantartó van -- a régi
   * `Aquarium.maintainedByUs` oszlop helyett, lásd a séma fejlécét. */
  maintainedByUs: boolean;
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

/**
 * A VÍZÉRTÉK-PARAMÉTEREK KATALÓGUSA -- KÓDBAN RÖGZÍTETT, NEM SZABAD SZÖVEG.
 *
 * Balázs listája (2026-09-24 14:37), víztípus szerint két, részben eltérő
 * felsorolással. Az egység a PARAMÉTERHEZ kötött, nem választható -- ez a
 * katalógus az EGYETLEN hely, ahol a párosítás áll, és innen olvassa mind az
 * API-validáció, mind a web (és később a mobil) felület. Egy második,
 * kézzel másolt lista elcsúszhatna ettől -- pontosan az a fajta hiba, amit
 * a repó máshol (`packages/types/src/unit-of-measure.ts`) is egy közös
 * forrással előz meg.
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

export interface AquariumMeasurementParameterDefinition {
  code: AquariumMeasurementParameterCode;
  label: string;
  unit: string;
  /** Melyik víztípusnál értelmes. Lásd `aquariumMeasurementParametersFor`. */
  waterTypes: readonly WaterType[];
}

export const AQUARIUM_MEASUREMENT_PARAMETERS: readonly AquariumMeasurementParameterDefinition[] =
  [
    {
      code: "HOMERSEKLET",
      label: "Hőmérséklet",
      unit: "°C",
      waterTypes: ["EDESVIZI", "TENGERI"],
    },
    {
      code: "SOTARTALOM",
      label: "Sótartalom",
      unit: "ppt",
      waterTypes: ["TENGERI"],
    },
    { code: "SURUSEG", label: "Sűrűség", unit: "SG", waterTypes: ["TENGERI"] },
    {
      code: "PH",
      label: "pH",
      unit: "pH",
      waterTypes: ["EDESVIZI", "TENGERI"],
    },
    {
      code: "KH",
      label: "KH",
      unit: "dKH",
      waterTypes: ["EDESVIZI", "TENGERI"],
    },
    { code: "GH", label: "GH", unit: "dGH", waterTypes: ["EDESVIZI"] },
    {
      code: "KALCIUM",
      label: "Kalcium",
      unit: "mg/l",
      waterTypes: ["TENGERI"],
    },
    {
      code: "MAGNEZIUM",
      label: "Magnézium",
      unit: "mg/l",
      waterTypes: ["TENGERI"],
    },
    {
      code: "NITRAT",
      label: "Nitrát",
      unit: "mg/l",
      waterTypes: ["EDESVIZI", "TENGERI"],
    },
    {
      code: "FOSZFAT",
      label: "Foszfát",
      unit: "mg/l",
      waterTypes: ["EDESVIZI", "TENGERI"],
    },
    {
      code: "AMMONIA",
      label: "Ammónia",
      unit: "mg/l",
      waterTypes: ["EDESVIZI", "TENGERI"],
    },
    {
      code: "NITRIT",
      label: "Nitrit",
      unit: "mg/l",
      waterTypes: ["EDESVIZI", "TENGERI"],
    },
    {
      code: "SZILIKAT",
      label: "Szilikát",
      unit: "mg/l",
      waterTypes: ["TENGERI"],
    },
    { code: "ORP", label: "ORP", unit: "mV", waterTypes: ["TENGERI"] },
    { code: "VAS", label: "Vas", unit: "mg/l", waterTypes: ["EDESVIZI"] },
    { code: "REZ", label: "Réz", unit: "mg/l", waterTypes: ["EDESVIZI"] },
    {
      code: "VEZETOKEPESSEG",
      label: "Vezetőképesség",
      unit: "µS/cm",
      waterTypes: ["EDESVIZI"],
    },
  ];

const AQUARIUM_MEASUREMENT_PARAMETER_BY_CODE: Record<
  AquariumMeasurementParameterCode,
  AquariumMeasurementParameterDefinition
> = Object.fromEntries(
  AQUARIUM_MEASUREMENT_PARAMETERS.map((param) => [param.code, param]),
) as Record<
  AquariumMeasurementParameterCode,
  AquariumMeasurementParameterDefinition
>;

export function aquariumMeasurementParameter(
  code: AquariumMeasurementParameterCode,
): AquariumMeasurementParameterDefinition {
  return AQUARIUM_MEASUREMENT_PARAMETER_BY_CODE[code];
}

/**
 * MELYIK PARAMÉTEREK LÁTSZANAK EGY ADOTT VÍZTÍPUSNÁL.
 *
 * Balázs kérése: "Ha a víztípus nincs megadva, az összes paraméter
 * látszik." A `null`/`undefined` tehát nem hiba, hanem "mutass mindent" --
 * ugyanígy dönt az űrlap és a validáció is, mindkettő ezt a függvényt hívja.
 */
export function aquariumMeasurementParametersFor(
  waterType: WaterType | null | undefined,
): readonly AquariumMeasurementParameterDefinition[] {
  if (!waterType) return AQUARIUM_MEASUREMENT_PARAMETERS;
  return AQUARIUM_MEASUREMENT_PARAMETERS.filter((param) =>
    param.waterTypes.includes(waterType),
  );
}

/**
 * EGY KARBANTARTÓ, A VÁLASZTHATÓ LISTÁN ÉS AZ AKVÁRIUM SAJÁTJÁN IS.
 *
 * Lásd `apps/api/src/aquariums/aquarium-maintainer-assignment.ts`: csak
 * belső, `aquariums.manage` jogú kolléga választható, partner-fiók nem.
 */
export interface AquariumMaintainer {
  userId: string;
  displayName: string;
}

/**
 * EGY PARAMÉTER ÉRTÉKE EGY MÉRÉSI ALKALOMBAN.
 *
 * A `notes` SZÁNDÉKOSAN NEM EBBEN A TÍPUSBAN ÁLL: az alkalom egészéhez
 * tartozik (lásd `AquariumMeasurementOccasion.notes`), nem egy-egy
 * paraméterhez -- a séma soronként tárolja denormalizáltan, de a felület
 * és ez a típus az ALKALOM szintjén mutatja.
 */
export interface AquariumMeasurementValue {
  parameterCode: AquariumMeasurementParameterCode;
  value: number;
}

/**
 * EGY MÉRÉSI ALKALOM, A BENNE SZEREPLŐ PARAMÉTEREKKEL EGYÜTT.
 *
 * Balázs kérése: "egy mérés = egy mérési alkalom, több paraméterrel." Az
 * `id` a törléshez/hivatkozáshoz kell, és a mért időpont kódolt alakja --
 * lásd `apps/api/src/aquariums/aquarium-measurements.repository.ts`
 * fejlécét, miért nincs külön "alkalom" tábla.
 */
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

/**
 * ÚJ MÉRÉSI ALKALOM FELVITELE.
 *
 * A `measuredAt` ELHAGYHATÓ: a felület alapból a mostani időpontot küldi,
 * de a mezőt a szerver DTO-ja kéri (lásd ott), hogy a telefonos, később
 * felküldött mérésnél a rögzítés PILLANATA, ne a feltöltés ideje kerüljön a
 * sorra.
 */
export interface CreateAquariumMeasurementInput {
  measuredAt?: string;
  source?: string;
  notes?: string;
  values: AquariumMeasurementValue[];
}
