import type { PartnerScope } from "../auth/partner-scope.util.js";

/**
 * KI IRHAT EGY HIBAJEGYET -- ES MIERT NEM UGYANAZ A SZABALY, MINT AZ OLVASAS.
 *
 * === A MERES, AMIERT EZ A FAJL LETEZIK (2026-09-14) ===
 *
 * A modul OT irasi utja (`move`, `attachWorksheet`, `detachWorksheet`,
 * `setPartner`, `setAssignees`) SEMMILYEN hatokort nem nezett. A
 * `visibilityFor` a teljes szolgaltatasban pontosan KET helyen hivodott: a
 * listanal es a reszletlapnal -- vagyis csak az OLVASAS szurt.
 *
 * A `setAssignees` volt a legbeszedesebb: az iras a tranzakcioban MEGTORTENT,
 * es a hatokor csak azutan, a valasz osszeallitasakor (`this.detail(id, user)`)
 * szolalt meg. A hivo 404-et kapott, a valtozas viszont bent maradt.
 *
 * ES SEMMI NEM MERTE: a `partner-scope-endpoint.integration.spec.ts` a
 * `service/jobs` utvonalakat nullaszor emlitette.
 *
 * === MIERT "BELSO", ES NEM A LATHATOSAGI SZURO ===
 *
 * Kezenfekvo lenne ugyanazt a szurot tenni az iras ele, amit az olvasas
 * hasznal. Az KEVESEBB lenne: egy partner-hatokoru fiok a SAJAT, latott jegyere
 * tovabbra is irhatna. Mind az ot ut viszont a MI munkank rendjerol szol, nem a
 * bejelentesrol (acrobot triazsa, 2026-09-14):
 *
 *   move              egy allapotvaltas a mi munkank rendje, nem a bejelentoe
 *   attachWorksheet   a munkalap a mi BELSO adatunk
 *   detachWorksheet   ugyanaz
 *   setPartner        a jegy GAZDAJAT irna at -- kulso fioknak semmi dolga vele
 *   setAssignees      a MI kollegaink nevsora, es a DTO teljes-nevsor
 *                     szemantikaja miatt egy URES lista leszedne mindenkit
 *
 * === MIERT 404, ES NEM 403 ===
 *
 * Ugyanaz a valasz, amit az olvasas ad egy nem lathato jegyre. Egy kulon "nincs
 * jogod" uzenet elarulna, hogy a jegy LETEZIK -- a szamabol pedig egy partner
 * vegigprobalhatna, mennyi jegyunk van. A ket ut igy ugyanazt mondja, es a
 * kulonbseguk nem is merheto kivulrol.
 *
 * === AMI MA VISSZAFOGTA, ES AMIERT NEM VOLT VEDELEM ===
 *
 * Az azonositok `cuid` alakuak, tehat nem sorszamozhatok vegig, es ma
 * valoszinuleg nincs is partner-hatokoru `service.manage` fiok. Mindketto
 * KORNYEZETI korulmeny, nem szabaly -- es az ugyfelportal (Balazs 2026-09-14-i
 * felvetese) pontosan azt a korulmenyt szuntetne meg.
 */
export function mayWriteServiceJob(scope: PartnerScope): boolean {
  return scope.kind === "internal";
}
