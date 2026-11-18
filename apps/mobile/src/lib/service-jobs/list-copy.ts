/**
 * A HIBAJEGY-LISTA SZÖVEGEI (hibajegy-maradek lista, 4. fejezet, acrobot 56196; Balázs 2026-11-18: "a karbantartásnak semmi köze a hibajegyekhez"): a telefon minden listahívása `kind=ALL`,
 * tehát a lista a hibajegyeket ÉS a karbantartási lapokat együtt mutatja. Ezért itt a mondat mindkettőt nevezi meg, nem csak a hibajegyet. A szövegek adatok, nem beágyazott szövegek a
 * jelölésben: egy állítás tud rájuk szólni, és a képernyő használata is mérhető.
 *
 * RELATÍV UT, NEM `@/` ALIAS: ez a modul spec-ből is behúzódik (lásd a `tsconfig.test.json` fejlécét).
 */
import { BOTH_NOUN, BOTH_NOUN_PLURAL } from "./job-words";

export const SERVICE_JOB_LIST_COPY = {
  /** A lista fejlécének címe a navigátorban. */
  screenTitle: "Hibajegyek és karbantartás",
  /** A jogosultság hiánya. */
  noAccess:
    "Nincs hozzáférésed a hibajegyekhez és a karbantartási lapokhoz. Ha ez tévedés, szólj az irodának.",
  /** A szűrés, ami kapcsolatot kér. */
  scopeNeedsConnection: `Ehhez a szűréshez kapcsolat kell: a mentett másolat egy része még nem tudja, kire van kiosztva egy ${BOTH_NOUN}. A többi szűrő offline is működik.`,
  /** Üres szűrés, kapcsolattal. */
  emptyFiltered: `Ebben a szűrésben nincs ${BOTH_NOUN}.`,
  /** Üres lista, kapcsolat és mentett másolat nélkül. */
  emptyOffline: `Nincs kapcsolat, és nincs mentett ${BOTH_NOUN} ezen a készüléken.`,
  /** A telefon képességei: a hibajegyre vonatkozik, a karbantartási lap tiltása a szerveré. */
  capabilities:
    "Telefonon a hibajegy olvasható, léptethető, fényképet lehet rátenni, és új hibajegy is nyitható: a fenti gombbal vagy a gép adatlapjáról (Eszközök, majd Hibajegy nyitása). Mindkét úton a gépből következik a partner és a helyszín. Partnert váltani és delegálni a webes felületen lehet. A karbantartási lapon nincs állapotváltás: az aláírt munkalap a kész.",
  /** A tile leírása a kezdőlapon. */
  tileDescription: `Nyitott ${BOTH_NOUN_PLURAL}, léptetés és fénykép a helyszínen`,
} as const;
