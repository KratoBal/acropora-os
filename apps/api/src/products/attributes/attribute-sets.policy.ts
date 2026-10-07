/**
 * AZ ATTRIBUTUM-KESZLETEK FAJA (SEO P0 PR 2, C1): az alkeszlet orokli a szulo
 * attributumait (`pump` -> `return_pump`), es a fa kormentes.
 *
 * Tiszta fuggvenyek, adatbazis nelkul: a kesobbi admin-felulet irasa es a
 * mostani olvaso API is ezeket hivja.
 */
export interface SetRow {
  id: string;
  key: string;
  parentId: string | null;
}

export interface SetAttributeRow {
  attributeSetId: string;
  attributeKey: string;
  required: boolean;
  filterable: boolean | null;
  group: string | null;
  sortOrder: number;
}

/** Az elso kor a faban (a benne allo kulcsok), vagy `null`, ha nincs. */
export function keszletKor(sets: readonly SetRow[]): string[] | null {
  const by = new Map(sets.map((s) => [s.id, s]));
  for (const indulo of sets) {
    const ut: string[] = [];
    const latott = new Set<string>();
    let cur: SetRow | undefined = indulo;
    while (cur) {
      if (latott.has(cur.id)) {
        const elso = ut.indexOf(cur.key);
        return ut.slice(elso);
      }
      latott.add(cur.id);
      ut.push(cur.key);
      cur = cur.parentId ? by.get(cur.parentId) : undefined;
    }
  }
  return null;
}

/**
 * A KESZLET OSSZES ATTRIBUTUMA, OROKLESSEL: a gyokertol lefele, es ahol ugyanaz
 * a kulcs tobb szinten all, az alkeszlete nyer (felulirhatja a `required`-et, a
 * csoportot, a sorrendet). Korben allo keszletre dob: a kor nem hallgathato el.
 */
export function orokoltAttributumok(
  setId: string,
  sets: readonly SetRow[],
  links: readonly SetAttributeRow[],
): SetAttributeRow[] {
  const by = new Map(sets.map((s) => [s.id, s]));
  const lanc: SetRow[] = [];
  const latott = new Set<string>();
  let cur = by.get(setId);
  if (!cur) throw new Error(`unknown attribute set ${setId}`);
  while (cur) {
    if (latott.has(cur.id))
      throw new Error(`attribute set cycle at ${cur.key}`);
    latott.add(cur.id);
    lanc.unshift(cur);
    cur = cur.parentId ? by.get(cur.parentId) : undefined;
  }
  const eredmeny = new Map<string, SetAttributeRow>();
  for (const set of lanc)
    for (const link of links.filter((l) => l.attributeSetId === set.id))
      eredmeny.set(link.attributeKey, link);
  return Array.from(eredmeny.values()).sort(
    (a, b) =>
      a.sortOrder - b.sortOrder || a.attributeKey.localeCompare(b.attributeKey),
  );
}
