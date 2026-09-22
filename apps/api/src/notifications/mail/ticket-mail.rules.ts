/**
 * KINEK MEGY LEVEL A HIBAJEGYROL, ES MIKOR NEM -- TISZTA FUGGVENYEKBEN.
 *
 * Balazs dontese, 2026-09-21 11:25:35 UTC (Discord, fo csatorna, message_id
 * 1551554987992289302), szo szerint: "igen ertesitsuk, de a ticket@acropora.hu
 * cimet hasznaljuk".
 *
 * EZ A MODUL SEMMIT NEM IMPORTAL, es ez nem esztetika: a kuldes dontese igy
 * merheto adatbazis es halozat nelkul, es a Gmail letezeserol nem tud semmit.
 */

/**
 * A KAPU. ALAPERTELMEZESBEN ZARVA, ES NEM A TITKOK HIANYARA BIZZUK.
 *
 * acrobot elso kikotese (2026-09-21): a kuldes SOHA ne menjen ki tesztbol vagy
 * stagingbol valodi cimre. Kezenfekvo lenne azt mondani, hogy a hitelesito
 * adatok hianya amugy is megvedi -- DE azok egy staging kornyezetbe konnyen
 * atmasolodnak, es akkor az a vedelem CSENDBEN elesik. Egy kimondott kapcsolo
 * nem masolodik at veletlenul.
 *
 * AZ ISMERETLEN ERTEK ZARVA. Nem csak a hianyzo: egy elgepelt "liv" vagy egy
 * orokolt "true" NE nyisson kaput. A megengedo irany itt visszavonhatatlan
 * (a level a vevonel jelenik meg), a szigoru irany pedig hangos: valaki szol,
 * hogy nem ment ki a level.
 */
export type MailMode = "off" | "live";

export function mailModeOf(raw: string | undefined | null): MailMode {
  return raw?.trim().toLowerCase() === "live" ? "live" : "off";
}

/**
 * KET RETEG, ES A MASODIK UTANKENT KULON (Balazs kerese, 2026-09-22).
 *
 * A `TICKET_MAIL_MODE` marad a FO kapcsolo: ha az nem `live`, SEMMI nem megy
 * ki. Fole ezen a jelentesen nem valtoztattunk -- egy mai beallitas ugyanazt
 * jelenti, mint tegnap.
 *
 * A HAROM UT viszont sajat kulcsot kap, es MINDHAROM ALAPERTELMEZESBEN ZARVA:
 *
 *     TICKET_MAIL_WORKSHEET_SIGNED   a munkalap alairasarol szolo level
 *     TICKET_MAIL_JOB_OPENED         az ugyfel-bejelentes ertesitoje
 *     TICKET_MAIL_HANDOVER           a kezzel inditott atadasi level
 *
 * AZ ALAPERTELMEZES IRANYA NEM IZLES, ES AZ INDOKA A FELEJTES ALAKJA
 * (acrobot dontese, ugyanaznap). A ket alak akkor ter el, amikor valaki
 * ELFELEJT beallitani egy kulcsot:
 *
 *     nyitott alapertelmezesnel   a felejtes LEVELET KULD -- visszafordithatatlan,
 *                                 mert a level a vevonel jelenik meg
 *     zart alapertelmezesnel      a felejtes NEMA marad -- panasz, nem kar
 *
 * Ugyanaz az ervelés, mint a fenti kapunal: a megengedo irany visszavonhatatlan,
 * a szigoru hangos.
 *
 * A FELISMERES FUGGVENYE UGYANAZ, ES EZ SZANDEKOS: a "csak a `live` nyit" szabaly
 * EGY helyen all. Ha ket kulon fuggveny olvasna a ket reteget, a szabaly ket
 * helyre kerulne -- es a ketto egyszer elcsuszna.
 */
