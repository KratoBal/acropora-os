/**
 * MELYIK VALASZTO ALL NYITVA A MUNKALAP-URLAPON -- A TISZTA RESZ.
 *
 * Balazs jelentese (2026-09-18): "a partnert is listaban dobja ki ami a
 * kivalasztas utan is ott marad, ugyanigy a helyszint is ... ez a listaban
 * ajanlja fel a partnert es a helyszint ugyanigy megvan ha csak siman nyitok
 * egy munkalapot".
 *
 * AMI A KODBOL LATSZOTT: a partner-valaszto NYITVA indult
 * (`useState(true)`), a helyszin-lista pedig SOHA nem csukodott be -- az a
 * szekcio nem is ismert nyitott/zart allapotot, a teljes listat mindig kiirta.
 * A partnernel a valasztas utan volt csukas, a helyszinnel nem: a partner utan
 * ROGTON a helyszin teljes listaja nyilt ki alatta, es kivulrol ez ugyanaz a
 * kep.
 *
 * MIERT EGY ALLAPOT ES NEM KETTO: ket fuggetlen jelzo megengedne, hogy mind a
 * ketto egyszerre nyitva legyen -- es pontosan az a mai kep, amire a jelentes
 * szol. Egy ertek ezt szerkezetileg zarja ki, nem szabalykent.
 *
 * MIERT KULON MODUL: ebben az appban nulla komponens-teszt van, tehat ami a
 * kepernyo torzsebe kerul, azt soha senki nem meri le.
 */

/** Melyik valaszto all nyitva. `null`: egyik sem, ez az alapallapot. */
export type NyitottValaszto = "partner" | "helyszin" | null;

/**
 * KOPPINTAS A VALASZTO FEJERE.
 *
 * Ugyanarra koppintva ZAR (a szerelo meggondolta magat), masikra koppintva
 * ATVALT -- es ezzel a masik becsukodik, kulon lepes nelkul.
 */
export function valasztoraKoppint(
  nyitott: NyitottValaszto,
  melyik: Exclude<NyitottValaszto, null>,
): NyitottValaszto {
  return nyitott === melyik ? null : melyik;
}

/**
 * VALASZTAS UTAN MIND A KETTO ZARVA.
 *
 * Ez a jelentes masik fele: a kivalasztas utan a lista "ott marad". Egy
 * kivalasztott ertek mellett a teljes lista nem informacio tobbe, csak zaj --
 * es a kovetkezo mezot tolja le a keperno aljara.
 */
export function valasztasUtan(): NyitottValaszto {
  return null;
}

/**
 * MIVEL INDULJON A KEPERNYO.
 *
 * ZARVA, egy kivetellel: ha a lap NEM jegy alol jon, a partnert ugyis valasztani
 * kell, es a nyitas egy koppintast sporol. ES MEGIS ZARVA INDUL -- mert a
 * jelentes epp erre szol: "ez a listaban ajanlja fel a partnert ... ugyanigy
 * megvan ha csak siman nyitok egy munkalapot".
 *
 * A JEGY ALATTI ESET NEM ITT DOL EL: ott a partner ZART MEZO (nem csukott
 * valaszto), es azt a `partnerLezarva` mondja meg. Ez a fuggveny csak azt
 * rogziti, hogy nyitott valasztoval SOHA nem indulunk.
 */
export function kezdoValaszto(): NyitottValaszto {
  return null;
}
