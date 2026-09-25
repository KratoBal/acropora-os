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
  /**
   * A PARTNER ALEGYSÉGE, AHOL AZ AKVÁRIUM ÁLL -- OPCIONÁLIS. Lásd az
   * `Aquarium.departmentId` séma-fejlécét: a meglévő akváriumok üresen
   * maradnak, és ez helyes, nem hiányzó adat.
   *
   * LAPOS PÁR, UGYANAZ A MINTA, MINT A `customerId`/`customerName`-NÉL --
   * nem beágyazott `WorksheetDepartmentSummary`, mert ez a lista/adatlap nem
   * a fát mutatja, csak a nevét.
   */
  departmentId?: string;
  departmentName?: string;
  systemVolumeLiters?: number;
  equipmentCount: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /**
   * A LISTA-PILOT KÉRÉSÉRE (acrobot, 2026-09-24 16:19), hogy a Figma-lista
   * "Karbantartók" és "Utolsó vízmérés" oszlopa valódi adatból menjen, ne
   * maradjon el. Egy batch-elt (nem soronkénti) lekérdezéssel jön, lásd
   * `AquariumsRepository.list` `listInclude`-ját.
   */
  maintainers: AquariumMaintainer[];
  lastMeasuredAt?: string;
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
  /** Az akvárium SAJÁT céltartományai, paraméterenként. Lásd az
   * `AquariumMeasurementTarget` és az `aquariumEffectiveMeasurementTargetRange`
   * fejlécét. */
  targets: AquariumMeasurementTarget[];
  /**
   * LÁTJA-E A HÍVÓ AZ "ESZKÖZÖK A MEDENCÉBEN" HOZZÁRENDELŐ FELÜLETÉT.
   *
   * FELHASZNÁLÓNKÉNTI, `AQUARIUM_ASSET_ASSIGN` `ServiceCapability`-jelölő
   * (emlék 1843, 1847), NEM szerep-szintű jog -- lásd
   * `AquariumsRepository.hasAquariumAssetAssignCapability` fejlécét. A
   * SZERVER számolja ki és adja a válaszban, mert ez egy GOMB
   * megjelenítéséről dönt egy egyébként mindenkinek látható adatlapon --
   * a kliens nem "próbálkozik és kap 403-at" (mint a
   * `MATERIAL_REQUEST_MARK_RECEIVED` egész-listás mintája), mert egy
   * hozzárendelés/levétel valódi mellékhatással jár, azt nem próbálgatjuk.
   */
  canAssignAssets: boolean;
}

/**
 * AKVÁRIUMONKÉNTI, PARAMÉTERENKÉNTI CÉLTARTOMÁNY -- A FELHASZNÁLÓ ÁLTAL
 * MEGADOTT, TÁROLT ÉRTÉK, NEM A KÓDBAN ÁLLÓ ALAPÉRTELMEZÉS.
 *
 * Balázs kérése (2026-09-25, Akváriumok szál, 05:47 UTC): "amikor rögzítjük
 * az akváriumot, akkor a jobb oldali oszlopban jó lenne egy beállítási
 * lehetőség a vízértékekre tól-ig, ami alapján számolja az eltérést."
 *
 * MINDKÉT HATÁR OPCIONÁLIS, ÉS EGYMÁSTÓL FÜGGETLENÜL AZ: csak alsó, csak
 * felső, vagy mindkét határ megadható. Ha egy paraméterhez nincs sor
 * (`targets`-ben nincs elem az adott `parameterCode`-dal), az az
 * `aquariumEffectiveMeasurementTargetRange` alapértelmezésre esik vissza,
 * NEM egy "min/max mindkettő hiányzik" sorra -- a kettő között a különbség
 * az, hogy KI ADTA MEG a tartományt, és ez befolyásolja, mi történik, ha a
 * felhasználó törli az egyik mezőt (üres sor, nem null határú sor marad).
 */
