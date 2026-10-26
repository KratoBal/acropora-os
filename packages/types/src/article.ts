/**
 * THE ARTICLE BODY of a content item on the ARTICLE channel (acrobot's
 * decision, 2026-10-26, msg 36158, variant A): the approval path, the comments
 * and the "waiting on" lists stay with the `ContentItem`; this is only what an
 * article needs on top: excerpt, body, cover, channels, SEO, linked products
 * and taxa.
 *
 * The body is rich text in the shared sanitizer's `full` profile; the API
 * sanitizes it on save (this package does not depend on the sanitizer). A
 * strict parse here, like the home page's: an unknown field, a bad slug, a
 * non-https image or a duplicate link is refused before the store.
 */

/** Where an article shows. The storefront side draws it later. */
export const ARTICLE_CHANNELS = ["WEBSHOP_BLOG", "REEFCLUB"] as const;
export type ArticleChannel = (typeof ARTICLE_CHANNELS)[number];

export const ARTICLE_LIMITS = {
  slug: 120,
  excerpt: 300,
  bodyHtml: 100_000,
  imageUrl: 1000,
  imageAlt: 300,
  byline: 100,
  seoTitle: 70,
  metaDescription: 160,
  products: 20,
  taxa: 30,
} as const;

/** Lower-case letters and digits in hyphen-separated groups: the URL part. */
export const ARTICLE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A taxon key of the knowledge base vocabulary (`KnowledgeVocabularyEntry.key`). */
export const ARTICLE_TAXON_KEY = /^[A-Z0-9_]{1,64}$/;

export interface ArticleBodyInput {
  slug: string;
  excerpt: string;
  bodyHtml: string;
  coverImageUrl: string | null;
  coverImageAlt: string | null;
  channels: ArticleChannel[];
  byline: string | null;
  seoTitle: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
  noindex: boolean;
  /** The linked products, in order (the first shows first). */
  productIds: string[];
  taxonKeys: string[];
}

/** One approved, unchangeable snapshot, as the editor lists it. */
export interface ArticleRevisionSummary {
  id: string;
  approvedAt: string;
  approvedById: string;
  contentHash: string;
}

export interface ArticleDetail extends Omit<ArticleBodyInput, "productIds"> {
  contentId: string;
  products: { productId: string; name: string; sortOrder: number }[];
  /** The revision the last approval fixed; `null` while not approved. */
  approvedRevision: ArticleRevisionSummary | null;
  /** The revision the public sees; `null` while not published. */
  publishedRevision: ArticleRevisionSummary | null;
  publishedAt: string | null;
  revisions: ArticleRevisionSummary[];
  updatedAt: string;
}

export type ArticleBodyParse =
  { ok: true; value: ArticleBodyInput } | { ok: false; message: string };

const FIELDS = [
  "slug",
  "excerpt",
  "bodyHtml",
  "coverImageUrl",
  "coverImageAlt",
  "channels",
  "byline",
  "seoTitle",
  "metaDescription",
  "ogImageUrl",
  "noindex",
  "productIds",
  "taxonKeys",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An https address, or `null` for none; `false` when it is anything else. */
function optionalHttps(value: unknown): string | null | false {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > ARTICLE_LIMITS.imageUrl)
    return false;
  try {
    return new URL(value.trim()).protocol === "https:" ? value.trim() : false;
  } catch {
    return false;
  }
}

function optionalText(value: unknown, max: number): string | null | false {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > max) return false;
  return value.trim() ? value : null;
}

function uniqueStrings(
  value: unknown,
  max: number,
  shape: RegExp,
): string[] | false {
  if (!Array.isArray(value) || value.length > max) return false;
  if (value.some((v) => typeof v !== "string" || !shape.test(v))) return false;
  return new Set(value).size === value.length ? (value as string[]) : false;
}

export function parseArticleBodyInput(body: unknown): ArticleBodyParse {
  if (!isRecord(body))
    return { ok: false, message: "the article is an object" };
  const stray = Object.keys(body).find((key) => !FIELDS.includes(key));
  if (stray) return { ok: false, message: `unknown field ${stray}` };
  const { slug, excerpt, bodyHtml, channels, noindex } = body;
  if (
    typeof slug !== "string" ||
    slug.length > ARTICLE_LIMITS.slug ||
    !ARTICLE_SLUG.test(slug)
  )
    return {
      ok: false,
      message: "slug: lower-case letters and digits, separated by hyphens",
    };
  if (typeof excerpt !== "string" || excerpt.length > ARTICLE_LIMITS.excerpt)
    return {
      ok: false,
      message: `excerpt: a string, at most ${ARTICLE_LIMITS.excerpt} characters`,
    };
  if (typeof bodyHtml !== "string" || bodyHtml.length > ARTICLE_LIMITS.bodyHtml)
    return {
      ok: false,
      message: `bodyHtml: a string, at most ${ARTICLE_LIMITS.bodyHtml} characters`,
    };
  if (
    !Array.isArray(channels) ||
    channels.length === 0 ||
    channels.some(
      (c) =>
        typeof c !== "string" ||
        !(ARTICLE_CHANNELS as readonly string[]).includes(c),
    ) ||
    new Set(channels).size !== channels.length
  )
    return {
      ok: false,
      message: `channels: at least one of ${ARTICLE_CHANNELS.join(", ")}, each once`,
    };
  if (typeof noindex !== "boolean")
    return { ok: false, message: "noindex: true or false" };
  const coverImageUrl = optionalHttps(body.coverImageUrl);
  const ogImageUrl = optionalHttps(body.ogImageUrl);
  if (coverImageUrl === false || ogImageUrl === false)
    return { ok: false, message: "an image is an https address or empty" };
  const coverImageAlt = optionalText(
    body.coverImageAlt,
    ARTICLE_LIMITS.imageAlt,
  );
  const byline = optionalText(body.byline, ARTICLE_LIMITS.byline);
  const seoTitle = optionalText(body.seoTitle, ARTICLE_LIMITS.seoTitle);
  const metaDescription = optionalText(
    body.metaDescription,
    ARTICLE_LIMITS.metaDescription,
  );
  if (
    coverImageAlt === false ||
    byline === false ||
    seoTitle === false ||
    metaDescription === false
  )
    return {
      ok: false,
      message:
        "coverImageAlt, byline, seoTitle, metaDescription: a string within its limit, or empty",
    };
  const productIds = uniqueStrings(
    body.productIds,
    ARTICLE_LIMITS.products,
    /^[a-z0-9]{1,64}$/,
  );
  if (productIds === false)
    return {
      ok: false,
      message: `productIds: at most ${ARTICLE_LIMITS.products} different product ids`,
    };
  const taxonKeys = uniqueStrings(
    body.taxonKeys,
    ARTICLE_LIMITS.taxa,
    ARTICLE_TAXON_KEY,
  );
  if (taxonKeys === false)
    return {
      ok: false,
      message: `taxonKeys: at most ${ARTICLE_LIMITS.taxa} different taxon keys`,
    };
  return {
    ok: true,
    value: {
      slug,
      excerpt,
      bodyHtml,
      coverImageUrl,
      coverImageAlt,
      channels: channels as ArticleChannel[],
      byline,
      seoTitle,
      metaDescription,
      ogImageUrl,
      noindex,
      productIds,
      taxonKeys,
    },
  };
}
