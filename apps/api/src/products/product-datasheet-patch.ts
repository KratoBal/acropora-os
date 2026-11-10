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

/**
 * A NEV-MEZOK MEGTAGADAS-ALLAPOTA (`DatasheetField`): azok a mezok, amelyeknek a megtagadasat egy NEM ures nev feloldja.
 * A megtagadas azt mondja, "megneztuk, es nem tudjuk leirni"; egy kitoltott nev ezt cafolja, tehat a megtagadas-sor
 * megszunik (barracuda kerdese a #2357-en: a "kitoltve ES megtagadva" ellentmondo par az audit hibaja, itt meg sem
 * keletkezhet). A torles (`null`) nem hoz letre es nem old fel megtagadast.
 */
export const NAME_REFUSAL_FIELDS = {
  magyarNev: "MAGYAR_NEV",
  angolNev: "ANGOL_NEV",
  nemetNev: "NEMET_NEV",
} as const;

export function filledNameFields(
  patch: DatasheetPatch | null,
): (typeof NAME_REFUSAL_FIELDS)[keyof typeof NAME_REFUSAL_FIELDS][] {
  if (!patch) return [];
  return NAME_KEYS.filter((key) => typeof patch[key] === "string").map(
    (key) => NAME_REFUSAL_FIELDS[key],
  );
}

/**
 * THE HUSBANDRY FACTS THE OTHER WRITE PATHS CAN CHANGE (V2.2, barracuda on #2374): the Hungarian name, the light need and
 * the flow need are required facts of the husbandry block (`missingHusbandryFields`), but they are written through the
 * names path and the general product update, not through `PATCH /products/:id/husbandry`. An edit of ANY husbandry fact
 * withdraws the block's verification, whichever path it comes through: the new content was verified by nobody. The English
 * and German names are not husbandry facts, so they do not withdraw it.
 */
export const HUSBANDRY_FACT_PATCH_KEYS = [
  "magyarNev",
  "fenyIgeny",
  "aramlasIgeny",
] as const;

export type HusbandryFactPatchKey = (typeof HUSBANDRY_FACT_PATCH_KEYS)[number];

/**
 * THE FACTS THIS PATCH ACTUALLY CHANGES: a key counts only when it is given AND differs from the stored value (a save that
 * writes back the same value moved nothing, and must not cost the block its verification). A row that does not exist yet
 * stores null for every key.
 */
export function changedHusbandryFacts(
  patch: DatasheetPatch | null,
  stored: Partial<Record<HusbandryFactPatchKey, unknown>> | null,
): HusbandryFactPatchKey[] {
  if (!patch) return [];
  return HUSBANDRY_FACT_PATCH_KEYS.filter((key) => {
    if (patch[key] === undefined) return false;
    return (stored?.[key] ?? null) !== patch[key];
  });
}
