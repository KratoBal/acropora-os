import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  parseSeoLandingInput,
  type SeoLandingFilter,
  type SeoLandingPage,
  type SeoLandingPageInput,
} from "@acropora/types";

import { webshopLandingPath } from "../products/redirect/redirect-path.js";
import {
  RedirectError,
  writeRedirect,
  type RedirectStore,
} from "../products/redirect/redirect-writer.js";
import { SLUG_ALAK, SLUG_MAX } from "../products/slug/slug.js";

export const SEO_LANDING_STORE = Symbol("SEO_LANDING_STORE");

export interface SeoLandingRow {
  id: string;
  slug: string;
  title: string;
  seoTitle: string | null;
  metaDescription: string | null;
  intro: string | null;
  filterDefinition: unknown;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SeoLandingStore {
  list(): Promise<SeoLandingRow[]>;
  find(id: string): Promise<SeoLandingRow | null>;
  /** Who holds the slug: a live landing page, or one that used it before. */
  slugOwner(
    slug: string,
  ): Promise<{ landingId: string; kind: "live" | "history" } | null>;
  missingCategories(ids: readonly string[]): Promise<string[]>;
  missingBrands(ids: readonly string[]): Promise<string[]>;
  create(input: SeoLandingPageInput): Promise<SeoLandingRow>;
  /** One transaction: the row, the slug history and the redirect. */
  update(
    id: string,
    input: SeoLandingPageInput,
    slugChange: { oldSlug: string; userId: string } | null,
    redirects: (store: RedirectStore) => Promise<void>,
  ): Promise<SeoLandingRow>;
}

export class SeoLandingSlugTakenError extends Error {}

/** The stored filter, read defensively: a hand-edited row cannot break a read. */
export function filterOf(value: unknown): SeoLandingFilter {
  const v = (value ?? {}) as Record<string, unknown>;
  const ids = (x: unknown) =>
    Array.isArray(x) ? x.filter((i): i is string => typeof i === "string") : [];
  return {
    storeCategoryIds: ids(v.storeCategoryIds),
    brandIds: ids(v.brandIds),
    attributeFilters: Array.isArray(v.attributeFilters)
      ? (v.attributeFilters as SeoLandingFilter["attributeFilters"])
      : [],
  };
}

export function toSeoLandingPage(row: SeoLandingRow): SeoLandingPage {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    seoTitle: row.seoTitle,
    metaDescription: row.metaDescription,
    intro: row.intro,
    filter: filterOf(row.filterDefinition),
    isPublished: row.isPublished,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * THE SEO LANDING PAGES (SEO P1-14, plan C10). The OS owns them; the Medusa
 * projection writes them to the commerce `landing_page` read model.
 *
 * THE SLUG lives in the slug registry's `LANDING_PAGE` space: a slug another
 * landing page holds or held is refused (an old address never gets a new
 * owner), a page may take back its own old slug, and a change writes the old
 * slug to `SlugHistory` and a 301 from `/hu/valogatas/<old>` to the new one, in
 * the same transaction, as the product slug does (PR 6).
 *
 * v1 HAS NO DELETE: taking a page down is `isPublished = false`, which the
 * projection sends and the shop answers with a 404.
 */
@Injectable()
export class SeoLandingService {
  constructor(
    @Inject(SEO_LANDING_STORE) private readonly store: SeoLandingStore,
  ) {}

  async list(): Promise<SeoLandingPage[]> {
    return (await this.store.list()).map(toSeoLandingPage);
  }

  async detail(id: string): Promise<SeoLandingPage> {
    const row = await this.store.find(id);
    if (!row) throw new NotFoundException(`no landing page ${id}`);
    return toSeoLandingPage(row);
  }

  async create(body: unknown): Promise<SeoLandingPage> {
    const input = await this.checked(body);
    const owner = await this.store.slugOwner(input.slug);
    if (owner) throw this.slugConflict(input.slug, owner);
    try {
      return toSeoLandingPage(await this.store.create(input));
    } catch (error) {
      if (error instanceof SeoLandingSlugTakenError)
        throw new ConflictException(`slug "${input.slug}" is taken`);
      throw error;
    }
  }

  async update(
    id: string,
    body: unknown,
    userId: string,
  ): Promise<SeoLandingPage> {
    const current = await this.store.find(id);
    if (!current) throw new NotFoundException(`no landing page ${id}`);
    const input = await this.checked(body);
    const changed = input.slug !== current.slug;
    if (changed) {
      const owner = await this.store.slugOwner(input.slug);
      if (owner && owner.landingId !== id)
        throw this.slugConflict(input.slug, owner);
    }
    try {
      const row = await this.store.update(
        id,
        input,
        changed ? { oldSlug: current.slug, userId } : null,
        async (redirects) => {
          if (!changed) return;
          await writeRedirect(redirects, {
            source: webshopLandingPath(current.slug),
            destination: webshopLandingPath(input.slug),
            reason: "SLUG_CHANGE",
            entityType: "LANDING_PAGE",
            entityId: id,
            createdById: userId,
            onExisting: "replace",
            destinationIsLive: true,
          });
        },
      );
      return toSeoLandingPage(row);
    } catch (error) {
      if (error instanceof RedirectError)
        throw new ConflictException(`redirect: ${error.message}`);
      if (error instanceof SeoLandingSlugTakenError)
        throw new ConflictException(`slug "${input.slug}" is taken`);
      throw error;
    }
  }

  /** The shape (shared parser), the slug's shape, and that the ids exist. */
  private async checked(body: unknown): Promise<SeoLandingPageInput> {
    const parsed = parseSeoLandingInput(body);
    if (!parsed.ok) throw new BadRequestException(parsed.message);
    const input = parsed.value;
    if (input.slug.length > SLUG_MAX || !SLUG_ALAK.test(input.slug))
      throw new BadRequestException(
        `slug: lowercase letters, digits and single hyphens, at most ${SLUG_MAX} characters`,
      );
    const [categories, brands] = await Promise.all([
      this.store.missingCategories(input.filter.storeCategoryIds),
      this.store.missingBrands(input.filter.brandIds),
    ]);
    if (categories.length || brands.length)
      throw new BadRequestException(
        [
          categories.length ? `no store category ${categories.join(", ")}` : "",
          brands.length ? `no brand ${brands.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("; "),
      );
    return input;
  }

  private slugConflict(
    slug: string,
    owner: { landingId: string; kind: "live" | "history" },
  ) {
    return new ConflictException(
      `slug "${slug}" ${owner.kind === "live" ? "belongs to" : "was used by"} landing page ${owner.landingId}`,
    );
  }
}