export type MailPathKey =
  | "TICKET_MAIL_WORKSHEET_SIGNED"
  | "TICKET_MAIL_JOB_OPENED"
  | "TICKET_MAIL_HANDOVER"
  | "TICKET_MAIL_WORKSHEET_SEND_FOR_SIGNATURE";

/**
 * A KET KAPU EGYUTT, SORRENDBEN -- ES A SORREND ADJA A KIHAGYAS OKAT.
 *
 * A FO kapcsolo all elol. Nem sorrendi izles: ha az UT kapcsolojat kerdeznenk
 * eloszor, egy teljesen kikapcsolt kornyezetben `path-off` ok jonne, es az
 * uzemeltetot ROSSZ kulcshoz kuldenenk.
 *
 *     mail-off   a FO kapcsolo zarva     -> a kornyezetet kell megnezni
 *     path-off   az UT kapcsoloja zarva  -> EZT az egy kulcsot kell kinyitni
 *
 * Ket kulon teendo, ezert ket kulon szo. Egy kozos "ki van kapcsolva" mondat
 * mind a kettot ugyanoda vezetne.
 */
export type MailGateSkipReason = "mail-off" | "path-off" | "no-redirect";

/**
 * ES EGY HARMADIK KORNYEZETI OK, AMI NEM A KAPUBOL JON: HIANYZIK A KULDO.
 *
 * A `mailGate` a KET KAPCSOLOT nezi. Van viszont egy harmadik allapot, amiben
 * ugyanugy nem megy ki level, es ugyanugy a KORNYEZET a felelos: a Gmail-kuldo
 * nincs beallitva (`!this.sender`).
 *
 * 2026-09-22-IG EZ IS `mail-off`-OT ADOTT, ES EZ A MAI ESTE PONT ROSSZ IRANYBA
 * KULDENE. Ma kapcsoljuk be eloszor a levelezest, es a kuldo beallitasa meg
 * soha nem futott eles modban. Ha hianyzik, a naplo `mail-off`-ot mondana --
 * es akkor a KAPCSOLOT neznenk, ami helyesen all. Egy fel ora, pont a probanal.
 *
 *     mail-off    a fo kapcsolo zarva      -> a kornyezeti valtozot nezd
 *     path-off    az ut kapcsoloja zarva   -> EZT az egy kulcsot nyisd ki
 *     no-sender   a kuldo nincs beallitva  -> a Gmail-hitelesitest nezd
 *
 * Harom allapot, harom kulon teendo, harom kulon szo.
 *
 * ES A NAPLO-DONTES SZEMPONTJABOL MINDHAROM EGYFORMA: a KORNYEZET allapota,
 * nem a jegye. Ezert all a harom EGY halmazban -- az donti el, hogy irunk-e
 * naplo-sort a jegyre, es arra a kerdesre mindharomnal ugyanaz a valasz.
 */
export type MailEnvironmentSkipReason = MailGateSkipReason | "no-sender";

/**
 * A KORNYEZETI OKOK HALMAZA, ES A `Record<..., true>` ALAK SZANDEKOS.
 *
 * A hivok ebbol dontik el, hogy a kihagyas a KORNYEZET allapota-e (akkor nem
 * irunk naplot a jegyre), vagy a jegyen mulik-e (akkor igen).
 *
 * MIERT NEM EGY `||` LANC vagy egy `readonly T[]`: mind a ketto elfogadna egy
 * HIANYOS felsorolast. Egy ujabb kornyezeti ok bevezetese utan a lanc csendben
 * `false`-ot adna ra -- es akkor egy zart kapu melletti futas naplo-sort irna a
 * jegyre, minden kornyezetben. A `Record<MailEnvironmentSkipReason, true>`
 * TELJESSEGET kovetel: egy uj ertek FORDITASI HIBA, amig ide nem kerul.
 *
 * ES EZ NEM ELMELETI: a `no-sender` felvetelekor (2026-09-22) a fordito
 * PONTOSAN ITT allt meg, nem a hivohelyeken.
 */
