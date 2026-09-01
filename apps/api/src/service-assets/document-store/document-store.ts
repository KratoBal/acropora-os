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
}
