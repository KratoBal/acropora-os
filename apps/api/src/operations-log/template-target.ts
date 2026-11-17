import type { OperationsTaskTarget } from "@acropora/types";

/**
 * A SABLON CÉLJA ÉS AZ ESZKÖZ: EGY HELYEN, EGY SZABÁLY (task t-20261117-sablon-eszkozlista, kártya 42bc1c67). Egy sablon egy eszközre szól, ha
 * az eszköz benne van a kézzel választott listában, VAGY a sablon kategória-célú, és az eszköz ilyen kategóriájú. A rögzítés ellenőrzése
 * (`targetMatches`) és az ütemezett sablonok a kimutatásban ezt használják, a két lista-lekérdezés (`activeTemplatesForAsset`, a
 * katalógus) ugyanezt a feltételt adatbázis-oldalon fejezi ki: ha ez a függvény változik, azok is.
 */
export interface TemplateTargetShape {
  /** A kézzel választott eszközlista azonosítói; üres, ha a cél kategória. */
  assetIds: readonly string[];
  /** A kategória-cél azonosítója; `null`, ha a cél eszközlista. */
  categoryId: string | null;
}

export function templateAppliesTo(
  target: TemplateTargetShape,
  asset: { id: string; categoryId: string | null },
): boolean {
  if (target.assetIds.includes(asset.id)) return true;
  return target.categoryId !== null && target.categoryId === asset.categoryId;
}

/** A DTO célja a fenti alakra. */
export function targetShapeOf(
  target: OperationsTaskTarget,
): TemplateTargetShape {
  return target.kind === "ASSETS"
    ? {
        assetIds: target.assets.map((asset) => asset.assetId),
        categoryId: null,
      }
    : { assetIds: [], categoryId: target.categoryId };
}

/**
 * A SABLON SORÁNAK CÉLJA A DTO-HOZ, ÉS HA A SOR SZABÁLYSÉRTŐ, ARRÓL JELZÉS (barracuda, #2655 review). A szolgáltatás nem enged olyan sort,
 * amelyben kategória ÉS eszközlista is van (kategória XOR nem üres lista), egy közvetlen írás (import, kézi SQL) viszont igen. Ilyenkor a
 * `templateAppliesTo` MINDKETTŐT alkalmazná, a DTO viszont csak az egyiket mutatná: a felület mást mondana, mint amit a rögzítés enged. A
 * DTO változatlanul a kategóriát adja (mint eddig), de a `both` jelzi a sort, hogy a hívó naplózhassa. Az üres lista kategória nélkül
 * (`ASSETS` üres listával) szintén szabálysértő, de azt a `templateAppliesTo` kezeli (semmire nem szól), tehát nem jelzünk külön.
 */
export function targetOfRow(row: {
  assetCategory: { id: string; name: string } | null;
  assets: readonly {
    asset: { id: string; assetNumber: string; name: string };
  }[];
}): { target: OperationsTaskTarget; both: boolean } {
  if (row.assetCategory)
    return {
      target: {
        kind: "CATEGORY",
        categoryId: row.assetCategory.id,
        name: row.assetCategory.name,
      },
      both: row.assets.length > 0,
    };
  return {
    target: {
      kind: "ASSETS",
      assets: row.assets
        .map(({ asset }) => ({
          assetId: asset.id,
          assetNumber: asset.assetNumber,
          name: asset.name,
        }))
        .sort((a, b) => a.assetNumber.localeCompare(b.assetNumber, "hu")),
    },
    both: false,
  };
}
