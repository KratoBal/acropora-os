/**
 * A TELJES HELYSZÍNI MÁSOLAT LEHÚZÁSA, LAPOZVA.
 *
 * A lista képernyő ötven sort kér, mert annyit lehet elolvasni. A helyszíni
 * másolatnak viszont MINDEN eszközt tartalmaznia kell: a szerelő azt a
 * matricát olvassa be, amelyik előtt áll, nem azt, amelyik az első oldalon
 * volt. Egy ötven elemnél elvágott másolat pont a hosszú listáknál mondaná azt
 * egy létező eszközre, hogy ismeretlen.
 *
 * A FÜGGŐSÉGEK BEFELÉ JÖNNEK, hogy ez a ciklus adatbázis és hálózat nélkül
 * mérhető legyen: a lapozás, a felső korlát és a hiba utáni megállás
 * mindegyike elrontható, és mindegyik csendben rontható el.
 *
 * A FELSŐ KORLÁT KIMONDOTT. Ha egy telepítésen egyszer több eszköz lesz, mint
 * amennyit ez a korlát enged, a hívó megkapja a `truncated` jelzést, és ki
 * tudja írni. Egy csendben levágott másolat ugyanúgy néz ki, mint a teljes.
 */

export interface OfflinePage<T> {
  items: T[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export interface OfflineSyncDeps<T> {
  fetchPage(page: number): Promise<OfflinePage<T>>;
  remember(items: T[]): Promise<void>;
  /** Hány oldalt húzunk le legfeljebb. Az alapérték ezer eszközt fed le. */
  maxPages?: number;
}

export interface OfflineSyncResult {
  pagesFetched: number;
  itemsSaved: number;
  /** Amit a szerver a teljes halmazról mondott az első oldalon. */
  totalItems: number;
  /** A felső korlát miatt maradt ki oldal. */
  truncated: boolean;
  /** A letöltés hiba miatt állt meg. Ami addig lement, az mentve van. */
  failed: boolean;
}

export const DEFAULT_MAX_PAGES = 20;

export async function syncAssetsForOffline<T>(
  deps: OfflineSyncDeps<T>,
): Promise<OfflineSyncResult> {
  const maxPages = deps.maxPages ?? DEFAULT_MAX_PAGES;
  const result: OfflineSyncResult = {
    pagesFetched: 0,
    itemsSaved: 0,
    totalItems: 0,
    truncated: false,
    failed: false,
  };

  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    if (page > maxPages) {
      result.truncated = true;
      break;
    }

    let response: OfflinePage<T>;
    try {
      response = await deps.fetchPage(page);
    } catch {
      // A FÉLIG LEHÚZOTT MÁSOLAT IS ÉR VALAMIT, és ami lement, az mentve van.
      // A hívó a `failed` jelzésből tudja, hogy nem teljes.
      result.failed = true;
      break;
    }

    await deps.remember(response.items);
    result.pagesFetched += 1;
    result.itemsSaved += response.items.length;
    result.totalItems = response.pagination.totalItems;
    totalPages = response.pagination.totalPages;

    // ÜRES OLDAL: a szerver többet ígért, mint amennyit ad. Továbbmenni
    // végtelen ciklus lenne, megállni és jelenteni viszont igaz.
    if (response.items.length === 0) break;
    page += 1;
  }

  return result;
}
