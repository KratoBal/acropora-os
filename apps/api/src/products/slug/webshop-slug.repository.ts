import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";

import {
  SlugTakenError,
  type WebshopSlugStore,
} from "./webshop-slug.service.js";

const WEBSHOP = "WEBSHOP" as const;

/**
 * A WEBSHOP-SLUG A `ChannelListing(channel = WEBSHOP)` SORBAN (SEO P0 PR 5, C4). Az
 * egyediséget a migráció részleges egyedi indexe tartja; a `SlugHistory`-val közös
 * egyediséget (egy régi cím ne kapjon új gazdát) ez a tároló, a lekérdezéseiben.
 */
@Injectable()
export class PrismaWebshopSlugStore implements WebshopSlugStore {
  async currentSlug(productId: string): Promise<string | null> {
    const sor = await prisma.channelListing.findUnique({
      where: { productId_channel: { productId, channel: WEBSHOP } },
      select: { slug: true },
    });
    return sor?.slug ?? null;
  }

  async basis(productId: string) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        name: true,
        // a vetítés sorrendje: az első aktív változat
        variants: {
          where: { isActive: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 1,
          select: { sku: true },
        },
      },
    });
    if (!product) return null;
    return { name: product.name, primarySku: product.variants[0]?.sku ?? null };
  }

  async takenWithPrefix(prefix: string): Promise<Set<string>> {
    const [elo, regi] = await Promise.all([
      prisma.channelListing.findMany({
        where: { channel: WEBSHOP, slug: { startsWith: prefix } },
        select: { slug: true },
      }),
      prisma.slugHistory.findMany({
        where: { entityType: "PRODUCT", slug: { startsWith: prefix } },
        select: { slug: true },
      }),
    ]);
    return new Set([
      ...elo.flatMap((r) => (r.slug ? [r.slug] : [])),
      ...regi.map((r) => r.slug),
    ]);
  }

  async owner(slug: string) {
    const elo = await prisma.channelListing.findFirst({
      where: { channel: WEBSHOP, slug },
      select: { productId: true },
    });
    if (elo) return { kind: "live" as const, productId: elo.productId };
    const regi = await prisma.slugHistory.findUnique({
      where: { entityType_slug: { entityType: "PRODUCT", slug } },
      select: { entityId: true },
    });
    return regi ? { kind: "history" as const, productId: regi.entityId } : null;
  }

  async saveFirst(productId: string, slug: string): Promise<void> {
    try {
      await prisma.$transaction(async (tx) => {
        // a SlugHistory-val közös egyediség az írás pillanatában is
        const regi = await tx.slugHistory.findUnique({
          where: { entityType_slug: { entityType: "PRODUCT", slug } },
          select: { id: true },
        });
        if (regi) throw new SlugTakenError(slug);
        await tx.channelListing.upsert({
          where: { productId_channel: { productId, channel: WEBSHOP } },
          create: { productId, channel: WEBSHOP, slug },
          update: { slug },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new SlugTakenError(slug);
      throw error;
    }
  }

  async replace(
    input: Parameters<WebshopSlugStore["replace"]>[0],
  ): Promise<void> {
    try {
      await prisma.$transaction(async (tx) => {
        // a termék a SAJÁT régi slugját visszakaphatja: akkor az élő lesz, nem régi
        await tx.slugHistory.deleteMany({
          where: {
            entityType: "PRODUCT",
            slug: input.newSlug,
            entityId: input.productId,
          },
        });
        if (input.oldSlug)
          await tx.slugHistory.create({
            data: {
              entityType: "PRODUCT",
              entityId: input.productId,
              slug: input.oldSlug,
              replacedById: input.userId,
            },
          });
        await tx.channelListing.upsert({
          where: {
            productId_channel: { productId: input.productId, channel: WEBSHOP },
          },
          create: {
            productId: input.productId,
            channel: WEBSHOP,
            slug: input.newSlug,
          },
          update: { slug: input.newSlug },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new SlugTakenError(input.newSlug);
      throw error;
    }
  }
}
