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
  /**
   * ROVID, NAGYBETUS AZONOSITO A FANK JELMAGYARAZATABOL (pl. „AIP", „COM",
   * „VAL_SUR"). Balazs kerese, 2026-09-22 (kanban 68add892). NEM harom
   * karakterhez kotott, es alahuzast tartalmazhat -- ket meglevo kod is az
   * (VAL_SUR, VAL_BOT). `null`, amig a kategorianak nincs kodja kiosztva: a
   * hat meglevo kategoria migraciokor URESEN indul, Balazs tolti fel kulon.
   */
  code: string | null;
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

/**
 * A KOD NORMALIZALASA -- KORULVAGAS ES NAGYBETUSITES, UGYANAZ A MINTA, MINT AZ
 * ALEGYSEG-KODNAL (`worksheets.repository.ts`, `code.trim().toUpperCase()`).
 *
 * A BEMENET SZANDEKOSAN MEGENGEDOBB A TAROLT ALAKNAL: aki kisbetuvel gepeli be
 * a „com"-ot, ne halozati kort kapjon azert, amit egy `toUpperCase()` megold.
 * `null`/ures string -> `null`, mert a kod ELHAGYHATO.
 */
export function normalizeAssetCategoryCode(
  raw: string | null | undefined,
): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim().toUpperCase();
  return trimmed === "" ? null : trimmed;
}
