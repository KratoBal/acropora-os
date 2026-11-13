/**
 * A KÉP SZERVER-OLDALI IDEMPOTENCIA-KULCSA A SOR AZONOSÍTÓJÁBÓL (task os-uzemeltetesi-naplo, S2c).
 *
 * MIÉRT NEM MAGA A SOR-AZONOSÍTÓ: a kép sor-azonosítója a FÁJL ÚTJÁT is hordozza (`asset-photo:<rögzítés>:file:///data/.../x.jpg`),
 * a szerver `clientOperationId` mintája viszont `^[A-Za-z0-9_.:-]{8,128}$` (nincs `/`, legfeljebb 128 karakter), tehát a sor-azonosító
 * a szervernél 400-at adna, és a kép örökre elakadna.
 *
 * A KULCS A SOR-AZONOSÍTÓ TARTALMÁBÓL SZÁMÍTOTT, két 53 bites lenyomatból (cyrb53, két különböző maggal): ugyanaz a sor ugyanazt a
 * kulcsot adja minden újraküldésnél (ez az idempotencia), két külön sor ütközésének esélye elhanyagolható. Nem biztonsági
 * lenyomat: csak azonosító, a szerver úgyis a feltöltő és a bejegyzés szerint védi (más feltöltő vagy más bejegyzés kulcsára 409).
 */
function cyrb53(text: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function operationsPhotoClientKey(rowId: string): string {
  return `opsph-${cyrb53(rowId, 0).toString(16)}-${cyrb53(rowId, 1).toString(16)}`;
}
