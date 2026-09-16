import type { UnitOfMeasure } from "@acropora/types";

/**
 * A TELJESÍTMÉNY MEZŐ TISZTA RÉSZE.
 *
 * MIÉRT KÜLÖN FÁJL: a két döntés, amit itt el kell találni, renderelés nélkül
 * is állítható -- és mind a kettőt csendben el lehetne rontani.
 */

/**
 * MI VÁLASZTHATÓ A LEGÖRDÜLŐBEN -- ÉS A KIVEZETETT EGYSÉG ITT NEM ESHET KI.
 *
 * === A CSAPDA, AMIT EZ ZÁR BE ===
 *
 * A választó az AKTÍV egységeket kínálja. Ha egy eszközön viszont már egy
 * azóta KIVEZETETT egység áll, és a lista csak az aktívakat tartalmazza, akkor
 * a legördülő a saját értékét nem tudja megmutatni: a böngésző az első elemre
 * esik vissza. A kezelő megnyitja az adatlapot, egy szót sem ír, ment -- és a
 * mértékegység MEGVÁLTOZIK. Némán, és pont azon az úton, ahol senki nem keresi.
 *
 * Ezért a mostani egység akkor is bekerül, ha kivezetett: a kivezetés a
 * VÁLASZTÉKOT szűkíti, nem a MÚLTAT írja át.
 */
export function performanceUnitOptions(
  aktivak: readonly UnitOfMeasure[],
  mostani: UnitOfMeasure | undefined,
): UnitOfMeasure[] {
  if (!mostani) return [...aktivak];
  return aktivak.some((unit) => unit.id === mostani.id)
    ? [...aktivak]
    : [...aktivak, mostani];
}

/**
 * MI A BAJ A BEÍRT PÁRRAL, VAGY `null`.
 *
 * A SZERVER UGYANEZT MÉG EGYSZER ELDÖNTI, és ez nem duplikáció: itt a kezelő a
 * mező mellett látja, ott a szabály áll. A `missing-unit` és a `missing-value`
 * KÉT külön mondat, mert két külön teendő -- legördülőt választani, vagy számot
 * írni.
 *
 * ÉS A SORREND SZÁMÍT: az alak-hiba ELŐBB áll. Egy „ötszáz" beírására a
 * „válassz mértékegységet" mondat félrevezető lenne, hiszen a szám a baj.
 */
export function performancePairProblem(
  ertek: string,
  unitId: string,
  alakHibas: boolean,
): "malformed" | "missing-unit" | "missing-value" | null {
  const vanErtek = ertek.trim() !== "";
  const vanEgyseg = unitId.trim() !== "";
  if (vanErtek && alakHibas) return "malformed";
  if (vanErtek && !vanEgyseg) return "missing-unit";
  if (!vanErtek && vanEgyseg) return "missing-value";
  return null;
}

/** A mondat, amit a kezelő lát. Egy helyen, mert két képernyő olvassa. */
export const PERFORMANCE_PROBLEM_MESSAGES: Record<
  "malformed" | "missing-unit" | "missing-value",
  string
> = {
  malformed:
    "A teljesítmény csak szám lehet, legfeljebb hat tizedesjeggyel (például 0,5 vagy 500).",
  "missing-unit": "Válassz mértékegységet a teljesítmény mellé.",
  "missing-value":
    "Írj teljesítmény-értéket a mértékegység mellé, vagy töröld a mértékegységet is.",
};
