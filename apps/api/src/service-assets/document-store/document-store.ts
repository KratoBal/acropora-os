/**
 * A DOKUMENTUM-TÁROLÓ PORTJA: az a felület, amin át a szolgáltatás elér egy
 * eszközhöz tartozó fájlt, anélkül hogy tudná, hol van.
 *
 * MIÉRT PORT, ÉS MIÉRT NEM EGY KÖZVETLEN FÁJLMŰVELET: a tárolónak két
 * megvalósítása lesz, egy memóriabeli és egy fájlrendszeres, és a kettőnek
 * AZONOSAN kell viselkednie. Ha a hívó közvetlenül fájlt írna, a teszt-suite
 * minden eszköz-tesztje csatolt könyvtárat kívánna, és az egy új globális
 * előfeltétel lenne az egész csomagnak.
 *
 * A KULCS KÉT RÉSZBŐL ÁLL, és ez szándékos: a fájlrendszeres megvalósításnak
 * ellenőriznie kell, hogy az összerakott útvonal a gyökér ALATT marad. Egy
 * előre összefűzött szöveg ezt már nem engedné meg, mert a határ eltűnne benne.
 */
export interface DocumentKey {
  assetId: string;
  documentId: string;
}

/**
 * A TÁROLÓ BEÁLLÍTOTTSÁGA. Három állapot, mert kettő nem elég: az a könyvtár,
 * amit senki nem csatolt, és az a könyvtár, ami ott van, de nem írható, KÉT
 * különböző hiba, és más oldja fel őket. Egy közös „nem működik" mindkettőt
 * ugyanahhoz az emberhez küldené.
 *
 * A `reason` mező azért kötelező a két hibás ágon, mert egy állapot, ami nem
 * mondja meg, MIT mért, ugyanolyan használhatatlan, mint egy típus nélküli
 * korlát: túléli a feltételt, ami létrehozta.
 */
export type DocumentStoreStatus =
  | { state: "ready" }
  | { state: "not-configured"; reason: string }
  | { state: "broken"; reason: string };

export interface DocumentStore {
  put(key: DocumentKey, bytes: Uint8Array): Promise<void>;
  get(key: DocumentKey): Promise<Uint8Array | null>;
  delete(key: DocumentKey): Promise<boolean>;
  describe(): Promise<DocumentStoreStatus>;

  /**
   * AMI A TÁROLÓBAN ÁLL, a hívó kulcs-listája nélkül.
   *
   * MIÉRT KELL, HA MINDEN FÁJLNAK VAN SORA: azért, mert épp ez az, amit nem
   * tudunk. A tábla `SUM("sizeBytes")` értéke és a tárolóban álló fájlok
   * halmaza két KÜLÖN mérés, és ha eltérnek, az önmagában lelet -- vagy egy
   * elárvult fájl (van fájl, nincs sor), vagy egy elveszett sor (van sor, nincs
   * fájl). A kettő MÁS teendő, és a különbségük nélkül egyik sem látszik.
   *
   * A VISSZAADOTT ALAK A KULCS, NEM AZ ÚTVONAL: a hívónak a `DocumentKey`-jel
   * kell összevetnie, és egy útvonalból visszafejteni a kulcsot ugyanaz a
   * törékeny lépés lenne, amit a kétrészes kulcs épp elkerül.
   *
   * FOLYAM, NEM TÖMB, ÉS EZ NEM ELŐRELÁTÁS, HANEM A MÉRÉS VÉDELME: ha egyszer
   * sok ezer fájl áll a köteten, egy mindent egyszerre visszaadó hívás magát az
   * összevetést tenné kockázattá -- épp azt a mérést, aminek a baj MEGTALÁLÁSA
   * a dolga. Egy mérőeszköz, ami elszáll a nagy bemeneten, akkor mond csődöt,
   * amikor a legnagyobb szükség lenne rá.
   *
   * A hívó dönti el, gyűjt-e: a `collectDocumentKeys` segéd egybe szedi, és a
   * neve kimondja, hogy mindent bent tart.
   */
  list(): AsyncIterable<DocumentKey>;
}

/**
 * A FOLYAM EGYBE SZEDVE, ha a hívónak tényleg az egész halmaz kell.
 *
 * KÜLÖN FÜGGVÉNY ÉS NEM ALAPÉRTELMEZÉS, mert a neve mondja meg, mi történik:
 * ez a hívás MINDENT bent tart a memóriában. Aki ezt írja le, választott; aki
 * egy tömböt visszaadó `list()`-et hívna, nem is tudná, hogy választott.
 */
export async function collectDocumentKeys(
  keys: AsyncIterable<DocumentKey>,
): Promise<DocumentKey[]> {
  const collected: DocumentKey[] = [];
  for await (const key of keys) collected.push(key);
  return collected;
}
