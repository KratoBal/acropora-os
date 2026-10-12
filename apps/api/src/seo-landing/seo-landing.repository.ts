import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import type { SeoLandingOptions, SeoLandingPageInput } from "@acropora/types";

import {
  PrismaRedirectStore,
  lockRedirectWrites,
} from "../products/redirect/redirect.repository.js";
import {
  SeoLandingSlugTakenError,
  type SeoLandingRow,
  type SeoLandingStore,
} from "./seo-landing.service.js";

const LANDING = "LANDING_PAGE" as const;

const data = (input: SeoLandingPageInput) => ({
  slug: input.slug,
  title: input.title,
  seoTitle: input.seoTitle,
  metaDescription: input.metaDescription,
  intro: input.intro,
  filterDefinition: input.filter as unknown as Prisma.InputJsonValue,
  isPublished: input.isPublished,
});

const taken = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === "P2002";

/**
 * THE LANDING PAGES IN POSTGRES (SEO P1-14). The live slug's uniqueness is the
 * column's unique index; the shared uniqueness with `SlugHistory` (an old
 * address never gets a new owner) is `slugOwner`, as in the product slug store.
 */
@Injectable()
export class SeoLandingRepository implements SeoLandingStore {
  list(): Promise<SeoLandingRow[]> {
    return prisma.seoLandingPage.findMany({ orderBy: { slug: "asc" } });
  }

  /** The editor's choices: the category paths from the root, every brand. */
  async options(): Promise<SeoLandingOptions> {
    const [categories, brands] = await Promise.all([
      prisma.storeCategory.findMany({
        select: { id: true, name: true, parentId: true, isActive: true },
      }),
      prisma.brand.findMany({
        select: { id: true, name: true, isActive: true, archivedAt: true },
        orderBy: { name: "asc" },
      }),
    ]);
    const byId = new Map(categories.map((c) => [c.id, c]));
    const path = (id: string) => {
      const names: string[] = [];
      const seen = new Set<string>();
      let current = byId.get(id);
      while (current && !seen.has(current.id)) {
        seen.add(current.id);
        names.unshift(current.name);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
      return names.join(" > ");
    };
    return {
      categories: categories
        .map((c) => ({ id: c.id, path: path(c.id), isActive: c.isActive }))
        .sort((a, b) => a.path.localeCompare(b.path, "hu")),
      brands: brands.map((b) => ({
        id: b.id,
        name: b.name,
        shown: b.isActive && !b.archivedAt,
      })),
    };
  }

  find(id: string): Promise<SeoLandingRow | null> {
    return prisma.seoLandingPage.findUnique({ where: { id } });
  }

  async slugOwner(slug: string) {
    const live = await prisma.seoLandingPage.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (live) return { landingId: live.id, kind: "live" as const };
    const old = await prisma.slugHistory.findUnique({
      where: { entityType_slug: { entityType: LANDING, slug } },
      select: { entityId: true },
    });
    return old ? { landingId: old.entityId, kind: "history" as const } : null;
  }

  async missingCategories(ids: readonly string[]): Promise<string[]> {
    if (!ids.length) return [];
    const found = await prisma.storeCategory.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true },
    });
    const have = new Set(found.map((r) => r.id));
    return ids.filter((id) => !have.has(id));
  }

  async missingBrands(ids: readonly string[]): Promise<string[]> {
    if (!ids.length) return [];
    const found = await prisma.brand.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true },
    });
    const have = new Set(found.map((r) => r.id));
    return ids.filter((id) => !have.has(id));
  }

  async create(input: SeoLandingPageInput): Promise<SeoLandingRow> {
    try {
      return await prisma.seoLandingPage.create({ data: data(input) });
    } catch (error) {
      if (taken(error)) throw new SeoLandingSlugTakenError(input.slug);
      throw error;
    }
  }

  async update(
    id: string,
    input: SeoLandingPageInput,
    slugChange: { oldSlug: string; userId: string } | null,
    redirects: Parameters<SeoLandingStore["update"]>[3],
  ): Promise<SeoLandingRow> {
    try {
      return await prisma.$transaction(async (tx) => {
        if (slugChange) {
          await lockRedirectWrites(tx);
          // the page may take back its own old slug: then it is live, not old
          await tx.slugHistory.deleteMany({
            where: { entityType: LANDING, slug: input.slug, entityId: id },
          });
          await tx.slugHistory.create({
            data: {
              entityType: LANDING,
              entityId: id,
              slug: slugChange.oldSlug,
              replacedById: slugChange.userId,
            },
          });
        }
        const row = await tx.seoLandingPage.update({
          where: { id },
          data: data(input),
        });
        if (slugChange) await redirects(new PrismaRedirectStore(tx));
        return row;
      });
    } catch (error) {
      if (taken(error)) throw new SeoLandingSlugTakenError(input.slug);
      throw error;
    }
  }
}
