/**
 * A BOLTI TERMÉKEK PÁROSÍTÁSA AZ OS TERMÉKEKKEL SKU ALAPJÁN.
 *
 * A teszt bolt termékei a UNAS-ból kerültek a Medusába, nem az OS vetítéséből,
 * ezért egyiknek sincs `ExternalReference` kötése, és az `external_id`-juk egy
 * korábbi OS-állapoté (a teszt OS 2026-09-25-én új azonosítókkal töltődött újra;
 * mérve 2026-10-07: 1/1492 egyezik). Az SKU viszont él: a bolti változat SKU-ja
 * az OS változat-SKU-jával vagy a UNAS cikkszámmal azonos.
 *
 * EGY SZABÁLY, KÉT HASZNÁLÓ: a szállítási jellemzők átvitele (kártya 2a7f2313)
 * kötés nélkül párosít vele, az összekötő parancs (`medusa-sku-link.cli.ts`) ebből
 * írja ki a kötést. Csak az EGYÉRTELMŰ pár számít: a bolti termék minden SKU-ja
 * ugyanarra az egy OS termékre mutat, és arra az OS termékre csak ez az egy bolti
 * termék mutat.
 */

export interface ShopSkuProduct {
  id: string;
  external_id?: string | null;
  variants?: { sku: string | null }[] | null;
}

export type SkuPairDecision =
  | {
      kind: "pair";
      shopProductId: string;
      osProductId: string;
      externalId: string | null;
    }
  /** A bolti termék SKU-i több OS termékre mutatnak. */
  | { kind: "ambiguous-sku"; shopProductId: string; osProductIds: string[] }
  /** Egyik SKU-ja sem ismert az OS-ben (vagy nincs SKU-ja). */
  | { kind: "no-match"; shopProductId: string; skus: string[] }
  /** Az OS termékre több bolti termék is mutat: egyiket sem választjuk. */
  | {
      kind: "shared-os-product";
      shopProductId: string;
      osProductId: string;
    };

export const normalizeSku = (sku: unknown) =>
  String(sku ?? "")
    .trim()
    .toLowerCase();

/** SKU -> OS termékek, az OS változatokból és a UNAS cikkszámból. */
export function osSkuIndex(
  variants: readonly { sku: string; productId: string }[],
  snapshots: readonly { productId: string; rawPayload: unknown }[],
): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  const add = (sku: unknown, productId: string) => {
    const key = normalizeSku(sku);
    if (!key) return;
    const found = index.get(key);
    if (found) found.add(productId);
    else index.set(key, new Set([productId]));
  };
  for (const variant of variants) add(variant.sku, variant.productId);
  for (const snapshot of snapshots)
    add(
      (snapshot.rawPayload as { Sku?: unknown } | null)?.Sku,
      snapshot.productId,
    );
  return index;
}

/** Egy döntés bolti termékenként, a bolt sorrendjében. Tiszta függvény. */
export function pairShopProducts(
  index: ReadonlyMap<string, ReadonlySet<string>>,
  shopProducts: readonly ShopSkuProduct[],
): SkuPairDecision[] {
  const firstPass = shopProducts.map((product) => {
    const skus = (product.variants ?? []).map((variant) => variant.sku ?? "");
    const targets = new Set(
      skus.flatMap((sku) => [...(index.get(normalizeSku(sku)) ?? [])]),
    );
    return { product, skus, targets: [...targets] };
  });

  const shopsPerOs = new Map<string, number>();
  for (const { targets } of firstPass)
    if (targets.length === 1)
      shopsPerOs.set(targets[0]!, (shopsPerOs.get(targets[0]!) ?? 0) + 1);

  return firstPass.map(({ product, skus, targets }): SkuPairDecision => {
    if (targets.length === 0)
      return { kind: "no-match", shopProductId: product.id, skus };
    if (targets.length > 1)
      return {
        kind: "ambiguous-sku",
        shopProductId: product.id,
        osProductIds: targets.sort(),
      };
    const osProductId = targets[0]!;
    if ((shopsPerOs.get(osProductId) ?? 0) > 1)
      return {
        kind: "shared-os-product",
        shopProductId: product.id,
        osProductId,
      };
    return {
      kind: "pair",
      shopProductId: product.id,
      osProductId,
      externalId: product.external_id ?? null,
    };
  });
}

/** A bolt összes terméke a változatai SKU-jával, végiglapozva. */
export async function listAllShopSkus(
  lister: {
    listProductSkus(
      offset: number,
      limit: number,
    ): Promise<{ products: ShopSkuProduct[]; count: number }>;
  },
  pageSize = 200,
): Promise<ShopSkuProduct[]> {
  const all: ShopSkuProduct[] = [];
  for (let offset = 0; ;) {
    const page = await lister.listProductSkus(offset, pageSize);
    all.push(...page.products);
    offset += page.products.length;
    if (page.products.length === 0 || offset >= page.count) return all;
  }
}
