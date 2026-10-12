/**
 * THE SEO LANDING PAGE (SEO P1-14, plan C10), served at
 * `/hu/valogatas/{slug}` (Balázs, 2026-10-12).
 *
 * The filter is the OS's own terms: store category ids and brand ids. The
 * Medusa projection translates the categories to the shop's ids.
 */
export interface SeoLandingAttributeFilter {
  key: string;
  op: string;
  value?: unknown;
}

export interface SeoLandingFilter {
  storeCategoryIds: string[];
  brandIds: string[];
  /**
   * NOT YET: must be empty until the storefront can apply an attribute filter
   * (barracuda, #541; acrobot 28994). A page that ignored one would list more
   * than its name promises, silently. The commerce validator refuses it too.
   */
  attributeFilters: SeoLandingAttributeFilter[];
}

export interface SeoLandingPageInput {
  slug: string;
  title: string;
  seoTitle: string | null;
  metaDescription: string | null;
  intro: string | null;
  filter: SeoLandingFilter;
  isPublished: boolean;
}

export interface SeoLandingPage extends SeoLandingPageInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * WHAT THE EDITOR OFFERS (`GET /seo/landing-pages/options`): every store
 * category with its path, every brand. `isActive` / `shown` say whether the
 * shop will list products under it: an inactive category or a brand the shop
 * does not show (inactive or archived, the brand projection's `brandIsShown`)
 * gives an empty page, and the editor warns about it.
 */
export interface SeoLandingOptions {
  categories: { id: string; path: string; isActive: boolean }[];
  brands: { id: string; name: string; shown: boolean }[];
}

/** The commerce limits, so a page the OS accepts the shop accepts too. */
export const SEO_LANDING_LIMITS = {
  title: 200,
  seoTitle: 120,
  metaDescription: 320,
  intro: 5000,
  ids: 200,
} as const;

export type SeoLandingParse =
  { ok: true; value: SeoLandingPageInput } | { ok: false; message: string };

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const idList = (value: unknown): string[] | null =>
  Array.isArray(value) &&
  value.length <= SEO_LANDING_LIMITS.ids &&
  value.every((id) => typeof id === "string" && id.trim())
    ? [...new Set(value.map((id: string) => id.trim()))]
    : null;

/**
 * THE INPUT, CHECKED: shape and limits only. Whether the categories, the
 * brands and the slug exist or are free is the API's question (it has the
 * database). The slug's shape is the API's too (the slug module owns it).
 */
export function parseSeoLandingInput(body: unknown): SeoLandingParse {
  if (typeof body !== "object" || body === null)
    return { ok: false, message: "a landing page is an object" };
  const b = body as Record<string, unknown>;
  const title = text(b.title);
  if (!title || title.length > SEO_LANDING_LIMITS.title)
    return {
      ok: false,
      message: `title: 1-${SEO_LANDING_LIMITS.title} characters`,
    };
  if (typeof b.slug !== "string")
    return { ok: false, message: "slug: required" };
  const optional = (
    key: "seoTitle" | "metaDescription" | "intro",
  ): string | null | false => {
    if (b[key] === null || b[key] === undefined || b[key] === "") return null;
    const value = text(b[key]);
    return value && value.length <= SEO_LANDING_LIMITS[key] ? value : false;
  };
  const seoTitle = optional("seoTitle");
  const metaDescription = optional("metaDescription");
  const intro = optional("intro");
  if (seoTitle === false || metaDescription === false || intro === false)
    return {
      ok: false,
      message: `seoTitle at most ${SEO_LANDING_LIMITS.seoTitle}, metaDescription at most ${SEO_LANDING_LIMITS.metaDescription}, intro at most ${SEO_LANDING_LIMITS.intro} characters`,
    };
  const f = (b.filter ?? {}) as Record<string, unknown>;
  const storeCategoryIds = idList(f.storeCategoryIds ?? []);
  const brandIds = idList(f.brandIds ?? []);
  if (!storeCategoryIds || !brandIds)
    return {
      ok: false,
      message: `filter: storeCategoryIds and brandIds are id lists, at most ${SEO_LANDING_LIMITS.ids}`,
    };
  if (Array.isArray(f.attributeFilters) && f.attributeFilters.length > 0)
    return {
      ok: false,
      message:
        "filter.attributeFilters: not yet, the storefront cannot apply an attribute filter",
    };
  // an empty filter is the whole catalogue: a duplicate of the shop's list
  if (!storeCategoryIds.length && !brandIds.length)
    return {
      ok: false,
      message: "filter: at least one category or brand",
    };
  if (typeof b.isPublished !== "boolean")
    return { ok: false, message: "isPublished: true or false" };
  return {
    ok: true,
    value: {
      slug: b.slug,
      title,
      seoTitle,
      metaDescription,
      intro,
      filter: { storeCategoryIds, brandIds, attributeFilters: [] },
      isPublished: b.isPublished,
    },
  };
}
