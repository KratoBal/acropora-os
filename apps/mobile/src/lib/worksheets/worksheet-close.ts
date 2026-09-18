/**
 * A MUNKALAP LEZARASA A HELYSZINEN -- A TISZTA RESZ.
 *
 * Balazs dontese, 2026-09-18 07:16: "igen, zarhassa le a helyszinen". Ez egy
 * korabbi sajat dontesét irja felul (2026-09-03: a lezaras az irodae) -- es
 * CSAK a lezarast: az AR es a FOLYTATAS valtozatlanul az irodae.
 *
 * === MIERT EZ A LANC ELSO SZEME ===
 *
 * Az alairas kapuja (`canSignWorksheetVersion`) `AWAITING_SIGNATURE` allapotot
 * kovetel, oda pedig a LEZARAS visz. Amig a lap piszkozat, az alairas gombja
 * SEHOGY nem jelenhet meg -- Balazs epp ezt merte: kepernyokepet kuldott egy
 * piszkozatrol azzal, hogy "hol van az a gomb?".
 *
 * === A KAPU UGYANAZ A KETTO, MINT A SZERVEREN ===
 *
 * A vegpont `service.manage` jogot ker (`@RequirePermissions`), es a lezaras
 * elso akadalya a `NOT_DRAFT`. Ha a gomb ennel tagabban jelenne meg, olyat
 * igerne, amit a szerver visszautasit -- a szerelo pedig a helyszinen allna
 * vele.
 */

/** Latszik-e a lezaro gomb. */
export function canCloseWorksheetVersion(input: {
  status: string;
  worksheetsManage: boolean;
}): boolean {
  return input.worksheetsManage && input.status === "DRAFT";
}

/**
 * TERERO NELKUL A LEZARAS MEGTAGADVA, NEM SORBA TEVE -- ES EZ MERESEN ALL.
 *
 * A tetel-felvitel es a fenykep SORBA megy, mert azoknak a kesobbi feldolgozasa
 * semmit nem valtoztat azon, amit a szerelo kozben lat. A lezaras MAS, ket
 * mert okbol:
 *
 * 1. A LEZARAS OSZTJA A MUNKALAPSZAMOT. A szamot a szerver egy SOROZATBOL veszi
 *    (`allocateSequence`), tranzakcioban. Terero nelkul nincs honnan venni, es
 *    kitalalni nem szabad: a szam a kiadott dokumentumon szerepel.
 *
 * 2. A LEZARAS UTAN AZONNAL ALAIRAS KOVETKEZIK. Ez az egesz kartya celja:
 *    Balazs egy mozdulatban varja a kettot. Egy SORBAN ALLO lezaras mellett a
 *    lap a telefonon PISZKOZAT marad, tehat az alairas gombja nem jelenik meg
 *    -- a szerelo egy "sikeres" lezaras utan allna ott anelkul, hogy tovabb
 *    tudna lepni. Ha pedig a felulet megis engedne alairni, akkor egy meg le
 *    nem zart, SZAM NELKULI lapra kerulne alairas.
 *
 * A megtagadas HANGOS es azonnali; egy sorban allo lezaras CSENDES es kesobb
 * derul ki, a helyszintol tavol. A ket tevedes ara nem egyforma.
 */
export const LEZARAS_TERERO_NELKUL =
  "A lezáráshoz hálózat kell: a munkalap száma ekkor keletkezik, és aláírni csak számmal ellátott, lezárt lapot lehet. Amint van térerő, a lezárás egy koppintás.";

/**
 * A SZERVER UZENETET MUTATJUK, NEM SAJAT MASOLATOT.
 *
 * A harom akadalynak (`NOT_DRAFT`, `NO_LINES`, szam-problema) a szerveren mar
 * van sajat mondata. Egy masolat itt egyszer elcsuszna, es akkor a telefon
 * MAST mondana, mint a web -- ugyanarra a lapra.
 *
 * AMI VISZONT IDE TARTOZIK: ha a szerver uzenete valamiert hianyzik, ne egy
 * ures doboz maradjon. Ez az EGYETLEN sajat mondat, es csak a hianyra szol.
 */
export const LEZARAS_ISMERETLEN_HIBA =
  "A lezárás nem sikerült, és a szerver nem mondta meg, miért. Próbáld újra, és ha marad, szólj az irodának.";

export function lezarasHibaUzenete(szerverUzenet: string | null): string {
  const tisztitott = szerverUzenet?.trim();
  return tisztitott ? tisztitott : LEZARAS_ISMERETLEN_HIBA;
}
