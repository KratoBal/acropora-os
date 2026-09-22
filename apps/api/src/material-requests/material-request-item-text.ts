/**
 * A `{{tetelek}}` VALTOZO SZOVEGE -- TISZTA FUGGVENYBEN, hogy a level-osszeallitastol
 * fuggetlenul tesztelheto legyen.
 *
 * SORONKENT EGY TETEL, "- nev: mennyiseg egyseg" alakban. Nincs tablazat es
 * nincs formazas: a level sima szoveg (`text/plain`), es a harom mezo maga is
 * szabad szoveg (lasd a `MaterialRequestItem` sema fejlecet) -- a cel az
 * olvashatosag, nem a szerkezet.
 */
export function materialRequestItemsText(
  items: readonly {
    readonly name: string;
    readonly quantity: string;
    readonly unit: string;
  }[],
): string {
  return items
    .map((item) => `- ${item.name}: ${item.quantity} ${item.unit}`)
    .join("\n");
}