const KORNYEZETI_OKOK: Record<MailEnvironmentSkipReason, true> = {
  "mail-off": true,
  "path-off": true,
  "no-redirect": true,
  "no-sender": true,
};

export function isMailEnvironmentReason(
  reason: string,
): reason is MailEnvironmentSkipReason {
  return Object.hasOwn(KORNYEZETI_OKOK, reason);
}

export function mailGate(input: {
  mode: MailMode;
  pathMode: MailMode;
  redirect: MailRedirect;
}):
  | { readonly kind: "open" }
  | { readonly kind: "closed"; readonly reason: MailGateSkipReason } {
  if (input.mode !== "live") return { kind: "closed", reason: "mail-off" };
  if (input.pathMode !== "live") return { kind: "closed", reason: "path-off" };
  /*
    A HARMADIK KAPU, ES A SORREND SZANDEKOS: a `no-redirect` a KET kapcsolo-ok
    UTAN all.

    Egy teljesen kikapcsolt kornyezetben mind a harom feltetel teljesul, es
    olyankor a naplonak a FO kapcsolot kell megneveznie -- kulonben azt mondana,
    hogy egy cim beirasa eleg, holott meg ket kapcsolo is kell.

    A `no-redirect` tehat CSAK akkor jelenik meg, amikor a ket kapcsolo mar
    nyitva van -- vagyis pontosan abban az allapotban, ahol a level tenyleg
    kimenne. Ez teszi hasznalhatova: a sor azt mondja meg, hogy MOST egy hianyzo
    cim allitott meg egy KESZ kuldest.
  */
  if (input.redirect.kind === "block")
    return { kind: "closed", reason: "no-redirect" };
  return { kind: "open" };
}

/**
 * A NYITO, AKINEK A LEVEL SZOL.
 *
 * NEGY KIMENET VAN, NEM KETTO, es ezt merni kellett (nautilus, 2026-09-21):
 *
 *   openedById null           regi sorok: a migracio a keletkezes esemenyebol
 *                             toltott, es ott az aktor mar lehetett `null`
 *   openedById all, User NINCS  az `openedById`-n SZANDEKOSAN NINCS
 *                             IDEGENKULCS (lasd a sema fejlecet: egy torolt
 *                             kollega jegye igy is megtartja a nyitojat).
 *                             Tehat az azonosito mutathat NEM LETEZO sorra, es
 *                             ezt semmilyen adatbazis-megkotes nem zarja ki.
 *   a User INAKTIV            acrobot dontese: NEM kuldunk. Egy kilepett
 *                             kollega cimere kuldott level rosszabb a
 *                             hallgatasnal.
 *   van User es cim           kuldes. A `User.email` KOTELEZO es egyedi, tehat
 *                             ha a sor letezik, cim is van.
 *
 * A HAROM KIHAGYAS HAROM KULON OK, NEM EGY. acrobot kikotese: a kihagyas ne
 * legyen nema, es ne ugyanaz az ag legyen, mint a sikeres kuldes. Kulonben az
 * elso kerdesre ("miert nem kapott levelet?") megint csak annyit tudunk
 * mondani, hogy nem tudjuk.
 */
export interface TicketOpener {
  readonly email: string;
  readonly displayName: string;
  readonly isActive: boolean;
}

export type MailSkipReason =
  MailGateSkipReason | "no-opener" | "opener-missing" | "opener-inactive";

export type MailDecision =
  | { readonly kind: "send"; readonly to: string; readonly name: string }
  | { readonly kind: "skip"; readonly reason: MailSkipReason };

/**
 * A KAPU ALL ELOL, MINDEN MAS ELOTT.
 *
 * Nem sorrendi izles: ha a cimzett-feloldas futna eloszor, egy zart kapu
 * melletti futas is "nincs kinek" okot adna -- es az a naploban ugy nezne ki,
 * mintha a jegyen lenne a baj, nem a kornyezeten.
 */
