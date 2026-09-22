/**
 * A HELYSZÍNEK FÁJA, LAPOS LISTÁBÓL -- ÉS AZ ÁRVA SOR IS LÁTSZIK.
 *
 * A lista laposan jön (`parentId` mezővel), a fát a hívó építi. Ez a függvény
 * eddig KÉT komponensben állt, majdnem azonos alakban: az egyik a `depth`
 * értéket a behúzáshoz használja, a másik ugyanezt a választóhoz. Egy közös
 * példány azt zárja ki, hogy a kettő külön romoljon el.
 *
 * === AZ ÁRVA-TŰRÉS, ÉS MIÉRT NEM RÉSZLET ===
 *
 * 2026-09-22-től a helyszín-lista a kérő KIOSZTOTT helyszíneire szűkül. Egy
 * kiosztott helyszín SZÜLŐJE ettől kimaradhat a válaszból -- és a korábbi
 * alak a gyökértől indulva járta be a fát, tehát egy ilyen sor CSENDBEN
 * ELTŰNT volna: nem hibaüzenet, nem üres lista, hanem egy hiányzó sor.
 *
 * Ezért itt gyökér az, aminek NINCS szülője, VAGY aminek a szülője nincs a
 * kapott halmazban. Így a szűkített válasz minden eleme megjelenik -- a
 * hierarchia annyit mutat, amennyi belőle látszik.
 *
 * NEM VÉDEKEZÉS A KÖRÖK ELLEN: a fa a `WorksheetDepartment.parentId` mezőn
 * áll, és a kör kizárása az adatbázis dolga. Egy `latogatott` halmaz itt
 * elfedné, ha valaha mégis keletkezne, és akkor a felület nézne ki jól egy
 * romlott adaton.
 */
export interface HelyszinFaSor<T> {
  item: T;
  depth: number;
}

export function helyszinFa<T extends { id: string; parentId: string | null }>(
  items: readonly T[],
): HelyszinFaSor<T>[] {
  const azonositok = new Set(items.map((item) => item.id));
  const gyermekek = new Map<string | null, T[]>();

  for (const item of items) {
    /**
     * A SZÜLŐ HELYETT `null`, HA NINCS A HALMAZBAN. Így az árva sor a
     * gyökerek közé kerül, és a bejárás megtalálja.
     */
    const kulcs =
      item.parentId !== null && azonositok.has(item.parentId)
        ? item.parentId
        : null;
    const sorok = gyermekek.get(kulcs) ?? [];
    sorok.push(item);
    gyermekek.set(kulcs, sorok);
  }

  const eredmeny: HelyszinFaSor<T>[] = [];
  const bejar = (parentId: string | null, depth: number) => {
    for (const item of gyermekek.get(parentId) ?? []) {
      eredmeny.push({ item, depth });
      bejar(item.id, depth + 1);
    }
  };
  bejar(null, 0);
  return eredmeny;
}
