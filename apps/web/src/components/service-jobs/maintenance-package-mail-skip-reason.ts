import type {
  MaintenancePackageMailSendSkipReason,
  MaintenancePackageMailSkipReason,
} from "@acropora/types";

/**
 * AZ ÖT (ELŐNÉZET) ÉS HÉT (KÜLDÉS) KIHAGYÁSI OK -- A HIBAJEGYES
 * `handover-mail-skip-reason.ts` MINTÁJA, eggyel rövidebb listával: a
 * karbantartási lap `customerId`-ja közvetlenül a szerződés vevőjére mutat,
 * nincs "helyszín gazdátlan" eset (`no-department`).
 *
 * `Record<...>`, NEM `switch` alapértelmezett ággal, ugyanazért, amiért a
 * hibajegyes párja: egy új szerver-oldali ok itt FORDÍTÁSI HIBA legyen, ne
 * néma "ismeretlen ok" a kezelőnek.
 */
export const KIHAGYAS_OKA: Record<MaintenancePackageMailSkipReason, string> = {
  "mail-off":
    "A levélküldés ki van kapcsolva ezen a környezeten, ezért most nem megy ki semmi. Ez üzemeltetési beállítás.",
  "path-off":
    "A levélküldés be van kapcsolva, de a karbantartási csomag levele külön ki van kapcsolva. Ez is üzemeltetési beállítás, és a többi levéltípust nem érinti.",
  "no-redirect":
    "A levélküldés be van kapcsolva, de nincs megadva, hová menjenek a levelek. Amíg ez hiányzik, egyetlen levél sem megy ki senkinek. Ez üzemeltetési beállítás.",
  "no-customer":
    "A karbantartási laphoz nem tartozik vevő, ezért a címzettek nem állapíthatók meg. Ez törzsadat-hiba.",
  "no-recipient":
    "Az ügyfélnek nincs aktív portál-felhasználója, ezért nincs kinek kiküldeni. A hozzáférést az ügyfélnél kell létrehozni.",
};

export const KULDES_KIHAGYAS_OKA: Record<
  MaintenancePackageMailSendSkipReason,
  string
> = {
  ...KIHAGYAS_OKA,
  "no-sender":
    "A levélküldő nincs beállítva ezen a környezeten, ezért a levél nem ment ki. A címzettekkel nincs baj: ez üzemeltetési beállítás.",
  "no-job":
    "A karbantartási lap a küldés pillanatában már nem volt elérhető. Frissítsd az oldalt, és nézd meg, létezik-e még a lap.",
};
