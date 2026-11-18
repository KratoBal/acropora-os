/**
 * A HIBAJEGY-LISTA SZÖVEGEI (acrobot 56224, c pont; Balázs 2026-11-18: "a karbantartásnak semmi köze a hibajegyekhez"): a telefonon a karbantartási lapoknak saját listájuk van (`maintenance-list-copy.ts`), a hibajegy-lista `kind=REPAIR`-t kér,
 * ezért a szövegei csak a hibajegyet nevezik meg. A szövegek adatok, nem beágyazott szövegek a jelölésben: egy állítás tud rájuk szólni, és a képernyő használata is mérhető.
 */
export const SERVICE_JOB_LIST_COPY = {
  /** A lista fejlécének címe a navigátorban. */
  screenTitle: "Hibajegyek",
  /** A jogosultság hiánya. */
  noAccess:
    "Nincs hozzáférésed a hibajegyekhez. Ha ez tévedés, szólj az irodának.",
  /** A szűrés, ami kapcsolatot kér. */
  scopeNeedsConnection:
    "Ehhez a szűréshez kapcsolat kell: a mentett másolat egy része még nem tudja, kire van kiosztva egy hibajegy. A többi szűrő offline is működik.",
  /** Üres szűrés, kapcsolattal. */
  emptyFiltered: "Ebben a szűrésben nincs hibajegy.",
  /** Üres lista, kapcsolat és mentett másolat nélkül. */
  emptyOffline: "Nincs kapcsolat, és nincs mentett hibajegy ezen a készüléken.",
  /** A telefon képességei: a hibajegy olvasható, léptethető, fényképezhető és nyitható. */
  capabilities:
    "Telefonon a hibajegy olvasható, léptethető, fényképet lehet rátenni, és új hibajegy is nyitható: a fenti gombbal vagy a gép adatlapjáról (Eszközök, majd Hibajegy nyitása). Mindkét úton a gépből következik a partner és a helyszín. Partnert váltani és delegálni a webes felületen lehet.",
  /** A tile leírása a kezdőlapon. */
  tileDescription: "Nyitott hibajegyek, léptetés és fénykép a helyszínen",
} as const;
