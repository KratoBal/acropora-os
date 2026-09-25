import type { WaterBodyType, WaterType } from "@acropora/types";

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

/**
 * A LISTA "TÍPUS" SZŰRŐJÉHEZ/OSZLOPÁHOZ, a pilot-kör (2026-09-25, emlék
 * 1847) óta -- a portál előtte nem mutatta ezt a mezőt.
 */
export const WATER_BODY_LABEL: Record<WaterBodyType, string> = {
  AKVARIUM: "Akvárium",
  TO: "Tó",
};