export interface AquariumMeasurementTarget {
  parameterCode: AquariumMeasurementParameterCode;
  min?: number;
  max?: number;
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

/**
 * A MEGLÉVŐ ÜGYFÉL KERESÉSÉNEK EREDMÉNYE, AZ AKVÁRIUM FELVITEL VÁLASZTÓJÁHOZ.
 *
 * SAJÁT, SZŰKÍTETT ALAK, NEM `CustomerSummary`: a `SERVICE` szerepkör nem
 * viseli a `customers.view`/`customers.manage` jogot (mérve
 * `packages/types/src/auth.ts` `ROLE_PERMISSIONS.SERVICE`), tehát a mobil
 * felvitel nem hívhatja a `/customers` végpontot -- ez a végpont
 * (`GET /aquariums/customers`) `aquariums.view` alatt fut, és csak a
 * megkülönböztetéshez elég mezőt ad, a `/assets/owners` mintájára.
 */
export interface AquariumSelectableCustomer {
  id: string;
  displayName: string;
  city?: string;
}

export interface AquariumSelectableCustomerListResponse {
  items: AquariumSelectableCustomer[];
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
  /** Lásd az `AquariumSummary.departmentId` fejlécét. Elhagyható. Ha meg van
   * adva, a megjelölt alegységnek UGYANAHHOZ az ügyfélhez kell tartoznia,
   * mint az akvárium `customerId`-je -- ezt a szolgáltatás-réteg ellenőrzi. */
  departmentId?: string;
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
  /** Lásd `AquariumMeasurementTarget` fejlécét. Elhagyható: egy sem
   * mentődik, ha üres vagy hiányzik. */
  targets?: AquariumMeasurementTarget[];
}

export interface UpdateAquariumInput {
  ownershipType?: AquariumOwnershipType;
  customerId?: string | null;
  newCustomer?: CreateCustomerInput;
  /** Lásd a `CreateAquariumInput.departmentId` fejlécét. `null` törli a
   * helyszínt. */
  departmentId?: string | null;
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
  /** Lásd `AquariumMeasurementTarget` fejlécét. HIÁNYZÓ mező (nem küldött
   * kulcs) a meglévő tartományokat változatlanul hagyja -- ugyanaz az elv,
   * mint a `ContractItemDto` `items`-énél. ÜRES TÖMB az összeset törli. */
  targets?: AquariumMeasurementTarget[];
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

/**
 * JAVASOLT CÉLTARTOMÁNY, PARAMÉTERENKÉNT -- NEM MÉRT ADAT, KÓDBAN ÁLLÓ
 * ALAPÉRTELMEZÉS.
 *
 * A "Mérési előzmények" oldal Figma terve céltartomány-sávot kér a
 * grafikonon (`exchange/figma-akvariumok-leiras-3-kor-meresi-elozmenyek-2026-09-24.md`,
 * 3. pont). A rendszerben MA nincs tárolt céltartomány-adat -- acrobot
 * kérésére (2026-09-24 17:11) egy kódban álló, paraméterenkénti
 * alapértelmezés a megoldás, VÍZTÍPUS SZERINT külön kulccsal, és
 * JELÖLVE, hogy javaslat, nem mérés.
 *
 * **CSAK TENGERI ÉRTÉKEK ÁLLNAK ITT, ÉS EZ SZÁNDÉKOS, NEM HIÁNYOSSÁG.** A
 * Figma minta (`TENGERI_PARAM_META`) mind a 12 tengeri paraméterre ad
 * tartományt -- ezeket vettük át betűre, mert a TERV MAGA adta forrásként.
 * Édesvízi tartományt NEM találtunk ki: a tengeri és édesvízi vízkémia
 * jelentősen eltér UGYANAZON paraméternél is (pl. a tengeri pH-cél 8,1-8,4,
 * az édesvízi közösségi akváriumoké tipikusan 6,5-7,5) -- egy átvett
 * tengeri szám itt nem hiányzó adatnak látszana, hanem TÉVES tanácsnak, és
 * ez valódi kárt okozhatna (rossz adagolás). Ha az édesvízi tartomány
 * kell, az Balázstól vagy egy szakmai forrásból kérendő, nem kitalálható.
 */
export const AQUARIUM_MEASUREMENT_TARGET_RANGE: Partial<
  Record<AquariumMeasurementParameterCode, { min: number; max: number }>
> = {
  HOMERSEKLET: { min: 24, max: 27 },
  SOTARTALOM: { min: 34, max: 36 },
  PH: { min: 8.1, max: 8.4 },
  KH: { min: 7, max: 9 },
  KALCIUM: { min: 380, max: 450 },
  MAGNEZIUM: { min: 1250, max: 1350 },
  NITRAT: { min: 0, max: 10 },
  FOSZFAT: { min: 0, max: 0.1 },
  AMMONIA: { min: 0, max: 0.05 },
  NITRIT: { min: 0, max: 0.05 },
  SZILIKAT: { min: 0, max: 1 },
  ORP: { min: 350, max: 400 },
};

/**
 * A `AQUARIUM_MEASUREMENT_TARGET_RANGE` TENGERI ÉRTÉKEI, TEHÁT A
 * VISSZAADOTT SÁV CSAK `TENGERI` VÍZTÍPUSNÁL JELENJEN MEG A FELÜLETEN.
 * `EDESVIZI`-nél mindig `undefined`-et ad, lásd a konstans fejlécét.
 */
export function aquariumMeasurementTargetRange(
  waterType: WaterType | null | undefined,
  code: AquariumMeasurementParameterCode,
): { min: number; max: number } | undefined {
  if (waterType !== "TENGERI") return undefined;
  return AQUARIUM_MEASUREMENT_TARGET_RANGE[code];
}

/**
 * A TÉNYLEGESEN ÉRVÉNYES CÉLTARTOMÁNY EGY ADOTT AKVÁRIUMRA -- EZT HASZNÁLJA
 * MINDEN ELTÉRÉS-SZÁMÍTÁS (adatlap vízérték-csempék, mérési előzmények
 * grafikonja), NEM közvetlenül az `aquariumMeasurementTargetRange`-et.
 *
 * KÉTSZINTŰ VISSZAESÉS, Balázs szavával (2026-09-25): "ha nincs megadva, az
 * alapértékből; ha az sincs, nincs eltérés-jelzés."
 *
 *   1. Ha az akváriumnak VAN SAJÁT SORA erre a paraméterre (akár csak `min`,
 *      akár csak `max`, akár mindkettő), AZT adja vissza EGÉSZBEN -- a
 *      hiányzó oldalt NEM tölti ki a kódban álló alapértékből. Egy csak alsó
 *      határt megadó sor tehát szándékosan csak alulra jelez eltérést.
 *   2. Ha nincs saját sor erre a paraméterre, a kódban álló alapértelmezésre
 *      esik vissza (`aquariumMeasurementTargetRange`, csak tengeri víznél).
 *   3. Ha egyik sincs, `undefined` -- nincs mit kirajzolni.
 *
 * A MIN/MAX EZÉRT OPCIONÁLIS A VISSZAADOTT ÉRTÉKBEN IS: minden hívó helynek
 * `range.min !== undefined`/`range.max !== undefined` őrzővel kell
 * összehasonlítania, nem feltételezheti, hogy mindkettő megvan.
 */
export function aquariumEffectiveMeasurementTargetRange(
  waterType: WaterType | null | undefined,
  code: AquariumMeasurementParameterCode,
  targets: readonly AquariumMeasurementTarget[] | undefined,
): { min?: number; max?: number } | undefined {
  const own = targets?.find((target) => target.parameterCode === code);
  if (own && (own.min !== undefined || own.max !== undefined))
    return { min: own.min, max: own.max };
  return aquariumMeasurementTargetRange(waterType, code);
}

/**
 * MEGKÜLÖNBÖZTETHETŐ SZÍN PARAMÉTERENKÉNT, A GRAFIKONHOZ -- TISZTÁN
 * VIZUÁLIS VÁLASZTÁS, NEM VÍZKÉMIAI ÁLLÍTÁS (ezért a fenti céltartomány-
 * fejléc óvatossága itt nem indokolt: egy szín félrevétele nem tanácsol
 * senkinek semmi rosszat). A tengeri 12 szín a Figma tervből jön betűre;
 * a négy csak-édesvízi paraméter (GH, VAS, REZ, VEZETOKEPESSEG) új,
 * a meglévő skálától vizuálisan elütő szín.
 */
export const AQUARIUM_MEASUREMENT_PARAMETER_COLOR: Record<
  AquariumMeasurementParameterCode,
  string
> = {
  HOMERSEKLET: "#e85d3a",
  SOTARTALOM: "#7c5c3a",
  SURUSEG: "#0e7490",
  PH: "#6366f1",
  KH: "#0b7a6e",
  GH: "#65a30d",
  KALCIUM: "#0a6bbd",
  MAGNEZIUM: "#7c3ab0",
  NITRAT: "#d97706",
  FOSZFAT: "#059669",
  AMMONIA: "#dc2626",
  NITRIT: "#db2777",
  SZILIKAT: "#9ca3af",
  ORP: "#374049",
  VAS: "#b45309",
  REZ: "#0d9488",
  VEZETOKEPESSEG: "#4338ca",
};
