/**
 * ESZKÖZ KERESÉSE A MENTETT MÁSOLATBAN.
 *
 * Térerővel a SZERVER keres, és ez a modul nem is fut: a lapozott halmazt a
 * telefonon szűrni annyi lenne, hogy ötven sorból hármat mutatunk, miközben a
 * darabszám a többit is számolja.
 *
 * Térerő NÉLKÜL viszont a másolat TELJES (a lista minden oldala lementődik),
 * tehát a helyi szűrés nem részhalmazon dolgozik, hanem az egészen -- itt tehát
 * ugyanaz a válasz jön ki, mint a szervertől. Ez az egyetlen eset, amiben a
 * kliens oldali keresés nem hazudik.
 *
 * UGYANAZ A HAT MEZŐ, mint a szerveren (eszközszám, név, gyártó, modell,
 * sorozatszám, leltári szám), mert a szerelő nem tudja, melyik mezőben áll az,
 * amit a matricáról leolvas -- és nem is kellene tudnia. Ha a két lista eltérne,
 * ugyanaz a keresés más eredményt adna térerővel és anélkül, és a különbséget
 * senki nem tudná mire vélni.
 */

export interface SearchableAsset {
  assetNumber: string;
  name: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  inventoryNumber?: string;
  owner?: { displayName: string };
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("hu");
}

export function matchesAssetSearch(
  asset: SearchableAsset,
  needle: string,
): boolean {
  const query = normalize(needle);
  if (!query) return true;
  return [
    asset.assetNumber,
    asset.name,
    asset.manufacturer,
    asset.model,
    asset.serialNumber,
    asset.inventoryNumber,
    asset.owner?.displayName,
  ]
    .filter((field): field is string => Boolean(field))
    .some((field) => normalize(field).includes(query));
}

export function filterAssets<T extends SearchableAsset>(
  assets: readonly T[],
  needle: string,
): T[] {
  const query = normalize(needle);
  if (!query) return [...assets];
  return assets.filter((asset) => matchesAssetSearch(asset, query));
}
