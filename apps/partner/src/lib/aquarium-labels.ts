import type { WaterType } from "@acropora/types";

/**
 * KIS, ÖNÁLLÓ CÍMKE-FÁJL -- UGYANAZ A MINTA, MINT AZ `eszkoz-azonosito.ts`.
 *
 * Nem a `apps/web` `aquarium-labels.ts`-ből importál, mert az a fájl nincs
 * megosztott csomagban (lásd a fejlécét: `apps/web/src/components/...`) --
 * a portál a saját, kis másolatát tartja, ugyanúgy, ahogy a belső eszköz-
 * címkéknek sincs közös csomagja.
 */
export const WATER_TYPE_LABEL: Record<WaterType, string> = {
  EDESVIZI: "Édesvízi",
  TENGERI: "Tengeri",
};
