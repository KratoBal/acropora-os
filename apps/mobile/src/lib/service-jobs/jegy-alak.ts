import type { ServiceJobDetail, ServiceJobPartnerDetail } from "./types";

/**
 * A HIBAJEGY ADATLAPJA KET ALAKBAN ERKEZIK, ES A TELEFON EDDIG CSAK AZ EGYIKET
 * ISMERTE.
 *
 * === A MERT OSSZEOMLAS (2026-09-22 20:05, Balazs iOS TestFlight, build 19) ===
 *
 * Partner fiokkal megnyitva a hibajegyet az alkalmazas ELSZALLT
 * (EXC_CRASH/SIGABRT, `RCTFatal`). Sajat tulajdonosi fiokkal mukodott.
 *
 * Az ok nem a szerveren volt: a `detail` vegpont partner-hatokoru hivonak
 * SZANDEKOSAN masik tipust ad (`ServiceJobPartnerDetail`), ami tizenegy belso
 * mezot elhagy. Ez Balazs dontese, es helyes.
 *
 * A HIBA A TIPUSBAN VOLT: a mobil kliens `apiRequest<ServiceJobDetail>` alakban
 * kerte le MIND A KET esetre. A tipus tehat HAZUDOTT, es ezert a fordito soha
 * nem szolt -- a kepernyo `detail.allowedSteps.length`-et olvasott egy
 * `undefined` erteken.
 *
 * === MIERT NEM `?? []` A JAVITAS ===
 *
 * Az elrejtene a valodi eltérést, es ott hagyna egy nem mukodo gombot: a
 * kepernyo azt irna ki, hogy „Ebbol az allapotbol nincs tobb lepes" -- ami
 * HAMIS. Nem az nincs, hogy lepes; az nincs, hogy EZ A HASZNALO leptethet.
 *
 * === ES MIERT NEM A JOGOSULTSAG-TUKROT JAVITOM ===
 *
 * Kezenfekvo lenne kivenni a `PARTNER_SERVICE` szerepet a `canManage` agbol.
 * MERTEM, es az rossz volna: a szerver a `PARTNER_SERVICE` szerepnek VALOBAN
 * megadja a `service.manage` jogot (szerep-tabla, `packages/types/src/auth.ts`).
 * A tukor tehat MA IGAZAT MOND, es a kivetel egy HAMIS allitast tenne a helyere
 * -- raadasul elvenne az `assetsManage` es a `worksheetsManage` kepesseget is,
 * amiket a partner ma hasznal.
 *
 * A leptetest NEM a JOG tiltja, hanem az ALAK: a kiszolgalo egyszeruen nem ad
 * `allowedSteps` mezot partner-hatokorben. A kepernyo tehat az ADATBOL dontson,
 * ne a szerepbol -- az `allowedSteps` maga a szerver allitasa arrol, mi
 * lephető.
 */
export type JegyAdatlap = ServiceJobDetail | ServiceJobPartnerDetail;

/**
 * PARTNER-ALAK-E.
 *
 * === AZ ELSO ALAKOM HAMIS FELTEVESEN ALLT, ES A SAJAT TESZTJE CAFOLTA MEG ===
 *
 * Azt irtam ide, hogy a `partnerStatusLabel` PONTOSAN az egyik alakban all,
 * tehat a jelenlete dont -- es hogy ez szukebb allitas, mint egy hianyra
 * epitett dontes. MEGMERTEM, es NEM IGAZ: a belso alak IS viszi a
 * `partnerStatus` es a `partnerStatusLabel` mezot (`ServiceJobDetail` es
 * `ServiceJobListItem`, a kozos tipusokban is). A ket mezo a partner-felirathoz
 * kell, es a belso felulet is hasznalja.
 *
 * A PARTNER-ALAK VALOJABAN RESZHALMAZ: nincs egyetlen mezoje sem, ami a
 * belsoben ne allna. Vagyis a hianyra epitett dontes nem valasztas, hanem az
 * EGYETLEN lehetoseg -- es ezt ki kell mondani, nem elegansabbnak beallitani.
 *
 * === AMIRE KERDEZUNK, ES MIERT EPP ARRA ===
 *
 * Az `allowedSteps` hianyara. Ez az a mezo, AMIROL a dontes szol: a jelenlete
 * maga a szerver allitasa arrol, hogy van-e leptetes -- es ezen a mezon halt
 * meg a kepernyo (mert 2026-09-22).
 *
 * A KOCKAZAT, KIMONDVA: ha a belso valasz valaha elhagyna az `allowedSteps`
 * mezot, ez a fuggveny CSENDBEN partnernek nezne egy belso valaszt. Ma ezt a
 * tipus zarja ki (`allowedSteps` KOTELEZO a belso alakon), tehat egy ilyen
 * valtozas forditasi hiba lenne, nem nema csuszas.
 */
