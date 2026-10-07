import {
  baseProductSlug,
  resolveSlug,
  slugify,
  slugifyUntruncated,
  SLUG_MAX,
} from "./slug.js";

/**
 * A SLUG-BACKFILL TERVE (SEO P0 PR 5). Tiszta függvény: írni a CLI ír, és csak
 * `--apply` mellett.
 *
 * D1: ütközésnél a RÉGEBBI termék kapja a sima slugot. A sorrend a termék-azonosító
 * (a cuid az időrendet követi), tehát egy új termék nem veszi el egy régi címét.
 * Idempotens: a már sluggal bíró terméket kihagyja, a slugja foglalt.
 */
export interface SlugBackfillProduct {
  id: string;
  name: string;
  primarySku: string | null;
  /** A meglévő WEBSHOP-slug, ha van. */
  slug: string | null;
}

export interface SlugBackfillPlan {
  assignments: { productId: string; slug: string }[];
  skuSuffix: { productId: string; slug: string }[];
  numbered: { productId: string; slug: string }[];
  truncated: number;
  emptyName: number;
  alreadySlugged: number;
}

export function planSlugBackfill(
  products: readonly SlugBackfillProduct[],
  historySlugs: readonly string[],
): SlugBackfillPlan {
  const rendezett = [...products].sort((a, b) => a.id.localeCompare(b.id));
  const foglalt = new Set<string>(historySlugs);
  for (const p of rendezett) if (p.slug) foglalt.add(p.slug);
  const plan: SlugBackfillPlan = {
    assignments: [],
    skuSuffix: [],
    numbered: [],
    truncated: 0,
    emptyName: 0,
    alreadySlugged: 0,
  };
  for (const p of rendezett) {
    if (p.slug) {
      plan.alreadySlugged += 1;
      continue;
    }
    const sku = p.primarySku ?? p.id;
    const teljes = slugifyUntruncated(p.name);
    if (!teljes) plan.emptyName += 1;
    if (teljes.length > SLUG_MAX) plan.truncated += 1;
    const base = baseProductSlug(p.name, sku);
    const slug = resolveSlug(base, sku, foglalt);
    foglalt.add(slug);
    plan.assignments.push({ productId: p.id, slug });
    if (slug !== base)
      (slug === `${base}-${slugify(sku)}`
        ? plan.skuSuffix
        : plan.numbered
      ).push({
        productId: p.id,
        slug,
      });
  }
  return plan;
}

export function describeSlugBackfill(plan: SlugBackfillPlan): string {
  return [
    `Uj webshop-slug: ${plan.assignments.length} termek (mar sluggal: ${plan.alreadySlugged})`,
    `Utkozes, SKU-utotaggal: ${plan.skuSuffix.length}; szammal is: ${plan.numbered.length}`,
    `80 karakternel vagott nev: ${plan.truncated}; ures nev (termek-<sku>): ${plan.emptyName}`,
    ...[...plan.skuSuffix, ...plan.numbered].map(
      (a) => `  ${a.productId}: ${a.slug}`,
    ),
    "",
  ].join("\n");
}
