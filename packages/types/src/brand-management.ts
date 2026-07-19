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
  metadata?: Record<string, unknown>;
}

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
