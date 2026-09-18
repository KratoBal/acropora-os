import type { TicketLink } from "./worksheet-under-ticket";

/**
 * MIT VESZ AT A LAP A HIBAJEGYBOL -- A TISZTA RESZ.
 *
 * Balazs jelentese (2026-09-18): "HA a hibajegy alol nyitok uj munkalapot, akkor
 * nem veszi at se a partnert se a helyszint". A WEBEN mind a ketto mukodik; a
 * telefon SEMMIT nem vett at, mert a jegy azonositoja csak a kuldendo torzsbe
 * kerult, elotoltesre soha.
 *
 * MIERT KULON MODUL, ES NEM A KEPERNYON: ebben az appban NULLA komponens-teszt
 * van (a `new.tsx` es a `worksheet-create.ts` fejlece ki is mondja). Egy
 * kepernyore irt elotoltes azt jelenti, hogy soha senki nem meri le -- es
 * Balazs telefonjan derul ki.
 *
 * === A NEGY MEGKOTES, AMI A WEBTOL JON ES NEM ELHAGYHATO ===
 *
 * 1. A PARTNER A SZERVERTOL JON, NEM A CIMBOL. A navigacio csak a jegy
 *    AZONOSITOJAT adja at; a partnert a jegy lekerdezese hozza. Egy params-ban
 *    atadott `customerId`-t barki atirhatna, es a vegpont
 *    (`mayWorksheetJoinTicket`) utana visszautasitana a lapot.
 * 2. A PARTNER ZART, ha a lap jegy ala keszul. Egy valaszto, ami olyat kinal,
 *    amit a szerver elutasit, rosszabb a hianyanal.
 * 3. A HIANYZO HELYSZIN NEM HIBA. A jegynek nem kell helyszin
 *    (`ServiceJob.departmentId` nullazhato), a lapnak viszont igen -- tehat a
 *    valaszto ures marad, es a szerelo valaszt.
 * 4. A PARTNER NELKULI JEGY KULON MONDAT, nem ugyanaz, mint a betoltesi hiba.
 *    Ket allapot, ket teendo: az egyiknel a jegyet kell rendbe tenni, a
 *    masiknal ujraprobalni.
 *
 * === ES A SORBAN ALLO JEGY: NINCS MIT ATVENNI, ES EZ NEM HIBA ===
 *
 * Egy meg fel nem toltott jegynek nincs szerver-oldali azonositoja, tehat nem is
 * kerdezheto le. A szerelo ilyenkor maga valaszt partnert -- es a kepernyo mar
 * ma is figyelmezteti, hogy UGYANAZT valassza, mint a jegyen
 * (`JEGY_A_SORBAN`). Ez a modul ezt az agat nem irja felul.
 */

/**
 * A VALASZTHATO PARTNER ALAKJA -- HELYBEN, NEM AZ API-RETEGBOL IMPORTALVA.
 *
 * A `lib/api/worksheets.ts` a `@/` alias-utakon at tovabbi modulokat huz be, es
 * a teszt-forditas azokat nem oldja fel: az elso valtozatom emiatt HAROM
 * TS2307-tel allt meg, mielott egyetlen allitas lefutott volna. A tobbi tiszta
 * modul ugyanezert nem importal az api-retegbol.
 *
 * SZERKEZETILEG azonos a `ValaszthatoPartner` tipussal, tehat a
 * kepernyo a valodi objektumot adja at, kaszt nelkul.
 */
export interface ValaszthatoPartner {
  customerId: string;
  name: string;
  partnerCode: string;
}

/** Amit a jegy valaszabol hasznalunk. A tobbi mezo ide nem tartozik. */
export interface JegyAdat {
  customerId: string | null;
  customerName: string | null;
  departmentId: string | null;
}

