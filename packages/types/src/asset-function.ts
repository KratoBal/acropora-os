/**
 * AZ ESZKOZ FUNKCIOJA -- TORZSADAT, FUGGETLEN A KATEGORIATOL.
 *
 * Balazs kerese, 2026-09-22 (Partner eszkoz XLS szal), szo szerint: „szeretnek
 * egy ugyanolyan menut a Beallitasok ala mint az Eszkoz kategoriak, csak
 * Eszkoz-funkciok nevvel [...] viszont az eszkozoknel ezt a funkciok reszt
 * ugyanugy legordulo menube meg kellene jeleniteni."
 *
 * A KATEGORIA AZT MONDJA MEG, MI AZ ESZKOZ; A FUNKCIO AZT, MIRE VALO. A KETTO
 * KOZOTT SZANDEKOSAN NINCS KAPCSOLAT -- lasd az `AssetCategory` fejleceit a
 * kategoria oldalan. A lista URESEN indul, Balazsek toltik fel.
 *
 * A SZERKEZET SZO SZERINT AZ `asset-category.ts`-E, mert Balazs ezt kerte:
 * „ugyanolyan menut [...] csak [mas] nevvel".
 */
export interface AssetFunction {
  id: string;
  /** A nev, ahogy a valasztoban all: pl. „Automata adagolás". */
  name: string;
  /**
   * A kivezetett funkcio NEM torlodik: eszkozok hivatkoznak ra. A
   * valasztobol esik ki, a meglevo eszkozok mellett olvashato marad.
   */
  isActive: boolean;
  /** A felkinalas sorrendje; a gyakoriak elore. */
  sortOrder: number;
}

export interface AssetFunctionListResponse {
  items: AssetFunction[];
}

/**
 * A NEV NORMALIZALASA -- EGY HELYEN, A SZERVEREN ES A FELULETEN.
 *
 * CSAK a korulvagas, ugyanaz az dontes, mint a kategorianal: a kis- es
 * nagybetu NEM normalizalodik, mert a lista rovid es ember tartja karban.
 */
export function normalizeAssetFunctionName(raw: string): string {
  return raw.trim();
}
