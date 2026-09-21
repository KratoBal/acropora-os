import type { WorksheetDocumentType } from "@acropora/types";

/**
 * KESZULJON-E VEGLEGES LAP EGY ALAIRASI DONTESRE -- ES MILYEN TIPUSSAL.
 *
 * === MIERT KULON, TISZTA FUGGVENY, ES NEM EGY `if` A TRANZAKCIOBAN ===
 *
 * A dontes a `sign()` belsejeben all, az pedig a Prisma tranzakcio mogott ul:
 * ott egysegteszt nem tud allitast tenni rola, csak az integracios keszlet --
 * ami Postgres nelkul KIMARAD, tehat helyben SEMMIT nem allit. Egy szabaly,
 * amit csak a CI tud merni, egy elgepeles utan is zold marad nalam.
 *
 * (Ugyanaz a lepes, amit a `projectUnasChannelRow` kiemelesenel mar egyszer
 * megtettem: ha egy rontas nulla pirosat ad, nem a merest kell javitani, hanem
 * a KODOT elmozditani oda, ahol merheto.)
 *
 * === A SZABALY, ES AZ INDOKA ===
 *
 * ELFOGADASNAL keszul vegleges lap. Az allapot ekkor `SIGNED`, tehat a
 * piszkozat-felirat feltetele (`status !== "SIGNED"`) magatol hamis, es az
 * alairas sora is all mellette -- vagyis a lap tartalma magatol a vegleges.
 *
 * ELUTASITASNAL NEM KESZUL, es ez nem kimaradas:
 *
 *   az allapot `REJECTED`, tehat a felirat-feltetel IGAZ MARAD -- egy
 *   "vegleges"-nek nevezett dokumentum PISZKOZAT felirattal menne a vevo ele.
 *   Az rosszabb, mint ha nem keszul: epp azt a kerdest nyitna ujra, amit ez a
 *   tetel lezar.
 *
 * Es tartalmilag sem vegleges: elutasitas utan a munka folytatodik, uj lappal.
 *
 * EZ AZ EN DONTESEM (nautilus, 2026-09-21), nem Balazse. O a B alakot hagyta
 * jova ("igen jo igy", 2026-09-21 09:02:39 UTC), ami arrol szol, hogy az
 * alairas MELLE tegyen egy kulon lapot; az elutasitas eseterol nem esett szo.
 * Ha valaki ezt felulvizsgalja, ez a bekezdes a kiindulopont, nem egy
 * gazdai dontes.
 */
export function signedSheetTypeFor(
  decision: "ACCEPTED" | "REJECTED",
  /*
    A VISSZATERESI TIPUS SZUKEBB A KOZOS UNIONAL, ES EZ SZANDEKOS. A
    `WorksheetDocumentType` negy erteket ismer; ez a fuggveny ketto kozul valaszt
    (`SIGNED_SHEET` vagy semmi). A tag alak forditasi hibat nem adna arra, ha
    valaki egyszer `PHOTO`-t adna vissza innen -- a szuk igen.

    A `satisfies` azert all itt, hogy a szuk alak ne szakadjon el a kozostol: ha
    a `SIGNED_SHEET` valaha kikerul az unioból, ez a sor pirosodik.
  */
): (WorksheetDocumentType & "SIGNED_SHEET") | null {
  return decision === "ACCEPTED" ? "SIGNED_SHEET" : null;
}
