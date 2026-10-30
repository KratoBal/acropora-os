import { createHash } from "node:crypto";

import type { Prisma, PrismaClient } from "@acropora/database";

import {
  describeCategoryRedirectBackfill,
  planCategoryRedirectBackfill,
  type CategoryHandleForm,
  type MedusaCategoryRef,
} from "./category-redirect-backfill.js";

/**
 * A KATEGÓRIA-ÁTIRÁNYÍTÁS TERVE AZ ADATBÁZISBÓL, A PARANCS ÉS A VÉGPONT KÖZÖS RÉSZE
 * (commerce audit P1, régi UNAS-linkek). Egy helyen áll, hogy a két út ugyanazt a
 * tervet és ugyanazt a jelentést adja: a végpont (`POST /seo/redirects/category-backfill`)
 * a flotta hívásához kell, mert a parancsot a teszt gépen a flotta nem futtathatja.
 */
export type CategoryBackfillDb = Pick<
  PrismaClient | Prisma.TransactionClient,
  "category" | "externalReference" | "urlRedirect"
>;

export async function planCategoryRedirectsFromDb(
  db: CategoryBackfillDb,
  paths: readonly string[],
  form: CategoryHandleForm,
  medusa?: readonly MedusaCategoryRef[],
) {
  const [categories, unasRefs, meglevo] = await Promise.all([
    db.category.findMany({
      orderBy: { id: "asc" },
      select: { id: true, name: true, parentId: true },
    }),
    db.externalReference.findMany({
      where: { system: "UNAS", entityType: "Category" },
      select: { entityId: true, externalId: true },
    }),
    db.urlRedirect.findMany({
      select: {
        id: true,
        sourcePath: true,
        destinationPath: true,
        isActive: true,
      },
    }),
  ]);
  const unasId = new Map(unasRefs.map((r) => [r.entityId, r.externalId]));
  return planCategoryRedirectBackfill(
    paths,
    categories.map((c) => ({
      id: c.id,
      name: c.name,
      parentId: c.parentId,
      unasId: unasId.get(c.id) ?? null,
    })),
    meglevo,
    { form, medusa },
  );
}

/**
 * A TERV UJJLENYOMATA. A szárazfutás jelentése mellett jön vissza, és az `apply`
 * csak ugyanezzel mehet: ami a szárazfutáson látszott, pontosan az íródik, és ha az
 * adatbázis vagy a lista közben változott, a lenyomat is más, tehát nem ír.
 * A lenyomat a jelentés SZÖVEGÉBŐL és a kiírandó sorokból számolódik.
 */
export function categoryRedirectPlanHash(
  form: CategoryHandleForm,
  plan: Awaited<ReturnType<typeof planCategoryRedirectsFromDb>>,
): string {
  const { store, report } = plan;
  return createHash("sha256")
    .update(
      JSON.stringify({
        form,
        text: describeCategoryRedirectBackfill(report, form),
        created: store
          .created()
          .map((r) => [r.sourcePath, r.destinationPath, r.reason]),
        updated: store.updated().map((m) => [m.id, m.data]),
      }),
    )
    .digest("hex");
}
