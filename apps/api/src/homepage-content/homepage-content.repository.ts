import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import type { HomepageContentInput } from "@acropora/types";

import type {
  HomepageContentRow,
  HomepageContentStore,
  HomepageFeaturedRow,
} from "./homepage-content.service.js";

/** The fixed advisory-lock key of the "Egyedi korallok" band (any constant, used only here). */
export const FEATURED_LOCK_KEY = 7290012601n;

/** The home page content in Postgres: one row per key, written whole. */
@Injectable()
export class HomepageContentRepository implements HomepageContentStore {
  find(key: string): Promise<HomepageContentRow | null> {
    return prisma.homepageContent.findUnique({ where: { key } });
  }

  async featuredList(): Promise<HomepageFeaturedRow[]> {
    const rows = await prisma.homepageFeaturedProduct.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        productId: true,
        sortOrder: true,
        product: { select: { name: true } },
      },
    });
    return rows.map((row) => ({
      productId: row.productId,
      name: row.product.name,
      sortOrder: row.sortOrder,
    }));
  }

  async setFeatured(
    productId: string,
    featured: boolean,
    userId: string,
    max: number,
  ): Promise<"ok" | "unknown-product" | "full"> {
    return prisma.$transaction(async (tx) => {
      /*
        ONE LOCK FOR THE WHOLE BAND (barracuda, #1723). The limit is "count
        first, then create", and under READ COMMITTED two concurrent marks both
        see 11 and both create: thirteen rows, and the shop's validator (at most
        12) would then refuse the whole home page record. The advisory lock,
        held to the end of the transaction, makes the count and the create one
        step; unmarking waits too, so a mark never counts a row that is about to
        go. `SELECT 1 FROM (SELECT lock)` because Prisma cannot read the void
        column the bare function returns.
      */
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(${FEATURED_LOCK_KEY}::bigint)) AS held`;
      if (!featured) {
        await tx.homepageFeaturedProduct.deleteMany({ where: { productId } });
        return "ok" as const;
      }
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: { id: true },
      });
      if (!product) return "unknown-product" as const;
      const existing = await tx.homepageFeaturedProduct.findUnique({
        where: { productId },
        select: { id: true },
      });
      if (existing) return "ok" as const;
      const [count, last] = await Promise.all([
        tx.homepageFeaturedProduct.count(),
        tx.homepageFeaturedProduct.findFirst({
          orderBy: { sortOrder: "desc" },
          select: { sortOrder: true },
        }),
      ]);
      if (count >= max) return "full" as const;
      await tx.homepageFeaturedProduct.create({
        data: {
          productId,
          sortOrder: (last?.sortOrder ?? -1) + 1,
          updatedById: userId,
        },
      });
      return "ok" as const;
    });
  }

  setProjection(
    key: string,
    enabled: boolean,
    userId: string,
  ): Promise<HomepageContentRow> {
    return prisma.homepageContent.upsert({
      where: { key },
      // a row nobody has written content to yet: no overrides, slides not set
      create: {
        key,
        texts: {},
        slides: Prisma.DbNull,
        projectionEnabled: enabled,
        updatedById: userId,
      },
      update: { projectionEnabled: enabled, updatedById: userId },
    });
  }

  save(
    key: string,
    input: HomepageContentInput,
    userId: string,
  ): Promise<HomepageContentRow> {
    const data = {
      texts: input.texts as unknown as Prisma.InputJsonValue,
      // null in a nullable Json column is the database NULL (not set)
      slides:
        input.slides === null
          ? Prisma.DbNull
          : (input.slides as unknown as Prisma.InputJsonValue),
      updatedById: userId,
    };
    return prisma.homepageContent.upsert({
      where: { key },
      create: { key, ...data },
      update: data,
    });
  }
}
