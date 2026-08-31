import type { AssetStatus } from "./asset-fields";

/**
 * EGY STATUSZNAK EGY NEVE VAN, ES EZ AZ A HELY.
 *
 * A tabla eddig HAROM helyen allt a telefonon (a lista csempejen, az adatlapon
 * es a szerkesztoben), es a harom kozul a SZERKESZTO elcsuszott: ott `Uzemel`
 * es `Kivonva` allt, mindenhol maskepp `Aktiv` es `Kivezetett`. Vagyis a
 * szerelo beallitott egy erteket az egyik neven, es utana mindenhol a masikat
 * latta -- ket koppintasra egymastol, ugyanazon a telefonon.
 *
 * A SZOHASZNALAT NEM VALASZTAS VOLT, HANEM TOBBSEG: a webes felulet, a lista
 * csempeje es az adatlap egyarant `Kivezetett` alakot mond, es Balazs is vegig
 * „kivezetes"-t mondott, amikor eldontotte, hogy ez a fo ut a torles helyett.
 * A `Kivonva` tehat nem egy masik ervenyes szo, hanem egy negyedik hely, ami
 * lemaradt.
 */
export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  ACTIVE: "Aktív",
  OUT_OF_SERVICE: "Nem üzemel",
  IN_REPAIR: "Javítás alatt",
  RETIRED: "Kivezetett",
};

/**
 * A VALASZTO SORRENDJE KULON ALL, ES SZANDEKOSAN.
 *
 * A cimke-tabla kulcsainak sorrendjere epiteni azt jelentene, hogy egy
 * felulettol fuggo dolog (mit lat elsonek a szerelo) egy objektum-literal
 * sorrendjen mulik. Kulon lista mellett a sorrend SZANDEK, es a teljesseget
 * teszt orzi.
 */
export const ASSET_STATUS_ORDER: readonly AssetStatus[] = [
  "ACTIVE",
  "OUT_OF_SERVICE",
  "IN_REPAIR",
  "RETIRED",
];

export const ASSET_STATUS_OPTIONS: { value: AssetStatus; label: string }[] =
  ASSET_STATUS_ORDER.map((value) => ({
    value,
    label: ASSET_STATUS_LABELS[value],
  }));
