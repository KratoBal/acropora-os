/**
 * FÉNYKÉP EGY MÁR MEGLÉVŐ MUNKALAPHOZ -- amit a képernyő MOND róla.
 *
 * === MIÉRT KÜLÖN MODUL ===
 *
 * Ebben az appban nincs komponens-teszt eszköz: ami a képernyő törzsében marad,
 * azt csak kézzel, telefonon lehet kipróbálni. A mondatok itt ADATOK, tehát egy
 * állítás meg tudja nézni, hogy a képernyő használja-e őket -- ugyanaz a
 * megfontolás, mint a `service-jobs/offline-copy-notice.ts`-nél, és ugyanabból
 * a mért hibából: ott a fénykép-szakasz EGYETLEN SZÓ NÉLKÜL tűnt el térerő
 * nélkül, miközben a mellette álló művelet kimondta, miért nem megy.
 *
 * === A KÉT KIMENET KÜLÖN MONDAT, ÉS EZ A LÉNYEG ===
 *
 * A feltöltésnek van egy RÉSZLEGES SIKERE: a választó JPEG és PNG mellett HEIC
 * fájlt is ad, és azok kimaradnak. Ha csak azt mondanánk, hogy „3 kép
 * feltöltve", a negyedik CSENDBEN veszne el -- és épp az a kép, amiről a
 * szerelő azt hiszi, megvan. A kihagyottakat akkor is kimondjuk, ha a többi
 * sikerült.
 */

/**
 * MIT MOND A LAP, AMIKOR MENTETT MÁSOLATOT NÉZ.
 *
 * AZ ALAKJA A JELEN ÁLLAPOTRÓL SZÓL, NEM A VILÁGRÓL. Nem azt mondja, hogy
 * „térerő nélkül nem lehet fényképet feltölteni" -- az ÁLTALÁNOS állítás lenne,
 * és hazudni kezdene abban a percben, amikor a sorba tétel elkészül. Azt
 * mondja, MOST, EZEN a lapon miért nem megy, és megmondja a teendőt is: e nélkül
 * a mondat csak közli a kudarcot.
 */
export const WORKSHEET_PHOTO_NOTICE = {
  /** A feltöltés kiesik: a kép a szerverre menne, nem a mentett másolatba. */
  offlineCopy:
    "Mentett másolatot nézel, ezért a fénykép most nem tölthető fel. Térerőnél tudsz képet tenni a lapra.",
} as const;

/**
 * A FELTÖLTÉS EREDMÉNYE, EMBERI ALAKBAN.
 *
 * `uploaded` a szerver által visszaadott dokumentumok száma (nem az, amennyit
 * küldeni akartunk: az utóbbi akkor is tízet mondana, ha a szerver kettőt
 * fogadott el). `skipped` azoknak a fájloknak a NEVE, amiket a választó adott,
 * de a formátumuk miatt el sem indultak.
 *
 * `null`, ha nincs mit mondani -- se feltöltött, se kihagyott kép.
 */
export function describeWorksheetPhotoUpload(input: {
  uploaded: number;
  skipped: readonly string[];
}): string | null {
  const { uploaded, skipped } = input;
  if (uploaded === 0 && skipped.length === 0) return null;
  if (uploaded === 0) {
    return `Egyik kiválasztott kép sem tölthető fel: csak JPEG és PNG megy. Kimaradt: ${skipped.join(", ")}.`;
  }
  const alap = `${uploaded} kép a laphoz került.`;
  /**
   * A RÉSZLEGES SIKER KÜLÖN MONDATOT KAP, nem egy zárójeles megjegyzést: a
   * kihagyott fájl az, amiről hallgatni a legdrágább.
   */
  return skipped.length === 0
    ? alap
    : `${alap} Kimaradt (csak JPEG és PNG megy): ${skipped.join(", ")}.`;
}
