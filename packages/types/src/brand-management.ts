export type BrandStatusFilter = "ACTIVE" | "ARCHIVED" | "ALL";

export interface BrandAlias {
  id: string;
  alias: string;
  normalizedAlias: string;
  source: string;
  sourceExternalId?: string;
  isPreferred: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BrandExternalMapping {
  id: string;
  system: string;
  externalId: string;
  externalKey?: string;
}

export interface BrandUsage {
  productCount: number;
  reviewReferenceCount: number;
}

export interface BrandSummary {
  id: string;
  name: string;
  normalizedName: string;
  slug: string;
  isActive: boolean;
  archivedAt?: string;
  aliases: BrandAlias[];
  externalMappings: BrandExternalMapping[];
  usage: BrandUsage;
  createdAt: string;
  updatedAt: string;
}

export interface BrandDetail extends BrandSummary {
  description?: string;
  websiteUrl?: string;
  logoUrl?: string;
  /** SEO P0 PR 11: the brand page's title, description and intro. */
  seoTitle?: string;
  metaDescription?: string;
  intro?: string;
  /** The Merchant feed's brand name, when it differs from `name`. */
  merchantBrandName?: string;
  metadata?: Record<string, unknown>;
}

/**
 * A MÁRKÁK LISTÁJÁNAK RENDEZHETŐ OSZLOPAI (Balázs kérése, kártya 2f6369a4). A lista lapozott, ezért a rendezés a szerveren történik.
 * Három oszlop rendezhető: a név, a termékek száma (a kapcsolat saját darabszáma, ugyanaz, amit a lap kiír) és a frissítés ideje.
 * Nem rendezhető: a "Státusz" (kétállapotú jelző, szűrője van), az "Aliasok" (több érték) és az "UNAS" (a külső hozzárendelésből
 * következő felirat). Az alap sorrend a név.
 */
export const BRAND_LIST_SORT_FIELDS = [
  "name",
  "productCount",
  "updatedAt",
] as const;
export type BrandListSortField = (typeof BRAND_LIST_SORT_FIELDS)[number];

export interface BrandListResponse {
  items: BrandSummary[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export interface CreateBrandInput {
  name: string;
  description?: string;
  websiteUrl?: string;
  logoUrl?: string;
  aliases?: Array<{
    alias: string;
    source?: string;
    sourceExternalId?: string;
    isPreferred?: boolean;
  }>;
  unasExternalId?: string;
}

export interface UpdateBrandInput {
  name?: string;
  description?: string | null;
  websiteUrl?: string | null;
  logoUrl?: string | null;
  seoTitle?: string | null;
  metaDescription?: string | null;
  intro?: string | null;
  merchantBrandName?: string | null;
  expectedUpdatedAt: string;
}

export interface BrandAliasInput {
  alias: string;
  source?: string;
  sourceExternalId?: string;
  isPreferred?: boolean;
  expectedUpdatedAt?: string;
}

export interface BrandMutationResponse {
  brand: BrandDetail;
  message: string;
}
