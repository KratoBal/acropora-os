/**
 * A KARBANTARTÁS LISTA SZÖVEGEI (acrobot 56224; Balázs 2026-11-18 11:31: a karbantartási lap nem hibajegy). Adatok, nem beágyazott szövegek: egy állítás tud rájuk szólni, és a képernyő használata is mérhető.
 * A hibajegy-lista szövegei külön állnak (`list-copy.ts`), és mindkét fajtát megnevezik: ez a lista csak a karbantartási lapokat mutatja.
 *
 * RELATÍV UT, NEM `@/` ALIAS: ez a modul spec-ből is behúzódik (lásd a `tsconfig.test.json` fejlécét).
 */
export const MAINTENANCE_LIST_COPY = {
  /** A lista fejlécének címe a navigátorban. */
  screenTitle: "Karbantartás",
  /** A jogosultság hiánya. */
  noAccess:
    "Nincs hozzáférésed a karbantartási lapokhoz. Ha ez tévedés, szólj az irodának.",
  /** A tile leírása a kezdőlapon. */
  tileDescription: "Karbantartási lapok: folyamatban, kész, összes",
  /** A lista neve az offline sávban. */
  noticeListName: "a karbantartási lapok listája",
  /** Üres lista, kapcsolat és mentett másolat nélkül. */
  emptyOffline:
    "Nincs kapcsolat, és nincs mentett karbantartási lap ezen a készüléken.",
  /** A telefon képessége: olvasás, az állapotváltás a lapon nincs. */
  capabilities:
    "A karbantartási lapon nincs állapotváltás: az aláírt munkalap a kész.",
  /** Üres fül, kapcsolattal. */
  empty: {
    progress:
      "Folyamatban lévő karbantartási lap jelenleg nincs. A készeket a Kész fülön nézheted meg.",
    done: "Kész karbantartási lap még nincs.",
    all: "Nincs karbantartási lap.",
  },
  /** A mentett sorok közül ennyinek a készsége nem ismert, ezért csak az Összes fülön látszanak. */
  unknownNotice: (count: number) =>
    `${count} mentett karbantartási lap készsége kapcsolat nélkül nem ismert: ezek csak az Összes fülön látszanak.`,
} as const;
