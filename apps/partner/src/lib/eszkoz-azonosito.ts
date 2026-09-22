/**
 * MELYIK AZONOSÍTÓ ÁLL AZ ESZKÖZ NEVE ALATT A PARTNER OLDALÁN.
 *
 * Tiszta függvény, hogy a választás a képernyő felrajzolása nélkül is mérhető
 * legyen -- ugyanaz a megfontolás, ami a `naploSor` függvényt is kiemelte a
 * komponensből.
 *
 * === AMIT A PARTNER LÁT, ÉS AMIT KERES ===
 *
 * Balázs kérése (2026-09-22): a listában a MATRICA kódja álljon, ne a belső
 * eszköz-szám. Az indok gyakorlati: a partner a polcon a matricát olvassa le,
 * nem a mi nyilvántartási számunkat.
 *
 * === HÁROM MEZŐRE LEHET AZT MONDANI, HOGY "QR", ÉS KETTŐ ROSSZ ===
 *
 *   assetNumber   a belső eszköz-szám. Ez állt eddig itt.
 *   qrToken       uuid, a `@default(uuid())` adja. NEM a matrica száma -- és
 *                 épp ez a legcsábítóbb rossz válasz, mert az eszköz adatlapján
 *                 ma "QR-azonosító" néven szerepel, vagyis azon a néven, ahogy
 *                 a felhasználó a matricát hívja.
 *   labelCode     az ELŐRE NYOMTATOTT matrica kódja. EZ a helyes.
 *
 * === MIÉRT `??` ÉS NEM `||` -- ÉS EZ MÉRÉS, NEM ÍZLÉS ===
 *
 * A `||` az ÜRES szövegre is visszaesne, a `??` csak a hiányzóra. Megmértem,
 * hogy üres kód egyáltalán előállhat-e:
 *
 *   a bemeneti minta      `^[A-Za-z][0-9]{4}$`  -- üres szövegre NEM illeszkedik
 *   az adatbázisban       `AssetLabel_code_shape_check`, `^[A-Z][0-9]{4}$`
 *
 * Vagyis a tárolt kód mindig pontosan öt karakter, és a hiány egyetlen alakja
 * az `undefined`. A `??` tehát PONTOSAN azt mondja, ami igaz: csak a hiányzó
 * esetre esünk vissza. Egy `||` ugyanazt az eredményt adná ma, de olyasmit
 * állítana a kódban, amit nem mértünk meg.
 *
 * === A TARTALÉK SZÉLSŐ ESET, ÉS MÉGIS KELL ===
 *
 * Ha az eszközön nincs matrica, a belső szám marad. Enélkül a sor
 * azonosíthatatlan lenne, és a partner nem tudná megmondani, melyik eszközről
 * beszél.
 *
 * A fedettség 2026-09-22-én MÉRVE, az éles adatbázisból: nyolcvanhárom
 * eszközből hetvennégyen van matrica, vagyis kilencen nincs. A tartalék tehát
 * ma kilenc sort érint, nem a többséget.
 *
 * EZ A BEKEZDÉS EGYSZER MÁR MÁST ÁLLÍTOTT: egy becslésre hivatkozva azt írta,
 * hogy a fedettség részleges, és a tartalék a sorok jelentős részén látszik.
 * A mérés ezt megdöntötte. A döntés nem változott -- a tartalék marad --, de
 * az indoka igen: nem azért kell, mert gyakori, hanem mert egy azonosító
 * nélküli sor használhatatlan, akárhány van belőle.
 */
export interface EszkozAzonositoForras {
  assetNumber: string;
  labelCode?: string;
}

export function eszkozAzonosito(eszkoz: EszkozAzonositoForras): string {
  return eszkoz.labelCode ?? eszkoz.assetNumber;
}