/**
 * UGYFEL NYITOTT JEGYET -- MEHET-E LEVEL, ES KINEK.
 *
 * KULON DONTES A NYITO-ERTESITES MELLETT, es nem ugyanaz mas cimzettel:
 *
 *   a nyito-ertesites   EGY cimzettet ismer, es a jegyrol vezet hozza
 *                       (`openedById` -> `opener`)
 *   ez                  TOBB cimzett, es a SZEREPBOL jon, nem a jegyrol
 *
 * AMI KOZOS: a `mode` kapu. Az ugyanaz a kornyezeti allapot, es szandekosan
 * ELOL all mind a kettonel -- ha a levelezes ki van kapcsolva, a cimzettek
 * lekerdezese is fölösleges munka lenne.
 *
 * AZ URES CIMZETT-LISTA SAJAT OK, nem „mail-off": a kulonbseg az, hogy az
 * elsot a kornyezet okozza, a masodikat az, hogy SENKINEL nincs bejelolve a
 * szerep. A masodik a felhasznalonak szol es javithato a beallitasokban; az
 * elso nem.
 */
export type ServiceJobOpenedMailDecision =
  | { readonly kind: "send"; readonly to: readonly string[] }
  | {
      readonly kind: "skip";
      readonly reason: MailGateSkipReason | "no-recipient";
    };

export function serviceJobOpenedMailDecision(input: {
  mode: MailMode;
  pathMode: MailMode;
  redirect: MailRedirect;
  recipients: readonly { readonly email: string }[];
}): ServiceJobOpenedMailDecision {
  const kapu = mailGate(input);
  if (kapu.kind === "closed") return { kind: "skip", reason: kapu.reason };
  const cimek = input.recipients
    .map((cimzett) => cimzett.email.trim())
    .filter((email) => email.length > 0);
  if (cimek.length === 0) return { kind: "skip", reason: "no-recipient" };
  return { kind: "send", to: cimek };
}

/**
 * KIKULDES ALAIRASRA -- A NEGYEDIK UT, ES A LEGEGYSZERUBB DONTES A NEGYBOL.
 *
 * MIERT NINCS SAJAT "no-recipient" AGA, MINT A MASIK KETTONEK: a cimzettet
 * NEM ez a fuggveny oldja fel. A `WorksheetsRepository.sendForSignature` MAR
 * ELLENORIZTE, hogy a valasztott alairo letezik, aktiv, es a munkalap
 * partnerenek munkatarsa (`SIGNER_NOT_IN_PARTNER` kulonben elutasitja a
 * MUVELETET magat, meg a level elott). Mire ez a fuggveny fut, a cimzett MAR
 * ERVENYES -- tehat itt csak a kapu szamit.
 */
export type WorksheetSendForSignatureMailDecision =
  | { readonly kind: "send" }
  | { readonly kind: "skip"; readonly reason: MailGateSkipReason };

export function worksheetSendForSignatureMailDecision(input: {
  mode: MailMode;
  pathMode: MailMode;
  redirect: MailRedirect;
}): WorksheetSendForSignatureMailDecision {
  const kapu = mailGate(input);
  if (kapu.kind === "closed") return { kind: "skip", reason: kapu.reason };
  return { kind: "send" };
}

export function ticketMailDecision(input: {
  mode: MailMode;
  pathMode: MailMode;
  redirect: MailRedirect;
  openedById: string | null;
  opener: TicketOpener | null;
}): MailDecision {
  const kapu = mailGate(input);
  if (kapu.kind === "closed") return { kind: "skip", reason: kapu.reason };
  if (input.openedById === null) return { kind: "skip", reason: "no-opener" };
  if (input.opener === null) return { kind: "skip", reason: "opener-missing" };
  if (!input.opener.isActive)
    return { kind: "skip", reason: "opener-inactive" };
  return {
    kind: "send",
    to: input.opener.email,
    name: input.opener.displayName,
  };
}

