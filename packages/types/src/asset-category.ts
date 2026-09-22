/**
 * AZ ESZKOZ KATEGORIAJA -- TORZSADAT, NEM SZABAD SZOVEG.
 *
 * Balazs kerese, 2026-09-22. Az indok mert: 110 eszkozon TIZ kulonbozo ertek
 * allt, de csak HAT valodi -- a masik negy elgepeles. A „Vízkezelés" szuro
 * ezert KET eszkozt hagyott ki, es senki nem vette eszre, mert a lista
 * helyesnek latszott.
 *
 * A SZERKEZET A MERTEKEGYSEGE (`unit-of-measure.ts`), a TABLA nem: ott egy
 * `kind` diszkriminator all, itt nincs mire.
 */
export interface AssetCategory {
  id: string;
  /** A nev, ahogy a valasztoban all: „Vízkezelés". */
  name: string;
  /**
   * A kivezetett kategoria NEM torlodik: eszkozok hivatkoznak ra. A
   * valasztobol esik ki, a meglevo eszkozok mellett olvashato marad.
   */
  isActive: boolean;
  /** A felkinalas sorrendje; a gyakoriak elore. */
  sortOrder: number;
}

export interface AssetCategoryListResponse {
  items: AssetCategory[];
}

/**
 * A NEV NORMALIZALASA -- EGY HELYEN, A SZERVEREN ES A FELULETEN.
 *
 * CSAK a korulvagas. A kis- es nagybetu NEM normalizalodik, es ez dontes: a
 * „Vízkezelés" es a „vízkezelés" ket KULONBOZO nev lenne egy kis-nagybetut
 * osszemoso egyediseg nelkul -- de a lista rovid es ember tartja karban, tehat
 * a szigoritas tobbet venne el (egy jogos „pH-mérés" alaku nevet), mint
 * amennyit ment.
 */
export function normalizeAssetCategoryName(raw: string): string {
  return raw.trim();
}
