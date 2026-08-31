/**
 * A TULAJDONOS-VÁLASZTÓ SZŰRÉSE, KIEMELVE A KÉPERNYŐRŐL.
 *
 * Ez a szabály eddig az új eszköz képernyőjén állt, egy `useMemo` belsejében,
 * teszt nélkül. Nem azért került ide, mert rossz volt, hanem mert a képernyőn
 * álló szabályt csak a képernyő megjelenítésén át lehetne mérni, a mellette
 * futó listát pedig semmi nem védi attól, hogy valaki mellékesen elmozdítsa.
 *
 * A VISELKEDÉS SZÁNDÉKOSAN VÁLTOZATLAN, akkor is, ahol vitatható. Két ilyen
 * pont van, és mindkettőt kimondjuk, mert kimondatlanul nem lehet eldönteni
 * róluk, hogy szándék-e vagy maradék:
 *
 * 1. A név és a kód EGY szövegként, szóközzel összefűzve keresődik. Emiatt egy
 *    olyan keresés is talál, ami a kettő HATÁRÁN fekszik (`"Kft. A-1"`). Ez ma
 *    így viselkedik, tehát így is marad.
 * 2. A találatok száma felül van vágva. A szám itt NEVET kapott, hogy látható
 *    legyen; hogy miért pont ennyi, azt ma senki nem tudja. Ha kiderül, hogy
 *    rossz, egy szám átírása lesz - nem egy néma viselkedés-változás.
 */

/**
 * Ennyi találatnál többet a választó nem mutat.
 *
 * AZ INDOKA NINCS SEHOL LEÍRVA. A kiemeléskor az érték változatlanul jött át a
 * képernyőről; ez a konstans csak láthatóvá teszi, nem igazolja.
 */
export const OWNER_PICKER_LIMIT = 20;

export interface SearchableOwner {
  displayName: string;
  code: string;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("hu");
}

export function matchesOwnerSearch(
  owner: SearchableOwner,
  needle: string,
): boolean {
  const query = normalize(needle);
  if (!query) return true;
  return normalize(`${owner.displayName} ${owner.code}`).includes(query);
}

export function filterOwners<T extends SearchableOwner>(
  owners: readonly T[],
  needle: string,
): T[] {
  return owners
    .filter((owner) => matchesOwnerSearch(owner, needle))
    .slice(0, OWNER_PICKER_LIMIT);
}