export function partnerAlak(d: JegyAdatlap): d is ServiceJobPartnerDetail {
  return !("allowedSteps" in d);
}

export interface JegyFejlec {
  /** Ami az allapot helyen all. Mind a ket alakban VAN ertelme. */
  allapotFelirat: string;
  /**
   * Kinalja-e a kepernyo a leptetest. Partner-alaknal SOHA: a szerver nem ad
   * lepeslistat, tehat nincs mit kinalni.
   */
  leptethet: boolean;
  /**
   * A vevo neve, ha van ertelme kiirni. Partner-alaknal `undefined`: a vevo
   * MAGA a nezo, a sajat nevet kiirni zaj.
   */
  ugyfelNeve?: string;
}

export function jegyFejlec(
  detail: JegyAdatlap,
  /** A mentett masolatbol nezzuk-e. Onnan leptetni amugy sem lehet. */
  masolatbol: boolean,
  /** Az allapot-felirat a belso alakhoz (a mobil sajat tukre). */
  belsoFelirat: (status: string) => string,
): JegyFejlec {
  if (partnerAlak(detail))
    return { allapotFelirat: detail.partnerStatusLabel, leptethet: false };

  return {
    allapotFelirat: belsoFelirat(detail.status),
    leptethet: !masolatbol && detail.allowedSteps.length > 0,
    ugyfelNeve: detail.customerName ?? undefined,
  };
}

/**
 * AMIT EGY MUNKALAP OROKOLHET A JEGYTOL -- VAGY `null`, HA NINCS MIT.
 *
 * A munkalap-felvitel a jegybol veszi at a vevot, a helyszint es a feleloseket.
 * Partner-alaknal EGYIK SINCS a valaszban, es ez nem hiba: a partner sajat
 * hibajegyet lat, nem a belso kiosztast.
 *
 * MIERT KULON FUGGVENY, ES MIERT `null` EGYBEN: ha a negy mezot kulon-kulon
 * kerdeznenk le, a hivo harom helyen dontene ugyanarrol, es a negyedik helyen
 * elfelejtene. Egy `null` valasz EGY dontest ker: van-e mit orokolni.
 *
 * ES AMIERT EZ NEM ELMELETI: 2026-09-22-ig a munkalap-kepernyo ezt a negy mezot
 * FELTETEL NELKUL olvasta. Nem omlott ossze -- `undefined` erteket vett at, es
 * a lap a jegy vevoje, helyszine es felelose NELKUL jott volna letre. A jegy
 * adatlapja hangosan halt meg, ez csendben rontott volna.
 */
export interface JegyOroklendo {
  customerId: string | null;
  customerName: string | null;
  departmentId: string | null;
  assignees: ServiceJobDetail["assignees"];
}

export function jegyOroklendo(detail: JegyAdatlap): JegyOroklendo | null {
  if (partnerAlak(detail)) return null;
  return {
    customerId: detail.customerId,
    customerName: detail.customerName,
    departmentId: detail.departmentId,
    assignees: detail.assignees,
  };
}

/**
 * MENTHETO-E A KESZULEKRE EZ A VALASZ.
 *
 * A mentett masolat a BELSO alakot tarolja, es a visszaolvaso is annak
 * feltetelezi. Egy partner-alakot oda beirni ugyanaz a hazugsag, amit ez a
 * modul epp megszuntet: a kovetkezo olvasas mar nem tudna, hogy mas jott.
 *
 * A PARTNER OFFLINE MASOLATA KULON KERDES, es nem ez a kor dontí el.
 */
export function menthetoMasolatkent(
  detail: JegyAdatlap,
): detail is ServiceJobDetail {
  return !partnerAlak(detail);
}
