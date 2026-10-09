import type { Prisma, PrismaClient } from "@acropora/database";

import {
  lockRedirectWrites,
  PrismaRedirectStore,
} from "../redirect/redirect.repository.js";
import { webshopCategoryPath } from "../redirect/redirect-path.js";
import { writeRedirect } from "../redirect/redirect-writer.js";
import type {
  CategoryRef,
  StoreCategoryFile,
  StoreCategoryLoadPlan,
  StoreCategoryState,
} from "./store-category-load.js";

type Db = Pick<
  PrismaClient,
  | "storeCategory"
  | "storeCategoryProduct"
  | "unasCategoryMapping"
  | "slugHistory"
  | "productVariant"
  | "category"
>;

/** A terv bemenete az adatbázisból: csak a fájlban hivatkozott sorok. */
export async function loadStoreCategoryState(
  db: Db,
  file: StoreCategoryFile,
): Promise<StoreCategoryState> {
  const skus = file.products.map((p) => p.sku.trim());
  const unasIds = file.unasMappings.map((m) => m.unasCategoryId.trim());
  const [categories, slugHistory, variants, unas, mappings] = await Promise.all(
    [
      db.storeCategory.findMany({
        orderBy: { id: "asc" },
        select: {
          id: true,
          slug: true,
          name: true,
          parentId: true,
          seoTitle: true,
          metaDescription: true,
          intro: true,
          imageUrl: true,
          sortOrder: true,
          isActive: true,
        },
      }),
      db.slugHistory.findMany({
        where: { entityType: "STORE_CATEGORY" },
        select: { slug: true, entityId: true },
      }),
      db.productVariant.findMany({
        where: { sku: { in: skus } },
        select: { sku: true, productId: true },
      }),
      db.category.findMany({
        where: { id: { in: unasIds } },
        select: { id: true },
      }),
      db.unasCategoryMapping.findMany({
        where: { unasCategoryId: { in: unasIds } },
        select: { unasCategoryId: true, storeCategoryId: true, note: true },
      }),
    ],
  );
  const productIdBySku = new Map(variants.map((v) => [v.sku, v.productId]));
  const assignments = await db.storeCategoryProduct.findMany({
    where: { productId: { in: [...new Set(productIdBySku.values())] } },
    // a sorrend a terv változás-mércéjének része
    orderBy: [{ productId: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
    select: { productId: true, storeCategoryId: true, isPrimary: true },
  });
  return {
    categories,
    slugHistory,
    productIdBySku,
    assignments,
    unasCategoryIds: new Set(unas.map((u) => u.id)),
    mappings,
  };
}

/**
 * A TERV ALKALMAZÁSA, EGY TRANZAKCIÓBAN. A hívó ütközésmentes tervet ad (a
 * CLI ütközésnél nem hív ide). Sorrend: új kategóriák (szülő előbb), frissítés,
 * slugcsere előzménnyel és átirányítással, termék-besorolás, UNAS-leképezés.
 */
export async function applyStoreCategoryLoad(
  tx: Prisma.TransactionClient,
  plan: StoreCategoryLoadPlan,
): Promise<{ redirects: number }> {
  if (plan.conflicts.length > 0)
    throw new Error(
      `a terv ${plan.conflicts.length} ütközéssel nem alkalmazható`,
    );
  if (plan.slugChange.length > 0) await lockRedirectWrites(tx);

  const ujId = new Map<string, string>();
  const id = (ref: CategoryRef) => {
    if ("id" in ref) return ref.id;
    const found = ujId.get(ref.newSlug);
    if (!found) throw new Error(`"${ref.newSlug}" még nem jött létre`);
    return found;
  };

  for (const c of plan.create) {
    const row = await tx.storeCategory.create({
      data: {
        slug: c.slug,
        parentId: c.parent ? id(c.parent) : null,
        ...c.fields,
      },
      select: { id: true },
    });
    ujId.set(c.slug, row.id);
  }

  // a slugcsere előbb, hogy egy frissítés ne fusson bele a régi slugba
  let redirects = 0;
  const store = new PrismaRedirectStore(tx);
  for (const s of plan.slugChange) {
    if (s.reclaimsOwnHistory)
      await tx.slugHistory.deleteMany({
        where: { entityType: "STORE_CATEGORY", entityId: s.id, slug: s.to },
      });
    await tx.slugHistory.create({
      data: { entityType: "STORE_CATEGORY", entityId: s.id, slug: s.from },
    });
    await tx.storeCategory.update({
      where: { id: s.id },
      data: { slug: s.to },
    });
    await writeRedirect(store, {
      source: webshopCategoryPath(s.from),
      destination: webshopCategoryPath(s.to),
      reason: "SLUG_CHANGE",
      entityType: "STORE_CATEGORY",
      entityId: s.id,
      onExisting: "replace",
      destinationIsLive: true,
    });
    redirects++;
  }

  for (const u of plan.update)
    await tx.storeCategory.update({
      where: { id: u.id },
      data: {
        ...u.data,
        ...(u.parent !== undefined
          ? { parentId: u.parent ? id(u.parent) : null }
          : {}),
      },
    });

  for (const p of plan.products) {
    // előbb minden sor el, hogy a primary-index ne lásson két primaryt közben
    await tx.storeCategoryProduct.deleteMany({
      where: { productId: p.productId },
    });
    if (p.rows.length > 0)
      await tx.storeCategoryProduct.createMany({
        data: p.rows.map((r, index) => ({
          productId: p.productId,
          storeCategoryId: id(r.category),
          isPrimary: r.isPrimary,
          sortOrder: index,
        })),
      });
  }

  for (const m of plan.mappings) {
    const storeCategoryId = m.storeCategory ? id(m.storeCategory) : null;
    await tx.unasCategoryMapping.upsert({
      where: { unasCategoryId: m.unasCategoryId },
      create: {
        unasCategoryId: m.unasCategoryId,
        storeCategoryId,
        note: m.note,
      },
      update: { storeCategoryId, note: m.note },
    });
  }
  return { redirects };
}