/**
 * MIT MONDUNK A NAPLONAK, ES MIT NEM.
 *
 * A NAPLO-SOR CIMET NEM TARTALMAZ, CSAK A TENYT ES A DARABSZAMOT.
 *
 * AZ INDOK, ES EZ NEM AVUL EL: egy cim, ami egyszer bekerul egy naplo
 * SZOVEGEBE, onnantol minden jovobeli feluletnel egyutt utazik, es senki nem
 * fogja megkerdezni, szabad-e kiirni. A dontes tehat nem azon all, hogy MA
 * kimegy-e a naplo-sor a partnernek, hanem azon, hogy egy szovegbe irt cimet
 * kesobb mar nem lehet visszavenni.
 *
 * === AMI EBBOL A BEKEZDESBOL ELAVULT (visszamerve 2026-09-21 este) ===
 *
 * Itt korabban az allt, hogy a `/service/jobs/{id}` valasza SZO SZERINT
 * ugyanaz a partnernek es a belsos felhasznalonak (az fb945858 kartya
 * meresebol). Az a meres a sajat napjan igaz volt; MA MAR NEM AZ, es
 * ugyanazon a napon valt hamissa:
 *
 *   a reszletlap   `detail` a belsosnek a belso alakot adja, a partnernek
 *                  `partnerServiceJobDetail(belso)` alakot, es abbol a naplo-sor
 *                  MEGJEGYZESE (`note`) hianyzik. Balazs dontese, 2026-09-21
 *                  10:5x: "a megjegyzes nem kell a nev igen".
 *   a csomag       ugyanez: a megjegyzes a `scope.kind === "internal"`
 *                  kapcsolon all (`service-job-package.service.ts`).
 *
 * A HIVATKOZOTT TENY VALTOZOTT MEG, NEM A DONTES. Azert all itt mind a ketto,
 * mert egy kijelento alaku komment datum nelkul masnap is ugyanolyan
 * magabiztosan nez ki -- pontosan ez tortent ezzel a bekezdessel.
 */
/**
 * AZ ATIRANYITAS: MINDEN KIMENO LEVEL EGY MEGADOTT CIMRE MEGY A VALODI HELYETT.
 *
 * === MIERT EGY CIM, ES MIERT NEM MOD ===
 *
 * A masik negy kapcsolo `off`/`live` alaku, mert azoknal a KERDES eldontendo.
 * Itt a valasz maga egy ADAT: HOVA menjen. Egy kulon `TICKET_MAIL_REDIRECT`
 * mod + egy cim ket valtozo lenne, amik kozul az egyik hianyozhat -- es a
 * hianyzo cim melletti bekapcsolt mod pontosan az az allapot, amit egyik
 * agunk sem tudna ertelmesen kezelni.
 *
 * === A HIANYZO VALTOZO NEM IRANYIT AT, ES NEM IS NYIT ===
 *
 * acrobot kikotese (2026-09-22). A hianyzo ertek `off`-ot ad, ugyanugy, mint a
 * masik negy kapcsolonal -- es ez itt AZT jelenti, hogy a level a VALODI
 * cimzettnek megy. Onmagaban tehat nem nyit semmit: ahhoz a masik negy
 * kapcsolo kell.
 *
 * ES AMIT EZ NEM OLD MEG, KIMONDVA: ha a harom ut `live`, es ez a valtozo
 * HIANYZIK, a level a vevohoz megy. Ez nem hiba, hanem a vegallapot -- de
 * addig, amig probalunk, a kettot EGYUTT kell beallitani, es a sorrend
 * szamit: eloszor az atiranyitas, aztan a kapcsolok.
 */
export type MailRedirect =
  | { readonly kind: "block" }
  | { readonly kind: "off" }
  | { readonly kind: "on"; readonly to: string };

