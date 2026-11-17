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
