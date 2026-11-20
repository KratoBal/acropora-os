import type { HandleContent } from "./medusa-brand-plan.js";

/**
 * A HANDLE-T FOGLALO GYUJTEMENY TARTALMA (kartya ec82b629, acrobot dontese 2026-11-19 16:24, 57247).
 *
 * Egy azonosito nelkuli, a marka handle-jen allo gyujtemenyt a terv csak akkor kot ossze, ha URES, vagy minden termeke ehhez
 * a markahoz tartozik. Ez a modul szamolja meg: a gyujtemeny bolti termekei -> a mi termekunk (a kotes-sor, ennek hianyaban az
 * egyertelmu SKU-par, ugyanaz a szabaly, mint a szallitasi jellemzoknel) -> a termek markaja.
 *
 * EGY JELOLT HIBAJA (halozat, csonkolt lista) NEM ALLITJA MEG A TOBBIT, es nem is ad itéletet: a jelolt kimarad a valaszbol, a
 * terv pedig "nem ellenorzott"-kent jelenti. Egy meg nem mert tartalom nem lehet osszekotes alapja.
 */
export interface HandleContentSources {
  /** A gyujtemeny bolti termekeinek azonositoi (lapozva); `truncated`: a lista nem teljes. */
  collectionProductIds(
    collectionId: string,
  ): Promise<{ ids: string[]; truncated: boolean }>;
  /** Bolti termek -> OS-termek, azokra, amelyek parosithatok (kotes-sor, kulonben egyertelmu SKU-par). */
  osProductsOfShop(shopProductIds: string[]): Promise<Map<string, string>>;
  /** OS-termek -> a markaja (`null`: nincs markaja). A nem letezo termek kimarad. */
  brandsOfOsProducts(
    osProductIds: string[],
  ): Promise<Map<string, string | null>>;
}

export type HandleContentReader = (
  candidates: readonly { collectionId: string; brandId: string }[],
) => Promise<Map<string, HandleContent>>;

export function handleContentReader(
  sources: HandleContentSources,
  /** egy jelolt hibaja: nem allit meg semmit, de a hivo naplozza (a hiba nem tunhet el nyomtalanul) */
  onError: (collectionId: string, error: unknown) => void = () => {},
): HandleContentReader {
  return async (candidates) => {
    const contents = new Map<string, HandleContent>();
    for (const candidate of candidates) {
      try {
        const list = await sources.collectionProductIds(candidate.collectionId);
        if (list.truncated) {
          onError(
            candidate.collectionId,
            new Error(
              "a gyűjtemény termék-listája csonkolt, a tartalom nem mérhető",
            ),
          );
          continue;
        }
        const osOf = await sources.osProductsOfShop(list.ids);
        const brandOf = await sources.brandsOfOsProducts([
          ...new Set(osOf.values()),
        ]);
        let sameBrand = 0;
        let otherBrand = 0;
        let unknown = 0;
        for (const shopId of list.ids) {
          const osId = osOf.get(shopId);
          if (!osId || !brandOf.has(osId)) unknown += 1;
          else if (brandOf.get(osId) === candidate.brandId) sameBrand += 1;
          else otherBrand += 1;
        }
        contents.set(candidate.collectionId, {
          total: list.ids.length,
          sameBrand,
          otherBrand,
          unknown,
        });
      } catch (error) {
        // nem mert tartalom: a jelolt "nem ellenorzott" marad (a terv jelenti), a tobbi jelolt megy tovabb
        onError(candidate.collectionId, error);
      }
    }
    return contents;
  };
}
