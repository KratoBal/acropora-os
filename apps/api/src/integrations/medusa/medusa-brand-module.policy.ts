/**
 * THE BRAND AS THE COMMERCE BRAND MODULE STORES IT (SEO P0 PR 11, C7).
 *
 * The OS `Brand` is the owner; the commerce `brand` module is a read model
 * that only keeps what it is sent. The field names are the commerce module's
 * own (`apps/backend/src/api/admin/brands/validators.ts` in
 * acropora-commerce), not Medusa's: there is no Medusa brand entity.
 *
 * The collection projection (`medusa-brand.policy.ts`) stays as it is for
 * now: the storefront brand page still lists its products by collection, so
 * both are written until the listing moves to the link. Dropping the link is
 * the rollback; the collection is untouched by it.
 */
export type MedusaBrandRecord = {
  name: string;
  handle: string;
  description: string | null;
  intro: string | null;
  seo_title: string | null;
  meta_description: string | null;
  logo_url: string | null;
  website_url: string | null;
};

export type OsBrandForShop = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  intro: string | null;
  seoTitle: string | null;
  metaDescription: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
  isActive: boolean;
  archivedAt: Date | null;
};

/** The columns the projection reads, in one place for the query and the test. */
export const OS_BRAND_FOR_SHOP_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  intro: true,
  seoTitle: true,
  metaDescription: true,
  logoUrl: true,
  websiteUrl: true,
  isActive: true,
  archivedAt: true,
} as const;

/**
 * A brand that is switched off or archived does not get a shop page, so its
 * products go out without a brand link rather than pointing at a page that
 * should not exist. The collection side has its own rule and is not touched.
 */
export function brandIsShown(brand: OsBrandForShop | null): boolean {
  return Boolean(brand && brand.isActive && !brand.archivedAt);
}

/** Blank strings travel as `null`: the storefront falls back on `null` only. */
function orNull(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function brandRecord(brand: OsBrandForShop): MedusaBrandRecord {
  return {
    name: brand.name,
    handle: brand.slug,
    description: orNull(brand.description),
    intro: orNull(brand.intro),
    seo_title: orNull(brand.seoTitle),
    meta_description: orNull(brand.metaDescription),
    logo_url: orNull(brand.logoUrl),
    website_url: orNull(brand.websiteUrl),
  };
}

const RECORD_KEYS: readonly (keyof MedusaBrandRecord)[] = [
  "name",
  "handle",
  "description",
  "intro",
  "seo_title",
  "meta_description",
  "logo_url",
  "website_url",
];

/** A field the shop does not send back counts as a difference, not a match. */
export function brandRecordDiffers(
  current: Partial<MedusaBrandRecord> | null,
  wanted: MedusaBrandRecord,
): boolean {
  if (!current) return true;
  return RECORD_KEYS.some((key) => (current[key] ?? null) !== wanted[key]);
}
