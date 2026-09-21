import type { WorksheetVersionStatus } from "@acropora/database";

/**
 * A HIBAJEGY ÉS A MUNKALAP ALÁÍRÁSÁNAK KÉT KAPUJA, EGY HELYEN.
 *
 * Balázs teljes specifikációja, 2026-09-18 18:06:13 UTC (Discord, Acropora OS
 * szál, message_id 1550568645871149187), szó szerint:
 *
 *   „Ha nem kerul ala munkalap, akkor lezarhato. Ha kerul ala munkalap, akkor
 *    csak ugy zarhato le ha a munkalap ala van irva. Es a fentiekbol kovetkezik,
 *    hogy munkalap sem irhato addig ala, amig nincs felette hibajegy."
 *
 * A KÉT SZABÁLY EGY MODULBAN ÁLL, MERT EGYMÁS FELTÉTELEI. A jegy kapuja azon
 * nyugszik, hogy az aláírás JELENT valamit; az aláírás kapuja azon, hogy nem
 * keletkezhet aláírás jegy nélkül. Külön fájlban a második szigorítása az
 * elsőt csendben tenné üressé.
 *
 * === A KÁRTYA CÍME EGY KORÁBBI, SZŰKEBB ALAKOT ŐRIZ ===
 *
 * A 391af0fc kártya címe „nincsenek lezárva a munkalapjai" alakban áll, Balázs
 * 17:54-es első mondatából. A 18:06-os teljes specifikáció ezt FELVÁLTJA:
 * a feltétel az ALÁÍRÁS, nem a lezárás. A kettő ma egybeesik az éles adaton
 * (mind a négy számozott lap SIGNED és van closedAt-ja), és a séma mégis külön
 * tartja őket -- ezért a kód az aláírásra néz. Aki a címből indul, egy másik
 * mezőre fog őrzőt írni, mint amiről a döntés szól.
 *
 * TISZTA FÜGGVÉNYEK, adatbázis nélkül mérhetők -- ugyanaz az alak, mint a
 * `worksheet-under-ticket.ts`-nél. A MONDATOT itt is a hívó adja: a jegy
 * kezelője és a lapot aláíró partner két különböző helyzetben áll, és egy
 * közös mondat vagy pontatlan lenne, vagy semmitmondó.
 */

/** Egy munkalap annyi állapota, amennyi a kapuhoz kell. */
export interface TicketWorksheetSignatureState {
  id: string;
  /** A lap száma, vagy `null`, ha még piszkozat-néven áll. */
  number: string | null;
  /**
   * A JELENLEGI (legmagasabb) verzió állapota, vagy `null`, ha nincs verzió.
   *
   * A „jelenlegi" itt ugyanazt jelenti, mint a repository többi helyén: a
   * `version` szerint csökkenő sorrend első eleme. Egy KORÁBBI verzió aláírása
   * nem elég: ha a lap azóta új verziót kapott, a mai tartalom aláíratlan.
   */
  currentVersionStatus: WorksheetVersionStatus | null;
  /** Rejtett-e a lap. MÉRVE VAN, de NEM mentesít -- lásd alább. */
  hidden: boolean;
}

/**
 * MELYIK MUNKALAP TARTJA VISSZA A JEGY LEZÁRÁSÁT.
 *
 * A visszatérés LISTA, nem igen/nem, mert a hívónak meg kell neveznie a lapot.
 * Egy puszta „nem zárható le" a kezelőt keresésre küldi, és a jegy alatt akár
 * öt lap is állhat.
 *
 * === A REJTETT LAP IS VISSZATARTJA, ÉS EZ DÖNTÉS ===
 *
 * A rejtés MEGJELENÍTÉSI művelet: kiveszi a lapot a listákból. Ha egyben a
 * kaput is kinyitná, akkor egy nézet-kapcsolóból jogosultsági eszköz lenne, és
 * a legrosszabb fajta: CSENDES. Aki egy aláíratlan lapot elrejt, bezárhatná
 * fölötte a jegyet anélkül, hogy bárhol nyoma maradna, hogy a munka
 * aláírás nélkül zárult.
 *
 * A mérce nem az, hogy melyik eset a valószínűbb, hanem hogy melyik tévedés
 * marad rejtve. A fölösleges szigor HANGOS (valaki nem tud lezárni, és szól);
 * a fölösleges engedékenység NÉMA.
 *
 * ÉS VAN KIÚT, TEHÁT EZ NEM CSAPDA: a lap aláírható, vagy leválasztható a
 * jegyről (`DELETE /service/service-jobs/:id/worksheets/:worksheetId`). A
 * rejtés maga is visszavonható, a munkalap-listán a „Rejtettek is" jelölővel.
 * Ezért a hívó mondatának KI KELL MONDANIA, hogy a lap rejtett: a jegy alatti
 * lista szándékosan nem mutatja, tehát a kezelő hiába keresi ott.
 */
export function worksheetsBlockingTicketClose(
  worksheets: readonly TicketWorksheetSignatureState[],
): TicketWorksheetSignatureState[] {
  return worksheets.filter((sheet) => sheet.currentVersionStatus !== "SIGNED");
}

export type WorksheetSignatureCheck =
  { ok: true } | { ok: false; reason: "no-ticket" };

/**
 * ALÁÍRHATÓ-E EZ A MUNKALAP.
 *
 * NEM ÚJ DÖNTÉS: Balázs 2026-09-02 08:08-kor már kimondta (Munkalap folyamatok
 * szál), szó szerint: „ha egy Munkalapnak nincs hibajegye, akkor nem lehet
 * alairni, lezarni es nem keszulhet rola TIG, Szamla". A 2026-09-18-i
 * specifikáció ugyanezt mondja, ugyanabban a szerkezetben -- három hét
 * különbséggel. Megerősített szabály, nem friss ötlet.
 *
 * A DÖNTÉS MINDKÉT IRÁNYÁRA ÁLL (jóváhagyás és elutasítás), és ez szándékos:
 * jegy nélkül egy elutasításra sem vár senki. A `REJECTED` verzió egy olyan
 * folyamat lépése volna, ami el sem kezdődött.
 */
export function mayWorksheetBeSigned(input: {
  /** A lap fölötti hibajegy azonosítója, vagy `null`, ha nincs. */
  serviceJobId: string | null;
}): WorksheetSignatureCheck {
  if (input.serviceJobId === null) return { ok: false, reason: "no-ticket" };
  return { ok: true };
}
