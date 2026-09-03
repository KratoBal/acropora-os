/**
 * A BEOLVASOTT MATRICAKOD ELLENORZESE A GYORSITOTAR ELLEN, TERERO NELKUL.
 *
 * Balazs kerdese ez volt, hogy a pincében felvitt eszkoznel mi akadalyozza meg,
 * hogy ugyanaz a kod ketszer kerüljon fel. A valasz harom lepesbol all, es a
 * harmadik nem itt tortenik:
 *
 *   1. ha a gyorsitotarban VAN ilyen kod, a felvitel itt helyben megall;
 *   2. ha NINCS, a felvitel mehet, DE a felulet kiirja, hany eszkoz ellen
 *      ellenoriztunk es mikori az adat;
 *   3. a vegleges egyediseget a szinkron donti el, a szerveren.
 *
 * === MIERT BIZONYIT EZ CSAK AZ EGYIK IRANYBAN ===
 *
 * A gyorsitotar legfeljebb HUSZ lapot tolt le, otvenes lapmerettel
 * (`DEFAULT_MAX_PAGES` = 20, `PAGE_SIZE` = 50) -- ezer eszkozig tehat teljes.
 * Ezen felul a NEM-TALALAT a gyorsitotar tulajdonsaga, nem a vilage: a kod
 * letezhet a szerveren ugy, hogy a telefon soha nem latta.
 *
 * A TALALAT tehat BIZONYIT (ez a kod mar egy eszkozon all), a nem-talalat NEM.
 * Ezert all meg az elso eset, es ezert nem all meg a masodik -- es ezert kell a
 * masodikban KIIRNI a szamot: a kolléga csak akkor tudja megiteltni, mennyit er
 * a "nem talaltam", ha latja, mihez kepest.
 */

export interface OfflineDuplicateVerdict {
  /** Mehet-e a felvitel. Hamis CSAK akkor, ha a kod mar all egy eszkozon. */
  allowed: boolean;
  /** Az eszkoz, amin a kod mar all. Csak akkor van, ha `allowed` hamis. */
  conflictingAssetId: string | null;
  /** Hany eszkoz ellen ellenoriztunk. Ez a mondat sulya. */
  checkedAgainst: number;
  /** A masolat kora, ISO alakban. `null`, ha nincs masolat. */
  syncedAt: string | null;
}

/**
 * SAJAT SZERKEZETI ALAK, NEM A GYORSITOTAR TIPUSA -- ES EZ NEM STILUS.
 *
 * A teszt-fordito nem ismeri a `@/` aliast (`tsconfig.test.json`-ban nincs
 * `paths`), es a `@/lib/offline/asset-cache` feloldasa behuzna a `client.ts`-t
 * es vele az Expo futasi kornyezetet. A `CachedAsset` ezt a ket mezot hozza,
 * tehat szerkezetileg illeszkedik -- a hivo atadhatja valtozatlanul.
 */
export interface CachedAssetLike {
  detail: { id: string } | null;
  summary: { id: string } | null;
}

export interface OfflineDuplicateInput {
  /** Amit a `readCachedAssetByToken` adott vissza, vagy `null`. */
  found: CachedAssetLike | null;
  /** A gyorsitotarban allo eszkozok szama. */
  cachedCount: number;
  syncedAt: string | null;
}

export function checkScannedCodeOffline(
  input: OfflineDuplicateInput,
): OfflineDuplicateVerdict {
  /**
   * A TALALAT AKKOR IS TALALAT, HA CSAK A LISTASOR VAN MEG.
   *
   * A `CachedAsset` ket mezot hoz: a `detail` csak azoknal all, akiket
   * megnyitottak tereróvel, a `summary` MINDEN mentett eszkoznel. Ha csak a
   * `detail`-t neznenk, a kod tobbsegere azt mondanank, hogy szabad -- epp
   * azokra, amiket soha nem nyitottak meg.
   */
  const talalat = input.found?.summary ?? input.found?.detail ?? null;
  if (talalat) {
    return {
      allowed: false,
      conflictingAssetId: talalat.id,
      checkedAgainst: input.cachedCount,
      syncedAt: input.syncedAt,
    };
  }
  return {
    allowed: true,
    conflictingAssetId: null,
    checkedAgainst: input.cachedCount,
    syncedAt: input.syncedAt,
  };
}

/**
 * A MONDAT, AMIT A KOLLEGA LAT. A szamokat NEM nyersen adjuk at: egy "0" vagy
 * egy ISO-idobelyeg magaban nem mondja meg, mit kezdjen vele.
 */
export function describeOfflineCheck(verdict: OfflineDuplicateVerdict): string {
  if (!verdict.allowed) {
    return (
      `Ez a matricakód már egy rögzített eszközön áll (${verdict.conflictingAssetId}). ` +
      `A felvitel itt megáll: két eszköz nem hordhatja ugyanazt a kódot.`
    );
  }
  if (verdict.checkedAgainst === 0) {
    /**
     * NULLA ESZKOZ ELLEN ELLENORIZNI NEM ELLENORZES. Ha ezt ugyanazzal a
     * mondattal mondanank, mint a teli gyorsitotarat, a kolléga egy ures
     * masolatbol olvasna megnyugvast.
     */
    return (
      "Nincs letöltött eszközmásolat a telefonon, ezért a kódot NEM tudtam " +
      "ellenőrizni. A felvitel mehet, de az egyediséget csak a szinkron dönti el."
    );
  }
  const kor = verdict.syncedAt
    ? `a másolat ${verdict.syncedAt} óta van a telefonon`
    : "a másolat kora ismeretlen";
  return (
    `Ezt a kódot ${verdict.checkedAgainst} eszköz ellen ellenőriztem, és nem ` +
    `találtam egyezést (${kor}). A felvitel mehet; az egyediséget a szinkron ` +
    `dönti el, mert a telefonon nem áll az összes eszköz.`
  );
}
