import type { AssetKind } from "./asset-fields";

/**
 * EGY FAJTÁNAK EGY NEVE VAN, ES EZ AZ A HELY.
 *
 * A tábla eddig KÉT helyen állt a telefonon, egymástól függetlenül leírva
 * (az adatlapon `KIND_LABELS` néven, a felvitel űrlapon `kinds` tömbként),
 * és a kettő között semmi nem vette volna észre egy elcsúszást -- ugyanaz a
 * hibafajta, ami az állapotnevekkel (`asset-status.ts`) és a kritikusság
 * szavaival (`asset-criticality.ts`) már egyszer megtörtént, és ezért lettek
 * kiemelve. A "kind" a HARMADIK szótár, ami ugyanígy jár.
 */
export const ASSET_KIND_LABELS: Record<AssetKind, string> = {
  SYSTEM: "Rendszer",
  EQUIPMENT: "Berendezés",
  COMPONENT: "Részegység",
  SENSOR: "Szenzor",
  OTHER: "Egyéb",
};

/**
 * A VÁLASZTÓ SORRENDJE KÜLÖN ÁLL, ÉS SZÁNDÉKOSAN.
 *
 * A `Record` a NYELV: melyik érték hogy hívjuk. A tömb a MEGJELENÍTÉS:
 * milyen sorrendben kínáljuk. A kettő nem ugyanaz a döntés -- lásd
 * `asset-status.ts` és `asset-criticality.ts` ugyanezt a szétválasztást.
 */
export const ASSET_KIND_ORDER: readonly AssetKind[] = [
  "SYSTEM",
  "EQUIPMENT",
  "COMPONENT",
  "SENSOR",
  "OTHER",
];

export const ASSET_KIND_OPTIONS: { value: AssetKind; label: string }[] =
  ASSET_KIND_ORDER.map((value) => ({
    value,
    label: ASSET_KIND_LABELS[value],
  }));
