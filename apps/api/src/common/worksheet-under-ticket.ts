/**
 * FOGADHATJA-E EZ A HIBAJEGY EZT A MUNKALAPOT.
 *
 * KOZOS FUGGVENY, KET HIVOVAL, es ez nem elore-general as: a szabaly MA is ket
 * helyen kell. A meglevo lap CSATOLASA a `service-jobs` modulban all, az uj lap
 * NYITASA a jegy alatt a `worksheets` modulban -- ket kulonbozo ut ugyanarra a
 * kerdesre. Ha mindkettoben kulon allna, egy kesobbi szigoritas az egyik utat
 * javitana, a masikat nem, es a kulonbseg NEMA lenne: a lap letrejon, csak nem
 * ott, ahol keresik.
 *
 * TISZTA FUGGVENY, hogy a harom eset adatbazis nelkul is merheto legyen --
 * ugyanaz az alak, mint a lathatosagi hozzarendelesnel.
 *
 * A MONDATOT A HIVO ADJA, NEM EZ A FUGGVENY, es ez szandekos. A ket ut MAS
 * helyzetben all: az egyiknel a lap MAR LETEZIK es athelyezesrol van szo, a
 * masiknal MOST keletkezne. Ugyanaz a mondat mindkettore vagy pontatlan lenne,
 * vagy annyira altalanos, hogy nem mond semmit. A SZABALY kozos, a SZOVEG nem.
 */
export type WorksheetUnderTicketCheck =
  | { ok: true }
  | { ok: false; reason: "ticket-has-no-partner" | "other-partner" };

export function mayWorksheetJoinTicket(input: {
  /** A hibajegy partnere. `null`, ha a jegyhez meg nincs partner rendelve. */
  ticketCustomerId: string | null;
  /** A munkalap partnere. Kotelezo: lap partner nelkul nem letezik. */
  worksheetCustomerId: string;
}): WorksheetUnderTicketCheck {
  /**
   * PARTNER NELKULI JEGY NEM FOGADHAT LAPOT, es a ket eset kulonbozik: itt
   * nincs MIHEZ merni. Ha ezt osszevonnank az eltero partnerrel, a felhasznalo
   * azt a mondatot kapna, hogy "masik partnere" -- holott a jegynek egy sincs,
   * es a teendo is mas (allitsd be a jegy partneret).
   */
  if (input.ticketCustomerId === null)
    return { ok: false, reason: "ticket-has-no-partner" };

  if (input.ticketCustomerId !== input.worksheetCustomerId)
    return { ok: false, reason: "other-partner" };

  return { ok: true };
}
