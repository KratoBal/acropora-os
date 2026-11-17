/**
 * A SZÁZALÉK SZÖVEGE FELIRATHOZ: a tizedes UTÁNI felesleges nullák nélkül, a kerek százalék viszont ép marad (task
 * t-20261117-dijbekero-szazalek, Luca jelzése, 2026-11-17: a díjbekérő „60%” helyett „6%” feliratot kapott).
 *
 * A HIBA, AMIT EZ VÁLTJA: a `value.replace(/\.?0+$/, "")` a tizedespont NÉLKÜLI szövegből is levágja a záró nullát ("60" -> "6",
 * "100" -> "1"), mert a pont elhagyható a mintában. A szöveg ilyenkor jön, ha egy tizedes-szám `toString()`-je a felesleges
 * nullákat már elhagyta ("60.00" helyett "60"). A nullát csak akkor szabad levágni, ha van tizedespont: akkor mögötte állnak
 * a felesleges nullák, és csak azok.
 */
export function trimPercentText(value: string): string {
  const text = value.trim();
  if (!text.includes(".")) return text;
  return text.replace(/0+$/, "").replace(/\.$/, "");
}