export type JegyElotoltes =
  /** A lap nem jegy alol jon: a szerelo mindent maga valaszt. */
  | { kind: "nincs" }
  /** A jegy meg a sorban all: nincs mit lekerdezni, a valasztok nyitva. */
  | { kind: "sorban" }
  /** A jegy lekerdezese fut. A valasztokat NEM nyitjuk ki kozben. */
  | { kind: "toltes" }
  /** A lekerdezes elhasalt. Ujraprobalhato -- a jegy maga rendben lehet. */
  | { kind: "hiba"; uzenet: string }
  /** A jegynek NINCS partnere: a szerver a lapot amugy is elutasitana. */
  | { kind: "nincs-partner"; uzenet: string }
  /** Megvan: a partner ZART, a helyszin elotoltve (ha a jegyen volt). */
  | {
      kind: "kesz";
      partner: ValaszthatoPartner;
      departmentId: string | null;
    };

export const JEGY_BETOLTES_HIBA =
  "A hibajegy adatait nem sikerült lekérdezni, ezért a partnert nem tudom kitölteni. Próbáld újra, vagy nyisd meg a lapot a jegy nélkül.";

export const JEGY_NINCS_PARTNER =
  "Ennek a hibajegynek nincs partnere, ezért nem lehet alá munkalapot nyitni: a szerver a lapot visszautasítaná. Előbb a jegyre kell partner.";

/**
 * A JEGY PARTNERE A VALASZTHATO LISTABOL, HA OTT VAN.
 *
 * MIERT NEM CSAK A LISTABOL: a jegy LETEZIK azzal a partnerrel, tehat a lap is
 * letrehozhato ala. Ha a valaszthato lista (ami maskepp szurhet) nem tartalmazza,
 * a lap MEGIS mehet -- a nevet a jegy adja, a kod marad ures. A forditott
 * dontes (megtagadni) egy mukodo utat zarna le egy megjelenitesi reszlet miatt.
 */
function partnerAJegybol(
  jegy: JegyAdat,
  partnerek: readonly ValaszthatoPartner[],
): ValaszthatoPartner | null {
  if (!jegy.customerId) return null;
  const listabol = partnerek.find((p) => p.customerId === jegy.customerId);
  if (listabol) return listabol;
  return {
    customerId: jegy.customerId,
    name: jegy.customerName?.trim() || "A hibajegy partnere",
    partnerCode: "",
  };
}

export function prefillFromTicket(bemenet: {
  link: TicketLink;
  jegy: JegyAdat | null;
  betoltes: boolean;
  hiba: boolean;
  partnerek: readonly ValaszthatoPartner[];
}): JegyElotoltes {
  if (bemenet.link.kind === "none") return { kind: "nincs" };
  if (bemenet.link.kind === "queued") return { kind: "sorban" };
  if (bemenet.hiba) return { kind: "hiba", uzenet: JEGY_BETOLTES_HIBA };
  if (bemenet.betoltes || !bemenet.jegy) return { kind: "toltes" };

  const partner = partnerAJegybol(bemenet.jegy, bemenet.partnerek);
  if (!partner) return { kind: "nincs-partner", uzenet: JEGY_NINCS_PARTNER };
  return {
    kind: "kesz",
    partner,
    /* A HIANYZO HELYSZIN URES STRINGKENT megy tovabb: a kepernyo allapota is az,
       es a szerelo valaszt. Nem hibaag. */
    departmentId: bemenet.jegy.departmentId,
  };
}

/**
 * ZARVA LEGYEN-E A PARTNER-VALASZTO.
 *
 * NEM ugyanaz, mint hogy van-e elotoltott partner: a betoltes ALATT is zart,
 * kulonben a szerelo valaszthatna egy olyat, amit a kovetkezo pillanatban
 * felulirunk. Es a SORBAN allo jegynel NYITVA marad, mert ott tenyleg neki kell
 * valasztania.
 */
export function partnerLezarva(elotoltes: JegyElotoltes): boolean {
  return (
    elotoltes.kind === "toltes" ||
    elotoltes.kind === "kesz" ||
    elotoltes.kind === "nincs-partner"
  );
}