/**
 * HAROM ALLAPOT, ES A HIANYZO ERTEK A HARMADIK -- NEM AZ "off".
 *
 * === MIERT MAS EZ, MINT A MASIK NEGY KAPCSOLO (acrobot dontese, 2026-09-22) ===
 *
 * Az elso alakom a hianyzo erteket `off`-nak vette, a masik negy kapcsolo
 * mintajara. acrobot ezt visszavonta, es az indoka a TEVEDES ARANAK KULONBSEGE:
 *
 *     a masik negy kapcsolo azt donti el, MIT kuldunk
 *       -> egy elfelejtett ertek CSENDBEN NEM KULD  (panasz, nem kar)
 *     ez a kapcsolo azt donti el, HOVA
 *       -> egy elfelejtett ertek CSENDBEN KIKULD    (a vevonel jelenik meg)
 *
 * A ket irany ara nem egyforma, tehat az alapertelmezesuk sem lehet ugyanaz.
 * Balazs kerese (2026-09-22 17:44:52) szo szerint: "nyissuk mind a harmat de
 * nem menjen ki veletlenul se level senkinek" -- es egy vedohalo, ami ket
 * ember-lepes helyes SORRENDJEN mulik, nem vedohalo.
 *
 * === ES A VEGALLAPOT KIMONDOTT ERTEKEN ALL, NEM A HIANYON ===
 *
 * Amikor tenyleg a vevonek kell mennie, a valtozo `off` (vagy `none`) erteken
 * all. Igy az eles kuldes POZITIV allitas lesz, nem egy uresen hagyott mezo --
 * es az "elfelejtettem beallitani" meg a "szandekosan a vevonek megy" allapot
 * nem nez ki egyformanak.
 */
export function mailRedirect(raw: string | undefined | null): MailRedirect {
  const ertek = raw?.trim() ?? "";
  if (ertek.length === 0) return { kind: "block" };
  const kicsi = ertek.toLowerCase();
  if (kicsi === "off" || kicsi === "none") return { kind: "off" };
  return { kind: "on", to: ertek };
}

/**
 * A NAPLO-SOR VEGE, HA A LEVEL ATIRANYITVA MENT KI.
 *
 * A CIMET SZANDEKOSAN NEM IRJA KI, es ez nem ovatoskodas: a `handoverMailAuditNote`
 * fejlece megmeri, hogy egy naplo-szovegbe kerult cim onnantol minden jovobeli
 * feluletnel egyutt utazik. Az atiranyitas cime ugyanolyan cim.
 *
 * AMI VISZONT KELL: hogy a sorbol KIDERULJON, hogy a cimzett NEM kapta meg.
 * acrobot kikotese (2026-09-22): "kulonben ket honap mulva valaki azt hiszi, a
 * vevo megkapta".
 */
export function redirectAuditSuffix(redirect: MailRedirect): string {
  return redirect.kind === "on"
    ? " ÁTIRÁNYÍTVA egy próbacímre, a valódi címzett NEM kapta meg."
    : "";
}

/**
 * A MASODIK PARAMETER KOTELEZO, ES EZ A KAR IRANYABOL KOVETKEZIK.
 *
 * Elhagyhatokent egy hivo CSENDBEN kihagyhatna, es a naplo azt allitana, hogy a
 * level kiment -- pontosan azt a hamis megnyugvast, ami ellen a sor letezik. A
 * kotelezo mezo a forditot teszi a kapuva: egy uj kuldesi ut nem tud ugy
 * naplozni, hogy elfelejti.
 */
export function mailAuditNote(
  decision: MailDecision,
  redirect: MailRedirect,
): string {
  if (decision.kind !== "send")
    return `Értesítő levél nem ment ki (${decision.reason}).`;
  return `Értesítő levél kiküldve a hibajegy nyitójának.${redirectAuditSuffix(redirect)}`;
}
