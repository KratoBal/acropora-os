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

/**
 * A KÖZÖS FELSŐ HELYSZÍN (Balázs, 2026-10-02 07:36 UTC; kártya 1806e061): a
 * megnevezett egységek legalsó közös őse, akár maga is a megnevezettek egyike.
 * A Capasuli három medencéje és maga a Capasuli: a Capasuli. Ha nincs közös
 * ős (külön gyökér alatt állnak, vagy egy egység nem ismert), `null`: azok
 * tényleg független helyszínek.
 *
 * Egy hiányzó szülő vagy egy kör az utat ott elvágja, ahogy a `buildUnitPaths`
 * is; egy csonka út rövidebb közös részt ad, soha nem hamisat.
 */
export function sharedAncestor(
  ids: readonly string[],
  units: readonly UnitRow[],
): string | null {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const chainOf = (id: string): string[] | null => {
    if (!byId.has(id)) return null;
    const chain: string[] = [];
    const seen = new Set<string>();
    let current = byId.get(id);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      chain.unshift(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return chain;
  };
  const distinct = [...new Set(ids)];
  if (distinct.length === 0) return null;
  const chains = distinct.map(chainOf);
  if (chains.some((chain) => chain === null)) return null;
  let shared: string | null = null;
  for (let depth = 0; ; depth++) {
    const step = chains[0]![depth];
    if (step === undefined || chains.some((chain) => chain![depth] !== step))
      return shared;
    shared = step;
  }
}
