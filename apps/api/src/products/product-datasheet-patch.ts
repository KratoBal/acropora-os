import type { ElhelyezesiIgeny } from "@acropora/types";

/**
 * AZ ADATLAP AZ ADOTT MEZOKBOL (kartya 20b0dd47): a termek frissitesenek azon mezoi, amelyek a `ProductDatasheet` sorba
 * kerulnek (az elhelyezesi igeny es a nevek). Csak az ADOTT mezok kerulnek bele (a `undefined` kimarad, tehat a
 * tobbi oszlop valtozatlan), es ha egy sem adott, `null`: nincs adatlap-iras, a sor nem is jon letre.
 *
 * A NEV: a szokozok levagva, az ures szoveg `null`, vagyis a nev torlodik. Egy ures szoveg ugyanis nem "nincs nev",
 * hanem egy ures mezo, ami a keresoben ugyanugy nem talal semmit, de a "kitoltve" jelzest hamisan adna.
 */
export interface DatasheetPatchInput {
  fenyIgeny?: ElhelyezesiIgeny | null;
  aramlasIgeny?: ElhelyezesiIgeny | null;
  magyarNev?: string | null;
  angolNev?: string | null;
  nemetNev?: string | null;
}

export interface DatasheetPatch {
  fenyIgeny?: ElhelyezesiIgeny | null;
  aramlasIgeny?: ElhelyezesiIgeny | null;
  magyarNev?: string | null;
  angolNev?: string | null;
  nemetNev?: string | null;
}

const NAME_KEYS = ["magyarNev", "angolNev", "nemetNev"] as const;
const NEED_KEYS = ["fenyIgeny", "aramlasIgeny"] as const;

export function datasheetPatchOf(
  input: DatasheetPatchInput,
): DatasheetPatch | null {
  const patch: DatasheetPatch = {};
  for (const key of NEED_KEYS)
    if (input[key] !== undefined) patch[key] = input[key];
  for (const key of NAME_KEYS) {
    const value = input[key];
    if (value === undefined) continue;
    patch[key] = value === null || value.trim() === "" ? null : value.trim();
  }
  return Object.keys(patch).length > 0 ? patch : null;
}
