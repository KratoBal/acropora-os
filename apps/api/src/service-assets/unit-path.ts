/**
 * AZ ALEGYSÉG TELJES ÚTJA, a gyökértől a megnevezett egységig.
 *
 * MIÉRT KELL, ÉS MIÉRT NEM ELÉG A NÉV: a kód és a név csak TESTVÉREK között
 * egyedi (`@@unique([customerId, parentId, code])`), tehát két távoli ág alatt
 * ugyanaz a „Biodóm (BIO)" megengedett és természetes. Aki egy listában ilyen
 * sort lát, nem tudja megmondani, melyikről van szó, és semmi nem jelzi neki,
 * hogy van miben tévedni. Az út a fa saját szabálya szerint egyedi.
 *
 * TISZTA FÜGGVÉNY, adatbázis nélkül: a hívó tölti be a sorokat egy kötegben, ez
 * pedig csak összerakja. Így egységteszt tudja mérni, hogy a mély fa is végig
 * felépül, és nem csak a levél neve jön vissza.
 */
export interface UnitRow {
  id: string;
  name: string;
  parentId: string | null;
}

export function buildUnitPaths(
  units: readonly UnitRow[],
): Map<string, string[]> {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const paths = new Map<string, string[]>();

  for (const unit of units) {
    const names = [unit.name];
    const seen = new Set<string>([unit.id]);
    let current = unit.parentId ? byId.get(unit.parentId) : undefined;
    // A hiányzó szülő és a kör is megáll: rövidebb út jobb, mint végtelen
    // ciklus vagy eltűnt sor. Ugyanaz a védekezés, mint a webes fa-építőben.
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      names.unshift(current.name);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    paths.set(unit.id, names);
  }

  return paths;
}
