/**
 * AZ ESZKOZ ATADASA A HELYSZINEN -- A TISZTA RESZ.
 *
 * Balazs dontese, 2026-09-21 11:10 UTC (Discord, fo csatorna, message_id
 * 1551551127814799381, "elfogadom"), harom kerdesre egyszerre:
 *
 *   KI JELOLI MEG   a SZERELO, a telefonjan, amikor visszaadja -- ES az iroda
 *                   is tudja allitani a weben
 *   MIKOR           KULON LEPESKENT, nem a lezarashoz vagy az alairashoz kotve
 *   KAPU-E          IGEN: a jegy nem zarhato le, amig nalunk van eszkoz
 *                   (2026-09-21 09:39, "ne zarhassuk le amig nalunk van")
 *
 * === MIERT KULON LEPES, ES NEM A LEZARAS MELLEKE ===
 *
 * A HELYSZINI munkanal a ketto egybeesik: a gep nem is mozdult. A MUHELYBEN
 * javitott gepnel viszont az alairas megtortenhet hetekkel a visszaszallitas
 * elott. Egy osszekotott jeloles tehat a lapok egyik feleen igazat mondana, a
 * masikon hazudna -- es epp a hazug felen szamit, mert ott van meg nalunk az
 * eszkoz.
 *
 * === A KAPU UGYANAZ, MINT A SZERVEREN ===
 *
 * A vegpont `service.manage` jogot ker. Ha a gomb ennel tagabban jelenne meg,
 * olyat igerne, amit a szerver visszautasit -- a szerelo pedig a helyszinen
 * allna vele.
 *
 * AMI VISZONT NEM KAPU: a lap ALLAPOTA. A lezarasnal `DRAFT` kell, itt semmi:
 * az atadas a lap allapotatol FUGGETLEN kerdes. Egy mar alairt lap gepe
 * ugyanugy allhat meg nalunk, es egy piszkozat gepet is vissza lehet adni.
 */

/** Latszik-e az atadas-gomb. A lap allapota SZANDEKOSAN nem szamit. */
export function canMarkWorksheetHandover(input: {
  worksheetsManage: boolean;
}): boolean {
  return input.worksheetsManage;
}

/**
 * A GOMB FELIRATA MEGMONDJA, MELYIK IRANYBA INDUL.
 *
 * Nem "Atadas" all rajta mind a ket allapotban: egy allapot-fordito felirat
 * mellett a szerelo nem tudja, mit fog csinalni a koppintas, es ket kezelonel
 * csendben az ellenkezojet is teheti.
 */
export function handoverGombFelirata(handedOverAt: string | null): string {
  return handedOverAt ? "Átadás visszavonása" : "Átadás rögzítése";
}

/** Melyik ertek megy a szervernek. Mindig az ELLENKEZOJE a mainak. */
export function handoverKuldendoErtek(handedOverAt: string | null): boolean {
  return handedOverAt === null;
}

/**
 * TERERO NELKUL AZ ATADAS MEGTAGADVA, NEM SORBA TEVE -- ES A HATARA KIMONDVA.
 *
 * A tetel-felvitel es a fenykep SORBA megy. Az atadas MA nem, es ennek nem
 * elvi oka van, hanem az, hogy a sor minden fajtaja sajat visszajatszot es
 * sajat idempotencia-kulcsot kiván: egy uj fajta bevezetese kulon szelet.
 *
 * AMIERT EZ MEGIS BIZTONSAGOS HATAR, ES NEM RES: a megtagadas semmit nem
 * rogzit. A szerelo HANGOS uzenetet kap, es amint van terero, egy koppintas.
 * A sorba tett valtozat ezzel szemben a telefonon mar "atadottnak" mutatna a
 * lapot, kozben a szerver -- es a rá epulo lezarasi kapu -- meg nem tudna rola.
 *
 * AMI VISZONT ELVESZIK, ES EZT IS KI KELL MONDANI: a rogzitett IDOPONT ilyenkor
 * a jeloles ideje lesz, nem az atadase. Ha ez szamit, a sorba tetel a kovetkezo
 * szelet, es akkor a tenyleges idopontot a telefon viszi magaval.
 */
export const ATADAS_TERERO_NELKUL =
  "Az átadás jelöléséhez hálózat kell: a telefon ezt nem teszi sorba, mert addig átadottnak mutatná a lapot, amit a szerver még nem tud. Amint van térerő, egy koppintás.";

export const ATADAS_ISMERETLEN_HIBA =
  "Az átadás jelölése nem sikerült, és a szerver nem mondta meg, miért. Próbáld újra, és ha marad, szólj az irodának.";

/** A szerver mondata megy ki; a sajat szoveg CSAK a hianyra szol. */
export function atadasHibaUzenete(szerverUzenet: string | null): string {
  const tisztitott = szerverUzenet?.trim();
  return tisztitott ? tisztitott : ATADAS_ISMERETLEN_HIBA;
}

/**
 * MIT MOND A LAP AZ ESZKOZROL.
 *
 * A NEV NEM FELTETELE AZ ATADASNAK: a semaban a kapcsolat `onDelete: SetNull`,
 * tehat egy azota torolt kollega neve eltunik, az atadas tenye nem. Ha a
 * kepernyo a NEVRE agazna, a visszaadott eszkoz ujra "nalunk levonek"
 * latszana -- pontosan az a hamis megnyugtatas, amiert a "Meg nalunk van"
 * mondat 2026-09-07-en kikerult a webrol.
 */
export function atadasAllapota(input: {
  handedOverAt: string | null;
  handedOverByName: string | null;
}): { atadva: false } | { atadva: true; mikor: string; ki: string | null } {
  if (input.handedOverAt === null) return { atadva: false };
  return {
    atadva: true,
    mikor: input.handedOverAt,
    ki: input.handedOverByName,
  };
}

/**
 * A FELIRAT AZT MONDJA, AMIT TUDUNK: HOGY A JELOLES HIANYZIK.
 *
 * Korabban "Az eszkoz meg nalunk van" allt itt. Az a mondat a GEP HELYET
 * allitja, amit NEM tarolunk -- es helyszini munkanal egyenesen HAMIS, mert a
 * gep el sem jott. Amit tudunk, az a `handedOverAt` hianya.
 *
 * Ez ugyanaz a hiba lett volna, amit 2026-09-07-en ezen a mezon mar egyszer
 * kiszedtunk: egy allapot allitasa, amirol nincs adatunk. Akkor azert volt
 * hamis, mert a mezonek nem volt iroja; most azert lenne, mert a mezo mast
 * jelent, mint amit a mondat allit.
 */
export const ATADAS_NINCS_ROGZITVE = "Átadás nincs rögzítve";
