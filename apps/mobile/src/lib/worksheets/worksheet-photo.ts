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
  /**
   * EZ A MONDAT AT VAN IRVA (2026-09-17), ES A SAJAT KOMMENTJE ELORE MEGMONDTA.
   *
   * Korabban azt allt itt, hogy a fenykep „most nem tölthető fel", es hogy
   * terero kell hozza. A mellette allo indoklas kimondta, hogy ez a mondat a
   * JELEN allapotrol szol, es „akkor ez az ág egyszerűen nem áll elő többé",
   * amikor a sorba tetel elkeszul.
   *
   * A SORBA TETEL ELKESZULT, AZ AG VISZONT ELOALL: a mentett masolat allapota
   * megmarad. Ezert nem a feltetelt vettem ki, hanem a MONDATOT irtam at --
   * kulonben epp azt tiltana, amiert a sor keszult.
   */
  offlineCopy:
    "Mentett másolatot nézel. A fénykép így is felvehető: a telefonon vár, és magától felmegy, amint visszajön a hálózat.",
} as const;
