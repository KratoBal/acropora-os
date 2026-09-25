/**
 * A VÍZMÉRÉS FELVITEL ŰRLAP LOGIKÁJA, a képernyőtől külön -- ugyanazért az
 * okért, mint az `aquarium-create.ts` fejlécében: ebben a csomagban nincs
 * komponens-teszt eszköz, tehát ami tesztelhető kell legyen, azt ide kell
 * tenni.
 *
 * A PARAMÉTER-KATALÓGUS SAJÁT, SZERKEZETI MÁSOLAT, NEM
 * `@acropora/types`-ból jön -- lásd `aquarium-create.ts` fejlécét, miért
 * (a teszt-fordító nem ismeri a `@/` aliast, és egy import bevonná a
 * `client.ts`-t, azon keresztül az Expo futtatókörnyezetet). A katalógus
 * SZÓ SZERINT tükrözi a szerver forrását
 * (`packages/types/src/aquarium-management.ts` `AQUARIUM_MEASUREMENT_PARAMETERS`,
 * murena #1055-ös ága) -- ha az ottani lista bővül, ez a másolat NÉMÁN
 * elmarad tőle, tehát a párhuzamos forrást csak addig szabad fenntartani,
 * amíg a mobil nem tud a közös csomagból olvasni.
 */

export type WaterType = "EDESVIZI" | "TENGERI";

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

/**
 * MELYIK PARAMÉTEREK LÁTSZANAK EGY ADOTT VÍZTÍPUSNÁL.
 *
 * Balázs kérése: "Ha a víztípus nincs megadva, az összes paraméter
 * látszik." -- ugyanaz a döntés, mint a szerver `aquariumMeasurementParametersFor`-ja.
 */
export function aquariumMeasurementParametersFor(
  waterType: WaterType | null | undefined,
): readonly AquariumMeasurementParameterDefinition[] {
  if (!waterType) return AQUARIUM_MEASUREMENT_PARAMETERS;
  return AQUARIUM_MEASUREMENT_PARAMETERS.filter((param) =>
    param.waterTypes.includes(waterType),
  );
}

const AQUARIUM_MEASUREMENT_PARAMETER_BY_CODE: Record<
  AquariumMeasurementParameterCode,
  AquariumMeasurementParameterDefinition
> = Object.fromEntries(
  AQUARIUM_MEASUREMENT_PARAMETERS.map((param) => [param.code, param]),
) as Record<
  AquariumMeasurementParameterCode,
  AquariumMeasurementParameterDefinition
>;

/**
 * EGY PARAMÉTER LEÍRÁSA A KÓDJÁBÓL -- A MEGJELENÍTÉSHEZ.
 *
 * Az adatlap egy MÁR MENTETT alkalom sorait mutatja, ahol nincs víztípus-
 * szűrés: egy korábban, más víztípus mellett rögzített érték (pl. a víztípus
 * utólag módosult) is megjelenjen a maga címkéjével és egységével.
 */
export function aquariumMeasurementParameter(
  code: AquariumMeasurementParameterCode,
): AquariumMeasurementParameterDefinition {
  return AQUARIUM_MEASUREMENT_PARAMETER_BY_CODE[code];
}

export interface AquariumMeasurementValue {
  parameterCode: AquariumMeasurementParameterCode;
  value: number;
}

export interface CreateAquariumMeasurementInput {
  measuredAt?: string;
  source?: string;
  notes?: string;
  values: AquariumMeasurementValue[];
}

/** A paraméter-sor az űrlapon: szöveg, hogy üres is lehessen. */
export interface AquariumMeasurementValueForm {
  parameterCode: AquariumMeasurementParameterCode;
  text: string;
}

export interface AquariumMeasurementForm {
  notes: string;
  values: AquariumMeasurementValueForm[];
  /**
   * A MÉRÉS IDEJE -- MOSTANTÓL SZERKESZTHETŐ (Balázs kérése, 2026-09-25:
   * "elofordulhat, hogy nem akkor mertuk, amikor rogzitjuk"). Ez a mező
   * ETTŐL FÜGGETLENÜL MINDIG tart egy értéket (a form megnyitásakor "most"),
   * mert a képernyőnek meg kell jelenítenie valamit -- a `measuredAtTouched`
   * dönti el, hogy ezt KÜLDJÜK-e, vagy a TÉNYLEGES MENTÉS PILLANATÁT (lásd
   * `buildAquariumMeasurementPayload` fejlécét). Amíg a felhasználó nem
   * nyúl a mezőhöz, a megjelenített "most" a hosszan nyitva tartott
   * oldalon mire a mentés megtörténik, már elavult lenne -- ugyanaz a
   * csapda, amit ez a mező korábban a teljes hiányával kerülgetett.
   */
  measuredAtDate: Date;
  measuredAtTouched: boolean;
}

/**
 * ÜRES ŰRLAP, A VÍZTÍPUSHOZ TARTOZÓ PARAMÉTER-SORRENDDEL.
 *
 * A `now` PARAMÉTER TESZTELHETŐSÉG MIATT KÜLÖN: a `measuredAtDate` kezdő-
 * értéke enélkül minden híváskor más lenne, és egy teszt nem tudná
 * rögzíteni, mit várt.
 */
export function emptyAquariumMeasurementForm(
  waterType: WaterType | null | undefined,
  now: Date = new Date(),
): AquariumMeasurementForm {
  return {
    notes: "",
    values: aquariumMeasurementParametersFor(waterType).map((param) => ({
      parameterCode: param.code,
      text: "",
    })),
    measuredAtDate: now,
    measuredAtTouched: false,
  };
}

/**
 * A DÁTUM- ÉS AZ IDŐ-VÁLASZTÓ KÜLÖN NATÍV VEZÉRLŐ, MERT AZ ANDROID NEM TUD
 * EGYETLEN "datetime" MÓDOT (`@react-native-community/datetimepicker`
 * README: `"datetime"` csak iOS-en él). Ez a függvény a két választó
 * eredményét egyesíti egyetlen `Date`-té: az egyik hívás a NAP részét adja
 * (év/hónap/nap), a másik az ÓRA részét (óra/perc), a nem-érintett rész a
 * MEGLÉVŐ értékből marad.
 */
export function combineDateAndTime(
  base: Date,
  changed: Date,
  part: "date" | "time",
): Date {
  const result = new Date(base);
  if (part === "date") {
    result.setFullYear(
      changed.getFullYear(),
      changed.getMonth(),
      changed.getDate(),
    );
  } else {
    result.setHours(changed.getHours(), changed.getMinutes(), 0, 0);
  }
  return result;
}

/** A bemenet: szám, tizedesponttal vagy -vesszővel, előjel nélkül -- a
 * vízértékek (pl. vezetőképesség, sótartalom) tágabb tartományúak, mint az
 * akvárium mérete, ezért ez KÜLÖN, megengedőbb minta, nem az
 * `aquarium-create.ts` `DECIMAL_PATTERN`-je. */
const MEASUREMENT_VALUE_PATTERN = /^\d{1,7}(?:[.,]\d{1,4})?$/;

export function normalizeMeasurementValueText(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".");
  if (trimmed === "") return null;
  if (!MEASUREMENT_VALUE_PATTERN.test(trimmed)) return null;
  return Number(trimmed);
}

export type AquariumMeasurementCreateField =
  "values" | `values.${number}` | "measuredAt";

export type AquariumMeasurementCreateResult =
  | { ok: true; payload: CreateAquariumMeasurementInput }
  | { ok: false; field: AquariumMeasurementCreateField; message: string };

/**
 * A TELJES ŰRLAP EGY SZERVER-KÉSZ TÖRZZSÉ -- VAGY EGY MEGNEVEZETT HIBA.
 *
 * CSAK A KITÖLTÖTT PARAMÉTEREK MENTŐDNEK (brief 1. döntés) -- az üres sorok
 * kimaradnak a törzsből, nem hibáznak. LEGALÁBB EGY érték kell (a szerver
 * `@ArrayMinSize(1)`-je is ezt kéri): egy teljesen üres alkalom nem
 * mérés, hanem semmi.
 *
 * A `measuredAt` A TÖRZSBEN CSAK AKKOR SZEREPEL, HA A FELHASZNÁLÓ TÉNYLEG
 * HOZZÁNYÚLT (`measuredAtTouched`). Ha nem, `undefined` megy -- a hívó
 * (a képernyő `mutationFn`-je) ilyenkor a TÉNYLEGES MENTÉS PILLANATÁT írja
 * be, nem ezt a formot. Ez ugyanaz a szabály, amit a mező korábban a
 * teljes hiányával tartott be; a szerkeszthetőség ezt nem törli el, csak
 * feltételessé teszi.
 *
 * A JÖVŐBELI IDŐPONT ITT IS ELUTASÍTVA, UGYANAZZAL A SZÖVEGGEL, MINT A
 * SZERVEREN (`aquarium-measurements.service.ts` `rejectFutureMeasuredAt`):
 * az akvárium ma nem tud olyan mérést, amit még nem végeztek el, és a
 * kliens-oldali elutasítás egy hálózati kör nélkül adja ugyanezt a választ.
 */
export function buildAquariumMeasurementPayload(
  form: AquariumMeasurementForm,
): AquariumMeasurementCreateResult {
  if (form.measuredAtTouched && form.measuredAtDate.getTime() > Date.now())
    return {
      ok: false,
      field: "measuredAt",
      message: "A mérés ideje nem lehet a jövőben.",
    };

  const values: AquariumMeasurementValue[] = [];
  for (const [index, row] of form.values.entries()) {
    if (row.text.trim() === "") continue;
    const value = normalizeMeasurementValueText(row.text);
    if (value === null)
      return {
        ok: false,
        field: `values.${index}`,
        message: "Az érték csak szám lehet.",
      };
    values.push({ parameterCode: row.parameterCode, value });
  }

  if (values.length === 0)
    return {
      ok: false,
      field: "values",
      message: "Legalább egy paramétert ki kell tölteni.",
    };

  return {
    ok: true,
    payload: {
      measuredAt: form.measuredAtTouched
        ? form.measuredAtDate.toISOString()
        : undefined,
      notes: form.notes.trim() || undefined,
      values,
    },
  };
}
